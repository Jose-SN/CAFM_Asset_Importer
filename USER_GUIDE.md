# CAFM Asset + PPM Importer — User Guide

This guide is for **operators** who use Concept Evolution (CAFM) day to day. You do not need to be technical to use the importer.

---

## What this tool does

The Chrome extension reads an **Excel workbook** and helps you create **assets** and their **PPMs** (planned maintenance records) in CAFM automatically.

For each asset row in your spreadsheet, it will:

1. Fill in the asset form in CAFM  
2. Save the asset  
3. Set the asset status to **Active**  
4. Create each linked PPM (if your workbook has PPM rows for that asset)  
5. Move to the **next asset** in the workbook when finished  

You stay in control: you load the workbook, start the run, and can pause or resume if needed.

---

## Before you start

### You will need

- Google Chrome with the **CAFM Asset + PPM Importer** extension installed  
- Access to **Concept Evolution** (your CAFM website)  
- An Excel file (`.xlsx`) prepared with the correct sheets and columns (see [Workbook preparation](#workbook-preparation) below)

### Install or update the extension

1. Open Chrome and go to `chrome://extensions`  
2. Find **CAFM Asset + PPM Importer**  
3. After any update, click **Reload**  
4. **Refresh (F5)** every open CAFM tab  

### Prepare CAFM

1. Log in to Concept Evolution  
2. Go to **Assets**  
3. Open **New Entity** (a blank asset form — the web address usually contains `id=-1`)  

The floating importer panel appears on CAFM asset and PPM pages.

### Panel views

| View | What it is for |
|------|----------------|
| **Summary** | Dashboard: counts, current asset, progress, Start/Pause, quick links |
| **Details** | Full workbook load, manual buttons, all settings, session downloads |

Use the **Summary** / **Details** tabs in the panel header to switch views. You can also open **Asset list (home)** from Summary to go to the main CAFM asset list.

**Resize:** drag the small grip at the bottom-right corner of the panel. **Move:** drag the header bar.

Click the extension icon in Chrome for a popup with shortcuts to the **asset list** and **New Entity** page.

---

## Quick start — your first automatic run

### Step 1 — Load your workbook

1. On the importer panel, click **Load workbook…** (Summary) or choose a file under **Workbook** (Details)  
2. Select your `.xlsx` file  
3. Wait for the **Reading workbook…** message — large files can take 30–60 seconds; buttons are disabled until loading finishes  
4. Check the counts shown: total assets, saved, remaining, and any validation issues  

Fix any **blocking** issues in Excel before continuing.

### Step 2 — Check settings (recommended defaults)

| Setting | What it means | Suggested |
|--------|----------------|-----------|
| **Enable multiple asset iterations** | How many full asset cycles to run in one session | Off for a single test; on for batch runs |
| **Asset iteration count** | Maximum number of complete cycles | Match your batch size |
| **Auto-continue next asset** | Automatically start the next workbook row | **On** |
| **Use Save and New on General tab between assets** | After PPMs, go to General and use CAFM’s **Save and New** for the next asset | **On** |
| **Auto-download timeline JSON** | Saves a detailed log file when each asset finishes | Off unless you need logs |
| **Skip invalid rows** | Skip bad rows instead of stopping | Your choice |

### Step 3 — Start automatic import

1. Make sure you are on the **New Entity** asset page  
2. Click **Start Automatic**  
3. Watch the panel: it shows the current phase (e.g. filling, saving, PPM steps)  

You can switch to another browser tab or another application while it runs — the extension is designed to keep working in the background (v8.0.20+).

### Step 4 — When it finishes

- A success message appears when all requested assets are done (or when your **iteration count** is reached)  
- The extension opens the **General** tab on the last asset, clicks **Save**, then takes you to the **asset list** page with the importer panel **opened** so you can review counts or start another run  
- Rows marked **saved** in the panel have completed asset + PPM workflow  
- Use **Download CSV log** or **Download diagnostic JSON** if you need a record of what happened  

---

## What happens during a full asset cycle

Think of one **asset cycle** as everything needed for one asset row in Excel:

```
Excel row selected
    → Fill asset fields on New Entity form
    → Click Save
    → Close extra windows if CAFM opened them
    → Open saved asset → Change status to Active
    → For each PPM row linked to this asset:
          Open PPM register → Create New → Fill → Save and Close
          Return to parent → Refresh → next PPM (or finish)
    → When all PPMs done: open General tab on the asset
    → If another asset is waiting: Save and New → blank form for next row
    → Repeat for next asset
```

### Save and New (between assets)

After all PPMs for an asset are done, the extension:

1. Opens the **General** tab on the saved asset (left-hand navigation)  
2. Uses CAFM’s **Save and New** (under the Save menu) to open a fresh **New Entity** form  
3. Starts filling the **next** asset from your workbook  

This matches what you would do manually: finish PPMs → General → Save and New → next asset.

If Save and New cannot be clicked after several tries, the extension opens the New Entity page directly instead.

### PPMs that already exist

If a PPM instruction already exists on that asset in CAFM, the extension **skips** creating a duplicate and moves to the next PPM. You will see this in the log as **existing** rather than **saved**.

---

## Workbook preparation

Your Excel file should contain:

### Sheet: `CAFM Import`

- **Import?** — put `YES` on rows you want to create  
- **Asset Code** — required; must start with `WCH-`  
- Other columns — building, location, description, etc. (only filled columns are sent to CAFM)  

### Sheet: `CAFM PPM Import` (optional)

- **Import?** — `YES` for PPMs to create  
- **Asset Code** — must match an asset on the Import sheet  
- **Instruction** — the PPM instruction name in CAFM  

An asset with **no** PPM rows still works: the tool saves and activates the asset only.

---

## Panel controls (simple reference)

| Button / area | Use when |
|---------------|----------|
| **Load workbook** | Start of session or new file |
| **Previous / Next** | Move between asset rows manually |
| **Fill current** | Fill the form without saving (trial) |
| **Save current** | Save one asset manually |
| **Start Automatic** | Run the full pipeline for all pending rows |
| **Pause** | Temporarily stop (resume later) |
| **Resume** | Continue after pause or error |
| **Skip current** | Mark row skipped and move on |
| **Download CSV log** | Simple event list |
| **Download diagnostic JSON** | Detailed troubleshooting file |
| **Clear session** | Reset extension memory (only when you are sure) |

The **Last saved / Next to save** line shows batch progress during automatic runs.

---

## If something goes wrong

### Do this first

1. **Do not click Clear session** if you want to resume or diagnose  
2. Note the **phase** shown on the panel (e.g. `ppm_await_save`, `asset_save_and_new`)  
3. Click **Download diagnostic JSON** and **Download CSV log**  
4. Fix the cause (validation message on screen, missing lookup, wrong workbook value)  
5. Select the failed row with **Previous/Next** and click **Resume**  

### Common situations

| What you see | Likely cause | What to do |
|--------------|--------------|------------|
| Validation message on CAFM | Required field or bad lookup | Fix Excel or complete field manually, then Resume |
| Stuck after PPM save | Slow CAFM or tab in background | Wait up to ~90 seconds; switch back to CAFM tab if needed |
| PPM register feels slow or keeps refreshing | Old versions could click Refresh too often | Update to **v8.0.25+**, reload extension, refresh CAFM tab (F5) |
| “Refresh button did not become available” on first PPM | First PPM no longer waits for Refresh (v8.0.27+) | Reload extension; Resume on PPM register — should click **Create New** directly |
| PPM save: “Instruction Set” or “PPM Priority” required | Workbook had blank Priority; wrong CAFM field label (v8.0.28+) | Reload extension; optional **Priority** column in Excel; default priority is **3** |
| “Timed out” on Save and New | General tab not ready | Resume; extension retries General + Save and New |
| Wrong asset code on screen | Workbook row mismatch | Use Previous/Next to select correct row |
| Duplicate PPM | Already in CAFM | Normal skip — check log for **existing** |
| **Extension context invalidated** (console error) | Extension was reloaded while CAFM tab stayed open | Press **F5** on the CAFM tab, then **Reload** the extension at `chrome://extensions` |

For technical phase names and fixes, see [ISSUE_TRACKING.md](ISSUE_TRACKING.md).

---

## Tips for smooth runs

- Run a **single asset test** before a large batch  
- Keep **Auto-continue** and **Use Save and New** enabled for multi-asset batches  
- Leave the extension **reloaded** after updates  
- You may work in other tabs; return if a step seems stuck for more than a minute  
- Use **Pause** before making manual changes in CAFM  

---

## Glossary

| Term | Meaning |
|------|---------|
| **Asset** | Equipment or item record in CAFM (e.g. a door, fan, panel) |
| **Asset Code** | Unique code starting with `WCH-` |
| **PPM** | Planned preventative maintenance task linked to an asset |
| **New Entity** | Blank form to create a new asset (`id=-1` in the address bar) |
| **General tab** | Main asset details tab in CAFM left navigation |
| **Save and New** | CAFM action that saves the current asset and opens a new blank form |
| **Active** | Live status — asset or PPM is in use in CAFM |
| **Phase** | Current step the automation is on (shown in the panel) |
| **Workbook row** | One line on the CAFM Import sheet |

---

## Getting more help

- **Technical runbook (testing):** [SMOKE_TEST.md](SMOKE_TEST.md)  
- **Change history:** [CHANGELOG.md](CHANGELOG.md)  
- **Developer / workbook column reference:** [README.md](README.md)  

*Engineering Efficiency Ltd — CAFM Asset + PPM Importer*
