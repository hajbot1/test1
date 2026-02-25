/**
 * content.js — Injected into axiom.trade
 *
 * Strategy:
 *  1. Use a MutationObserver to detect token rows/cards as they appear in the
 *     Pulse feed (the page renders dynamically via React).
 *  2. Extract ticker symbols from each card using multiple selector strategies.
 *  3. Ask the background worker if that ticker has prior migrations.
 *  4. Inject a coloured badge next to the ticker symbol.
 *  5. Fire a Chrome notification for any "migrated" ticker when the page loads.
 */

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────

  const PROCESSED_ATTR    = 'data-axiom-alert-processed';
  const BADGE_CLASS       = 'axiom-migration-badge';
  const TICKER_REGEX      = /^[A-Z$]{1,10}$/;       // typical Solana ticker
  const DEBOUNCE_MS       = 300;
  const NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;   // 5 min between same-ticker notifs

  // ── State ────────────────────────────────────────────────────────────────────

  const pendingTickers    = new Set();
  const notifiedTickers   = new Map();  // ticker → timestamp last notified
  let   debounceTimer     = null;
  let   settings          = { showBadges: true, notifications: true, showCleanBadges: true };

  // Load settings from storage
  chrome.storage.local.get('settings', ({ settings: s }) => {
    if (s) settings = { ...settings, ...s };
  });

  // Listen for settings changes from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SETTINGS_UPDATED') {
      settings = { ...settings, ...msg.settings };
      // Re-apply badge visibility based on new settings
      document.querySelectorAll(`.${BADGE_CLASS}`).forEach(badge => {
        badge.style.display = settings.showBadges ? '' : 'none';
        if (badge.classList.contains('axiom-badge--clean')) {
          badge.style.display = (settings.showBadges && settings.showCleanBadges) ? '' : 'none';
        }
      });
    }
  });

  // ── Selector Strategies ───────────────────────────────────────────────────────
  //
  // Axiom Trade is a React SPA; class names may be hashed. We therefore use
  // multiple heuristics in priority order. Update SELECTOR_STRATEGIES when the
  // site's DOM changes.
  //
  // Each strategy is an object with:
  //   containerSelector  – CSS selector for the repeating card/row element
  //   tickerSelector     – CSS selector (relative to container) for the ticker text
  //                        OR null to use the container's own text
  //   tickerExtractor    – optional fn(element) → string | null

  const SELECTOR_STRATEGIES = [
    // ── Strategy 1: look for elements whose text matches a ticker pattern
    //    and whose parent element looks like a token card.
    {
      containerSelector: '[class*="token"], [class*="coin"], [class*="pair"], [class*="row"]',
      tickerSelector:    null,
      tickerExtractor:   extractTickerFromContainer,
    },
    // ── Strategy 2: common data-* attributes used by trading dashboards
    {
      containerSelector: '[data-symbol], [data-ticker]',
      tickerSelector:    null,
      tickerExtractor:   el =>
        (el.dataset.symbol || el.dataset.ticker || '').trim().toUpperCase() || null,
    },
    // ── Strategy 3: <span> or <p> inside a card whose full text looks like a ticker
    {
      containerSelector: 'span, p',
      tickerSelector:    null,
      tickerExtractor:   el =>
        TICKER_REGEX.test((el.textContent || '').trim())
          ? el.textContent.trim().toUpperCase()
          : null,
    },
  ];

  // ── Ticker extraction helpers ─────────────────────────────────────────────────

  function extractTickerFromContainer(el) {
    // Walk child text nodes for something that looks like a ticker
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (TICKER_REGEX.test(text)) return text.toUpperCase();
    }
    return null;
  }

  /**
   * Given an element, find the best ticker text it contains or represents.
   * Returns null if nothing plausible is found.
   */
  function extractTicker(el) {
    for (const strategy of SELECTOR_STRATEGIES) {
      if (!el.matches(strategy.containerSelector)) continue;
      if (strategy.tickerExtractor) {
        const t = strategy.tickerExtractor(el);
        if (t) return t;
      }
    }
    return null;
  }

  // ── Badge injection ───────────────────────────────────────────────────────────

  function injectBadge(anchorEl, result) {
    // Don't double-inject
    if (anchorEl.querySelector(`.${BADGE_CLASS}`)) return;
    if (!settings.showBadges) return;
    if (!result.hasMigrated && !settings.showCleanBadges) return;

    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;

    if (result.hasMigrated) {
      badge.classList.add('axiom-badge--migrated');
      badge.textContent = `⚠ ${result.count} prior migration${result.count !== 1 ? 's' : ''}`;
      badge.title = buildTooltip(result);
    } else {
      badge.classList.add('axiom-badge--clean');
      badge.textContent = '✓ No prior migrations';
      badge.title = `No tokens with ticker "${result.ticker}" found to have migrated in the last year.`;
    }

    // Make the badge clickable to open a detail modal
    badge.addEventListener('click', e => {
      e.stopPropagation();
      showDetailModal(result);
    });

    anchorEl.appendChild(badge);
  }

  function buildTooltip(result) {
    const lines = [`"${result.ticker}" has ${result.count} prior graduation(s) in the last year:\n`];
    result.migrations.slice(0, 5).forEach((m, i) => {
      const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : 'unknown date';
      const mcap = m.marketCapUsd
        ? `$${Number(m.marketCapUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : 'unknown mcap';
      lines.push(`${i + 1}. ${m.name} (${m.symbol}) — ${date} — ${mcap}`);
    });
    if (result.migrations.length > 5) lines.push(`…and ${result.migrations.length - 5} more.`);
    return lines.join('\n');
  }

  // ── Detail Modal ──────────────────────────────────────────────────────────────

  function showDetailModal(result) {
    // Remove any existing modal
    document.getElementById('axiom-alert-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id    = 'axiom-alert-modal';
    overlay.innerHTML = buildModalHTML(result);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('#axiom-modal-close')?.addEventListener('click', () => overlay.remove());

    document.body.appendChild(overlay);
  }

  function buildModalHTML(result) {
    const rows = result.migrations.map(m => {
      const date  = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '—';
      const mcap  = m.marketCapUsd
        ? `$${Number(m.marketCapUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : '—';
      const short = m.mint ? `${m.mint.slice(0, 6)}…${m.mint.slice(-4)}` : '—';
      return `
        <tr>
          <td>${escHtml(m.name)}</td>
          <td><a href="${escHtml(m.url)}" target="_blank" rel="noopener">${short}</a></td>
          <td>${date}</td>
          <td>${mcap}</td>
          <td>${escHtml(m.source)}</td>
        </tr>`;
    }).join('');

    const empty = `<tr><td colspan="5" style="text-align:center;padding:12px;color:#888">
      No migrations found in the last year for this ticker.
    </td></tr>`;

    return `
      <div id="axiom-modal-content">
        <div id="axiom-modal-header">
          <span id="axiom-modal-title">
            ${result.hasMigrated ? '⚠' : '✓'} Ticker: ${escHtml(result.ticker)}
          </span>
          <button id="axiom-modal-close">✕</button>
        </div>
        <p id="axiom-modal-subtitle">
          ${result.hasMigrated
            ? `${result.count} token(s) with this ticker migrated past the bonding curve in the last year.`
            : 'No tokens with this ticker have migrated past the bonding curve in the last year.'}
        </p>
        <div id="axiom-modal-table-wrap">
          <table id="axiom-modal-table">
            <thead>
              <tr>
                <th>Name</th><th>Mint</th><th>Migrated</th><th>Market Cap</th><th>Source</th>
              </tr>
            </thead>
            <tbody>${result.hasMigrated ? rows : empty}</tbody>
          </table>
        </div>
        <p id="axiom-modal-footer">
          Data checked: ${new Date(result.checkedAt).toLocaleString()} ·
          Source: pump.fun / DexScreener
        </p>
      </div>`;
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Chrome Notification ───────────────────────────────────────────────────────

  function maybeNotify(result) {
    if (!result.hasMigrated) return;
    if (!settings.notifications) return;

    const now  = Date.now();
    const last = notifiedTickers.get(result.ticker) ?? 0;
    if (now - last < NOTIFICATION_COOLDOWN_MS) return;

    notifiedTickers.set(result.ticker, now);

    chrome.runtime.sendMessage({
      type:    'SHOW_NOTIFICATION',
      ticker:  result.ticker,
      count:   result.count,
      topName: result.migrations[0]?.name ?? result.ticker,
    }).catch(() => {/* ignore if background not ready */});
  }

  // ── Processing Pipeline ───────────────────────────────────────────────────────

  /**
   * Scan all candidate elements on the page and queue unprocessed tickers.
   */
  function scanPage() {
    const candidates = document.querySelectorAll(
      SELECTOR_STRATEGIES.map(s => s.containerSelector).join(', ')
    );

    candidates.forEach(el => {
      if (el.hasAttribute(PROCESSED_ATTR)) return;

      const ticker = extractTicker(el);
      if (!ticker) return;

      el.setAttribute(PROCESSED_ATTR, ticker);

      // Debounce batch: collect tickers first, then fire one batch
      pendingTickers.add(JSON.stringify({ ticker, el: null }));
      processTicker(ticker, el);
    });
  }

  async function processTicker(ticker, anchorEl) {
    try {
      const response = await chrome.runtime.sendMessage({
        type:   'CHECK_TICKER',
        ticker,
      });

      if (!response?.ok) {
        console.warn('[AxiomAlerts] Error checking ticker:', ticker, response?.error);
        return;
      }

      injectBadge(anchorEl, response.result);
      maybeNotify(response.result);
    } catch (err) {
      console.warn('[AxiomAlerts] sendMessage failed for ticker', ticker, err);
    }
  }

  // ── MutationObserver ──────────────────────────────────────────────────────────

  function debouncedScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanPage, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(mutations => {
    // Only re-scan if new nodes were actually added
    const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
    if (hasNewNodes) debouncedScan();
  });

  // ── Init ──────────────────────────────────────────────────────────────────────

  function init() {
    observer.observe(document.body, { childList: true, subtree: true });
    scanPage(); // Initial scan
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
