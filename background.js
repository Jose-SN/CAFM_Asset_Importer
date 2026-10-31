'use strict';

const ASSET_LIST_TAB_KEY = 'wchCafmAssetListTabV33';
/** @deprecated — migrated to ASSET_LIST_TAB_KEY on read */
const ASSET_TAB_KEY = 'wchCafmAssetTabV32';
const ASSET_EDITOR_TAB_KEY = 'wchCafmAssetEditorTabV33';
const PPM_EDITOR_TAB_KEY = 'wchCafmPpmEditorTabV33';
const lookupClaims = new Map();
const ppmSaveUrlNotified = new Map();

const SESSION_KEY = 'eeAssetImporterV80Session';
const SETTINGS_KEY = 'eeAssetImporterV80Settings';
const INSTALLED_VERSION_KEY = 'eeAssetImporterInstalledVersion';
const AUTO_ALARM = 'cafm-auto-orchestrator';
const DEFAULT_ORCHESTRATOR_MS = 2500;

const PPM_ITEM_URL = /\/Evolution\/!System\/PPMs\/FPPM\/ViewFPPMItem\.aspx/i;
const ASSET_EDITOR_URL = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItem\.aspx/i;
const ASSET_LIST_URL = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItems\.aspx/i;
const ASSET_PPM_LIST_URL = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItemPPMs\.aspx/i;
const PPM_EDITOR_PHASES = new Set([
  'wait_ppm_new',
  'ppm_fill',
  'ppm_saving',
  'ppm_await_save'
]);

function isConceptUrl(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    return host === 'concept' || String(url || '').toLowerCase().includes('/evolution/');
  } catch (_) {
    return false;
  }
}

async function readSessionAndSettings() {
  const data = await chrome.storage.local.get([SESSION_KEY, SETTINGS_KEY]);
  return {
    session: data[SESSION_KEY] || null,
    settings: data[SETTINGS_KEY] || {}
  };
}

function assetIdFromTabUrl(url) {
  try { return String(new URL(String(url || '')).searchParams.get('id') || '').trim(); } catch (_) { return ''; }
}

function isPpmItemTabUrl(url) {
  return PPM_ITEM_URL.test(String(url || ''));
}

function isAssetEditorTabUrl(url) {
  const u = String(url || '');
  return ASSET_EDITOR_URL.test(u) && !ASSET_LIST_URL.test(u);
}

function isAssetListTabUrl(url) {
  return ASSET_LIST_URL.test(String(url || ''));
}

function isAssetParentTabUrl(url) {
  const u = String(url || '');
  return isAssetEditorTabUrl(u) || ASSET_PPM_LIST_URL.test(u);
}

async function listConceptTabsMatching(matcher) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (_) { return []; }
  return tabs.filter((tab) => typeof tab.id === 'number' && isConceptUrl(tab.url) && matcher(tab.url));
}

async function readRegisteredAssetEditorTab() {
  const data = await chrome.storage.local.get(ASSET_EDITOR_TAB_KEY);
  return data[ASSET_EDITOR_TAB_KEY] || null;
}

async function readRegisteredListTab() {
  const data = await chrome.storage.local.get([ASSET_LIST_TAB_KEY, ASSET_TAB_KEY]);
  return data[ASSET_LIST_TAB_KEY] || data[ASSET_TAB_KEY] || null;
}

async function readRegisteredPpmEditorTab() {
  const data = await chrome.storage.local.get(PPM_EDITOR_TAB_KEY);
  return data[PPM_EDITOR_TAB_KEY] || null;
}

async function tabExists(tabId) {
  if (typeof tabId !== 'number') return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (_) {
    return false;
  }
}

async function writeRegisteredPpmEditorTab(tab, source = '') {
  if (!tab || typeof tab.id !== 'number') return null;
  const entry = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: String(tab.url || ''),
    ppmEntityId: assetIdFromTabUrl(tab.url),
    registeredAt: Date.now(),
    source: String(source || '')
  };
  await chrome.storage.local.set({ [PPM_EDITOR_TAB_KEY]: entry });
  return entry;
}

