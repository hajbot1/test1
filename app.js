// ── Claude Trades — app.js ──────────────────────────────────────────────────

// ── Paper Trading State ──────────────────────────────────────────────────────
const SOL_USD = 150; // approximate SOL price for calc purposes

let balance  = parseFloat(localStorage.getItem('ct_bal')  ?? '5');
let realised = parseFloat(localStorage.getItem('ct_real') ?? '0');
let positions = JSON.parse(localStorage.getItem('ct_pos')  ?? '{}');
let history   = JSON.parse(localStorage.getItem('ct_hist') ?? '[]');
const INIT_BAL = 5;

// ── Active token for modal ───────────────────────────────────────────────────
let activeToken = null;
let chartInst   = null;
let tradeTab    = 'buy';

// ── Token stores ─────────────────────────────────────────────────────────────
let fsTokens  = [];  // final stretch
let migTokens = [];  // migrated

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmtN = n => {
  if (!n) return '—';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
};
const fmtP = p => {
  if (!p || p === 0) return '—';
  if (p < 1e-8) return p.toExponential(2);
  if (p < 0.0001) return p.toFixed(8);
  if (p < 0.01) return p.toFixed(6);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
};
const fmtAge = ts => {
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h';
  return Math.floor(s/86400) + 'd';
};
const progressColor = pct => {
  if (pct >= 90) return '#DC2626';
  if (pct >= 70) return '#D97706';
  if (pct >= 40) return '#E8632A';
  return '#FB923C';
};

// ── DexScreener API ──────────────────────────────────────────────────────────
const DS_BASE = 'https://api.dexscreener.com';
const WSOL    = 'So11111111111111111111111111111111111111112';
let   solPrice = SOL_USD; // live-updated below
const MIN_FEE_SOL = 5;

// Fee rates per DEX
function feeRate(source) {
  if (source === 'pump' || source === 'bonk') return 0.01;   // 1%
  return 0.0025;                                              // 0.25% PumpSwap/Raydium
}

async function fetchSolPrice() {
  try {
    const r = await fetch(`${DS_BASE}/latest/dex/tokens/${WSOL}`);
    const d = await r.json();
    const p = parseFloat((d.pairs || []).find(x => x.quoteToken?.symbol === 'USDC' || x.quoteToken?.symbol === 'USDT')?.priceUsd || 0);
    if (p > 0) solPrice = p;
  } catch {}
}

async function fetchTokens() {
  setLoading(true);
  await fetchSolPrice(); // refresh SOL price before computing fees

  try {
    // 1. Get latest Solana token profiles
    const profRes = await fetch(`${DS_BASE}/token-profiles/latest/v1`);
    const profiles = await profRes.json();

    const solProfiles = Array.isArray(profiles)
      ? profiles.filter(p => p.chainId === 'solana').slice(0, 50)
      : [];

    if (solProfiles.length === 0) {
      // fallback: search directly
      await fetchBySearch();
      return;
    }

    const addrs = solProfiles.map(p => p.tokenAddress).join(',');
    const pairsRes = await fetch(`${DS_BASE}/latest/dex/tokens/${addrs}`);
    const pairsData = await pairsRes.json();
    const pairs = pairsData.pairs || [];

    processPairs(pairs, solProfiles);
  } catch (err) {
    console.warn('Profile fetch failed, trying search fallback:', err);
    await fetchBySearch();
  }
}

async function fetchBySearch() {
  try {
    const [r1, r2, r3] = await Promise.allSettled([
      fetch(`${DS_BASE}/latest/dex/search?q=pumpfun`).then(r => r.json()),
      fetch(`${DS_BASE}/latest/dex/search?q=pumpswap`).then(r => r.json()),
      fetch(`${DS_BASE}/latest/dex/search?q=bonk`).then(r => r.json()),
    ]);

    const pairs = [
      ...(r1.status === 'fulfilled' ? (r1.value.pairs || []) : []),
      ...(r2.status === 'fulfilled' ? (r2.value.pairs || []) : []),
      ...(r3.status === 'fulfilled' ? (r3.value.pairs || []) : []),
    ].filter(p => p.chainId === 'solana');

    processPairs(pairs, []);
  } catch (err) {
    console.error('Search also failed:', err);
    setLoading(false);
    showToast('Failed to fetch tokens', 'r');
  }
}

