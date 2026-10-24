(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { LARGE_KEY, STORAGE } = root.core.constants;

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }

  function storageRemove(keys) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
  }

  async function saveLargeWorkbook(cache) {
    const result = await runtimeMessage({ type: 'LARGE_STORAGE_PUT', key: LARGE_KEY, value: cache });
    if (!result?.ok) throw new Error(result?.error || 'Unable to cache workbook data.');
    return result;
  }

  async function loadLargeWorkbook() {
    const result = await runtimeMessage({ type: 'LARGE_STORAGE_GET', key: LARGE_KEY });
    if (!result?.ok) return null;
    return result.value || null;
  }

  async function clearLargeWorkbook() {
    await runtimeMessage({ type: 'LARGE_STORAGE_REMOVE', key: LARGE_KEY });
  }

  async function ensureStorageVersion() {
    let manifestVersion = '';
    try {
      manifestVersion = String(chrome.runtime.getManifest().version || '').trim();
    } catch (_) {
      return false;
    }
    if (!manifestVersion) return false;
    const stored = await storageGet([STORAGE.installedVersion]);
    if (stored[STORAGE.installedVersion] === manifestVersion) return false;
    await runtimeMessage({ type: 'EXTENSION_STORAGE_RESET', version: manifestVersion });
    try {
      if (window.top === window.self) {
        sessionStorage.clear();
        localStorage.clear();
      }
    } catch (_) {}
    return true;
  }

  root.core.storage = Object.freeze({
    runtimeMessage,
    storageGet,
    storageSet,
    storageRemove,
    saveLargeWorkbook,
    loadLargeWorkbook,
    clearLargeWorkbook,
    ensureStorageVersion
  });
})();
