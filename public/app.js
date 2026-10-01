// SRBMiner Rig Monitor Frontend Script

// Global state
let countdownSeconds = 300;
let refreshIntervalId = null;
let countdownIntervalId = null;
let isFetching = false;
let marketData = null; // cached market data (btc_revenue_per_1000ths, btc_thb, etc.)
let lastRigResults = null; // stored rig results to re-run economics when market data updates
let isFetchingMarket = false; // market fetch in-flight flag
let testRigIp = '192.168.1.157:21550';
let testRigResult = null; // isolated test rig telemetry

// DOM Elements
const btnRefresh = document.getElementById('btn-refresh-stats');
const btnTestRig = document.getElementById('btn-test-rig');
const testRigDot = document.getElementById('test-rig-dot');
const headerStatusDot = document.getElementById('header-status-dot');
const statusText = document.getElementById('status-text');
const timerVal = document.getElementById('val-timer');

// Overview elements
const elRigsOnline = document.getElementById('val-rigs-online');
const elTotalHashrate = document.getElementById('val-total-hashrate');
const elMaxTemp = document.getElementById('val-max-temp');
const elTotalGpus = document.getElementById('val-total-gpus');
const badgeTotalRigs = document.getElementById('badge-total-rigs-count');
const rigsGrid = document.getElementById('rigs-grid-container');

// Economics DOM
const elRevenue = document.getElementById('val-revenue');
const elRevenueBtc = document.getElementById('val-revenue-btc');
const elCost = document.getElementById('val-cost');
const elCostKwh = document.getElementById('val-cost-kwh');
const elProfit = document.getElementById('val-profit');
const elProfitNote = document.getElementById('val-profit-note');
const elEconBadge = document.getElementById('badge-economics-source');

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
  handleRoute();
  fetchStats();
  fetchMarket();
  startTimers();
  
  btnRefresh.addEventListener('click', () => {
    if (!isFetching) {
      fetchStats();
      fetchMarket();
    }
  });
});

window.addEventListener('hashchange', handleRoute);

// Start auto-refresh and timer loops
function startTimers() {
  // Clear any existing intervals
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  if (countdownIntervalId) clearInterval(countdownIntervalId);

  countdownSeconds = 300;
  timerVal.textContent = formatCountdown(countdownSeconds);

  // Countdown timer loop (updates every second)
  countdownIntervalId = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      timerVal.textContent = 'Refreshing...';
    } else {
      timerVal.textContent = formatCountdown(countdownSeconds);
    }
  }, 1000);

  // Stats polling interval (every 5 minutes)
  refreshIntervalId = setInterval(() => {
    fetchStats();
    fetchMarket();
  }, 300000);
}

// Format countdown seconds as mm:ss
function formatCountdown(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Reset timer state after fetch
function resetTimer() {
  countdownSeconds = 300;
  timerVal.textContent = formatCountdown(countdownSeconds);
  startTimers();
}

// Query an individual rig directly from the browser
async function fetchSingleRigTelemetry(ip) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5s timeout

  const targetIp = ip.includes(':') ? ip : `${ip}:21550`;
  const url = targetIp.startsWith('http') ? targetIp : `http://${targetIp}`;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);

    // Read body text first to perform strict JSON checks
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Response is not a valid JSON object');
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response format (not a JSON object)');
    }

    return parseRigData(ip, data);
  } catch (error) {
    clearTimeout(timeoutId);
    const fallbackName = ip.includes('192.168.1.201') ? 'shp01' : (ip.includes('192.168.1.103') ? 'urig3' : (ip.includes('192.168.1.157') ? 'shiraga' : `Rig-${ip.split('.').pop().split(':')[0] || ip}`));
    const isQuantusRig = ip.includes('192.168.1.113') || ip.includes('192.168.1.103');
    return {
      ip,
      name: fallbackName,
      status: 'offline',
      coin_key: isQuantusRig ? 'quantus' : 'pearl',
      coin_name: isQuantusRig ? 'Quantus' : 'Pearl',
      algorithm: isQuantusRig ? 'QPoW' : 'Pearl',
      error: error.name === 'AbortError' ? 'Connection timed out' : error.message
    };
  }
}

// Fetch stats from backend API
// Fetch config and query rigs directly from client browser
async function fetchStats() {
  isFetching = true;
  btnRefresh.classList.add('loading');
  headerStatusDot.className = 'status-dot loading';
  statusText.textContent = 'Updating...';
  if (testRigDot) {
    testRigDot.className = 'test-rig-dot loading';
  }

  try {
    // 1. Get the list of rig IPs from server config
    const configResponse = await fetch('/api/config');
    if (!configResponse.ok) {
      throw new Error(`Failed to load server config: ${configResponse.status}`);
    }
    const config = await configResponse.json();
    const rigsList = config.rigs || [];
    if (config.testRig) {
      testRigIp = config.testRig;
    }

    if (rigsList.length === 0) {
      updateUI([]);
      return;
    }

    // 2. Query production rigs in parallel AND isolated test rig concurrently
    const prodRigsPromise = Promise.all(rigsList.map(fetchSingleRigTelemetry));
    const testRigPromise = fetchSingleRigTelemetry(testRigIp);

    const [results, testResult] = await Promise.all([prodRigsPromise, testRigPromise]);
    lastRigResults = results;
    testRigResult = testResult;

    // Update test rig navbar indicator
    if (testRigDot) {
      testRigDot.className = `test-rig-dot ${testRigResult.status === 'online' ? 'online' : 'offline'}`;
      testRigDot.title = `Test Rig (${testRigResult.name}): ${testRigResult.status}`;
    }

    // Note: Only production rigs are passed to dashboard overview and economics
    updateUI(results);
    updateEconomics(results);
    handleRoute();
    
    headerStatusDot.className = 'status-dot';
    headerStatusDot.style.background = 'var(--color-online)';
    headerStatusDot.style.boxShadow = '0 0 10px var(--color-online)';
    statusText.textContent = 'Connected';
  } catch (error) {
    console.error('Error fetching rig stats:', error);
    headerStatusDot.className = 'status-dot';
    headerStatusDot.style.background = 'var(--color-offline)';
    headerStatusDot.style.boxShadow = '0 0 10px var(--color-offline)';
    statusText.textContent = 'Error';
    if (testRigDot) {
      testRigDot.className = 'test-rig-dot offline';
    }
    
    rigsGrid.innerHTML = `
      <div class="glass-panel" style="grid-column: 1 / -1; padding: 3rem; text-align: center; border-color: var(--color-offline);">
        <div style="font-size: 1.25rem; font-weight: 500; color: var(--color-offline); margin-bottom: 0.5rem;">Configuration Failed</div>
        <p style="font-size: 0.85rem; color: var(--text-secondary);">${error.message}</p>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 1rem;">Make sure the monitor web server is running and reachable.</p>
      </div>
    `;
  } finally {
    isFetching = false;
    btnRefresh.classList.remove('loading');
    resetTimer();
  }
}

