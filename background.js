'use strict';

const ASSET_TAB_KEY = 'wchCafmAssetTabV32';
const lookupClaims = new Map();

const PPM_PARENT_KEY = 'wchCafmPpmParentV805';
const PPM_CHILD_KEY = 'wchCafmPpmChildV807';

const PPM_EDITOR_URL = /\/Evolution\/!System\/PPMs\/FPPM\/ViewFPPMItem\.aspx/i;
const PPM_REGISTER_URL = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItemPPMs\.aspx/i;
const ASSET_EDITOR_URL = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItem\.aspx/i;

const SESSION_KEY = 'eeAssetImporterV80Session';
const SETTINGS_KEY = 'eeAssetImporterV80Settings';
const AUTO_ALARM = 'cafm-auto-orchestrator';
const DEFAULT_ORCHESTRATOR_MS = 2500;
const ppmSaveUrlNotified = new Map();

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

async function collectWorkflowTabIds(session, parent) {
  const tabIds = new Set();
  if (parent?.tabId) tabIds.add(parent.tabId);
  for (const child of parent?.children || []) {
    if (typeof child?.tabId === 'number') tabIds.add(child.tabId);
  }
  try {
    const assetStored = await chrome.storage.local.get(ASSET_TAB_KEY);
    if (typeof assetStored[ASSET_TAB_KEY]?.tabId === 'number') tabIds.add(assetStored[ASSET_TAB_KEY].tabId);
  } catch (_) {}
  const auto = session?.auto || {};
  if (String(auto.assetEntityId || '').trim()) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (typeof tab.id !== 'number' || !isConceptUrl(tab.url)) continue;
      const id = assetIdFromTabUrl(tab.url);
      if (id && id === String(auto.assetEntityId || '').trim()) tabIds.add(tab.id);
    }
  }
  return tabIds;
}

async function dispatchAutoSteps(session) {
  if (!session?.auto?.active) return { dispatched: 0 };
  const parent = await getStoredPpmParent();
  const tabIds = await collectWorkflowTabIds(session, parent);
  let dispatched = 0;
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'RUN_AUTO_STEP',
        phase: session.auto.phase || '',
        source: 'background-orchestrator'
      });
      dispatched += 1;
    } catch (_) {}
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
  const delayMs = Math.max(500, Number(settings.backgroundOrchestratorMs) || DEFAULT_ORCHESTRATOR_MS);
  await scheduleOrchestratorAlarm(delayMs);
  const result = await dispatchAutoSteps(session);
  return { active: true, ...result };
}

async function handlePpmEditorUrlUpdate(tabId, url) {
  if (!isPpmEditorUrl(url)) return;
  const ppmEntityId = assetIdFromTabUrl(url);
  if (!ppmEntityId || ppmEntityId === '-1') return;

  const notifyKey = `${tabId}:${ppmEntityId}`;
  const last = Number(ppmSaveUrlNotified.get(notifyKey) || 0);
  if (Date.now() - last < 4000) return;

  const parent = await getStoredPpmParent();
  const trackedChild = parent?.children?.some((item) => item.tabId === tabId);
  const expectChild = Number(parent?.expectChildUntil || 0) > Date.now();
  if (!trackedChild && tabId === parent?.tabId) return;
  if (!trackedChild && !expectChild) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const openerMatch = typeof tab.openerTabId === 'number' && tab.openerTabId === parent?.tabId;
      if (!openerMatch && !expectChild) return;
    } catch (_) {
      return;
    }
  }

  const { session } = await readSessionAndSettings();
  const auto = session?.auto || {};
  if (!auto.active) return;
  const phase = String(auto.phase || '');
  if (!['ppm_await_save', 'ppm_fill', 'ppm_child_closing'].includes(phase)) return;

  ppmSaveUrlNotified.set(notifyKey, Date.now());

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'PPM_SAVED_URL_DETECTED',
      ppmEntityId,
      assetCode: auto.assetCode || parent?.assetCode || '',
      url
    });
  } catch (_) {}
}

function isPpmEditorUrl(url) {
  return PPM_EDITOR_URL.test(String(url || ''));
}

