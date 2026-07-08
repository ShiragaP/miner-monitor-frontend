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

// Market data proxy — avoids CORS issues fetching WhatToMine and CoinGecko from the browser
app.get('/api/market', async (req, res) => {
  try {
    const [wtmRes, cgRes] = await Promise.all([
      fetch('https://whattomine.com/coins/469.json?hr=1000&fee=3', {
        headers: { 'Accept': 'application/json', 'User-Agent': 'MinerMonitor/1.0' }
      }),
      fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=thb', {
        headers: { 'Accept': 'application/json' }
      })
    ]);

    if (!wtmRes.ok) throw new Error(`WhatToMine error: ${wtmRes.status}`);
    if (!cgRes.ok) throw new Error(`CoinGecko error: ${cgRes.status}`);

    const wtmData = await wtmRes.json();
    const cgData = await cgRes.json();

    res.json({
      btc_revenue_per_1000hs: wtmData.btc_revenue ?? 0,
      coin_name: wtmData.name ?? 'Unknown',
      algorithm: wtmData.algorithm ?? 'Unknown',
      btc_thb: cgData?.bitcoin?.thb ?? 0
    });
  } catch (err) {
    console.error('Market API error:', err.message);
    res.status(502).json({ error: err.message });
  }
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
