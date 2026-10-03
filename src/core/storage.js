(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { LARGE_KEY } = root.core.constants;

  const EXTENSION_RELOAD_HINT = 'Extension was reloaded. Press F5 on this CAFM tab, then click Reload on the extension at chrome://extensions if needed.';

  function isExtensionContextValid() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  function isExtensionContextInvalidError(error) {
    const message = String(error?.message || error || '');
    return /extension context invalidated/i.test(message)
      || /context invalidated/i.test(message)
      || /receiving end does not exist/i.test(message);
  }

  function handleExtensionInvalidated(showToast, state) {
    if (state?.extensionReloadHandled) return;
    if (state) {
      state.extensionReloadHandled = true;
      if (state.autoTimer) {
        clearTimeout(state.autoTimer);
        state.autoTimer = null;
      }
      const auto = state.session?.auto;
      if (auto?.active) {
        state.session.auto = {
          ...auto,
          active: false,
          failedPhase: auto.phase || auto.failedPhase || '',
          phase: 'error',
          error: EXTENSION_RELOAD_HINT
        };
      }
    }
    try {
      showToast?.(EXTENSION_RELOAD_HINT, 'error', 20000);
    } catch (_) {}
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) {
        resolve(null);
        return;
      }
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
    return new Promise((resolve, reject) => {
      if (!isExtensionContextValid()) {
        reject(new Error('Extension context invalidated.'));
        return;
      }
      try {
        chrome.storage.local.get(keys, (result) => {
          try {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
              return;
            }
            resolve(result || {});
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextValid()) {
        reject(new Error('Extension context invalidated.'));
        return;
      }
      try {
        chrome.storage.local.set(values, () => {
          try {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
              return;
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextValid()) {
        reject(new Error('Extension context invalidated.'));
        return;
      }
      try {
        chrome.storage.local.remove(keys, () => {
          try {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || String(chrome.runtime.lastError)));
              return;
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
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

  root.core.storage = Object.freeze({
    EXTENSION_RELOAD_HINT,
    runtimeMessage,
    storageGet,
    storageSet,
    storageRemove,
    isExtensionContextValid,
    isExtensionContextInvalidError,
    handleExtensionInvalidated,
    saveLargeWorkbook,
    loadLargeWorkbook,
    clearLargeWorkbook
  });
})();
