# v8.0.30
- **Field-level progress**: snackbar shows each field being filled or selected with the actual Excel/workbook value (e.g. `Filling: Building` → `004 - Maternity Unit`). Covers asset tabs, PPM fields, checkboxes, dropdowns, notes, and lookup selections.

# v8.0.29
- **Live progress snackbar**: wider bottom toast for every workflow step — Selecting, Clicking, Waiting (with elapsed seconds), phase changes, and asset/PPM context. One snackbar stays visible during waits for easier debugging.

# v8.0.23
- PPM parent refresh dedup: coalesce duplicate `EE_PPM_CURRENT_EDITOR_CLOSED` / `EE_PPM_CHILD_DONE` notifications, skip refresh when already in-flight, and debounce background self-close notifications.
- Last PPM save-before-close: remove the 1800ms Save-and-Close assumption without a saved entity ID; resume fill/save when a child closes before save is confirmed.
- After all PPMs: navigate to the saved asset General tab before `finishPostSave` / Save and New; engine routes `ppm_cycle_general_wait` on the asset page instead of redirecting back to the PPM register.
- Waiting phases extended for refresh/close/general-wait so the orchestrator does not double-click Refresh.

# v8.0.20
- Background workflow orchestrator: `alarms` permission + periodic `RUN_AUTO_STEP` to parent/child workflow tabs so automatic import continues when the CAFM tab is unfocused or in another window.
- PPM save URL detection: background `tabs.onUpdated` detects `ViewFPPMItem.aspx?id≠-1` and notifies the child editor to record save without waiting on throttled content-script timers.
- Parent focus steal removed from PPM child close notification — workflow resumes without forcing the CAFM window to the foreground.
- Save-and-Close handoff: when PPM activation is disabled, `recordPpmResult` always calls `continuePpmAfterSave` even when entity id is not detected in the child tab.
- Hidden-tab save timeout extended via `backgroundSaveTimeoutMs` (default 90s); `visibilitychange` resumes the loop when the tab becomes visible again.
- Settings: `backgroundOrchestrator` (default on) and `backgroundOrchestratorMs` (default 2500ms).

# v8.0.19
- PPM register: refresh grid before Create New; skip existing PPMs via row scan, session dedup, and per-asset guards (same instruction on different assets still creates one PPM per asset).
- Building lookup: type short building number first and click the exact dropdown row (same pattern as PPM Instruction).
- Panel: last saved / next to save queue line; optional auto-download timeline JSON; auto-continue and Save and New between assets; teach/capture buttons removed.
- After all PPMs: General tab Save and New opens the next New Entity form when enabled.
- Timeouts tuned: 20s default safety cap, 15s PPM child wait, 8s lookup commit; duplicate-child detection faster.
- Preflight warns when the same asset has duplicate PPM instruction rows in the workbook.

## v8.0.18
- Post-refresh PPM close sweep: `PPM_SWEEP_CHILDREN` closes leftover FPPM popup tabs/windows without re-triggering parent refresh.
- Duplicate/existing PPM path: detect saved-ppm or parent-register child URLs during `ppm_wait_new`, sweep, and refresh sooner.
- Existing PPM skip now sweeps children before advancing to the next linked PPM row.
- PPM fill progress toasts and `ppm-fill-step` / `ppm-fill-complete` events with `durationMs` for lookups and fields.
- Phase events include elapsed `durationMs` between transitions; diagnostic JSON includes `timingSummary`.
- Auto-download per-asset timeline JSON (`EE_CAFM_Timeline_*.json`) when each asset cycle completes.

## v8.0.17
- Background PPM child registry: track every FPPM popup/tab by unique id (`ppm-{tabId}-{timestamp}`) in the parent workflow record.
- `PPM_EXPECT_CHILD` when parent clicks + New; register children on tab create/update even without `openerTabId`.
- `PPM_PREPARE_CLOSE` stores pending refresh/next phase before close; `PPM_CLOSE_CURRENT_EDITOR_TAB` closes all registered FPPM tabs and popup windows, then notifies parent.
- `tabs.onRemoved` notifies parent when CAFM Save and Close closes the child itself.
- PPM editor assumes save success after Save and Close when entity id is not detected in time.

## v8.0.16
- Support embedded PPM tab on saved asset pages (`ViewFASSETItem.aspx` + `fsiGridPPMs`), not only the separate `ViewFASSETItemPPMs.aspx#` register.
- After PPM save: close the editor child tab, focus the parent asset PPM tab, click Refresh, then Create New for the next linked PPM row.
- Background parent resolution falls back to registered parent tab and embedded asset editor when no hash register exists.
- PPM save prefers Save and Close (`Toolbar.SaveAndClose`) when available.
- When all PPMs are done on an embedded asset, navigate to the General tab before finishing the asset cycle.

## v8.0.15
- Fix panel not appearing on New Entity (`ViewFASSETItem.aspx?id=-1`): `restoreState()` ran before `configureWorkbook()` and threw; the error was swallowed so `injectPanel()` never ran.
- Show the importer panel on the Asset list page (`ViewFASSETItems.aspx`) so workbooks can be loaded before clicking + New.
- Log init failures to the console and show an in-panel error toast instead of failing silently.

## v8.0.14
- Asset workflow: after save, close the asset editor child window, return to parent, open saved asset, then Change Asset Status → Active.
- PPM workflow: after save, close the PPM editor child window immediately (PPM traffic-light activation temporarily disabled via `PPM_ACTIVATION_ENABLED = false`).
- Background handler `ASSET_CLOSE_EDITOR_TAB` and message `EE_ASSET_EDITOR_CLOSED` coordinate parent focus and activation resume.
- Message listeners initialize on all Concept pages so parent tabs receive close/resume events even off workflow URLs.
