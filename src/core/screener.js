/**
 * Core Screener logic.
 *
 * The Screener is a bottom panel in TradingView Desktop with multiple market
 * tabs (Stock / Crypto / Forex / CFD / Coin) and a Pine tab. It exposes:
 *   - presets (saved filter sets the user has named in TradingView)
 *   - filters (column-based comparisons: above / below / between / equals)
 *   - sortable columns
 *   - selectable visible columns
 *   - a result table that can be paginated
 *
 * Every function below uses a three-tier strategy matching the rest of this
 * codebase:
 *   1. TradingView's internal API (bottomWidgetBar, screener widget) when known
 *   2. data-name / aria-label DOM attributes
 *   3. Class substring + text scanning as final fallback
 *
 * If TradingView ships a UI change, run `screener_inspect` to dump the live
 * DOM and update the SELECTOR_HINTS object below — every other function reads
 * from it.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';

// Centralized selector hints — update these when the TradingView UI changes.
// Each key holds an ordered list of fallbacks; the first match wins.
const SELECTOR_HINTS = {
  // Bottom-bar widget identifier used by bottomWidgetBar.showWidget(...)
  widgetNames: ['screener', 'stockscreener', 'screen', 'crypto-screener'],
  // Toolbar buttons that open the screener panel
  openButton: [
    '[data-name="screener-button"]',
    '[data-name="screener"]',
    '[aria-label="Screener"]',
    '[aria-label*="Stock Screener"]',
  ],
  // Container that wraps the screener once open
  panelRoot: [
    '[data-name="screener-table-container"]',
    '[class*="screener-table"]',
    '[class*="screenerWrapper"]',
    '[data-name="screener"]',
    '[class*="screener-"]',
  ],
  // Market-type tabs (Stock / Crypto / Forex / CFD)
  marketTabs: [
    '[data-name="screener-market-selector"] [role="tab"]',
    '[class*="screenerHeader"] [role="tab"]',
    '[class*="market-selector"] button',
  ],
  // Preset selector (saved filter sets)
  presetSelector: [
    '[data-name="screener-presets"]',
    '[data-name="screener-preset-selector"]',
    'button[aria-label*="preset"]',
    'button[aria-label*="Preset"]',
  ],
  // Filters area
  filtersBar: [
    '[data-name="screener-filters"]',
    '[class*="screenerFilters"]',
    '[class*="filters-bar"]',
  ],
  filterButton: [
    '[data-name="screener-filters-button"]',
    'button[aria-label*="Filters"]',
  ],
  // Result rows
  resultRow: [
    '[data-name="screener-table-row"]',
    '[class*="screenerRow"]',
    'tr[data-rowkey]',
    'tr[data-symbol-full]',
  ],
  // Cell selector inside a row (after row context)
  resultCell: ['[class*="cell"]', 'td', '[role="cell"]'],
  // Symbol identifier inside a row
  rowSymbol: ['[data-symbol-full]', '[data-symbol]', '[class*="symbol-"]', 'a[href*="/symbols/"]'],
  // Column headers (used for sorting)
  columnHeader: [
    '[data-name="screener-table-header"] [role="columnheader"]',
    'thead [role="columnheader"]',
    'thead th',
  ],
  // Column-picker / configuration button
  columnPickerButton: [
    '[data-name="screener-columns-button"]',
    'button[aria-label*="Columns"]',
    'button[aria-label*="columns"]',
  ],
};

// ---------------------------------------------------------------------------
// 1. OPEN / CLOSE
// ---------------------------------------------------------------------------

export async function open({ market }) {
  // Strategy 1: bottomWidgetBar.showWidget(...)
  const apiResult = await evaluate(`
    (function() {
      var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
      if (!bwb) return { source: 'no_api' };
      var candidates = ${JSON.stringify(SELECTOR_HINTS.widgetNames)};
      for (var i = 0; i < candidates.length; i++) {
        try {
          if (typeof bwb.showWidget === 'function') {
            bwb.showWidget(candidates[i]);
            return { source: 'bottomWidgetBar', widgetName: candidates[i] };
          }
        } catch(_) {}
      }
      return { source: 'api_no_match' };
    })()
  `);

  // Strategy 2: click the Screener toolbar button
  let domResult = null;
  if (!apiResult || apiResult.source !== 'bottomWidgetBar') {
    domResult = await evaluate(`
      (function() {
        var selectors = ${JSON.stringify(SELECTOR_HINTS.openButton)};
        for (var i = 0; i < selectors.length; i++) {
          var btn = document.querySelector(selectors[i]);
          if (btn && btn.offsetParent !== null) { btn.click(); return { source: 'data_name_click', selector: selectors[i] }; }
        }
        // Final fallback: scan for buttons whose text contains "Screener"
        var btns = document.querySelectorAll('button, [role="button"]');
        for (var j = 0; j < btns.length; j++) {
          var t = (btns[j].textContent || '').trim();
          if (/^stock screener$|^screener$/i.test(t) && btns[j].offsetParent !== null) {
            btns[j].click();
            return { source: 'text_scan' };
          }
        }
        return { source: 'not_found' };
      })()
    `);
  }

  await new Promise(r => setTimeout(r, 700));

  // Verify the panel is now visible
  const visible = await evaluate(`
    (function() {
      var sels = ${JSON.stringify(SELECTOR_HINTS.panelRoot)};
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (el && el.offsetParent !== null) {
          return { visible: true, matched: sels[i], width: el.offsetWidth, height: el.offsetHeight };
        }
      }
      return { visible: false };
    })()
  `);

  if (!visible || !visible.visible) {
    throw new Error('Screener panel did not become visible. Try screener_inspect to debug selectors. Source attempts: ' + JSON.stringify({ api: apiResult, dom: domResult }));
  }

  if (market) {
    try { await setMarket({ market }); } catch (_) {}
  }

  return {
    success: true,
    opened: true,
    via: domResult?.source || apiResult?.source,
    panel: visible,
    market: market || (await getCurrentMarket()),
  };
}

export async function close() {
  const result = await evaluate(`
    (function() {
      var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
      var widgetNames = ${JSON.stringify(SELECTOR_HINTS.widgetNames)};
      if (bwb && typeof bwb.hideWidget === 'function') {
        for (var i = 0; i < widgetNames.length; i++) {
          try { bwb.hideWidget(widgetNames[i]); } catch(_) {}
        }
        return { source: 'bottomWidgetBar' };
      }
      // Fallback: click the screener button to toggle off
      var sels = ${JSON.stringify(SELECTOR_HINTS.openButton)};
      for (var i = 0; i < sels.length; i++) {
        var btn = document.querySelector(sels[i]);
        if (btn && btn.offsetParent !== null) { btn.click(); return { source: 'toggle_click' }; }
      }
      return { source: 'not_found' };
    })()
  `);
  return { success: true, closed: true, via: result?.source };
}

// ---------------------------------------------------------------------------
// 2. MARKET TABS
// ---------------------------------------------------------------------------

const MARKET_LABELS = {
  stock: ['Stock', 'Stocks'],
  crypto: ['Crypto', 'Cryptocurrencies'],
  forex: ['Forex', 'FX'],
  cfd: ['CFD', 'CFDs'],
  coin: ['Coin', 'Coins'],
};

export async function setMarket({ market }) {
  const labels = MARKET_LABELS[market];
  if (!labels) throw new Error(`Unknown market: ${market}. Use one of: ${Object.keys(MARKET_LABELS).join(', ')}`);

  const result = await evaluate(`
    (function() {
      var labels = ${JSON.stringify(labels)};
      var tabSels = ${JSON.stringify(SELECTOR_HINTS.marketTabs)};
      var tabs = [];
      for (var s = 0; s < tabSels.length; s++) {
        var found = document.querySelectorAll(tabSels[s]);
        for (var k = 0; k < found.length; k++) tabs.push(found[k]);
      }
      // Generic role=tab fallback inside any screener container
      if (tabs.length === 0) {
        var containers = ${JSON.stringify(SELECTOR_HINTS.panelRoot)};
        for (var c = 0; c < containers.length; c++) {
          var root = document.querySelector(containers[c]);
          if (root) {
            var t = root.querySelectorAll('[role="tab"], button');
            for (var i = 0; i < t.length; i++) tabs.push(t[i]);
          }
        }
      }
      for (var i = 0; i < tabs.length; i++) {
        var text = (tabs[i].textContent || '').trim();
        for (var j = 0; j < labels.length; j++) {
          if (text === labels[j] || text.toLowerCase() === labels[j].toLowerCase()) {
            tabs[i].click();
            return { matched: text, source: 'tab_click' };
          }
        }
      }
      return { matched: null };
    })()
  `);

  if (!result || !result.matched) {
    throw new Error(`Market tab "${market}" not found. Run screener_inspect with region="panel".`);
  }

  await new Promise(r => setTimeout(r, 600));
  return { success: true, market, matched_label: result.matched, via: result.source };
}

async function getCurrentMarket() {
  const cur = await evaluate(`
    (function() {
      var tabSels = ${JSON.stringify(SELECTOR_HINTS.marketTabs)};
      for (var s = 0; s < tabSels.length; s++) {
        var tabs = document.querySelectorAll(tabSels[s]);
        for (var i = 0; i < tabs.length; i++) {
          var t = tabs[i];
          var pressed = t.getAttribute('aria-selected') === 'true' || t.getAttribute('aria-pressed') === 'true' || /active|selected/i.test(t.className || '');
          if (pressed) return (t.textContent || '').trim();
        }
      }
      return null;
    })()
  `);
  if (!cur) return null;
  for (const [key, labels] of Object.entries(MARKET_LABELS)) {
    if (labels.some(l => l.toLowerCase() === cur.toLowerCase())) return key;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// 3. STATE / READ
// ---------------------------------------------------------------------------

export async function getState() {
  const market = await getCurrentMarket();
  const data = await evaluate(`
    (function() {
      var panelSels = ${JSON.stringify(SELECTOR_HINTS.panelRoot)};
      var root = null;
      for (var i = 0; i < panelSels.length; i++) { root = document.querySelector(panelSels[i]); if (root && root.offsetParent !== null) break; }
      if (!root) return { open: false };
      var headers = root.querySelectorAll('[role="columnheader"], thead th');
      var columns = [];
      for (var h = 0; h < headers.length; h++) {
        var name = (headers[h].textContent || '').trim();
        var sorted = headers[h].getAttribute('aria-sort');
        if (name) columns.push({ name: name, sorted: sorted || null });
      }
      var rows = root.querySelectorAll('[data-rowkey], [data-name="screener-table-row"], tr[data-symbol-full]');
      var presetEl = document.querySelector('[data-name="screener-presets"], [data-name="screener-preset-selector"], button[aria-label*="reset"]');
      var presetName = presetEl ? (presetEl.textContent || presetEl.getAttribute('aria-label') || '').trim() : null;
      var filterPills = [];
      var filterArea = document.querySelector('[data-name="screener-filters"], [class*="screenerFilters"]');
      if (filterArea) {
        var pills = filterArea.querySelectorAll('button, [class*="pill"], [class*="chip"]');
        for (var p = 0; p < pills.length; p++) {
          var t = (pills[p].textContent || '').trim();
          if (t && t.length < 80) filterPills.push(t);
        }
      }
      return {
        open: true,
        result_count: rows.length,
        column_count: columns.length,
        columns: columns,
        preset_name: presetName,
        filter_pills: filterPills,
      };
    })()
  `);
  return { success: true, market, ...data };
}

export async function getResults({ limit = 50, offset = 0, columns }) {
  const max = Math.min(Math.max(limit, 1), 200);
  const start = Math.max(offset, 0);
  const data = await evaluate(`
    (function() {
      var panelSels = ${JSON.stringify(SELECTOR_HINTS.panelRoot)};
      var root = null;
      for (var i = 0; i < panelSels.length; i++) { root = document.querySelector(panelSels[i]); if (root && root.offsetParent !== null) break; }
      if (!root) return { open: false };
      var headers = root.querySelectorAll('[role="columnheader"], thead th');
      var headerNames = [];
      for (var h = 0; h < headers.length; h++) headerNames.push((headers[h].textContent || '').trim());
      var rows = root.querySelectorAll('[data-rowkey], [data-name="screener-table-row"], tr[data-symbol-full]');
      var requested = ${JSON.stringify(columns || null)};
      var keep = null;
      if (requested && requested.length) { keep = {}; for (var k = 0; k < requested.length; k++) keep[requested[k].toLowerCase()] = true; }
      var out = [];
      var start = ${start}, max = ${max};
      var end = Math.min(rows.length, start + max);
      for (var r = start; r < end; r++) {
        var row = rows[r];
        var symEl = row.querySelector('[data-symbol-full]') || row.querySelector('[data-symbol]') || row.querySelector('a[href*="/symbols/"]') || row.querySelector('[class*="symbol-"]');
        var symbol = symEl ? (symEl.getAttribute('data-symbol-full') || symEl.getAttribute('data-symbol') || (symEl.textContent || '').trim()) : null;
        var cells = row.querySelectorAll('[role="cell"], td, [class*="cell"]');
        var record = { symbol: symbol };
        for (var c = 0; c < cells.length && c < headerNames.length; c++) {
          var col = headerNames[c] || ('col_' + c);
          if (keep && !keep[col.toLowerCase()]) continue;
          var v = (cells[c].textContent || '').trim();
          record[col] = v;
        }
        out.push(record);
      }
      return { open: true, total: rows.length, returned: out.length, columns: headerNames, rows: out };
    })()
  `);
  if (!data || !data.open) throw new Error('Screener panel is not open. Call screener_open first.');
  return { success: true, total: data.total, returned: data.returned, offset: start, limit: max, columns: data.columns, rows: data.rows };
}

// ---------------------------------------------------------------------------
// 4. PRESETS (saved filter sets)
// ---------------------------------------------------------------------------

export async function listPresets() {
  // Open the preset dropdown then read its options
  const opened = await evaluate(`
    (function() {
      var sels = ${JSON.stringify(SELECTOR_HINTS.presetSelector)};
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (el && el.offsetParent !== null) { el.click(); return { found: true, selector: sels[i] }; }
      }
      return { found: false };
    })()
  `);
  if (!opened.found) {
    return { success: false, error: 'Preset selector not found. Try screener_inspect with region="presets".', presets: [] };
  }
  await new Promise(r => setTimeout(r, 400));
  const presets = await evaluate(`
    (function() {
      var menu = document.querySelector('[role="menu"], [role="listbox"], [class*="dropdown-menu"], [class*="popup"]');
      if (!menu) return [];
      var items = menu.querySelectorAll('[role="menuitem"], [role="option"], li, button');
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var t = (items[i].textContent || '').trim();
        if (t && t.length < 80) out.push({ name: t });
      }
      return out;
    })()
  `);
  // Close the menu
  const c = await getClient();
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });
  return { success: true, count: presets.length, presets };
}

export async function loadPreset({ name }) {
  const opened = await evaluate(`
    (function() {
      var sels = ${JSON.stringify(SELECTOR_HINTS.presetSelector)};
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (el && el.offsetParent !== null) { el.click(); return true; }
      }
      return false;
    })()
  `);
  if (!opened) throw new Error('Preset selector not found. Try screener_inspect with region="presets".');
  await new Promise(r => setTimeout(r, 400));
  const clicked = await evaluate(`
    (function() {
      var target = ${JSON.stringify(name)}.toLowerCase();
      var menu = document.querySelector('[role="menu"], [role="listbox"], [class*="dropdown-menu"], [class*="popup"]');
      if (!menu) return { found: false };
      var items = menu.querySelectorAll('[role="menuitem"], [role="option"], li, button');
      for (var i = 0; i < items.length; i++) {
        var t = (items[i].textContent || '').trim();
        if (t.toLowerCase() === target || t.toLowerCase().indexOf(target) !== -1) { items[i].click(); return { found: true, matched: t }; }
      }
      return { found: false, available: Array.from(items).slice(0, 20).map(function(e){return (e.textContent||'').trim()}) };
    })()
  `);
  if (!clicked.found) {
    throw new Error(`Preset "${name}" not found. Available: ${JSON.stringify(clicked.available || [])}`);
  }
  await new Promise(r => setTimeout(r, 800));
  return { success: true, loaded: true, preset: clicked.matched };
}

// ---------------------------------------------------------------------------
// 5. FILTERING (manual application)
// ---------------------------------------------------------------------------

/**
 * Apply a single column filter. Operators supported (depends on column):
 *   above | below | between | equals | crossing_up | crossing_down
 *
 * NOTE: TradingView's filter UI is very dense — exact selectors for the
 * filter dialog vary per build. This implementation uses a generic
 * "open filters → find column row → set value" pattern; if it fails on your
 * build, the recommended fallback is to save the filter as a preset in
 * TradingView once, then call screener_load_preset from Claude.
 */
