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
  const $ = () => root.runtime.b;

  function scheduleAuto(_delay = 0) {
    const b = $();
    clearTimeout(b.state.autoTimer);
    const phase = clean(b.state.session.auto?.phase || '');
    const watchdogMs = WAITING_PHASES.has(phase) ? 750 : 0;
    b.state.autoTimer = setTimeout(() => runAutomatic().catch((error) => stopAutomaticWithError(error)), watchdogMs);
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
    b.showToast(message, 'error', 12000);
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
  }

  async function runAutomatic() {
    const b = $();
    if (b.state.busy) return;
    const auto = b.state.session.auto;
    if (!auto?.active) return;
    b.state.busy = true;
    try {
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

      if (auto.phase === 'navigate') {
        if (!isNewEntityPage()) {
          location.href = b.state.session.newEntityUrl || deriveNewEntityUrl();
          return;
        }
        b.state.session.auto = { ...auto, phase: 'fill', index: b.state.session.index, assetCode: b.currentRecord()?.assetCode || '' };
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