// Client-side parser to extract data matching SRBMiner JSON schemas
function parseRigData(ip, data) {
  const defaultName = ip.includes('192.168.1.201') ? 'shp01' : (ip.includes('192.168.1.103') ? 'urig3' : (ip.includes('192.168.1.157') ? 'shiraga' : `Rig-${ip.split('.').pop().split(':')[0] || ip}`));
  // Strictly use rig_name from JSON
  const name = data.rig_name || defaultName;

  // Extract CPU info and temperature if available in JSON
  let cpuModel = '';
  let cpuTemp = null;

  if (Array.isArray(data.cpu_devices) && data.cpu_devices.length > 0) {
    const cpuDev = data.cpu_devices[0];
    cpuModel = cpuDev.model || '';
    if (typeof cpuDev.temperature === 'number') cpuTemp = cpuDev.temperature;
    else if (typeof cpuDev.temp === 'number') cpuTemp = cpuDev.temp;
  }

  if (cpuTemp === null) {
    if (typeof data.cpu_temperature === 'number') cpuTemp = data.cpu_temperature;
    else if (typeof data.cpu_temp === 'number') cpuTemp = data.cpu_temp;
    else if (typeof data.cpu?.temperature === 'number') cpuTemp = data.cpu.temperature;
    else if (typeof data.cpu?.temp === 'number') cpuTemp = data.cpu.temp;
  }

  // Extract algorithm and coin info from SRBMiner telemetry
  let coinKey = (ip.includes('192.168.1.113') || ip.includes('192.168.1.103')) ? 'quantus' : 'pearl';
  let coinName = (ip.includes('192.168.1.113') || ip.includes('192.168.1.103')) ? 'Quantus' : 'Pearl';
  let algoName = (ip.includes('192.168.1.113') || ip.includes('192.168.1.103')) ? 'QPoW' : 'Pearl';
  let poolAddress = '';
  let shares = null;

  if (Array.isArray(data.algorithms) && data.algorithms.length > 0) {
    const activeAlgo = data.algorithms[0];
    const rawAlgo = (activeAlgo.name || '').toLowerCase();
    poolAddress = activeAlgo.pool?.pool || '';
    shares = activeAlgo.shares || null;

    if (rawAlgo.includes('quant') || rawAlgo.includes('qpow')) {
      coinKey = 'quantus';
      coinName = 'Quantus';
      algoName = 'QPoW';
    } else if (rawAlgo.includes('pearl')) {
      coinKey = 'pearl';
      coinName = 'Pearl';
      algoName = 'Pearl';
    } else if (rawAlgo) {
      coinKey = rawAlgo;
      coinName = activeAlgo.name.toUpperCase();
      algoName = activeAlgo.name;
    }
  }

  const rig = {
    ip: ip,
    name: name,
    status: 'online',
    version: data.miner_version || 'Unknown',
    uptime: data.mining_time !== undefined ? data.mining_time : (data.uptime || 0),
    coin_key: coinKey,
    coin_name: coinName,
    algorithm: algoName,
    pool: poolAddress,
    shares: shares,
    hashrate_total: 0,
    max_temp: 0,
    cpu_model: cpuModel,
    cpu_temp: cpuTemp,
    gpus: []
  };

  const devices = data.gpu_devices || data.devices || data.gpus || [];

  if (Array.isArray(devices)) {
    devices.forEach((dev, index) => {
      // Find temperature (handle temperature, temp)
      const temp = typeof dev.temperature === 'number' ? dev.temperature : 
                   (typeof dev.temp === 'number' ? dev.temp : 0);

      // Find fan speed (handle fan_speed_percent, fan_speed, fan)
      const fan = typeof dev.fan_speed_percent === 'number' ? dev.fan_speed_percent : 
                  (typeof dev.fan_speed === 'number' ? dev.fan_speed : 
                  (typeof dev.fan === 'number' ? dev.fan : 0));

      // Find power (handle asic_power, power, power_usage)
      const power = typeof dev.asic_power === 'number' ? dev.asic_power : 
                    (typeof dev.power === 'number' ? dev.power : 
                    (typeof dev.power_usage === 'number' ? dev.power_usage : 0));

      // Find GPU hashrate from the algorithms array if not present on device level
      let hashrate = 0;
      if (typeof dev.hashrate === 'number') {
        hashrate = dev.hashrate;
      } else if (typeof dev.hash === 'number') {
        hashrate = dev.hash;
      } else if (Array.isArray(data.algorithms)) {
        // Sum hashrate for this specific GPU across all active algorithms
        const gpuKey = dev.device || `gpu${dev.id !== undefined ? dev.id : index}`;
        data.algorithms.forEach(algo => {
          if (algo.hashrate && algo.hashrate.gpu && typeof algo.hashrate.gpu[gpuKey] === 'number') {
            hashrate += algo.hashrate.gpu[gpuKey];
          }
        });
      }

      const gpu = {
        id: dev.id !== undefined ? dev.id : (dev.device_id !== undefined ? dev.device_id : index),
        model: formatGpuModel(dev.model || dev.name || `GPU #${index}`),
        hashrate: hashrate,
        temp: temp,
        fan: fan,
        power: power
      };

      rig.gpus.push(gpu);

      if (temp > rig.max_temp) {
        rig.max_temp = temp;
      }
    });
  }

  // Find total hashrate
  if (typeof data.hashrate_total === 'number' && data.hashrate_total > 0) {
    rig.hashrate_total = data.hashrate_total;
  } else if (Array.isArray(data.algorithms)) {
    // Sum GPU total hashrate across all active algorithms
    let algoTotal = 0;
    data.algorithms.forEach(algo => {
      if (algo.hashrate && algo.hashrate.gpu && typeof algo.hashrate.gpu.total === 'number') {
        algoTotal += algo.hashrate.gpu.total;
      } else if (algo.hashrate && typeof algo.hashrate.total === 'number') {
        algoTotal += algo.hashrate.total;
      }
    });
    rig.hashrate_total = algoTotal;
  }

  // Fallback: sum individual parsed GPU hashrates
  if (rig.hashrate_total === 0) {
    rig.hashrate_total = rig.gpus.reduce((sum, g) => sum + g.hashrate, 0);
  }

  return rig;
}

