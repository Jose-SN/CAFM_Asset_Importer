(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { visible, dispatchClick } = root.core.dom;
  const {
    isSavedAssetPage,
    isAssetCopyChildEditorPage,
    isAssetCopyEditorPage,
    isAssetPage,
    copyOfFromUrl,
    entityIdFromUrl,
    assetEntityUrl
  } = root.core.pages;
  const $ = () => root.runtime.b;

  const COPY_DIALOG_SELECTORS = Object.freeze({
    container: '#ctl00_ctl00_confirmCopy_container',
    ppmCheckbox: '#ctl00_ctl00_confirmCopy_chkBoxPPMs',
    okButton: '#ctl00_ctl00_confirmCopy_ctl03'
  });

  const MAX_COPY_CLICK_ATTEMPTS = 5;
  const MAX_COPY_OK_ACCEPT_ATTEMPTS = 8;
  const COPY_AFTER_COPY_CLICK_MS = 5000;
  /** Legacy export (diagnostics); post-OK waits are skipped — fill starts after OK is accepted. */
  const COPY_AFTER_OK_CLICK_MS = 3000;
  const COPY_POST_OK_WAIT_MS = 3000;
  const COPY_PPM_CHECKBOX_BEFORE_OK_MS = 3000;
  const COPY_AFTER_CYCLE_MS = 5000;
  const COPY_ASSET_CODE_CLEAR_MS = 15000;

  function isCopyDialogPhase(phase) {
    return phase === 'asset_copy_dialog_wait' || phase === 'asset_copy_dialog_confirm';
  }

  function isCopyWaitPhase(phase) {
    return phase === 'asset_copy_post_click_wait'
      || phase === 'asset_copy_post_ok_click_wait'
      || phase === 'asset_copy_post_ok_wait'
      || phase === 'asset_copy_post_cycle_wait';
  }

  function templateEntityId(auto) {
    return clean(auto?.copyTemplateEntityId || auto?.copySourceEntityId || '');
  }

  function copyChildAssetCodeFieldState() {
    const code = clean(root.core.toolbar.observedAssetCodeFieldValue?.() || '');
    return { empty: !code, observed: code };
  }

  function isCopyFillEditorPage() {
    if (!isAssetPage()) return false;
    if (isAssetCopyChildEditorPage()) return true;
    if (isAssetCopyEditorPage()) return true;
    if (isSavedAssetPage()) {
      const code = copyChildAssetCodeFieldState().observed;
      if (code) return false;
      const bodyPrefix = clean(document.body?.innerText || '').slice(0, 2000);
      return /new entity/i.test(bodyPrefix);
    }
    return false;
  }

  function showTimedCopyWait(b, record, verb, target, startedAt, totalMs, detail, eventType) {
    const started = Number(startedAt || Date.now());
    const remaining = totalMs - (Date.now() - started);
    const payload = {
      assetCode: record.assetCode,
      target,
      totalMs,
      remainingMs: Math.max(0, remaining),
      windows: 'template + copy child (one Copy Settings popup on child)'
    };
    b.addEvent(eventType, payload);
    b.showActivity?.(
      verb,
      target,
      remaining > 0 ? `${Math.ceil(remaining / 1000)}s — ${detail}` : detail,
      { wait: remaining > 0, meta: record.assetCode, tick: remaining > 0 }
    );
    return remaining;
  }

  function copyDialogHostPage() {
    return isSavedAssetPage() || isAssetCopyChildEditorPage();
  }

  function copySettingsDialogRoot(doc, nearEl = null) {
    if (!doc) return null;
    if (nearEl) {
      const fromNear = nearEl.closest?.('#ctl00_ctl00_confirmCopy_container')
        || nearEl.closest?.('.feedback_popup_modalBoxContainer[id*="confirmCopy"]')
        || nearEl.closest?.('.feedback_popup_modalBoxContainer');
      if (fromNear) return fromNear;
    }
    try {
      return doc.querySelector(COPY_DIALOG_SELECTORS.container)
        || doc.querySelector('.feedback_popup_modalBoxContainer[id*="confirmCopy"]')
        || doc.querySelector('#ctl00_ctl00_confirmCopy_contentPanel')?.closest?.('.feedback_popup_modalBoxContainer')
        || null;
    } catch (_) {
      return null;
    }
  }

  function findCopySettingsOkElement(doc) {
    if (!doc) return null;
    const selectors = [
      COPY_DIALOG_SELECTORS.okButton,
      'input.feedback_popup_okButton[id*="confirmCopy"]',
      'input.feedback_popup_okButton[name*="confirmCopy"]',
      'input[type="button"][name="ctl00$ctl00$confirmCopy$ctl03"]',
      'input[type="button"][name*="confirmCopy"][value="OK"]',
      'input[type="button"][id*="confirmCopy"][value="OK"]',
      'input.feedback_popup_okButton[value="OK"]'
    ];
    for (const selector of selectors) {
      const el = doc.querySelector(selector);
      if (el) return el;
    }
    try {
      const named = doc.getElementsByName('ctl00$ctl00$confirmCopy$ctl03');
      if (named?.length) return named[0];
    } catch (_) {}
    return null;
  }

  function copySettingsDialogOpen() {
    const found = findCopySettingsOkControl();
    if (found?.ok) return found;
    for (const doc of root.core.toolbar.sameOriginDocuments()) {
      try {
        const container = doc.querySelector(COPY_DIALOG_SELECTORS.container)
          || doc.querySelector('.feedback_popup_modalBoxContainer[id*="confirmCopy"]');
        if (container && visible(container)) return { doc, dialog: container, ok: findCopySettingsOkElement(doc) };
      } catch (_) {}
    }
    return null;
  }

  function copySettingsDialogStillVisible() {
    const open = copySettingsDialogOpen();
    if (!open) return false;
    if (open.ok) return true;
    return Boolean(open.dialog && visible(open.dialog));
  }

  function findCopySettingsOkControl() {
    for (const doc of root.core.toolbar.sameOriginDocuments()) {
      try {
        const ok = findCopySettingsOkElement(doc);
        if (!ok) continue;
        const dialog = copySettingsDialogRoot(doc, ok);
        const okVisible = visible(ok);
        const dialogVisible = dialog ? visible(dialog) : false;
        const containerPresent = Boolean(
          dialog
          || doc.querySelector(COPY_DIALOG_SELECTORS.container)
          || doc.querySelector('.feedback_popup_modalBoxContainer[id*="confirmCopy"]')
        );
        if (!okVisible && !dialogVisible && !containerPresent) continue;
        return { doc, dialog, ok, identified: true, okButtonId: ok.id || '', okButtonName: ok.getAttribute?.('name') || '' };
      } catch (_) {}
    }
    return null;
  }

  function findCopySettingsDialog() {
    const found = findCopySettingsOkControl();
    return found?.dialog || null;
  }

  function invokeCopySettingsOkPostBack(ok, doc) {
    if (!ok) return false;
    const win = doc?.defaultView || window;
    try {
      if (typeof win.__doPostBack !== 'function') return false;
      const onclick = ok.getAttribute('onclick') || '';
      const match = onclick.match(/__doPostBack\s*\(\s*'([^']+)'/i);
      const target = match?.[1] || ok.getAttribute('name') || '';
      if (!target) return false;
      win.__doPostBack(target, '');
      return true;
    } catch (_) {
      return false;
    }
  }

  function clickCopySettingsOk(control) {
    if (!control?.ok) return { ok: false, reason: 'ok-not-found' };
    const { ok, doc } = control;
    try { ok.scrollIntoView?.({ block: 'center', inline: 'nearest' }); } catch (_) {}
    let method = '';
    if (invokeCopySettingsOkPostBack(ok, doc)) {
      method = '__doPostBack';
    } else if (root.core.toolbar.dispatchLegacySingleClick(ok, 'copy-settings-ok', 2500)) {
      method = 'dispatchLegacySingleClick';
    } else {
      dispatchClick(ok, false, 'Copy Settings OK');
      method = 'dispatchClick';
    }
    try {
      if (typeof ok.click === 'function') ok.click();
    } catch (_) {}
    return { ok: true, method };
  }

  function copyOkGateSatisfied(auto) {
    const readyAt = Number(auto?.copyFillReadyAt || 0);
    return readyAt > 0 && Date.now() >= readyAt;
  }

  async function beginCopyFillAfterOk(b, auto, record, sourceId, detail = 'OK accepted — waiting for Asset Code, then fill') {
    const readyAt = Date.now();
    b.addEvent('asset-copy-ready-for-fill', {
      assetCode: record.assetCode,
      copyPostOkWaitMs: COPY_POST_OK_WAIT_MS,
      copyAfterOkClickMs: COPY_AFTER_OK_CLICK_MS,
      skippedPostOkWaits: true
    });
    b.showActivity?.('Ready', 'Copy child editor', detail, {
      wait: true,
      meta: record.assetCode,
      tick: true
    });
    b.state.session.auto = {
      ...auto,
      phase: 'asset_copy_wait_editor',
      copyEditorWaitStartedAt: readyAt,
      copyFillReadyAt: readyAt,
      copyOkPendingVerify: false,
      copyOkAcceptAttempts: 0,
      copyPostOkClickWaitStartedAt: 0,
      copyPostOkWaitStartedAt: 0,
      copyConfirmAt: readyAt,
      copyAssetCodeClearedLogged: false,
      copyAssetCodeWaitStartedAt: 0
    };
    await b.persistSession();
    await markCopyDialogOk(record, sourceId);
    await expectCopyChildWindow(record, auto.copySourceEntityId || templateEntityId(auto));
    await b.persistSession();
    b.scheduleAuto(200);
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
    if (!isCopyFillEditorPage()) return false;
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

    if (phase === 'asset_copy_post_cycle_wait') {
      const templateId = templateEntityId(auto);
      if (!templateId) throw new Error('Copy template asset ID is missing. Re-open the template saved asset and Resume.');
      if (!isSavedAssetPage() || entityIdFromUrl() !== templateId) {
        b.showActivity?.('Navigating', 'Template window', `Opening template asset id=${templateId} for next Copy`, {
          wait: true,
          meta: record.assetCode,
          tick: true
        });
        b.addEvent('asset-copy-return-template', { assetCode: record.assetCode, templateEntityId: templateId });
        location.href = assetEntityUrl(templateId);
        return;
      }
      const started = Number(auto.copyPostCycleWaitStartedAt || Date.now());
      const remaining = showTimedCopyWait(
        b,
        record,
        'Waiting',
        'Before next Copy',
        started,
        COPY_AFTER_CYCLE_MS,
        'then Copy again on template (2 windows, 1 popup)',
        'asset-copy-post-cycle-wait'
      );
      if (remaining > 0) {
        b.scheduleAuto(Math.min(remaining + 80, 1500));
        return;
      }
      b.showActivity?.('Ready', 'Next Copy cycle', 'Clicking Copy on template for next workbook row', {
        wait: true,
        meta: record.assetCode,
        tick: true
      });
      b.addEvent('asset-copy-cycle-restart', { assetCode: record.assetCode, templateEntityId: templateId });
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_click',
        copyClickAttempts: 0,
        copyConfirmAt: 0,
        copyFillReadyAt: 0,
        copyEditorReady: false,
        copyOkPendingVerify: false,
        copyPostClickWaitStartedAt: 0,
        copyPostOkClickWaitStartedAt: 0,
        copyPostOkWaitStartedAt: 0,
        copyPpmCheckboxCheckedAt: 0
      };
      await b.persistSession();
      b.scheduleAuto(200);
      return;
    }

    if (phase === 'asset_copy_post_click_wait') {
      const started = Number(auto.copyPostClickWaitStartedAt || Date.now());
      const remaining = showTimedCopyWait(
        b,
        record,
        'Waiting',
        'After Copy click',
        started,
        COPY_AFTER_COPY_CLICK_MS,
        'child window loads; Copy Settings popup may appear',
        'asset-copy-post-click-wait'
      );
      if (remaining > 0) {
        b.scheduleAuto(Math.min(remaining + 80, 1500));
        return;
      }
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_dialog_wait',
        copyDialogWaitStartedAt: Date.now()
      };
      await b.persistSession();
      b.scheduleAuto(120);
      return;
    }

    if (phase === 'asset_copy_post_ok_click_wait' || phase === 'asset_copy_post_ok_wait') {
      const sourceId = auto.copySourceEntityId || templateEntityId(auto);
      await beginCopyFillAfterOk(b, auto, record, sourceId, 'Skipping post-OK timer (legacy phase) — fill when editor is ready');
      return;
    }

    if (phase === 'asset_copy_wait_editor') {
      if (!copyOkGateSatisfied(auto)) {
        const readyAt = Number(auto.copyFillReadyAt || 0);
        if (readyAt && Date.now() < readyAt) {
          b.scheduleAuto(Math.max(80, readyAt - Date.now()));
          return;
        }
        if (!readyAt) {
          b.state.session.auto = { ...auto, copyFillReadyAt: Date.now() };
          await b.persistSession();
        }
      }
      if (isCopyFillEditorPage()) {
        const codeState = copyChildAssetCodeFieldState();
        const waitStarted = Number(auto.copyAssetCodeWaitStartedAt || 0);
        if (!codeState.empty) {
          const started = waitStarted || Date.now();
          if (!waitStarted) {
            b.state.session.auto = { ...auto, copyAssetCodeWaitStartedAt: started };
            await b.persistSession();
          }
          b.addEvent('asset-copy-asset-code-wait', { observed: codeState.observed, assetCode: record.assetCode });
          b.showActivity?.(
            'Waiting',
            'Asset Code empty',
            `Field still shows “${codeState.observed}” — waiting for copy refresh`,
            { wait: true, meta: record.assetCode, tick: true }
          );
          if (Date.now() - started < COPY_ASSET_CODE_CLEAR_MS) {
            b.scheduleAuto(400);
            return;
          }
          b.addEvent('asset-copy-asset-code-timeout', { observed: codeState.observed, assetCode: record.assetCode });
        } else if (!auto.copyAssetCodeClearedLogged) {
          b.addEvent('asset-copy-asset-code-cleared', { assetCode: record.assetCode });
          b.showActivity?.('Ready', 'Asset Code', 'Field is empty — filling workbook details', {
            wait: false,
            meta: record.assetCode,
            tick: false
          });
          b.state.session.auto = { ...auto, copyAssetCodeClearedLogged: true };
          await b.persistSession();
        }
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

    if (phase === 'asset_copy_click' && !isSavedAssetPage()) {
      throw new Error('Open a saved asset from the list before starting copy-from-existing automation.');
    }

    if (isCopyDialogPhase(phase) || isCopyWaitPhase(phase)) {
      if ((isCopyDialogPhase(phase) || phase === 'asset_copy_post_ok_wait' || phase === 'asset_copy_post_ok_click_wait') && !copyDialogHostPage()) {
        const child = await getCopyChildState(record);
        const onChild = child?.found ? 'Copy Settings run in the new copy window' : 'Waiting for the copy window to open';
        b.showActivity?.('Waiting', 'Copy Settings', onChild, { wait: true, meta: record.assetCode, tick: true });
        b.scheduleAuto(400);
        return;
      }
    } else if (!isSavedAssetPage()) {
      b.scheduleAuto(300);
      return;
    }

    if (phase === 'asset_copy_click') {
      const sourceId = entityIdFromUrl();
      const templateId = templateEntityId(auto) || sourceId;
      if (templateId && sourceId !== templateId) {
        b.showActivity?.('Navigating', 'Template window', `Expected template id=${templateId}`, {
          wait: true,
          meta: record.assetCode,
          tick: true
        });
        location.href = assetEntityUrl(templateId);
        return;
      }
      const copyState = root.core.toolbar.toolbarCopyButtonState();
      b.addEvent('asset-copy-click-start', {
        assetCode: record.assetCode,
        sourceEntityId: sourceId,
        copyTemplateEntityId: templateId,
        copyButtonFound: copyState.found,
        copyButtonDisabled: copyState.disabled,
        model: 'two-windows-one-popup'
      });
      const attempt = Math.max(1, Number(auto.copyClickAttempts) || 1);
      try {
        await b.runtimeMessage({ type: 'ASSET_COPY_CYCLE_START', assetCode: record.assetCode, templateEntityId: templateId });
      } catch (_) {}
      await attemptToolbarCopy(record, auto, attempt);
      const clickAt = Date.now();
      b.addEvent('asset-copy-click-done', { assetCode: record.assetCode, attempt, waitMs: COPY_AFTER_COPY_CLICK_MS });
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_post_click_wait',
        copySourceEntityId: templateId,
        copyTemplateEntityId: templateId,
        copyPostClickWaitStartedAt: clickAt,
        copyLastClickAt: clickAt,
        copyClickAttempts: attempt,
        copyEditorReady: false,
        copyConfirmAt: 0,
        copyFillReadyAt: 0,
        copyAssetCodeClearedLogged: false,
        copyAssetCodeWaitStartedAt: 0,
        copyPpmCheckboxCheckedAt: 0
      };
      await b.persistSession();
      b.scheduleAuto(400);
      return;
    }

    if (phase === 'asset_copy_dialog_wait') {
      const started = Number(auto.copyDialogWaitStartedAt || Date.now());
      const onChild = isAssetCopyChildEditorPage();
      const dialogProbe = findCopySettingsOkControl();
      const okIdentified = Boolean(dialogProbe?.ok);
      const identifyPayload = {
        assetCode: record.assetCode,
        okIdentified,
        okButtonId: dialogProbe?.okButtonId || dialogProbe?.ok?.id || '',
        okButtonName: dialogProbe?.okButtonName || dialogProbe?.ok?.getAttribute?.('name') || '',
        page: onChild ? 'copy-child' : 'template',
        url: location.href
      };
      if (JSON.stringify(auto.copyOkIdentifyDebug || {}) !== JSON.stringify(identifyPayload)) {
        b.addEvent(okIdentified ? 'asset-copy-ok-identified' : 'asset-copy-ok-not-identified', identifyPayload);
        b.state.session.auto = { ...auto, copyOkIdentifyDebug: identifyPayload };
        await b.persistSession();
      }
      b.showActivity?.(
        okIdentified ? 'Ready' : 'Waiting',
        'Copy Settings OK',
        okIdentified
          ? `OK button identified (${identifyPayload.okButtonId || identifyPayload.okButtonName || 'confirmCopy'})`
          : `OK button not identified yet — check the ${onChild ? 'copy' : 'template'} window popup`,
        { wait: !okIdentified, meta: record.assetCode, tick: !okIdentified }
      );
      if (dialogProbe?.ok) {
        b.state.session.auto = { ...auto, phase: 'asset_copy_dialog_confirm', copyOkPendingVerify: false };
        await b.persistSession();
        b.scheduleAuto(120);
        return;
      }
      const attempts = Number(auto.copyClickAttempts) || 1;
      const sinceClick = Date.now() - Number(auto.copyLastClickAt || started);
      if (isSavedAssetPage() && sinceClick > 1400 && attempts < MAX_COPY_CLICK_ATTEMPTS) {
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
        throw new Error(
          okIdentified
            ? 'Copy Settings OK was detected but could not be confirmed.'
            : 'Copy Settings popup did not appear after clicking CAFM Copy. Check that Copy is enabled on the toolbar.'
        );
      }
      const copyState = isSavedAssetPage() ? root.core.toolbar.toolbarCopyButtonState() : { disabled: false };
      const detail = copyState.disabled
        ? 'Copy is disabled — enable it in CAFM, then Resume'
        : onChild
          ? 'Popup should be in this copy window'
          : `Attempt ${attempts}/${MAX_COPY_CLICK_ATTEMPTS} · waiting for Copy Settings in the copy window`;
      b.showActivity?.('Waiting', 'Copy Settings popup', detail, { wait: true, meta: record.assetCode, tick: true });
      b.scheduleAuto(350);
      return;
    }

    if (phase === 'asset_copy_dialog_confirm') {
      const sourceId = auto.copySourceEntityId || copyOfFromUrl() || entityIdFromUrl();
      const acceptAttempts = Number(auto.copyOkAcceptAttempts || 0);

      if (auto.copyOkPendingVerify) {
        const stillOpen = copySettingsDialogStillVisible();
        const clickedAt = Number(auto.copyDialogOkClickedAt || 0);
        const verifyMs = Date.now() - clickedAt;
        if (!stillOpen && verifyMs < 120) {
          b.scheduleAuto(180);
          return;
        }
        if (!stillOpen && verifyMs >= 120) {
          b.addEvent('asset-copy-ok-accepted', {
            assetCode: record.assetCode,
            verifyMs,
            okClickMethod: auto.copyOkClickMethod || '',
            acceptAttempts
          });
          const merged = {
            ...auto,
            copyDialogOkClickedAt: clickedAt || Date.now(),
            copyOkClickMethod: auto.copyOkClickMethod || ''
          };
          await beginCopyFillAfterOk(b, merged, record, sourceId);
          return;
        }
        if (stillOpen) {
          b.addEvent('asset-copy-ok-not-accepted', {
            assetCode: record.assetCode,
            verifyMs,
            okClickMethod: auto.copyOkClickMethod || '',
            acceptAttempts
          });
          b.showActivity?.(
            'Warning',
            'Copy Settings OK',
            'Click triggered but CAFM did not accept OK — retrying',
            { wait: true, meta: record.assetCode, tick: true, type: 'warn' }
          );
          if (acceptAttempts >= MAX_COPY_OK_ACCEPT_ATTEMPTS) {
            throw new Error('Copy Settings OK was clicked but CAFM did not close the popup before the retry limit.');
          }
        }
      }

      const control = findCopySettingsOkControl();
      if (!control?.ok) {
        if (auto.copyConfirmAt && !auto.copyOkPendingVerify) {
          await beginCopyFillAfterOk(b, auto, record, sourceId);
          return;
        }
        b.state.session.auto = { ...auto, phase: 'asset_copy_dialog_wait', copyDialogWaitStartedAt: Date.now() };
        await b.persistSession();
        b.scheduleAuto(200);
        return;
      }
      const dialog = control.dialog || copySettingsDialogRoot(control.doc, control.ok);
      const ppmBox = (dialog || control.doc).querySelector?.(COPY_DIALOG_SELECTORS.ppmCheckbox)
        || control.doc.querySelector(COPY_DIALOG_SELECTORS.ppmCheckbox)
        || (dialog || control.doc).querySelector?.('input[type="checkbox"][id*="chkBoxPPMs"]');
      let checkboxCheckedAt = Number(auto.copyPpmCheckboxCheckedAt || 0);
      if (ppmBox instanceof HTMLInputElement) {
        if (!ppmBox.checked) {
          ppmBox.checked = true;
          for (const eventName of ['input', 'change', 'click']) {
            ppmBox.dispatchEvent(new Event(eventName, { bubbles: true }));
          }
        }
        if (!checkboxCheckedAt) {
          checkboxCheckedAt = Date.now();
          b.state.session.auto = { ...auto, copyPpmCheckboxCheckedAt: checkboxCheckedAt };
          await b.persistSession();
          auto = b.state.session.auto || auto;
        }
      }
      const checkboxWaitLeft = COPY_PPM_CHECKBOX_BEFORE_OK_MS - (Date.now() - checkboxCheckedAt);
      if (checkboxCheckedAt && checkboxWaitLeft > 0) {
        b.addEvent('asset-copy-ppm-checkbox-wait', {
          assetCode: record.assetCode,
          waitMs: COPY_PPM_CHECKBOX_BEFORE_OK_MS,
          remainingMs: checkboxWaitLeft
        });
        b.showActivity?.(
          'Waiting',
          'Copy PPMs checkbox',
          `${Math.ceil(checkboxWaitLeft / 1000)}s in popup before OK click`,
          { wait: true, meta: record.assetCode, tick: true }
        );
        b.scheduleAuto(Math.min(checkboxWaitLeft + 80, 1200));
        return;
      }
      b.showActivity?.('Confirming', 'Copy Settings OK', 'PPMs checked — clicking OK', {
        wait: true,
        meta: `${control.ok.id || control.ok.getAttribute?.('name') || 'confirmCopy'}`,
        tick: true
      });
      const clickResult = clickCopySettingsOk(control);
      const clickedAt = Date.now();
      const nextAcceptAttempts = acceptAttempts + 1;
      b.addEvent('asset-copy-dialog-confirm', {
        assetCode: record.assetCode,
        copyPpmsChecked: Boolean(ppmBox?.checked),
        copyPostOkWaitMs: COPY_POST_OK_WAIT_MS,
        okButtonId: control.ok.id || '',
        okButtonName: control.ok.getAttribute?.('name') || '',
        okClickMethod: clickResult.method || '',
        okClickOk: clickResult.ok,
        acceptAttempt: nextAcceptAttempts
      });
      if (!clickResult.ok) {
        throw new Error('Copy Settings OK button could not be clicked.');
      }
      b.state.session.auto = {
        ...auto,
        phase: 'asset_copy_dialog_confirm',
        copyOkPendingVerify: true,
        copyDialogOkClickedAt: clickedAt,
        copyOkClickMethod: clickResult.method || '',
        copyOkAcceptAttempts: nextAcceptAttempts,
        copyConfirmAt: 0
      };
      await b.persistSession();
      b.scheduleAuto(420);
      return;
    }

    b.state.session.auto = { ...auto, phase: 'asset_copy_click', copyStartedAt: Date.now(), copyClickAttempts: 0 };
    await b.persistSession();
    b.scheduleAuto(100);
  }

  root.pages = root.pages || {};
  root.pages.assetCopy = Object.freeze({
    processAssetCopy,
    findCopySettingsDialog,
    findCopySettingsOkControl,
    clickCopySettingsOk,
    resumeCopyChildEditor,
    expectCopyChildWindow,
    copyOkGateSatisfied,
    isCopyFillEditorPage,
    COPY_POST_OK_WAIT_MS,
    COPY_AFTER_COPY_CLICK_MS,
    COPY_AFTER_OK_CLICK_MS,
    COPY_PPM_CHECKBOX_BEFORE_OK_MS,
    COPY_AFTER_CYCLE_MS
  });
})();