async function clearRegisteredPpmEditorTab() {
  await chrome.storage.local.remove(PPM_EDITOR_TAB_KEY);
}

async function listConceptPpmTabs() {
  return listConceptTabsMatching((url) => isPpmItemTabUrl(url));
}

/** Close every FPPM tab except the canonical PPM editor. */
async function closePpmEditorTabsExcept(keepTabId) {
  if (typeof keepTabId !== 'number') return 0;
  const ppmTabs = await listConceptPpmTabs();
  let closed = 0;
  for (const tab of ppmTabs) {
    if (tab.id === keepTabId) continue;
    try {
      await chrome.tabs.remove(tab.id);
      closed += 1;
    } catch (_) {}
  }
  return closed;
}

async function closeAssetListTabsExcept(keepTabId) {
  if (typeof keepTabId !== 'number') return 0;
  const tabs = await listConceptTabsMatching((url) => isAssetListTabUrl(url));
  let closed = 0;
  for (const tab of tabs) {
    if (tab.id === keepTabId) continue;
    try {
      await chrome.tabs.remove(tab.id);
      closed += 1;
    } catch (_) {}
  }
  return closed;
}

async function closeAssetParentTabsExcept(keepTabId) {
  if (typeof keepTabId !== 'number') return 0;
  const tabs = await listConceptTabsMatching((url) => isAssetParentTabUrl(url));
  let closed = 0;
  for (const tab of tabs) {
    if (tab.id === keepTabId) continue;
    try {
      await chrome.tabs.remove(tab.id);
      closed += 1;
    } catch (_) {}
  }
  return closed;
}

/** One register tab, one asset/PPM-parent tab, one FPPM editor tab during PPM auto. */
async function enforceSingletonWorkflowTabs(session) {
  if (!session?.auto?.active || session.auto.mode !== 'ppm') {
    return { closed: 0 };
  }
  const entityId = String(session.auto.assetEntityId || '').trim();
  let closed = 0;

  const listReg = await readRegisteredListTab();
  let keepList = listReg?.tabId;
  if (keepList && !(await tabExists(keepList))) keepList = null;
  const listTabs = await listConceptTabsMatching((url) => isAssetListTabUrl(url));
  if (!keepList && listTabs.length) keepList = listTabs[0].id;
  if (typeof keepList === 'number') {
    closed += await closeAssetListTabsExcept(keepList);
    await chrome.storage.local.set({
      [ASSET_LIST_TAB_KEY]: {
        tabId: keepList,
        windowId: listTabs.find((t) => t.id === keepList)?.windowId ?? listReg?.windowId,
        registeredAt: Date.now(),
        role: 'register'
      }
    });
  }

  const editorReg = await readRegisteredAssetEditorTab();
  let keepParent = editorReg?.tabId;
  if (keepParent && !(await tabExists(keepParent))) keepParent = null;
  const parentTabs = await listConceptTabsMatching((url) => isAssetParentTabUrl(url));
  if (entityId) {
    const byEntity = parentTabs.find((t) => assetIdFromTabUrl(t.url) === entityId);
    if (byEntity) keepParent = byEntity.id;
  }
  if (!keepParent && parentTabs.length) keepParent = parentTabs[parentTabs.length - 1].id;
  if (typeof keepParent === 'number') {
    closed += await closeAssetParentTabsExcept(keepParent);
    const keepTab = parentTabs.find((t) => t.id === keepParent);
    await chrome.storage.local.set({
      [ASSET_EDITOR_TAB_KEY]: {
        tabId: keepParent,
        windowId: keepTab?.windowId ?? editorReg?.windowId,
        registeredAt: Date.now(),
        role: 'editor'
      }
    });
  }

  const keepPpm = await resolvePpmEditorTabId(session);
  if (typeof keepPpm === 'number') {
    closed += await closePpmEditorTabsExcept(keepPpm);
  }

  return { closed, keepList, keepParent, keepPpm };
}

