(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const {
    isAssetPage,
    isNewEntityPage,
    isAssetListPage,
    isSavedAssetPage,
    isPpmListPage,
    isPpmRegisterParentPage,
    isPpmNewEntityPage,
    isPpmItemPage,
    entityIdFromUrl,
    assetEntityUrl,
    deriveNewEntityUrl
  } = root.core.pages;
  const { WAITING_PHASES } = root.workflow.phases;
  const { beginPostSave } = root.workflow.postSave;
  const { dispatchClick } = root.core.dom;
  const $ = () => root.runtime.b;

  const PPM_PHASE_STALL_MS = 15000;
  const PPM_STALL_PHASES = new Set([
    'search',
    'wait_asset',
    'wait_ppm',
    'wait_ppm_new',
    'ppm_fill',
    'ppm_saving',
    'ppm_await_save'
  ]);
  const PPM_CLOSE_BUTTON = 'a[title="Click to close the form without saving changes"][onclick*="Toolbar.Close"], a[onclick*="Toolbar.Close()"]';

  function syncAutoOrchestrator() {
    const active = Boolean($().state.session.auto?.active);
    try {
      chrome.runtime.sendMessage({ type: active ? 'AUTO_ORCHESTRATOR_SYNC' : 'AUTO_ORCHESTRATOR_STOP' }).catch(() => {});
    } catch (_) {}
  }

  function ppmPhaseStalled(auto) {
    const phase = clean(auto?.phase || '');
    if (auto?.mode !== 'ppm' || !PPM_STALL_PHASES.has(phase)) return false;
    const anchor = Number(auto.phaseProgressAt) || Number(auto.phaseEnteredAt) || Number(auto.startedAt) || 0;
    if (!anchor) return false;
    return Date.now() - anchor >= PPM_PHASE_STALL_MS;
  }

  async function syncPpmPhaseClock(b, auto) {
    if (auto?.mode !== 'ppm') return auto;
    const phase = clean(auto.phase || '');
    if (clean(auto.lastPhaseClock) === phase) return auto;
    const now = Date.now();
    b.state.session.auto = {
      ...auto,
      lastPhaseClock: phase,
      phaseEnteredAt: now,
      phaseProgressAt: now
    };
    await b.persistSession();
    return b.state.session.auto;
  }

  async function touchPpmPhaseProgress() {
    const b = $();
    const auto = b.state.session.auto;
    if (!auto?.active || auto.mode !== 'ppm') return;
    b.state.session.auto = { ...auto, phaseProgressAt: Date.now() };
    await b.persistSession();
  }

  function tryClosePpmOrAssetEditor() {
    const button = document.querySelector(PPM_CLOSE_BUTTON);
    if (button) {
      dispatchClick(button, false, 'Close');
      return 'close-button';
    }
    try {
      if (typeof Toolbar !== 'undefined' && typeof Toolbar.Close === 'function') {
        Toolbar.Close();
        return 'Toolbar.Close';
      }
    } catch (_) {}
    return '';
  }

  async function skipStalledPpmAsset(record, auto) {
    const b = $();
    const phase = clean(auto?.phase || '');
    const anchor = Number(auto.phaseProgressAt) || Number(auto.phaseEnteredAt) || 0;
    const stalledSec = anchor ? Math.max(15, Math.round((Date.now() - anchor) / 1000)) : 15;
    const note = `PPM not saved: no progress for ${stalledSec}s (${phase.replace(/_/g, ' ')})`;
    b.addEvent('ppm-phase-timeout', {
      assetCode: record?.assetCode || '',
      phase,
      stalledSec,
      note
    });
    root.ui.workflowSteps?.show(b, 'Timed out', 'PPM not saved', 'Moving to next asset on register', {
      meta: record?.assetCode || '',
      wait: false,
      duration: 8000,
      type: 'warn'
    });
    b.showToast(`${record?.assetCode || 'Asset'}: ${note}`, 'warn', 10000);
    b.state.session.auto = {
      ...(b.state.session.auto || auto),
      ppmListRunning: false,
      phase: 'search',
      ppmRegisterHandoff: 'failed',
      ppmRegisterHandoffNote: note
    };
    await b.persistSession();
    const closeMethod = tryClosePpmOrAssetEditor();
    try {
      await chrome.runtime.sendMessage({
        type: 'ASSET_CLOSE_EDITOR_TAB',
        assetCode: record?.assetCode || '',
        assetEntityId: String(auto.assetEntityId || '')
      });
    } catch (_) {}
    b.addEvent('ppm-phase-timeout-close', { assetCode: record?.assetCode || '', method: closeMethod });
    if (isAssetListPage() && root.pages.assetSearch?.finishRow) {
      await root.pages.assetSearch.finishRow(record, 'failed', note, { schedule: true });
      return;
    }
    scheduleAuto(600);
  }

  function ppmWorkflowCanActHere(auto) {
    const phase = clean(auto?.phase || '');
    if (phase === 'search') return isAssetListPage();
    if (phase === 'wait_asset') {
      return isSavedAssetPage() || isPpmListPage() || Boolean(document.querySelector('[id*="fsiGridPPMs"]'));
    }
    if (phase === 'wait_ppm') {
      return isPpmListPage() || Boolean(document.querySelector('[id*="fsiGridPPMs"]'));
    }
    if (phase === 'wait_ppm_new' || phase === 'ppm_fill' || phase === 'ppm_saving') {
      return isPpmNewEntityPage() || isPpmItemPage();
    }
    if (phase === 'ppm_await_save') {
      if (clean(auto?.ppmAwaitSaveKind) === 'save_and_close') {
        return isPpmListPage() || Boolean(document.querySelector('[id*="fsiGridPPMs"]')) || isPpmItemPage();
      }
      return isPpmNewEntityPage() || isPpmItemPage();
    }
    return false;
  }

  async function abortPpmStallIfNeeded(auto) {
    if (!ppmPhaseStalled(auto)) return false;
    const b = $();
    const phase = clean(auto?.phase || '');

    if (
      isAssetListPage()
      && ['wait_asset', 'wait_ppm', 'wait_ppm_new', 'ppm_fill', 'ppm_saving', 'ppm_await_save'].includes(phase)
    ) {
      await touchPpmPhaseProgress();
      return false;
    }

    if (!ppmWorkflowCanActHere(auto)) {
      await touchPpmPhaseProgress();
      return false;
    }

    const record = await resolveWorkflowRecord(auto);
    if (!record) return false;
    await skipStalledPpmAsset(record, auto);
    return true;
  }

  function cancelAutoWorkflowTimers() {
    const b = $();
    clearTimeout(b.state.autoTimer);
    b.state.autoTimer = null;
    clearTimeout(b.state.lookupTimer);
    b.state.lookupTimer = null;
    root.ui.progressToast.stopTick();
  }

  function scheduleAuto(delay = 0) {
    const b = $();
    clearTimeout(b.state.autoTimer);
    b.state.autoTimer = null;
    const auto = b.state.session.auto || {};
    if (!auto.active) return;
    const phase = clean(auto.phase || '');
    if (phase === 'ppm_ready' || phase === 'ppm_fill' || phase === 'ppm_filled') return;
    if (phase === 'wait_ppm_new' && !isPpmNewEntityPage()) {
      const onPpmRegister = isPpmRegisterParentPage() || isPpmListPage() || Boolean(document.querySelector('[id*="fsiGridPPMs"]'));
      if (!onPpmRegister && !isPpmItemPage()) return;
    }
    if (phase === 'ppm_saving' && !isPpmItemPage()) return;
    if (phase === 'ppm_await_save') {
      const kind = clean(auto.ppmAwaitSaveKind);
      if (kind === 'save_and_close') {
        if (!isPpmListPage() && !document.querySelector('[id*="fsiGridPPMs"]') && !isPpmItemPage()) return;
      } else if (!isPpmItemPage()) return;
    }
    const waitMs = Math.max(0, Number(delay) || 0);
    const watchdogMs = WAITING_PHASES.has(phase) ? Math.max(waitMs, 750) : waitMs;
    if (auto.active) {
      const record = b.workflowRecord(auto);
      const waiting = WAITING_PHASES.has(phase);
      const waitSec = watchdogMs > 0 ? Math.max(1, Math.round(watchdogMs / 1000)) : 0;
      if (b.showWorkflowStatus) {
        b.showWorkflowStatus({
          auto,
          record,
          statuses: b.state.session.statuses || {},
          statusOf: (row) => b.statusOf(row)
        }, {
          verb: waiting ? 'Waiting' : 'Running',
          wait: true,
          waitSec,
          tick: true,
          type: 'info'
        });
      } else if (b.showActivity) {
        const meta = record?.assetCode ? `Asset ${record.assetCode}` : '';
        b.showActivity(
          waiting ? 'Waiting' : 'Next step',
          root.ui.progressToast.phaseLabel(phase),
          waitSec > 0 ? `Checking again in ${waitSec}s` : 'Running next workflow step',
          { wait: true, type: 'info', meta, tick: true }
        );
      }
      b.render?.();
    }
    b.state.autoTimer = setTimeout(() => runAutomatic().catch((error) => stopAutomaticWithError(error)), watchdogMs);
    if (auto.active) syncAutoOrchestrator();
  }

  async function stopAutomaticWithError(error) {
    const b = $();
    const message = clean(error?.message || error || 'Automatic import stopped.');
    b.addEvent('error', { message, stack: clean(error?.stack || '') });
    if (b.state.session.auto) {
      b.state.session.auto.failedPhase = b.state.session.auto.phase;
      b.state.session.auto.active = false;
      b.state.session.auto.phase = 'error';
      b.state.session.auto.error = message;
    }
    const record = b.workflowRecord(b.state.session.auto);
    if (record && !['saved', 'skipped'].includes(b.statusOf(record))) {
      await b.setStatus(record, 'failed', message, {
        cafmEntityId: b.state.session.auto?.assetEntityId || b.state.session.statuses?.[record.assetCode]?.cafmEntityId || '',
        assetActivated: Boolean(b.state.session.statuses?.[record.assetCode]?.assetActivated),
        assetStatusEvidence: b.state.session.statuses?.[record.assetCode]?.assetStatusEvidence || ''
      });
    }
    await b.persistSession();
    b.render();
    b.showActivity?.(
      'Failed',
      root.ui.progressToast.phaseLabel(b.state.session.auto?.failedPhase || 'workflow'),
      message,
      { wait: false, type: 'error', meta: record?.assetCode || '', duration: 0, tick: false }
    );
    b.showToast(message, 'error', 12000);
    cancelAutoWorkflowTimers();
    syncAutoOrchestrator();
  }

  async function startAutomatic() {
    const b = $();
    if (!b.state.ppms?.length) {
      return b.showToast("Load a workbook with PPM rows on the 'CAFM PPM Import' sheet first.", 'warn', 10000);
    }
    if (!b.state.assets.length) {
      return b.showToast('No Asset Codes were found on CAFM PPM Import (check Import? = YES).', 'warn', 10000);
    }
    if (!isAssetListPage()) {
      return b.showToast('Open the Asset register (ViewFASSETItems.aspx), then start automatic.', 'warn', 8000);
    }
    const blank = b.state.assets.filter((row) => !clean(row.assetCode));
    if (blank.length) {
      return b.showToast(`${blank.length} workbook row(s) have no Asset Code.`, 'warn', 12000);
    }
    if (!root.pages.assetSearch?.nextSearchIndex) {
      return b.showToast('Extension modules did not load (asset search). Reload at chrome://extensions.', 'error', 12000);
    }
    const startIndex = root.pages.assetSearch.nextSearchIndex(0);
    if (startIndex < 0) return b.showToast('Every workbook Asset Code has already been searched.', 'info', 8000);
    const record = b.state.assets[startIndex];
    b.state.session.index = startIndex;
    b.state.session.auto = {
      active: true,
      mode: 'ppm',
      phase: 'search',
      index: startIndex,
      assetCode: record.assetCode,
      startedAt: Date.now(),
      phaseEnteredAt: Date.now(),
      phaseProgressAt: Date.now(),
      lastPhaseClock: 'search',
      processedThisRun: 0,
      maxIterations: b.state.assets.length
    };
    b.addEvent('run-start', { mode: 'ppm', assetCode: record.assetCode, rows: b.state.assets.length });
    await b.persistSession();
    b.render();
    b.showToast(`PPM import: searching ${b.state.assets.length} asset code(s) from CAFM PPM Import.`, 'info', 7000);
    scheduleAuto(100);
    syncAutoOrchestrator();
  }

  async function resumeAutomatic() {
    const b = $();
    const auto = b.state.session.auto;
    if (!auto || !['error', 'paused'].includes(auto.phase)) {
      return b.showToast('No stopped or paused automatic run to resume.', 'warn', 7000);
    }
    const record = b.currentRecord();
    if (!record) return b.showToast('Use Previous/Next to select the workbook row to resume, then click Resume.', 'warn', 9000);
    let resumePhase = clean(auto.failedPhase || (auto.mode === 'ppm' ? 'search' : 'fill')) || 'fill';
    if (
      resumePhase === 'fill'
      && Number(auto.fillPlanStep) > 0
      && clean(auto.fillPlanAssetCode) === clean(record.assetCode)
    ) {
      resumePhase = 'filling';
    }
    b.state.session.index = Math.max(0, Number(b.state.session.index) || 0);
    b.state.session.auto = {
      ...auto,
      active: true,
      phase: resumePhase,
      error: '',
      index: b.state.session.index,
      assetCode: record.assetCode
    };
    b.addEvent('run-resume', { resumePhase, assetCode: record.assetCode, index: b.state.session.index });
    await b.persistSession();
    b.render();
    const fillStep = Number(auto.fillPlanStep) || 0;
    const fillHint = resumePhase === 'filling' && fillStep > 0 ? ` (fill step ${fillStep})` : '';
    b.showToast(`Resuming ${record.assetCode} at phase "${resumePhase.replace(/_/g, ' ')}"${fillHint}.`, 'info', 9000);
    scheduleAuto(150);
  }

  async function pauseAutomatic() {
    const b = $();
    cancelAutoWorkflowTimers();
    if (!b.state.session.auto) b.state.session.auto = {};
    b.state.session.auto.failedPhase = b.state.session.auto.phase;
    b.state.session.auto.active = false;
    b.state.session.auto.phase = 'paused';
    b.addEvent('run-pause', {
      failedPhase: b.state.session.auto.failedPhase || '',
      fillPlanStep: Number(b.state.session.auto.fillPlanStep) || 0,
      fillPlanAssetCode: clean(b.state.session.auto.fillPlanAssetCode || '')
    });
    await b.persistSession();
    b.render();
    b.showToast('Automatic import paused.', 'info');
    syncAutoOrchestrator();
  }

  async function resolveWorkflowRecord(auto) {
    const b = $();
    if (typeof b.ensureWorkbookLoaded === 'function') {
      await b.ensureWorkbookLoaded();
    }
    let record = b.workflowRecord(auto);
    const code = clean(auto?.assetCode);
    if (!record && code && (b.state.assets || []).length) {
      const idx = b.state.assets.findIndex((row) => norm(row?.assetCode) === norm(code));
      if (idx >= 0) {
        b.state.session.index = idx;
        b.state.session.auto = { ...auto, index: idx, assetCode: b.state.assets[idx].assetCode };
        record = b.state.assets[idx];
      }
    }
    return record;
  }

  function shouldRunPpmAutomation(auto) {
    const phase = clean(auto?.phase || '');
    // Register parent: poll/wait only for search (same role as navigate + isAssetListPage on assets_working_file).
    if (isAssetListPage()) return phase === 'search';
    if (phase === 'search') return false;
    if (isPpmListPage() || document.querySelector('[id*="fsiGridPPMs"]')) return true;
    if (phase === 'wait_ppm' && isSavedAssetPage()) return true;
    if (phase === 'wait_asset' && isSavedAssetPage()) return true;
    if (isPpmNewEntityPage() || isPpmItemPage()) return true;
    return false;
  }

  async function runAutomatic() {
    const b = $();
    let auto = b.state.session.auto;
    if (!auto?.active) return;
    if (auto.mode === 'ppm') {
      if (typeof b.syncSessionFromStorage === 'function') {
        await b.syncSessionFromStorage();
      } else if (typeof b.ensureWorkbookLoaded === 'function') {
        await b.ensureWorkbookLoaded();
      }
      auto = b.state.session.auto;
    }
    if (auto.mode === 'ppm') {
      auto = await syncPpmPhaseClock(b, auto);
      if (await abortPpmStallIfNeeded(auto)) return;
    }
    if (b.state.busy) {
      if (auto.mode === 'ppm' && ppmPhaseStalled(auto)) {
        b.state.busy = false;
        if (await abortPpmStallIfNeeded(auto)) return;
      }
      scheduleAuto(400);
      return;
    }
    if (auto.mode === 'ppm' && !shouldRunPpmAutomation(auto)) return;
    const phase = clean(auto.phase || '');
    if (
      auto.mode === 'ppm'
      && isAssetListPage()
      && ['wait_asset', 'wait_ppm', 'wait_ppm_new', 'ppm_fill', 'ppm_saving', 'ppm_await_save'].includes(phase)
    ) {
      const handoff = clean(auto.ppmRegisterHandoff);
      if (handoff === 'saved' || handoff === 'failed') {
        const record = await resolveWorkflowRecord(auto);
        const note = clean(auto.ppmRegisterHandoffNote) || '';
        b.state.session.auto = {
          ...auto,
          ppmRegisterHandoff: '',
          ppmRegisterHandoffNote: ''
        };
        await b.persistSession();
        if (record && root.pages.assetSearch?.finishRow) {
          await root.pages.assetSearch.finishRow(
            record,
            handoff === 'saved' ? 'saved' : 'failed',
            note,
            { schedule: true }
          );
          return;
        }
      }
      const record = await resolveWorkflowRecord(auto);
      root.ui.workflowSteps?.showRegisterWait(b, phase, record);
      await touchPpmPhaseProgress();
      scheduleAuto(2000);
      return;
    }
    b.state.busy = true;
    try {
      const waitingPhase = WAITING_PHASES.has(phase);
      const skipGenericActivity = auto.mode === 'ppm'
        && (phase === 'wait_ppm' || phase === 'wait_ppm_new' || phase === 'ppm_fill' || phase === 'ppm_saving')
        && (isPpmListPage() || isPpmNewEntityPage() || isPpmItemPage());
      if (b.showActivity && !(b.showWorkflowStatus && waitingPhase) && !skipGenericActivity) {
        const recordPreview = await resolveWorkflowRecord(auto);
        b.showActivity(
          'Running',
          root.ui.progressToast.phaseLabel(auto.phase),
          recordPreview?.assetCode || '',
          {
            wait: false,
            type: 'info',
            meta: recordPreview?.assetCode ? `Asset ${recordPreview.assetCode}` : '',
            tick: false,
            duration: 0
          }
        );
      }
      const index = Math.max(0, Number(auto.index ?? b.state.session.index) || 0);
      if (b.state.assets[index]) b.state.session.index = index;
      let record = await resolveWorkflowRecord(auto);
      if (!record && !(b.state.assets || []).length && !(b.state.ppms || []).length) {
        b.showToast('Automatic import paused: reload your workbook on the Asset register, then Resume.', 'warn', 12000);
        b.state.session.auto = { ...auto, active: false, phase: 'paused', failedPhase: phase, error: 'Workbook not loaded in this tab.' };
        await b.persistSession();
        cancelAutoWorkflowTimers();
        return;
      }
      if (!record) throw new Error('No asset row is available for the active workflow.');

      if (auto.mode === 'ppm') {
        if (auto.phase === 'ppm_ready' || auto.phase === 'ppm_filled') return;
        if (auto.phase === 'activate_open') {
          b.state.session.auto = { ...auto, phase: 'search' };
          await b.persistSession();
          scheduleAuto(400);
          return;
        }
        if (auto.phase === 'wait_ppm_new' || auto.phase === 'ppm_fill') {
          if (isPpmNewEntityPage()) {
            await root.pages.ppmNew.processFill(record);
            return;
          }
          if (isPpmRegisterParentPage() || isPpmListPage() || document.querySelector('[id*="fsiGridPPMs"]')) {
            await root.pages.ppmList.processWaitForNewEditor(record);
            return;
          }
          scheduleAuto(500);
          return;
        }
        if (auto.phase === 'ppm_await_save') {
          await root.pages.ppmNew.processAwaitSave(record);
          return;
        }
        if (auto.phase === 'ppm_saving') {
          if (isPpmItemPage()) {
            await root.pages.ppmNew.processSave(record);
            return;
          }
          return;
        }
        if (auto.phase === 'wait_asset' || auto.phase === 'wait_ppm') {
          if (isPpmListPage() || document.querySelector('[id*="fsiGridPPMs"]')) {
            if (auto.phase !== 'wait_ppm') {
              b.state.session.auto = {
                ...auto,
                phase: 'wait_ppm',
                assetEntityId: entityIdFromUrl() || auto.assetEntityId || ''
              };
              await b.persistSession();
            }
            await root.pages.ppmList.processList(record);
            return;
          }
          if (auto.phase === 'wait_asset' && isSavedAssetPage()) {
            await root.pages.assetDetail.processOpenPpm(record);
            return;
          }
          scheduleAuto(800);
          return;
        }
        if (auto.phase !== 'search') throw new Error(`Unsupported saved-asset phase: ${auto.phase || 'none'}.`);
        if (!isAssetListPage()) return;
        if (Number(auto.processedThisRun || 0) >= b.state.assets.length) {
          b.state.session.auto = { ...auto, active: false, phase: 'complete', completedAt: Date.now() };
          await b.persistSession();
          b.render();
          return;
        }
        await root.pages.assetSearch.processSearch(record);
        return;
      }

      if (auto.phase === 'asset_close_child' || auto.phase === 'asset_close_wait') {
        if (isSavedAssetPage()) {
          await root.pages.assetSaved.processAssetCloseAfterSave(record);
          return;
        }
        if (auto.assetEntityId && isAssetPage()) {
          location.href = assetEntityUrl(auto.assetEntityId);
          return;
        }
        scheduleAuto(300);
        return;
      }

      if (String(auto.phase || '').startsWith('activate_')) {
        if (!isSavedAssetPage()) {
          location.href = assetEntityUrl(auto.assetEntityId);
          return;
        }
        await root.pages.assetSaved.processActivationPage(record);
        return;
      }

      if (auto.phase === 'await_save') {
        if (isSavedAssetPage()) {
          await beginPostSave(record, entityIdFromUrl(), auto.mode || 'automatic', 'CAFM asset save confirmed');
          return;
        }
        const validation = b.validationMessage();
        if (validation) throw new Error(validation);
        if (Date.now() - Number(auto.saveStartedAt || Date.now()) > b.state.settings.saveTimeoutMs) throw new Error('CAFM save confirmation timed out.');
        scheduleAuto(0);
        return;
      }

      if (auto.phase === 'asset_save_and_close' || auto.phase === 'asset_save_and_close_wait') {
        const entityId = String(auto.assetEntityId || auto.previousAssetEntityId || '');
        if (auto.phase === 'asset_save_and_close_wait') {
          const elapsed = Date.now() - Number(auto.saveAndCloseStartedAt || Date.now());
          const leftSavedPage = !isSavedAssetPage() || (entityId && entityIdFromUrl() !== entityId);
          if (leftSavedPage || elapsed > b.state.settings.saveTimeoutMs) {
            await b.finishPostSave(record);
            return;
          }
          scheduleAuto(350);
          return;
        }
        if (!entityId) {
          await b.finishPostSave(record);
          return;
        }
        if (!isSavedAssetPage() || entityIdFromUrl() !== entityId) {
          location.href = assetEntityUrl(entityId);
          return;
        }
        const general = root.core.toolbar.findAssetGeneralNavLink();
        if (general && !general.classList.contains('fsiNavSelectedItem')) {
          b.showActivity?.('Clicking', 'General tab', 'Before Save and Close', { wait: false, meta: record?.assetCode || '', duration: 2200, tick: false });
          dispatchClick(general, false);
          scheduleAuto(450);
          return;
        }
        const menuStarted = Number(auto.assetSaveAndCloseMenuStartedAt || Date.now());
        if (!auto.assetSaveAndCloseMenuStartedAt) {
          b.state.session.auto = { ...auto, assetSaveAndCloseMenuStartedAt: menuStarted };
          await b.persistSession();
          auto = b.state.session.auto || {};
        }
        const saveClose = b.clickSaveAndClose?.() || { ok: false };
        b.addEvent('asset-save-and-close-click', {
          ok: saveClose.ok,
          method: saveClose.method || '',
          reason: saveClose.reason || '',
          pending: Boolean(saveClose.pending),
          state: saveClose.state || {},
          assetCode: record.assetCode,
          entityId
        });
        if (!saveClose.ok) {
          if (saveClose.pending && Date.now() - menuStarted < b.state.settings.lookupTimeoutMs) {
            b.showActivity?.(
              'Waiting',
              'Save and Close menu',
              saveClose.reason === 'save-and-close-menu-link-disabled'
                ? 'Waiting for Save and Close to become enabled'
                : 'Opening Save dropdown menu',
              { wait: true, meta: record?.assetCode || '', tick: true }
            );
            scheduleAuto(350);
            return;
          }
          throw new Error(`Save and Close was not detected on the General tab for ${record.assetCode}${saveClose.reason ? ` (${saveClose.reason})` : ''}.`);
        }
        b.showActivity?.('Waiting', 'Save and Close', 'Closing asset editor', { wait: true, meta: record?.assetCode || '', tick: true });
        b.state.session.auto = {
          ...auto,
          phase: 'asset_save_and_close_wait',
          saveAndCloseStartedAt: Date.now(),
          assetSaveAndCloseMenuStartedAt: 0
        };
        await b.persistSession();
        scheduleAuto(500);
        return;
      }

      if (auto.phase === 'asset_save_and_new') {
        const prevEntityId = String(auto.previousAssetEntityId || auto.assetEntityId || '');
        if (!prevEntityId) {
          b.state.session.auto = { ...auto, phase: 'navigate' };
          await b.persistSession();
          scheduleAuto(100);
          return;
        }
        if (!isSavedAssetPage() || entityIdFromUrl() !== prevEntityId) {
          location.href = assetEntityUrl(prevEntityId);
          return;
        }
        const general = root.core.toolbar.findAssetGeneralNavLink();
        if (general && !general.classList.contains('fsiNavSelectedItem')) {
          b.showActivity?.('Clicking', 'General tab', 'Before Save and New', { wait: false, meta: record?.assetCode || '', duration: 2200, tick: false });
          dispatchClick(general, false);
          scheduleAuto(300);
          return;
        }
        let autoNow = b.state.session.auto || auto;
        const menuStarted = Number(autoNow.assetSaveAndNewMenuStartedAt || Date.now());
        if (!autoNow.assetSaveAndNewMenuStartedAt) {
          b.state.session.auto = { ...autoNow, assetSaveAndNewMenuStartedAt: menuStarted };
          await b.persistSession();
          autoNow = b.state.session.auto || autoNow;
        }
        let saveAndNew = b.clickSaveAndNew?.() || { ok: false };
        if (!saveAndNew.ok && !saveAndNew.pending) {
          saveAndNew = b.clickSaveAndNew?.() || saveAndNew;
        }
        b.addEvent('asset-save-and-new-click', {
          ok: saveAndNew.ok,
          method: saveAndNew.method || '',
          reason: saveAndNew.reason || '',
          pending: Boolean(saveAndNew.pending),
          nextAssetCode: autoNow.assetCode || ''
        });
        if (!saveAndNew.ok) {
          if (saveAndNew.pending && Date.now() - menuStarted < b.state.settings.lookupTimeoutMs) {
            b.showActivity?.(
              'Waiting',
              'Save and New menu',
              saveAndNew.reason === 'save-and-new-menu-link-disabled'
                ? 'Waiting for Save and New to become enabled'
                : 'Opening Save dropdown menu',
              { wait: true, meta: autoNow.assetCode || '', tick: true }
            );
            scheduleAuto(350);
            return;
          }
          b.state.session.auto = { ...autoNow, phase: 'navigate', saveAndNewStartedAt: 0, assetSaveAndNewMenuStartedAt: 0 };
          await b.persistSession();
          location.href = b.state.session.newEntityUrl || deriveNewEntityUrl();
          return;
        }
        b.showActivity?.('Waiting', 'Save and New', 'Opening asset list for next row', { wait: true, meta: autoNow.assetCode || '', tick: true });
        b.state.session.auto = {
          ...autoNow,
          phase: 'navigate',
          saveAndNewStartedAt: Date.now(),
          assetSaveAndNewMenuStartedAt: 0
        };
        await b.persistSession();
        scheduleAuto(400);
        return;
      }

      if (auto.phase === 'navigate') {
        if (isNewEntityPage()) {
          b.state.session.auto = {
            ...auto,
            phase: 'fill',
            index: b.state.session.index,
            assetCode: b.currentRecord()?.assetCode || auto.assetCode || '',
            saveAndNewStartedAt: 0
          };
          await b.persistSession();
        } else if (isAssetListPage()) {
          const processed = Number(auto.processedThisRun || 0);
          const maxIter = Math.max(1, Number(auto.maxIterations || 1));
          if (processed >= maxIter) {
            b.state.session.auto = {
              ...auto,
              active: false,
              phase: 'complete',
              completedAt: Date.now()
            };
            await b.persistSession();
            b.render();
            b.showToast(`Iteration limit reached: ${processed} asset cycle(s) completed.`, 'success', 10000);
            return;
          }
          const createNew = root.core.toolbar.clickAssetListCreateNew?.() || { ok: false };
          b.addEvent('asset-list-create-new-click', {
            ok: createNew.ok,
            method: createNew.method || '',
            reason: createNew.reason || '',
            nextAssetCode: auto.assetCode || ''
          });
          if (createNew.ok) {
            b.showActivity?.('Clicking', 'Create New asset', auto.assetCode || 'next row', { wait: true, meta: auto.assetCode || '', tick: true });
            b.state.session.auto = { ...auto, saveAndNewStartedAt: Date.now() };
            await b.persistSession();
            scheduleAuto(450);
            return;
          }
          if (auto.saveAndNewStartedAt && Date.now() - Number(auto.saveAndNewStartedAt) < b.state.settings.saveTimeoutMs) {
            scheduleAuto(300);
            return;
          }
          location.href = b.state.session.newEntityUrl || deriveNewEntityUrl();
          return;
        } else if (auto.saveAndNewStartedAt && Date.now() - Number(auto.saveAndNewStartedAt) < b.state.settings.saveTimeoutMs) {
          scheduleAuto(250);
          return;
        } else {
          location.href = b.state.session.newEntityUrl || deriveNewEntityUrl();
          return;
        }
      }

      if (!isAssetPage() || !isNewEntityPage()) {
        if (auto.phase === 'navigate' && isAssetListPage()) {
          scheduleAuto(200);
          return;
        }
        location.href = b.state.session.newEntityUrl || deriveNewEntityUrl();
        return;
      }

      const currentStatus = b.statusOf(record);
      if (['saved', 'skipped'].includes(currentStatus)) {
        const next = b.nextPendingIndex(b.state.session.index + 1);
        if (next < 0) {
          b.state.session.auto = { active: false, mode: auto.mode || 'automatic', phase: 'complete', completedAt: Date.now() };
          await b.persistSession();
          b.render();
          b.showToast('Automatic asset import completed.', 'success', 10000);
          return;
        }
        b.state.session.index = next;
        b.state.session.auto = {
          ...auto,
          phase: 'fill',
          index: next,
          assetCode: b.state.assets[next].assetCode,
          fillPlanStep: 0,
          fillPlanAssetCode: ''
        };
        await b.persistSession();
        b.render();
      }

      const issues = globalThis.CAFMAssetRules.validateRecord(b.currentRecord());
      if (issues.length) {
        if (b.state.settings.skipInvalidRows) {
          await b.setStatus(b.currentRecord(), 'skipped', `Invalid workbook row: ${issues.join('; ')}`);
          const next = b.nextPendingIndex(b.state.session.index + 1);
          if (next < 0) {
            b.state.session.auto = { active: false, phase: 'complete' };
            await b.persistSession();
            b.render();
            return;
          }
          b.state.session.index = next;
          b.state.session.auto = { ...b.state.session.auto, phase: 'navigate', index: next, assetCode: b.state.assets[next].assetCode };
          await b.persistSession();
          scheduleAuto(300);
          return;
        }
        throw new Error(`Workbook row ${b.currentRecord().workbookRow}: ${issues.join('; ')}`);
      }

      b.state.session.auto = { ...b.state.session.auto, active: true, mode: auto.mode || 'automatic', phase: 'filling', index: b.state.session.index, assetCode: b.currentRecord().assetCode };
      await b.persistSession();
      b.render();
      const filled = await root.pages.assetNew.fillCurrentRecord({ respectAutoPause: true });
      if (filled?.cancelled || !b.state.session.auto?.active) return;
      b.state.session.manualAwaitSave = null;
      b.state.session.auto = { ...b.state.session.auto, phase: 'saving', index: b.state.session.index, assetCode: b.currentRecord().assetCode };
      await b.persistSession();
      b.render();
      await b.clickSaveTracked('auto');
      if (isSavedAssetPage()) {
        await beginPostSave(b.currentRecord(), entityIdFromUrl(), auto.mode || 'automatic', 'CAFM asset save confirmed immediately');
      }
    } finally {
      b.state.busy = false;
    }
  }

  root.workflow = root.workflow || {};
  root.workflow.engine = Object.freeze({
    scheduleAuto,
    runAutomatic,
    startAutomatic,
    pauseAutomatic,
    resumeAutomatic,
    stopAutomaticWithError,
    touchPpmPhaseProgress
  });
})();