// Format hashrate to human readable units (H/s, KH/s, MH/s, GH/s)
function formatHashrate(hashrate) {
  if (hashrate === 0 || !hashrate) return '0.00 H/s';
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  const i = Math.min(Math.floor(Math.log(hashrate) / Math.log(1000)), units.length - 1);
  const val = hashrate / Math.pow(1000, i);
  return `${val.toFixed(2)} ${units[i]}`;
}

// Format uptime (seconds to readable format)
function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  
  return parts.join(' ');
}

// Get CSS class for temperature values
function getTempClass(temp) {
  if (temp >= 78) return 'temp-hot';
  if (temp >= 68) return 'temp-warn';
  return 'temp-good';
}

// Get raw temp display text
function getTempSimpleClass(temp) {
  if (temp >= 78) return 'critical';
  if (temp >= 68) return 'warning';
  return 'normal';
}

// Clean CPU model name for clean display
function formatCpuModel(model) {
  if (!model) return 'CPU';
  return model
    .replace(/\(R\)|\(TM\)/gi, '')
    .replace(/CPU\s*@\s*[\d.]+GHz/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clean and shorten GPU model names (e.g., nvidia_geforce_rtx_3060_ti -> RTX 3060 Ti, nvidia_geforce_gtx_1660_super -> GTX 1660 Super)
function formatGpuModel(model) {
  if (!model) return 'GPU';
  let m = String(model).trim();

  // Strip brand prefixes like nvidia_geforce_, nvidia geforce, amd_radeon_, amd radeon
  m = m.replace(/^nvidia[_\s]+geforce[_\s]+/i, '');
  m = m.replace(/^amd[_\s]+radeon[_\s]+/i, '');
  m = m.replace(/^geforce[_\s]+/i, '');
  m = m.replace(/^radeon[_\s]+/i, '');
  m = m.replace(/^nvidia[_\s]+/i, '');
  m = m.replace(/^amd[_\s]+/i, '');

  // Replace underscores with spaces
  m = m.replace(/_/g, ' ');

  // Standardize capitalization of known GPU series and suffixes
  m = m
    .replace(/\brtx\b/gi, 'RTX')
    .replace(/\bgtx\b/gi, 'GTX')
    .replace(/\brx\b/gi, 'RX')
    .replace(/\bti\b/gi, 'Ti')
    .replace(/\bsuper\b/gi, 'Super')
    .replace(/\bxt\b/gi, 'XT')
    .replace(/\s+/g, ' ')
    .trim();

  return m || model;
}

// Update the full interface DOM
function updateUI(rigs) {
  if (!Array.isArray(rigs) || rigs.length === 0) {
    rigsGrid.innerHTML = `
      <div class="glass-panel" style="grid-column: 1 / -1; padding: 3rem; text-align: center;">
        <div style="font-size: 1.25rem; font-weight: 500; margin-bottom: 0.5rem;">No Rigs Configured</div>
        <p style="font-size: 0.85rem; color: var(--text-muted);">Please configure RIG_IPS in environment variables.</p>
      </div>
    `;
    return;
  }

  // Calculate summary metrics
  const totalRigsCount = rigs.length;
  const onlineRigsCount = rigs.filter(r => r.status === 'online').length;
  const totalHashrateVal = rigs.reduce((sum, r) => sum + (r.status === 'online' ? r.hashrate_total : 0), 0);
  const maxTemperatureVal = rigs.reduce((max, r) => r.status === 'online' && r.max_temp > max ? r.max_temp : max, 0);
  const totalGpusCount = rigs.reduce((sum, r) => sum + (r.status === 'online' && r.gpus ? r.gpus.length : 0), 0);

  // Render overview cards
  elRigsOnline.textContent = `${onlineRigsCount} / ${totalRigsCount}`;
  elTotalHashrate.textContent = formatHashrate(totalHashrateVal);
  elMaxTemp.textContent = `${maxTemperatureVal}°C`;
  
  // Highlight Max Temp card if critical
  const maxTempCard = document.getElementById('card-max-temp');
  if (maxTemperatureVal >= 78) {
    maxTempCard.style.borderColor = 'var(--color-offline)';
    maxTempCard.querySelector('.summary-value').style.color = 'var(--color-offline)';
  } else if (maxTemperatureVal >= 68) {
    maxTempCard.style.borderColor = 'var(--color-warning)';
    maxTempCard.querySelector('.summary-value').style.color = 'var(--color-warning)';
  } else {
    maxTempCard.style.borderColor = 'var(--panel-border)';
    maxTempCard.querySelector('.summary-value').style.color = 'var(--text-primary)';
  }

  elTotalGpus.textContent = totalGpusCount;
  badgeTotalRigs.textContent = `${totalRigsCount} Rigs`;

  // Render Rig grid cards
  rigsGrid.innerHTML = '';
  
  rigs.forEach(rig => {
    const isOnline = rig.status === 'online';
    const rigId = `rig-${rig.name.replace(/\s+/g, '-').toLowerCase()}`;
    const card = document.createElement('article');
    card.className = `rig-card glass-panel ${isOnline ? '' : 'offline-rig'}`;
    card.id = `rig-card-${rig.name.replace(/\s+/g, '-').toLowerCase()}`;
    
    // CPU info & temperature row under PC/rig name
    let cpuRowHtml = '';
    if (isOnline && (rig.cpu_model || rig.cpu_temp !== null)) {
      const cleanCpu = formatCpuModel(rig.cpu_model);
      if (typeof rig.cpu_temp === 'number') {
        const cpuTempClass = getTempClass(rig.cpu_temp);
        cpuRowHtml = `
          <div class="rig-cpu-info">
            <span class="cpu-chip-badge" title="${rig.cpu_model || 'CPU'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
              <span>${cleanCpu}</span>
            </span>
            <span class="cpu-temp-badge ${cpuTempClass}">
              <span>${rig.cpu_temp}°C</span>
            </span>
          </div>
        `;
      } else {
        cpuRowHtml = `
          <div class="rig-cpu-info" title="SRBMiner-Multi API only reports GPU temperatures. CPU sensor temperature is not provided by the miner.">
            <span class="cpu-chip-badge" title="${rig.cpu_model || 'CPU'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
              <span>${cleanCpu}</span>
            </span>
            <span class="cpu-temp-badge na">
              <span>CPU Temp: N/A</span>
            </span>
          </div>
        `;
      }
    }

    // Core Card HTML structure
    let cardInnerHtml = `
      <div class="rig-header">
        <div class="rig-info">
          <div class="rig-name-row">
            <a href="#/rig/${encodeURIComponent(rig.name)}" class="rig-title-link" title="Open ${rig.name} dedicated page">
              <h3 class="rig-name">${rig.name}</h3>
              <svg class="rig-title-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </a>
            <div class="rig-badges-group">
              <span class="coin-badge ${rig.coin_key || 'pearl'}" title="Mining ${rig.coin_name || 'Pearl'} (${rig.algorithm || 'Pearl'})">
                <span class="coin-badge-dot"></span>
                ${rig.coin_name || 'Pearl'}
              </span>
              <span class="rig-badge ${isOnline ? 'online' : 'offline'}">
                <span class="status-dot" style="background: ${isOnline ? 'var(--color-online)' : 'var(--color-offline)'}; box-shadow: 0 0 6px ${isOnline ? 'var(--color-online)' : 'var(--color-offline)'}; margin-right: 0.1rem;"></span>
                ${rig.status}
              </span>
            </div>
          </div>
          ${cpuRowHtml}
          <span class="rig-ip">${rig.ip}</span>
          ${isOnline ? `<div class="rig-meta"><span>v${rig.version}</span> &bull; <span>Up: ${formatUptime(rig.uptime)}</span>${rig.pool ? ` &bull; <span title="Pool: ${rig.pool}">Pool: ${rig.pool.split(':')[0]}</span>` : ''}</div>` : ''}
        </div>
      </div>
    `;

    if (isOnline) {
      const tempClass = getTempSimpleClass(rig.max_temp);
      const totalPower = rig.gpus.reduce((sum, g) => sum + g.power, 0);
      const gpusListId = `gpus-list-${rigId}`;

      // Always render a placeholder container for per-rig economics
      // This will be populated dynamically by updateEconomics once marketData is fetched
      let rigEconomicsHtml = `<div class="rig-economics-wrapper" id="econ-wrapper-${rigId}"></div>`;

      cardInnerHtml += `
        <div class="rig-quick-stats">
          <div class="quick-stat-box">
            <span class="quick-stat-label">Rig Hashrate</span>
            <span class="quick-stat-value hashrate">${formatHashrate(rig.hashrate_total)}</span>
            <span class="quick-stat-sub">${rig.algorithm || 'Pearl'}</span>
          </div>
          <div class="quick-stat-box">
            <span class="quick-stat-label">Max GPU Temp</span>
            <span class="quick-stat-value temp ${tempClass}">${rig.max_temp}°C</span>
          </div>
          <div class="quick-stat-box">
            <span class="quick-stat-label">Total Power</span>
            <span class="quick-stat-value" style="color: var(--color-warning);">${totalPower}W</span>
          </div>
          <div class="quick-stat-box">
            <span class="quick-stat-label">GPUs</span>
            <span class="quick-stat-value" style="color: var(--color-neon-purple);">${rig.gpus.length}</span>
          </div>
        </div>

        ${rigEconomicsHtml}

        <button class="gpus-toggle-btn" onclick="toggleGpuList('${gpusListId}', this)" aria-expanded="false">
          <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          <span>Show GPUs</span>
        </button>

        <div class="gpus-list collapsed" id="${gpusListId}">
      `;

      if (Array.isArray(rig.gpus) && rig.gpus.length > 0) {
        rig.gpus.forEach(gpu => {
          const gpuTempClass = getTempClass(gpu.temp);
          cardInnerHtml += `
            <div class="gpu-item">
              <div class="gpu-name-info">
                <span class="gpu-index-name">GPU #${gpu.id}</span>
                <span class="gpu-model-detail" title="${gpu.model}">${gpu.model}</span>
              </div>
              <div class="gpu-stat-col">
                <span class="gpu-stat-label">Temp</span>
                <span class="gpu-stat-val ${gpuTempClass}">${gpu.temp}°C</span>
              </div>
              <div class="gpu-stat-col">
                <span class="gpu-stat-label">Fan</span>
                <span class="gpu-stat-val" style="color: var(--text-primary);">${gpu.fan}%</span>
              </div>
              <div class="gpu-stat-col">
                <span class="gpu-stat-label">Power</span>
                <span class="gpu-stat-val" style="color: var(--color-warning);">${gpu.power}W</span>
              </div>
              <div class="gpu-stat-col">
                <span class="gpu-stat-label">Hashrate</span>
                <span class="gpu-stat-val" style="color: var(--color-neon-blue);">${formatHashrate(gpu.hashrate).split(' ')[0]} <span style="font-size:0.65rem; color:var(--text-muted);">${formatHashrate(gpu.hashrate).split(' ')[1]}</span></span>
              </div>
            </div>
          `;
        });
      } else {
        cardInnerHtml += `<div style="text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">No GPU devices reported</div>`;
      }

      cardInnerHtml += `</div>`;
    } else {
      // Offline state presentation
      cardInnerHtml += `
        <div class="error-message-box">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div>
            <strong style="display: block; font-weight: 600; margin-bottom: 0.15rem; color: #fff;">Unreachable Rig</strong>
            <span>${rig.error || 'Connection timed out. Checking network routes.'}</span>
          </div>
        </div>
      `;
    }

    card.innerHTML = cardInnerHtml;
    rigsGrid.appendChild(card);
  });
}

// Toggle GPU list visibility
function toggleGpuList(listId, btn) {
  const list = document.getElementById(listId);
  if (!list) return;
  const isCollapsed = list.classList.contains('collapsed');
  if (isCollapsed) {
    list.classList.remove('collapsed');
    btn.setAttribute('aria-expanded', 'true');
    btn.querySelector('span').textContent = 'Hide GPUs';
    btn.querySelector('.chevron-icon').style.transform = 'rotate(180deg)';
  } else {
    list.classList.add('collapsed');
    btn.setAttribute('aria-expanded', 'false');
    btn.querySelector('span').textContent = 'Show GPUs';
    btn.querySelector('.chevron-icon').style.transform = 'rotate(0deg)';
  }
}

// =============================================
// Market Data — fetched via server-side proxy
// =============================================

async function fetchMarket() {
  if (isFetchingMarket) return;
  isFetchingMarket = true;

  try {
    const res = await fetch('/api/market');
    if (!res.ok) throw new Error(`Market API error: ${res.status}`);
    const data = await res.json();
    marketData = data;

    // Immediately update economics if rig data is already loaded
    if (lastRigResults && Array.isArray(lastRigResults)) {
      updateEconomics(lastRigResults);
      handleRoute();
    }
  } catch (err) {
    console.warn('Could not fetch market data:', err.message);
    // If we have no market data at all, reflect in badge
    if (!marketData) {
      elEconBadge.textContent = 'Market data offline (retrying...)';
    }
  } finally {
    isFetchingMarket = false;
  }
}

// =============================================
// Economics — Revenue / Cost / Profit (THB/day)
// =============================================
// Revenue  = btc_revenue_per_1000ths (BTC/day for 1000 TH/s)
//            × (totalHashrate / 1000 TH/s)
//            × btc_thb
// Cost     = totalPower (W) / 1000 × 24h × 4.5 THB/kWh
// Profit   = Revenue − Cost

const ELECTRICITY_RATE_THB_PER_KWH = 4.5;

function updateEconomics(rigs) {
  if (Array.isArray(rigs)) {
    lastRigResults = rigs;
  } else {
    rigs = lastRigResults || [];
  }

  const fmt = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Total hashrate across all online rigs (in H/s)
  const totalHashrateHs = rigs.reduce((sum, r) => sum + (r.status === 'online' ? (r.hashrate_total || 0) : 0), 0);

  // Total power across all online rigs (in Watts)
  const totalPowerW = rigs.reduce((sum, r) => {
    if (r.status !== 'online' || !Array.isArray(r.gpus)) return sum;
    return sum + r.gpus.reduce((s, g) => s + (g.power || 0), 0);
  }, 0);

  // Cost (THB / day): W → kW, × 24h, × rate
  // This is ALWAYS calculated from telemetry, regardless of market API status
  const costTHB = (totalPowerW / 1000) * 24 * ELECTRICITY_RATE_THB_PER_KWH;

  // Update Cost card
  elCost.textContent = `฿${fmt(costTHB)}`;
  elCostKwh.textContent = `${(totalPowerW / 1000).toFixed(2)} kW × 24h × ฿${ELECTRICITY_RATE_THB_PER_KWH}/kWh`;

  // Wait for market data — if not yet loaded, trigger fetch once without recursive loop
  if (!marketData) {
    if (!isFetchingMarket) {
      fetchMarket();
    }
    elRevenue.textContent = '— ฿';
    elRevenueBtc.textContent = 'Awaiting market rates...';
    elProfit.textContent = '— ฿';
    elProfit.classList.remove('negative');
    elProfitNote.textContent = 'Awaiting market data';
    elEconBadge.textContent = 'Connecting to Market...';
    return;
  }

  const btc_thb = Number(marketData.btc_thb) || 2800000;
  const btc_source = marketData.btc_source || 'Bitkub';
  const is_stale = Boolean(marketData.is_stale);

  let totalRevenueTHB = 0;
  let totalBtcPerDay = 0;
  const activeCoinsSet = new Set();

  // Calculate per-rig economics using each rig's detected coin
  rigs.forEach(rig => {
    if (rig.status !== 'online') return;

    // Find coin economics from multi-coin marketData
    const coinKey = rig.coin_key || 'pearl';
    const coinData = marketData.coins?.[coinKey] || (coinKey === 'quantus' ? marketData.coins?.quantus : marketData.coins?.pearl);

    let btcPerHs = 0;
    if (coinData && typeof coinData.btc_per_h_s === 'number' && coinData.btc_per_h_s > 0) {
      btcPerHs = coinData.btc_per_h_s;
    } else if (coinKey === 'quantus') {
      // Fallback: Quantus 473 WTM ~0.00012 BTC for 1000 MH/s (1e9 H/s)
      btcPerHs = 0.00012035 / 1e9;
    } else {
      // Fallback: Pearl 469 WTM ~0.00033 BTC for 1000 TH/s (1e15 H/s)
      btcPerHs = (marketData.btc_revenue_per_1000ths || 0.00032183) / 1e15;
    }

    const rigBtcDay = (rig.hashrate_total || 0) * btcPerHs;
    const rigRevenue = rigBtcDay * btc_thb;
    const rigPower = (rig.gpus || []).reduce((sum, g) => sum + (g.power || 0), 0);
    const rigCost = (rigPower / 1000) * 24 * ELECTRICITY_RATE_THB_PER_KWH;
    const rigProfit = rigRevenue - rigCost;

    totalBtcPerDay += rigBtcDay;
    totalRevenueTHB += rigRevenue;
    activeCoinsSet.add(rig.coin_name || 'Pearl');

    const rigId = `rig-${rig.name.replace(/\s+/g, '-').toLowerCase()}`;
    const wrapper = document.getElementById(`econ-wrapper-${rigId}`);
    if (wrapper) {
      const profitColor = rigProfit >= 0 ? 'var(--color-online)' : 'var(--color-offline)';
      wrapper.innerHTML = `
        <div class="rig-economics-row">
          <div class="rig-econ-item">
            <span class="rig-econ-label">Revenue/day</span>
            <span class="rig-econ-val" style="color: var(--color-online);">฿${fmt0(rigRevenue)}</span>
          </div>
          <div class="rig-econ-item">
            <span class="rig-econ-label">Cost/day</span>
            <span class="rig-econ-val" style="color: var(--color-warning);">฿${fmt0(rigCost)}</span>
          </div>
          <div class="rig-econ-item">
            <span class="rig-econ-label">Profit/day</span>
            <span class="rig-econ-val" style="color: ${profitColor};">${rigProfit >= 0 ? '' : '−'}฿${fmt0(Math.abs(rigProfit))}</span>
          </div>
        </div>
      `;
    }
  });

  // Global profit across all rigs
  const profitTHB = totalRevenueTHB - costTHB;

  // Update Revenue card
  elRevenue.textContent = `฿${fmt(totalRevenueTHB)}`;
  elRevenueBtc.textContent = `${totalBtcPerDay.toFixed(8)} BTC/day  ·  1 BTC = ฿${Number(btc_thb).toLocaleString('th-TH')}`;

  // Update Profit card
  elProfit.textContent = `${profitTHB >= 0 ? '' : '−'}฿${fmt(Math.abs(profitTHB))}`;
  elProfit.classList.toggle('negative', profitTHB < 0);
  elProfitNote.textContent = profitTHB >= 0 ? 'After electricity cost' : 'Operating at a loss';

  // Update badge with active coins
  const activeCoinsList = Array.from(activeCoinsSet);
  const coinsText = activeCoinsList.length > 0 ? activeCoinsList.join(' & ') : 'Multi-coin';
  const sourceText = `WhatToMine + ${btc_source || 'Bitkub'}`;
  const staleTag = is_stale ? ' · (Cached)' : '';
  elEconBadge.textContent = `${coinsText} · ${sourceText}${staleTag}`;
}

// =============================================
// Router & Dedicated Rig Page View
// =============================================

function handleRoute() {
  const hash = window.location.hash || '';
  const match = hash.match(/^#\/rig\/(.+)$/);
  const isTestRoute = (hash === '#/test-rig' || hash === '#/test');

  const dashboardView = document.getElementById('view-dashboard');
  const rigDetailView = document.getElementById('view-rig-detail');
  const btnTestRigEl = document.getElementById('btn-test-rig');

  if (!dashboardView || !rigDetailView) return;

  if (isTestRoute) {
    if (btnTestRigEl) btnTestRigEl.classList.add('active');
    dashboardView.classList.add('hidden');
    rigDetailView.classList.remove('hidden');
    renderRigDetailView('test-rig', true);
  } else if (match) {
    const rawId = decodeURIComponent(match[1]);
    const isTestMatch = (
      rawId.toLowerCase() === 'test-rig' ||
      rawId.toLowerCase() === 'shiraga' ||
      rawId.includes('192.168.1.157')
    );
    if (btnTestRigEl) {
      if (isTestMatch) btnTestRigEl.classList.add('active');
      else btnTestRigEl.classList.remove('active');
    }
    dashboardView.classList.add('hidden');
    rigDetailView.classList.remove('hidden');
    renderRigDetailView(rawId, isTestMatch);
  } else {
    if (btnTestRigEl) btnTestRigEl.classList.remove('active');
    dashboardView.classList.remove('hidden');
    rigDetailView.classList.add('hidden');
  }
}

function renderRigDetailView(rawId, isTestRig = false) {
  const container = document.getElementById('view-rig-detail');
  if (!container) return;

  let rig = null;

  if (isTestRig || rawId === 'test-rig') {
    isTestRig = true;
    if (!testRigResult) {
      container.innerHTML = `
        <div class="detail-view-container">
          <div class="detail-top-bar">
            <div class="detail-nav-left">
              <a href="#/" class="btn-back">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>Back to Dashboard</span>
              </a>
            </div>
          </div>
          <div class="glass-panel" style="padding: 4rem 2rem; text-align: center;">
            <div class="status-dot loading" style="width: 14px; height: 14px; margin: 0 auto 1.25rem auto;"></div>
            <h3 style="color: #fff; font-size: 1.4rem; font-weight: 600; margin-bottom: 0.5rem;">Loading Test Rig Details...</h3>
            <p style="color: var(--text-muted); font-size: 0.85rem;">Retrieving telemetry for Test Rig (${testRigIp})</p>
          </div>
        </div>
      `;
      return;
    }
    rig = testRigResult;
  } else {
    // 1. If rigs are still fetching on cold boot
    if (!lastRigResults) {
      container.innerHTML = `
        <div class="detail-view-container">
          <div class="detail-top-bar">
            <div class="detail-nav-left">
              <a href="#/" class="btn-back">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <span>Back to Dashboard</span>
              </a>
            </div>
          </div>
          <div class="glass-panel" style="padding: 4rem 2rem; text-align: center;">
            <div class="status-dot loading" style="width: 14px; height: 14px; margin: 0 auto 1.25rem auto;"></div>
            <h3 style="color: #fff; font-size: 1.4rem; font-weight: 600; margin-bottom: 0.5rem;">Loading Rig Details...</h3>
            <p style="color: var(--text-muted); font-size: 0.85rem;">Retrieving telemetry for ${rawId}</p>
          </div>
        </div>
      `;
      return;
    }

    // 2. Find matching rig by name or IP
    const query = rawId.toLowerCase().trim();
    rig = lastRigResults.find(r => 
      r.name.toLowerCase() === query || 
      r.ip.toLowerCase() === query ||
      r.name.toLowerCase().replace(/\s+/g, '-') === query
    );

    // If not found in production rigs, check if it matches test rig
    if (!rig && testRigResult) {
      if (
        testRigResult.name.toLowerCase() === query ||
        testRigResult.ip.toLowerCase() === query ||
        testRigResult.ip.toLowerCase().includes(query) ||
        testRigResult.name.toLowerCase().replace(/\s+/g, '-') === query
      ) {
        rig = testRigResult;
        isTestRig = true;
      }
    }
  }

  if (!rig) {
    container.innerHTML = `
      <div class="detail-view-container">
        <div class="detail-top-bar">
          <div class="detail-nav-left">
            <a href="#/" class="btn-back">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back to Dashboard</span>
            </a>
          </div>
        </div>
        <div class="glass-panel" style="padding: 4rem 2rem; text-align: center;">
          <h3 style="color: var(--color-offline); font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">Rig Not Found</h3>
          <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.9rem;">
            No rig configuration matches "<strong>${rawId}</strong>".
          </p>
          <a href="#/" class="btn-back" style="display: inline-flex;">← Return to All Rigs</a>
        </div>
      </div>
    `;
    return;
  }

  const isOnline = rig.status === 'online';
  const cleanCpu = formatCpuModel(rig.cpu_model);
  const totalPower = isOnline && Array.isArray(rig.gpus) ? rig.gpus.reduce((sum, g) => sum + (g.power || 0), 0) : 0;
  const avgTemp = isOnline && Array.isArray(rig.gpus) && rig.gpus.length > 0 
    ? Math.round(rig.gpus.reduce((sum, g) => sum + (g.temp || 0), 0) / rig.gpus.length) 
    : 0;

  // External web API link
  const targetIp = rig.ip.includes(':') ? rig.ip : `${rig.ip}:21550`;
  const rigWebUrl = targetIp.startsWith('http') ? targetIp : `http://${targetIp}`;

  // Economics computation for this rig
  const fmt = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  let econHtml = '';
  if (isOnline) {
    const costTHB = (totalPower / 1000) * 24 * ELECTRICITY_RATE_THB_PER_KWH;
    let revDisplay = '— ฿';
    let revSub = 'Awaiting market rates...';
    let profitDisplay = '— ฿';
    let profitClass = '';
    let profitSub = 'Awaiting market data';
    let monthlyProjection = '— ฿';

    if (marketData) {
      const btc_thb = Number(marketData.btc_thb) || 2800000;
      const coinKey = rig.coin_key || 'pearl';
      const coinData = marketData.coins?.[coinKey] || (coinKey === 'quantus' ? marketData.coins?.quantus : marketData.coins?.pearl);

      let btcPerHs = 0;
      if (coinData && typeof coinData.btc_per_h_s === 'number' && coinData.btc_per_h_s > 0) {
        btcPerHs = coinData.btc_per_h_s;
      } else if (coinKey === 'quantus') {
        btcPerHs = 0.00012035 / 1e9;
      } else {
        btcPerHs = (marketData.btc_revenue_per_1000ths || 0.00032183) / 1e15;
      }

      const btcPerDay = (rig.hashrate_total || 0) * btcPerHs;
      const revenueTHB = btcPerDay * btc_thb;
      const profitTHB = revenueTHB - costTHB;
      const monthlyProfit = profitTHB * 30;

      revDisplay = `฿${fmt(revenueTHB)}`;
      revSub = `${btcPerDay.toFixed(8)} BTC/day (${rig.coin_name || 'Pearl'})`;
      profitDisplay = `${profitTHB >= 0 ? '' : '−'}฿${fmt(Math.abs(profitTHB))}`;
      profitClass = profitTHB < 0 ? 'negative' : '';
      profitSub = profitTHB >= 0 ? 'Net profit after power' : 'Operating at a loss';
      monthlyProjection = `${monthlyProfit >= 0 ? '' : '−'}฿${fmt0(Math.abs(monthlyProfit))} / mo`;
    }

    econHtml = `
      <section class="detail-econ-container" aria-label="Rig Economics">
        <div class="detail-section-title">
          <h3>Rig Economics</h3>
          <span style="font-size: 0.8rem; color: var(--text-muted);">Est. daily yields for ${rig.name} (${rig.coin_name || 'Pearl'} · ${rig.algorithm || 'Pearl'})</span>
        </div>
        <div class="detail-econ-grid">
          <div class="detail-econ-card glass-panel revenue">
            <div class="detail-econ-header">
              <span class="detail-econ-label">Est. Daily Revenue</span>
              <span style="color: var(--color-online); font-size: 1.25rem;">฿</span>
            </div>
            <div class="detail-econ-val revenue">${revDisplay}</div>
            <div class="detail-econ-sub">${revSub}</div>
          </div>

          <div class="detail-econ-card glass-panel cost">
            <div class="detail-econ-header">
              <span class="detail-econ-label">Est. Daily Cost</span>
              <span style="color: var(--color-warning); font-size: 1.25rem;">⚡</span>
            </div>
            <div class="detail-econ-val cost">฿${fmt(costTHB)}</div>
            <div class="detail-econ-sub">${(totalPower / 1000).toFixed(2)} kW × 24h × ฿${ELECTRICITY_RATE_THB_PER_KWH}/kWh</div>
          </div>

          <div class="detail-econ-card glass-panel profit ${profitClass}">
            <div class="detail-econ-header">
              <span class="detail-econ-label">Est. Daily Profit</span>
              <span style="font-size: 1.25rem;">📈</span>
            </div>
            <div class="detail-econ-val profit ${profitClass}">${profitDisplay}</div>
            <div class="detail-econ-sub">${profitSub} (${monthlyProjection})</div>
          </div>
        </div>
      </section>
    `;
  }

  // CPU badge HTML
  let cpuBadgeHtml = '';
  if (isOnline && (rig.cpu_model || rig.cpu_temp !== null)) {
    const cpuTempClass = rig.cpu_temp !== null ? getTempClass(rig.cpu_temp) : 'na';
    const cpuTempText = rig.cpu_temp !== null ? `${rig.cpu_temp}°C` : 'N/A';
    cpuBadgeHtml = `
      <div class="detail-hero-pill" title="${rig.cpu_model || 'CPU'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>
        </svg>
        <span>${cleanCpu}</span>
        <span class="cpu-temp-badge ${cpuTempClass}" style="margin-left: 0.25rem; padding: 0.15rem 0.4rem;">${cpuTempText}</span>
      </div>
    `;
  }

  // Build Online / Offline content
  let bodyContent = '';
  if (isOnline) {
    const tempClass = getTempSimpleClass(rig.max_temp);
    const efficiency = totalPower > 0 ? (rig.hashrate_total / totalPower).toFixed(1) : '—';

    // Build GPU cards HTML
    let gpusHtml = '';
    if (Array.isArray(rig.gpus) && rig.gpus.length > 0) {
      rig.gpus.forEach((gpu, index) => {
        let tempFillClass = 'good';
        if (gpu.temp >= 78) tempFillClass = 'hot';
        else if (gpu.temp >= 68) tempFillClass = 'warn';

        const tempPercent = Math.min(100, Math.max(0, Math.round((gpu.temp / 90) * 100)));
        const fanPercent = Math.min(100, Math.max(0, gpu.fan));
        const gpuShare = rig.hashrate_total > 0 ? ((gpu.hashrate / rig.hashrate_total) * 100).toFixed(1) : '0.0';
        const gpuEff = gpu.power > 0 ? (gpu.hashrate / gpu.power).toFixed(1) : '—';

        gpusHtml += `
          <div class="detail-gpu-card glass-panel">
            <div class="detail-gpu-top">
              <div class="detail-gpu-identity">
                <span class="detail-gpu-badge">GPU #${gpu.id !== undefined ? gpu.id : index}</span>
                <h4 class="detail-gpu-model" title="${gpu.model}">${gpu.model}</h4>
              </div>
              <div class="detail-gpu-hashrate-box">
                <div class="detail-gpu-hashrate-val">${formatHashrate(gpu.hashrate)}</div>
                <div class="detail-gpu-hashrate-sub">${gpuShare}% of rig</div>
              </div>
            </div>

            <div class="detail-gpu-meters">
              <div class="meter-row">
                <div class="meter-label-row">
                  <span class="meter-label">Temperature</span>
                  <span class="meter-val ${getTempClass(gpu.temp)}">${gpu.temp}°C</span>
                </div>
                <div class="meter-track">
                  <div class="meter-fill ${tempFillClass}" style="width: ${tempPercent}%;"></div>
                </div>
              </div>

              <div class="meter-row">
                <div class="meter-label-row">
                  <span class="meter-label">Fan Speed</span>
                  <span class="meter-val" style="color: var(--color-neon-blue);">${gpu.fan}%</span>
                </div>
                <div class="meter-track">
                  <div class="meter-fill fan" style="width: ${fanPercent}%;"></div>
                </div>
              </div>
            </div>

            <div class="detail-gpu-footer">
              <div class="gpu-stat-pill">
                <span>Power:</span>
                <strong style="color: var(--color-warning);">${gpu.power}W</strong>
              </div>
              <div class="gpu-stat-pill">
                <span>Efficiency:</span>
                <strong style="color: var(--color-online);">${gpuEff} H/W</strong>
              </div>
            </div>
          </div>
        `;
      });
    } else {
      gpusHtml = `<div class="glass-panel" style="grid-column: 1 / -1; padding: 2.5rem; text-align: center; color: var(--text-muted);">No GPU devices reported by SRBMiner</div>`;
    }

    bodyContent = `
      <!-- KPI Cards -->
      <section class="detail-kpi-grid" aria-label="Rig KPIs">
        <div class="detail-kpi-card glass-panel">
          <div class="detail-kpi-icon hashrate">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </div>
          <div class="detail-kpi-info">
            <span class="detail-kpi-label">Rig Hashrate</span>
            <span class="detail-kpi-val" style="color: var(--color-neon-blue);">${formatHashrate(rig.hashrate_total)}</span>
            <span class="detail-kpi-sub">${rig.coin_name || 'Pearl'} (${rig.algorithm || 'Pearl'}) Algorithm</span>
          </div>
        </div>

        <div class="detail-kpi-card glass-panel">
          <div class="detail-kpi-icon power">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
          </div>
          <div class="detail-kpi-info">
            <span class="detail-kpi-label">Total Power</span>
            <span class="detail-kpi-val" style="color: var(--color-warning);">${totalPower}W</span>
            <span class="detail-kpi-sub">${efficiency} H/W Efficiency</span>
          </div>
        </div>

        <div class="detail-kpi-card glass-panel">
          <div class="detail-kpi-icon temp">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
            </svg>
          </div>
          <div class="detail-kpi-info">
            <span class="detail-kpi-label">Thermal Status</span>
            <span class="detail-kpi-val ${getTempClass(rig.max_temp)}">${rig.max_temp}°C <span style="font-size: 0.9rem; font-weight: 500; color: var(--text-muted);">Max</span></span>
            <span class="detail-kpi-sub">Average: ${avgTemp}°C</span>
          </div>
        </div>

        <div class="detail-kpi-card glass-panel">
          <div class="detail-kpi-icon gpus">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            </svg>
          </div>
          <div class="detail-kpi-info">
            <span class="detail-kpi-label">GPU Devices</span>
            <span class="detail-kpi-val" style="color: var(--color-neon-purple);">${rig.gpus ? rig.gpus.length : 0}</span>
            <span class="detail-kpi-sub">All reporting active</span>
          </div>
        </div>
      </section>

      <!-- Rig Economics -->
      ${econHtml}

      <!-- GPUs Section -->
      <section class="detail-gpus-container" aria-label="GPU Hardware">
        <div class="detail-section-title">
          <h3>GPU Hardware Telemetry</h3>
          <span style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">${rig.gpus ? rig.gpus.length : 0} GPUs</span>
        </div>
        <div class="detail-gpus-grid">
          ${gpusHtml}
        </div>
      </section>
    `;
  } else {
    // Offline Presentation
    bodyContent = `
      <div class="detail-offline-panel glass-panel">
        <div class="detail-offline-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h3 class="detail-offline-title">Rig Unreachable</h3>
        <p class="detail-offline-desc">
          The monitor could not connect to <strong>${rig.ip}</strong>.<br>
          <span style="color: var(--color-offline);">${rig.error || 'Connection timed out or host unreachable.'}</span>
        </p>
        <button class="btn-retry" onclick="fetchStats(); fetchMarket();">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          <span>Retry Connection</span>
        </button>
      </div>
    `;
  }

  const testBannerHtml = isTestRig ? `
    <div class="test-rig-banner">
      <div class="test-rig-banner-icon">🧪</div>
      <div class="test-rig-banner-content">
        <div class="test-rig-banner-title"><span>Isolated Test Rig</span> (${rig.name} &bull; ${rig.ip})</div>
        <div class="test-rig-banner-desc">This machine is monitored independently for testing purposes. It is strictly excluded from the main dashboard overview cards, network hashrate, and daily economics calculations.</div>
      </div>
    </div>
  ` : '';

  const testRigBadgeHtml = isTestRig ? `<span class="test-rig-badge">🧪 Test Rig</span>` : '';

  container.innerHTML = `
    <div class="detail-view-container">
      <!-- Navigation Bar -->
      <div class="detail-top-bar">
        <div class="detail-nav-left">
          <a href="#/" class="btn-back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>Back to Dashboard</span>
          </a>
          <div class="detail-breadcrumb">
            <a href="#/">Dashboard</a>
            <span>/</span>
            <span class="detail-breadcrumb-current">${isTestRig ? `Test Rig (${rig.name})` : rig.name}</span>
          </div>
        </div>
      </div>

      ${testBannerHtml}

      <!-- Rig Hero Panel -->
      <div class="detail-hero-panel glass-panel ${isOnline ? '' : 'offline-rig'}">
        <div class="detail-hero-left">
          <div class="detail-hero-title-row">
            <h2 class="detail-hero-name">${rig.name}</h2>
            ${testRigBadgeHtml}
            <span class="rig-badge ${isOnline ? 'online' : 'offline'}">
              <span class="status-dot" style="background: ${isOnline ? 'var(--color-online)' : 'var(--color-offline)'}; box-shadow: 0 0 6px ${isOnline ? 'var(--color-online)' : 'var(--color-offline)'}; margin-right: 0.1rem;"></span>
              ${rig.status}
            </span>
          </div>
          <div class="detail-hero-meta">
            <span class="detail-hero-pill coin-pill ${rig.coin_key || 'pearl'}">${rig.coin_name || 'Pearl'} (${rig.algorithm || 'Pearl'})</span>
            <span class="detail-hero-pill ip-pill">${rig.ip}</span>
            ${isOnline ? `<span class="detail-hero-pill">v${rig.version}</span>` : ''}
            ${isOnline ? `<span class="detail-hero-pill">Up: ${formatUptime(rig.uptime)}</span>` : ''}
            ${rig.pool ? `<span class="detail-hero-pill" title="Pool: ${rig.pool}">🌐 ${rig.pool}</span>` : ''}
            ${rig.shares ? `<span class="detail-hero-pill" title="Accepted / Rejected Shares">✅ ${rig.shares.accepted || 0} / ❌ ${rig.shares.rejected || 0}</span>` : ''}
            ${cpuBadgeHtml}
          </div>
        </div>
        <div class="detail-hero-right">
          <a href="${rigWebUrl}" target="_blank" rel="noopener noreferrer" class="btn-web-ui" title="Open SRBMiner web API interface directly in new tab">
            <span>Direct Web UI</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>
      </div>

      <!-- Main Body Content -->
      ${bodyContent}
    </div>
  `;
}

