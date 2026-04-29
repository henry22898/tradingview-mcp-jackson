# Screener tools — live-DOM iteration plan

The screener module ships with best-effort selectors based on the existing
patterns in this codebase. Because I had no live TradingView session to probe
against while writing it, some selectors will need to be confirmed (or
swapped) on first use against your real build.

This file is the playbook for closing that loop.

## Files added

- `src/core/screener.js` — implementation. All DOM selectors are centralized
  in the `SELECTOR_HINTS` object at the top of the file.
- `src/tools/screener.js` — MCP tool definitions (zod schemas + thin wrappers).
- `src/server.js` — registers `registerScreenerTools(server)`.

## Tools shipped (12)

| Tool | Status | Confidence |
|---|---|---|
| `screener_open` | ready | high (uses bottomWidgetBar like other bottom panels) |
| `screener_close` | ready | high |
| `screener_set_market` | ready | medium (relies on `[role=tab]` text match) |
| `screener_get_state` | ready | medium |
| `screener_get_results` | ready | medium |
| `screener_list_presets` | ready | medium (depends on preset dropdown selector) |
| `screener_load_preset` | ready | medium — **the most reliable filter path** |
| `screener_apply_filter` | partial | low (locates row only; granular value-set is fragile) |
| `screener_clear_filters` | ready | medium |
| `screener_sort` | ready | high (column header click is universal) |
| `screener_export_to_watchlist` | ready | medium (depends on screener_get_results + watchlist add) |
| `screener_inspect` | ready | high — **use this first to verify selectors** |

## First-run procedure

1. **Launch TradingView Desktop with CDP enabled.**
   Run `scripts\launch_tv_debug.bat` (Windows) or use `tv_launch` from Claude.
   Verify by visiting <http://localhost:9222/json> in any browser.

2. **Restart Claude Code** so the new MCP server is picked up.

3. **Smoke test the connection:**

   ```
   call tv_health_check
   ```

   Should return `{ chart_ready: true, ... }`.

4. **Open the Screener and dump its real DOM:**

   ```
   call screener_open
   call screener_inspect with region="all" max_chars=6000
   ```

   The inspect output reveals what `data-name`, `class`, and tab labels
   TradingView's current build actually uses.

5. **Compare against `SELECTOR_HINTS` in `src/core/screener.js`** and update
   the arrays for any region whose `panel_candidates` / `market_tabs` /
   `preset_candidates` came back empty or wrong. Then re-run inspect.

6. **Test each tool incrementally** in this order — each depends on the
   previous one working:

   ```
   screener_open
   screener_get_state          → verify market + columns + result count
   screener_set_market crypto  → verify market switch
   screener_sort column="Volume" direction="desc"
   screener_get_results limit=10
   screener_list_presets       → see what user-saved presets exist
   screener_load_preset name="<one of the listed names>"
   screener_export_to_watchlist limit=5
   ```

7. **For complex filtering**, the recommended workflow is **save the filter
   as a TradingView preset once**, then drive it from Claude via
   `screener_load_preset`. The `screener_apply_filter` tool can locate filter
   rows but reliable value-setting in TradingView's filter dialog requires
   per-build selector tuning.

## When something breaks

The `screener_inspect` tool returns:

- `panel_candidates[]` — which `panelRoot` selectors hit
- `market_tabs[]` — what tab text the page actually uses
- `headers_sample[]` — column header names + their `aria-sort` state
- `rows_sample[]` — sample row HTML so you can see how rows are structured
- `bottomWidgetBar_methods[]` — full method list to find the right widget name

Drop the relevant excerpts into a new conversation with Claude and ask:

> "Update SELECTOR_HINTS in src/core/screener.js based on this inspect output."

## Recommended Claude prompt for the full screener workflow

Once the basic tools pass smoke-test, this is the kind of one-liner the
user can give Claude to get the end-to-end "filter universe → analyze →
report" workflow described in the original brief:

> *"Open the stock screener, load my preset called 'Earnings Beat',
> sort by volume descending, take the top 20, push them into a watchlist
> called 'Today's Plays', then for each one read the RSI and 200-EMA and
> tell me which ones are oversold but trading above the 200-EMA."*

This composes:
- `screener_open market="stock"`
- `screener_load_preset name="Earnings Beat"`
- `screener_sort column="Volume" direction="desc"`
- `screener_get_results limit=20`  (Claude reads the JSON)
- `screener_export_to_watchlist limit=20`
- For each symbol: `chart_set_symbol` + `data_get_study_values`
- Claude composes the report

## Pine Screener (future)

The newer "Pine Screener" tab lets users run custom Pine code across many
symbols and read structured results. It's intentionally not covered in
this first cut — a follow-up `screener_run_pine` tool would wrap it.
