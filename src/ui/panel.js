(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { VERSION, HOST_ID, STORAGE } = root.core.constants;
  const {
    isAssetPage,
    isNewEntityPage,
    isSavedAssetPage,
    isPpmListPage,
    isPpmNewEntityPage,
    isSavedPpmPage,
    isAssetListPage,
    isPanelPage,
    isWorkflowPage
  } = root.core.pages;
  const { lookupMapping } = root.pages.assetMappings;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;

  function configure(deps) {
    cfg = Object.freeze({ ...deps });
  }

  function C() {
    if (!cfg) throw new Error('CAFMImporter panel is not configured yet.');
    return cfg;
  }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function statusClass(status) {
  return status === 'saved' ? 'ok' : status === 'failed' ? 'bad' : ['skipped', 'asset_saved'].includes(status) ? 'warn' : 'neutral';
}

function showToast(message, type = 'info', duration = 4500) {
  root.ui.progressToast.showToast(message, type, duration);
}

function showActivity(verb, target, detail = '', options = {}) {
  root.ui.progressToast.showActivity(verb, target, detail, options);
}

function render() {
  if (!C().state.shadow) return;
  const c = C().counts();
  const record = C().currentRecord();
  const status = record ? C().statusOf(record) : 'pending';
  const validation = record ? C().validateRecord(record) : [];
  const auto = C().state.session.auto;
  const loaded = C().state.assets.length > 0 || C().state.allAssets.length > 0;
  const savedAssetPage = isSavedAssetPage();
  const ppmRegisterPage = isPpmListPage();
  const pageAssetCode = savedAssetPage ? C().assetCodeOnPage() : '';
  const ppmPageMatch = ppmRegisterPage ? C().ppmRecordOnCurrentPage() : null;
  const ppmPageAssetCode = ppmPageMatch?.assetCode || (ppmRegisterPage ? C().workflowAssetCodeOnPage() : '');
  const editPool = C().state.allAssets.length ? C().state.allAssets : C().state.assets;
  const savedMatch = pageAssetCode ? editPool.find((item) => norm(item.assetCode) === norm(pageAssetCode)) : null;

  C().state.els.fileName.textContent = C().state.cache?.fileName ? `${C().state.cache.fileName} | ${C().state.assets.length} NEW row(s) | ${C().state.allAssets.length} editable asset row(s) | ${C().state.ppms.length} enabled PPM row(s)` : 'No workbook loaded';
  C().state.els.total.textContent = String(c.total);
  C().state.els.saved.textContent = String(c.saved);
  C().state.els.remaining.textContent = String(c.remaining);
  C().state.els.issues.textContent = String(c.failed + c.invalid);
  if (C().state.els.preflightReport) {
    if (loaded) {
      const report = root.data.preflight.summarize(C().state);
      C().state.els.preflightReport.hidden = false;
      C().state.els.preflightReport.textContent = root.data.preflight.formatPanelReport(report);
      C().state.els.preflightReport.className = `validation ${report.blocking.length || report.orphanPpms.length ? 'badtext' : 'goodtext'}`;
    } else {
      C().state.els.preflightReport.hidden = true;
    }
  }
  const prevSavedCode = (() => {
    for (let i = Math.min(C().state.session.index, C().state.assets.length - 1); i >= 0; i -= 1) {
      if (C().statusOf(C().state.assets[i]) === 'saved') return C().state.assets[i].assetCode;
    }
    return '';
  })();
  const nextPendingIdx = C().nextPendingIndex(C().state.session.index);
  const nextPendingCode = nextPendingIdx >= 0 ? C().state.assets[nextPendingIdx]?.assetCode || '' : '';
  C().state.els.row.textContent = record ? `${C().state.session.index + 1} / ${C().state.assets.length} | Excel row ${record.workbookRow}` : '-';
  if (C().state.els.queueNav) {
    C().state.els.queueNav.textContent = loaded
      ? `Last saved: ${prevSavedCode || '-'} | Next to save: ${nextPendingCode || '-'}`
      : 'Last saved: - | Next to save: -';
  }
  C().state.els.assetCode.textContent = record?.assetCode || '-';
  C().state.els.status.textContent = record ? status.toUpperCase() : '-';
  C().state.els.status.className = `pill ${statusClass(status)}`;
  if (savedAssetPage && loaded) {
    C().state.els.validation.textContent = pageAssetCode
      ? (savedMatch ? `Saved asset ${pageAssetCode} matches Excel row ${savedMatch.workbookRow}. Edit Existing Asset is available.` : `Saved asset ${pageAssetCode} is not present in the loaded import rows.`)
      : 'Saved asset page detected, but Asset Code could not be read.';
    C().state.els.validation.className = savedMatch ? 'validation goodtext' : 'validation badtext';
    if (savedMatch) {
      C().state.els.row.textContent = `Saved asset | Excel row ${savedMatch.workbookRow}`;
      C().state.els.assetCode.textContent = savedMatch.assetCode;
    }
  } else if (ppmRegisterPage && loaded) {
    const linkedCount = ppmPageMatch ? C().linkedPpms(ppmPageMatch).length : 0;
    C().state.els.validation.textContent = ppmPageAssetCode
      ? (ppmPageMatch ? `PPM register for ${ppmPageAssetCode}: ${linkedCount} enabled workbook PPM row(s) ready.` : `${ppmPageAssetCode} is not present in the loaded CAFM Import rows.`)
      : 'PPM register detected, but the Asset Code could not be read.';
    C().state.els.validation.className = ppmPageMatch && linkedCount ? 'validation goodtext' : 'validation badtext';
    if (ppmPageMatch) {
      C().state.els.row.textContent = `PPM register | Excel row ${ppmPageMatch.workbookRow}`;
      C().state.els.assetCode.textContent = ppmPageMatch.assetCode;
    }
  } else if (isAssetListPage() && loaded) {
    C().state.els.validation.textContent = 'Workbook loaded. Click + New, then Start automatic on the New Entity form.';
    C().state.els.validation.className = 'validation goodtext';
  } else if (isAssetListPage()) {
    C().state.els.validation.textContent = 'Load workbook here, or on the New Entity form opened via + New.';
    C().state.els.validation.className = 'validation goodtext';
  } else {
    C().state.els.validation.textContent = validation.length ? validation.join(' | ') : 'Workbook row passed local validation.';
    C().state.els.validation.className = validation.length ? 'validation badtext' : 'validation goodtext';
  }

  const lookupContext = savedMatch || ppmPageMatch || record;
  const lookupRows = lookupContext ? lookupMapping(lookupContext) : [];
  C().state.els.lookupSummary.innerHTML = lookupRows.length
    ? lookupRows.map((item) => `<div class="lookup-line"><b>${escapeHtml(item.field)}</b><span>${escapeHtml(item.value)}</span></div>`).join('')
    : '<div class="muted">No current row.</div>';

  const activeRecord = auto?.active ? (C().workflowRecord(auto) || C().currentRecord()) : null;
  const ppmTotal = activeRecord ? C().linkedPpms(activeRecord).length : 0;
  const ppmProgress = auto?.active && ppmTotal ? ` | PPM ${Math.max(0, Number(auto.ppmIndex) || 0) + 1}/${ppmTotal}` : '';
  C().state.els.autoState.textContent = auto?.active
    ? `Automatic import: ${String(auto.phase || 'running').replace(/_/g, ' ')} | asset ${(Number(auto.index ?? C().state.session.index) || 0) + 1}/${C().state.assets.length}${ppmProgress} | cycle ${Number(auto.processedThisRun || 0)}/${Number(auto.maxIterations || 1)}`
    : auto?.phase === 'complete'
      ? `Automatic import complete${auto?.processedThisRun != null ? ` | ${Number(auto.processedThisRun || 0)}/${Number(auto.maxIterations || auto.processedThisRun || 1)} asset cycle(s)` : ''}`
      : auto?.phase === 'error' ? `Stopped: ${auto.error || 'error'}` : 'Automatic import stopped';

  if (C().state.els.progressTrack && C().state.els.progressFill) {
    const showProgress = Boolean(auto?.active) && C().state.assets.length > 0;
    C().state.els.progressTrack.hidden = !showProgress;
    if (C().state.els.progressLabel) C().state.els.progressLabel.hidden = !showProgress;
    if (showProgress) {
      const assetIndex = Math.max(0, Number(auto.index ?? C().state.session.index) || 0);
      const assetTotal = Math.max(1, C().state.assets.length);
      const ppmIdx = Math.max(0, Number(auto.ppmIndex) || 0);
      const ppmPart = ppmTotal > 0 ? (ppmIdx / Math.max(1, ppmTotal)) * (100 / assetTotal) : 0;
      const assetPart = (assetIndex / assetTotal) * 100;
      const pct = Math.min(100, Math.max(0, Math.round(assetPart + ppmPart * 0.25)));
      C().state.els.progressFill.style.width = `${pct}%`;
      if (C().state.els.progressLabel) {
        C().state.els.progressLabel.textContent = ppmTotal
          ? `Progress ~${pct}% | asset ${assetIndex + 1}/${assetTotal} | PPM ${ppmIdx + 1}/${ppmTotal}`
          : `Progress ~${pct}% | asset ${assetIndex + 1}/${assetTotal}`;
      }
    }
  }

  const assetEntryPage = isAssetPage() && isNewEntityPage();
  for (const id of ['fill', 'saveCurrent', 'skip', 'prev', 'next', 'markSaved']) C().state.els[id].disabled = !loaded || !assetEntryPage;
  C().state.els.editExisting.disabled = !loaded || !savedAssetPage || !savedMatch;
  C().state.els.saveExisting.disabled = !loaded || !savedAssetPage || !savedMatch;
  C().state.els.downloadLog.disabled = !loaded;
  C().state.els.pauseAuto.disabled = !auto?.active;
  const stoppedWithError = auto?.phase === 'error' || auto?.phase === 'paused';
  C().state.els.resumeAuto.hidden = !stoppedWithError;
  C().state.els.resumeAuto.disabled = !loaded || !stoppedWithError;
  if (C().state.els.resumeAuto) {
    C().state.els.resumeAuto.textContent = auto?.phase === 'paused'
      ? 'Resume paused import'
      : 'Resume from stopped row';
  }
  C().state.els.resumeRowWrap.hidden = !loaded;
  if (C().state.els.resumeRowInput && loaded) {
    C().state.els.resumeRowInput.max = String(C().state.assets.length);
    C().state.els.resumeRowInput.value = String(C().state.session.index + 1);
  }
  C().state.els.startAuto.disabled = !C().state.assets.length || Boolean(auto?.active) || !assetEntryPage;
  const ppmQueue = ppmPageMatch ? C().linkedPpms(ppmPageMatch) : [];
  const ppmReadyCount = ppmQueue.length;
  C().state.els.startPpmHere.hidden = !ppmRegisterPage;
  // Do not let an old failed Asset-status workflow block manual PPM entry.
  // Only disable while a live workflow is actually running.
  C().state.els.startPpmHere.disabled = !loaded || !ppmRegisterPage || !ppmPageMatch || !ppmReadyCount || Boolean(auto?.active);
  C().state.els.startPpmHere.textContent = ppmPageMatch ? `START PPM FOR THIS ASSET (${ppmReadyCount})` : 'START PPM FOR THIS ASSET';
  C().state.els.openPpmNew.hidden = !ppmRegisterPage;
  C().state.els.openPpmNew.disabled = !ppmRegisterPage;
  if (C().state.els.ppmQueuePreview) {
    C().state.els.ppmQueuePreview.hidden = !ppmRegisterPage;
    if (!loaded) {
      C().state.els.ppmQueuePreview.textContent = 'Load the import workbook to start PPM entry.';
      C().state.els.ppmQueuePreview.className = 'validation badtext';
    } else if (!ppmPageMatch) {
      C().state.els.ppmQueuePreview.textContent = 'PPM page detected, but the Asset Code could not be matched to the workbook.';
      C().state.els.ppmQueuePreview.className = 'validation badtext';
    } else if (!ppmReadyCount) {
      C().state.els.ppmQueuePreview.textContent = `No enabled CAFM PPM Import rows are linked to ${ppmPageMatch.assetCode}.`;
      C().state.els.ppmQueuePreview.className = 'validation badtext';
    } else {
      const rows = ppmQueue.map((ppm, i) => `${i + 1}. ${clean(ppm.instruction) || clean(ppm.ppmKey) || 'PPM'}${clean(ppm.lastService) ? ` | Last Service ${clean(ppm.lastService)}` : ''}`);
      C().state.els.ppmQueuePreview.textContent = `${ppmReadyCount} PPM row(s) ready: ${rows.join('  |  ')}`;
      C().state.els.ppmQueuePreview.className = 'validation goodtext';
    }
  }
  C().state.els.fileInput.value = '';

  if (C().state.els.contextSub) {
    const page = isPpmListPage() ? 'PPM register' : isPpmNewEntityPage() ? 'New PPM' : isSavedPpmPage() ? 'Saved PPM' : isSavedAssetPage() ? 'Saved asset' : isAssetListPage() ? 'Asset list' : isNewEntityPage() ? 'New asset' : 'Asset entry';
    const phase = auto?.active ? String(auto.phase || 'running').replace(/_/g, ' ') : 'idle';
    C().state.els.contextSub.textContent = `Engineering Efficiency Ltd | v${VERSION} | ${page} | ${phase}`;
  }

  C().state.els.iterateBatch.checked = Boolean(C().state.settings.iterationEnabled);
  C().state.els.iterationCount.value = String(Math.max(1, Number(C().state.settings.iterationCount) || 1));
  C().state.els.iterationCount.disabled = !C().state.settings.iterationEnabled;
  C().state.els.includeNotes.checked = Boolean(C().state.settings.includeNotes);
  C().state.els.includeSpatial.checked = Boolean(C().state.settings.includeSpatial);
  C().state.els.skipInvalid.checked = Boolean(C().state.settings.skipInvalidRows);
  if (C().state.els.autoDownloadTimeline) C().state.els.autoDownloadTimeline.checked = Boolean(C().state.settings.autoDownloadTimeline);
  if (C().state.els.autoContinueNext) C().state.els.autoContinueNext.checked = C().state.settings.autoContinueNext !== false;
  if (C().state.els.useSaveAndNew) C().state.els.useSaveAndNew.checked = C().state.settings.useSaveAndNew !== false;
}

function makeDraggable() {
  const panel = C().state.els.panel;
  const handle = C().state.els.dragHandle;
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button,input')) return;
    dragging = true;
    handle.setPointerCapture?.(event.pointerId);
    const rect = panel.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    panel.style.right = 'auto';
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - 60);
    const x = Math.max(0, Math.min(maxX, event.clientX - offsetX));
    const y = Math.max(0, Math.min(maxY, event.clientY - offsetY));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    C().state.settings.panelX = x;
    C().state.settings.panelY = y;
  });
  handle.addEventListener('pointerup', async (event) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(event.pointerId);
    await C().persistSession();
  });
}

