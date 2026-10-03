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
      const { state, addEvent, storageGet, persistSession, render, scheduleAuto, isHashPpmParentPage } = C();

      if (message.type === 'EE_PPM_CURRENT_EDITOR_CLOSED' && isHashPpmParentPage()) {
        addEvent('ppm-parent-current-editor-close-message', {
          closedTabId: message.closedTabId ?? null,
          closedTabIds: Array.isArray(message.closedTabIds) ? message.closedTabIds : [],
          closedCount: Number(message.closedCount || 0),
          closeErrors: Array.isArray(message.closeErrors) ? message.closeErrors : [],
          candidateInfo: Array.isArray(message.candidateInfo) ? message.candidateInfo : [],
          nextPhase: message.nextPhase || '',
          closeStrategy: message.closeStrategy || '',
          parentUrl: location.href
        });
        storageGet([STORAGE.session]).then(async (stored) => {
          if (stored[STORAGE.session]) state.session = { ...state.session, ...stored[STORAGE.session] };
          const currentAuto = state.session.auto || {};
          const nextPhase = String(message.nextPhase || 'ppm_next');
          state.session.auto = {
            ...currentAuto,
            phase: nextPhase,
            ppmAfterRefreshPhase: '',
            ppmParentRefreshStartedAt: 0,
            ppmParentRefreshClickedAt: 0,
            ppmParentRefreshPageInstance: '',
            ppmParentRefreshSawDisabled: false,
            ppmNewClickedForIndex: -1,
            ppmListReadyStartedAt: 0,
            ppmOpenStartedAt: 0,
            ppmNewClickAttempts: 0,
            ppmNewLastClickAt: 0
          };
          await persistSession();
          render();
          scheduleAuto(100);
        }).catch(() => scheduleAuto(200));
        return;
      }

      if (message.type === 'EE_PPM_CHILD_DONE' && isHashPpmParentPage()) {
        addEvent('ppm-parent-child-done-message', {
          childTabId: message.childTabId ?? null,
          childClosed: Boolean(message.childClosed),
          afterRefreshPhase: message.afterRefreshPhase || '',
          closeError: message.closeError || '',
          parentUrl: location.href
        });
        storageGet([STORAGE.session]).then(async (stored) => {
          if (stored[STORAGE.session]) state.session = { ...state.session, ...stored[STORAGE.session] };
          const currentAuto = state.session.auto || {};
          const nextPhase = String(message.afterRefreshPhase || currentAuto.ppmAfterRefreshPhase || 'ppm_next');
          state.session.auto = {
            ...currentAuto,
            phase: nextPhase,
            ppmAfterRefreshPhase: '',
            ppmParentRefreshStartedAt: 0,
            ppmParentRefreshClickedAt: 0,
            ppmParentRefreshPageInstance: '',
            ppmParentRefreshSawDisabled: false,
            ppmNewClickedForIndex: -1,
            ppmListReadyStartedAt: 0,
            ppmOpenStartedAt: 0,
            ppmNewClickAttempts: 0,
            ppmNewLastClickAt: 0
          };
          await persistSession();
          render();
          scheduleAuto(50);
        }).catch(() => scheduleAuto(150));
      }
    });
  }

  root.runtime = root.runtime || {};
  root.runtime.messages = Object.freeze({ configure, initMessageListeners });
})();