function assetIdFromTabUrl(url) {
  try { return String(new URL(String(url || '')).searchParams.get('id') || '').trim(); } catch (_) { return ''; }
}

async function getStoredPpmParent() {
  const data = await chrome.storage.local.get([PPM_PARENT_KEY, PPM_CHILD_KEY]);
  let parent = data[PPM_PARENT_KEY] || null;
  if (!parent) return null;
  if (!Array.isArray(parent.children)) parent.children = [];
  const legacyChild = data[PPM_CHILD_KEY];
  if (legacyChild && typeof legacyChild.tabId === 'number' && legacyChild.tabId !== parent.tabId) {
    if (!parent.children.some((item) => item.tabId === legacyChild.tabId)) {
      parent.children.push({
        id: `ppm-${legacyChild.tabId}`,
        tabId: legacyChild.tabId,
        windowId: legacyChild.windowId ?? null,
        openerTabId: legacyChild.openerTabId ?? null,
        url: legacyChild.url || '',
        registeredAt: legacyChild.registeredAt || Date.now()
      });
    }
  }
  return parent;
}

async function savePpmParent(parent) {
  if (!parent) {
    await chrome.storage.local.remove([PPM_PARENT_KEY, PPM_CHILD_KEY]);
    return;
  }
  parent.updatedAt = Date.now();
  await chrome.storage.local.set({ [PPM_PARENT_KEY]: parent });
  await chrome.storage.local.remove(PPM_CHILD_KEY);
}

async function registerPpmChildTab(tab) {
  if (!tab || typeof tab.id !== 'number') return false;
  const parent = await getStoredPpmParent();
  if (!parent || typeof parent.tabId !== 'number') return false;
  if (tab.id === parent.tabId) return false;

  const url = String(tab.url || tab.pendingUrl || '');
  const expectUntil = Number(parent.expectChildUntil || 0);
  const openerMatch = typeof tab.openerTabId === 'number' && tab.openerTabId === parent.tabId;
  const urlMatch = url && isPpmEditorUrl(url);
  const pendingChild = expectUntil > Date.now() && tab.windowId !== parent.windowId;
  if (!openerMatch && !urlMatch && !pendingChild) return false;

  parent.children = parent.children || [];
  if (parent.children.some((item) => item.tabId === tab.id)) {
    const entry = parent.children.find((item) => item.tabId === tab.id);
    if (entry && url) entry.url = url;
    await savePpmParent(parent);
    return true;
  }
  parent.children.push({
    id: `ppm-${tab.id}-${Date.now()}`,
    tabId: tab.id,
    windowId: tab.windowId ?? null,
    openerTabId: tab.openerTabId ?? null,
    url,
    registeredAt: Date.now()
  });
  await savePpmParent(parent);
  return true;
}

async function resolvePpmKeepParent(assetCode, assetEntityId, tabs, storedParent) {
  const registerTabs = [];
  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue;
    const rawUrl = String(tab.url || '');
    if (!PPM_REGISTER_URL.test(rawUrl)) continue;
    const candidateAssetId = assetIdFromTabUrl(rawUrl);
    if (assetEntityId && candidateAssetId !== assetEntityId) continue;
    registerTabs.push({ tab, rawUrl, assetId: candidateAssetId, hasTrailingHash: rawUrl.endsWith('#') });
  }

  const hashParents = registerTabs.filter((item) => item.hasTrailingHash);
  let keepParent = hashParents.find((item) => item.tab.active) || hashParents[0] || null;

  if (!keepParent && storedParent && storedParent.assetCode === assetCode && typeof storedParent.tabId === 'number') {
    try {
      const tab = await chrome.tabs.get(storedParent.tabId);
      keepParent = {
        tab,
        rawUrl: String(tab.url || ''),
        assetId: String(storedParent.assetEntityId || assetEntityId || '').trim(),
        hasTrailingHash: String(tab.url || '').endsWith('#')
      };
    } catch (_) {}
  }

  if (!keepParent && assetEntityId) {
    const embeddedParents = tabs.filter((tab) => {
      if (typeof tab.id !== 'number') return false;
      const rawUrl = String(tab.url || '');
      if (!ASSET_EDITOR_URL.test(rawUrl)) return false;
      const id = assetIdFromTabUrl(rawUrl);
      return id && id !== '-1' && id === assetEntityId;
    });
    const embedded = embeddedParents.find((tab) => tab.active) || embeddedParents[0];
    if (embedded) {
      keepParent = {
        tab: embedded,
        rawUrl: String(embedded.url || ''),
        assetId: assetEntityId,
        hasTrailingHash: false
      };
    }
  }

  return { keepParent, registerTabs };
}

