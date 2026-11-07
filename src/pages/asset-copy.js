(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { visible, dispatchClick } = root.core.dom;
  const {
    isSavedAssetPage,
    isAssetCopyChildEditorPage,
    copyOfFromUrl,
    entityIdFromUrl
  } = root.core.pages;
  const $ = () => root.runtime.b;

  const COPY_DIALOG_SELECTORS = Object.freeze({
    container: '#ctl00_ctl00_confirmCopy_container',
    ppmCheckbox: '#ctl00_ctl00_confirmCopy_chkBoxPPMs',
    okButton: '#ctl00_ctl00_confirmCopy_ctl03'
  });

  const MAX_COPY_CLICK_ATTEMPTS = 5;
  const COPY_POST_OK_WAIT_MS = 3000;

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

  function copyOkGateSatisfied(auto) {
    const at = Number(auto?.copyConfirmAt || 0);
    if (!at) return false;
    return Date.now() - at >= COPY_POST_OK_WAIT_MS;
  }

  function copyClickGuardKey(record, attempt) {
    return `asset-copy-${clean(record?.assetCode || 'asset')}-${Number(attempt) || 0}`;
  }

  async function markCopyDialogOk(record, templateEntityId) {
    const b = $();
    try {
      await b.runtimeMessage({
        type: 'ASSET_COPY_DIALOG_OK',
        assetCode: record.assetCode,
        templateEntityId: clean(templateEntityId || '')
      });
    } catch (error) {
      b.addEvent('asset-copy-dialog-ok-message-error', { message: String(error?.message || error) });
    }
  }

  async function expectCopyChildWindow(record, templateEntityId) {
    const b = $();
    try {
      await b.runtimeMessage({
        type: 'ASSET_EXPECT_COPY_CHILD',
        assetCode: record.assetCode,
        templateEntityId: clean(templateEntityId || ''),
        expectMs: 120000
      });
    } catch (error) {
      b.addEvent('asset-copy-expect-child-error', { message: String(error?.message || error) });
    }
  }

  async function getCopyChildState(record) {
    const b = $();
    try {
      return await b.runtimeMessage({ type: 'ASSET_COPY_CHILD_STATE', assetCode: record.assetCode }) || { found: false };
    } catch (_) {
      return { found: false };
    }
  }

  async function resumeCopyChildEditor(payload = {}) {
    const b = $();
    const auto = b.state.session.auto || {};
    if (!auto.active || !auto.copyFromExisting) return false;
    if (!isAssetCopyChildEditorPage()) return false;
    if (!copyOkGateSatisfied(auto)) return false;
    const phase = clean(auto.phase || '');
    if (auto.copyEditorReady && phase === 'filling') {
      b.scheduleAuto(100);
      return true;
    }
    if (phase !== 'asset_copy_wait_editor') return false;
    b.addEvent('asset-copy-child-resume', {
      assetCode: auto.assetCode || payload.assetCode || '',
      copyOf: copyOfFromUrl(),
      phase: auto.phase,
      childTabId: payload.childTabId ?? null,
      copyConfirmAt: auto.copyConfirmAt
    });
    b.state.session.auto = {
      ...auto,
      phase: 'filling',
      copyEditorReady: true,
      copyEditorReadyAt: Date.now(),
      copyChildTabId: payload.childTabId ?? auto.copyChildTabId ?? null,
      copySourceEntityId: auto.copySourceEntityId || payload.templateEntityId || copyOfFromUrl(),
      fillPlanStep: 0,
      fillPlanAssetCode: ''
    };
    await b.persistSession();
    b.render();
    b.showToast(`Copied asset editor ready (CopyOf ${copyOfFromUrl() || '—'}). Filling workbook fields…`, 'info', 7000);
    b.scheduleAuto(200);
    return true;
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

    if (phase === 'asset_copy_post_ok_wait') {
      const confirmedAt = Number(auto.copyConfirmAt || 0);
      if (!confirmedAt) {
        b.state.session.auto = { ...auto, phase: 'asset_copy_dialog_wait', copyDialogWaitStartedAt: Date.now() };
        await b.persistSession();
        b.scheduleAuto(200);
        return;
      }
      const remaining = COPY_POST_OK_WAIT_MS - (Date.now() - confirmedAt);
      if (remaining > 0) {
        b.showActivity?.(
          'Waiting',
          'After Copy OK',
          `${Math.ceil(remaining / 1000)}s before fill in the new asset window`,
          { wait: true, meta: record.assetCode, tick: true }
        );
        b.scheduleAuto(Math.min(remaining + 80, 1500));
        return;
      }
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_wait_editor',
        copyEditorWaitStartedAt: Date.now()
      };
      await b.persistSession();
      await expectCopyChildWindow(record, auto.copySourceEntityId || entityIdFromUrl());
      b.scheduleAuto(250);
      return;
    }

    if (phase === 'asset_copy_wait_editor') {
      if (!copyOkGateSatisfied(auto)) {
        b.state.session.auto = { ...auto, phase: 'asset_copy_post_ok_wait' };
        await b.persistSession();
        b.scheduleAuto(100);
        return;
      }
      if (isAssetCopyChildEditorPage()) {
        await resumeCopyChildEditor();
        return;
      }
      if (isSavedAssetPage()) {
        const started = Number(auto.copyEditorWaitStartedAt || Date.now());
        const child = await getCopyChildState(record);
        if (child?.found && child.copyOf) {
          b.showActivity?.('Waiting', 'Copied asset window', 'Fill + Save run in the new window', {
            wait: true,
            meta: record.assetCode,
            tick: true
          });
          b.state.session.auto = {
            ...auto,
            copyChildTabId: child.tabId,
            copyChildUrl: child.url || '',
            copyOfEntityId: child.copyOf || auto.copyOfEntityId || ''
          };
          await b.persistSession();
          b.scheduleAuto(500);
          return;
        }
        if (Date.now() - started > b.state.settings.saveTimeoutMs) {
          throw new Error('CAFM did not open the copied asset editor window before the safety timeout.');
        }
        b.scheduleAuto(400);
        return;
      }
      if (Date.now() - Number(auto.copyEditorWaitStartedAt || Date.now()) > b.state.settings.saveTimeoutMs) {
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
      try {
        await b.runtimeMessage({ type: 'ASSET_COPY_CYCLE_START', assetCode: record.assetCode, templateEntityId: sourceId });
      } catch (_) {}
      await attemptToolbarCopy(record, auto, attempt);
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_dialog_wait',
        copySourceEntityId: sourceId,
        copyDialogWaitStartedAt: Date.now(),
        copyLastClickAt: Date.now(),
        copyClickAttempts: attempt,
        copyEditorReady: false,
        copyConfirmAt: 0
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
      if (auto.copyDialogOkClickedAt) {
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
      const sourceId = auto.copySourceEntityId || entityIdFromUrl();
      const confirmedAt = Date.now();
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_post_ok_wait',
        copyConfirmAt: confirmedAt,
        copyDialogOkClickedAt: confirmedAt
      };
      await b.persistSession();
      b.addEvent('asset-copy-dialog-confirm', {
        assetCode: record.assetCode,
        copyPpmsChecked: Boolean(ppmBox?.checked),
        copyPostOkWaitMs: COPY_POST_OK_WAIT_MS
      });
      b.showActivity?.('Confirming', 'Copy with PPMs', record.assetCode, {
        wait: true,
        meta: `Copy Settings → OK, then ${COPY_POST_OK_WAIT_MS / 1000}s wait`,
        tick: true
      });
      dispatchClick(ok, false, 'Copy OK');
      await markCopyDialogOk(record, sourceId);
      await b.persistSession();
      b.scheduleAuto(400);
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
  root.pages.assetCopy = Object.freeze({
    processAssetCopy,
    findCopySettingsDialog,
    resumeCopyChildEditor,
    expectCopyChildWindow,
    copyOkGateSatisfied,
    COPY_POST_OK_WAIT_MS
  });
})();
