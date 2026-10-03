(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { wait, dispatchClick, waitForDom } = root.core.dom;
  const {
    entityIdFromUrl,
    isSavedAssetPage,
    isNewEntityPage,
    isAssetListPage,
    ppmListUrl,
    assetEntityUrl,
    assetListUrl,
    deriveNewEntityUrl
  } = root.core.pages;
  const $ = () => root.runtime.b;

  async function beginPostSave(record, entityId, mode = 'automatic', note = 'CAFM asset save confirmed') {
    const b = $();
    if (!record || !entityId || entityId === '-1') throw new Error('The saved CAFM asset ID could not be detected.');
    const observed = b.observedAssetCode();
    if (observed && norm(observed) !== norm(record.assetCode)) {
      throw new Error(`Saved asset page shows ${observed}, but ${record.assetCode} was expected.`);
    }
    const linked = b.linkedPpms(record);
    b.addEvent('asset-saved', { assetCode: record.assetCode, entityId, linkedPpmCount: linked.length });
    await b.setStatus(record, 'asset_saved', `${note}; activation pending${linked.length ? `; ${linked.length} linked PPM(s) pending` : ''}`, {
      cafmEntityId: entityId,
      assetActivated: false,
      assetActivatedAt: '',
      assetStatusEvidence: b.currentAssetStatusText(),
      ppmResults: []
    });
    b.state.session.auto = {
      ...(b.state.session.auto || {}),
      active: true,
      mode,
      phase: 'asset_close_child',
      index: b.state.session.index,
      assetCode: record.assetCode,
      assetEntityId: entityId,
      activationStartedAt: 0,
      activationConfirmStartedAt: 0,
      ppmIndex: 0,
      ppmResults: [],
      error: ''
    };
    b.state.session.manualAwaitSave = null;
    await b.persistSession();
    b.render();
    b.showToast(`${record.assetCode} saved. Closing editor, then changing status to Active${linked.length ? `, then adding ${linked.length} PPM(s)` : ''}.`, 'success', 8000);
    b.scheduleAuto(250);
  }

  async function finishPostSave(record, ppmResults = []) {
    const b = $();
    const auto = b.state.session.auto || {};
    const entityId = auto.assetEntityId || b.state.session.statuses?.[record.assetCode]?.cafmEntityId || '';
    const activeEvidence = b.currentAssetStatusText() || b.state.session.statuses?.[record.assetCode]?.assetStatusEvidence || 'Status: ACTIVE - Active';
    const savedPpms = ppmResults.filter((item) => item.status === 'saved').length;
    const existingPpms = ppmResults.filter((item) => item.status === 'existing').length;
    const activePpms = ppmResults.filter((item) => item.active).length;
    const ppmNote = ppmResults.length ? `; PPMs: ${savedPpms} created${existingPpms ? `, ${existingPpms} already existed` : ''}${activePpms ? `, ${activePpms} ACTIVE` : ''}` : '; no enabled linked PPM rows';

    if (auto.mode === 'ppm-current-page') {
      const previous = b.state.session.statuses?.[record.assetCode] || {};
      b.state.session.statuses = b.state.session.statuses || {};
      b.state.session.statuses[record.assetCode] = {
        ...previous,
        ppmResults,
        ppmOnlyCompletedAt: new Date().toISOString(),
        note: `PPM-only current asset workflow complete${ppmNote}`,
        updatedAt: new Date().toISOString()
      };
      b.state.session.auto = {
        active: false,
        mode: 'ppm-current-page',
        phase: 'complete',
        completedAt: Date.now(),
        assetCode: record.assetCode,
        assetEntityId: entityId,
        ppmResults
      };
      await b.persistSession();
      b.render();
      b.showToast(`${record.assetCode}: PPM workflow complete${ppmNote}.`, 'success', 10000);
      return;
    }

    await b.setStatus(record, 'saved', `Asset saved and ACTIVE${ppmNote}`, {
      cafmEntityId: entityId,
      assetActivated: true,
      assetActivatedAt: b.state.session.statuses?.[record.assetCode]?.assetActivatedAt || new Date().toISOString(),
      assetStatusEvidence: activeEvidence,
      ppmResults
    });

    const completedIterations = Number(auto.processedThisRun || 0) + 1;
    b.addEvent('asset-cycle-complete', {
      assetCode: record.assetCode,
      completedIterations,
      maxIterations: Number(auto.maxIterations || 1),
      ppmCount: ppmResults.length,
      activePpmCount: activePpms
    });

    if (b.state.settings.autoDownloadTimeline) {
      try {
        const fileName = root.data.workbook.downloadAssetTimeline(record, { auto: true });
        b.showToast(`Timeline log downloaded: ${fileName}`, 'info', 6000);
      } catch (_) {}
    }

    const next = b.nextPendingIndex(b.state.session.index + 1);
    if (auto.mode === 'manual-post-save') {
      b.state.session.auto = { active: false, mode: auto.mode, phase: 'complete', completedAt: Date.now(), assetEntityId: entityId };
      if (next >= 0) b.state.session.index = next;
      b.state.session.currentLookupEvidence = [];
      await b.persistSession();
      b.render();
      if (next >= 0 && b.state.settings.autoContinueNext !== false && b.state.session.newEntityUrl) {
        b.showToast(`${record.assetCode} is ACTIVE and PPM setup is complete. Opening the next asset.`, 'success', 8000);
        await wait(0);
        location.href = b.state.session.newEntityUrl;
      } else {
        b.showToast(`${record.assetCode} is ACTIVE and PPM setup is complete.`, 'success', 8000);
      }
      return;
    }

    const maxIterations = Math.max(1, Number(auto.maxIterations || 1));
    if (completedIterations >= maxIterations) {
      await beginRunCompleteFinalize(record, {
        ...auto,
        processedThisRun: completedIterations,
        maxIterations,
        assetEntityId: entityId,
        ppmResults
      }, ppmResults, 'iteration');
      return;
    }

    if (next < 0) {
      await beginRunCompleteFinalize(record, {
        ...auto,
        processedThisRun: completedIterations,
        maxIterations,
        assetEntityId: entityId,
        ppmResults
      }, ppmResults, 'workbook');
      return;
    }

    if (b.state.settings.autoContinueNext === false) {
      b.state.session.auto = { active: false, mode: auto.mode || 'automatic', phase: 'complete', completedAt: Date.now(), processedThisRun: completedIterations };
      await b.persistSession();
      b.render();
      b.showToast(`${record.assetCode} complete. Auto-continue is off — reload the extension if needed, then start the next row manually.`, 'success', 12000);
      return;
    }

    const previousEntityId = entityId;
    const useSaveAndNew = b.state.settings.useSaveAndNew !== false;
    b.state.session.index = next;
    b.state.session.currentLookupEvidence = [];
    b.state.session.auto = {
      active: true,
      mode: auto.mode || 'automatic',
      phase: useSaveAndNew ? 'asset_save_and_new' : 'navigate',
      index: next,
      assetCode: b.state.assets[next].assetCode,
      previousAssetCode: record.assetCode,
      previousAssetEntityId: previousEntityId,
      saveAndNewStartedAt: 0,
      startedAt: auto.startedAt || Date.now(),
      processedThisRun: completedIterations,
      maxIterations: Math.max(1, Number(auto.maxIterations || 1)),
      ppmIndex: 0,
      ppmResults: []
    };
    await b.persistSession();
    b.render();
    const warningCount = (b.state.session.statuses?.[record.assetCode]?.validationWarnings || []).length;
    const ppmSummary = activePpms ? `${savedPpms} PPM saved, ${activePpms} ACTIVE` : `${savedPpms} PPM saved`;
    const nextCode = b.state.assets[next]?.assetCode || '';
    b.showToast(`${record.assetCode} complete: Asset saved, ${ppmSummary}${warningCount ? `, ${warningCount} warning(s)` : ''}. Next: ${nextCode}.`, warningCount ? 'warn' : 'success', 14000);
    b.addEvent('asset-cycle-snackbar', { assetCode: record.assetCode, savedPpms, activePpms, warningCount, nextAssetCode: nextCode });

    if (useSaveAndNew && previousEntityId) {
      if (!isSavedAssetPage() || entityIdFromUrl() !== String(previousEntityId)) {
        location.href = assetEntityUrl(previousEntityId);
      } else {
        b.scheduleAuto(100);
      }
      return;
    }
    location.href = b.state.session.newEntityUrl || deriveNewEntityUrl();
  }

  async function beginRunCompleteFinalize(record, auto, ppmResults = [], reason = 'iteration') {
    const b = $();
    const entityId = String(auto.assetEntityId || b.state.session.statuses?.[record.assetCode]?.cafmEntityId || '').trim();
    b.addEvent('run-complete-finalize-start', {
      reason,
      assetCode: record?.assetCode || '',
      processedThisRun: Number(auto.processedThisRun || 0),
      maxIterations: Number(auto.maxIterations || 1)
    });
    b.state.session.auto = {
      ...auto,
      active: true,
      mode: auto.mode || 'automatic',
      phase: 'run_complete_finalize',
      assetEntityId: entityId,
      ppmResults,
      runCompleteReason: reason,
      runCompleteGeneralStartedAt: 0,
      runCompleteGeneralReadyAt: 0,
      runCompleteSaveClickedAt: 0
    };
    await b.persistSession();
    b.render();
    if (entityId && (!isSavedAssetPage() || entityIdFromUrl() !== entityId)) {
      location.href = assetEntityUrl(entityId);
      return;
    }
    b.scheduleAuto(120);
  }

  async function finishRunCompleteFinalize(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    const count = Number(auto.processedThisRun || 1);
    const max = Math.max(1, Number(auto.maxIterations || count));
    const reason = String(auto.runCompleteReason || 'iteration');
    b.state.settings.collapsed = false;
    b.state.settings.panelView = 'main';
    b.state.session.auto = {
      active: false,
      mode: auto.mode || 'automatic',
      phase: 'complete',
      completedAt: Date.now(),
      processedThisRun: count,
      maxIterations: max,
      ppmResults: auto.ppmResults || [],
      runCompleteReason: reason
    };
    b.state.session.currentLookupEvidence = [];
    await b.persistSession();
    b.render();
    const message = reason === 'workbook'
      ? `All workbook assets complete (${count} cycle(s)). Last asset saved on General. Opening asset list.`
      : `Automatic iteration complete: ${count} of ${max} asset cycle(s). Last asset saved on General. Opening asset list.`;
    b.showToast(message, 'success', 18000);
    b.addEvent('run-complete-finalize-done', { reason, processedThisRun: count, maxIterations: max, assetCode: record?.assetCode || '' });
    if (!isAssetListPage()) {
      location.href = assetListUrl();
    }
  }

  async function processRunCompleteFinalize(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    const entityId = String(auto.assetEntityId || '').trim();
    if (!isSavedAssetPage() || (entityId && entityIdFromUrl() !== entityId)) {
      if (entityId) {
        location.href = assetEntityUrl(entityId);
        return;
      }
      await finishRunCompleteFinalize(record);
      return;
    }
    const general = root.core.toolbar.findAssetGeneralNavLink();
    const onGeneral = Boolean(general?.classList.contains('fsiNavSelectedItem'));
    if (!onGeneral) {
      if (!auto.runCompleteGeneralStartedAt) {
        b.state.session.auto = { ...auto, runCompleteGeneralStartedAt: Date.now() };
        await b.persistSession();
      }
      if (general) dispatchClick(general, false);
      else {
        await finishRunCompleteFinalize(record);
        return;
      }
      if (Date.now() - Number(auto.runCompleteGeneralStartedAt || Date.now()) > b.state.settings.lookupTimeoutMs) {
        b.addEvent('run-complete-general-timeout', { assetCode: record?.assetCode || '' });
      } else {
        b.scheduleAuto(350);
        return;
      }
    }
    if (!auto.runCompleteGeneralReadyAt) {
      b.state.session.auto = { ...auto, runCompleteGeneralReadyAt: Date.now() };
      await b.persistSession();
      b.scheduleAuto(280);
      return;
    }
    if (!auto.runCompleteSaveClickedAt) {
      const save = b.findSaveButton();
      if (save) {
        dispatchClick(save, false);
        b.addEvent('run-complete-save-click', { assetCode: record?.assetCode || '' });
        b.state.session.auto = { ...auto, runCompleteSaveClickedAt: Date.now() };
        await b.persistSession();
        b.scheduleAuto(650);
        return;
      }
      if (Date.now() - Number(auto.runCompleteGeneralReadyAt || Date.now()) > b.state.settings.lookupTimeoutMs) {
        b.addEvent('run-complete-save-missing', { assetCode: record?.assetCode || '' });
        await finishRunCompleteFinalize(record);
        return;
      }
      b.scheduleAuto(300);
      return;
    }
    await finishRunCompleteFinalize(record);
  }

  async function afterActivation(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    const entityId = auto.assetEntityId || entityIdFromUrl();
    const statusText = b.currentAssetStatusText() || 'Status: ACTIVE - Active';
    await b.setStatus(record, 'asset_saved', 'Asset saved and status changed to ACTIVE; PPM processing pending', {
      cafmEntityId: entityId,
      assetActivated: true,
      assetActivatedAt: new Date().toISOString(),
      assetStatusEvidence: statusText,
      ppmResults: auto.ppmResults || []
    });
    const linked = b.linkedPpms(record);
    if (!linked.length) {
      await finishPostSave(record, auto.ppmResults || []);
      return;
    }
    b.state.session.auto = {
      ...auto,
      active: true,
      phase: 'ppm_open_list',
      assetEntityId: entityId,
      ppmIndex: 0,
      ppmResults: auto.ppmResults || [],
      ppmGridRefreshedForIndex: -1
    };
    await b.persistSession();
    b.render();
    b.showToast(`${record.assetCode} is ACTIVE. Opening PPM from the asset's left-hand PPM menu for ${linked.length} linked PPM(s).`, 'success', 7000);
    await wait(0);
    const ppmNav = b.findAssetPpmNavLink();
    if (ppmNav) {
      dispatchClick(ppmNav, false);
      b.scheduleAuto(1100);
      return;
    }
    location.href = ppmListUrl(entityId);
  }

  async function clickSaveTracked(mode) {
    const b = $();
    const record = b.currentRecord();
    if (!record) throw new Error('No current record.');
    await wait(0);
    await root.pages.assetNew.verifyBeforeSave(record);
    await wait(0);
    const save = b.findSaveButton();
    if (!save) throw new Error('CAFM Save button was not detected.');

    if (mode === 'auto') {
      b.state.session.auto = {
        ...(b.state.session.auto || {}),
        active: true,
        phase: 'await_save',
        index: b.state.session.index,
        assetCode: record.assetCode,
        saveStartedAt: Date.now()
      };
    } else {
      b.state.session.manualAwaitSave = {
        index: b.state.session.index,
        assetCode: record.assetCode,
        armedAt: Date.now(),
        saveStartedAt: Date.now(),
        source: 'extension-save',
        lookupEvidence: b.state.session.currentLookupEvidence || []
      };
    }
    await b.persistSession();
    b.showToast(`Saving ${record.assetCode}...`, 'info', 5000);
    dispatchClick(save);

    try {
      const result = await waitForDom(() => {
        const error = b.validationMessage();
        if (error) return { error };
        if (isSavedAssetPage()) return { saved: true };
        return null;
      }, b.state.settings.saveTimeoutMs, `saved Asset ID for ${record.assetCode}`);
      if (result?.error) {
        const error = result.error;
        if (mode === 'auto') {
          b.state.session.auto = {
            ...(b.state.session.auto || {}),
            failedPhase: b.state.session.auto?.phase || 'await_save',
            active: false,
            phase: 'error',
            error
          };
        }
        else b.state.session.manualAwaitSave = null;
        await b.setStatus(record, 'failed', error);
        await b.persistSession();
        throw new Error(error);
      }
      if (result?.saved) return true;
    } catch (error) {
      if (/Timed out waiting/.test(clean(error?.message))) {
        throw new Error('Save was clicked, but CAFM did not confirm a saved asset before the safety timeout. The importer did not mark the row as saved.');
      }
      throw error;
    }
    return false;
  }

  async function handlePostReloadSaveState() {
    const b = $();
    if (!b.state.assets.length) return;
    const auto = b.state.session.auto;
    if (auto?.active) {
      b.scheduleAuto(150);
      return;
    }
    const manual = b.state.session.manualAwaitSave;
    if (!manual || !isSavedAssetPage()) return;
    const record = b.state.assets[Math.max(0, Number(manual.index) || 0)];
    if (!record || norm(record.assetCode) !== norm(manual.assetCode)) return;
    const age = Date.now() - Number(manual.armedAt || manual.saveStartedAt || Date.now());
    if (age > 2 * 60 * 60 * 1000) {
      b.state.session.manualAwaitSave = null;
      await b.persistSession();
      return;
    }
    const observed = b.observedAssetCode();
    if (observed && norm(observed) !== norm(record.assetCode)) return;
    b.state.session.index = Math.max(0, Number(manual.index) || 0);
    await beginPostSave(record, entityIdFromUrl(), 'manual-post-save', manual.source === 'filled-manual-save' ? 'Manual CAFM Save detected' : 'CAFM Save confirmed');
  }

  root.workflow = root.workflow || {};
  root.workflow.postSave = Object.freeze({
    beginPostSave,
    finishPostSave,
    beginRunCompleteFinalize,
    finishRunCompleteFinalize,
    processRunCompleteFinalize,
    afterActivation,
    clickSaveTracked,
    handlePostReloadSaveState
  });
})();
