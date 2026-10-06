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

  function schedulePpmParentRefreshAfterClose(currentAuto, afterRefreshPhase) {
    const phase = String(currentAuto.phase || '');
    if (['ppm_parent_refresh', 'ppm_parent_refresh_wait'].includes(phase)) {
      return null;
    }
    const lastNotify = Number(currentAuto.ppmParentCloseNotifyAt || 0);
    if (lastNotify && Date.now() - lastNotify < 2500) {
      return null;
    }
    const resolvedAfter = String(afterRefreshPhase || currentAuto.ppmAfterRefreshPhase || 'ppm_next');
    return {
      ...currentAuto,
      active: true,
      phase: 'ppm_parent_refresh',
      ppmAfterRefreshPhase: resolvedAfter,
      ppmParentRefreshStartedAt: 0,
      ppmParentRefreshClickedAt: 0,
      ppmParentRefreshPageInstance: '',
      ppmParentRefreshSawDisabled: false,
      ppmParentCloseNotifyAt: Date.now(),
      ppmNewClickedForIndex: -1,
      ppmListReadyStartedAt: 0,
      ppmOpenStartedAt: 0,
      ppmNewClickAttempts: 0,
      ppmNewLastClickAt: 0
    };
  }

  function initMessageListeners() {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || typeof message !== 'object') return;
      const {
        state, addEvent, storageGet, persistSession, render, scheduleAuto, runAutomatic,
        isPpmRegisterParentPage, isPpmItemPage, isAssetPage, assetEntityUrl, entityIdFromUrl,
        isSavedAssetPage, workflowRecord, currentPpm, recordPpmResult, showActivity
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

      if (message.type === 'PPM_SAVED_URL_DETECTED' && isPpmItemPage()) {
        const ppmEntityId = String(message.ppmEntityId || entityIdFromUrl() || '').trim();
        if (!ppmEntityId || ppmEntityId === '-1') return;
        storageGet([STORAGE.session]).then(async (stored) => {
          if (stored[STORAGE.session]) state.session = { ...state.session, ...stored[STORAGE.session] };
          const auto = state.session.auto || {};
          const phase = String(auto.phase || '');
          if (!auto.active || !['ppm_await_save', 'ppm_fill'].includes(phase)) return;
          const record = workflowRecord(auto);
          const ppm = currentPpm(record);
          if (!record || !ppm) return;
          addEvent('ppm-save-url-detected', {
            ppmKey: ppm.ppmKey,
            ppmEntityId,
            phase,
            source: message.source || 'background'
          });
          await recordPpmResult(record, ppm, 'saved', 'Background detected saved PPM URL', ppmEntityId);
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
        return;
      }

      if (message.type === 'EE_PPM_CURRENT_EDITOR_CLOSED' && isPpmRegisterParentPage()) {
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
          const afterRefreshPhase = String(message.nextPhase || 'ppm_next');
          const nextAuto = schedulePpmParentRefreshAfterClose(currentAuto, afterRefreshPhase);
          if (!nextAuto) {
            addEvent('ppm-parent-refresh-coalesced', { afterRefreshPhase, priorPhase: currentAuto.phase || '' });
            return;
          }
          state.session.auto = nextAuto;
          await persistSession();
          render();
          const handoffRecord = workflowRecord(nextAuto);
          const nextPpm = currentPpm(handoffRecord);
          const ppmSlot = (Number(nextAuto.ppmIndex) || 0) + 1;
          showActivity?.(
            'Waiting',
            'PPM editor closed',
            afterRefreshPhase === 'ppm_cycle_complete_parent' ? 'Refreshing register · finishing PPMs' : `Refreshing register · then Create New (PPM ${ppmSlot})`,
            { wait: true, meta: nextPpm?.instruction || handoffRecord?.assetCode || '', tick: true }
          );
          scheduleAuto(100);
        }).catch(() => scheduleAuto(200));
        return;
      }

      if (message.type === 'EE_PPM_CHILD_DONE' && isPpmRegisterParentPage()) {
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
          const afterRefreshPhase = String(message.afterRefreshPhase || currentAuto.ppmAfterRefreshPhase || 'ppm_next');
          const nextAuto = schedulePpmParentRefreshAfterClose(currentAuto, afterRefreshPhase);
          if (!nextAuto) {
            addEvent('ppm-parent-refresh-coalesced', { afterRefreshPhase, priorPhase: currentAuto.phase || '', source: 'child-done' });
            return;
          }
          state.session.auto = nextAuto;
          await persistSession();
          render();
          const handoffRecord = workflowRecord(nextAuto);
          const nextPpm = currentPpm(handoffRecord);
          showActivity?.(
            'Waiting',
            'PPM child closed',
            `Refreshing register · PPM ${(Number(nextAuto.ppmIndex) || 0) + 1}`,
            { wait: true, meta: nextPpm?.instruction || handoffRecord?.assetCode || '', tick: true }
          );
          scheduleAuto(50);
        }).catch(() => scheduleAuto(150));
      }
    });
  }

  root.runtime = root.runtime || {};
  root.runtime.messages = Object.freeze({ configure, initMessageListeners });
})();