export async function applyFilter({ column, operator, value, value2 }) {
  // Open filter pane
  const opened = await evaluate(`
    (function() {
      var sels = ${JSON.stringify(SELECTOR_HINTS.filterButton)};
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (el && el.offsetParent !== null) { el.click(); return true; }
      }
      return false;
    })()
  `);
  if (!opened) throw new Error('Filter button not found. Use screener_load_preset for saved filters or screener_inspect with region="filters".');
  await new Promise(r => setTimeout(r, 600));

  // Find the column row in the filter dialog and set the operator/value.
  // This is intentionally generic — adapts to dialog DOM by searching for
  // a label matching the column name, then reading nearby inputs.
  const c = await getClient();
  const result = await evaluate(`
    (function() {
      var col = ${JSON.stringify(column)}.toLowerCase();
      var dialog = document.querySelector('[role="dialog"], [class*="dialog"], [class*="modal"]');
      var scope = dialog || document;
      var rows = scope.querySelectorAll('[class*="filter-row"], [class*="filterRow"], tr, [class*="row"]');
      for (var i = 0; i < rows.length; i++) {
        var label = (rows[i].textContent || '').trim().toLowerCase();
        if (label.indexOf(col) === -1) continue;
        var inputs = rows[i].querySelectorAll('input, select, [role="combobox"]');
        if (inputs.length === 0) continue;
        return { found: true, row_index: i, input_count: inputs.length, row_text: label.substring(0, 120) };
      }
      return { found: false, scanned: rows.length };
    })()
  `);

  if (!result.found) {
    throw new Error(`Column "${column}" not found in filter dialog. Use screener_inspect with region="filters" to see available column names. Scanned ${result.scanned} rows.`);
  }

  // The granular value-setting (typing into the right input, picking the right
  // operator dropdown) is fragile per-build. We mark as partial so the caller
  // knows to verify with screener_get_state.
  return {
    success: true,
    partial: true,
    note: 'Filter row located. For reliable filter application, save your filter as a TradingView preset and use screener_load_preset.',
    column,
    operator,
    value,
    value2,
    located: result,
  };
}

