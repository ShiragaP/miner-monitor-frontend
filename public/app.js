// SRBMiner Rig Monitor Frontend Script

// Global state
let countdownSeconds = 300;
let refreshIntervalId = null;
let countdownIntervalId = null;
let isFetching = false;
let marketData = null; // cached market data (btc_revenue_per_1000hs, btc_thb)

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
  fetchStats();
  fetchMarket();
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
    updateEconomics(results);
    
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
    uptime: data.mining_time !== undefined ? data.mining_time : (data.uptime || 0),
    hashrate_total: 0,
    max_temp: 0,
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
  try {
    const res = await fetch('/api/market');
    if (!res.ok) throw new Error(`Market API error: ${res.status}`);
    marketData = await res.json();
  } catch (err) {
    console.warn('Could not fetch market data:', err.message);
    marketData = null;
  }
}

// =============================================
// Economics — Revenue / Cost / Profit (THB/day)
// =============================================
// Revenue  = btc_revenue_per_1000hs (BTC/day for 1000 H/s)
//            × (totalHashrate / 1000)
//            × btc_thb
// Cost     = totalPower (W) / 1000 × 24h × 4.5 THB/kWh
// Profit   = Revenue − Cost

const ELECTRICITY_RATE_THB_PER_KWH = 4.5;

function updateEconomics(rigs) {
  // Wait for market data — if not yet loaded, fetch first then retry
  if (!marketData) {
    fetchMarket().then(() => updateEconomics(rigs));
    return;
  }

  const { btc_revenue_per_1000ths = 0, btc_thb = 0, coin_name = '', algorithm = '' } = marketData;

  // Total hashrate across all online rigs (in H/s)
  const totalHashrateHs = rigs.reduce((sum, r) => sum + (r.status === 'online' ? r.hashrate_total : 0), 0);

  // Total power across all online rigs (in Watts)
  const totalPowerW = rigs.reduce((sum, r) => {
    if (r.status !== 'online' || !Array.isArray(r.gpus)) return sum;
    return sum + r.gpus.reduce((s, g) => s + (g.power || 0), 0);
  }, 0);

  // Revenue (THB / day)
  // WhatToMine hr=1000 is in TH/s → btc_revenue covers 1,000 TH/s (= 1×10¹⁵ H/s)
  // Convert our H/s total → TH/s, then scale against the 1000-TH/s baseline
  const totalHashrateTHs = totalHashrateHs / 1e12;
  const btcPerDay = btc_revenue_per_1000ths * (totalHashrateTHs / 1000);
  const revenueTHB = btcPerDay * btc_thb;

  // Cost (THB / day): W → kW, × 24h, × rate
  const costTHB = (totalPowerW / 1000) * 24 * ELECTRICITY_RATE_THB_PER_KWH;

  // Profit
  const profitTHB = revenueTHB - costTHB;

  const fmt = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Update Revenue card
  elRevenue.textContent = `฿${fmt(revenueTHB)}`;
  elRevenueBtc.textContent = `${btcPerDay.toFixed(8)} BTC/day  ·  1 BTC = ฿${btc_thb.toLocaleString('th-TH')}`;

  // Update Cost card
  elCost.textContent = `฿${fmt(costTHB)}`;
  elCostKwh.textContent = `${(totalPowerW / 1000).toFixed(2)} kW × 24h × ฿${ELECTRICITY_RATE_THB_PER_KWH}/kWh`;

  // Update Profit card
  elProfit.textContent = `${profitTHB >= 0 ? '' : '−'}฿${fmt(Math.abs(profitTHB))}`;
  elProfit.classList.toggle('negative', profitTHB < 0);
  elProfitNote.textContent = profitTHB >= 0 ? 'After electricity cost' : 'Operating at a loss';

  // Update badge
  if (coin_name && algorithm) {
    elEconBadge.textContent = `${coin_name} · ${algorithm} · WhatToMine + CoinGecko`;
  } else {
    elEconBadge.textContent = 'WhatToMine + CoinGecko';
  }

  // Update per-rig economics placeholders in parallel
  rigs.forEach(rig => {
    if (rig.status !== 'online') return;
    
    const rigId = `rig-${rig.name.replace(/\s+/g, '-').toLowerCase()}`;
    const wrapper = document.getElementById(`econ-wrapper-${rigId}`);
    if (!wrapper) return;

    const rigPower = rig.gpus.reduce((sum, g) => sum + (g.power || 0), 0);
    const rigTHs = rig.hashrate_total / 1e12;
    const rigBtcDay = btc_revenue_per_1000ths * (rigTHs / 1000);
    const rigRevenue = rigBtcDay * btc_thb;
    const rigCost = (rigPower / 1000) * 24 * ELECTRICITY_RATE_THB_PER_KWH;
    const rigProfit = rigRevenue - rigCost;

    const fmtTHB = (n) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const profitColor = rigProfit >= 0 ? 'var(--color-online)' : 'var(--color-offline)';

    wrapper.innerHTML = `
      <div class="rig-economics-row">
        <div class="rig-econ-item">
          <span class="rig-econ-label">Revenue/day</span>
          <span class="rig-econ-val" style="color: var(--color-online);">฿${fmtTHB(rigRevenue)}</span>
        </div>
        <div class="rig-econ-item">
          <span class="rig-econ-label">Cost/day</span>
          <span class="rig-econ-val" style="color: var(--color-warning);">฿${fmtTHB(rigCost)}</span>
        </div>
        <div class="rig-econ-item">
          <span class="rig-econ-label">Profit/day</span>
          <span class="rig-econ-val" style="color: ${profitColor};">${rigProfit >= 0 ? '' : '−'}฿${fmtTHB(Math.abs(rigProfit))}</span>
        </div>
      </div>
    `;
  });
}
