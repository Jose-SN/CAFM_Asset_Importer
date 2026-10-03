# v8.0.15
- Fix panel not appearing on New Entity (`ViewFASSETItem.aspx?id=-1`): `restoreState()` ran before `configureWorkbook()` and threw; the error was swallowed so `injectPanel()` never ran.
- Show the importer panel on the Asset list page (`ViewFASSETItems.aspx`) so workbooks can be loaded before clicking + New.
- Log init failures to the console and show an in-panel error toast instead of failing silently.

## v8.0.14
- Asset workflow: after save, close the asset editor child window, return to parent, open saved asset, then Change Asset Status → Active.
- PPM workflow: after save, close the PPM editor child window immediately (PPM traffic-light activation temporarily disabled via `PPM_ACTIVATION_ENABLED = false`).
- Background handler `ASSET_CLOSE_EDITOR_TAB` and message `EE_ASSET_EDITOR_CLOSED` coordinate parent focus and activation resume.
- Message listeners initialize on all Concept pages so parent tabs receive close/resume events even off workflow URLs.

## v8.0.13
- Begin modular architecture: extract core modules under `src/` (constants, text, DOM, lookup-spec, pages, storage, workflow phases, runtime host).
- Extract PPM page handlers to `src/pages/ppm-register.js` and `src/pages/ppm-editor.js` (New button detection, fill/validate/save loop, processPpmListPage, processPpmItemPage).
- Extract PPM field mappings to `src/pages/ppm-mappings.js` and PPM data helpers to `src/data/ppm.js`.
- `content.js` binds runtime dependencies via `CI.runtime.bind()` and delegates to extracted modules.
- Expand README with workbook column reference and operator runbook.
- Add automation state diagram to ISSUE_TRACKING.md.
- No automation behaviour changes intended.

## v8.0.12
- PPM parent identity is now determined by the trailing `#` in `ViewFASSETItemPPMs.aspx?...#`.
- PPM register tabs for the same asset without trailing `#` are closed after PPM completion.
- PPM editor tabs are closed as before.
- The surviving `#` parent is focused and receives the next Create New phase.
- Extension-generated PPM-register navigation now appends `#`.
- Non-`#` PPM register pages are passive.
- Asset save/status logic unchanged.

## v8.0.11

- After a PPM completes, close all matching PPM editor tabs plus duplicate/secondary PPM register tabs for the same saved Asset ID.
- Protect the originally registered parent PPM tab by its Chrome tab ID even when another register tab has an almost identical URL.
- Refocus the protected parent and resume the existing Create New loop there.
- Add candidate logging with `ppm-editor` vs `duplicate-ppm-register` classification.
- Asset creation, Asset Save, Change Asset Status, and PPM data-entry logic unchanged.

## v8.0.10

- After a PPM completes, close all PPM editor tabs associated with the registered parent PPM register.
- Never close the registered parent PPM tab.
- Focus the parent after all child editors are closed, then resume the existing Create New loop.
- Add diagnostics for candidate child tabs, closed tab IDs/count, and close errors.
- Asset creation, Asset Save, and Change Asset Status logic unchanged.

## v8.0.6

- Close PPM child before returning to the parent register.
- Refresh only the parent PPM register, then resume Create New for the next linked PPM.
- Add Floor, Classification, and Site Reference to Excel-backed asset fill coverage.
- Keep validation warnings non-blocking and retain detailed action logs.
- Shorten PPM transition polling without altering lookup safety timeouts.
- Asset Save and Change Asset Status logic unchanged.

# Changelog

## 8.0.0 - Event-driven resilient batch
- Added **Enable multiple asset iterations** checkbox and asset iteration count.
- Default behavior is one complete asset + linked PPM cycle, then stop.
- Removed inter-record pacing delay UI and fixed-delay decision making from the main workflow.
- Lookup/save progression is based on verified CAFM DOM/control state with safety timeouts.
- Removed unused embedded fire-door PPM templates; PPM data is workbook-driven only.
- New PPMs are always queued for **Active** status after save.
- Added structured in-session event tracking and **Download diagnostic JSON**.
- CSV audit log filenames now include extension version and timestamp.
- New v8 storage keys isolate the new session/workbook cache from stale older-run state.
- Notes and Spatial remain opt-in and are only visited when populated.

## 7.1.0
- Previous high-speed batch build.