function processPairs(pairs, profiles) {
  // Build icon map from profiles
  const iconMap = {};
  profiles.forEach(p => { if (p.icon) iconMap[p.tokenAddress] = p.icon; });

  // Final Stretch: pumpfun (bonding curve) + bonk.fun bonding curve
  // Migrated: raydium + pumpswap (PumpSwap = pump.fun's graduated-token AMM)
  const fsPairs  = pairs.filter(p => isBondingCurveDex(p));
  const migPairs = pairs.filter(p => isMigratedDex(p));

  const fsEnriched  = fsPairs.map(p => enrichPair(p, iconMap, false));
  const migEnriched = migPairs.map(p => enrichPair(p, iconMap, true));

  // Final Stretch: fdv 8k–72k, sorted by fdv desc (closest to graduation first)
  fsTokens = dedupe(
    fsEnriched
      .filter(t => t.fdv > 8000 && t.fdv < 72000 && t.feeSol >= MIN_FEE_SOL)
      .sort((a, b) => b.fdv - a.fdv)
      .slice(0, 20)
  );

  renderFinalStretch();
  enrichMissingIcons(fsTokens).then(() => renderFinalStretch());

  // Also fetch dedicated migrated results
  fetchMigrated().then(extra => {
    migTokens = dedupe([...migEnriched, ...extra]
      .filter(t => t.feeSol >= MIN_FEE_SOL)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
    );
    renderMigrated();
    enrichMissingIcons(migTokens).then(() => renderMigrated());
  });

  setLoading(false);
}

// Batch-fetch DexScreener token profiles for tokens still missing an icon
async function enrichMissingIcons(tokens) {
  const missing = tokens.filter(t => !t.icon && t.baseAddress);
  if (!missing.length) return;
  try {
    const addrs = missing.map(t => t.baseAddress).join(',');
    const r = await fetch(`${DS_BASE}/latest/dex/tokens/${addrs}`);
    const d = await r.json();
    const imgMap = {};
    (d.pairs || []).forEach(p => {
      const addr = p.baseToken?.address;
      const img  = p.info?.imageUrl;
      if (addr && img && !imgMap[addr]) imgMap[addr] = img;
    });
    tokens.forEach(t => { if (!t.icon && imgMap[t.baseAddress]) t.icon = imgMap[t.baseAddress]; });
  } catch {}
}

// pump.fun bonding curve dexes
function isBondingCurveDex(p) {
  const dex = (p.dexId || '').toLowerCase();
  const url = (p.url || '').toLowerCase();
  return dex === 'pumpfun' || dex === 'bonk' ||
    url.includes('pump.fun') || url.includes('bonk.fun');
}

// Graduated dexes: Raydium or PumpSwap
function isMigratedDex(p) {
  const dex = (p.dexId || '').toLowerCase();
  return dex === 'raydium' || dex === 'pumpswap' || dex === 'pump-swap';
}

async function fetchMigrated() {
  // Explicitly search for pumpswap and raydium graduated tokens
  try {
    const [r1, r2] = await Promise.allSettled([
      fetch(`${DS_BASE}/latest/dex/search?q=pumpswap`).then(r => r.json()),
      fetch(`${DS_BASE}/latest/dex/search?q=raydium%20pump`).then(r => r.json()),
    ]);
    const raw = [
      ...(r1.status === 'fulfilled' ? (r1.value.pairs || []) : []),
      ...(r2.status === 'fulfilled' ? (r2.value.pairs || []) : []),
    ].filter(p => p.chainId === 'solana' && isMigratedDex(p));
    return raw.map(p => enrichPair(p, {}, true));
  } catch { return []; }
}

