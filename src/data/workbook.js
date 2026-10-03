(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { VERSION, STORAGE, DEFAULT_SETTINGS } = root.core.constants;
  const {
    isNewEntityPage,
    deriveNewEntityUrl
  } = root.core.pages;
  const {
    storageGet,
    storageSet,
    storageRemove,
    saveLargeWorkbook,
    loadLargeWorkbook,
    clearLargeWorkbook
  } = root.core.storage;
  const ppmData = root.data.ppm;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;

  function configure(deps) {
    cfg = Object.freeze({ ...deps });
  }

  function C() {
    if (!cfg) throw new Error('CAFMImporter workbook module is not configured yet.');
    return cfg;
  }

async function persistSession() {
  const phase = clean(C().state.session.auto?.phase || '');
  if (phase && phase !== C().state.lastLoggedPhase) {
    C().state.lastLoggedPhase = phase;
    C().addEvent('phase', {
      phase,
      index: Number(C().state.session.auto?.index ?? C().state.session.index) || 0,
      ppmIndex: C().state.session.auto?.ppmIndex ?? null,
      ppmKey: C().currentPpm(C().workflowRecord(C().state.session.auto) || C().currentRecord())?.ppmKey || ''
    });
  }
  await storageSet({ [STORAGE.session]: C().state.session, [STORAGE.settings]: C().state.settings });
  try {
    chrome.runtime.sendMessage({ type: 'AUTO_ORCHESTRATOR_SYNC' }).catch(() => {});
  } catch (_) {}
}

async function restoreState() {
  const stored = await storageGet([STORAGE.session, STORAGE.settings, STORAGE.learnedStatus, STORAGE.learnedNew]);
  if (stored[STORAGE.settings]) {
    const previousSettings = stored[STORAGE.settings];
    C().state.settings = { ...DEFAULT_SETTINGS, ...previousSettings };
  }
  C().state.learnedStatus = stored[STORAGE.learnedStatus] || null;
  C().state.learnedNew = stored[STORAGE.learnedNew] || null;
  if (stored[STORAGE.session]) {
    C().state.session = {
      ...C().state.session,
      ...stored[STORAGE.session],
      events: Array.isArray(stored[STORAGE.session].events) ? stored[STORAGE.session].events : (C().state.session.events || [])
    };
  }
  const cache = await loadLargeWorkbook();
  if (cache?.allAssets?.length || cache?.assets?.length || cache?.ppms?.length) {
    C().state.cache = cache;
    C().state.assets = cache.assets || [];
    C().state.allAssets = cache.allAssets || cache.assets || [];
    C().state.ppms = cache.ppms || [];
    if (C().state.assets.length) C().state.session.index = Math.max(0, Math.min(Number(C().state.session.index) || 0, C().state.assets.length - 1));
  }
  if (isNewEntityPage()) {
    C().state.session.newEntityUrl = C().state.session.newEntityUrl || deriveNewEntityUrl();
    await persistSession();
  }
}

async function loadWorkbookFile(file) {
  if (!globalThis.CAFMXlsx?.readWorkbook) throw new Error('Workbook reader is unavailable. Reload the extension.');
  const parsed = await globalThis.CAFMXlsx.readWorkbook(file);
  if (!parsed.allAssets?.length && !parsed.ppms?.length) throw new Error('No CAFM asset or PPM rows were found in this workbook.');
  const cache = {
    assets: parsed.assets || [],
    allAssets: parsed.allAssets || parsed.assets || [],
    ppms: parsed.ppms || [],
    ppmCount: Number(parsed.ppmCount || (parsed.ppms || []).length || 0),
    ppmExcludedRows: Number(parsed.ppmExcludedRows || 0),
    fileName: parsed.fileName,
    fileSize: parsed.fileSize,
    fileModified: parsed.fileModified,
    headerRow: parsed.headerRow,
    excludedRows: parsed.excludedRows,
    locationCount: parsed.locationCount,
    schema: parsed.schema,
    loadedAt: new Date().toISOString()
  };
  await saveLargeWorkbook(cache);
  C().state.cache = cache;
  C().state.assets = cache.assets || [];
  C().state.allAssets = cache.allAssets || cache.assets || [];
  C().state.ppms = cache.ppms || [];
  C().state.session = {
    fileName: cache.fileName,
    fileSize: cache.fileSize,
    fileModified: cache.fileModified,
    index: 0,
    statuses: {},
    newEntityUrl: isNewEntityPage() ? deriveNewEntityUrl() : (C().state.session.newEntityUrl || deriveNewEntityUrl()),
    auto: null,
    manualAwaitSave: null,
    currentLookupEvidence: [],
    events: []
  };
  await persistSession();
  C().render();
  const preflight = root.data.preflight.summarize(C().state);
  C().showToast(`${C().state.assets.length} NEW-import asset row(s), ${C().state.allAssets.length} total asset row(s) available for editing, and ${C().state.ppms.length} enabled PPM row(s) loaded from ${cache.fileName}. ${root.data.preflight.formatSummary(preflight)}`, preflight.blocking.length ? 'warn' : 'success', 12000);
}

async function jumpToIndex(index) {
  if (!C().state.assets.length) return;
  C().state.session.index = Math.max(0, Math.min(C().state.assets.length - 1, Math.floor(Number(index) || 0)));
  C().state.session.currentLookupEvidence = [];
  await persistSession();
  C().render();
}

function counts() {
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  let invalid = 0;
  for (const record of C().state.assets) {
    const status = statusOf(record);
    if (status === 'saved') saved += 1;
    else if (status === 'skipped') skipped += 1;
    else if (status === 'failed') failed += 1;
    if (C().validateRecord(record).length) invalid += 1;
  }
  return { total: C().state.assets.length, saved, skipped, failed, invalid, remaining: Math.max(0, C().state.assets.length - saved - skipped) };
}

async function move(delta) {
  if (!C().state.assets.length) return;
  C().state.session.index = Math.max(0, Math.min(C().state.assets.length - 1, C().state.session.index + delta));
  C().state.session.currentLookupEvidence = [];
  await persistSession();
  C().render();
}

async function skipCurrent() {
  const record = C().currentRecord();
  if (!record) return;
  await setStatus(record, 'skipped', 'Skipped by user');
  const next = nextPendingIndex(C().state.session.index + 1);
  if (next >= 0) C().state.session.index = next;
  await persistSession();
  C().render();
}

async function markSavedAndNext(note = 'Confirmed saved') {
  const record = C().currentRecord();
  if (!record) return;
  await setStatus(record, 'saved', note);
  const next = nextPendingIndex(C().state.session.index + 1);
  if (next >= 0) C().state.session.index = next;
  await persistSession();
  C().render();
}

async function clearSession() {
  if (!confirm('Clear the loaded workbook and importer progress? This does not delete anything from CAFM.')) return;
  await clearLargeWorkbook();
  await storageRemove([STORAGE.session, STORAGE.pendingLookup]);
  C().state.assets = [];
  C().state.allAssets = [];
  C().state.ppms = [];
  C().state.cache = null;
  C().state.session = { fileName: '', fileSize: 0, fileModified: 0, index: 0, statuses: {}, newEntityUrl: deriveNewEntityUrl(), auto: null, manualAwaitSave: null, currentLookupEvidence: [] };
  C().render();
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadLog() {
  const rows = [['Asset Code', 'Workbook Row', 'Status', 'Note', 'Updated At', 'CAFM Entity ID', 'Asset Active', 'Activated At', 'Status Evidence', 'Linked PPM Count', 'PPM Results', 'Validation Warning Count', 'Validation Warnings']];
  for (const record of C().state.assets) {
    const info = C().state.session.statuses?.[record.assetCode] || {};
    const linkedCount = C().linkedPpms(record).length;
    const ppmResults = (info.ppmResults || []).map((item) => `${item.status || ''}:${item.ppmKey || ''}:${item.instruction || ''}`).join(' | ');
    const warnings = (info.validationWarnings || []).map((item) => `${item.scope || ''}:${item.tab || ''}:${item.field || ''}: expected=${item.expected || ''}: actual=${item.actual || ''}: ${item.reason || ''}`).join(' | ');
    rows.push([
      record.assetCode, record.workbookRow, info.status || 'pending', info.note || '', info.updatedAt || '',
      info.cafmEntityId || '', info.assetActivated ? 'YES' : 'NO', info.assetActivatedAt || '', info.assetStatusEvidence || '',
      linkedCount, ppmResults, (info.validationWarnings || []).length, warnings
    ]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Engineering_Efficiency_CAFM_Asset_Import_Log_v${VERSION}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function summarizeEvents(events = []) {
  const slowestSteps = events
    .filter((event) => ['ppm-fill-step', 'ppm-post-refresh-close-sweep', 'ppm-fill-complete', 'ppm-parent-refresh-complete'].includes(event.type))
    .map((event) => ({
      type: event.type,
      step: event.step || event.context || event.phase || '',
      durationMs: Number(event.durationMs || 0)
    }))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 12);
  const phaseDurations = events
    .filter((event) => event.type === 'phase' && event.durationMs != null)
    .map((event) => ({ phase: event.phase, durationMs: event.durationMs }))
    .slice(-40);
  return {
    totalEvents: events.length,
    slowestSteps,
    phaseDurations
  };
}

function buildDiagnosticPayload(record) {
  const auto = C().state.session.auto || null;
  const resolved = record || C().workflowRecord(auto) || C().currentRecord();
  const recentEvents = (C().state.session.events || []).slice(-2000);
  return {
    generatedAt: new Date().toISOString(),
    extensionVersion: VERSION,
    page: { url: location.href, title: document.title, readyState: document.readyState },
    workbook: C().state.cache ? {
      fileName: C().state.session.fileName,
      fileSize: C().state.session.fileSize,
      fileModified: C().state.session.fileModified,
      assetsLoaded: C().state.assets.length,
      ppmRowsLoaded: C().state.ppms.length
    } : null,
    current: {
      assetCode: resolved?.assetCode || '',
      workbookRow: resolved?.workbookRow || '',
      assetIndex: C().state.session.index,
      phase: auto?.phase || '',
      ppmIndex: auto?.ppmIndex ?? null,
      ppmKey: C().currentPpm(resolved)?.ppmKey || '',
      currentAssetStatus: C().currentAssetStatusText(),
      currentPpmStatus: C().currentPpmStatusText()
    },
    iteration: {
      enabled: Boolean(C().state.settings.iterationEnabled),
      configuredCount: Math.max(1, Number(C().state.settings.iterationCount) || 1),
      runMax: Number(auto?.maxIterations || 1),
      processedThisRun: Number(auto?.processedThisRun || 0)
    },
    settings: { ...C().state.settings },
    auto,
    status: resolved ? C().state.session.statuses?.[resolved.assetCode] || null : null,
    recentEvents,
    timingSummary: summarizeEvents(recentEvents),
    validationMessage: C().validationMessage() || '',
    learnedControls: { status: C().state.learnedStatus || null, ppmNew: C().state.learnedNew || null }
  };
}

function downloadAssetTimeline(record, options = {}) {
  const payload = buildDiagnosticPayload(record);
  const assetCode = clean(record?.assetCode || payload.current?.assetCode || 'no-asset').replace(/[^A-Za-z0-9_-]+/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = options.diagnostic ? 'EE_CAFM_Diagnostic' : 'EE_CAFM_Timeline';
  const fileName = `${prefix}_v${VERSION}_${assetCode}_${stamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try {
    C().addEvent('asset-timeline-download', {
      assetCode: record?.assetCode || payload.current?.assetCode || '',
      auto: Boolean(options.auto),
      fileName
    });
  } catch (_) {}
  return fileName;
}

function downloadDiagnostic() {
  const record = C().workflowRecord(C().state.session.auto) || C().currentRecord();
  downloadAssetTimeline(record, { diagnostic: true });
}

async function setStatus(record, status, note = '', extra = {}) {
  if (!record) return;
  const previous = C().state.session.statuses[record.assetCode] || {};
  C().state.session.statuses[record.assetCode] = {
    ...previous,
    ...extra,
    status,
    note: clean(note),
    workbookRow: record.workbookRow,
    updatedAt: new Date().toISOString()
  };
  await persistSession();
  C().render();
}

function statusOf(record) {
  return C().state.session.statuses?.[record?.assetCode]?.status || 'pending';
}

function nextPendingIndex(start = C().state.session.index + 1) {
  if (!C().state.assets.length) return -1;
  for (let i = Math.max(0, start); i < C().state.assets.length; i += 1) {
    if (!['saved', 'skipped'].includes(statusOf(C().state.assets[i]))) return i;
  }
  for (let i = 0; i < Math.min(start, C().state.assets.length); i += 1) {
    if (!['saved', 'skipped'].includes(statusOf(C().state.assets[i]))) return i;
  }
  return -1;
}
  root.data = root.data || {};
  root.data.workbook = Object.freeze({
    configure,
    persistSession,
    restoreState,
    loadWorkbookFile,
    counts,
    move,
    jumpToIndex,
    skipCurrent,
    markSavedAndNext,
    clearSession,
    downloadLog,
    downloadDiagnostic,
    buildDiagnosticPayload,
    downloadAssetTimeline,
    summarizeEvents,
    setStatus,
    statusOf,
    nextPendingIndex
  });
})();