async function collectPpmChildTabIds(tabs, keepParent, storedParent, assetCode, senderTabId) {
  const childTabIds = new Set();
  const parentTabId = keepParent?.tab?.id ?? storedParent?.tabId ?? null;
  const parentTabIds = new Set();
  if (typeof parentTabId === 'number') parentTabIds.add(parentTabId);
  if (storedParent && typeof storedParent.tabId === 'number') parentTabIds.add(storedParent.tabId);

  for (const item of storedParent?.children || []) {
    if (typeof item.tabId === 'number' && item.tabId !== parentTabId) childTabIds.add(item.tabId);
  }

  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue;
    if (!isPpmEditorUrl(tab.url)) continue;
    if (typeof parentTabId === 'number' && tab.id === parentTabId) continue;
    const isSender = typeof senderTabId === 'number' && tab.id === senderTabId;
    const openerMatch = typeof tab.openerTabId === 'number' && parentTabIds.has(tab.openerTabId);
    const registryMatch = storedParent?.assetCode === assetCode;
    const differentWindow = typeof keepParent?.tab?.windowId === 'number' && tab.windowId !== keepParent.tab.windowId;
    if (isSender || openerMatch || (registryMatch && differentWindow)) childTabIds.add(tab.id);
  }

  if (typeof senderTabId === 'number' && senderTabId !== parentTabId) childTabIds.add(senderTabId);
  return childTabIds;
}

async function closePpmChildSurfaces(childTabIds, keepParent) {
  const closeErrors = [];
  const closedTabIds = [];
  const closedWindowIds = [];
  const windows = await chrome.windows.getAll({ populate: true }).catch(() => []);

  for (const win of windows) {
    if (typeof win.id !== 'number') continue;
    if (keepParent?.tab?.windowId === win.id) continue;
    const winTabs = win.tabs || [];
    const ppmTabs = winTabs.filter((tab) => typeof tab.id === 'number' && childTabIds.has(tab.id));
    if (!ppmTabs.length) continue;
    const allPpm = winTabs.every((tab) => isPpmEditorUrl(tab.url));
    if (allPpm && winTabs.length <= 2) {
      try {
        await chrome.windows.remove(win.id);
        closedWindowIds.push(win.id);
        for (const tab of ppmTabs) {
          childTabIds.delete(tab.id);
          closedTabIds.push(tab.id);
        }
        continue;
      } catch (error) {
        closeErrors.push({ windowId: win.id, error: String(error?.message || error) });
      }
    }
  }

  for (const tabId of childTabIds) {
    if (closedTabIds.includes(tabId)) continue;
    try {
      await chrome.tabs.remove(tabId);
      closedTabIds.push(tabId);
    } catch (error) {
      closeErrors.push({ tabId, error: String(error?.message || error) });
    }
  }

  return { closeErrors, closedTabIds, closedWindowIds };
}

async function notifyPpmParentClosed(keepParent, payload, options = {}) {
  if (!keepParent?.tab?.id) return false;
  if (options.focusParent === true) {
    try { await chrome.windows.update(keepParent.tab.windowId, { focused: true }); } catch (_) {}
    try { await chrome.tabs.update(keepParent.tab.id, { active: true }); } catch (_) {}
  }
  try {
    await chrome.tabs.sendMessage(keepParent.tab.id, payload);
    return true;
  } catch (_) {
    return false;
  }
}

