/* ─── Claude Trades — app.js ─── */

// ── Paper Trading State ──────────────────────────────────────────────────────
let paperBalance = parseFloat(localStorage.getItem('ct_balance') ?? '100');
let positions = JSON.parse(localStorage.getItem('ct_positions') ?? '{}');
let tradeHistory = JSON.parse(localStorage.getItem('ct_history') ?? '[]');
let initialBalance = parseFloat(localStorage.getItem('ct_initial') ?? '100');
let currentTab = 'buy';
let activeToken = null;
let priceChartInstance = null;

// ── Token Data Generators ────────────────────────────────────────────────────
const EMOJIS = ['🐸','🦊','🚀','🌙','💎','🐕','🦁','🐉','⚡','🔥','🌊','🎯','🍌','🐻','🦄','🌟','🤖','👻','🍀','🎪'];
const SUFFIXES = ['inu','fi','dao','moon','pump','base','ai','pepe','doge','cat','sol','meme','frog','gem','coin','x','swap'];
const PREFIXES = ['baby','degen','mega','ultra','super','alpha','chad','giga','turbo','hyper','neon','cyber','sonic','dark'];

function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.floor(rnd(min, max + 1)); }
function pick(arr) { return arr[rndInt(0, arr.length - 1)]; }

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}
function fmtPrice(p) {
  if (p < 0.000001) return p.toExponential(2);
  if (p < 0.001) return p.toFixed(6);
  if (p < 1) return p.toFixed(4);
  return p.toFixed(2);
}
function fmtAge(secs) {
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm';
  return Math.floor(secs / 3600) + 'h';
}
function colorForProgress(p) {
  if (p >= 90) return '#ff3b5c';
  if (p >= 75) return '#f0c040';
  if (p >= 50) return '#4f80ff';
  return '#00d18c';
}

function makeName() {
  const style = rndInt(0, 2);
  if (style === 0) return pick(PREFIXES) + pick(SUFFIXES);
  if (style === 1) return pick(PREFIXES) + pick(EMOJIS).replace(/[^\w]/g,'') + pick(SUFFIXES);
  return pick(PREFIXES) + (Math.random() > 0.5 ? pick(PREFIXES) : '') + pick(SUFFIXES);
}

function makeToken(type) {
  const name = makeName();
  const symbol = name.slice(0, 5).toUpperCase();
  const emoji = pick(EMOJIS);
  const bg = `hsl(${rndInt(0,360)},60%,22%)`;
  const price = type === 'migrated' ? rnd(0.00001, 0.005) : rnd(0.000001, 0.0001);
  const mcap = type === 'migrated' ? rnd(69000, 500000) : rnd(10000, 68000);
  const vol24 = rnd(mcap * 0.05, mcap * 0.6);
  const holders = type === 'migrated' ? rndInt(300, 3000) : rndInt(50, 450);
  const progress = type === 'migrated' ? 100 : rnd(60, 99.5);
  const change = rnd(-15, 80);
  const ageSecs = type === 'migrated' ? rndInt(60, 7200) : rndInt(30, 3600);
  const buys = rndInt(20, 300);
  const sells = rndInt(5, buys);
  const txns = buys + sells;
  const dex = type === 'migrated' ? pick(['Raydium', 'Orca', 'Meteora']) : null;

  return {
    id: Math.random().toString(36).slice(2),
    name, symbol, emoji, bg, price, mcap, vol24,
    holders, progress, change, ageSecs, buys, sells, txns,
    type, dex, createdAt: Date.now(),
    priceHistory: generatePriceHistory(price, type),
  };
}

function generatePriceHistory(currentPrice, type) {
  const points = 60;
  const history = [];
  let p = currentPrice * rnd(0.3, 0.7);
  const now = Date.now();
  for (let i = 0; i < points; i++) {
    const t = now - (points - i) * 60000;
    const drift = type === 'migrated' ? rnd(0.98, 1.06) : rnd(0.95, 1.12);
    p *= drift;
    const high = p * rnd(1.0, 1.04);
    const low = p * rnd(0.96, 1.0);
    const open = history.length ? history[history.length - 1].close : p * rnd(0.97, 1.03);
    const close = p;
    history.push({ t, open, high, low, close });
  }
  return history;
}

// ── State ────────────────────────────────────────────────────────────────────
let finalStretchTokens = [];
let migratedTokens = [];

