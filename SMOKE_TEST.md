# CAFM Smoke Test Runbook (v8.0.15)

Run these three scenarios on live Concept Evolution after reloading the extension (`chrome://extensions` → Reload).

**Before each run:** load the test workbook, confirm preflight in the panel, do not change the workbook mid-run.

---

## Generate smoke workbooks (recommended)

```bash
node tools/generate-smoke-workbook.js
```

Creates validated workbooks under `test-fixtures/`:

| File | Scenario |
|------|----------|
| `smoke-scenario-1-zero-ppm.xlsx` | 1 asset, 0 PPM |
| `smoke-scenario-2-two-ppm.xlsx` | 1 asset, 2 PPM |
| `smoke-scenario-3-fire-door.xlsx` | 1 asset, fire-door PPM row |

Edit Contract / Instruction columns with live CAFM lookup values before scenarios 2–3.

---

## Minimal workbook templates (manual)

Create one `.xlsx` with two sheets named exactly **`CAFM Import`** and **`CAFM PPM Import`**. Use your production header row unchanged; populate only the columns below for smoke runs.

### Scenario 1 sheet rows

**CAFM Import** (one data row):

| Import? | Asset Code | Description |
|---------|------------|-------------|
| YES | WCH-SMOKE-001 | Smoke test asset zero PPM |

**CAFM PPM Import:** no `Import? = YES` rows for `WCH-SMOKE-001`.

### Scenario 2 sheet rows

**CAFM Import:**

| Import? | Asset Code | Description |
|---------|------------|-------------|
| YES | WCH-SMOKE-002 | Smoke test asset two PPM |

**CAFM PPM Import** (two rows, same Asset Code, different Instruction):

| Import? | Asset Code | Instruction |
|---------|------------|-------------|
| YES | WCH-SMOKE-002 | SMOKE-PPM-A |
| YES | WCH-SMOKE-002 | SMOKE-PPM-B |

Add Contract / Cost Centre / dates from your live CAFM lookup values if prefill requires them.

### Scenario 3 sheet rows

**CAFM Import:** same pattern as scenario 2 with `WCH-SMOKE-003`.

**CAFM PPM Import** (one row — use a real fire-door instruction string from your CAFM environment):

| Import? | Asset Code | Instruction | Contract | Last Service |
|---------|------------|-------------|----------|--------------|
| YES | WCH-SMOKE-003 | *(fire-door instruction, e.g. contains "fire door")* | *(valid contract lookup)* | *(DD/MM/YYYY)* |

---

## Scenario 1 — One asset, zero PPMs

**Workbook:** one `CAFM Import` row with `Import? = YES`, Asset Code `WCH-…`, no linked rows on `CAFM PPM Import`.

| Step | Expected |
|------|----------|
| Open Asset list or **New Entity** (`ViewFASSETItem.aspx?id=-1`) | Panel visible (list or form) |
| Start Automatic | Preflight toast; phase progresses `fill` → `saving` → `await_save` |
| Asset saves | URL gains entity `id=` |
| Editor close | Asset child window closes; parent opens saved asset |
| Activation | Change Asset Status → **Active** completes |
| Post-activation | **No** PPM register opened; cycle completes or moves to next asset |
| Panel | `complete` phase; status saved |

**Pass if:** asset ACTIVE, no PPM tabs opened, row marked saved in panel.

---

## Scenario 2 — One asset, two PPMs

**Workbook:** one asset row + **two** `CAFM PPM Import` rows with same Asset Code, `Import? = YES`, distinct Instructions.

| Step | Expected |
|------|----------|
| Full asset cycle through ACTIVE | PPM register opens (nav link or constructed URL with trailing `#`) |
| PPM 1 | + New → editor → fill → Save → child tab closes → parent register |
| PPM 2 | + New clicked again on **same** parent register → second PPM saved (no PPM status activation) |
| Panel | PPM progress shows `1/2` then `2/2` |
| Finish | `complete` or next asset |

**Pass if:** both PPM rows created and saved; parent register retained between PPMs; no duplicate orphan register tabs left open.

---

## Scenario 3 — Fire-door PPM exact path

**Workbook:** asset + one PPM row whose Instruction matches fire-door pattern (uses fire-door search terms in `ppm-mappings.js` / `lookup.js`).

| Step | Expected |
|------|----------|
| Asset cycle completes | PPM register opens |
| PPM fill | Contract + Instruction lookups use fire-door search terms |
| Save + close | PPM saves; child editor closes |

**Pass if:** fire-door instruction resolves without lookup timeout; PPM saves successfully.

---

## Session resume check (all scenarios)

### A — Browser refresh mid-run

1. Start automatic on asset 1; wait until phase is mid-fill or `await_save`.
2. **Refresh the browser tab** (F5).
3. Expected: panel restores workbook; auto-state shows active phase; workflow continues within ~30s without clicking Start again.

### B — Error / pause resume

1. Force or encounter a stop (`error` or **Pause**).
2. Use **Previous/Next** or **Jump to asset row** to select the failed row.
3. Click **Resume from stopped row** (or **Resume paused import**).
4. Expected: phase restores to `failedPhase`; run continues from that phase.

---

## On failure

1. Do **not** clear session.
2. Download **diagnostic JSON** + **CSV log**.
3. Note phase name from panel auto-state line.
4. See [ISSUE_TRACKING.md](ISSUE_TRACKING.md) for phase → cause mapping.

---

## Static checks (before live test)

```bash
# Windows (runs all checks + reload reminder):
powershell -File tools/dev.ps1

# Or individually:
node tools/verify-modules.js
node tools/verify-load-order.js
node tools/verify-architecture.js
node tools/test-pure-modules.js
node tools/test-bootstrap-load.js
node tools/test-smoke-workbooks.js
```

All six must exit 0 (or run `powershell -File tools/dev.ps1`). During development, run `powershell -File tools/watch-dev.ps1` in a second terminal for reload reminders on save.
