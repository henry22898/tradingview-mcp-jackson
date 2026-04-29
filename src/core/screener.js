/**
 * Core Screener logic for TradingView Desktop 3.1+.
 *
 * The Screener in TV 3.1 is a side/dialog panel (NOT a bottom widget).
 * It is opened via the toolbar button [data-name="screener-dialog-button"]
 * and rendered into a container with class "screenerContainer-<hash>".
 *
 * Selectors verified against live build 3.1.0.7818 (April 2026).
 * Update SELECTOR_HINTS below if TradingView ships UI changes — every other
 * function reads from it.
 */
import { evaluate, getClient } from '../connection.js';

// Selector hints — verified against live TV 3.1.0.7818.
// Hash-suffixed class names use [class*="<prefix>"] partial match.
const SELECTOR_HINTS = {
  // Toolbar button that toggles the screener panel open/closed.
  toggleButton: '[data-name="screener-dialog-button"]',
  // Root container of the open screener panel (visible only when open).
  panelRoot: '[class*="screenerContainer"]',
  // Topbar inside the screener (holds screen-name, save, filter, settings).
  topbar: '[class*="topbar-"]',
  // The screen-name button — clicking it opens the screen/preset picker.
  // Also serves as the "active screen" label.
  screenNameButton: '[data-name="screener-topbar-screen-title"]',
  // Save button (only visible when there are unsaved filter changes).
  saveButton: '[class*="saveScreenButton-"]',
  // Active filter pills — each represents one applied filter.
  filterPill: '[data-name^="screener-filter-pill-"]',
  // Result rows — data-rowkey holds the full symbol like "NYSE:GM".
  resultRow: 'tr[data-rowkey]',
  // Column headers (also the first <tr> in the table).
  columnHeader: 'thead th',
  // First-cell ticker wrapper.
  tickerCell: '[class*="tickerCell-"]',
};

// ---------------------------------------------------------------------------
// 1. OPEN / CLOSE
// ---------------------------------------------------------------------------

async function isPanelVisible() {
  return await evaluate(`
    (function() {
      var el = document.querySelector('${SELECTOR_HINTS.panelRoot}');
      return !!(el && el.offsetParent !== null && el.offsetWidth > 100);
    })()
  `);
}

export async function open({ market } = {}) {
  const alreadyOpen = await isPanelVisible();
  if (!alreadyOpen) {
    const clicked = await evaluate(`
      (function() {
        var btn = document.querySelector('${SELECTOR_HINTS.toggleButton}');
        if (!btn) return { found: false };
        btn.click();
        return { found: true, aria_pressed: btn.getAttribute('aria-pressed') };
      })()
    `);
    if (!clicked.found) {
      throw new Error('Screener toggle button [data-name="screener-dialog-button"] not found in toolbar.');
    }
    await new Promise(r => setTimeout(r, 700));
  }

  const visible = await evaluate(`
    (function() {
      var el = document.querySelector('${SELECTOR_HINTS.panelRoot}');
      if (!el || el.offsetParent === null) return null;
      var rect = el.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) };
    })()
  `);

  if (!visible) {
    throw new Error('Screener panel did not become visible after click. Run screener_inspect for debugging.');
  }

  const state = await getStateInternal();

  // Note: market switching in TV 3.1 is encapsulated by saved screens (presets).
  // Each screen is bound to a market type. To "switch to crypto", load a crypto
  // screen via screener_load_preset rather than calling screener_set_market.
  if (market) {
    return {
      success: true,
      opened: true,
      already_open: alreadyOpen,
      panel: visible,
      market_note: 'In TV 3.1 market type is bound to the active screen. Use screener_load_preset with a screen saved for the desired market instead of screener_set_market.',
      state,
    };
  }

  return { success: true, opened: true, already_open: alreadyOpen, panel: visible, ...state };
}