/** Pick one FPPM editor tab (prefer registered, then newest id=-1). */
async function resolvePpmEditorTabId(session) {
  const registered = await readRegisteredPpmEditorTab();
  if (registered?.tabId && await tabExists(registered.tabId)) {
    return registered.tabId;
  }
  if (registered?.tabId) await clearRegisteredPpmEditorTab();

  const auto = session?.auto || {};
  const handoffAt = Math.max(
    Number(auto.ppmSaveDispatchedAt || 0),
    Number(auto.ppmCreateNewAt || 0),
    Number(auto.ppmAwaitSaveStartedAt || 0)
  );
  const ppmTabs = await listConceptPpmTabs();
  const newEntityTabs = ppmTabs.filter((tab) => assetIdFromTabUrl(tab.url) === '-1');
  if (newEntityTabs.length) {
    newEntityTabs.sort((a, b) => Number(b.id) - Number(a.id));
    const chosen = newEntityTabs[0];
    await writeRegisteredPpmEditorTab(chosen, 'resolve-new-entity');
    if (newEntityTabs.length > 1) {
      await closePpmEditorTabsExcept(chosen.id);
    }
    return chosen.id;
  }
  if (handoffAt && ppmTabs.length === 1) {
    await writeRegisteredPpmEditorTab(ppmTabs[0], 'resolve-single-ppm');
    return ppmTabs[0].id;
  }
  return null;
}

async function adoptPpmEditorAfterSave(senderTabId, session) {
  const auto = session?.auto || {};
  const kind = String(auto.ppmAwaitSaveKind || '');
  if (kind !== 'save_and_new') return { ready: false, reason: 'not-save-and-new' };

  const ppmTabs = await listConceptPpmTabs();
  const newTabs = ppmTabs.filter((tab) => assetIdFromTabUrl(tab.url) === '-1');
  let keepTabId = null;

  if (typeof senderTabId === 'number') {
    const senderTab = ppmTabs.find((t) => t.id === senderTabId);
    if (senderTab && assetIdFromTabUrl(senderTab.url) === '-1') {
      keepTabId = senderTabId;
    }
  }
  if (!keepTabId && newTabs.length) {
    newTabs.sort((a, b) => Number(b.id) - Number(a.id));
    keepTabId = newTabs[0].id;
  }

  if (!keepTabId) return { ready: false, reason: 'no-new-ppm-tab' };

  const keepTab = ppmTabs.find((t) => t.id === keepTabId) || newTabs.find((t) => t.id === keepTabId);
  if (keepTab) await writeRegisteredPpmEditorTab(keepTab, 'adopt-after-save-and-new');
  await closePpmEditorTabsExcept(keepTabId);
  try { await chrome.tabs.update(keepTabId, { active: true }); } catch (_) {}
  return {
    ready: true,
    editorTabId: keepTabId,
    isThisTab: keepTabId === senderTabId
  };
}

async function collectWorkflowTabIds(session) {
  const tabIds = new Set();
  const auto = session?.auto || {};
  const phase = String(auto.phase || '').trim();
  const entityId = String(auto.assetEntityId || '').trim();
  const ppmEditorPhase = auto.mode === 'ppm'
    && (PPM_EDITOR_PHASES.has(phase) || phase === 'wait_ppm_new');

  try {
    const listTab = await readRegisteredListTab();
    if (typeof listTab?.tabId === 'number') tabIds.add(listTab.tabId);
  } catch (_) {}

  try {
    const editorStored = await chrome.storage.local.get(ASSET_EDITOR_TAB_KEY);
    if (typeof editorStored[ASSET_EDITOR_TAB_KEY]?.tabId === 'number') {
      tabIds.add(editorStored[ASSET_EDITOR_TAB_KEY].tabId);
    }
  } catch (_) {}

  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (_) { tabs = []; }
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !isConceptUrl(tab.url)) continue;
    const url = String(tab.url || '');
    if (entityId && isAssetEditorTabUrl(url) && assetIdFromTabUrl(url) === entityId) {
      tabIds.add(tab.id);
    }
  }

  if (ppmEditorPhase) {
    const ppmEditorTabId = await resolvePpmEditorTabId(session);
    if (typeof ppmEditorTabId === 'number') tabIds.add(ppmEditorTabId);
  }

  return tabIds;
}

