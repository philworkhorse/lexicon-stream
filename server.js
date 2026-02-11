const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3500;

app.use(express.static(path.join(__dirname, 'public')));

// Serve stream data
app.get('/api/stream', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'stream.json')));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'No stream data available' });
  }
});

app.listen(PORT, () => {
  console.log(`Lexicon Stream running on port ${PORT}`);
});