function enrichPair(p, iconMap, isMigrated = false) {
  const base = p.baseToken || {};
  const addr = base.address || '';
  const dex = (p.dexId || '').toLowerCase();
  const url = (p.url || '').toLowerCase();

  let source = 'other';
  if (dex === 'pumpfun' || url.includes('pump.fun')) source = 'pump';
  else if (dex === 'bonk' || url.includes('bonk.fun')) source = 'bonk';
  else if (dex === 'pumpswap' || dex === 'pump-swap') source = 'pumpswap';

  const fdv = p.fdv || (p.marketCap) || 0;
  const mcap = p.marketCap || fdv;
  const price = parseFloat(p.priceUsd || 0);
  const vol24 = p.volume?.h24 || 0;
  const feeSol = (vol24 * feeRate(source)) / solPrice;
  const liq = p.liquidity?.usd || 0;
  const buys24 = p.txns?.h24?.buys || 0;
  const sells24 = p.txns?.h24?.sells || 0;
  const chg24 = p.priceChange?.h24 || 0;
  const createdAt = p.pairCreatedAt ? Math.floor(p.pairCreatedAt / 1000) : Math.floor(Date.now()/1000);

  // Bonding curve progress — pump.fun graduates at ~$69k fdv
  const GRAD_FDV = 69000;
  const progress = isMigrated ? 100 : Math.min(99.9, (fdv / GRAD_FDV) * 100);

  return {
    id: p.pairAddress || addr,
    name: base.name || '—',
    symbol: base.symbol || '—',
    baseAddress: addr,
    pairAddress: p.pairAddress || '',
    icon: iconMap[addr] || p.info?.imageUrl || null,
    price, fdv, mcap, vol24, liq, feeSol,
    buys24, sells24,
    chg24, createdAt,
    progress, source,
    dexId: p.dexId || '',
    dexUrl: p.url || '',
    isMigrated,
    // synthetic price history (we don't have OHLCV for free)
    priceHistory: buildPriceHistory(price, chg24),
  };
}