function initTokens() {
  finalStretchTokens = Array.from({ length: 12 }, () => makeToken('finalstretch'));
  migratedTokens = Array.from({ length: 10 }, () => makeToken('migrated'));
}

// ── Rendering ────────────────────────────────────────────────────────────────
function renderFinalStretch() {
  const list = document.getElementById('finalStretchList');
  list.innerHTML = '';
  finalStretchTokens.forEach(tok => {
    list.appendChild(buildCard(tok));
  });
}

function renderMigrated() {
  const list = document.getElementById('migratedList');
  list.innerHTML = '';
  migratedTokens.forEach(tok => {
    list.appendChild(buildCard(tok));
  });
}

function buildCard(tok) {
  const card = document.createElement('div');
  card.className = 'token-card';
  card.dataset.id = tok.id;

  const progressColor = colorForProgress(tok.progress);
  const changeSign = tok.change >= 0 ? '+' : '';
  const changeClass = tok.change >= 0 ? 'positive' : 'negative';
  const isMigrated = tok.type === 'migrated';

  card.innerHTML = `
    <div class="card-top">
      <div class="card-left">
        <div class="token-icon" style="background:${tok.bg}">${tok.emoji}</div>
        <div class="token-name-row">
          <span class="token-name">${tok.name}</span>
          <span class="token-symbol">$${tok.symbol} ${isMigrated ? `<span class="migrated-badge">🚀 ${tok.dex}</span>` : ''}</span>
        </div>
      </div>
      <div class="card-right">
        <span class="token-age">${fmtAge(tok.ageSecs)}</span>
        <span class="token-change ${changeClass}">${changeSign}${tok.change.toFixed(1)}%</span>
      </div>
    </div>

    <div class="card-stats">
      <div class="stat-box">
        <div class="s-label">Market Cap</div>
        <div class="s-val">$${fmtNum(tok.mcap)}</div>
      </div>
      <div class="stat-box">
        <div class="s-label">Volume</div>
        <div class="s-val">$${fmtNum(tok.vol24)}</div>
      </div>
      <div class="stat-box">
        <div class="s-label">Holders</div>
        <div class="s-val">${tok.holders.toLocaleString()}</div>
      </div>
    </div>

    ${!isMigrated ? `
    <div class="progress-section">
      <div class="progress-label">
        <span class="pl-left">Bonding Curve</span>
        <span class="pl-right">${tok.progress.toFixed(1)}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${tok.progress}%;background:linear-gradient(90deg,#4f80ff,${progressColor})"></div>
      </div>
    </div>` : `
    <div class="progress-section">
      <div class="progress-label">
        <span class="pl-left">Txns (24h)</span>
        <span class="pl-right">${tok.txns} &nbsp;·&nbsp; <span style="color:#00d18c">${tok.buys}B</span> / <span style="color:#ff3b5c">${tok.sells}S</span></span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${(tok.buys/tok.txns*100).toFixed(0)}%;background:linear-gradient(90deg,#00d18c,#4f80ff)"></div>
      </div>
    </div>`}

    <div class="card-bottom">
      <button class="quick-buy" onclick="quickTrade(event,'${tok.id}','buy',0.1)">Buy 0.1 ◎</button>
      <button class="quick-sell" onclick="quickTrade(event,'${tok.id}','sell',null)">Sell</button>
      <button class="chart-btn" onclick="openChart(event,'${tok.id}')">📈 Chart</button>
    </div>
  `;
  return card;
}

// ── Chart Modal ──────────────────────────────────────────────────────────────
function openChart(e, tokenId) {
  e && e.stopPropagation();
  const tok = findToken(tokenId);
  if (!tok) return;
  activeToken = tok;

  document.getElementById('modalIcon').textContent = tok.emoji;
  document.getElementById('modalIcon').style.background = tok.bg;
  document.getElementById('modalName').textContent = tok.name;
  document.getElementById('modalSymbol').textContent = `$${tok.symbol}`;
  document.getElementById('modalPrice').textContent = `$${fmtPrice(tok.price)}`;

  const chg = tok.change;
  const chgEl = document.getElementById('modalChange');
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
  chgEl.className = 'modal-change ' + (chg >= 0 ? 'positive' : 'negative');

  document.getElementById('modalMcap').textContent = `$${fmtNum(tok.mcap)}`;
  document.getElementById('modalVol').textContent = `$${fmtNum(tok.vol24)}`;
  document.getElementById('modalHolders').textContent = tok.holders.toLocaleString();
  document.getElementById('modalAge').textContent = fmtAge(tok.ageSecs);
  document.getElementById('modalTxns').textContent = tok.txns.toLocaleString();
  document.getElementById('modalBuySell').textContent = `${tok.buys}/${tok.sells}`;

  renderTradeInfo();
  drawChart(tok);
  document.getElementById('chartModal').classList.add('open');
}

function drawChart(tok) {
  if (priceChartInstance) {
    priceChartInstance.destroy();
    priceChartInstance = null;
  }

  const ctx = document.getElementById('priceChart').getContext('2d');
  const labels = tok.priceHistory.map(d => new Date(d.t));
  const closes = tok.priceHistory.map(d => d.close);
  const isUp = closes[closes.length - 1] >= closes[0];
  const lineColor = isUp ? '#00d18c' : '#ff3b5c';
  const fillColor = isUp ? 'rgba(0,209,140,0.08)' : 'rgba(255,59,92,0.08)';

  priceChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: closes,
        borderColor: lineColor,
        backgroundColor: fillColor,
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: lineColor,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1c27',
          borderColor: '#2a2d45',
          borderWidth: 1,
          titleColor: '#9197c0',
          bodyColor: '#e8eaf6',
          callbacks: {
            title: items => {
              const d = new Date(items[0].label);
              return d.toLocaleTimeString();
            },
            label: item => `$${fmtPrice(item.raw)}`
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
          grid: { color: 'rgba(42,45,69,0.6)', drawBorder: false },
          ticks: { color: '#5c6494', maxTicksLimit: 8, font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(42,45,69,0.6)', drawBorder: false },
          ticks: {
            color: '#5c6494',
            font: { size: 10 },
            callback: v => `$${fmtPrice(v)}`
          },
          position: 'right'
        }
      }
    }
  });
}