function injectPanel() {
  if (!isPanelPage() || document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.all = 'initial';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  C().state.host = host;
  C().state.shadow = shadow;
  const logo = chrome.runtime.getURL('branding/engineering_efficiency_logo.png');
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      #panel { position: fixed; top: 76px; right: 14px; width: 430px; max-width: calc(100vw - 20px); max-height: calc(100vh - 88px); z-index: 2147483646; background:#111820; color:#f4f6f8; border:1px solid #34414e; border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.35); font:13px/1.35 Arial,Helvetica,sans-serif; overflow:hidden; }
      #head { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#0b1117; border-bottom:1px solid #2c3946; cursor:move; user-select:none; }
      #head img { width:32px; height:32px; object-fit:contain; background:#fff; border-radius:5px; }
      #head .titles { flex:1; min-width:0; }
      #head h2 { margin:0; font-size:15px; color:#fff; }
      #head .sub { color:#aeb9c4; font-size:11px; margin-top:2px; }
      #head button { border:1px solid #41505e; background:#202b35; color:#fff; width:28px; height:28px; border-radius:6px; cursor:pointer; }
      #body { overflow:auto; max-height:calc(100vh - 145px); padding:10px; }
      #panel.collapsed #body { display:none; }
      #panel.ppm-workflow { width:350px; }
      #panel.ppm-workflow #workbookSection, #panel.ppm-workflow #manualSection, #panel.ppm-workflow #sessionSection { display:none; }
      #panel.ppm-workflow #currentSection #validation, #panel.ppm-workflow #currentSection #lookupSummary { display:none; }
      #panel.ppm-workflow #autoSection #startAuto, #panel.ppm-workflow #autoSection .option { display:none; }
      #panel.ppm-workflow #autoSection .buttons { grid-template-columns:1fr; }
      #panel.ppm-workflow #autoSection { margin-bottom:0; }
      #panel.ppm-workflow #body { max-height:310px; }
      .section { border:1px solid #2c3946; border-radius:8px; padding:9px; margin-bottom:9px; background:#151e27; }
      .section h3 { margin:0 0 7px; font-size:12px; color:#d9e2ea; text-transform:uppercase; letter-spacing:.35px; }
      .file { display:flex; gap:7px; align-items:center; }
      input[type=file] { width:100%; color:#c9d2da; font-size:11px; }
      .muted { color:#9ca9b5; font-size:11px; }
      .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-top:8px; }
      .kpi { background:#0f161d; border:1px solid #2d3944; border-radius:7px; padding:6px; text-align:center; }
      .kpi span { display:block; color:#8f9ca8; font-size:9px; text-transform:uppercase; }
      .kpi strong { display:block; color:#fff; font-size:16px; margin-top:2px; }
      .rowline { display:flex; gap:8px; justify-content:space-between; align-items:center; margin:4px 0; }
      .rowline b { color:#fff; }
      .asset { font-size:16px; font-weight:700; word-break:break-word; color:#fff; margin:5px 0; }
      .pill { display:inline-block; padding:3px 7px; border-radius:999px; font-size:10px; font-weight:700; }
      .pill.ok { background:#173d2a; color:#aef3c7; }
      .pill.bad { background:#4a2022; color:#ffb6ba; }
      .pill.warn { background:#4a3b17; color:#ffe19a; }
      .pill.neutral { background:#26323d; color:#d6dee5; }
      .validation { margin-top:6px; padding:6px; border-radius:6px; font-size:11px; }
      .goodtext { color:#b9efca; background:#132c20; }
      .badtext { color:#ffbec2; background:#3a1c1f; }
      .lookup-list { max-height:175px; overflow:auto; border-top:1px solid #2b3742; margin-top:7px; padding-top:4px; }
      .lookup-line { display:grid; grid-template-columns:95px 1fr; gap:7px; padding:4px 0; border-bottom:1px solid #24303a; }
      .lookup-line b { color:#cfd9e1; }
      .lookup-line span { color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .buttons { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:7px; }
      button.action { border:1px solid #40505f; background:#25313c; color:#fff; min-height:34px; border-radius:7px; cursor:pointer; padding:7px 8px; font-weight:600; }
      button.action:hover:not(:disabled) { background:#31404c; }
      button.action.primary { background:#e5e9ed; color:#111820; border-color:#fff; }
      button.action.danger { background:#54262a; border-color:#704047; }
      button.action:disabled { opacity:.38; cursor:not-allowed; }
      .wide { grid-column:1 / -1; }
      .option { display:flex; align-items:center; gap:7px; color:#cbd4dc; margin-top:6px; font-size:11px; }
      .option input[type=number] { width:80px; background:#0f161d; border:1px solid #3b4956; color:#fff; border-radius:4px; padding:4px; }
      #autoState { color:#b8c5cf; font-size:11px; margin-top:6px; }
      .toast { position:fixed; right:18px; bottom:18px; z-index:2147483647; min-width:420px; max-width:780px; width:max-content; padding:12px 16px; border-radius:9px; color:#fff; background:#26333e; box-shadow:0 10px 32px rgba(0,0,0,.36); display:none; font:13px/1.4 Arial,sans-serif; }
      .toast.show { display:block; }
      .toast.success { background:#1c5134; }
      .toast.warn { background:#6a5319; }
      .toast.error { background:#702b31; }
      .toast.info { background:#1a4a6e; }
      .toast.progress { border-left:4px solid #3d8bfd; }
      .toast-title { font-weight:700; font-size:13px; line-height:1.35; }
      .toast-meta { font-size:10px; opacity:.88; margin-top:3px; letter-spacing:.02em; text-transform:uppercase; }
      .toast-detail { font-size:12px; margin-top:5px; opacity:.96; line-height:1.45; white-space:pre-wrap; word-break:break-word; }
      .footer { color:#80909c; text-align:center; font-size:10px; margin:3px 0 1px; }
    </style>
    <div id="panel">
      <div id="head">
        <img src="${logo}" alt="Engineering Efficiency Ltd">
        <div class="titles"><h2>CAFM Asset Importer</h2><div id="contextSub" class="sub">Engineering Efficiency Ltd | v${VERSION} | Asset -> ACTIVE -> data-driven linked PPMs</div></div>
        <button id="collapse" title="Collapse">-</button>
      </div>
      <div id="body">
        <div id="workbookSection" class="section">
          <h3>Workbook</h3>
          <div class="file"><input id="fileInput" type="file" accept=".xlsx"></div>
          <div id="fileName" class="muted" style="margin-top:5px"></div>
          <div class="kpis">
            <div class="kpi"><span>Total</span><strong id="total">0</strong></div>
            <div class="kpi"><span>Saved</span><strong id="saved">0</strong></div>
            <div class="kpi"><span>Remaining</span><strong id="remaining">0</strong></div>
            <div class="kpi"><span>Issues</span><strong id="issues">0</strong></div>
          </div>
          <div id="preflightReport" class="validation goodtext" hidden style="margin-top:8px; white-space:pre-wrap"></div>
        </div>
        <div id="currentSection" class="section">
          <h3>Current asset</h3>
          <div class="rowline"><span id="row" class="muted">-</span><span id="status" class="pill neutral">-</span></div>
          <div id="queueNav" class="muted" style="margin:4px 0">Last saved: - | Next to save: -</div>
          <div id="assetCode" class="asset">-</div>
          <div id="validation" class="validation goodtext">Load a workbook to begin.</div>
          <div id="lookupSummary" class="lookup-list"></div>
        </div>
        <div id="manualSection" class="section">
          <h3>Manual control</h3>
          <div class="buttons">
            <button id="fill" class="action primary wide">Fill current NEW record</button>
            <button id="saveCurrent" class="action primary wide">Save NEW -> ACTIVE -> linked PPMs -> next</button>
            <button id="editExisting" class="action wide">Fill saved asset from workbook</button>
            <button id="saveExisting" class="action wide">Save existing changes only</button>
            <button id="prev" class="action">Previous</button>
            <button id="next" class="action">Next</button>
            <button id="skip" class="action">Skip current</button>
            <button id="markSaved" class="action">Mark saved + next</button>
          </div>
        </div>
        <div id="autoSection" class="section">
          <h3>Automatic Asset + PPM import</h3>
          <div class="buttons">
            <button id="startPpmHere" class="action primary wide" hidden>START PPM FOR THIS ASSET</button>
            <button id="openPpmNew" class="action wide" hidden>OPEN + NEW PPM WINDOW</button>
            <button id="startAuto" class="action primary">Start automatic</button>
            <button id="pauseAuto" class="action danger">Pause / Stop</button>
            <button id="resumeAuto" class="action primary wide" hidden>Resume from stopped row</button>
          </div>
          <label id="resumeRowWrap" class="option" hidden>Jump to asset row
            <input id="resumeRowInput" type="number" min="1" step="1" style="width:70px">
            <button id="resumeRowGo" type="button" class="action" style="min-height:28px;padding:4px 8px">Go</button>
          </label>
          <div id="ppmQueuePreview" class="validation goodtext" hidden style="margin-top:8px"></div>
          <div id="autoState">Automatic import stopped</div>
          <div id="progressTrack" hidden style="height:7px;background:#2d3944;border-radius:4px;margin-top:6px;overflow:hidden">
            <div id="progressFill" style="height:100%;width:0%;background:linear-gradient(90deg,#3d8bfd,#7ee2a8);transition:width .25s ease"></div>
          </div>
          <div id="progressLabel" class="muted" hidden style="margin-top:4px;font-size:10px"></div>
          <label class="option"><input id="iterateBatch" type="checkbox"> Enable multiple asset iterations</label>
          <label class="option">Asset iteration count <input id="iterationCount" type="number" min="1" max="10000" step="1" value="1" style="width:90px"></label>
          <div class="muted" style="margin:4px 0 8px">Unchecked = exactly one complete Asset + linked PPM cycle, then stop. Checked = continue until the asset iteration count is reached.</div>
          <label class="option"><input id="includeNotes" type="checkbox"> Include Notes tab only when workbook data is populated</label>
          <label class="option"><input id="includeSpatial" type="checkbox"> Include Spatial / GIS tab only when workbook data is populated</label>
          <label class="option"><input id="skipInvalid" type="checkbox"> Skip invalid workbook rows instead of stopping</label>
          <label class="option"><input id="autoDownloadTimeline" type="checkbox"> Auto-download timeline JSON when each asset cycle completes</label>
          <label class="option"><input id="autoContinueNext" type="checkbox"> Auto-continue to next asset after PPM cycle</label>
          <label class="option"><input id="useSaveAndNew" type="checkbox"> Use Save and New on General tab between assets</label>
          <div class="muted">Proceeds when CAFM state is verified. Safety timeouts default to 20s (PPM child wait 15s). Reload the extension at chrome://extensions after code updates.</div>
        </div>
        <div id="sessionSection" class="section">
          <h3>Session</h3>
          <div class="buttons">
            <button id="downloadLog" class="action">Download CSV log</button>
            <button id="downloadDiagnostic" class="action">Download diagnostic JSON</button>
            <button id="clear" class="action danger">Clear session</button>
          </div>
          <div class="muted" style="margin-top:7px">NEW asset sequence: fill populated workbook fields -> Save -> verify saved Asset ID -> Change Asset Status -> Active -> PPM workflow. Legacy toolbar detection is corrected to use page-relative coordinates and one-click protection. v8 uses state-driven progression with no inter-record pacing delay and skips optional Notes/Spatial tabs unless enabled and populated. EDIT EXISTING: open a saved asset, use Fill saved asset from workbook, review, then Save existing changes only (or the normal CAFM Save). Edit mode matches by Asset Code, never creates a duplicate, never clears blank workbook fields, and does not alter asset status or existing PPMs.</div>
        </div>
        <div class="footer">Move this panel by dragging the header. Site and calculated/read-only fields are not overwritten.</div>
      </div>
    </div>
    <div id="toast" class="toast">
      <div id="toastTitle" class="toast-title"></div>
      <div id="toastMeta" class="toast-meta" hidden></div>
      <div id="toastDetail" class="toast-detail" hidden></div>
    </div>
  `;

  const ids = ['panel', 'head', 'contextSub', 'workbookSection', 'currentSection', 'manualSection', 'autoSection', 'sessionSection', 'collapse', 'fileInput', 'fileName', 'total', 'saved', 'remaining', 'issues', 'preflightReport', 'row', 'queueNav', 'status', 'assetCode', 'validation', 'lookupSummary', 'fill', 'saveCurrent', 'editExisting', 'saveExisting', 'prev', 'next', 'skip', 'markSaved', 'startPpmHere', 'openPpmNew', 'ppmQueuePreview', 'startAuto', 'pauseAuto', 'resumeAuto', 'resumeRowWrap', 'resumeRowInput', 'resumeRowGo', 'autoState', 'progressTrack', 'progressFill', 'progressLabel', 'iterateBatch', 'iterationCount', 'includeNotes', 'includeSpatial', 'skipInvalid', 'autoDownloadTimeline', 'autoContinueNext', 'useSaveAndNew', 'downloadLog', 'downloadDiagnostic', 'clear', 'toast', 'toastTitle', 'toastMeta', 'toastDetail'];
  for (const id of ids) C().state.els[id] = shadow.getElementById(id);
  root.ui.progressToast.configureToastElements({
    toast: C().state.els.toast,
    toastTitle: C().state.els.toastTitle,
    toastMeta: C().state.els.toastMeta,
    toastDetail: C().state.els.toastDetail
  });
  C().state.els.dragHandle = C().state.els.head;
  if (!isAssetPage()) C().state.els.panel.classList.add('ppm-workflow');

  if (C().state.settings.panelX != null) {
    C().state.els.panel.style.right = 'auto';
    C().state.els.panel.style.left = `${Math.max(0, Number(C().state.settings.panelX) || 0)}px`;
  }
  C().state.els.panel.style.top = `${Math.max(0, Number(C().state.settings.panelY) || 76)}px`;
  if (C().state.settings.collapsed) C().state.els.panel.classList.add('collapsed');

  C().state.els.collapse.addEventListener('click', async () => {
    C().state.settings.collapsed = !C().state.settings.collapsed;
    C().state.els.panel.classList.toggle('collapsed', C().state.settings.collapsed);
    C().state.els.collapse.textContent = C().state.settings.collapsed ? '+' : '-';
    await C().persistSession();
  });
  C().state.els.collapse.textContent = C().state.settings.collapsed ? '+' : '-';

  C().state.els.fileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await C().loadWorkbookFile(file); }
    catch (error) { showToast(error.message || String(error), 'error', 12000); }
  });
  C().state.els.fill.addEventListener('click', async () => {
    if (C().state.busy) return;
    C().state.busy = true;
    try { await C().fillCurrentRecord(); }
    catch (error) { showToast(error.message || String(error), 'error', 12000); }
    finally { C().state.busy = false; render(); }
  });
  C().state.els.saveCurrent.addEventListener('click', async () => {
    if (C().state.busy) return;
    C().state.busy = true;
    try { await C().clickSaveTracked('manual'); }
    catch (error) { showToast(error.message || String(error), 'error', 12000); }
    finally { C().state.busy = false; render(); }
  });
  C().state.els.editExisting.addEventListener('click', async () => {
    if (C().state.busy) return;
    C().state.busy = true;
    try { await C().fillExistingSavedAsset(); }
    catch (error) { showToast(error.message || String(error), 'error', 14000); }
    finally { C().state.busy = false; render(); }
  });
  C().state.els.saveExisting.addEventListener('click', async () => {
    if (C().state.busy) return;
    C().state.busy = true;
    try { await C().saveExistingAssetChanges(); }
    catch (error) { showToast(error.message || String(error), 'error', 14000); }
    finally { C().state.busy = false; render(); }
  });
  C().state.els.prev.addEventListener('click', () => C().move(-1));
  C().state.els.next.addEventListener('click', () => C().move(1));
  C().state.els.skip.addEventListener('click', () => C().skipCurrent());
  C().state.els.markSaved.addEventListener('click', () => C().markSavedAndNext('Manually confirmed by user'));
  C().state.els.startPpmHere.addEventListener('click', async () => {
    if (C().state.busy) return;
    try { await C().startPpmForCurrentPage(); }
    catch (error) { showToast(error.message || String(error), 'error', 14000); }
  });
  C().state.els.openPpmNew.addEventListener('click', () => {
    try {
      const record = C().ppmRecordOnCurrentPage() || C().currentRecord();
      const idx = Number(C().state.session.auto?.ppmIndex || 0);
      C().clickPpmNewToolbar(`manual-open:${record?.assetCode || 'asset'}:${idx}`);
      showToast('Clicked CAFM + New ONCE. Waiting for the New PPM window; do not click again.', 'success', 8000);
    } catch (error) {
      showToast(error.message || String(error), 'error', 12000);
    }
  });
  C().state.els.startAuto.addEventListener('click', () => C().startAutomatic());
  C().state.els.pauseAuto.addEventListener('click', () => C().pauseAutomatic());
  C().state.els.resumeAuto.addEventListener('click', () => C().resumeAutomatic());
  C().state.els.resumeRowGo.addEventListener('click', async () => {
    const n = Math.floor(Number(C().state.els.resumeRowInput.value) || 1);
    await C().jumpToIndex(n - 1);
    showToast(`Selected asset row ${n}.`, 'info', 4000);
  });
  C().state.els.downloadLog.addEventListener('click', () => C().downloadLog());
  C().state.els.clear.addEventListener('click', () => C().clearSession());
  C().state.els.includeNotes.addEventListener('change', async () => {
    C().state.settings.includeNotes = C().state.els.includeNotes.checked;
    await C().persistSession();
    render();
  });
  C().state.els.includeSpatial.addEventListener('change', async () => {
    C().state.settings.includeSpatial = C().state.els.includeSpatial.checked;
    await C().persistSession();
    render();
  });
  C().state.els.skipInvalid.addEventListener('change', async () => {
    C().state.settings.skipInvalidRows = C().state.els.skipInvalid.checked;
    await C().persistSession();
  });
  C().state.els.autoDownloadTimeline.addEventListener('change', async () => {
    C().state.settings.autoDownloadTimeline = C().state.els.autoDownloadTimeline.checked;
    await C().persistSession();
  });
  C().state.els.autoContinueNext.addEventListener('change', async () => {
    C().state.settings.autoContinueNext = C().state.els.autoContinueNext.checked;
    await C().persistSession();
  });
  C().state.els.useSaveAndNew.addEventListener('change', async () => {
    C().state.settings.useSaveAndNew = C().state.els.useSaveAndNew.checked;
    await C().persistSession();
  });
  C().state.els.iterateBatch.addEventListener('change', async () => {
    C().state.settings.iterationEnabled = C().state.els.iterateBatch.checked;
    await C().persistSession();
    render();
  });
  C().state.els.iterationCount.addEventListener('change', async () => {
    C().state.settings.iterationCount = Math.max(1, Math.min(10000, Math.floor(Number(C().state.els.iterationCount.value) || 1)));
    await C().persistSession();
    render();
  });
  C().state.els.downloadDiagnostic.addEventListener('click', () => C().downloadDiagnostic());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE.learnedStatus]) C().state.learnedStatus = changes[STORAGE.learnedStatus].newValue || null;
    if (changes[STORAGE.learnedNew]) C().state.learnedNew = changes[STORAGE.learnedNew].newValue || null;
  });
  makeDraggable();
}
  root.ui = root.ui || {};
  root.ui.panel = Object.freeze({
    configure,
    injectPanel,
    render,
    showToast,
    showActivity
  });
})();
