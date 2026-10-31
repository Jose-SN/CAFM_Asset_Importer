(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, uniqueNonBlank } = root.core.text;
  const {
    wait,
    visible,
    isAssistantElement,
    elementValue,
    dispatchClick,
    clickAssetToolbarSaveAndClose,
    clickAssetToolbarSaveAndNew
  } = root.core.dom;
  const { makeLookupSpec, typeLookupSearchTerm, ppmInstructionLookupValue } = root.core.lookupSpec;
  const { isPpmNewEntityPage, isPpmItemPage, isPpmListPage } = root.core.pages;
  const { currentFromList, linkedForAsset } = root.data.ppm;
  const $ = () => root.runtime.b;

  const FORM_WAIT_MS = 4000;
  const FORM_POLL_MS = 150;
  const CONTRACT_INPUT = 'input[id*="FPPMGeneral_Editor_ContractAC_comboBox_Input"]';
  const INSTRUCTION_INPUT = 'input[id*="FPPMGeneral_Editor_InstructionAC_comboBox_Input"]';
  const LAST_SERVICE_INPUT = 'input[id*="FPPMGeneral_Editor_LastService_ctl00"]';
  const NOTES_TEXTAREA = 'textarea[id*="FPPMNotes_Editor_TextBoxNAME"]';

  async function claimPpmEditorStep(b, reason) {
    if (!isPpmItemPage()) return true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'PPM_EDITOR_CLAIM',
        reason: String(reason || ''),
        url: location.href,
        phase: clean(b.state.session.auto?.phase || '')
      });
      return Boolean(res?.isEditor);
    } catch (_) {
      return false;
    }
  }

  async function requestPpmSaveGate(b) {
    const auto = b.state.session.auto || {};
    try {
      return await chrome.runtime.sendMessage({
        type: 'PPM_REQUEST_PPM_SAVE',
        assetCode: auto.assetCode || '',
        ppmIndex: Math.max(0, Number(auto.ppmIndex) || 0)
      });
    } catch (_) {
      return { ok: false };
    }
  }

  async function releasePpmSaveGate(b, saveKey) {
    try {
      await chrome.runtime.sendMessage({
        type: 'PPM_RELEASE_ACTION_LOCK',
        saveKey: clean(saveKey || '')
      });
    } catch (_) {}
  }

  async function registerPpmEditor(reason) {
    if (!isPpmItemPage()) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'REGISTER_PPM_EDITOR_TAB',
        reason: String(reason || ''),
        url: location.href
      });
    } catch (_) {}
  }

  async function adoptEditorAfterSaveAndNew(b) {
    try {
      return await chrome.runtime.sendMessage({ type: 'PPM_ADOPT_EDITOR_AFTER_SAVE' });
    } catch (_) {
      return null;
    }
  }

  function clearPpmSaveDispatchFlags(auto) {
    return {
      ...auto,
      ppmSaveInFlight: false,
      ppmSaveDispatchedAt: 0,
      ppmSaveDispatchedAction: ''
    };
  }

  function lookupSpec(field, value) {
    const raw = clean(value);
    const lookupValue = field === 'Instruction' ? ppmInstructionLookupValue(raw) : raw;
    const term = field === 'Instruction'
      ? typeLookupSearchTerm(lookupValue)
      : typeLookupSearchTerm(value);
    const searchTerms = field === 'Instruction'
      ? uniqueNonBlank([lookupValue, term, raw !== lookupValue ? raw : ''])
      : uniqueNonBlank([term, value]);
    return makeLookupSpec(field, lookupValue, {
      tab: 'General',
      display: lookupValue,
      description: lookupValue,
      searchTerms
    });
  }

  function ppmIndexOf(auto) {
    return Math.max(0, Number(auto?.ppmIndex) || 0);
  }

  function linkedCount(record, b) {
    return linkedForAsset(record, b.state.ppms || []).length;
  }

  function hasMoreLinkedPpms(record, b, ppmIndex) {
    return ppmIndex + 1 < linkedCount(record, b);
  }

  function saveActionForRow(record, b, ppmIndex) {
    return hasMoreLinkedPpms(record, b, ppmIndex) ? 'save_and_new' : 'save_and_close';
  }

  function saveActionLabel(action) {
    return action === 'save_and_new' ? 'Save and New' : 'Save and Close';
  }

  function onAssetPpmListSurface() {
    return isPpmListPage() || Boolean(document.querySelector('[id*="fsiGridPPMs"]'));
  }

  async function waitForForm() {
    const deadline = Date.now() + FORM_WAIT_MS;
    while (Date.now() < deadline) {
      if (document.querySelector(CONTRACT_INPUT) || document.querySelector(INSTRUCTION_INPUT)) return;
      await wait(FORM_POLL_MS);
    }
  }

  function findNotesTextarea() {
    const el = document.querySelector(NOTES_TEXTAREA);
    return el instanceof HTMLTextAreaElement && visible(el) && !isAssistantElement(el) ? el : null;
  }

  function findNotesTab() {
    const tabs = [...document.querySelectorAll('span.ajax__tab_tab, a.ajax__tab_tab, [role="tab"]')]
      .filter((el) => visible(el) && !isAssistantElement(el) && String(el.textContent || '').trim().toLowerCase() === 'notes');
    return tabs.find((el) => /FPPMEditor|TabPanel1/i.test(`${el.id || ''}`)) || tabs[0] || null;
  }

  async function openNotesTab() {
    if (findNotesTextarea()) return true;
    const tab = findNotesTab();
    if (!tab) return false;
    const clickable = tab.closest('a,span') || tab;
    try {
      if (typeof clickable.click === 'function') clickable.click();
      else dispatchClick(clickable, false, 'Notes');
    } catch (_) {
      dispatchClick(clickable, false, 'Notes');
    }
    const deadline = Date.now() + 2600;
    while (Date.now() < deadline) {
      await wait(0);
      if (findNotesTextarea()) return true;
    }
    return Boolean(findNotesTextarea());
  }

  async function fillLastService(b, ppm) {
    const value = clean(ppm.lastService);
    if (!value) return;
    const onGeneral = document.querySelector(LAST_SERVICE_INPUT) || document.querySelector(CONTRACT_INPUT);
    if (!onGeneral) await b.clickTab('General');
    const input = document.querySelector(LAST_SERVICE_INPUT);
    const control = input instanceof HTMLInputElement && visible(input) && !isAssistantElement(input)
      ? input
      : b.nearestControl(['Last Service'])?.control;
    if (!control) {
      b.addEvent('ppm-field-filled', { field: 'Last Service', expected: value, actual: '', status: 'missing' });
      return;
    }
    b.showFieldFill?.('Last Service', value, { meta: 'General tab', wait: false, duration: 900, tick: false });
    const ok = b.setNativeValue(control, value);
    b.addEvent('ppm-field-filled', {
      field: 'Last Service',
      expected: value,
      actual: clean(elementValue(control)),
      status: ok ? 'filled' : 'set-failed'
    });
  }

  async function markPpmSaved(b, record, ppm) {
    b.addEvent('ppm-saved', { assetCode: record.assetCode, instruction: ppm.instruction || '', ppmKey: ppm.ppmKey || '' });
  }

  async function fillNotes(b, ppm) {
    const value = clean(ppm.notes);
    if (!value) return;
    if (!(await openNotesTab())) throw new Error('PPM Notes tab could not be opened.');
    const textarea = findNotesTextarea();
    if (!textarea) throw new Error('PPM Notes text area was not found.');
    const text = String(ppm.notes).slice(0, 2200);
    b.showFieldFill?.('Notes', text, { meta: 'Notes tab', wait: false, duration: 2800, tick: false });
    if (!b.setNativeValue(textarea, text)) throw new Error('PPM Notes could not be filled.');
    b.addEvent('ppm-field-filled', { field: 'Notes', expected: text, actual: clean(elementValue(textarea)) });
  }

  async function processFill(record) {
    const b = $();
    if (!isPpmNewEntityPage()) return;
    const auto = b.state.session.auto || {};
    if (auto.mode !== 'ppm' || !auto.active) return;
    if (auto.phase === 'ppm_filled') return;
    if (auto.phase !== 'wait_ppm_new' && auto.phase !== 'ppm_fill') return;

    if (!(await claimPpmEditorStep(b, 'processFill'))) {
      b.scheduleAuto(450);
      return;
    }
    await registerPpmEditor('processFill');

    const ppm = currentFromList(record, b.state.ppms, auto.ppmIndex);
    if (!ppm) throw new Error(`No workbook PPM row is queued for ${record.assetCode}.`);

    const saveAction = saveActionForRow(record, b, ppmIndexOf(auto));

    b.state.session.auto = {
      ...clearPpmSaveDispatchFlags(auto),
      phase: 'ppm_fill',
      ppmKey: ppm.ppmKey || auto.ppmKey || '',
      ppmInstruction: ppm.instruction || auto.ppmInstruction || '',
      ppmSaveAction: saveAction
    };
    await b.persistSession();
    await waitForForm();
    b.showActivity?.('Filling', ppm.instruction || record.assetCode, 'Contract, Instruction, Last Service, Notes', {
      wait: true,
      meta: record.assetCode,
      tick: true
    });

    if (clean(ppm.contract)) {
      const result = await b.selectLookup(lookupSpec('Contract', ppm.contract));
      b.addEvent('ppm-lookup-selected', {
        field: 'Contract',
        expected: ppm.contract,
        selected: clean(result.selected || result.selectedText || '')
      });
    }

    if (!clean(ppm.instruction)) throw new Error(`Workbook PPM row ${ppm.workbookRow} has no Instruction.`);
    const instructionResult = await b.selectLookup(lookupSpec('Instruction', ppm.instruction));
    b.addEvent('ppm-lookup-selected', {
      field: 'Instruction',
      expected: ppm.instruction,
      selected: clean(instructionResult.selected || instructionResult.selectedText || '')
    });

    await fillLastService(b, ppm);
    await fillNotes(b, ppm);

    b.state.session.auto = {
      ...b.state.session.auto,
      phase: 'ppm_saving',
      ppmSaveAction: saveAction,
      ppmSaveMenuStartedAt: 0,
      ppmSaveInFlight: false,
      ppmSaveDispatchedAt: 0
    };
    await b.persistSession();
    b.showToast(
      `${record.assetCode}: fields filled. Using ${saveActionLabel(saveAction)} for this PPM.`,
      'info',
      6000
    );
    b.scheduleAuto(250);
  }

  function clickSaveForAction(action) {
    return action === 'save_and_new' ? clickAssetToolbarSaveAndNew() : clickAssetToolbarSaveAndClose();
  }

  async function processSave(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    if (!auto.active || auto.mode !== 'ppm') return;
    if (auto.phase !== 'ppm_saving') return;
    if (!isPpmItemPage()) return;

    if (!(await claimPpmEditorStep(b, 'processSave'))) {
      b.scheduleAuto(450);
      return;
    }

    if (Number(auto.ppmSaveDispatchedAt || 0) > 0 || auto.phase === 'ppm_await_save') {
      b.scheduleAuto(400);
      return;
    }
    if (auto.ppmSaveInFlight) {
      b.scheduleAuto(400);
      return;
    }

    const ppm = currentFromList(record, b.state.ppms, auto.ppmIndex);
    if (!ppm) throw new Error(`No workbook PPM row is queued for ${record.assetCode}.`);

    const saveAction = clean(auto.ppmSaveAction) || saveActionForRow(record, b, ppmIndexOf(auto));
    const actionLabel = saveActionLabel(saveAction);

    const validation = b.validationMessage();
    if (validation) throw new Error(validation);

    const saveKey = `${record.assetCode}|${ppmIndexOf(auto)}`;
    const saveGate = await requestPpmSaveGate(b);
    if (!saveGate?.ok) {
      b.addEvent('ppm-save-blocked', {
        assetCode: record.assetCode,
        reason: saveGate?.reason || 'save-gate',
        ppmIndex: ppmIndexOf(auto)
      });
      b.scheduleAuto(500);
      return;
    }

    b.state.session.auto = { ...auto, ppmSaveInFlight: true, ppmSaveMenuStartedAt: auto.ppmSaveMenuStartedAt || 0 };
    await b.persistSession();

    const click = clickSaveForAction(saveAction);
    b.addEvent('ppm-save-click', {
      assetCode: record.assetCode,
      instruction: ppm.instruction || '',
      action: saveAction,
      ok: Boolean(click.ok),
      pending: Boolean(click.pending),
      method: click.method || '',
      reason: click.reason || ''
    });
    if (!click.ok) {
      await releasePpmSaveGate(b, saveGate?.key || saveKey);
      const started = Number(auto.ppmSaveMenuStartedAt || Date.now());
      b.state.session.auto = {
        ...b.state.session.auto,
        phase: 'ppm_saving',
        ppmSaveAction: saveAction,
        ppmSaveMenuStartedAt: started,
        ppmSaveInFlight: false
      };
      await b.persistSession();
      if (Date.now() - started > Number(b.state.settings.lookupTimeoutMs || 8000)) {
        throw new Error(`${actionLabel} was not found on the PPM toolbar.`);
      }
      b.showActivity?.(
        'Waiting',
        actionLabel,
        click.reason === 'opening-save-dropdown' ? 'Opening Save dropdown' : `Waiting for ${actionLabel}`,
        { wait: true, meta: record.assetCode, tick: true }
      );
      b.scheduleAuto(350);
      return;
    }

    await markPpmSaved(b, record, ppm);
    const nextPpmIndex = ppmIndexOf(auto) + 1;
    const awaitKind = saveAction === 'save_and_new' ? 'save_and_new' : 'save_and_close';
    const dispatchedAt = Date.now();
    b.state.session.auto = {
      ...auto,
      active: true,
      mode: 'ppm',
      phase: 'ppm_await_save',
      index: auto.index,
      assetCode: record.assetCode,
      assetEntityId: auto.assetEntityId || '',
      processedThisRun: Number(auto.processedThisRun || 0),
      startedAt: auto.startedAt,
      ppmIndex: nextPpmIndex,
      ppmListRunning: false,
      ppmSaveMenuStartedAt: 0,
      ppmSaveInFlight: false,
      ppmSaveDispatchedAt: dispatchedAt,
      ppmSaveDispatchedAction: saveAction,
      ppmAwaitSaveKind: awaitKind,
      ppmAwaitSaveStartedAt: dispatchedAt,
      phaseProgressAt: dispatchedAt
    };
    await b.persistSession();
    await root.workflow.engine?.touchPpmPhaseProgress?.();
    b.showActivity?.('Waiting', actionLabel, 'Confirming PPM save in CAFM', { wait: true, meta: record.assetCode, tick: true });
    b.scheduleAuto(400);
  }

  async function processAwaitSave(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    if (!auto.active || auto.mode !== 'ppm') return;
    if (auto.phase !== 'ppm_await_save') return;

    const kind = clean(auto.ppmAwaitSaveKind);
    const started = Number(auto.ppmAwaitSaveStartedAt || auto.phaseProgressAt || Date.now());
    const timeoutMs = Number(b.state.settings.saveTimeoutMs || 45000);

    if (kind === 'save_and_new') {
      if (isPpmNewEntityPage()) {
        if (!(await claimPpmEditorStep(b, 'processAwaitSave-new-form'))) {
          b.scheduleAuto(450);
          return;
        }
        await registerPpmEditor('await-save-new-form');
        try {
          await chrome.runtime.sendMessage({
            type: 'PPM_CLEAR_ROW_SAVE_TOKEN',
            assetCode: record.assetCode || ''
          });
        } catch (_) {}
        b.state.session.auto = {
          ...clearPpmSaveDispatchFlags(auto),
          phase: 'wait_ppm_new',
          ppmAwaitSaveKind: '',
          ppmAwaitSaveStartedAt: 0,
          ppmSaveMenuStartedAt: 0,
          phaseProgressAt: Date.now()
        };
        await b.persistSession();
        b.showActivity?.('Save and New', 'New PPM form', 'Filling next workbook row', {
          wait: true,
          meta: record.assetCode,
          tick: true
        });
        b.scheduleAuto(250);
        return;
      }
      if (isPpmItemPage()) {
        if (!(await claimPpmEditorStep(b, 'processAwaitSave-handoff'))) {
          b.scheduleAuto(500);
          return;
        }
        const adopted = await adoptEditorAfterSaveAndNew(b);
        if (adopted?.ready && !adopted.isThisTab) {
          b.scheduleAuto(500);
          return;
        }
        if (adopted?.ready && adopted.isThisTab && isPpmNewEntityPage()) {
          b.state.session.auto = {
            ...clearPpmSaveDispatchFlags(auto),
            phase: 'wait_ppm_new',
            ppmAwaitSaveKind: '',
            ppmAwaitSaveStartedAt: 0,
            phaseProgressAt: Date.now()
          };
          await b.persistSession();
          b.scheduleAuto(250);
          return;
        }
      }
    } else if (kind === 'save_and_close') {
      if (onAssetPpmListSurface()) {
        b.state.session.auto = {
          ...clearPpmSaveDispatchFlags(auto),
          phase: 'wait_ppm',
          ppmAwaitSaveKind: '',
          ppmAwaitSaveStartedAt: 0,
          phaseProgressAt: Date.now()
        };
        await b.persistSession();
        b.showActivity?.('Save and Close', 'Asset PPM list', 'Closing asset when all rows are done', {
          wait: true,
          meta: record.assetCode,
          tick: true
        });
        b.scheduleAuto(600);
        return;
      }
    }

    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting after PPM ${kind === 'save_and_new' ? 'Save and New' : 'Save and Close'}.`);
    }
    b.scheduleAuto(350);
  }

  root.pages = root.pages || {};
  root.pages.ppmNew = Object.freeze({ processFill, processSave, processAwaitSave });
})();