function closeChart() {
  document.getElementById('chartModal').classList.remove('open');
  activeToken = null;
  document.getElementById('tradeResult').textContent = '';
}

function closeModal(e) {
  if (e.target === document.getElementById('chartModal')) closeChart();
}

// ── Paper Trading ────────────────────────────────────────────────────────────
function saveState() {
  localStorage.setItem('ct_balance', paperBalance);
  localStorage.setItem('ct_positions', JSON.stringify(positions));
  localStorage.setItem('ct_history', JSON.stringify(tradeHistory));
  localStorage.setItem('ct_initial', initialBalance);
}

function updateNavBalance() {
  document.getElementById('paperBalance').textContent = `◎ ${paperBalance.toFixed(2)}`;
  const pnl = paperBalance - initialBalance;
  const pnlEl = document.getElementById('pnlDisplay');
  pnlEl.textContent = `${pnl >= 0 ? '+' : ''}◎ ${pnl.toFixed(2)}`;
  pnlEl.className = 'pnl-amount' + (pnl < 0 ? ' negative' : '');
}

function renderTradeInfo() {
  if (!activeToken) return;
  document.getElementById('availableBalance').textContent = `◎ ${paperBalance.toFixed(3)}`;
  const pos = positions[activeToken.id];
  document.getElementById('tokenHoldings').textContent = pos
    ? `${pos.amount.toFixed(2)} tokens (◎ ${(pos.amount * activeToken.price / 1).toFixed(4)})`
    : '—';
  const isBuy = currentTab === 'buy';
  const execBtn = document.getElementById('execBtn');
  execBtn.textContent = isBuy ? 'Buy' : 'Sell';
  execBtn.className = `exec-btn ${isBuy ? 'buy-btn' : 'sell-btn'}`;
}

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabBuy').classList.toggle('active', tab === 'buy');
  document.getElementById('tabSell').classList.toggle('active', tab === 'sell');
  const quickAmounts = document.getElementById('quickAmounts');
  quickAmounts.style.display = tab === 'buy' ? 'flex' : 'none';
  document.getElementById('tradeResult').textContent = '';
  renderTradeInfo();
}

function setAmount(val) {
  document.getElementById('tradeAmount').value = val;
}

