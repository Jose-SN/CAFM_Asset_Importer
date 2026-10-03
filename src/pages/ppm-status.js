(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { dispatchClick } = root.core.dom;
  const { entityIdFromUrl, isSavedPpmPage, ppmEntityUrl, ppmListUrl } = root.core.pages;
  const { finishPostSave } = root.workflow.postSave;
  const $ = () => root.runtime.b;

  /** When false, PPMs are saved and the editor closes without traffic-light activation. */
  const PPM_ACTIVATION_ENABLED = false;

  function isPpmActivationEnabled() {
    return PPM_ACTIVATION_ENABLED;
  }

  function ppmActivationTarget(auto = null) {
    const b = $();
    const sessionAuto = auto || b.state.session.auto || {};
    const results = sessionAuto.ppmResults || [];
    return results.find((item) => item.activateAfterSave === true && clean(item.ppmEntityId) && !item.active) || null;
  }

  async function beginPpmActivationQueue(record, results) {
    const b = $();
    if (!PPM_ACTIVATION_ENABLED) {
      await finishPostSave(record, results || []);
      return;
    }
    const targets = (results || []).filter((item) => item.activateAfterSave === true && clean(item.ppmEntityId) && !item.active);
    if (!targets.length) {
      await finishPostSave(record, results || []);
      return;
    }
    b.state.session.auto = {
      ...(b.state.session.auto || {}),
      phase: 'ppm_status_open',
      ppmActivationIndex: 0,
      ppmResults: results,
      ppmStatusStartedAt: Date.now()
    };
    await b.persistSession();
    b.render();
    location.href = ppmEntityUrl(targets[0].ppmEntityId);
  }

  async function completePpmActivation(record, evidence = '') {
    const b = $();
    const auto = b.state.session.auto || {};
    const target = ppmActivationTarget(auto);
    if (!target) {
      await finishPostSave(record, auto.ppmResults || []);
      return;
    }
    const results = (auto.ppmResults || []).map((item) => {
      if (item.ppmKey !== target.ppmKey || String(item.ppmEntityId || '') !== String(target.ppmEntityId || '')) return item;
      return { ...item, active: true, activatedAt: new Date().toISOString(), statusEvidence: evidence || b.currentPpmStatusText() || 'ACTIVE accepted' };
    });
    const remaining = results.filter((item) => item.activateAfterSave === true && clean(item.ppmEntityId) && !item.active);
    if (!remaining.length) {
      const hasNext = auto.ppmResumeAfterActivation && Number.isFinite(Number(auto.ppmResumeIndex));
      const nextIndex = hasNext ? Number(auto.ppmResumeIndex) : null;
      const afterRefreshPhase = hasNext ? 'ppm_next' : 'ppm_cycle_complete_parent';
      b.state.session.auto = {
        ...auto,
        phase: 'ppm_child_closing',
        ppmIndex: hasNext ? nextIndex : Number(auto.ppmIndex || 0),
        ppmResults: results,
        ppmResumeAfterActivation: false,
        ppmResumeIndex: null,
        ppmNewClickedForIndex: -1,
        ppmListReadyStartedAt: 0,
        ppmAfterRefreshPhase: afterRefreshPhase,
        ppmParentRefreshStartedAt: 0
      };
      await b.persistSession();
      b.addEvent('ppm-child-complete', { ppmKey: target.ppmKey, ppmEntityId: target.ppmEntityId, hasNext, nextPpmIndex: nextIndex, afterRefreshPhase });
      const nextPhase = hasNext ? 'ppm_next' : 'ppm_cycle_complete_parent';
      b.addEvent('ppm-current-editor-close-request', {
        assetCode: record.assetCode,
        ppmKey: target.ppmKey,
        nextPhase,
        currentUrl: location.href,
        strategy: 'child-registry-close-all'
      });
      await b.persistSession();
      try {
        await b.runtimeMessage({
          type: 'PPM_PREPARE_CLOSE',
          assetCode: record.assetCode,
          assetEntityId: String(auto.assetEntityId || ''),
          nextPhase,
          afterRefreshPhase
        });
      } catch (_) {}
      chrome.runtime.sendMessage({
        type: 'PPM_CLOSE_CURRENT_EDITOR_TAB',
        assetCode: record.assetCode,
        assetEntityId: String(auto.assetEntityId || ''),
        nextPhase
      }).catch((error) => {
        b.addEvent('ppm-current-editor-close-send-error', { message: String(error?.message || error), currentUrl: location.href });
        b.persistSession().catch(() => {});
      });
      return;
    }
    b.state.session.auto = {
      ...auto,
      phase: 'ppm_status_open',
      ppmActivationIndex: 0,
      ppmResults: results,
      ppmStatusStartedAt: Date.now(),
      ppmStatusButtonStartedAt: 0
    };
    await b.persistSession();
    b.render();
    location.href = ppmEntityUrl(remaining[0].ppmEntityId);
  }

  async function continuePpmAfterSave(record, results, savedPpm) {
    const b = $();
    const auto = b.state.session.auto || {};
    const linked = b.linkedPpms(record);
    const nextIndex = (Number(auto.ppmIndex) || 0) + 1;
    const hasNext = nextIndex < linked.length;
    const afterRefreshPhase = hasNext ? 'ppm_next' : 'ppm_cycle_complete_parent';
    const nextPhase = hasNext ? 'ppm_next' : 'ppm_cycle_complete_parent';

    b.state.session.auto = {
      ...auto,
      phase: 'ppm_child_closing',
      ppmIndex: hasNext ? nextIndex : Number(auto.ppmIndex || 0),
      ppmResults: results,
      ppmResumeAfterActivation: false,
      ppmResumeIndex: null,
      ppmNewClickedForIndex: -1,
      ppmListReadyStartedAt: 0,
      ppmAfterRefreshPhase: afterRefreshPhase,
      ppmParentRefreshStartedAt: 0
    };
    await b.persistSession();
    b.addEvent('ppm-child-complete', {
      ppmKey: savedPpm?.ppmKey || '',
      ppmEntityId: savedPpm?.ppmEntityId || '',
      hasNext,
      nextPpmIndex: hasNext ? nextIndex : null,
      afterRefreshPhase,
      activationSkipped: !PPM_ACTIVATION_ENABLED
    });
    const closeButton = root.core.toolbar.findToolbarCloseButton();
    if (closeButton) root.core.dom.dispatchClick(closeButton, false);
    b.addEvent('ppm-current-editor-close-request', {
      assetCode: record.assetCode,
      ppmKey: savedPpm?.ppmKey || '',
      nextPhase,
      currentUrl: location.href,
      strategy: 'child-registry-close-all',
      closeButtonFound: Boolean(closeButton)
    });
    await b.persistSession();
    try {
      await b.runtimeMessage({
        type: 'PPM_PREPARE_CLOSE',
        assetCode: record.assetCode,
        assetEntityId: String(auto.assetEntityId || ''),
        nextPhase,
        afterRefreshPhase
      });
    } catch (_) {}
    chrome.runtime.sendMessage({
      type: 'PPM_CLOSE_CURRENT_EDITOR_TAB',
      assetCode: record.assetCode,
      assetEntityId: String(auto.assetEntityId || ''),
      nextPhase
    }).catch((error) => {
      b.addEvent('ppm-current-editor-close-send-error', { message: String(error?.message || error), currentUrl: location.href });
      b.persistSession().catch(() => {});
    });
  }

  async function processPpmStatusPage(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    const target = ppmActivationTarget(auto);
    if (!target) {
      await finishPostSave(record, auto.ppmResults || []);
      return;
    }
    const entityId = clean(target.ppmEntityId);
    if (!entityId) throw new Error(`PPM entity ID is unavailable while activating ${target.instruction}.`);
    if (!isSavedPpmPage() || entityIdFromUrl() !== String(entityId)) {
      location.href = ppmEntityUrl(entityId);
      return;
    }
    if (b.ppmIsActive()) {
      await completePpmActivation(record, b.currentPpmStatusText());
      return;
    }

    if (auto.phase === 'ppm_status_open') {
      const button = b.findChangePpmStatusButton();
      if (!button) {
        const started = Number(auto.ppmStatusButtonStartedAt || Date.now());
        if (!auto.ppmStatusButtonStartedAt) {
          b.state.session.auto = { ...auto, ppmStatusButtonStartedAt: started };
          await b.persistSession();
        }
        if (Date.now() - started > b.state.settings.lookupTimeoutMs) {
          b.state.session.auto = { ...b.state.session.auto, phase: 'ppm_status_wait_user', ppmStatusManualStartedAt: Date.now() };
          await b.persistSession();
          b.render();
          b.showToast(`Click the traffic-light status icon ONCE for ${target.instruction}. Active + OK will be completed automatically.`, 'warn', 16000);
          b.scheduleAuto(700);
          return;
        }
        b.scheduleAuto(450);
        return;
      }
      b.state.session.auto = { ...auto, phase: 'ppm_status_select', ppmStatusStartedAt: Date.now(), ppmStatusButtonStartedAt: 0 };
      await b.persistSession();
      b.dispatchLegacySingleClick(button, `ppm-status:${target.ppmEntityId || target.ppmKey}`, 15000);
      b.scheduleAuto(650);
      return;
    }

    if (auto.phase === 'ppm_status_wait_user') {
      if (b.ppmIsActive()) { await completePpmActivation(record, b.currentPpmStatusText()); return; }
      const dialog = b.findChangePpmStatusDialog();
      if (dialog) {
        b.state.session.auto = { ...auto, phase: 'ppm_status_select', ppmStatusStartedAt: Date.now(), ppmStatusButtonStartedAt: 0 };
        await b.persistSession();
        b.scheduleAuto(80);
        return;
      }
      b.scheduleAuto(700);
      return;
    }

    if (auto.phase === 'ppm_status_select') {
      const dialog = b.findChangePpmStatusDialog();
      if (!dialog) {
        if (Date.now() - Number(auto.ppmStatusStartedAt || Date.now()) > b.state.settings.lookupTimeoutMs) throw new Error(`Change PPM Status window did not open for ${target.instruction}.`);
        b.scheduleAuto(500);
        return;
      }
      const found = b.nearestControl(['PPM Status', 'Status'], dialog) || b.nearestControl(['Status'], dialog);
      if (!found?.control) throw new Error('PPM Status field was not detected in the Change Status window.');
      await b.selectActiveFromStatusDropdown(found.control, dialog, 'PPM Status');
      b.state.session.auto = { ...b.state.session.auto, phase: 'ppm_status_confirm' };
      await b.persistSession();
      b.scheduleAuto(250);
      return;
    }

    if (auto.phase === 'ppm_status_confirm') {
      const dialog = b.findChangePpmStatusDialog();
      if (!dialog) {
        if (b.ppmIsActive()) { await completePpmActivation(record, b.currentPpmStatusText()); return; }
        throw new Error('Change PPM Status window closed before OK was pressed.');
      }
      const ok = b.findConfirmButton(dialog);
      if (!ok) throw new Error('OK button was not detected in the Change PPM Status window.');
      b.state.session.auto = { ...auto, phase: 'ppm_status_wait', ppmStatusConfirmStartedAt: Date.now() };
      await b.persistSession();
      dispatchClick(ok, false);
      b.scheduleAuto(850);
      return;
    }

    if (auto.phase === 'ppm_status_wait') {
      if (b.ppmIsActive()) {
        await completePpmActivation(record, b.currentPpmStatusText());
        return;
      }
      const validation = b.validationMessage();
      if (validation) throw new Error(`CAFM did not activate PPM ${target.instruction}: ${validation}`);
      const elapsed = Date.now() - Number(auto.ppmStatusConfirmStartedAt || Date.now());
      const dialog = b.findChangePpmStatusDialog();
      if (!dialog && elapsed >= 900) {
        await completePpmActivation(record, 'ACTIVE accepted; status dialog closed');
        return;
      }
      if (elapsed > b.state.settings.saveTimeoutMs) throw new Error(`CAFM did not accept ACTIVE status for PPM ${target.instruction}.`);
      b.scheduleAuto(650);
      return;
    }

    b.state.session.auto = { ...auto, phase: 'ppm_status_open' };
    await b.persistSession();
    b.scheduleAuto(100);
  }

  async function recordPpmResult(record, ppm, status, note, ppmEntityId = '') {
    const b = $();
    const auto = b.state.session.auto || {};
    b.addEvent('ppm-save-result', { ppmKey: ppm.ppmKey, instruction: ppm.instruction, status, ppmEntityId });
    const results = [...(auto.ppmResults || []), {
      ppmKey: ppm.ppmKey,
      instruction: ppm.instruction,
      status,
      note,
      ppmEntityId,
      activateAfterSave: PPM_ACTIVATION_ENABLED && status === 'saved',
      active: false,
      savedAt: new Date().toISOString()
    }];
    const linked = b.linkedPpms(record);
    const nextIndex = (Number(auto.ppmIndex) || 0) + 1;
    const savedEntry = results[results.length - 1];

    if (status === 'saved' && clean(ppmEntityId)) {
      if (PPM_ACTIVATION_ENABLED) {
        b.state.session.auto = {
          ...auto,
          ppmResults: results,
          ppmResumeAfterActivation: nextIndex < linked.length,
          ppmResumeIndex: nextIndex < linked.length ? nextIndex : null
        };
        await b.persistSession();
        await beginPpmActivationQueue(record, results);
        return;
      }
      b.state.session.auto = { ...auto, ppmResults: results };
      await b.persistSession();
      await continuePpmAfterSave(record, results, savedEntry);
      return;
    }

    if (nextIndex >= linked.length) {
      b.state.session.auto = { ...auto, ppmResults: results, ppmResumeAfterActivation: false, ppmResumeIndex: null };
      await b.persistSession();
      await finishPostSave(record, results);
      return;
    }

    b.state.session.auto = {
      ...auto,
      phase: 'ppm_next',
      ppmIndex: nextIndex,
      ppmResults: results,
      ppmNewClickedForIndex: -1,
      ppmListReadyStartedAt: 0
    };
    await b.persistSession();
    b.render();
    location.href = ppmListUrl(auto.assetEntityId);
  }

  root.pages = root.pages || {};
  root.pages.ppmStatus = Object.freeze({
    isPpmActivationEnabled,
    ppmActivationTarget,
    processPpmStatusPage,
    recordPpmResult,
    continuePpmAfterSave
  });
})();
