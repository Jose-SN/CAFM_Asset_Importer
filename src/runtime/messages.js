(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { STORAGE } = root.core.constants;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;
  function configure(deps) { cfg = Object.freeze({ ...deps }); }
  function C() {
    if (!cfg) throw new Error('CAFMImporter messages module is not configured yet.');
    return cfg;
  }

  function initMessageListeners() {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;
      const {
        state, addEvent, storageGet, persistSession, render, scheduleAuto, runAutomatic,
        isAssetPage, assetEntityUrl, entityIdFromUrl, isSavedAssetPage
      } = C();

      if (message.type === 'RUN_AUTO_STEP') {
        storageGet([STORAGE.session]).then(async (stored) => {
          if (stored[STORAGE.session]) state.session = { ...state.session, ...stored[STORAGE.session] };
          if (!state.session.auto?.active) return;
          try {
            await runAutomatic();
          } catch (_) {
            scheduleAuto(0);
          }
        }).catch(() => {});
        return;
      }

      if (message.type === 'EE_ASSET_EDITOR_CLOSED') {
        addEvent('asset-parent-editor-close-message', {
          assetCode: message.assetCode || '',
          assetEntityId: message.assetEntityId || '',
          closedTabId: message.closedTabId ?? null,
          childClosed: Boolean(message.childClosed),
          closeErrors: Array.isArray(message.closeErrors) ? message.closeErrors : [],
          parentUrl: location.href
        });
        storageGet([STORAGE.session]).then(async (stored) => {
          if (stored[STORAGE.session]) state.session = { ...state.session, ...stored[STORAGE.session] };
          const currentAuto = state.session.auto || {};
          const entityId = String(message.assetEntityId || currentAuto.assetEntityId || '').trim();
          state.session.auto = {
            ...currentAuto,
            active: true,
            phase: 'activate_open',
            assetEntityId: entityId || currentAuto.assetEntityId || '',
            assetCloseStartedAt: 0,
            assetCloseRequestedAt: 0,
            activationButtonStartedAt: 0,
            activationClickAttempts: 0,
            activationLastClickAt: 0
          };
          await persistSession();
          render();
          if (entityId && (!isSavedAssetPage() || entityIdFromUrl() !== entityId)) {
            location.href = assetEntityUrl(entityId);
            return;
          }
          scheduleAuto(150);
        }).catch(() => scheduleAuto(250));
      }
    });
  }

  root.runtime = root.runtime || {};
  root.runtime.messages = Object.freeze({ configure, initMessageListeners });
})();
