require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');

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

// API endpoint to fetch stats for all rigs
app.get('/api/stats', async (req, res) => {
  const fetchPromises = RIG_IPS.map(async (ip, index) => {
    // Real API fetch
    const url = ip.startsWith('http') ? ip : `http://${ip}`;
    try {
      const response = await axios.get(url, { timeout: 2500 });
      return parseRigData(ip, response.data);
    } catch (error) {
      return {
        ip,
        name: `Rig-${ip.split('.').pop().split(':')[0] || ip}`,
        status: 'offline',
        error: error.message
      };
    }
  });

  try {
    const results = await Promise.all(fetchPromises);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rig statistics', message: err.message });
  }
});

// Robust parser to extract data matching various SRBMiner JSON schemas
function parseRigData(ip, data) {
  const defaultName = `Rig-${ip.split('.').pop().split(':')[0] || ip}`;
  const name = data.rig_name || data.name || defaultName;

  const rig = {
    ip: ip,
    name: name,
    status: 'online',
    version: data.miner_version || 'Unknown',
    uptime: data.uptime || 0,
    hashrate_total: 0,
    max_temp: 0,
    gpus: []
  };

  // Support different naming conventions for GPU array
  const devices = data.gpu_devices || data.devices || data.gpus || [];

  if (Array.isArray(devices)) {
    devices.forEach((dev, index) => {
      // Handle potential GPU hashrate field names
      const hashrate = typeof dev.hashrate === 'number' ? dev.hashrate : 
                       (typeof dev.hash === 'number' ? dev.hash : 
                       (typeof dev.hashrate_total === 'number' ? dev.hashrate_total : 0));

      const temp = typeof dev.temperature === 'number' ? dev.temperature : 
                   (typeof dev.temp === 'number' ? dev.temp : 0);

      const fan = typeof dev.fan_speed === 'number' ? dev.fan_speed : 
                  (typeof dev.fan === 'number' ? dev.fan : 0);

      const power = typeof dev.power === 'number' ? dev.power : 
                    (typeof dev.power_usage === 'number' ? dev.power_usage : 0);

      const gpu = {
        id: dev.device_id !== undefined ? dev.device_id : (dev.id !== undefined ? dev.id : index),
        model: dev.model || dev.name || `GPU #${index}`,
        hashrate: hashrate,
        temp: temp,
        fan: fan,
        power: power
      };

      rig.gpus.push(gpu);

      // Track maximum temperature across GPUs
      if (temp > rig.max_temp) {
        rig.max_temp = temp;
      }
    });
  }

  // Get total hashrate from the top level hashrate_total, or sum GPU hashrates if missing/zero
  if (typeof data.hashrate_total === 'number' && data.hashrate_total > 0) {
    rig.hashrate_total = data.hashrate_total;
  } else {
    rig.hashrate_total = rig.gpus.reduce((sum, g) => sum + g.hashrate, 0);
  }

  return rig;
}

// Fallback all other routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`SRBMiner Monitor Dashboard Server started!`);
  console.log(`Port: ${PORT}`);
  console.log(`Mode: LIVE API`);
  console.log(`Configured Rigs: ${RIG_IPS.join(', ')}`);
  console.log(`==================================================`);
});