async function dispatchRunAutoToTab(tabId, session, source = 'background-orchestrator') {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'RUN_AUTO_STEP',
      phase: session?.auto?.phase || '',
      source
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function dispatchAutoSteps(session) {
  if (!session?.auto?.active) return { dispatched: 0, tabCount: 0 };
  const tabIds = await collectWorkflowTabIds(session);
  let dispatched = 0;
  for (const tabId of tabIds) {
    if (await dispatchRunAutoToTab(tabId, session)) dispatched += 1;
  }
  return { dispatched, tabCount: tabIds.size };
}

async function scheduleOrchestratorAlarm(delayMs = DEFAULT_ORCHESTRATOR_MS) {
  const when = Date.now() + Math.max(500, Number(delayMs) || DEFAULT_ORCHESTRATOR_MS);
  await chrome.alarms.clear(AUTO_ALARM);
  await chrome.alarms.create(AUTO_ALARM, { when });
}

async function syncAutoOrchestrator() {
  const { session, settings } = await readSessionAndSettings();
  const enabled = settings.backgroundOrchestrator !== false;
  if (!enabled || !session?.auto?.active) {
    await chrome.alarms.clear(AUTO_ALARM);
    return { active: false };
  }
  if (session.auto.mode === 'ppm') {
    await enforceSingletonWorkflowTabs(session);
  }
  const delayMs = Math.max(500, Number(settings.backgroundOrchestratorMs) || DEFAULT_ORCHESTRATOR_MS);
  await scheduleOrchestratorAlarm(delayMs);
  const result = await dispatchAutoSteps(session);
  return { active: true, ...result };
}

async function wakeWorkflowForPpmTab(tabId, url) {
  if (typeof tabId !== 'number' || !isConceptUrl(url) || !isPpmItemTabUrl(url)) return;
  const { session } = await readSessionAndSettings();
  if (!session?.auto?.active || session.auto.mode !== 'ppm') return;
  const phase = String(session.auto.phase || '');
  if (!PPM_EDITOR_PHASES.has(phase) && phase !== 'wait_ppm_new') return;

  const tab = { id: tabId, url, windowId: null };
  if (assetIdFromTabUrl(url) === '-1') {
    await writeRegisteredPpmEditorTab(tab, 'tab-updated-new-entity');
    await closePpmEditorTabsExcept(tabId);
  }

  await enforceSingletonWorkflowTabs(session);

  const editorId = await resolvePpmEditorTabId(session);
  if (editorId !== tabId) return;
  await dispatchRunAutoToTab(tabId, session, 'ppm-editor-tab-ready');
}

// v3.5 large-data storage. Workbooks are kept out of chrome.storage.local so
// large batches do not compete with settings, progress and lookup state.
const DB_NAME = 'EngineeringEfficiencyCAFMImporter';
const DB_VERSION = 1;
const STORE_NAME = 'largeData';

function sendResponseSafe(sendResponse, payload) {
  try { sendResponse(payload); } catch (_) {}
}

function openLargeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open importer storage'));
  });
}

async function largePut(key, value) {
  const db = await openLargeDb();
  const json = JSON.stringify(value);
  const bytes = new Blob([json]).size;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, value, bytes, updatedAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Unable to save importer data'));
    tx.onabort = () => reject(tx.error || new Error('Importer storage transaction aborted'));
  });
  db.close();
  return { bytes };
}

