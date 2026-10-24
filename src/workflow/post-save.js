(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { wait, dispatchClick, waitForDom } = root.core.dom;
  const { entityIdFromUrl, isSavedAssetPage, isNewEntityPage, assetEntityUrl, deriveNewEntityUrl } = root.core.pages;
  const $ = () => root.runtime.b;

  async function beginPostSave(record, entityId, mode = 'automatic', note = 'CAFM asset save confirmed') {
    const b = $();
    if (!record || !entityId || entityId === '-1') throw new Error('The saved CAFM asset ID could not be detected.');
    const observed = b.observedAssetCode();
    if (observed && norm(observed) !== norm(record.assetCode)) {
      throw new Error(`Saved asset page shows ${observed}, but ${record.assetCode} was expected.`);
    }
    b.addEvent('asset-saved', { assetCode: record.assetCode, entityId });
    await b.setStatus(record, 'asset_saved', `${note}; activation pending`, {
      cafmEntityId: entityId,
      assetActivated: false,
      assetActivatedAt: '',
      assetStatusEvidence: b.currentAssetStatusText()
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
      error: ''
    };
    b.state.session.manualAwaitSave = null;
    await b.persistSession();
    b.render();
    b.showToast(`${record.assetCode} saved. Closing editor, then changing status to Active.`, 'success', 8000);
    b.scheduleAuto(250);
  }

  async function finishPostSave(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    const entityId = auto.assetEntityId || b.state.session.statuses?.[record.assetCode]?.cafmEntityId || '';
    const activeEvidence = b.currentAssetStatusText() || b.state.session.statuses?.[record.assetCode]?.assetStatusEvidence || 'Status: ACTIVE - Active';

    await b.setStatus(record, 'saved', 'Asset saved and ACTIVE', {
      cafmEntityId: entityId,
      assetActivated: true,
      assetActivatedAt: b.state.session.statuses?.[record.assetCode]?.assetActivatedAt || new Date().toISOString(),
      assetStatusEvidence: activeEvidence
    });

    const completedIterations = Number(auto.processedThisRun || 0) + 1;
    b.addEvent('asset-cycle-complete', {
      assetCode: record.assetCode,
      completedIterations,
      maxIterations: Number(auto.maxIterations || 1)
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
        b.showToast(`${record.assetCode} is ACTIVE. Opening the next asset.`, 'success', 8000);
        await wait(0);
        location.href = b.state.session.newEntityUrl;
      } else {
        b.showToast(`${record.assetCode} is ACTIVE.`, 'success', 8000);
      }
      return;
    }

    if (next < 0) {
      b.state.session.auto = { active: false, mode: auto.mode || 'automatic', phase: 'complete', completedAt: Date.now() };
      await b.persistSession();
      b.render();
      b.showToast('Automatic asset import completed.', 'success', 10000);
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
      saveAndCloseStartedAt: 0,
      startedAt: auto.startedAt || Date.now(),
      processedThisRun: completedIterations,
      maxIterations: Math.max(1, Number(auto.maxIterations || 1))
    };
    await b.persistSession();
    b.render();
    const warningCount = (b.state.session.statuses?.[record.assetCode]?.validationWarnings || []).length;
    const nextCode = b.state.assets[next]?.assetCode || '';
    b.showToast(`${record.assetCode} complete: Asset saved and ACTIVE${warningCount ? `, ${warningCount} warning(s)` : ''}. Next: ${nextCode}.`, warningCount ? 'warn' : 'success', 14000);
    b.addEvent('asset-cycle-snackbar', { assetCode: record.assetCode, warningCount, nextAssetCode: nextCode });

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

  async function afterActivation(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    const entityId = auto.assetEntityId || entityIdFromUrl();
    const statusText = b.currentAssetStatusText() || 'Status: ACTIVE - Active';
    await b.setStatus(record, 'asset_saved', 'Asset saved and status changed to ACTIVE', {
      cafmEntityId: entityId,
      assetActivated: true,
      assetActivatedAt: new Date().toISOString(),
      assetStatusEvidence: statusText
    });
    await finishPostSave(record);
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
    afterActivation,
    clickSaveTracked,
    handlePostReloadSaveState
  });
})();