async function closeAllPpmChildrenAndNotifyParent(options) {
  const assetCode = String(options.assetCode || '');
  const assetEntityId = String(options.assetEntityId || '').trim();
  const senderTabId = options.senderTabId ?? null;
  const nextPhase = String(options.nextPhase || 'ppm_next');
  const tabs = await chrome.tabs.query({});
  const storedParent = await getStoredPpmParent();
  const { keepParent, registerTabs } = await resolvePpmKeepParent(assetCode, assetEntityId, tabs, storedParent);
  const childTabIds = await collectPpmChildTabIds(tabs, keepParent, storedParent, assetCode, senderTabId);

  const registerIdsWithoutHash = new Set(
    registerTabs.filter((item) => !item.hasTrailingHash && item.tab.id !== keepParent?.tab?.id).map((item) => item.tab.id)
  );
  if (!keepParent) {
    for (const tabId of registerIdsWithoutHash) childTabIds.delete(tabId);
  }

  const { closeErrors, closedTabIds, closedWindowIds } = await closePpmChildSurfaces(childTabIds, keepParent);

  if (storedParent) {
    storedParent.children = (storedParent.children || []).filter((item) => !closedTabIds.includes(item.tabId));
    storedParent.expectChildUntil = 0;
    await savePpmParent(storedParent);
  } else {
    await chrome.storage.local.remove(PPM_CHILD_KEY);
  }

  let parentNotified = false;
  const notifyParent = options.notifyParent !== false;
  if (keepParent && notifyParent) {
    parentNotified = await notifyPpmParentClosed(keepParent, {
      type: 'EE_PPM_CURRENT_EDITOR_CLOSED',
      closedTabId: closedTabIds[0] ?? senderTabId ?? null,
      closedTabIds,
      closedWindowIds,
      closedCount: closedTabIds.length,
      closeErrors,
      assetCode,
      assetEntityId,
      nextPhase,
      closeStrategy: keepParent.hasTrailingHash ? 'trailing-hash-parent-rule' : 'child-registry-close-all',
      parentTabId: keepParent.tab.id,
      parentUrl: keepParent.rawUrl,
      hashParentFound: Boolean(keepParent.hasTrailingHash)
    });
  }

  return {
    ok: closeErrors.length === 0 && (Boolean(keepParent) || closedTabIds.length > 0),
    hashParentFound: Boolean(keepParent),
    parentTabId: keepParent?.tab?.id ?? null,
    parentUrl: keepParent?.rawUrl || '',
    parentNotified,
    closedTabIds,
    closedWindowIds,
    closedCount: closedTabIds.length,
    closeErrors,
    childRegistryCount: storedParent?.children?.length ?? 0
  };
}