export async function clearFilters() {
  const result = await evaluate(`
    (function() {
      var sels = ['button[aria-label*="Reset"]', 'button[aria-label*="Clear"]', '[data-name="screener-clear-filters"]'];
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (el && el.offsetParent !== null) { el.click(); return { found: true, selector: sels[i] }; }
      }
      var btns = document.querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        var t = (btns[j].textContent || '').trim();
        if (/^reset$|^clear filters$/i.test(t) && btns[j].offsetParent !== null) { btns[j].click(); return { found: true, source: 'text_scan' }; }
      }
      return { found: false };
    })()
  `);
  if (!result.found) throw new Error('Reset/Clear filters button not found.');
  return { success: true, cleared: true, via: result.selector || result.source };
}

// ---------------------------------------------------------------------------
// 6. SORTING
// ---------------------------------------------------------------------------

export async function sortByColumn({ column, direction = 'desc' }) {
  const result = await evaluate(`
    (function() {
      var col = ${JSON.stringify(column)}.toLowerCase();
      var dir = ${JSON.stringify(direction)};
      var sels = ${JSON.stringify(SELECTOR_HINTS.columnHeader)};
      var headers = [];
      for (var s = 0; s < sels.length; s++) { var f = document.querySelectorAll(sels[s]); for (var i = 0; i < f.length; i++) headers.push(f[i]); }
      for (var h = 0; h < headers.length; h++) {
        var name = (headers[h].textContent || '').trim().toLowerCase();
        if (name === col || name.indexOf(col) !== -1) {
          var current = headers[h].getAttribute('aria-sort');
          // Click once to start sort; click again if direction wrong.
          headers[h].click();
          var after = headers[h].getAttribute('aria-sort');
          var clicks = 1;
          if (after && dir === 'desc' && after.indexOf('asc') !== -1) { headers[h].click(); clicks++; }
          if (after && dir === 'asc' && after.indexOf('desc') !== -1) { headers[h].click(); clicks++; }
          return { found: true, matched: (headers[h].textContent || '').trim(), clicks: clicks, before: current, after: headers[h].getAttribute('aria-sort') };
        }
      }
      return { found: false, available: headers.slice(0, 30).map(function(e){return (e.textContent||'').trim()}) };
    })()
  `);
  if (!result.found) throw new Error(`Column "${column}" not found. Available headers: ${JSON.stringify(result.available || [])}`);
  await new Promise(r => setTimeout(r, 400));
  return { success: true, column: result.matched, direction, sort_state_after: result.after };
}

