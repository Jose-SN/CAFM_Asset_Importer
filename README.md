# CAFM Asset + PPM Importer

Chrome extension (Manifest V3) that automates Concept Evolution CAFM asset and PPM creation from an Excel workbook.

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
4. If PPM **New** button is not detected, use **Teach New** once on the PPM register page
5. Click **Start Automatic** (or manual step-through buttons)
6. On failure: **do not clear session** → **Download diagnostic JSON** + **Download CSV log**

## Architecture (v8.0.13+)

```
src/
  bootstrap.js            — CAFMImporter namespace
  runtime/host.js         — dependency injection bridge (CI.runtime.bind)
  core/
    constants.js          — version, storage keys, page URL patterns
    text.js               — clean, norm, uniqueId
    dom.js                — visible, wait, dispatchClick, isAssistantElement
    lookup-spec.js        — makeLookupSpec, splitLookupValue
    pages.js              — isAssetPage, isPpmListPage, URL builders
    storage.js            — chrome.storage + IndexedDB workbook I/O
  data/
    ppm.js                — linkedForAsset, sourceIssues (0..N PPMs per asset)
  pages/
    ppm-mappings.js       — ppmDirectMapping, ppmLookupMapping (declarative field maps)
    ppm-register.js       — findNewButton, processPpmListPage (# parent register)
    ppm-editor.js         — fillPpm*, validatePpmPageBeforeSave, processPpmItemPage
    registry.js           — page handler metadata
  workflow/
    phases.js             — automation phase constants
content.js                — UI panel, lookup engine, asset workflow, runtime bind
background.js             — tab lifecycle (PPM parent/child)
xlsx_reader.js            — XLSX parser
asset_rules.js            — shared validation
```

**Extracted:** PPM register + PPM editor page handlers. **Still in content.js:** asset fill, activation, workflow engine (`runAutomatic`), UI panel.

## Troubleshooting

See [ISSUE_TRACKING.md](ISSUE_TRACKING.md) for phase-based error isolation and the automation state diagram.