function buildPriceHistory(currentPrice, chg24) {
  const points = 60;
  const history = [];
  const startPrice = currentPrice / (1 + chg24 / 100);
  let p = startPrice;
  const now = Date.now();
  for (let i = 0; i < points; i++) {
    const t = now - (points - i) * 60000;
    const progress = i / points;
    // interpolate toward current with noise
    const target = startPrice + (currentPrice - startPrice) * progress;
    p = target * (1 + (Math.random() - 0.5) * 0.04);
    history.push({ t, v: p });
  }
  history[history.length - 1].v = currentPrice;
  return history;
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

function setLoading(on) {
  $('fsLoading').style.display = on ? 'flex' : 'none';
  $('migLoading').style.display = on ? 'flex' : 'none';
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderFinalStretch() {
  const list = $('fsList');
  list.innerHTML = '';
  $('fsCount').textContent = fsTokens.length;
  if (fsTokens.length === 0) {
    list.innerHTML = '<div class="empty-state">No tokens found</div>';
    return;
  }
  fsTokens.forEach(t => list.appendChild(buildCard(t, false)));
}

function renderMigrated() {
  const list = $('migList');
  list.innerHTML = '';
  $('migCount').textContent = migTokens.length;
  if (migTokens.length === 0) {
    list.innerHTML = '<div class="empty-state">No migrated tokens found</div>';
    return;
  }
  migTokens.forEach(t => list.appendChild(buildCard(t, true)));
}

function buildCard(tok, isMig) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.id = tok.id;

  const chgSign = tok.chg24 >= 0 ? '+' : '';
  const chgCls  = tok.chg24 >= 0 ? 'up' : 'dn';
  const pColor  = progressColor(tok.progress);
  const pWidth  = Math.min(100, tok.progress);

  const srcBadge = tok.source === 'pump'
    ? '<span class="src-badge src-pump">pump.fun</span>'
    : tok.source === 'bonk'
    ? '<span class="src-badge src-bonk">bonk.fun</span>'
    : tok.source === 'pumpswap'
    ? '<span class="src-badge src-pumpswap">pumpswap</span>'
    : '<span class="src-badge src-other">sol</span>';

  // Show which DEX the migrated token landed on
  const migDexLabel = isMig
    ? (tok.dexId === 'raydium' ? 'Raydium' : tok.dexId === 'pumpswap' || tok.dexId === 'pump-swap' ? 'PumpSwap' : tok.dexId || 'DEX')
    : '';
  const dexBadge = isMig
    ? `<span class="mig-dex">↑ ${migDexLabel}</span>`
    : '';

  const progressBlock = isMig ? `
    <div class="c-progress">
      <div class="c-prog-row">
        <span>Buys / Sells (24h)</span>
        <span class="c-prog-pct">${tok.buys24}B / ${tok.sells24}S</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill" style="width:${tok.buys24+tok.sells24>0?Math.round(tok.buys24/(tok.buys24+tok.sells24)*100):50}%;background:linear-gradient(90deg,#E8632A,#2563EB)"></div>
      </div>
    </div>` : `
    <div class="c-progress">
      <div class="c-prog-row">
        <span>Bonding Curve</span>
        <span class="c-prog-pct">${tok.progress.toFixed(1)}%</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill" style="width:${pWidth}%;background:linear-gradient(90deg,#2563EB,${pColor})"></div>
      </div>
    </div>`;

  div.innerHTML = `
    <div class="c-head">
      <div class="c-left">
        <div class="c-icon" id="icon-${tok.id}">
          ${tok.icon ? `<img src="${tok.icon}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='${esc(tok.symbol?.[0]??'?')}'"/>` : (tok.symbol?.[0] ?? '?')}
        </div>
        <div>
          <div class="c-name">${esc(tok.name)}</div>
          <div class="c-sym">$${esc(tok.symbol)} ${srcBadge} ${dexBadge}</div>
          <div class="c-ca" title="${tok.baseAddress}" onclick="copyCA(event,'${tok.baseAddress}')">${tok.baseAddress ? tok.baseAddress.slice(0,4)+'…'+tok.baseAddress.slice(-4) : '—'} <span class="ca-copy">⎘</span></div>
        </div>
      </div>
      <div class="c-right">
        <span class="c-age">${fmtAge(tok.createdAt)}</span>
        <span class="c-chg ${chgCls}">${chgSign}${tok.chg24.toFixed(1)}%</span>
      </div>
    </div>

    <div class="c-metrics">
      <div class="c-metric">
        <div class="cm-l">MCAP</div>
        <div class="cm-v">$${fmtN(tok.mcap || tok.fdv)}</div>
      </div>
      <div class="c-metric">
        <div class="cm-l">VOL 24H</div>
        <div class="cm-v">$${fmtN(tok.vol24)}</div>
      </div>
      <div class="c-metric">
        <div class="cm-l">FEES 24H</div>
        <div class="cm-v fee-sol">${tok.feeSol >= 1 ? tok.feeSol.toFixed(1) : tok.feeSol.toFixed(2)} SOL</div>
      </div>
      <div class="c-metric">
        <div class="cm-l">PRICE</div>
        <div class="cm-v ${tok.chg24>=0?'g':'r'}">$${fmtP(tok.price)}</div>
      </div>
    </div>

    ${progressBlock}

    <div class="c-footer">
      <div class="c-footer-left" style="flex:1;display:flex;gap:4px">
        <button class="btn-buy" onclick="quickBuy(event,'${tok.id}')">BUY 0.1◎</button>
      </div>
      <button class="btn-chart" onclick="openModal(event,'${tok.id}')">📈</button>
    </div>
  `;
  return div;
}

function copyCA(e, addr) {
  e.stopPropagation();
  if (!addr) return;
  navigator.clipboard.writeText(addr).then(() => showToast('CA copied', 'g'));
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Modal ────────────────────────────────────────────────────────────────────
function openModal(e, tokenId) {
  e && e.stopPropagation();
  const tok = findTok(tokenId);
  if (!tok) return;
  activeToken = tok;

  // Icon
  const mIcon = $('mIcon');
  const mIconFb = $('mIconFb');
  if (tok.icon) {
    mIcon.src = tok.icon;
    mIcon.style.display = 'block';
    mIconFb.style.display = 'none';
    mIcon.onerror = () => { mIcon.style.display='none'; mIconFb.style.display='flex'; mIconFb.textContent = tok.symbol?.[0]??'?'; };
  } else {
    mIcon.style.display = 'none';
    mIconFb.style.display = 'flex';
    mIconFb.textContent = tok.symbol?.[0] ?? '?';
  }

  $('mName').textContent = tok.name;
  $('mSym').textContent = `$${tok.symbol}`;
  $('mPrice').textContent = `$${fmtP(tok.price)}`;

  const chgEl = $('mChg');
  chgEl.textContent = `${tok.chg24>=0?'+':''}${tok.chg24.toFixed(2)}%`;
  chgEl.className = 'modal-chg ' + (tok.chg24>=0?'up':'dn');

  $('mMcap').textContent = '$' + fmtN(tok.mcap || tok.fdv);
  $('mVol').textContent = '$' + fmtN(tok.vol24);
  $('mLiq').textContent = '$' + fmtN(tok.liq);
  $('mBuys').textContent = tok.buys24.toLocaleString();
  $('mSells').textContent = tok.sells24.toLocaleString();
  $('mAge').textContent = fmtAge(tok.createdAt);

  setTab('buy');
  drawChart(tok);
  refreshTradeUI();
  $('modal').classList.add('open');
}

function closeModal() {
  $('modal').classList.remove('open');
  if (chartInst) { chartInst.destroy(); chartInst = null; }
  activeToken = null;
  $('tradeMsg').textContent = '';
}

function handleModalBg(e) {
  if (e.target === $('modal')) closeModal();
}

function drawChart(tok) {
  if (chartInst) { chartInst.destroy(); chartInst = null; }
  const ctx = $('chart').getContext('2d');
  const isUp = tok.chg24 >= 0;
  const lc = isUp ? '#E8632A' : '#DC2626';
  const fc = isUp ? 'rgba(232,99,42,0.08)' : 'rgba(220,38,38,0.08)';

  chartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: tok.priceHistory.map(d => new Date(d.t)),
      datasets: [{
        data: tok.priceHistory.map(d => d.v),
        borderColor: lc, backgroundColor: fc,
        borderWidth: 1.5, fill: true,
        tension: 0.35, pointRadius: 0, pointHoverRadius: 4,
        pointHoverBackgroundColor: lc,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f1520', borderColor: '#1a2535', borderWidth: 1,
          titleColor: '#5a6e8a', bodyColor: '#c8d4e8',
          callbacks: {
            title: items => new Date(items[0].label).toLocaleTimeString(),
            label: item => `$${fmtP(item.raw)}`
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#3a4d65', maxTicksLimit: 6, font: { family: "'JetBrains Mono'", size: 9 } }
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#3a4d65', font: { family: "'JetBrains Mono'", size: 9 },
            callback: v => `$${fmtP(v)}`
          }
        }
      }
    }
  });
}