async function largeGet(key) {
  const db = await openLargeDb();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('Unable to read importer data'));
  });
  db.close();
  return record;
}

async function largeRemove(key) {
  const db = await openLargeDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Unable to remove importer data'));
  });
  db.close();
}

async function wipeIndexedDb() {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

async function clearAllExtensionStorage() {
  lookupClaims.clear();
  ppmSaveUrlNotified.clear();
  try { await chrome.alarms.clearAll(); } catch (_) {}
  try {
    if (chrome.storage?.session?.clear) await chrome.storage.session.clear();
  } catch (_) {}
  try { await chrome.storage.local.clear(); } catch (_) {}
  await wipeIndexedDb();
}

async function notifyConceptTabsVersionReset(version) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (_) { return; }
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !isConceptUrl(tab.url)) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'EE_EXTENSION_VERSION_RESET', version });
    } catch (_) {}
  }
}

async function applyExtensionVersionReset(version) {
  const manifestVersion = chrome.runtime.getManifest().version;
  const target = String(version || manifestVersion || '').trim();
  if (!target || target !== manifestVersion) return { ok: false, reason: 'version-mismatch' };
  await clearAllExtensionStorage();
  await chrome.storage.local.set({ [INSTALLED_VERSION_KEY]: manifestVersion });
  await notifyConceptTabsVersionReset(manifestVersion);
  return { ok: true, version: manifestVersion };
}

chrome.runtime.onInstalled.addListener((details) => {
  if (!['install', 'update'].includes(details.reason)) return;
  (async () => {
    const manifestVersion = chrome.runtime.getManifest().version;
    let prior = '';
    try {
      const data = await chrome.storage.local.get(INSTALLED_VERSION_KEY);
      prior = String(data[INSTALLED_VERSION_KEY] || '').trim();
    } catch (_) {}
    if (details.reason === 'install' || prior !== manifestVersion) {
      await applyExtensionVersionReset(manifestVersion);
    }
  })().catch(() => {});
});

