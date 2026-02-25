/**
 * background.js — Service Worker
 *
 * Handles API queries to pump.fun (primary) and DexScreener (fallback)
 * to check if a ticker has previously migrated past the bonding curve.
 * Results are cached in chrome.storage.local with a 1-hour TTL.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const ONE_YEAR_MS  = 365 * 24 * 60 * 60 * 1000;

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CHECK_TICKER') {
    checkTicker(message.ticker)
      .then(result => {
        persistTickerHistory(result);
        sendResponse({ ok: true, result });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'CLEAR_CACHE') {
    // Clear only ticker cache entries, keep settings/history structure
    chrome.storage.local.get(null, items => {
      const keysToRemove = Object.keys(items).filter(k => k.startsWith('ticker_'));
      chrome.storage.local.remove(keysToRemove, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (message.type === 'SHOW_NOTIFICATION') {
    showMigrationNotification(message);
    sendResponse({ ok: true });
    return false;
  }
});

// ─── Core Check ──────────────────────────────────────────────────────────────

/**
 * Returns an object describing prior migrations for a given ticker.
 * {
 *   ticker:      string,
 *   hasMigrated: boolean,          // any migration within the last year?
 *   count:       number,           // how many unique tokens graduated
 *   migrations:  MigrationRecord[], // details
 * }
 */
async function checkTicker(ticker) {
  const cacheKey = `ticker_${ticker.toUpperCase()}`;
  const cached   = await getCached(cacheKey);
  if (cached) return cached;

  // Try pump.fun first; fall back to DexScreener on failure.
  let result;
  try {
    result = await queryPumpFun(ticker);
  } catch (e) {
    console.warn('[AxiomAlerts] pump.fun query failed, trying DexScreener:', e.message);
    result = await queryDexScreener(ticker);
  }

  await setCached(cacheKey, result);
  return result;
}

// ─── pump.fun API ─────────────────────────────────────────────────────────────

/**
 * pump.fun /coins endpoint.
 * `complete: true` means the token graduated (migrated past bonding curve).
 */
async function queryPumpFun(ticker) {
  const url = new URL('https://frontend-api.pump.fun/coins');
  url.searchParams.set('searchTerm', ticker);
  url.searchParams.set('limit', '50');
  url.searchParams.set('sort', 'creation_time');
  url.searchParams.set('order', 'DESC');
  url.searchParams.set('complete', 'true'); // only graduated tokens

  const resp = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
  });

  if (!resp.ok) throw new Error(`pump.fun HTTP ${resp.status}`);

  const coins = await resp.json(); // returns array directly
  if (!Array.isArray(coins)) throw new Error('Unexpected pump.fun response shape');

  const cutoff  = Date.now() - ONE_YEAR_MS;
  const ticker_upper = ticker.toUpperCase();

  const migrations = coins
    .filter(c =>
      c.symbol?.toUpperCase() === ticker_upper &&
      c.complete === true &&
      c.created_timestamp >= cutoff
    )
    .map(c => ({
      name:          c.name ?? 'Unknown',
      symbol:        c.symbol,
      mint:          c.mint,
      raydiumPool:   c.raydium_pool ?? null,
      createdAt:     c.created_timestamp,
      marketCapUsd:  c.usd_market_cap ?? null,
      source:        'pump.fun',
      url:           `https://pump.fun/${c.mint}`,
    }));

  return buildResult(ticker_upper, migrations);
}

// ─── DexScreener API (fallback) ───────────────────────────────────────────────

/**
 * DexScreener /search endpoint.
 * Filters for Solana/Raydium pairs (pump.fun graduates land on Raydium).
 */
async function queryDexScreener(ticker) {
  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(ticker)}`;
  const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });

  if (!resp.ok) throw new Error(`DexScreener HTTP ${resp.status}`);

  const data = await resp.json();
  const pairs = data?.pairs ?? [];

  const cutoff       = Date.now() - ONE_YEAR_MS;
  const ticker_upper = ticker.toUpperCase();

  const migrations = pairs
    .filter(p =>
      p.chainId === 'solana' &&
      // Raydium is where pump.fun tokens graduate to
      (p.dexId === 'raydium' || p.dexId === 'raydium-clmm') &&
      p.baseToken?.symbol?.toUpperCase() === ticker_upper &&
      (p.pairCreatedAt ?? 0) >= cutoff
    )
    .map(p => ({
      name:         p.baseToken?.name ?? 'Unknown',
      symbol:       p.baseToken?.symbol,
      mint:         p.baseToken?.address,
      raydiumPool:  p.pairAddress ?? null,
      createdAt:    p.pairCreatedAt ?? null,
      marketCapUsd: p.marketCap ?? null,
      source:       'dexscreener',
      url:          p.url ?? `https://dexscreener.com/solana/${p.pairAddress}`,
    }));

  return buildResult(ticker_upper, migrations);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildResult(ticker, migrations) {
  return {
    ticker,
    hasMigrated: migrations.length > 0,
    count:       migrations.length,
    migrations,
    checkedAt:   Date.now(),
  };
}

async function getCached(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, items => {
      const entry = items[key];
      if (!entry) return resolve(null);
      if (Date.now() - entry.timestamp > CACHE_TTL_MS) return resolve(null);
      resolve(entry.data);
    });
  });
}

async function setCached(key, data) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: { data, timestamp: Date.now() } }, resolve);
  });
}

// ─── Ticker History ───────────────────────────────────────────────────────────

async function persistTickerHistory(result) {
  const { tickerHistory = [] } = await new Promise(r =>
    chrome.storage.local.get('tickerHistory', r)
  );

  // Upsert by ticker
  const idx = tickerHistory.findIndex(t => t.ticker === result.ticker);
  const entry = { ticker: result.ticker, hasMigrated: result.hasMigrated, count: result.count };

  if (idx >= 0) {
    tickerHistory[idx] = entry;
  } else {
    tickerHistory.push(entry);
    if (tickerHistory.length > 200) tickerHistory.shift(); // keep last 200
  }

  chrome.storage.local.set({ tickerHistory });
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function showMigrationNotification({ ticker, count, topName }) {
  const { settings = {} } = await new Promise(r =>
    chrome.storage.local.get('settings', r)
  );
  if (settings.notifications === false) return;

  chrome.notifications.create(`migration-${ticker}-${Date.now()}`, {
    type:     'basic',
    iconUrl:  'icons/icon128.png',
    title:    `⚠ Migration Alert: $${ticker}`,
    message:  `"${topName}" and ${count} other token(s) with ticker $${ticker} have previously migrated past the pump.fun bonding curve in the last year.`,
    priority: 2,
  });
}