// ── Paper Trading ─────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('ct_bal',  balance);
  localStorage.setItem('ct_real', realised);
  localStorage.setItem('ct_pos',  JSON.stringify(positions));
  localStorage.setItem('ct_hist', JSON.stringify(history));
}

function getTotalPositionsValue() {
  let total = 0;
  for (const [id, pos] of Object.entries(positions)) {
    const tok = findTok(id);
    const price = tok ? tok.price : pos.avgPrice;
    total += pos.amount * price * (1 / SOL_USD);
  }
  return total;
}

function getInvested() {
  let total = 0;
  for (const pos of Object.values(positions)) {
    total += pos.solCost;
  }
  return total;
}

function updateUI() {
  const invested = getInvested();
  const posVal = getTotalPositionsValue();
  const netPnl = (balance - INIT_BAL) + realised + (posVal - invested);

  $('navBalance').textContent = `◎ ${balance.toFixed(2)}`;
  $('pBalance').textContent   = `◎ ${balance.toFixed(2)}`;
  $('pInvested').textContent  = `◎ ${invested.toFixed(4)}`;
  $('pRealised').textContent  = `${realised>=0?'+':''}◎ ${realised.toFixed(4)}`;

  const netEl = $('pNet');
  netEl.textContent = `${netPnl>=0?'+':''}◎ ${netPnl.toFixed(4)}`;
  netEl.className = 'pnl-metric-val mono big' + (netPnl < 0 ? ' neg' : '');

  const navPnl = $('navPnl');
  navPnl.textContent = `${netPnl>=0?'+':''}◎ ${netPnl.toFixed(4)}`;
  navPnl.className = 'status-val mono pnl-val' + (netPnl < 0 ? ' neg' : '');

  renderPositions();
  renderHistory();
}

