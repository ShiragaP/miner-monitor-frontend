require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 21551;

// Configurable Rig IPs (default list from user request)
const DEFAULT_RIGS = [
  '192.168.1.101:21550',
  '192.168.1.102:21550',
  '192.168.1.113:21550',
  '192.168.1.114:21550',
  '192.168.1.122:21550',
  '192.168.1.123:21550'
];

const RIG_IPS = process.env.RIG_IPS
  ? process.env.RIG_IPS.split(',').map(ip => ip.trim())
  : DEFAULT_RIGS;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Expose configuration to the client (browser) so it knows where to query
app.get('/api/config', (req, res) => {
  res.json({ rigs: RIG_IPS });
});

// Fallback all other routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`SRBMiner Monitor Dashboard Server started!`);
  console.log(`Port: ${PORT}`);
  console.log(`Mode: CLIENT-SIDE FETCH`);
  console.log(`Configured Rigs: ${RIG_IPS.join(', ')}`);
  console.log(`==================================================`);
});
