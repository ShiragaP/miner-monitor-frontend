require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 21551;

// Configurable Rig IPs (default list from user request)
const DEFAULT_RIGS = [
  '192.168.1.101:21550',
  '192.168.1.102:21550',
  '192.168.1.113:21550',
  '192.168.1.114:21550',
  '192.168.1.122:21550',
  '192.168.1.123:21550',
  '192.168.1.201:21550'
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

// ============================================================================
// Robust Market Data Proxy with Caching, Deduplication, and Fallbacks
// ============================================================================

const CACHE_FILE = path.join(__dirname, '.market_cache.json');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes fresh cache
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 60s cooldown if 429 received
const WTM_COIN_ID = process.env.WTM_COIN_ID || '469'; // Default: Pearl (469)

// Baseline fallback if WhatToMine / CoinGecko are unreachable on initial cold boot
const DEFAULT_FALLBACK_MARKET = {
  btc_revenue_per_1000ths: 0.00037648,
  coin_name: 'Pearl',
  algorithm: 'Pearl',
  btc_thb: 2700000,
  btc_source: 'Fallback',
  is_stale: true,
  cached_at: Date.now()
};

// Load persistent cache from disk on startup
let marketCache = null;
try {
  if (fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    marketCache = JSON.parse(raw);
    console.log(`[Market] Loaded persistent cache from disk (saved at ${new Date(marketCache.cached_at).toLocaleTimeString()})`);
  }
} catch (err) {
  console.warn('[Market] Could not load cache file:', err.message);
}

let lastWtm429Time = 0;
let inFlightMarketFetch = null;

function persistCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Market] Failed to write cache file:', err.message);
  }
}

// Fetch BTC price in THB with CoinGecko -> Bitkub fallback
async function fetchBtcThbPrice() {
  // 1. Primary: CoinGecko
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=thb', {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.bitcoin?.thb) {
        return { price: Number(data.bitcoin.thb), source: 'CoinGecko' };
      }
    } else {
      console.warn(`[Market] CoinGecko responded with status ${res.status}, trying fallback...`);
    }
  } catch (err) {
    console.warn('[Market] CoinGecko fetch failed:', err.message, '- trying Bitkub fallback...');
  }

  // 2. Secondary: Bitkub (Thailand's primary crypto exchange, direct THB ticker)
  try {
    const res = await fetch('https://api.bitkub.com/api/market/ticker', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      const bitkubPrice = data?.THB_BTC?.last;
      if (bitkubPrice) {
        return { price: Number(bitkubPrice), source: 'Bitkub' };
      }
    }
  } catch (err) {
    console.warn('[Market] Bitkub fallback fetch failed:', err.message);
  }

  // 3. Fallback to existing cache or baseline
  return {
    price: marketCache?.btc_thb || DEFAULT_FALLBACK_MARKET.btc_thb,
    source: 'Cached'
  };
}

// Fetch WhatToMine coin economics
async function fetchWhatToMineData() {
  // Cooldown check if previously rate-limited
  const timeSince429 = Date.now() - lastWtm429Time;
  if (timeSince429 < RATE_LIMIT_COOLDOWN_MS) {
    const remainingSec = Math.ceil((RATE_LIMIT_COOLDOWN_MS - timeSince429) / 1000);
    throw new Error(`WhatToMine cooling down after 429 (${remainingSec}s remaining)`);
  }

  const url = `https://whattomine.com/coins/${WTM_COIN_ID}.json?hr=1000&fee=3`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(7000)
  });

  if (res.status === 429) {
    lastWtm429Time = Date.now();
    throw new Error('WhatToMine error: 429');
  }

  if (!res.ok) {
    throw new Error(`WhatToMine error: ${res.status}`);
  }

  return await res.json();
}

// Unified market data getter with caching and deduplication
async function getMarketData() {
  const now = Date.now();

  // 1. Fresh cache: serve immediately
  if (marketCache && (now - marketCache.cached_at) < CACHE_TTL_MS) {
    return { ...marketCache, is_stale: false };
  }

  // 2. Single-flight deduplication: return existing in-flight promise
  if (inFlightMarketFetch) {
    return inFlightMarketFetch;
  }

  // 3. Execute new fetch
  inFlightMarketFetch = (async () => {
    try {
      const [wtmData, btcInfo] = await Promise.all([
        fetchWhatToMineData(),
        fetchBtcThbPrice()
      ]);

      const freshData = {
        btc_revenue_per_1000ths: Number(wtmData.btc_revenue) || 0,
        coin_name: wtmData.name || 'Pearl',
        algorithm: wtmData.algorithm || 'Pearl',
        btc_thb: btcInfo.price,
        btc_source: btcInfo.source,
        is_stale: false,
        cached_at: Date.now()
      };

      marketCache = freshData;
      persistCache(freshData);
      return freshData;
    } catch (err) {
      console.warn(`[Market] Live fetch failed (${err.message}). Serving stale cache or fallback.`);

      if (marketCache) {
        return {
          ...marketCache,
          is_stale: true,
          warning: err.message
        };
      }

      return {
        ...DEFAULT_FALLBACK_MARKET,
        warning: err.message
      };
    } finally {
      inFlightMarketFetch = null;
    }
  })();

  return inFlightMarketFetch;
}

// Market proxy endpoint
app.get('/api/market', async (req, res) => {
  try {
    const data = await getMarketData();
    res.json(data);
  } catch (err) {
    console.error('[Market] Unexpected error in /api/market:', err.message);
    res.json(marketCache || DEFAULT_FALLBACK_MARKET);
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
  console.log(`Coin ID: ${WTM_COIN_ID}`);
  console.log(`==================================================`);
});
