# CAFM Smoke Test Runbook (v8.0.13)

Run these three scenarios on live Concept Evolution after reloading the extension (`chrome://extensions` → Reload).

**Before each run:** load the test workbook, confirm preflight in the panel, do not change the workbook mid-run.

---

## Scenario 1 — One asset, zero PPMs

**Workbook:** one `CAFM Import` row with `Import? = YES`, Asset Code `WCH-…`, no linked rows on `CAFM PPM Import`.

| Step | Expected |
|------|----------|
| Open Asset **New Entity** (`id=-1`) | Panel visible |
| Start Automatic | Preflight toast; phase progresses `fill` → `saving` → `await_save` |
| Asset saves | URL gains entity `id=` |
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
| PPM 1 | + New → editor → fill → Save → PPM Status **Active** → child tab closes → parent register |
| PPM 2 | + New clicked again on **same** parent register → second PPM saved and activated |
| Panel | PPM progress shows `1/2` then `2/2` |
| Finish | `complete` or next asset |

**Pass if:** both PPM rows created and ACTIVE; parent register retained between PPMs; no duplicate orphan register tabs left open.

---

## Scenario 3 — Fire-door PPM exact path

**Workbook:** asset + one PPM row whose Instruction matches fire-door pattern (uses fire-door search terms in `ppm-mappings.js` / `lookup.js`).

| Step | Expected |
|------|----------|
| Asset cycle completes | PPM register opens |
| PPM fill | Contract + Instruction lookups use fire-door search terms |
| Save + activate | PPM reaches ACTIVE |

**Pass if:** fire-door instruction resolves without lookup timeout; PPM saves and activates.

---

## Session resume check (all scenarios)

1. Start automatic on asset 1; wait until phase is mid-fill or `await_save`.
2. **Refresh the browser tab** (F5).
3. Expected: panel restores workbook; auto-state shows active phase; workflow continues within ~30s without clicking Start again.

---

## On failure

1. Do **not** clear session.
2. Download **diagnostic JSON** + **CSV log**.
3. Note phase name from panel auto-state line.
4. See [ISSUE_TRACKING.md](ISSUE_TRACKING.md) for phase → cause mapping.

---

## Static checks (before live test)

```bash
node tools/verify-modules.js
node tools/verify-architecture.js
node tools/test-pure-modules.js
node tools/test-bootstrap-load.js
```

All four must exit 0.
