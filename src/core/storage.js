(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { LARGE_KEY } = root.core.constants;

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

  root.core.storage = Object.freeze({
    runtimeMessage,
    storageGet,
    storageSet,
    storageRemove,
    saveLargeWorkbook,
    loadLargeWorkbook,
    clearLargeWorkbook
  });
})();
