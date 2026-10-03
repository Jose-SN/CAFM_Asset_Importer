# v8.0.25
- Fix **PPM register refresh storm**: guard repeat Refresh clicks until one cycle finishes; fix fall-through after `ppm_parent_refresh_wait`; require visible Refresh/Create New buttons.
- **Debounce** MutationObserver and `scheduleAuto` during `ppm_parent_refresh`, `ppm_parent_refresh_wait`, and `ppm_wait_new` (longer minimum delays, fewer session writes).
- **Background orchestrator** runs only when the workflow tab is **not focused** (`backgroundOrchestratorOnlyWhenHidden`, default on) — avoids double-firing with the content script while you watch the page.
- Throttle diagnostic events (`ppm-child-check`, refresh checks) and stop persisting session on every child poll.

# v8.0.24
- Panel **resize** (bottom-right grip); width/height remembered in settings.
- **Summary** and **Details** views with header tabs; Summary shows KPIs and quick actions, Details has full controls.
- **Asset list (home)** button on Summary; extension **popup** updated with navigation to asset list and New Entity.

# v8.0.23
- When automatic **iteration** or the full **workbook** run finishes: open **General** on the last asset, click **Save**, show a completion message, expand the importer panel, and navigate to the **asset list** page.

# v8.0.22
- Fix **Extension context invalidated** uncaught errors after reloading the extension: storage APIs now detect a dead extension context, stop automatic import safely, and show a clear “press F5” message instead of console promise rejections.

# v8.0.21
- After all PPMs: reliably open **General** tab before the next asset — including from the separate PPM register page (navigate to saved asset General URL).
- **Save and New** between assets: wait for General tab to be selected, brief settle delay, up to 5 click attempts; improved button detection for CAFM’s Save and New menu item.
- Added **[USER_GUIDE.md](USER_GUIDE.md)** — plain-language operator manual (no technical background required).

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
