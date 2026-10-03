(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { visible, dispatchClick } = root.core.dom;
  const { entityIdFromUrl, isSavedAssetPage, assetEntityUrl } = root.core.pages;
  const { afterActivation } = root.workflow.postSave;
  const $ = () => root.runtime.b;

  async function processActivationPage(record) {
    const rt = $();
    const auto = rt.state.session.auto || {};
    const entityId = auto.assetEntityId || entityIdFromUrl();
    if (!entityId || entityId === '-1') throw new Error(`Saved asset ID is unavailable while activating ${record.assetCode}.`);
    if (!isSavedAssetPage() || entityIdFromUrl() !== String(entityId)) {
      location.href = assetEntityUrl(entityId);
      return;
    }
    if (rt.assetIsActive()) {
      await afterActivation(record);
      return;
    }

    if (auto.phase === 'activate_open') {
      const popup = document.getElementById('ctl00_ctl00_assetStatusPopup_container');
      if (popup && visible(popup)) {
        rt.addEvent('asset-status-popup-open', {
          popupId: popup.id,
          clickAttempts: Number(auto.activationClickAttempts || 0),
          elapsedMs: Date.now() - Number(auto.activationButtonStartedAt || Date.now())
        });
        rt.state.session.auto = {
          ...auto,
          phase: 'activate_select',
          activationStartedAt: auto.activationStartedAt || Date.now(),
          activationPopupDetectedAt: Date.now()
        };
        await rt.persistSession();
        rt.scheduleAuto(50);
        return;
      }

      const statusButton = document.querySelector('a[title="Change Asset Status"][onclick*="Toolbar.AssetStatus"]');
      const started = Number(auto.activationButtonStartedAt || Date.now());
      const attempts = Number(auto.activationClickAttempts || 0);
      const disabledAttr = statusButton?.getAttribute?.('disabled');
      const ready = Boolean(statusButton) && disabledAttr === null;

      const debug = {
        found: Boolean(statusButton),
        disabled: !ready,
        disabledAttr: disabledAttr ?? null,
        title: clean(statusButton?.getAttribute?.('title') || ''),
        onclick: clean(statusButton?.getAttribute?.('onclick') || ''),
        clickAttempts: attempts,
        popupPresent: Boolean(popup),
        elapsedMs: Date.now() - started
      };

      if (!auto.activationButtonStartedAt) {
        rt.addEvent('asset-status-wait-start', debug);
        rt.state.session.auto = { ...auto, activationButtonStartedAt: started, activationStatusDebug: debug };
        await rt.persistSession();
      } else if (JSON.stringify(auto.activationStatusDebug || {}) !== JSON.stringify(debug)) {
        rt.addEvent('asset-status-button-state', debug);
        rt.state.session.auto = { ...auto, activationStatusDebug: debug };
        await rt.persistSession();
      }

      if (Date.now() - started > rt.state.settings.lookupTimeoutMs) {
        throw new Error(`Change Asset Status popup did not open for ${record.assetCode}; attempts=${attempts}; buttonFound=${Boolean(statusButton)}; disabledAttr=${disabledAttr ?? 'none'}.`);
      }

      if (!ready) {
        rt.scheduleAuto(300);
        return;
      }

      const lastClickAt = Number(auto.activationLastClickAt || 0);
      if (!lastClickAt || Date.now() - lastClickAt >= 500) {
        const now = Date.now();
        const nextAttempts = attempts + 1;
        let clickReturned = false;
        let clickError = '';
        try {
          statusButton.click();
          clickReturned = true;
        } catch (error) {
          clickError = String(error?.message || error || 'click failed');
        }

        const popupAfterClick = document.getElementById('ctl00_ctl00_assetStatusPopup_container');
        rt.addEvent('asset-status-click', {
          attempt: nextAttempts,
          clickReturned,
          clickError,
          disabledAttr: statusButton.getAttribute('disabled'),
          onclick: clean(statusButton.getAttribute('onclick') || ''),
          popupPresentImmediatelyAfterClick: Boolean(popupAfterClick && visible(popupAfterClick))
        });

        rt.state.session.auto = {
          ...rt.state.session.auto,
          phase: 'activate_open',
          activationStartedAt: auto.activationStartedAt || now,
          activationButtonStartedAt: started,
          activationLastClickAt: now,
          activationClickAttempts: nextAttempts,
          activationStatusDebug: debug
        };
        await rt.persistSession();
      }

      rt.scheduleAuto(200);
      return;
    }

    if (auto.phase === 'activate_wait_user') {
      if (rt.assetIsActive()) { await afterActivation(record); return; }
      const dialog = rt.findChangeAssetStatusDialog();
      if (dialog) {
        rt.state.session.auto = { ...auto, phase: 'activate_select', activationStartedAt: Date.now(), activationButtonStartedAt: 0 };
        await rt.persistSession();
        rt.scheduleAuto(80);
        return;
      }
      rt.scheduleAuto(700);
      return;
    }

    if (auto.phase === 'activate_select') {
      const dialog = document.getElementById('ctl00_ctl00_assetStatusPopup_container') || rt.findChangeAssetStatusDialog();
      if (!dialog || !visible(dialog)) {
        rt.addEvent('asset-status-popup-missing-after-detect', {
          clickAttempts: Number(auto.activationClickAttempts || 0)
        });
        rt.state.session.auto = { ...auto, phase: 'activate_open' };
        await rt.persistSession();
        rt.scheduleAuto(100);
        return;
      }
      const exactStatusInput = dialog.querySelector('#ctl00_ctl00_assetStatusPopup_assetStatusPopupautoCompleteAssetStatus_comboBox_Input');
      const found = exactStatusInput ? { control: exactStatusInput } : (rt.nearestControl(['Asset Status', 'Status'], dialog) || rt.nearestControl(['Asset Status']));
      if (!found?.control) throw new Error('Asset Status field was not detected in the Change Asset Status window.');

      if (found.control instanceof HTMLInputElement || found.control instanceof HTMLTextAreaElement) {
        await rt.typeIntoInlineLookup(found.control, '');
      }
      await rt.selectActiveFromStatusDropdown(found.control, dialog, 'Asset Status');
      rt.state.session.auto = { ...rt.state.session.auto, phase: 'activate_confirm', activationTypedAt: Date.now() };
      await rt.persistSession();
      rt.scheduleAuto(250);
      return;
    }

    if (auto.phase === 'activate_confirm') {
      const dialog = rt.findChangeAssetStatusDialog();
      if (!dialog) {
        if (rt.assetIsActive()) { await afterActivation(record); return; }
        throw new Error('Change Asset Status window closed before OK was pressed.');
      }
      const ok = rt.findConfirmButton(dialog);
      if (!ok) throw new Error('OK button was not detected in the Change Asset Status window.');
      rt.state.session.auto = { ...auto, phase: 'activate_wait', activationConfirmStartedAt: Date.now() };
      await rt.persistSession();
      dispatchClick(ok, false);
      rt.scheduleAuto(850);
      return;
    }

    if (auto.phase === 'activate_wait') {
      if (rt.assetIsActive()) {
        await afterActivation(record);
        return;
      }
      const validation = rt.validationMessage();
      if (validation) throw new Error(`CAFM did not activate ${record.assetCode}: ${validation}`);
      const elapsed = Date.now() - Number(auto.activationConfirmStartedAt || Date.now());
      const dialog = rt.findChangeAssetStatusDialog();
      if (!dialog && elapsed >= 900) {
        await afterActivation(record);
        return;
      }
      if (elapsed > rt.state.settings.saveTimeoutMs) {
        throw new Error(`CAFM did not accept ACTIVE status for ${record.assetCode}.`);
      }
      rt.scheduleAuto(650);
      return;
    }

    rt.state.session.auto = { ...auto, phase: 'activate_open' };
    await rt.persistSession();
    rt.scheduleAuto(100);
  }

  root.pages = root.pages || {};
  root.pages.assetSaved = Object.freeze({ processActivationPage });
})();
