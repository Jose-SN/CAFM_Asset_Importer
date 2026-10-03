# CAFM Asset + PPM Importer

Chrome extension (Manifest V3) that automates Concept Evolution CAFM asset and PPM creation from an Excel workbook.

**Operators:** start with **[USER_GUIDE.md](USER_GUIDE.md)** — step-by-step instructions in plain language (no technical background required).

## What it does

1. Load an Excel workbook with asset and PPM rows
2. Open CAFM **Asset → New Entity**
3. For each enabled asset row:
   - Fill populated fields across CAFM tabs (Details, Financial/Risk, optional Notes/Spatial)
   - **Save** the asset
   - **Change Asset Status → Active**
   - For each linked PPM row (0 to many per Asset Code):
     - Click **New** on the PPM register
     - Fill PPM fields → **Save** → set PPM **Active**
     - Close editor tab, return to parent register, repeat for next PPM
4. Move to the next asset row (or stop at iteration limit)

## Workbook structure

The extension expects two sheets in the same `.xlsx` file:

### Sheet: `CAFM Import`

Optional row above headers: **Schema Version** | `CAFM Asset + PPM Import v8.0` (forward compatibility; omitted files default to v8.0).

Header row must include at least: **Asset Code**, **Building CAFM Value** (or **Building Code**), **Location Code**.

| Column | Required | Notes |
|--------|----------|-------|
| Import? | For NEW import | `YES` to include in bulk NEW import; `NO` to skip creation but keep row for PPM linking |
| Asset Code | Yes | Must start with `WCH-`; row identity |
| Description | No | Skipped if blank |
| Quantity | No | Positive number when populated |
| Building CAFM Value / Building Code | No | Lookup field |
| Location Code | No | Must start with `WCH-` when populated |
| System, Tag, Type, Name | No | CAFM lookup values (`CODE - Description` format supported) |
| Classification, Floor, Site Reference | No | |
| Parent Asset, Supplier, Cost Centre | No | Lookups |
| Condition | No | Financial/Risk tab |
| Purchase Date, Warranty Expires, Survey Date | No | DD/MM/YYYY |
| Purchase Cost, Replacement Cost, Disposal Value, Lifespan | No | Non-negative numbers |
| Reducing Balance Depreciation % | No | 0–100 |
| Operational/Health/Safety/Environmental/Actual Risk, Lease Obligation | No | |
| Notes / Comments | No | Only filled when **Include Notes** setting is enabled |
| Latitude, Longitude, Elevation, GIS Reference, External System/Object/Identifier | No | Only when **Include Spatial** is enabled |

Rows with `Asset Code = END` are ignored.

### Sheet: `CAFM PPM Import` (optional)

Header row must include: **Asset Code**, **Instruction**, **Import?**

| Column | Required | Notes |
|--------|----------|-------|
| Import? | Yes | `YES` to create this PPM |
| Asset Code | Yes* | Links PPM to asset; can inherit from same Excel row on CAFM Import sheet |
| Instruction | Yes | PPM instruction lookup |
| Contract, Family, Cost Centre | No | Lookups |
| Priority / PPM Priority | No | Defaults to `3` when blank (override in workbook or `defaultPpmPriority` setting) |
| Stock Cost, Labour Cost, Est. Staff | No | |
| Est. Time Hours / Minutes | No | |
| Permit?, H&S Task?, Controller? | No | Checkbox (`YES`/`NO`) |
| Class, Generate Task Actions, Default Day, Period, Frequency | No | |
| Last Service, Next Service | No | DD/MM/YYYY |
| January–December | No | Month checkboxes |
| Notes | No | PPM Notes tab |
| Activate after Save? | No | Defaults to activate when blank |

**0 PPM rows** for an asset → asset-only cycle (save + activate, no PPM loop).

## Operator runbook

1. Prepare workbook: validate Asset Codes (`WCH-*`), set **Import? = YES** on rows to create
2. Open Concept Evolution → navigate to **Asset New Entity** (`id=-1`)
3. Extension panel → **Load workbook** → confirm asset and PPM counts
4. Click **Start Automatic** (or manual step-through buttons)
6. On failure: **do not clear session** → **Download diagnostic JSON** + **Download CSV log**

## Architecture (v8.0.13+)

```
src/
  bootstrap.js            — CAFMImporter namespace
  content-entry.js        — IIFE bootstrap: state, configure, runtime bind, initTop
  runtime/
    host.js               — CI.runtime.bind dependency bridge
    messages.js           — background tab lifecycle message handlers
  core/
    constants.js, state.js, text.js, dom.js, events.js
    lookup-spec.js, lookup.js, toolbar.js, teach.js
    pages.js, storage.js
  data/
    ppm.js, workbook.js, records.js, preflight.js, asset-rules.js
  pages/
    asset-mappings.js, asset-new.js, asset-saved.js, asset-manual.js
    ppm-mappings.js, ppm-register.js, ppm-editor.js, ppm-status.js
    registry.js           — page handler metadata (one handler per CAFM page)
  workflow/
    phases.js, post-save.js, engine.js
  ui/panel.js             — shadow DOM panel, render, toasts
background.js             — tab lifecycle (PPM parent/child)
xlsx_reader.js            — XLSX parser
src/data/asset-rules.js   — shared validation (legacy path: asset_rules.js)
```

Each CAFM page has an isolated handler in `src/pages/`. Direct field definitions live in `src/data/field-registry.js`; lookup spec builders stay in `asset-mappings.js` / `ppm-mappings.js`. Tab fill order is controlled by `src/data/fill-profiles.js`. New Excel columns for text/checkbox fields typically need one registry line only.

**Preflight:** after loading a workbook, the panel shows row/PPM counts, validation issues, and schema version. **Resume:** if automatic import stops with an error, use Previous/Next or the row jump control, then **Resume from stopped row**.

## Troubleshooting

See [ISSUE_TRACKING.md](ISSUE_TRACKING.md) for phase-based error isolation and the automation state diagram.

Before live CAFM testing, run `powershell -File tools/dev.ps1` (or the individual `node tools/*.js` checks listed in [SMOKE_TEST.md](SMOKE_TEST.md)). Generate smoke workbooks with `node tools/generate-smoke-workbook.js`, then follow [SMOKE_TEST.md](SMOKE_TEST.md) for the three required regression scenarios.

**Dev reload loop:** Chrome does not auto-reload unpacked extensions. After code changes: `chrome://extensions` → **Reload** → **F5** on CAFM tabs. Optional: `powershell -File tools/watch-dev.ps1` prints reload reminders when you save files.