async function handlePpmChildTabRemoved(tabId) {
  const parent = await getStoredPpmParent();
  if (!parent?.children?.some((item) => item.tabId === tabId)) return;
  parent.children = parent.children.filter((item) => item.tabId !== tabId);
  await savePpmParent(parent);

  const nextPhase = String(parent.pendingNextPhase || 'ppm_next');
  const hasPendingClose = Boolean(parent.pendingAfterRefreshPhase || parent.pendingNextPhase);
  if (!hasPendingClose || parent.children.length > 0) return;

  let keepParent = null;
  try {
    const tab = await chrome.tabs.get(parent.tabId);
    keepParent = { tab, rawUrl: String(tab.url || ''), hasTrailingHash: String(tab.url || '').endsWith('#') };
  } catch (_) {
    return;
  }

  await notifyPpmParentClosed(keepParent, {
    type: 'EE_PPM_CURRENT_EDITOR_CLOSED',
    closedTabId: tabId,
    closedTabIds: [tabId],
    closedCount: 1,
    closeErrors: [],
    assetCode: parent.assetCode || '',
    assetEntityId: parent.assetEntityId || '',
    nextPhase,
    closeStrategy: 'child-self-closed',
    parentTabId: parent.tabId,
    parentUrl: keepParent.rawUrl,
    hashParentFound: Boolean(keepParent.hasTrailingHash)
  });

  parent.pendingNextPhase = '';
  parent.pendingAfterRefreshPhase = '';
  parent.expectChildUntil = 0;
  await savePpmParent(parent);
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

  if (message.type === 'AUTO_ORCHESTRATOR_SYNC') {
    syncAutoOrchestrator()
      .then((info) => sendResponseSafe(sendResponse, { ok: true, ...info }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'REGISTER_PPM_PARENT') {
    const tab = sender.tab;
    const assetCode = String(message.assetCode || '');
    if (!tab || typeof tab.id !== 'number' || !assetCode) {
      sendResponseSafe(sendResponse, { ok: false, reason: 'missing-parent-tab-or-asset' });
      return false;
    }
    (async () => {
      const existing = await getStoredPpmParent();
      const sameParent = existing && existing.tabId === tab.id && existing.assetCode === assetCode;
      const parent = {
        assetCode,
        assetEntityId: String(message.assetEntityId || existing?.assetEntityId || '').trim(),
        tabId: tab.id,
        windowId: tab.windowId,
        registeredAt: Date.now(),
        children: sameParent ? (existing.children || []) : [],
        expectChildUntil: sameParent ? Number(existing.expectChildUntil || 0) : 0,
        pendingNextPhase: sameParent ? String(existing.pendingNextPhase || '') : '',
        pendingAfterRefreshPhase: sameParent ? String(existing.pendingAfterRefreshPhase || '') : ''
      };
      await savePpmParent(parent);
      sendResponseSafe(sendResponse, { ok: true, parentTabId: tab.id, childCount: parent.children.length });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, reason: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PPM_EXPECT_CHILD') {
    const assetCode = String(message.assetCode || '');
    const expectMs = Math.max(30000, Number(message.expectMs || 90000));
    (async () => {
      const parent = await getStoredPpmParent();
      if (!parent || parent.assetCode !== assetCode) {
        sendResponseSafe(sendResponse, { ok: false, reason: 'parent-not-registered' });
        return;
      }
      parent.expectChildUntil = Date.now() + expectMs;
      await savePpmParent(parent);
      sendResponseSafe(sendResponse, { ok: true, expectChildUntil: parent.expectChildUntil });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, reason: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PPM_PREPARE_CLOSE') {
    const assetCode = String(message.assetCode || '');
    (async () => {
      const parent = await getStoredPpmParent();
      if (!parent || parent.assetCode !== assetCode) {
        sendResponseSafe(sendResponse, { ok: false, reason: 'parent-not-registered' });
        return;
      }
      parent.pendingNextPhase = String(message.nextPhase || 'ppm_next');
      parent.pendingAfterRefreshPhase = String(message.afterRefreshPhase || message.nextPhase || 'ppm_next');
      if (message.assetEntityId) parent.assetEntityId = String(message.assetEntityId).trim();
      await savePpmParent(parent);
      sendResponseSafe(sendResponse, { ok: true, pendingNextPhase: parent.pendingNextPhase });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, reason: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PPM_CHILD_STATE') {
    const assetCode = String(message.assetCode || '');
    (async () => {
      const parent = await getStoredPpmParent();
      if (!parent || parent.assetCode !== assetCode || typeof parent.tabId !== 'number') {
        sendResponseSafe(sendResponse, { ok: true, found: false, reason: 'parent-not-registered' });
        return;
      }
      for (const item of parent.children || []) {
        if (typeof item.tabId !== 'number' || item.tabId === parent.tabId) continue;
        try {
          const tab = await chrome.tabs.get(item.tabId);
          sendResponseSafe(sendResponse, {
            ok: true,
            found: true,
            tabId: tab.id,
            url: tab.url || item.url || '',
            status: tab.status || '',
            tracked: true,
            childCount: parent.children.length
          });
          return;
        } catch (_) {}
      }
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id === parent.tabId) continue;
        if (!isPpmEditorUrl(tab.url)) continue;
        const openerMatch = tab.openerTabId === parent.tabId;
        const expectMatch = Number(parent.expectChildUntil || 0) > Date.now() && tab.windowId !== parent.windowId;
        if (!openerMatch && !expectMatch) continue;
        await registerPpmChildTab(tab);
        sendResponseSafe(sendResponse, {
          ok: true,
          found: true,
          tabId: tab.id,
          url: tab.url || '',
          status: tab.status || '',
          tracked: false,
          childCount: (await getStoredPpmParent())?.children?.length ?? 0
        });
        return;
      }
      sendResponseSafe(sendResponse, { ok: true, found: false, childCount: parent.children?.length ?? 0 });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, found: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PPM_SWEEP_CHILDREN') {
    const assetCode = String(message.assetCode || '');
    const assetEntityId = String(message.assetEntityId || '').trim();
    const senderTabId = sender.tab?.id;

    (async () => {
      const result = await closeAllPpmChildrenAndNotifyParent({
        assetCode,
        assetEntityId,
        senderTabId,
        nextPhase: String(message.nextPhase || 'ppm_next'),
        notifyParent: false
      });
      sendResponseSafe(sendResponse, { assetCode, assetEntityId, ...result });
    })().catch((error) => sendResponseSafe(sendResponse, {
      ok: false,
      reason: String(error?.message || error),
      currentTabId: senderTabId ?? null
    }));
    return true;
  }

  if (message.type === 'PPM_CLOSE_CURRENT_EDITOR_TAB') {
    const assetCode = String(message.assetCode || '');
    const assetEntityId = String(message.assetEntityId || '').trim();
    const senderTabId = sender.tab?.id;

    (async () => {
      const result = await closeAllPpmChildrenAndNotifyParent({
        assetCode,
        assetEntityId,
        senderTabId,
        nextPhase: String(message.nextPhase || 'ppm_next'),
        notifyParent: true
      });
      const parent = await getStoredPpmParent();
      if (parent) {
        parent.pendingNextPhase = '';
        parent.pendingAfterRefreshPhase = '';
        await savePpmParent(parent);
      }
      sendResponseSafe(sendResponse, { assetCode, assetEntityId, ...result });
    })().catch((error) => sendResponseSafe(sendResponse, {
      ok: false,
      reason: String(error?.message || error),
      currentTabId: senderTabId ?? null
    }));
    return true;
  }

  if (message.type === 'PPM_CHILD_DONE_SELF_CLOSE') {
    const assetCode = String(message.assetCode || '');
    const senderTabId = sender.tab?.id;
    chrome.storage.local.get([PPM_PARENT_KEY]).then((data) => {
      const parent = data[PPM_PARENT_KEY];
      if (!parent || parent.assetCode !== assetCode || typeof parent.tabId !== 'number') {
        sendResponseSafe(sendResponse, { ok: false, reason: 'parent-not-registered', childTabId: senderTabId ?? null });
        return;
      }
      (async () => {
        try { await chrome.windows.update(parent.windowId, { focused: true }); } catch (_) {}
        try { await chrome.tabs.update(parent.tabId, { active: true }); } catch (_) {}
        try {
          await chrome.tabs.sendMessage(parent.tabId, {
            type: 'EE_PPM_CHILD_DONE',
            childTabId: senderTabId ?? null,
            childClosed: true,
            closeError: '',
            assetCode,
            afterRefreshPhase: String(message.afterRefreshPhase || '')
          });
        } catch (_) {}
        try { await chrome.storage.local.remove(PPM_CHILD_KEY); } catch (_) {}
        sendResponseSafe(sendResponse, { ok: true, parentTabId: parent.tabId, childTabId: senderTabId ?? null });
      })();
    }).catch((error) => sendResponseSafe(sendResponse, { ok: false, reason: String(error?.message || error), childTabId: senderTabId ?? null }));
    return true;
  }

  if (message.type === 'PPM_CHILD_DONE') {
    const assetCode = String(message.assetCode || '');
    const assetEntityId = String(message.assetEntityId || '').trim();
    const senderTabId = sender.tab?.id;
    (async () => {
      const parent = await getStoredPpmParent();
      if (!parent || parent.assetCode !== assetCode || typeof parent.tabId !== 'number') {
        sendResponseSafe(sendResponse, { ok: false, reason: 'parent-not-registered', childTabId: senderTabId ?? null });
        return;
      }
      const nextPhase = String(message.afterRefreshPhase || message.nextPhase || 'ppm_next');
      parent.pendingNextPhase = nextPhase;
      parent.pendingAfterRefreshPhase = nextPhase;
      if (assetEntityId) parent.assetEntityId = assetEntityId;
      await savePpmParent(parent);
      const result = await closeAllPpmChildrenAndNotifyParent({
        assetCode,
        assetEntityId: assetEntityId || parent.assetEntityId || '',
        senderTabId,
        nextPhase
      });
      parent.pendingNextPhase = '';
      parent.pendingAfterRefreshPhase = '';
      await savePpmParent(parent);
      sendResponseSafe(sendResponse, {
        ok: result.ok,
        parentTabId: parent.tabId,
        childTabId: result.closedTabIds[0] ?? senderTabId ?? null,
        childClosed: result.closedCount > 0,
        parentNotified: result.parentNotified,
        ...result
      });
    })().catch((error) => sendResponseSafe(sendResponse, { ok: false, reason: String(error?.message || error), childTabId: senderTabId ?? null }));
    return true;
  }

  if (message.type === 'ASSET_CLOSE_EDITOR_TAB') {
    const assetCode = String(message.assetCode || '');
    const assetEntityId = String(message.assetEntityId || '').trim();
    const senderTabId = sender.tab?.id;

    (async () => {
      const stored = await chrome.storage.local.get(ASSET_TAB_KEY);
      const registeredParent = stored[ASSET_TAB_KEY];
      let parentTabId = typeof sender.tab?.openerTabId === 'number' ? sender.tab.openerTabId : null;
      if (!parentTabId && registeredParent && typeof registeredParent.tabId === 'number') {
        parentTabId = registeredParent.tabId;
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

  if (message.type === 'REGISTER_ASSET_TAB') {
    const tab = sender.tab;
    if (!tab || typeof tab.id !== 'number') {
      sendResponseSafe(sendResponse, { ok: false });
      return false;
    }
    chrome.storage.local.set({
      [ASSET_TAB_KEY]: { tabId: tab.id, windowId: tab.windowId, registeredAt: Date.now() }
    }).then(() => sendResponseSafe(sendResponse, { ok: true, tabId: tab.id }));
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
    chrome.storage.local.get(ASSET_TAB_KEY).then(async (data) => {
      const asset = data[ASSET_TAB_KEY];
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

chrome.tabs.onCreated.addListener((tab) => {
  if (typeof tab?.id !== 'number') return;
  registerPpmChildTab(tab).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof tabId !== 'number') return;
  registerPpmChildTab(tab || { id: tabId, url: changeInfo.url }).catch(() => {});
  getStoredPpmParent().then((parent) => {
    if (!parent?.children?.some((item) => item.tabId === tabId)) return;
    const entry = parent.children.find((item) => item.tabId === tabId);
    if (!entry) return;
    if (changeInfo.url) entry.url = changeInfo.url;
    if (changeInfo.status) entry.status = changeInfo.status;
    entry.updatedAt = Date.now();
    savePpmParent(parent).catch(() => {});
  }).catch(() => {});
  const url = String(changeInfo.url || tab?.url || '');
  if (url && isPpmEditorUrl(url)) {
    handlePpmEditorUrlUpdate(tabId, url).catch(() => {});
  }
  if (changeInfo.status === 'complete' && tab?.url && isPpmEditorUrl(tab.url)) {
    handlePpmEditorUrlUpdate(tabId, tab.url).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_ALARM) return;
  syncAutoOrchestrator().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(ASSET_TAB_KEY).then((data) => {
    if (data[ASSET_TAB_KEY]?.tabId === tabId) chrome.storage.local.remove(ASSET_TAB_KEY);
  });
  getStoredPpmParent().then((parent) => {
    if (parent?.tabId === tabId) {
      savePpmParent(null).catch(() => {});
      return;
    }
    handlePpmChildTabRemoved(tabId).catch(() => {});
  }).catch(() => {});
});
