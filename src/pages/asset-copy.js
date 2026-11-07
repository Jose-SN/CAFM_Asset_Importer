(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { visible, dispatchClick } = root.core.dom;
  const { isSavedAssetPage, isAssetCopyEditorPage, entityIdFromUrl } = root.core.pages;
  const $ = () => root.runtime.b;

  const COPY_DIALOG_SELECTORS = Object.freeze({
    container: '#ctl00_ctl00_confirmCopy_container',
    ppmCheckbox: '#ctl00_ctl00_confirmCopy_chkBoxPPMs',
    okButton: '#ctl00_ctl00_confirmCopy_ctl03'
  });

  const MAX_COPY_CLICK_ATTEMPTS = 5;

  function findCopySettingsDialog() {
    for (const doc of root.core.toolbar.sameOriginDocuments()) {
      try {
        const el = doc.querySelector(COPY_DIALOG_SELECTORS.container)
          || doc.querySelector('.feedback_popup_modalBoxContainer[id*="confirmCopy"]');
        if (el && visible(el)) return el;
      } catch (_) {}
    }
    return null;
  }

  function copyClickGuardKey(record, attempt) {
    return `asset-copy-${clean(record?.assetCode || 'asset')}-${Number(attempt) || 0}`;
  }

  async function attemptToolbarCopy(record, auto, attempt = 1) {
    const b = $();
    const guardKey = copyClickGuardKey(record, attempt);
    const click = root.core.toolbar.clickToolbarCopy(guardKey);
    b.addEvent('asset-copy-click', {
      assetCode: record.assetCode,
      attempt,
      ...click
    });
    if (!click.ok) {
      if (click.reason === 'copy-disabled') {
        b.showToast(click.message || 'CAFM Copy is disabled on this asset.', 'warn', 14000);
        throw new Error(click.message || 'CAFM Copy toolbar button is disabled.');
      }
      if (click.reason === 'copy-cooldown') return { ok: false, pending: true, click };
      throw new Error(click.message || 'CAFM Copy toolbar button was not found on this saved asset.');
    }
    b.showActivity?.('Clicking', 'Copy', record.assetCode, {
      wait: true,
      meta: `${click.method || 'toolbar'} · attempt ${attempt}`,
      tick: true
    });
    return { ok: true, click };
  }

  async function processAssetCopy(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    const phase = clean(auto.phase || '');

    if (phase === 'asset_copy_wait_editor') {
      const started = Number(auto.copyEditorWaitStartedAt || Date.now());
      const sourceId = clean(auto.copySourceEntityId || '');
      const currentId = entityIdFromUrl();
      const ready = isAssetCopyEditorPage();
      const navigated = sourceId && currentId && currentId !== sourceId;
      if (ready || navigated) {
        b.addEvent('asset-copy-editor-ready', {
          assetCode: record.assetCode,
          sourceEntityId: sourceId,
          currentEntityId: currentId,
          ready,
          navigated
        });
        b.state.session.auto = {
          ...auto,
          phase: 'filling',
          copyEditorReady: true,
          copyEditorReadyAt: Date.now(),
          fillPlanStep: 0,
          fillPlanAssetCode: ''
        };
        await b.persistSession();
        b.render();
        b.showActivity?.('Ready', 'Copied asset editor', 'Filling workbook fields', { wait: false, meta: record.assetCode, tick: false });
        b.scheduleAuto(200);
        return;
      }
      if (Date.now() - started > b.state.settings.saveTimeoutMs) {
        throw new Error('CAFM did not open the copied asset editor before the safety timeout.');
      }
      b.scheduleAuto(350);
      return;
    }

    if (!isSavedAssetPage()) {
      if (phase === 'asset_copy_click' || phase === 'asset_copy_dialog_wait' || phase === 'asset_copy_dialog_confirm') {
        throw new Error('Open a saved asset from the list before starting copy-from-existing automation.');
      }
      b.scheduleAuto(300);
      return;
    }

    if (phase === 'asset_copy_click') {
      const sourceId = entityIdFromUrl();
      const copyState = root.core.toolbar.toolbarCopyButtonState();
      b.addEvent('asset-copy-click-start', {
        assetCode: record.assetCode,
        sourceEntityId: sourceId,
        copyButtonFound: copyState.found,
        copyButtonDisabled: copyState.disabled
      });
      const attempt = Math.max(1, Number(auto.copyClickAttempts) || 1);
      await attemptToolbarCopy(record, auto, attempt);
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_dialog_wait',
        copySourceEntityId: sourceId,
        copyDialogWaitStartedAt: Date.now(),
        copyLastClickAt: Date.now(),
        copyClickAttempts: attempt,
        copyEditorReady: false
      };
      await b.persistSession();
      b.scheduleAuto(650);
      return;
    }

    if (phase === 'asset_copy_dialog_wait') {
      const started = Number(auto.copyDialogWaitStartedAt || Date.now());
      const dialog = findCopySettingsDialog();
      if (dialog) {
        b.state.session.auto = { ...auto, phase: 'asset_copy_dialog_confirm' };
        await b.persistSession();
        b.scheduleAuto(120);
        return;
      }
      const attempts = Number(auto.copyClickAttempts) || 1;
      const sinceClick = Date.now() - Number(auto.copyLastClickAt || started);
      if (sinceClick > 1400 && attempts < MAX_COPY_CLICK_ATTEMPTS) {
        const nextAttempt = attempts + 1;
        await attemptToolbarCopy(record, auto, nextAttempt);
        b.state.session.auto = {
          ...auto,
          copyClickAttempts: nextAttempt,
          copyLastClickAt: Date.now(),
          copyDialogWaitStartedAt: started
        };
        await b.persistSession();
        b.scheduleAuto(700);
        return;
      }
      const dialogBudgetMs = Math.max(5000, Number(b.state.settings.lookupTimeoutMs) || 20000);
      if (Date.now() - started > dialogBudgetMs) {
        throw new Error('Copy Settings popup did not appear after clicking CAFM Copy. Check that Copy is enabled on the toolbar.');
      }
      const copyState = root.core.toolbar.toolbarCopyButtonState();
      const detail = copyState.disabled
        ? 'Copy is disabled — enable it in CAFM, then Resume'
        : `Attempt ${attempts}/${MAX_COPY_CLICK_ATTEMPTS} · waiting for Copy Settings`;
      b.showActivity?.('Waiting', 'Copy Settings popup', detail, { wait: true, meta: record.assetCode, tick: true });
      b.scheduleAuto(350);
      return;
    }

    if (phase === 'asset_copy_dialog_confirm') {
      const dialog = findCopySettingsDialog();
      if (!dialog) {
        b.state.session.auto = { ...auto, phase: 'asset_copy_dialog_wait', copyDialogWaitStartedAt: Date.now() };
        await b.persistSession();
        b.scheduleAuto(200);
        return;
      }
      const ppmBox = dialog.querySelector(COPY_DIALOG_SELECTORS.ppmCheckbox)
        || dialog.querySelector('input[type="checkbox"][id*="chkBoxPPMs"]');
      if (ppmBox instanceof HTMLInputElement && !ppmBox.checked) {
        ppmBox.checked = true;
        for (const eventName of ['input', 'change', 'click']) {
          ppmBox.dispatchEvent(new Event(eventName, { bubbles: true }));
        }
      }
      const ok = dialog.querySelector(COPY_DIALOG_SELECTORS.okButton)
        || [...dialog.querySelectorAll('input[type="button"],button')].find((el) => normButton(el) === 'ok');
      if (!ok) throw new Error('OK button was not found in the Copy Settings popup.');
      b.addEvent('asset-copy-dialog-confirm', {
        assetCode: record.assetCode,
        copyPpmsChecked: Boolean(ppmBox?.checked)
      });
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_wait_editor',
        copyEditorWaitStartedAt: Date.now(),
        copyConfirmAt: Date.now()
      };
      await b.persistSession();
      b.showActivity?.('Confirming', 'Copy with PPMs', record.assetCode, { wait: true, meta: 'Copy Settings → OK', tick: true });
      dispatchClick(ok, false, 'Copy OK');
      b.scheduleAuto(600);
      return;
    }

    b.state.session.auto = { ...auto, phase: 'asset_copy_click', copyStartedAt: Date.now(), copyClickAttempts: 0 };
    await b.persistSession();
    b.scheduleAuto(100);
  }

  function normButton(el) {
    return clean(el?.value || el?.textContent || '').toLowerCase();
  }

  root.pages = root.pages || {};
  root.pages.assetCopy = Object.freeze({ processAssetCopy, findCopySettingsDialog });
})();
