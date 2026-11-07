(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { LARGE_KEY, STORAGE } = root.core.constants;

  let reloadHintShown = false;

  function extensionContextLive() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  function showContextReloadHint() {
    if (reloadHintShown || typeof document === 'undefined') return;
    reloadHintShown = true;
    try {
      if (document.getElementById('cafm-importer-reload-hint')) return;
      const el = document.createElement('div');
      el.id = 'cafm-importer-reload-hint';
      el.setAttribute('role', 'alert');
      el.textContent = 'CAFM Importer was reloaded or updated — refresh this tab (F5) before continuing automation.';
      Object.assign(el.style, {
        position: 'fixed',
        bottom: '14px',
        left: '14px',
        maxWidth: '420px',
        padding: '12px 14px',
        background: '#5a1e1e',
        color: '#fff',
        font: '13px/1.4 Segoe UI, system-ui, sans-serif',
        borderRadius: '8px',
        boxShadow: '0 4px 18px rgba(0,0,0,.35)',
        zIndex: '2147483646',
        pointerEvents: 'none'
      });
      (document.body || document.documentElement).appendChild(el);
    } catch (_) {}
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      if (!extensionContextLive()) {
        showContextReloadHint();
        resolve(null);
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (_) {
        showContextReloadHint();
        resolve(null);
      }
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!extensionContextLive()) {
        showContextReloadHint();
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(keys, (items) => {
          if (chrome.runtime.lastError) resolve({});
          else resolve(items || {});
        });
      } catch (_) {
        showContextReloadHint();
        resolve({});
      }
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      if (!extensionContextLive()) {
        showContextReloadHint();
        resolve(false);
        return;
      }
      try {
        chrome.storage.local.set(values, () => {
          if (chrome.runtime.lastError) {
            showContextReloadHint();
            resolve(false);
          } else resolve(true);
        });
      } catch (_) {
        showContextReloadHint();
        resolve(false);
      }
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      if (!extensionContextLive()) {
        showContextReloadHint();
        resolve(false);
        return;
      }
      try {
        chrome.storage.local.remove(keys, () => {
          if (chrome.runtime.lastError) resolve(false);
          else resolve(true);
        });
      } catch (_) {
        showContextReloadHint();
        resolve(false);
      }
    });
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
    if (!extensionContextLive()) {
      showContextReloadHint();
      return false;
    }
    let manifestVersion = '';
    try {
      manifestVersion = String(chrome.runtime.getManifest().version || '').trim();
    } catch (_) {
      showContextReloadHint();
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
    extensionContextLive,
    showContextReloadHint,
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