function executeTrade() {
  if (!activeToken) return;
  const amount = parseFloat(document.getElementById('tradeAmount').value);
  if (isNaN(amount) || amount <= 0) {
    setResult('Enter a valid amount.', 'err');
    return;
  }

  const isBuy = currentTab === 'buy';
  const solPrice = 150; // approximate SOL/USD for token amount calc
  const tokenPrice = activeToken.price; // in USD
  const solPerUsd = 1 / solPrice;

  if (isBuy) {
    if (amount > paperBalance) {
      setResult(`Insufficient balance. Have ◎ ${paperBalance.toFixed(3)}.`, 'err');
      return;
    }
    const usdSpent = amount * solPrice;
    const tokensBought = usdSpent / tokenPrice;
    paperBalance -= amount;

    if (!positions[activeToken.id]) {
      positions[activeToken.id] = { amount: 0, avgPrice: 0, symbol: activeToken.symbol, name: activeToken.name };
    }
    const pos = positions[activeToken.id];
    const totalCost = (pos.avgPrice * pos.amount) + (tokenPrice * tokensBought);
    pos.amount += tokensBought;
    pos.avgPrice = totalCost / pos.amount;

    tradeHistory.push({ type: 'buy', tokenId: activeToken.id, symbol: activeToken.symbol, solAmount: amount, tokens: tokensBought, price: tokenPrice, at: Date.now() });
    saveState();
    updateNavBalance();
    renderTradeInfo();
    setResult(`✓ Bought ${fmtNum(tokensBought)} $${activeToken.symbol} for ◎ ${amount}`, 'ok');
    showToast(`Bought $${activeToken.symbol}`, 'green');
  } else {
    // sell: amount here is fraction of position (0-100%)
    const pos = positions[activeToken.id];
    if (!pos || pos.amount <= 0) {
      setResult(`No $${activeToken.symbol} position to sell.`, 'err');
      return;
    }
    // treat input as % to sell or tokens directly — let's use % for simplicity
    const pct = Math.min(amount, 100);
    const tokensToSell = (pct / 100) * pos.amount;
    const usdReceived = tokensToSell * tokenPrice;
    const solReceived = usdReceived / solPrice;

    pos.amount -= tokensToSell;
    paperBalance += solReceived;
    if (pos.amount < 0.0001) delete positions[activeToken.id];

    tradeHistory.push({ type: 'sell', tokenId: activeToken.id, symbol: activeToken.symbol, solAmount: solReceived, tokens: tokensToSell, price: tokenPrice, at: Date.now() });
    saveState();
    updateNavBalance();
    renderTradeInfo();
    setResult(`✓ Sold ${pct}% of $${activeToken.symbol} for ◎ ${solReceived.toFixed(4)}`, 'ok');
    showToast(`Sold $${activeToken.symbol}`, 'green');
  }
  document.getElementById('tradeAmount').value = '';
}

function setResult(msg, cls) {
  const el = document.getElementById('tradeResult');
  el.textContent = msg;
  el.className = 'trade-result ' + cls;
}

function quickTrade(e, tokenId, side, amount) {
  e && e.stopPropagation();
  const tok = findToken(tokenId);
  if (!tok) return;

  if (side === 'buy') {
    if (amount > paperBalance) {
      showToast('Insufficient balance', 'red');
      return;
    }
    const solPrice = 150;
    const tokensBought = (amount * solPrice) / tok.price;
    paperBalance -= amount;
    if (!positions[tok.id]) positions[tok.id] = { amount: 0, avgPrice: 0, symbol: tok.symbol, name: tok.name };
    const pos = positions[tok.id];
    const totalCost = (pos.avgPrice * pos.amount) + (tok.price * tokensBought);
    pos.amount += tokensBought;
    pos.avgPrice = totalCost / pos.amount;
    tradeHistory.push({ type: 'buy', tokenId: tok.id, symbol: tok.symbol, solAmount: amount, tokens: tokensBought, price: tok.price, at: Date.now() });
    saveState();
    updateNavBalance();
    showToast(`Bought 0.1 ◎ of $${tok.symbol}`, 'green');
  } else {
    const pos = positions[tok.id];
    if (!pos || pos.amount <= 0) {
      showToast(`No $${tok.symbol} position`, 'red');
      return;
    }
    const solPrice = 150;
    const usdVal = pos.amount * tok.price;
    const solReceived = usdVal / solPrice;
    paperBalance += solReceived;
    tradeHistory.push({ type: 'sell', tokenId: tok.id, symbol: tok.symbol, solAmount: solReceived, tokens: pos.amount, price: tok.price, at: Date.now() });
    delete positions[tok.id];
    saveState();
    updateNavBalance();
    showToast(`Sold all $${tok.symbol} for ◎ ${solReceived.toFixed(4)}`, 'green');
  }
}

