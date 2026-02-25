/**
 * popup.js — Extension popup logic
 */

const $ = id => document.getElementById(id);

// ── Load & Render ─────────────────────────────────────────────────────────────

async function loadState() {
  const { settings = {}, tickerHistory = [], lastCacheCleared } =
    await chrome.storage.local.get(['settings', 'tickerHistory', 'lastCacheCleared']);

  // Toggles
  $('opt-badges').checked        = settings.showBadges        ?? true;
  $('opt-notifications').checked = settings.notifications     ?? true;
  $('opt-show-clean').checked    = settings.showCleanBadges   ?? true;

  // Cache info
  const allKeys = await new Promise(r => chrome.storage.local.get(null, r));
  const tickerKeys = Object.keys(allKeys).filter(k => k.startsWith('ticker_'));
  $('cache-entries').textContent = tickerKeys.length;
  $('cache-count').textContent   = `${tickerKeys.length} cached`;
  $('cache-cleared').textContent = lastCacheCleared
    ? new Date(lastCacheCleared).toLocaleTimeString()
    : 'never';

  // Recent tickers
  renderTickerList(tickerHistory.slice(-12).reverse());
}

function renderTickerList(history) {
  const list = $('ticker-list');
  if (!history.length) return;

  list.innerHTML = history.map(item => {
    const pillClass = item.hasMigrated ? 'ticker-pill--migrated' : 'ticker-pill--clean';
    const pillText  = item.hasMigrated ? `⚠ ${item.count}` : '✓ clean';
    return `
      <div class="ticker-item">
        <span class="ticker-sym">${escHtml(item.ticker)}</span>
        <span class="ticker-pill ${pillClass}">${pillText}</span>
      </div>`;
  }).join('');
}

// ── Settings Save ─────────────────────────────────────────────────────────────

async function saveSettings() {
  const settings = {
    showBadges:      $('opt-badges').checked,
    notifications:   $('opt-notifications').checked,
    showCleanBadges: $('opt-show-clean').checked,
  };
  await chrome.storage.local.set({ settings });

  // Notify active content scripts to apply new settings
  const tabs = await chrome.tabs.query({ url: 'https://axiom.trade/*' });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings })
      .catch(() => {/* tab may not have content script */});
  });
}

// ── Event Listeners ───────────────────────────────────────────────────────────

$('opt-badges').addEventListener('change', saveSettings);
$('opt-notifications').addEventListener('change', saveSettings);
$('opt-show-clean').addEventListener('change', saveSettings);

$('btn-clear-cache').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
  await chrome.storage.local.set({
    lastCacheCleared: Date.now(),
    tickerHistory: [],
  });
  await loadState();
});

$('btn-open-axiom').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://axiom.trade/pulse?chain=sol' });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadState();
