(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const {
    isAssetPage,
    isNewEntityPage,
    isSavedAssetPage,
    isPpmListPage,
    isPpmItemPage,
    isSavedPpmPage,
    entityIdFromUrl,
    assetEntityUrl,
    ppmListUrl,
    ppmEntityUrl,
    deriveNewEntityUrl
  } = root.core.pages;
  const { WAITING_PHASES } = root.workflow.phases;
  const { beginPostSave } = root.workflow.postSave;
  const { dispatchClick } = root.core.dom;
  const $ = () => root.runtime.b;

  function syncAutoOrchestrator() {
    try {
      chrome.runtime.sendMessage({ type: 'AUTO_ORCHESTRATOR_SYNC' }).catch(() => {});
    } catch (_) {}
  }

  function scheduleAuto(delay = 0) {
    const b = $();
    clearTimeout(b.state.autoTimer);
    const auto = b.state.session.auto || {};
    const phase = clean(auto.phase || '');
    const waitMs = Math.max(0, Number(delay) || 0);
    const watchdogMs = WAITING_PHASES.has(phase) ? Math.max(waitMs, 750) : waitMs;
    if (auto.active && b.showActivity) {
      const record = b.workflowRecord(auto);
      const ppm = b.currentPpm(record);
      const meta = record?.assetCode ? `Asset ${record.assetCode}` : '';
      const ppmNote = ppm?.ppmKey ? ` · PPM ${(Number(auto.ppmIndex) || 0) + 1}` : '';
      b.showActivity(
        WAITING_PHASES.has(phase) ? 'Waiting' : 'Next step',
        root.ui.progressToast.phaseLabel(phase),
        watchdogMs > 0 ? `Checking again in ${Math.max(1, Math.round(watchdogMs / 1000))}s` : 'Running next workflow step',
        { wait: true, type: 'info', meta: `${meta}${ppmNote}`.trim(), tick: true }
      );
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
    if (record && b.state.session.auto?.mode !== 'ppm-current-page' && !['saved', 'skipped'].includes(b.statusOf(record))) {
      await b.setStatus(record, 'failed', message, {
        cafmEntityId: b.state.session.auto?.assetEntityId || b.state.session.statuses?.[record.assetCode]?.cafmEntityId || '',
        assetActivated: Boolean(b.state.session.statuses?.[record.assetCode]?.assetActivated),
        assetStatusEvidence: b.state.session.statuses?.[record.assetCode]?.assetStatusEvidence || '',
        ppmResults: b.state.session.auto?.ppmResults || b.state.session.statuses?.[record.assetCode]?.ppmResults || []
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
    root.ui.progressToast.stopTick();
    syncAutoOrchestrator();
  }

  async function startAutomatic() {
    const b = $();
    if (!b.state.assets.length) return b.showToast('Load the CAFM Import workbook first.', 'warn');
    if (!isNewEntityPage()) return b.showToast('Open the Asset New Entity page before starting automatic import.', 'warn', 8000);
    const record = b.currentRecord();
    if (!record) return;
    const preflight = root.data.preflight.summarize(b.state);
    if (preflight.blocking.length) {
      return b.showToast(`Preflight blocked start: ${preflight.blocking.join('; ')}. Fix workbook rows first.`, 'warn', 12000);
    }
    b.showToast(`Preflight OK: ${root.data.preflight.formatSummary(preflight)}`, 'info', 7000);
    b.state.session.newEntityUrl = b.state.session.newEntityUrl || deriveNewEntityUrl();
    const maxIterations = b.state.settings.iterationEnabled
      ? Math.max(1, Math.floor(Number(b.state.settings.iterationCount) || 1))
      : 1;
    b.state.session.auto = {
      active: true, mode: 'automatic', phase: 'fill', index: b.state.session.index,
      assetCode: record.assetCode, startedAt: Date.now(), ppmIndex: 0, ppmResults: [],
      processedThisRun: 0, maxIterations
    };
    b.addEvent('run-start', { maxIterations, iterationEnabled: Boolean(b.state.settings.iterationEnabled) });
    await b.persistSession();
    b.render();
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
    const resumePhase = clean(auto.failedPhase || 'fill') || 'fill';
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
    b.showToast(`Resuming ${record.assetCode} at phase "${resumePhase.replace(/_/g, ' ')}".`, 'info', 9000);
    scheduleAuto(150);
  }

  async function pauseAutomatic() {
    const b = $();
    if (!b.state.session.auto) b.state.session.auto = {};
    b.state.session.auto.failedPhase = b.state.session.auto.phase;
    b.state.session.auto.active = false;
    b.state.session.auto.phase = 'paused';
    await b.persistSession();
    b.render();
    b.showToast('Automatic import paused.', 'info');
    root.ui.progressToast.stopTick();
    syncAutoOrchestrator();
  }

  async function runAutomatic() {
    const b = $();
    if (b.state.busy) return;
    const auto = b.state.session.auto;
    if (!auto?.active) return;
    b.state.busy = true;
    try {
      if (b.showActivity) {
        const recordPreview = b.workflowRecord(auto);
        const ppmPreview = b.currentPpm(recordPreview);
        b.showActivity(
          'Running',
          root.ui.progressToast.phaseLabel(auto.phase),
          ppmPreview?.instruction || recordPreview?.assetCode || '',
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
      if (auto.mode !== 'ppm-current-page' && b.state.assets[index]) b.state.session.index = index;
      const record = b.workflowRecord(auto);
      if (!record) throw new Error('No asset row is available for the active workflow.');

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

      if (String(auto.phase || '').startsWith('ppm_status_')) {
        if (!root.pages.ppmStatus.isPpmActivationEnabled()) {
          await b.finishPostSave(record, auto.ppmResults || []);
          return;
        }
        const target = b.ppmActivationTarget(auto);
        if (!target) { await b.finishPostSave(record, auto.ppmResults || []); return; }
        if (!isSavedPpmPage() || entityIdFromUrl() !== String(target.ppmEntityId || '')) {
          location.href = ppmEntityUrl(target.ppmEntityId);
          return;
        }
        await b.processPpmStatusPage(record);
        return;
      }

      if (String(auto.phase || '').startsWith('ppm_')) {
        if (auto.phase === 'ppm_cycle_general_wait' || auto.phase === 'ppm_cycle_complete_parent') {
          if (isSavedAssetPage()) {
            if (auto.phase === 'ppm_cycle_general_wait') {
              await root.pages.ppmRegister.processPpmCycleGeneralWaitPage(record);
            } else {
              await root.pages.ppmRegister.processPpmListPage(record);
            }
            return;
          }
          if (auto.assetEntityId) {
            location.href = assetEntityUrl(auto.assetEntityId);
            return;
          }
        }
        if (isPpmListPage()) { await root.pages.ppmRegister.processPpmListPage(record); return; }
        if (isPpmItemPage()) { await root.pages.ppmEditor.processPpmItemPage(record); return; }
        if (auto.assetEntityId) {
          location.href = ppmListUrl(auto.assetEntityId);
          return;
        }
        throw new Error(`Saved asset ID is missing before PPM creation for ${record.assetCode}.`);
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
            await b.finishPostSave(record, auto.ppmResults || []);
            return;
          }
          scheduleAuto(350);
          return;
        }
        if (!entityId) {
          await b.finishPostSave(record, auto.ppmResults || []);
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
        const saveClose = b.clickSaveAndClose?.() || { ok: false };
        b.addEvent('asset-save-and-close-click', {
          ok: saveClose.ok,
          method: saveClose.method || '',
          assetCode: record.assetCode,
          entityId
        });
        if (!saveClose.ok) throw new Error(`Save and Close was not detected on the General tab for ${record.assetCode}.`);
        b.showActivity?.('Waiting', 'Save and Close', 'Closing asset editor', { wait: true, meta: record?.assetCode || '', tick: true });
        b.state.session.auto = {
          ...auto,
          phase: 'asset_save_and_close_wait',
          saveAndCloseStartedAt: Date.now()
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
          dispatchClick(general, false);
          scheduleAuto(300);
          return;
        }
        const saveAndNew = b.clickSaveAndNew?.() || { ok: false };
        b.addEvent('asset-save-and-new-click', { ok: saveAndNew.ok, method: saveAndNew.method || '', nextAssetCode: auto.assetCode || '' });
        if (!saveAndNew.ok) {
          b.state.session.auto = { ...auto, phase: 'navigate', saveAndNewStartedAt: 0 };
          await b.persistSession();
          location.href = b.state.session.newEntityUrl || deriveNewEntityUrl();
          return;
        }
        b.state.session.auto = { ...auto, phase: 'navigate', saveAndNewStartedAt: Date.now() };
        await b.persistSession();
        scheduleAuto(300);
        return;
      }

      if (auto.phase === 'navigate') {
        if (!isNewEntityPage()) {
          if (auto.saveAndNewStartedAt && Date.now() - Number(auto.saveAndNewStartedAt) < b.state.settings.saveTimeoutMs) {
            scheduleAuto(200);
            return;
          }
          location.href = b.state.session.newEntityUrl || deriveNewEntityUrl();
          return;
        }
        b.state.session.auto = { ...auto, phase: 'fill', index: b.state.session.index, assetCode: b.currentRecord()?.assetCode || '', saveAndNewStartedAt: 0 };
        await b.persistSession();
      }

      if (!isAssetPage() || !isNewEntityPage()) {
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
          b.showToast('Automatic Asset + Activation + PPM import completed.', 'success', 10000);
          return;
        }
        b.state.session.index = next;
        b.state.session.auto = { ...auto, phase: 'fill', index: next, assetCode: b.state.assets[next].assetCode };
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
      await root.pages.assetNew.fillCurrentRecord();
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
    scheduleAuto, runAutomatic, startAutomatic, pauseAutomatic, resumeAutomatic, stopAutomaticWithError
  });
})();