async function largeStats() {
  const db = await openLargeDb();
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('Unable to inspect importer storage'));
  });
  db.close();
  const indexedDbBytes = records.reduce((total, item) => total + Number(item.bytes || 0), 0);
  let usage = 0;
  let quota = 0;
  let persisted = false;
  try {
    const estimate = await navigator.storage?.estimate?.();
    usage = Number(estimate?.usage || 0);
    quota = Number(estimate?.quota || 0);
    persisted = Boolean(await navigator.storage?.persisted?.());
  } catch (_) {}
  return {
    indexedDbBytes,
    itemCount: records.length,
    usage,
    quota,
    persisted,
    backend: 'IndexedDB + unlimitedStorage'
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'EXTENSION_STORAGE_RESET') {
    applyExtensionVersionReset(message.version)
      .then((result) => sendResponseSafe(sendResponse, result))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'LARGE_STORAGE_PUT') {
    largePut(String(message.key || ''), message.value)
      .then((info) => sendResponseSafe(sendResponse, { ok: true, ...info }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'LARGE_STORAGE_GET') {
    largeGet(String(message.key || ''))
      .then((record) => sendResponseSafe(sendResponse, { ok: true, value: record?.value ?? null, bytes: Number(record?.bytes || 0), updatedAt: record?.updatedAt || '' }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'LARGE_STORAGE_REMOVE') {
    largeRemove(String(message.key || ''))
      .then(() => sendResponseSafe(sendResponse, { ok: true }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'LARGE_STORAGE_STATS') {
    largeStats()
      .then((stats) => sendResponseSafe(sendResponse, { ok: true, ...stats }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PERSIST_STORAGE') {
    Promise.resolve(navigator.storage?.persist?.())
      .then((persisted) => sendResponseSafe(sendResponse, { ok: true, persisted: Boolean(persisted) }))
      .catch(() => sendResponseSafe(sendResponse, { ok: true, persisted: false }));
    return true;
  }

  if (message.type === 'AUTO_ORCHESTRATOR_STOP') {
    chrome.alarms.clear(AUTO_ALARM)
      .then(() => sendResponseSafe(sendResponse, { ok: true, stopped: true }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'AUTO_ORCHESTRATOR_SYNC') {
    syncAutoOrchestrator()
      .then((info) => sendResponseSafe(sendResponse, { ok: true, ...info }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'ASSET_CLOSE_EDITOR_TAB') {
    const assetCode = String(message.assetCode || '');
    const assetEntityId = String(message.assetEntityId || '').trim();
    const senderTabId = sender.tab?.id;

    (async () => {
      const listTab = await readRegisteredListTab();
      let parentTabId = typeof sender.tab?.openerTabId === 'number' ? sender.tab.openerTabId : null;
      if (!parentTabId && listTab && typeof listTab.tabId === 'number') {
        parentTabId = listTab.tabId;
      }

      const isChildEditor = typeof senderTabId === 'number'
        && typeof parentTabId === 'number'
        && senderTabId !== parentTabId;

      let focusTabId = isChildEditor ? parentTabId : senderTabId;
      let closedTabId = null;
      const closeErrors = [];

      if (isChildEditor && typeof senderTabId === 'number') {
        try {
          await chrome.tabs.remove(senderTabId);
          closedTabId = senderTabId;
        } catch (error) {
          closeErrors.push({ tabId: senderTabId, error: String(error?.message || error) });
        }
      }

      if (typeof focusTabId === 'number') {
        try {
          const focusTab = await chrome.tabs.get(focusTabId);
          try { await chrome.windows.update(focusTab.windowId, { focused: true }); } catch (_) {}
          try { await chrome.tabs.update(focusTabId, { active: true }); } catch (_) {}
        } catch (_) {
          focusTabId = senderTabId ?? null;
        }
      }

      const notifyTabId = typeof focusTabId === 'number' ? focusTabId : senderTabId;
      if (typeof notifyTabId === 'number') {
        try {
          await chrome.tabs.sendMessage(notifyTabId, {
            type: 'EE_ASSET_EDITOR_CLOSED',
            assetCode,
            assetEntityId,
            closedTabId,
            closeErrors,
            childClosed: Boolean(closedTabId),
            parentTabId: notifyTabId
          });
        } catch (_) {}
      }

      sendResponseSafe(sendResponse, {
        ok: closeErrors.length === 0,
        assetCode,
        assetEntityId,
        childClosed: Boolean(closedTabId),
        closedTabId,
        parentTabId: notifyTabId ?? null,
        closeErrors
      });
    })().catch((error) => sendResponseSafe(sendResponse, {
      ok: false,
      reason: String(error?.message || error),
      currentTabId: senderTabId ?? null
    }));
    return true;
  }

  if (message.type === 'PPM_CREATE_NEW_CLICKED') {
    (async () => {
      const tab = sender.tab;
      if (tab && typeof tab.id === 'number') {
        await chrome.storage.local.set({
          ppmCreateNewHandoffAt: Date.now(),
          ppmCreateNewParentTabId: tab.id
        });
      }
      const { session } = await readSessionAndSettings();
      if (session?.auto?.mode === 'ppm') {
        await enforceSingletonWorkflowTabs(session);
      }
      const info = await syncAutoOrchestrator();
      sendResponseSafe(sendResponse, { ok: true, ...info });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PPM_ENFORCE_WORKFLOW_TABS') {
    readSessionAndSettings()
      .then(({ session }) => enforceSingletonWorkflowTabs(session))
      .then((info) => sendResponseSafe(sendResponse, { ok: true, ...info }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'REGISTER_PPM_EDITOR_TAB') {
    const tab = sender.tab;
    if (!tab || typeof tab.id !== 'number') {
      sendResponseSafe(sendResponse, { ok: false });
      return false;
    }
    (async () => {
      const entry = await writeRegisteredPpmEditorTab(tab, String(message.reason || 'register'));
      const { session } = await readSessionAndSettings();
      let singleton = { closed: 0 };
      if (session?.auto?.active && session.auto.mode === 'ppm') {
        singleton = await enforceSingletonWorkflowTabs(session);
      }
      sendResponseSafe(sendResponse, { ok: true, tabId: entry?.tabId ?? tab.id, ...singleton });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PPM_EDITOR_CLAIM') {
    (async () => {
      const tab = sender.tab;
      const tabId = tab?.id;
      if (typeof tabId !== 'number' || !isPpmItemTabUrl(tab.url)) {
        sendResponseSafe(sendResponse, { ok: false, isEditor: false, reason: 'not-ppm-tab' });
        return;
      }
      const { session } = await readSessionAndSettings();
      if (!session?.auto?.active || session.auto.mode !== 'ppm') {
        sendResponseSafe(sendResponse, { ok: true, isEditor: false, reason: 'ppm-not-active' });
        return;
      }
      const phase = String(session.auto.phase || '');
      const editorPhase = PPM_EDITOR_PHASES.has(phase) || phase === 'wait_ppm_new';
      const senderIsNew = assetIdFromTabUrl(tab.url) === '-1';
      const registered = await readRegisteredPpmEditorTab();
      if (registered?.tabId && await tabExists(registered.tabId)) {
        if (registered.tabId === tabId) {
          sendResponseSafe(sendResponse, { ok: true, isEditor: true, editorTabId: tabId });
          return;
        }
        let regIsNew = false;
        try {
          const regTab = await chrome.tabs.get(registered.tabId);
          regIsNew = assetIdFromTabUrl(regTab.url) === '-1';
        } catch (_) {}
        if (editorPhase && senderIsNew && (!regIsNew || registered.tabId !== tabId)) {
          await writeRegisteredPpmEditorTab(tab, 'claim-replace-new-editor');
          await closePpmEditorTabsExcept(tabId);
          await enforceSingletonWorkflowTabs(session);
          sendResponseSafe(sendResponse, { ok: true, isEditor: true, editorTabId: tabId, replaced: true });
          return;
        }
        sendResponseSafe(sendResponse, {
          ok: true,
          isEditor: false,
          editorTabId: registered.tabId
        });
        return;
      }
      if (registered?.tabId) await clearRegisteredPpmEditorTab();
      await writeRegisteredPpmEditorTab(tab, String(message.reason || 'claim'));
      sendResponseSafe(sendResponse, { ok: true, isEditor: true, editorTabId: tabId, claimed: true });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, isEditor: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PPM_ADOPT_EDITOR_AFTER_SAVE') {
    (async () => {
      const { session } = await readSessionAndSettings();
      const result = await adoptPpmEditorAfterSave(sender.tab?.id, session);
      if (result.ready && typeof result.editorTabId === 'number') {
        await enforceSingletonWorkflowTabs(session);
        await dispatchRunAutoToTab(result.editorTabId, session, 'ppm-adopt-after-save');
      }
      sendResponseSafe(sendResponse, { ok: true, ...result });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'REGISTER_ASSET_TAB') {
    const tab = sender.tab;
    if (!tab || typeof tab.id !== 'number') {
      sendResponseSafe(sendResponse, { ok: false });
      return false;
    }
    const role = String(message.role || 'register').toLowerCase();
    const storageKey = role === 'editor' ? ASSET_EDITOR_TAB_KEY : ASSET_LIST_TAB_KEY;
    (async () => {
      await chrome.storage.local.set({
        [storageKey]: { tabId: tab.id, windowId: tab.windowId, registeredAt: Date.now(), role }
      });
      const { session } = await readSessionAndSettings();
      let singleton = { closed: 0 };
      if (session?.auto?.active && session.auto.mode === 'ppm') {
        singleton = await enforceSingletonWorkflowTabs(session);
      }
      sendResponseSafe(sendResponse, { ok: true, tabId: tab.id, role, storageKey, ...singleton });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'CLAIM_LOOKUP') {
    const id = String(message.pendingId || '');
    const now = Date.now();
    for (const [key, value] of lookupClaims.entries()) {
      if (now - value.claimedAt > 20000) lookupClaims.delete(key);
    }
    if (!id) {
      sendResponseSafe(sendResponse, { ok: false, claimed: false });
      return false;
    }
    const existing = lookupClaims.get(id);
    if (existing && now - existing.claimedAt <= 20000) {
      sendResponseSafe(sendResponse, { ok: true, claimed: false });
      return false;
    }
    lookupClaims.set(id, { tabId: sender.tab?.id ?? -1, frameId: sender.frameId ?? 0, claimedAt: now });
    sendResponseSafe(sendResponse, { ok: true, claimed: true });
    return false;
  }

  if (message.type === 'RELEASE_LOOKUP') {
    if (message.pendingId) lookupClaims.delete(String(message.pendingId));
    sendResponseSafe(sendResponse, { ok: true });
    return false;
  }

  if (message.type === 'LOOKUP_SELECTED' || message.type === 'FOCUS_ASSET_TAB') {
    readRegisteredListTab().then(async (asset) => {
      if (!asset || typeof asset.tabId !== 'number') {
        sendResponseSafe(sendResponse, { ok: false, reason: 'asset-tab-not-registered' });
        return;
      }
      try { await chrome.windows.update(asset.windowId, { focused: true }); } catch (_) {}
      try { await chrome.tabs.update(asset.tabId, { active: true }); }
      catch (_) {
        sendResponseSafe(sendResponse, { ok: false, reason: 'asset-tab-not-available' });
        return;
      }
      const senderTabId = sender.tab?.id;
      const shouldCloseSender = message.type === 'LOOKUP_SELECTED' && typeof senderTabId === 'number' && senderTabId !== asset.tabId;
      if (shouldCloseSender) setTimeout(() => chrome.tabs.remove(senderTabId).catch(() => {}), 5000);
      sendResponseSafe(sendResponse, { ok: true, assetTabId: asset.tabId, closedLookupTab: shouldCloseSender });
    });
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_ALARM) return;
  syncAutoOrchestrator().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get([ASSET_LIST_TAB_KEY, ASSET_TAB_KEY, ASSET_EDITOR_TAB_KEY, PPM_EDITOR_TAB_KEY]).then((data) => {
    const removeKeys = [];
    if (data[ASSET_LIST_TAB_KEY]?.tabId === tabId) removeKeys.push(ASSET_LIST_TAB_KEY);
    if (data[ASSET_TAB_KEY]?.tabId === tabId) removeKeys.push(ASSET_TAB_KEY);
    if (data[ASSET_EDITOR_TAB_KEY]?.tabId === tabId) removeKeys.push(ASSET_EDITOR_TAB_KEY);
    if (data[PPM_EDITOR_TAB_KEY]?.tabId === tabId) removeKeys.push(PPM_EDITOR_TAB_KEY);
    if (removeKeys.length) chrome.storage.local.remove(removeKeys);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof tabId !== 'number') return;
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;
  const url = changeInfo.url || tab?.url || '';
  wakeWorkflowForPpmTab(tabId, url).catch(() => {});
  if (changeInfo.status === 'complete' && isConceptUrl(url)) {
    readSessionAndSettings()
      .then(({ session }) => {
        if (session?.auto?.active && session.auto.mode === 'ppm') {
          return enforceSingletonWorkflowTabs(session);
        }
        return null;
      })
      .catch(() => {});
  }
});
