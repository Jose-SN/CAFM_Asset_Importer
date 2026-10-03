'use strict';

const ASSET_TAB_KEY = 'wchCafmAssetTabV32';
const lookupClaims = new Map();

const PPM_PARENT_KEY = 'wchCafmPpmParentV805';
const PPM_CHILD_KEY = 'wchCafmPpmChildV807';

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

  if (message.type === 'REGISTER_PPM_PARENT') {
    const tab = sender.tab;
    const assetCode = String(message.assetCode || '');
    if (!tab || typeof tab.id !== 'number' || !assetCode) {
      sendResponseSafe(sendResponse, { ok: false, reason: 'missing-parent-tab-or-asset' });
      return false;
    }
    const parent = {
      assetCode,
      assetEntityId: String(message.assetEntityId || '').trim(),
      tabId: tab.id,
      windowId: tab.windowId,
      registeredAt: Date.now()
    };
    chrome.storage.local.set({ [PPM_PARENT_KEY]: parent })
      .then(() => chrome.storage.local.remove(PPM_CHILD_KEY))
      .then(() => sendResponseSafe(sendResponse, { ok: true, parentTabId: tab.id }))
      .catch((error) => sendResponseSafe(sendResponse, { ok: false, reason: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'PPM_CHILD_STATE') {
    const assetCode = String(message.assetCode || '');
    chrome.storage.local.get([PPM_PARENT_KEY, PPM_CHILD_KEY]).then(async (data) => {
      const parent = data[PPM_PARENT_KEY];
      const tracked = data[PPM_CHILD_KEY];
      if (!parent || parent.assetCode !== assetCode || typeof parent.tabId !== 'number') {
        sendResponseSafe(sendResponse, { ok: true, found: false, reason: 'parent-not-registered' });
        return;
      }
      if (tracked && tracked.assetCode === assetCode && typeof tracked.tabId === 'number') {
        try {
          const tab = await chrome.tabs.get(tracked.tabId);
          if (tab && tab.id !== parent.tabId) {
            sendResponseSafe(sendResponse, { ok: true, found: true, tabId: tab.id, url: tab.url || tracked.url || '', status: tab.status || '', tracked: true });
            return;
          }
        } catch (_) {
          try { await chrome.storage.local.remove(PPM_CHILD_KEY); } catch (_) {}
        }
      }
      const tabs = await chrome.tabs.query({});
      const child = tabs.find((tab) => tab.id !== parent.tabId && tab.openerTabId === parent.tabId && /\/Evolution\/!System\/PPMs\/FPPM\/ViewFPPMItem\.aspx/i.test(String(tab.url || '')));
      if (child) {
        const info = { assetCode, tabId: child.id, windowId: child.windowId, openerTabId: child.openerTabId, url: child.url || '', registeredAt: Date.now() };
        try { await chrome.storage.local.set({ [PPM_CHILD_KEY]: info }); } catch (_) {}
        sendResponseSafe(sendResponse, { ok: true, found: true, tabId: child.id, url: child.url || '', status: child.status || '', tracked: false });
        return;
      }
      sendResponseSafe(sendResponse, { ok: true, found: false });
    }).catch((error) => sendResponseSafe(sendResponse, { ok: false, found: false, error: String(error?.message || error) }));
    return true;
  }



  if (message.type === 'PPM_CLOSE_CURRENT_EDITOR_TAB') {
    const assetCode = String(message.assetCode || '');
    const assetEntityId = String(message.assetEntityId || '').trim();
    const senderTabId = sender.tab?.id;

    (async () => {
      const ppmEditorPattern = /\/Evolution\/!System\/PPMs\/FPPM\/ViewFPPMItem\.aspx/i;
      const ppmRegisterPattern = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItemPPMs\.aspx/i;
      const assetEditorPattern = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItem\.aspx/i;
      const tabs = await chrome.tabs.query({});
      const storedParent = await chrome.storage.local.get([PPM_PARENT_KEY]).then((data) => data[PPM_PARENT_KEY] || null).catch(() => null);

      const registerTabs = [];
      for (const tab of tabs) {
        if (typeof tab.id !== 'number') continue;
        const rawUrl = String(tab.url || '');
        if (!ppmRegisterPattern.test(rawUrl)) continue;
        let candidateAssetId = '';
        try { candidateAssetId = String(new URL(rawUrl).searchParams.get('id') || '').trim(); } catch (_) {}
        if (assetEntityId && candidateAssetId !== assetEntityId) continue;
        registerTabs.push({
          tab,
          rawUrl,
          assetId: candidateAssetId,
          hasTrailingHash: rawUrl.endsWith('#')
        });
      }

      // The single source of truth for parent/duplicate identity is the trailing #.
      // KEEP a PPM register ending in #. CLOSE same-asset PPM registers without #.
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
          if (!assetEditorPattern.test(rawUrl)) return false;
          try {
            const id = String(new URL(rawUrl).searchParams.get('id') || '').trim();
            return id && id !== '-1' && id === assetEntityId;
          } catch (_) { return false; }
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

      const candidateIds = [];
      const candidateInfo = [];
      const registerTabIds = new Set(registerTabs.map((item) => item.tab.id));
      const parentTabIds = new Set(registerTabIds);
      if (keepParent?.tab?.id) parentTabIds.add(keepParent.tab.id);
      if (storedParent && typeof storedParent.tabId === 'number') parentTabIds.add(storedParent.tabId);

      for (const item of registerTabs) {
        if (item.hasTrailingHash) continue;
        if (keepParent?.tab?.id === item.tab.id) continue;
        candidateIds.push(item.tab.id);
        candidateInfo.push({
          tabId: item.tab.id,
          windowId: item.tab.windowId,
          openerTabId: item.tab.openerTabId ?? null,
          url: item.rawUrl,
          kind: 'ppm-register-without-hash',
          closeReason: 'URL does not end with #'
        });
      }

      // Close PPM editor windows associated with this workflow. The current sender is
      // always eligible; other editors are eligible when opened by the parent register tab.
      for (const tab of tabs) {
        if (typeof tab.id !== 'number') continue;
        const rawUrl = String(tab.url || '');
        if (!ppmEditorPattern.test(rawUrl)) continue;
        const isSender = typeof senderTabId === 'number' && tab.id === senderTabId;
        const belongsToCurrentRegister = typeof tab.openerTabId === 'number' && parentTabIds.has(tab.openerTabId);
        if (!isSender && !belongsToCurrentRegister) continue;
        if (candidateIds.includes(tab.id)) continue;
        candidateIds.push(tab.id);
        candidateInfo.push({
          tabId: tab.id,
          windowId: tab.windowId,
          openerTabId: tab.openerTabId ?? null,
          url: rawUrl,
          kind: 'ppm-editor',
          closeReason: isSender ? 'current completed PPM editor' : 'opened by current PPM register'
        });
      }

      // Safety: if no # parent exists, do not close any PPM register. We can still
      // close the current editor, but we will not risk deleting the only register.
      let effectiveCandidates = candidateIds.slice();
      if (!keepParent) {
        const registerIdsWithoutHash = new Set(registerTabs.filter((item) => !item.hasTrailingHash).map((item) => item.tab.id));
        effectiveCandidates = effectiveCandidates.filter((id) => !registerIdsWithoutHash.has(id));
      }

      const closeErrors = [];
      const closedTabIds = [];
      for (const tabId of effectiveCandidates) {
        try {
          await chrome.tabs.remove(tabId);
          closedTabIds.push(tabId);
        } catch (error) {
          closeErrors.push({ tabId, error: String(error?.message || error) });
        }
      }

      try { await chrome.storage.local.remove(PPM_CHILD_KEY); } catch (_) {}

      if (keepParent) {
        try { await chrome.windows.update(keepParent.tab.windowId, { focused: true }); } catch (_) {}
        try { await chrome.tabs.update(keepParent.tab.id, { active: true }); } catch (_) {}
        try {
          await chrome.tabs.sendMessage(keepParent.tab.id, {
            type: 'EE_PPM_CURRENT_EDITOR_CLOSED',
            closedTabId: closedTabIds[0] ?? senderTabId ?? null,
            closedTabIds,
            closedCount: closedTabIds.length,
            closeErrors,
            candidateInfo,
            assetCode,
            assetEntityId,
            nextPhase: String(message.nextPhase || 'ppm_next'),
            closeStrategy: keepParent.hasTrailingHash ? 'trailing-hash-parent-rule' : 'registered-or-embedded-parent',
            parentTabId: keepParent.tab.id,
            parentUrl: keepParent.rawUrl,
            hashParentFound: Boolean(keepParent.hasTrailingHash)
          });
        } catch (_) {}
      }

      sendResponseSafe(sendResponse, {
        ok: closeErrors.length === 0 && (Boolean(keepParent) || closedTabIds.length > 0),
        assetCode,
        assetEntityId,
        hashParentFound: Boolean(keepParent),
        parentTabId: keepParent?.tab?.id ?? null,
        parentUrl: keepParent?.rawUrl || '',
        closedTabIds,
        closedCount: closedTabIds.length,
        closeErrors,
        candidateInfo,
        registerTabs: registerTabs.map((item) => ({
          tabId: item.tab.id,
          url: item.rawUrl,
          hasTrailingHash: item.hasTrailingHash
        }))
      });
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
    const senderTabId = sender.tab?.id;
    chrome.storage.local.get([PPM_PARENT_KEY, PPM_CHILD_KEY]).then((data) => {
      const parent = data[PPM_PARENT_KEY];
      const tracked = data[PPM_CHILD_KEY];
      if (!parent || parent.assetCode !== assetCode || typeof parent.tabId !== 'number') {
        sendResponseSafe(sendResponse, { ok: false, reason: 'parent-not-registered', childTabId: senderTabId ?? null });
        return;
      }
      (async () => {
        const candidates = [];
        if (tracked && tracked.assetCode === assetCode && typeof tracked.tabId === 'number' && tracked.tabId !== parent.tabId) candidates.push(tracked.tabId);
        if (typeof senderTabId === 'number' && senderTabId !== parent.tabId && !candidates.includes(senderTabId)) candidates.push(senderTabId);
        let childClosed = false;
        let closedTabId = null;
        let closeError = '';
        for (const tabId of candidates) {
          try {
            await chrome.tabs.remove(tabId);
            childClosed = true;
            closedTabId = tabId;
            break;
          } catch (error) {
            closeError = String(error?.message || error);
          }
        }
        try { await chrome.storage.local.remove(PPM_CHILD_KEY); } catch (_) {}
        try { await chrome.windows.update(parent.windowId, { focused: true }); } catch (_) {}
        try { await chrome.tabs.update(parent.tabId, { active: true }); } catch (_) {}
        try {
          await chrome.tabs.sendMessage(parent.tabId, {
            type: 'EE_PPM_CHILD_DONE',
            childTabId: closedTabId ?? senderTabId ?? null,
            childClosed,
            closeError,
            assetCode,
            afterRefreshPhase: String(message.afterRefreshPhase || '')
          });
        } catch (_) {}
        sendResponseSafe(sendResponse, { ok: true, parentTabId: parent.tabId, childTabId: closedTabId ?? senderTabId ?? null, childClosed, closeError });
      })();
    }).catch((error) => sendResponseSafe(sendResponse, { ok: false, reason: String(error?.message || error), childTabId: senderTabId ?? null }));
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
  chrome.storage.local.get(PPM_PARENT_KEY).then((data) => {
    const parent = data[PPM_PARENT_KEY];
    if (!parent || typeof parent.tabId !== 'number') return;
    if (tab.id === parent.tabId || tab.openerTabId !== parent.tabId) return;
    const child = {
      assetCode: parent.assetCode || '',
      tabId: tab.id,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId,
      url: tab.url || '',
      registeredAt: Date.now()
    };
    chrome.storage.local.set({ [PPM_CHILD_KEY]: child }).catch(() => {});
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  chrome.storage.local.get(PPM_CHILD_KEY).then((data) => {
    const child = data[PPM_CHILD_KEY];
    if (!child || child.tabId !== tabId) return;
    const updated = { ...child, url: changeInfo.url || tab?.url || child.url || '', status: changeInfo.status || tab?.status || child.status || '', updatedAt: Date.now() };
    chrome.storage.local.set({ [PPM_CHILD_KEY]: updated }).catch(() => {});
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(ASSET_TAB_KEY).then((data) => {
    if (data[ASSET_TAB_KEY]?.tabId === tabId) chrome.storage.local.remove(ASSET_TAB_KEY);
  });
  chrome.storage.local.get(PPM_PARENT_KEY).then((data) => {
    if (data[PPM_PARENT_KEY]?.tabId === tabId) chrome.storage.local.remove(PPM_PARENT_KEY);
  });
  chrome.storage.local.get(PPM_CHILD_KEY).then((data) => {
    if (data[PPM_CHILD_KEY]?.tabId === tabId) chrome.storage.local.remove(PPM_CHILD_KEY);
  });
});