export async function close() {
  const visible = await isPanelVisible();
  if (!visible) return { success: true, closed: true, was_open: false };
  const r = await evaluate(`
    (function() {
      var btn = document.querySelector('${SELECTOR_HINTS.toggleButton}');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  if (!r) throw new Error('Screener toggle button not found.');
  await new Promise(r => setTimeout(r, 400));
  return { success: true, closed: true, was_open: true };
}

// ---------------------------------------------------------------------------
// 2. STATE / READ
// ---------------------------------------------------------------------------

async function getStateInternal() {
  return await evaluate(`
    (function() {
      var sc = document.querySelector('${SELECTOR_HINTS.panelRoot}');
      if (!sc || sc.offsetParent === null) return { open: false };

      var titleEl = sc.querySelector('${SELECTOR_HINTS.screenNameButton}');
      var screenName = titleEl ? (titleEl.textContent || '').trim() : null;

      var pills = sc.querySelectorAll('${SELECTOR_HINTS.filterPill}');
      var filterCount = pills.length;
      var pillTexts = Array.from(pills).slice(0, 30).map(function(p) {
        return (p.textContent || '').trim().slice(0, 50);
      });

      var headers = sc.querySelectorAll('${SELECTOR_HINTS.columnHeader}');
      var columns = Array.from(headers).map(function(h) {
        return {
          name: (h.textContent || '').trim(),
          sort: h.getAttribute('aria-sort') || null,
        };
      });

      var rows = sc.querySelectorAll('${SELECTOR_HINTS.resultRow}');

      var saveBtn = sc.querySelector('${SELECTOR_HINTS.saveButton}');
      var unsaved = saveBtn ? !/hidden/i.test(saveBtn.className || '') : false;

      return {
        open: true,
        screen_name: screenName,
        unsaved_changes: unsaved,
        filter_count: filterCount,
        active_filters: pillTexts,
        column_count: columns.length,
        columns: columns,
        result_count: rows.length,
      };
    })()
  `);
}

export async function getState() {
  const state = await getStateInternal();
  return { success: true, ...state };
}

export async function getResults({ limit = 50, offset = 0, columns } = {}) {
  const max = Math.min(Math.max(limit, 1), 200);
  const start = Math.max(offset, 0);
  const data = await evaluate(`
    (function() {
      var sc = document.querySelector('${SELECTOR_HINTS.panelRoot}');
      if (!sc || sc.offsetParent === null) return { open: false };

      var headers = sc.querySelectorAll('${SELECTOR_HINTS.columnHeader}');
      var headerNames = Array.from(headers).map(function(h) { return (h.textContent || '').trim(); });

      var rows = sc.querySelectorAll('${SELECTOR_HINTS.resultRow}');
      var requested = ${JSON.stringify(columns || null)};
      var keep = null;
      if (requested && requested.length) {
        keep = {};
        for (var k = 0; k < requested.length; k++) keep[requested[k].toLowerCase()] = true;
      }

      var start = ${start}, max = ${max};
      var end = Math.min(rows.length, start + max);
      var out = [];
      for (var r = start; r < end; r++) {
        var row = rows[r];
        var symbol = row.getAttribute('data-rowkey'); // e.g. "NYSE:GM"
        var cells = row.querySelectorAll('td');
        var record = { symbol: symbol };
        for (var c = 0; c < cells.length && c < headerNames.length; c++) {
          var col = headerNames[c] || ('col_' + c);
          if (keep && !keep[col.toLowerCase()]) continue;
          record[col] = (cells[c].textContent || '').trim();
        }
        out.push(record);
      }
      return { open: true, total: rows.length, returned: out.length, columns: headerNames, rows: out };
    })()
  `);
  if (!data.open) throw new Error('Screener panel is not open. Call screener_open first.');
  return { success: true, total: data.total, returned: data.returned, offset: start, limit: max, columns: data.columns, rows: data.rows };
}

// ---------------------------------------------------------------------------
// 3. SCREEN PICKER (a "screen" in TV 3.1 is the modern equivalent of a preset)
// ---------------------------------------------------------------------------

async function openScreenPicker() {
  const r = await evaluate(`
    (function() {
      var btn = document.querySelector('${SELECTOR_HINTS.screenNameButton}');
      if (!btn) return { found: false };
      btn.click();
      return { found: true };
    })()
  `);
  if (!r.found) throw new Error('Screen name button not found. Is the screener open?');
  await new Promise(r => setTimeout(r, 500));
}

async function closeAnyDialog() {
  try {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });
  } catch { /* ignore */ }
}

export async function listPresets() {
  await openScreenPicker();
  const items = await evaluate(`
    (function() {
      // The screen picker renders as a dropdown / popup — match the most likely containers
      var menus = document.querySelectorAll('[role="menu"], [role="listbox"], [class*="menuWrap"], [class*="popup"], [class*="dropdown"]');
      var bestMenu = null, bestArea = 0;
      for (var i=0;i<menus.length;i++) {
        var m = menus[i];
        if (m.offsetParent === null) continue;
        var rect = m.getBoundingClientRect();
        var area = rect.width * rect.height;
        if (area > bestArea && rect.width > 200) { bestArea = area; bestMenu = m; }
      }
      if (!bestMenu) return { found: false };
      var entries = bestMenu.querySelectorAll('[role="menuitem"], [role="option"], li, button, a');
      var out = [];
      for (var i=0;i<entries.length;i++) {
        var t = (entries[i].textContent || '').trim();
        if (t && t.length < 100 && entries[i].offsetParent !== null) out.push({ name: t });
      }
      // De-dupe consecutive duplicates
      var unique = [];
      for (var j=0;j<out.length;j++) {
        if (unique.length === 0 || unique[unique.length-1].name !== out[j].name) unique.push(out[j]);
      }
      return { found: true, presets: unique.slice(0, 60) };
    })()
  `);
  await closeAnyDialog();
  if (!items.found) return { success: false, error: 'Screen picker did not appear. Try screener_inspect with region="presets".', presets: [] };
  return { success: true, count: items.presets.length, presets: items.presets };
}

export async function loadPreset({ name }) {
  await openScreenPicker();
  const result = await evaluate(`
    (function() {
      var target = ${JSON.stringify(name)}.toLowerCase();
      var menus = document.querySelectorAll('[role="menu"], [role="listbox"], [class*="menuWrap"], [class*="popup"], [class*="dropdown"]');
      var bestMenu = null, bestArea = 0;
      for (var i=0;i<menus.length;i++) {
        var m = menus[i];
        if (m.offsetParent === null) continue;
        var rect = m.getBoundingClientRect();
        var area = rect.width * rect.height;
        if (area > bestArea && rect.width > 200) { bestArea = area; bestMenu = m; }
      }
      if (!bestMenu) return { found: false, error: 'screen picker not visible' };
      var entries = bestMenu.querySelectorAll('[role="menuitem"], [role="option"], li, button, a');
      var available = [];
      for (var i=0;i<entries.length;i++) {
        var t = (entries[i].textContent || '').trim();
        if (!t || entries[i].offsetParent === null) continue;
        available.push(t.slice(0, 60));
        if (t.toLowerCase() === target || t.toLowerCase().indexOf(target) !== -1) {
          entries[i].click();
          return { found: true, matched: t };
        }
      }
      return { found: false, available: available.slice(0, 30) };
    })()
  `);
  if (!result.found) {
    await closeAnyDialog();
    throw new Error(`Screen "${name}" not found. Available: ${JSON.stringify(result.available || [])}`);
  }
  await new Promise(r => setTimeout(r, 1000));
  return { success: true, loaded: true, screen: result.matched };
}

// ---------------------------------------------------------------------------
// 4. MARKET SWITCH (deprecated in TV 3.1 architecture)
// ---------------------------------------------------------------------------

export async function setMarket({ market }) {
  // In TV 3.1, market type is encapsulated by the active screen. To "switch
  // markets" the user (or Claude via screener_load_preset) loads a screen
  // configured for that market. This function returns guidance rather than
  // attempting a click that has no clear analogue.
  return {
    success: false,
    deprecated: true,
    market_requested: market,
    explanation: 'TradingView 3.1 binds market type to saved screens. Use screener_load_preset with the name of a screen saved for ' + market + ' instead.',
  };
}

// ---------------------------------------------------------------------------
// 5. SORTING
// ---------------------------------------------------------------------------

export async function sortByColumn({ column, direction = 'desc' }) {
  const result = await evaluate(`
    (function() {
      var sc = document.querySelector('${SELECTOR_HINTS.panelRoot}');
      if (!sc) return { found: false, error: 'screener not open' };
      var col = ${JSON.stringify(column)}.toLowerCase();
      var dir = ${JSON.stringify(direction)};
      var headers = sc.querySelectorAll('${SELECTOR_HINTS.columnHeader}');
      for (var h = 0; h < headers.length; h++) {
        var name = (headers[h].textContent || '').trim().toLowerCase();
        if (name === col || name.indexOf(col) !== -1) {
          var clickable = headers[h].querySelector('button, [role="button"]') || headers[h];
          var before = headers[h].getAttribute('aria-sort');
          clickable.click();
          var after = headers[h].getAttribute('aria-sort');
          var clicks = 1;
          if (after && dir === 'desc' && /asc/i.test(after)) { clickable.click(); clicks++; }
          if (after && dir === 'asc' && /desc/i.test(after)) { clickable.click(); clicks++; }
          return { found: true, matched: (headers[h].textContent || '').trim(), clicks: clicks, before: before, after: headers[h].getAttribute('aria-sort') };
        }
      }
      return { found: false, available: Array.from(headers).slice(0, 30).map(function(e){return (e.textContent||'').trim()}) };
    })()
  `);
  if (!result.found) {
    throw new Error(`Column "${column}" not found. Available: ${JSON.stringify(result.available || [])}`);
  }
  await new Promise(r => setTimeout(r, 400));
  return { success: true, column: result.matched, direction, sort_state: result.after };
}

// ---------------------------------------------------------------------------
// 6. FILTERING — limited; recommend saved screens
// ---------------------------------------------------------------------------

export async function clearFilters() {
  // TV 3.1 has no single "Reset" button on the screener topbar — filters are
  // managed via the screen picker (load a preset with no filters) or by
  // clicking individual filter pills and removing them.
  const r = await evaluate(`
    (function() {
      var pills = document.querySelectorAll('${SELECTOR_HINTS.filterPill}');
      var removed = 0;
      pills.forEach(function(p) {
        // Filter pills typically have a × close icon as a child
        var x = p.querySelector('[class*="close"], [class*="remove"]');
        if (x) { x.click(); removed++; }
      });
      return { removed: removed, total_pills: pills.length };
    })()
  `);
  return {
    success: true,
    cleared: r.removed,
    total: r.total_pills,
    note: r.removed === 0 ? 'No removable filter pills found. To clear all filters, use screener_load_preset with a screen that has no filters (e.g., the default "All Stocks").' : undefined,
  };
}

export async function applyFilter({ column, operator, value, value2 }) {
  // Programmatic filter application against the TV 3.1 screener filter UI is
  // unreliable per build. The recommended workflow is:
  //   1. Build the filter set you want manually in TradingView once.
  //   2. Save it as a screen.
  //   3. Call screener_load_preset by name from Claude.
  return {
    success: false,
    not_implemented: true,
    column, operator, value, value2,
    recommendation: 'Save your filter set as a TradingView screen, then load it via screener_load_preset. Programmatic filter application is not implemented for TV 3.1.',
  };
}

// ---------------------------------------------------------------------------
// 7. EXPORT TO WATCHLIST
// ---------------------------------------------------------------------------

export async function exportToWatchlist({ limit = 50 } = {}) {
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
// 8. INSPECT (diagnostic)
// ---------------------------------------------------------------------------

export async function inspect({ region = 'all', max_chars = 4000 } = {}) {
  const data = await evaluate(`
    (function() {
      var region = ${JSON.stringify(region)};
      var max = ${max_chars};
      var sc = document.querySelector('${SELECTOR_HINTS.panelRoot}');
      var out = { selector_hints: ${JSON.stringify(SELECTOR_HINTS)}, region: region, panel_visible: !!(sc && sc.offsetParent !== null) };

      if (!sc) {
        out.note = 'Screener panel root not found in DOM. Run screener_open first.';
        return out;
      }

      var rect = sc.getBoundingClientRect();
      out.panel = { class: sc.className.slice(0,150), rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } };

      if (region === 'all' || region === 'topbar') {
        var topbar = sc.querySelector('${SELECTOR_HINTS.topbar}');
        if (topbar) {
          out.topbar_class = topbar.className.slice(0, 120);
          out.topbar_buttons = Array.from(topbar.querySelectorAll('button, [role="button"], [data-name]')).slice(0, 15).map(function(b) {
            return {
              tag: b.tagName.toLowerCase(),
              dn: b.getAttribute('data-name'),
              al: b.getAttribute('aria-label'),
              text: (b.textContent || '').trim().slice(0, 30),
              cls: (b.className || '').slice(0, 80),
            };
          });
        }
      }
      if (region === 'all' || region === 'table') {
        var headers = sc.querySelectorAll('${SELECTOR_HINTS.columnHeader}');
        out.columns = Array.from(headers).map(function(h) {
          return { name: (h.textContent || '').trim(), sort: h.getAttribute('aria-sort'), data_name: h.getAttribute('data-name') };
        });
        var rows = sc.querySelectorAll('${SELECTOR_HINTS.resultRow}');
        out.row_count = rows.length;
        out.rows_sample = Array.from(rows).slice(0, 3).map(function(r) {
          return { symbol: r.getAttribute('data-rowkey'), text: (r.textContent || '').trim().slice(0, 200) };
        });
      }
      if (region === 'all' || region === 'filters') {
        var pills = sc.querySelectorAll('${SELECTOR_HINTS.filterPill}');
        out.filter_count = pills.length;
        out.filter_samples = Array.from(pills).slice(0, 10).map(function(p) {
          return { dn: p.getAttribute('data-name'), text: (p.textContent || '').trim().slice(0, 60) };
        });
      }
      if (region === 'all' || region === 'screen') {
        var nameBtn = sc.querySelector('${SELECTOR_HINTS.screenNameButton}');
        out.active_screen = nameBtn ? (nameBtn.textContent || '').trim() : null;
      }
      return out;
    })()
  `);
  return { success: true, ...data };
}