function renderPositions() {
  const list = $('positionsList');
  const ids = Object.keys(positions);
  if (ids.length === 0) {
    list.innerHTML = '<div class="empty-state">No open positions</div>';
    return;
  }
  list.innerHTML = '';
  ids.forEach(id => {
    const pos = positions[id];
    const tok = findTok(id);
    const curPrice = tok ? tok.price : pos.avgPrice;
    const curVal = pos.amount * curPrice * (1 / SOL_USD);
    const pnlSol = curVal - pos.solCost;
    const pnlPct = pos.solCost > 0 ? (pnlSol / pos.solCost * 100) : 0;

    const div = document.createElement('div');
    div.className = 'pos-item';
    div.innerHTML = `
      <div class="pos-row">
        <div><div class="pos-name">${esc(pos.name)}</div><div class="pos-sym">$${esc(pos.symbol)}</div></div>
        <div style="text-align:right">
          <div class="pos-val">◎ ${curVal.toFixed(4)}</div>
          <div class="pos-pnl ${pnlSol>=0?'pos':'neg'}">${pnlSol>=0?'+':''}◎ ${pnlSol.toFixed(4)} (${pnlPct.toFixed(1)}%)</div>
        </div>
      </div>
      <div class="pos-row" style="margin-top:5px">
        <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${fmtN(pos.amount)} tokens</span>
        <button class="pos-sell-btn" onclick="sellAll('${id}')">SELL ALL</button>
      </div>
    `;
    list.appendChild(div);
  });
}

function renderHistory() {
  const list = $('historyList');
  if (history.length === 0) {
    list.innerHTML = '<div class="empty-state">No trades yet</div>';
    return;
  }
  list.innerHTML = '';
  [...history].reverse().slice(0, 30).forEach(h => {
    const div = document.createElement('div');
    div.className = 'hist-item';
    div.innerHTML = `
      <span class="hist-type ${h.type==='buy'?'b':'s'}">${h.type.toUpperCase()}</span>
      <span class="hist-sym">$${esc(h.symbol)}</span>
      <span class="hist-amt" style="margin-left:auto">◎ ${h.sol.toFixed(4)}</span>
    `;
    list.appendChild(div);
  });
}

function setTab(tab) {
  tradeTab = tab;
  $('tBuy').classList.toggle('active', tab==='buy');
  $('tSell').classList.toggle('active', tab==='sell');
  const execBtn = $('execBtn');
  execBtn.textContent = tab === 'buy' ? 'BUY' : 'SELL';
  execBtn.className = `exec-btn ${tab==='sell'?'sell':''}`;
  $('quickRow').style.display = tab==='buy'?'flex':'none';
  const amtSuffix = $('amtSuffix');
  amtSuffix.textContent = tab==='buy' ? 'SOL' : '%';
  $('amtInput').placeholder = tab==='buy' ? '0.00' : '100';
  $('tradeMsg').textContent = '';
  refreshTradeUI();
}

function refreshTradeUI() {
  $('tAvail').textContent = `◎ ${balance.toFixed(3)}`;
  const pos = activeToken ? positions[activeToken.id] : null;
  if (pos) {
    $('holdingRow').style.display = 'flex';
    const tok = findTok(activeToken.id);
    const curPrice = tok ? tok.price : pos.avgPrice;
    const curVal = pos.amount * curPrice * (1 / SOL_USD);
    $('tHolding').textContent = `${fmtN(pos.amount)} tokens (◎ ${curVal.toFixed(4)})`;
  } else {
    $('holdingRow').style.display = 'none';
  }
}