function resetPaperTrading() {
  paperBalance = 100;
  initialBalance = 100;
  positions = {};
  tradeHistory = [];
  saveState();
  updateNavBalance();
  showToast('Paper account reset to ◎ 100', 'green');
}

function findToken(id) {
  return [...finalStretchTokens, ...migratedTokens].find(t => t.id === id) || null;
}

// ── Live Simulation ──────────────────────────────────────────────────────────
function tickFinalStretch() {
  finalStretchTokens.forEach(tok => {
    // Price drift
    const drift = rnd(0.97, 1.06);
    tok.price *= drift;
    tok.change += rnd(-3, 5);
    tok.vol24 *= rnd(0.97, 1.04);
    tok.mcap *= rnd(0.98, 1.05);
    tok.mcap = Math.min(tok.mcap, 68000);
    tok.ageSecs += 5;

    // Progress toward bonding
    tok.progress = Math.min(100, tok.progress + rnd(0, 0.6));

    // If graduated, migrate it
    if (tok.progress >= 100) {
      tok.type = 'migrated';
      tok.dex = pick(['Raydium', 'Orca', 'Meteora']);
      tok.progress = 100;
      migratedTokens.unshift(tok);
      if (migratedTokens.length > 20) migratedTokens.pop();
      showToast(`🚀 $${tok.symbol} graduated to ${tok.dex}!`, 'green');
    }

    // Update price history
    const last = tok.priceHistory[tok.priceHistory.length - 1];
    tok.priceHistory.push({
      t: Date.now(),
      open: last.close,
      high: tok.price * rnd(1.0, 1.02),
      low: tok.price * rnd(0.98, 1.0),
      close: tok.price,
    });
    if (tok.priceHistory.length > 80) tok.priceHistory.shift();
  });

  // Remove migrated ones from final stretch
  finalStretchTokens = finalStretchTokens.filter(t => t.type !== 'migrated');

  // Occasionally add a new token
  if (Math.random() < 0.15 && finalStretchTokens.length < 15) {
    const newTok = makeToken('finalstretch');
    finalStretchTokens.unshift(newTok);
  }
  if (finalStretchTokens.length > 15) finalStretchTokens.pop();
}

function tickMigrated() {
  migratedTokens.forEach(tok => {
    tok.price *= rnd(0.98, 1.04);
    tok.change += rnd(-2, 3);
    tok.vol24 *= rnd(0.98, 1.03);
    tok.ageSecs += 5;
    tok.buys += rndInt(0, 3);
    tok.sells += rndInt(0, 2);
    tok.txns = tok.buys + tok.sells;
    const last = tok.priceHistory[tok.priceHistory.length - 1];
    tok.priceHistory.push({
      t: Date.now(),
      open: last.close,
      high: tok.price * rnd(1.0, 1.015),
      low: tok.price * rnd(0.985, 1.0),
      close: tok.price,
    });
    if (tok.priceHistory.length > 80) tok.priceHistory.shift();
  });
}

function liveUpdate() {
  tickFinalStretch();
  tickMigrated();
  renderFinalStretch();
  renderMigrated();

  // Update modal chart live if open
  if (activeToken && priceChartInstance) {
    const tok = findToken(activeToken.id);
    if (tok) {
      activeToken = tok;
      const history = tok.priceHistory;
      priceChartInstance.data.labels = history.map(d => new Date(d.t));
      priceChartInstance.data.datasets[0].data = history.map(d => d.close);
      priceChartInstance.update('none');

      // Update price display
      document.getElementById('modalPrice').textContent = `$${fmtPrice(tok.price)}`;
      const chgEl = document.getElementById('modalChange');
      chgEl.textContent = `${tok.change >= 0 ? '+' : ''}${tok.change.toFixed(2)}%`;
      chgEl.className = 'modal-change ' + (tok.change >= 0 ? 'positive' : 'negative');
      document.getElementById('modalMcap').textContent = `$${fmtNum(tok.mcap)}`;
      document.getElementById('modalVol').textContent = `$${fmtNum(tok.vol24)}`;
    }
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, cls = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${cls}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

// ── Keyboard ─────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeChart();
});

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  initTokens();
  renderFinalStretch();
  renderMigrated();
  updateNavBalance();
  setInterval(liveUpdate, 3000);
}

init();