// ---------------------------------------------------------------------------
// 7. EXPORT TO WATCHLIST (bridge to existing watchlist tools)
// ---------------------------------------------------------------------------

export async function exportToWatchlist({ limit = 50 }) {
  const results = await getResults({ limit, offset: 0 });
  const symbols = (results.rows || []).map(r => r.symbol).filter(Boolean);
  const { add } = await import('./watchlist.js');
  const added = [];
  const failed = [];
  for (const symbol of symbols) {
    try {
      await add({ symbol });
      added.push(symbol);
    } catch (err) {
      failed.push({ symbol, error: err.message });
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return { success: true, requested: symbols.length, added: added.length, failed: failed.length, added_symbols: added, failures: failed };
}

// ---------------------------------------------------------------------------
// 8. INSPECT (diagnostic — use this when selectors break)
// ---------------------------------------------------------------------------

export async function inspect({ region = 'all', max_chars = 4000 }) {
  const data = await evaluate(`
    (function() {
      var region = ${JSON.stringify(region)};
      var max = ${max_chars};
      function trim(s) { return (s || '').substring(0, max); }
      function describe(el) {
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          data_name: el.getAttribute('data-name') || null,
          aria_label: el.getAttribute('aria-label') || null,
          role: el.getAttribute('role') || null,
          class: (el.className || '').toString().substring(0, 200),
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          html_excerpt: trim(el.outerHTML),
        };
      }
      var out = { region: region, hints: ${JSON.stringify(SELECTOR_HINTS)} };

      if (region === 'all' || region === 'panel') {
        var panelSels = ${JSON.stringify(SELECTOR_HINTS.panelRoot)};
        out.panel_candidates = panelSels.map(function(s) { var el = document.querySelector(s); return { selector: s, exists: !!el, visible: el ? el.offsetParent !== null : false, sample: describe(el) }; });
      }
      if (region === 'all' || region === 'tabs') {
        var tabSels = ${JSON.stringify(SELECTOR_HINTS.marketTabs)};
        var tabs = [];
        for (var s = 0; s < tabSels.length; s++) {
          var found = document.querySelectorAll(tabSels[s]);
          for (var i = 0; i < found.length && tabs.length < 12; i++) tabs.push({ selector: tabSels[s], text: (found[i].textContent || '').trim(), aria_selected: found[i].getAttribute('aria-selected') });
        }
        out.market_tabs = tabs;
      }
      if (region === 'all' || region === 'filters') {
        var fb = ${JSON.stringify(SELECTOR_HINTS.filtersBar)};
        out.filter_bars = fb.map(function(s) { var el = document.querySelector(s); return { selector: s, sample: describe(el) }; });
        var dlg = document.querySelector('[role="dialog"], [class*="dialog"]');
        out.open_dialog = describe(dlg);
      }
      if (region === 'all' || region === 'presets') {
        var ps = ${JSON.stringify(SELECTOR_HINTS.presetSelector)};
        out.preset_candidates = ps.map(function(s) { var el = document.querySelector(s); return { selector: s, sample: describe(el) }; });
      }
      if (region === 'all' || region === 'table') {
        var headers = document.querySelectorAll('[role="columnheader"], thead th');
        out.headers_sample = Array.from(headers).slice(0, 25).map(function(h) { return { text: (h.textContent || '').trim(), aria_sort: h.getAttribute('aria-sort'), data_name: h.getAttribute('data-name') }; });
        var rows = document.querySelectorAll('[data-rowkey], [data-name="screener-table-row"], tr[data-symbol-full]');
        out.rows_sample = Array.from(rows).slice(0, 3).map(describe);
      }
      out.bottomWidgetBar_methods = (function() {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        if (!bwb) return null;
        return Object.keys(bwb).filter(function(k){ return typeof bwb[k] === 'function'; }).slice(0, 50);
      })();
      return out;
    })()
  `);
  return { success: true, ...data };
}
