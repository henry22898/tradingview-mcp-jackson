import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/screener.js';

const MARKET = z.enum(['stock', 'crypto', 'forex', 'cfd', 'coin']);

export function registerScreenerTools(server) {
  server.tool(
    'screener_open',
    'Open the TradingView Screener bottom panel. Optionally switch to a specific market (stock/crypto/forex/cfd/coin) in one step.',
    {
      market: MARKET.optional().describe('Optional market to select after opening: stock, crypto, forex, cfd, coin'),
    },
    async ({ market }) => {
      try { return jsonResult(await core.open({ market })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool('screener_close', 'Close the TradingView Screener panel', {}, async () => {
    try { return jsonResult(await core.close()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'screener_set_market',
    'Switch the open Screener to a different market type (stock, crypto, forex, cfd, coin)',
    { market: MARKET.describe('Target market type') },
    async ({ market }) => {
      try { return jsonResult(await core.setMarket({ market })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_get_state',
    'Get the current Screener state: market, active preset, visible columns, applied filter pills, total result count.',
    {},
    async () => {
      try { return jsonResult(await core.getState()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_get_results',
    'Read the current Screener result rows. Returns symbol + every visible column value. Capped at 200 rows per call.',
    {
      limit: z.coerce.number().int().min(1).max(200).optional().describe('Max rows to return (default 50, max 200)'),
      offset: z.coerce.number().int().min(0).optional().describe('Offset into the result table (default 0)'),
      columns: z.array(z.string()).optional().describe('Optional whitelist of column names to include in the response'),
    },
    async ({ limit, offset, columns }) => {
      try { return jsonResult(await core.getResults({ limit, offset, columns })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_list_presets',
    'List the user-saved Screener presets (saved filter sets). Opens and closes the preset dropdown to read the menu items.',
    {},
    async () => {
      try { return jsonResult(await core.listPresets()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_load_preset',
    'Load a saved Screener preset by name. Most reliable way to apply complex filters — set them up once in TradingView, then call by name.',
    {
      name: z.string().describe('Preset name to load (case-insensitive substring match)'),
    },
    async ({ name }) => {
      try { return jsonResult(await core.loadPreset({ name })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_apply_filter',
    'Programmatically apply a single column filter. NOTE: TradingView\'s filter UI varies by build — for reliable filtering prefer screener_load_preset on a saved preset. This tool returns partial=true and locates the filter row; granular value-setting may need follow-up via ui_keyboard / ui_evaluate.',
    {
      column: z.string().describe('Column name to filter (e.g., "Market Cap", "P/E Ratio", "RSI")'),
      operator: z.enum(['above', 'below', 'between', 'equals', 'crossing_up', 'crossing_down']).describe('Comparison operator'),
      value: z.union([z.number(), z.string()]).describe('Primary value (number or string)'),
      value2: z.union([z.number(), z.string()]).optional().describe('Second value for "between" operator'),
    },
    async ({ column, operator, value, value2 }) => {
      try { return jsonResult(await core.applyFilter({ column, operator, value, value2 })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_clear_filters',
    'Reset all Screener filters back to the default empty state (clicks Reset/Clear in the filter bar).',
    {},
    async () => {
      try { return jsonResult(await core.clearFilters()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_sort',
    'Sort the Screener results by a column header. Direction defaults to descending.',
    {
      column: z.string().describe('Column name to sort by (e.g., "Volume", "Change %", "Market Cap")'),
      direction: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: desc)'),
    },
    async ({ column, direction }) => {
      try { return jsonResult(await core.sortByColumn({ column, direction })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_export_to_watchlist',
    'Push the top N Screener results into the active TradingView watchlist so the rest of the toolset (chart_set_symbol, batch_run, data_get_*) can act on them. Adds symbols one by one with a small delay between each.',
    {
      limit: z.coerce.number().int().min(1).max(200).optional().describe('How many top results to add (default 50, max 200)'),
    },
    async ({ limit }) => {
      try { return jsonResult(await core.exportToWatchlist({ limit })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_inspect',
    'Diagnostic: dump live DOM samples from the Screener panel. Use this when other screener_* tools fail with "not found" — the output reveals what selectors actually exist in your TradingView build, so SELECTOR_HINTS in src/core/screener.js can be updated.',
    {
      region: z.enum(['all', 'panel', 'tabs', 'filters', 'presets', 'table']).optional().describe('Which region to inspect (default: all)'),
      max_chars: z.coerce.number().int().min(100).max(20000).optional().describe('Max HTML characters per sample (default 4000)'),
    },
    async ({ region, max_chars }) => {
      try { return jsonResult(await core.inspect({ region, max_chars })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
