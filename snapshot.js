#!/usr/bin/env node
/**
 * Lexicon Stream — Snapshot Builder
 * Pulls state from Pi Lexicon API and builds a chronological event stream.
 * Also reads historical snapshots from lexicon-live project for deeper history.
 */

const fs = require('fs');
const path = require('path');

const PI_URL = process.env.PI_URL || 'http://192.168.1.111:7890';
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');
const STREAM_FILE = path.join(__dirname, 'stream.json');

// Historical snapshot directories from other lexicon projects
const HISTORY_DIRS = [
  path.join(__dirname, '..', 'lexicon-live'),
  path.join(__dirname, '..', 'lexicon-archaeology'),
];

async function fetchState() {
  const res = await fetch(`${PI_URL}/api/state`);
  return res.json();
}

function buildEvents(state) {
  const events = [];
  const gen = state.generation;
  
  // --- Living words: track births ---
  for (const [word, info] of Object.entries(state.words)) {
    events.push({
      type: 'birth',
      gen: info.born,
      word,
      meaning: info.meaning,
      category: info.category,
      fitness: info.fitness,
      age: gen - info.born,
      alive: true,
    });
  }
  
  // --- Extinct words: births and deaths ---
  for (const ext of state.extinct || []) {
    events.push({
      type: 'birth',
      gen: ext.born,
      word: ext.word,
      meaning: ext.meaning,
      category: ext.category || 'unknown',
      alive: false,
    });
    events.push({
      type: 'death',
      gen: ext.died || ext.born + 1,
      word: ext.word,
      meaning: ext.meaning,
      category: ext.category || 'unknown',
      lifespan: (ext.died || ext.born + 1) - ext.born,
      uses: ext.uses || 0,
      stillborn: (ext.uses || 0) === 0 && ((ext.died || ext.born + 1) - ext.born) <= 5,
    });
  }
  
  // --- Compounds ---
  for (const [word, info] of Object.entries(state.compounds || {})) {
    events.push({
      type: 'compound',
      gen: info.born,
      word,
      meaning: info.compound_meaning,
      parts: info.parts,
      partMeanings: info.meanings,
    });
  }
  
  // --- Sound shifts ---
  for (const shift of state.sound_shifts || []) {
    events.push({
      type: 'shift',
      gen: shift.gen,
      from: shift.from,
      to: shift.to,
      meaning: shift.meaning,
    });
  }
  
  // Sort by generation, then by type priority
  const typePriority = { death: 0, shift: 1, compound: 2, birth: 3 };
  events.sort((a, b) => {
    if (a.gen !== b.gen) return a.gen - b.gen;
    return (typePriority[a.type] || 5) - (typePriority[b.type] || 5);
  });
  
  return events;
}

function buildStats(state) {
  const gen = state.generation;
  const words = Object.entries(state.words);
  const extinct = state.extinct || [];
  const compounds = Object.entries(state.compounds || {});
  
  // Category distribution of living words
  const categories = {};
  for (const [, info] of words) {
    categories[info.category] = (categories[info.category] || 0) + 1;
  }
  
  // Mortality stats
  const lifespans = extinct
    .filter(e => e.died)
    .map(e => e.died - e.born);
  const avgLifespan = lifespans.length > 0
    ? lifespans.reduce((a, b) => a + b, 0) / lifespans.length
    : 0;
  const maxLifespan = lifespans.length > 0 ? Math.max(...lifespans) : 0;
  const stillbornCount = extinct.filter(e => (e.uses || 0) === 0 && ((e.died || e.born+1) - e.born) <= 5).length;
  
  // Living word stats
  const livingByAge = words
    .map(([w, info]) => ({ word: w, meaning: info.meaning, age: gen - info.born, fitness: info.fitness }))
    .sort((a, b) => b.age - a.age);
  
  const elder = livingByAge[0] || null;
  const fittest = words.length > 0
    ? words.reduce((best, [w, info]) => info.fitness > best.fitness ? { word: w, ...info } : best, { fitness: -1 })
    : null;

  return {
    generation: gen,
    population: words.length,
    totalBorn: state.stats?.total_generated || 0,
    totalDead: state.stats?.total_extinct || 0,
    totalCompounds: compounds.length,
    totalShifts: state.stats?.total_shifts || 0,
    mortalityRate: state.stats?.total_generated > 0 
      ? ((state.stats.total_extinct / state.stats.total_generated) * 100).toFixed(1)
      : 0,
    avgLifespan: avgLifespan.toFixed(1),
    maxLifespan,
    stillbornCount,
    categories,
    elder,
    fittest: fittest ? { word: fittest.word, meaning: fittest.meaning, fitness: fittest.fitness } : null,
    livingWords: words.map(([w, info]) => ({
      word: w,
      meaning: info.meaning,
      category: info.category,
      age: gen - info.born,
      fitness: info.fitness,
      uses: info.uses,
    })).sort((a, b) => b.fitness - a.fitness),
  };
}

async function main() {
  console.log('Fetching lexicon state...');
  const state = await fetchState();
  console.log(`Gen ${state.generation}, ${Object.keys(state.words).length} living words`);
  
  const events = buildEvents(state);
  const stats = buildStats(state);
  
  console.log(`Built ${events.length} events`);
  console.log(`  Births: ${events.filter(e => e.type === 'birth').length}`);
  console.log(`  Deaths: ${events.filter(e => e.type === 'death').length}`);
  console.log(`  Compounds: ${events.filter(e => e.type === 'compound').length}`);
  console.log(`  Shifts: ${events.filter(e => e.type === 'shift').length}`);
  
  const stream = {
    generated: new Date().toISOString(),
    generation: state.generation,
    stats,
    events,
  };
  
  fs.writeFileSync(STREAM_FILE, JSON.stringify(stream, null, 2));
  console.log(`Written to ${STREAM_FILE}`);
  
  // Also save snapshot
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, `gen-${state.generation}.json`),
    JSON.stringify(state, null, 2)
  );
  console.log(`Snapshot saved: gen-${state.generation}.json`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