function setAmt(v) { $('amtInput').value = v; }

function executeTrade() {
  if (!activeToken) return;
  const raw = parseFloat($('amtInput').value);
  if (isNaN(raw) || raw <= 0) { setMsg('Enter a valid amount.', 'err'); return; }

  if (tradeTab === 'buy') {
    executeBuy(activeToken.id, raw);
  } else {
    const pct = Math.min(raw, 100);
    executeSell(activeToken.id, pct);
  }
  $('amtInput').value = '';
}

function executeBuy(tokenId, solAmt) {
  if (solAmt > balance) { setMsg('Insufficient balance.', 'err'); return; }
  const tok = findTok(tokenId);
  if (!tok) return;
  const tokensBought = (solAmt * SOL_USD) / tok.price;
  balance -= solAmt;
  if (!positions[tokenId]) positions[tokenId] = { amount: 0, avgPrice: 0, solCost: 0, symbol: tok.symbol, name: tok.name };
  const pos = positions[tokenId];
  const prevCost = pos.avgPrice * pos.amount;
  pos.amount += tokensBought;
  pos.avgPrice = (prevCost + tok.price * tokensBought) / pos.amount;
  pos.solCost += solAmt;
  history.push({ type: 'buy', tokenId, symbol: tok.symbol, sol: solAmt, tokens: tokensBought, price: tok.price, at: Date.now() });
  save(); updateUI(); refreshTradeUI();
  setMsg(`✓ Bought ${fmtN(tokensBought)} $${tok.symbol}`, 'ok');
  showToast(`Bought $${tok.symbol}`, 'g');
}

function executeSell(tokenId, pct) {
  const pos = positions[tokenId];
  if (!pos || pos.amount <= 0) { setMsg('No position to sell.', 'err'); return; }
  const tok = findTok(tokenId);
  const curPrice = tok ? tok.price : pos.avgPrice;
  const tokensToSell = (pct / 100) * pos.amount;
  const usdReceived = tokensToSell * curPrice;
  const solReceived = usdReceived / SOL_USD;
  const costBasis   = (tokensToSell / pos.amount) * pos.solCost;

  balance  += solReceived;
  realised += solReceived - costBasis;
  pos.amount  -= tokensToSell;
  pos.solCost -= costBasis;

  if (pos.amount < 0.01) delete positions[tokenId];
  const sym = pos.symbol || tok?.symbol || '?';
  history.push({ type: 'sell', tokenId, symbol: sym, sol: solReceived, tokens: tokensToSell, price: curPrice, at: Date.now() });
  save(); updateUI(); refreshTradeUI();
  setMsg(`✓ Sold ${pct}% for ◎ ${solReceived.toFixed(4)}`, 'ok');
  showToast(`Sold $${sym}`, 'g');
}

function quickBuy(e, tokenId) {
  e && e.stopPropagation();
  const tok = findTok(tokenId);
  if (!tok) return;
  if (0.1 > balance) { showToast('Insufficient balance', 'r'); return; }
  executeBuy(tokenId, 0.1);
}

function sellAll(tokenId) {
  activeToken = findTok(tokenId);
  executeSell(tokenId, 100);
}

function resetAccount() {
  balance = 5; realised = 0; positions = {}; history = [];
  save(); updateUI();
  showToast('Account reset to ◎ 5', 'g');
}

function setMsg(msg, cls) {
  const el = $('tradeMsg');
  el.textContent = msg;
  el.className = 'trade-msg ' + cls;
}

function findTok(id) {
  return [...fsTokens, ...migTokens].find(t => t.id === id) || null;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTmr = null;
function showToast(msg, cls='') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${cls}`;
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => el.className = 'toast', 2600);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Auto-refresh every 30s ────────────────────────────────────────────────────
setInterval(fetchTokens, 30000);

// ── Init ──────────────────────────────────────────────────────────────────────
updateUI();
fetchTokens();
