// SRBMiner Rig Monitor Frontend Script

// Global state
let countdownSeconds = 10;
let refreshIntervalId = null;
let countdownIntervalId = null;
let isFetching = false;

// DOM Elements
const btnRefresh = document.getElementById('btn-refresh-stats');
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

// Initialize app
window.addEventListener('DOMContentLoaded', () => {
  fetchStats();
  startTimers();
  
  btnRefresh.addEventListener('click', () => {
    if (!isFetching) {
      fetchStats();
    }
  });
});

// Start auto-refresh and timer loops
function startTimers() {
  // Clear any existing intervals
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  if (countdownIntervalId) clearInterval(countdownIntervalId);

  countdownSeconds = 10;
  timerVal.textContent = `${countdownSeconds}s`;

  // Countdown timer loop (updates every second)
  countdownIntervalId = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      timerVal.textContent = 'Refreshing...';
    } else {
      timerVal.textContent = `${countdownSeconds}s`;
    }
  }, 1000);

  // Stats polling interval (every 10 seconds)
  refreshIntervalId = setInterval(() => {
    fetchStats();
  }, 10000);
}

// Reset timer state after fetch
function resetTimer() {
  countdownSeconds = 10;
  timerVal.textContent = `${countdownSeconds}s`;
  startTimers();
}

// Fetch stats from backend API
// Fetch config and query rigs directly from client browser
async function fetchStats() {
  isFetching = true;
  btnRefresh.classList.add('loading');
  headerStatusDot.className = 'status-dot loading';
  statusText.textContent = 'Updating...';

  try {
    // 1. Get the list of rig IPs from server config
    const configResponse = await fetch('/api/config');
    if (!configResponse.ok) {
      throw new Error(`Failed to load server config: ${configResponse.status}`);
    }
    const config = await configResponse.json();
    const rigsList = config.rigs || [];

    if (rigsList.length === 0) {
      updateUI([]);
      return;
    }

    // 2. Query each rig directly in parallel from the browser
    const fetchPromises = rigsList.map(async (ip) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5s timeout

      const url = ip.startsWith('http') ? ip : `http://${ip}`;
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
        return {
          ip,
          name: `Rig-${ip.split('.').pop().split(':')[0] || ip}`,
          status: 'offline',
          error: error.name === 'AbortError' ? 'Connection timed out' : error.message
        };
      }
    });

    const results = await Promise.all(fetchPromises);
    updateUI(results);
    
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
  const defaultName = `Rig-${ip.split('.').pop().split(':')[0] || ip}`;
  // Strictly use rig_name from JSON
  const name = data.rig_name || defaultName;

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

  const devices = data.gpu_devices || data.devices || data.gpus || [];

  if (Array.isArray(devices)) {
    devices.forEach((dev, index) => {
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

      if (temp > rig.max_temp) {
        rig.max_temp = temp;
      }
    });
  }

  if (typeof data.hashrate_total === 'number' && data.hashrate_total > 0) {
    rig.hashrate_total = data.hashrate_total;
  } else {
    rig.hashrate_total = rig.gpus.reduce((sum, g) => sum + g.hashrate, 0);
  }

  return rig;
}

// Format hashrate to human readable units (H/s, KH/s, MH/s, GH/s)
function formatHashrate(hashrate) {
  if (hashrate === 0 || !hashrate) return '0.00 H/s';
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s'];
  const i = Math.floor(Math.log(hashrate) / Math.log(1000));
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
    const card = document.createElement('article');
    card.className = `rig-card glass-panel ${isOnline ? '' : 'offline-rig'}`;
    card.id = `rig-card-${rig.name.replace(/\s+/g, '-').toLowerCase()}`;
    
    // Core Card HTML structure
    let cardInnerHtml = `
      <div class="rig-header">
        <div class="rig-info">
          <div class="rig-name-row">
            <h3 class="rig-name">${rig.name}</h3>
            <span class="rig-badge ${isOnline ? 'online' : 'offline'}">
              <span class="status-dot" style="background: ${isOnline ? 'var(--color-online)' : 'var(--color-offline)'}; box-shadow: 0 0 6px ${isOnline ? 'var(--color-online)' : 'var(--color-offline)'}; margin-right: 0.1rem;"></span>
              ${rig.status}
            </span>
          </div>
          <span class="rig-ip">${rig.ip}</span>
          ${isOnline ? `<div class="rig-meta"><span>v${rig.version}</span> &bull; <span>Up: ${formatUptime(rig.uptime)}</span></div>` : ''}
        </div>
      </div>
    `;

    if (isOnline) {
      // GPU statistics quick overview inside the card
      const tempClass = getTempSimpleClass(rig.max_temp);
      cardInnerHtml += `
        <div class="rig-quick-stats">
          <div class="quick-stat-box">
            <span class="quick-stat-label">Rig Hashrate</span>
            <span class="quick-stat-value hashrate">${formatHashrate(rig.hashrate_total)}</span>
          </div>
          <div class="quick-stat-box">
            <span class="quick-stat-label">Max GPU Temp</span>
            <span class="quick-stat-value temp ${tempClass}">${rig.max_temp}°C</span>
          </div>
        </div>

        <div class="gpus-list">
      `;

      // Render individual GPUs
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
