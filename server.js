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

const MOCK_MODE = process.env.MOCK_MODE === 'true';

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Mock data generator for testing purposes
function generateMockRigData(ip, index) {
  const rigNumber = ip.split('.').pop().split(':')[0]; // get last octet of IP
  const uptime = Math.floor(Math.random() * 50000) + 10000;
  
  // Create 2 to 6 GPUs per rig
  const gpuCount = (index % 3) + 3; // 3, 4, or 5 GPUs
  const gpus = [];
  let rigHashrate = 0;
  
  const gpuModels = [
    'NVIDIA GeForce RTX 3070',
    'NVIDIA GeForce RTX 3060 Ti',
    'AMD Radeon RX 6700 XT',
    'NVIDIA GeForce RTX 3080',
    'AMD Radeon RX 580 Series'
  ];
  
  const model = gpuModels[index % gpuModels.length];
  const baseHashrate = model.includes('3080') ? 95000000 : 
                       model.includes('3070') ? 61000000 :
                       model.includes('6700') ? 47000000 :
                       model.includes('3060') ? 45000000 : 30000000; // in H/s

  for (let i = 0; i < gpuCount; i++) {
    // Add small random fluctuations (+/- 1.5%) to hashrate
    const fluctuation = 1 + (Math.random() * 0.03 - 0.015);
    const hashrate = Math.floor(baseHashrate * fluctuation);
    rigHashrate += hashrate;

    // Fluctuating temp: 50C - 78C
    const temp = Math.floor(60 + (Math.random() * 18 - 9) + (i * 2));
    const fan = Math.floor(45 + (temp - 50) * 1.5);
    const power = Math.floor((baseHashrate / 500000) + (Math.random() * 10 - 5));

    gpus.push({
      device_id: i,
      model: `${model} (GPU #${i})`,
      hashrate: hashrate,
      temperature: Math.min(Math.max(temp, 35), 90),
      fan_speed: Math.min(Math.max(fan, 30), 100),
      power: power
    });
  }

  return {
    rig_name: `Rig-${rigNumber}`,
    miner_version: '2.4.4',
    uptime: uptime,
    hashrate_total: rigHashrate,
    gpu_devices: gpus
  };
}

// API endpoint to fetch stats for all rigs
app.get('/api/stats', async (req, res) => {
  const fetchPromises = RIG_IPS.map(async (ip, index) => {
    // If mock mode is enabled, generate mock data immediately
    if (MOCK_MODE) {
      // Simulate network delay between 100ms and 500ms
      await new Promise(resolve => setTimeout(resolve, Math.random() * 400 + 100));
      
      // Simulate random offline status for 123 occasionally (e.g. 10% chance)
      if (ip.includes('123') && Math.random() < 0.1) {
        return {
          ip,
          name: `Rig-${ip.split('.').pop().split(':')[0]}`,
          status: 'offline',
          error: 'Connection timed out'
        };
      }
      
      const mockData = generateMockRigData(ip, index);
      return parseRigData(ip, mockData);
    }

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
  console.log(`Mode: ${MOCK_MODE ? 'MOCK / SIMULATOR' : 'LIVE API'}`);
  console.log(`Configured Rigs: ${RIG_IPS.join(', ')}`);
  console.log(`==================================================`);
});
