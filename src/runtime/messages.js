(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { STORAGE, DEFAULT_SETTINGS } = root.core.constants;

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
        isAssetPage, assetEntityUrl, entityIdFromUrl, isSavedAssetPage, showToast
      } = C();

      if (message.type === 'EE_EXTENSION_VERSION_RESET') {
        try { sessionStorage.clear(); localStorage.clear(); } catch (_) {}
        state.assets = [];
        state.allAssets = [];
        state.ppms = [];
        state.cache = null;
        state.learnedStatus = null;
        state.learnedNew = null;
        state.busy = false;
        state.lookupAgentBusy = false;
        state.lastLoggedPhase = '';
        state.settings = { ...DEFAULT_SETTINGS };
        state.session = {
          fileName: '',
          fileSize: 0,
          fileModified: 0,
          index: 0,
          statuses: {},
          newEntityUrl: root.core.pages.deriveNewEntityUrl(),
          auto: null,
          manualAwaitSave: null,
          currentLookupEvidence: [],
          events: []
        };
        clearTimeout(state.autoTimer);
        clearTimeout(state.lookupTimer);
        state.autoTimer = null;
        state.lookupTimer = null;
        render?.();
        root.ui.progressToast.stopTick?.();
        showToast?.(`Extension updated to v${message.version || 'new'}. Importer cache and session were cleared — reload your workbook.`, 'info', 12000);
        return;
      }

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
