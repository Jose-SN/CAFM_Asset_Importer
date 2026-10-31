(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, uniqueNonBlank } = root.core.text;
  const { wait, visible, isAssistantElement, elementValue, dispatchClick, clickAssetToolbarSaveAndNew, clickAssetToolbarSaveAndClose } = root.core.dom;
  const { makeLookupSpec, typeLookupSearchTerm } = root.core.lookupSpec;
  const { isPpmNewEntityPage, isPpmItemPage } = root.core.pages;
  const { currentFromList, linkedForAsset, alreadyProcessed } = root.data.ppm;
  const $ = () => root.runtime.b;

  const FORM_WAIT_MS = 4000;
  const FORM_POLL_MS = 150;
  const CONTRACT_INPUT = 'input[id*="FPPMGeneral_Editor_ContractAC_comboBox_Input"]';
  const INSTRUCTION_INPUT = 'input[id*="FPPMGeneral_Editor_InstructionAC_comboBox_Input"]';
  const LAST_SERVICE_INPUT = 'input[id*="FPPMGeneral_Editor_LastService_ctl00"]';
  const NOTES_TEXTAREA = 'textarea[id*="FPPMNotes_Editor_TextBoxNAME"]';

  function lookupSpec(field, value) {
    const term = typeLookupSearchTerm(value);
    return makeLookupSpec(field, value, {
      tab: 'General',
      display: value,
      description: value,
      searchTerms: uniqueNonBlank([term, value])
    });
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
    await b.clickTab('General');
    const input = document.querySelector(LAST_SERVICE_INPUT);
    const control = input instanceof HTMLInputElement && visible(input) && !isAssistantElement(input)
      ? input
      : b.nearestControl(['Last Service'])?.control;
    if (!control) throw new Error('Last Service date field was not found on the PPM form.');
    b.showFieldFill?.('Last Service', value, { meta: 'General tab', wait: false, duration: 2800, tick: false });
    if (!b.setNativeValue(control, value)) throw new Error(`Last Service could not be filled with ${value}.`);
    b.addEvent('ppm-field-filled', { field: 'Last Service', expected: value, actual: clean(elementValue(control)) });
  }

  function instructionCleared() {
    const el = document.querySelector(INSTRUCTION_INPUT);
    if (!(el instanceof HTMLInputElement)) return false;
    const value = clean(elementValue(el));
    return !value || /^no selection$/i.test(value);
  }

  function nextPpmIndex(record, afterIndex, auto, statuses) {
    const linked = linkedForAsset(record, $().state.ppms || []);
    for (let i = Math.max(0, afterIndex) + 1; i < linked.length; i += 1) {
      if (!alreadyProcessed(record, linked[i], auto, statuses)) return i;
    }
    return -1;
  }

  async function markPpmSaved(b, record, ppm, auto) {
    const entry = { status: 'saved', ppmKey: ppm.ppmKey || '', instruction: ppm.instruction || '' };
    const prev = b.state.session.statuses?.[record.assetCode]?.ppmResults || [];
    const merged = [...prev.filter((item) => clean(item.ppmKey) !== clean(entry.ppmKey)), entry];
    const autoResults = [...(auto.ppmResults || []).filter((item) => clean(item.ppmKey) !== clean(entry.ppmKey)), entry];
    b.state.session.auto = { ...b.state.session.auto, ppmResults: autoResults };
    await b.setStatus(record, b.statusOf(record) || 'found', `PPM saved: ${ppm.instruction || ppm.ppmKey}`, {
      cafmEntityId: auto.assetEntityId || b.state.session.statuses?.[record.assetCode]?.cafmEntityId || '',
      ppmResults: merged
    });
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

    const ppm = currentFromList(record, b.state.ppms, auto.ppmIndex);
    if (!ppm) throw new Error(`No workbook PPM row is queued for ${record.assetCode}.`);

    b.state.session.auto = { ...auto, phase: 'ppm_fill', ppmKey: ppm.ppmKey || auto.ppmKey || '', ppmInstruction: ppm.instruction || auto.ppmInstruction || '' };
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

    const more = nextPpmIndex(record, Number(b.state.session.auto.ppmIndex || 0), b.state.session.auto, b.state.session.statuses) >= 0;
    b.state.session.auto = {
      ...b.state.session.auto,
      phase: 'ppm_saving',
      ppmSaveAction: more ? 'save_and_new' : 'save_and_close',
      ppmSaveMenuStartedAt: 0
    };
    await b.persistSession();
    b.showToast(
      more
        ? `${record.assetCode}: fields filled. Save and New for the next PPM.`
        : `${record.assetCode}: fields filled. Save and Close for the last PPM.`,
      'info',
      6000
    );
    b.scheduleAuto(250);
  }

  async function processSave(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    if (!auto.active || auto.mode !== 'ppm') return;
    if (auto.phase !== 'ppm_saving' && auto.phase !== 'ppm_await_save') return;
    if (!isPpmItemPage()) return;

    const ppm = currentFromList(record, b.state.ppms, auto.ppmIndex);
    if (!ppm) throw new Error(`No workbook PPM row is queued for ${record.assetCode}.`);

    const validation = b.validationMessage();
    if (validation) throw new Error(validation);

    const more = nextPpmIndex(record, Number(auto.ppmIndex || 0), auto, b.state.session.statuses) >= 0;
    const action = auto.ppmSaveAction || (more ? 'save_and_new' : 'save_and_close');

    if (auto.phase === 'ppm_saving') {
      const click = action === 'save_and_new' ? clickAssetToolbarSaveAndNew() : clickAssetToolbarSaveAndClose();
      b.addEvent('ppm-save-click', {
        assetCode: record.assetCode,
        instruction: ppm.instruction || '',
        action,
        ok: Boolean(click.ok),
        pending: Boolean(click.pending),
        method: click.method || '',
        reason: click.reason || ''
      });
      if (!click.ok) {
        const started = Number(auto.ppmSaveMenuStartedAt || Date.now());
        if (!auto.ppmSaveMenuStartedAt) {
          b.state.session.auto = { ...auto, phase: 'ppm_saving', ppmSaveAction: action, ppmSaveMenuStartedAt: started };
          await b.persistSession();
        }
        if (Date.now() - started > Number(b.state.settings.lookupTimeoutMs || 8000)) {
          throw new Error(action === 'save_and_new'
            ? 'Save and New was not found on the PPM toolbar.'
            : 'Save and Close was not found on the PPM toolbar.');
        }
        b.showActivity?.(
          'Waiting',
          action === 'save_and_new' ? 'Save and New' : 'Save and Close',
          click.reason === 'opening-save-dropdown' ? 'Opening Save dropdown' : 'Waiting for the Save menu',
          { wait: true, meta: record.assetCode, tick: true }
        );
        b.scheduleAuto(350);
        return;
      }
      if (action === 'save_and_close') {
        await markPpmSaved(b, record, ppm, { ...auto, ppmSaveAction: action });
        b.state.session.auto = { ...b.state.session.auto, phase: 'wait_ppm', ppmSaveAction: '', saveStartedAt: 0, ppmSaveMenuStartedAt: 0 };
        await b.persistSession();
        b.showActivity?.('Waiting', 'Save and Close', 'Returning to the asset PPM list', { wait: true, meta: record.assetCode, tick: true });
        return;
      }

      b.state.session.auto = {
        ...auto,
        phase: 'ppm_await_save',
        ppmSaveAction: action,
        ppmSaveMenuStartedAt: 0,
        saveStartedAt: Date.now()
      };
      await b.persistSession();
      b.showActivity?.('Waiting', 'Save and New', ppm.instruction || record.assetCode, {
        wait: true,
        meta: record.assetCode,
        tick: true
      });
      b.scheduleAuto(400);
      return;
    }

    const started = Number(auto.saveStartedAt || Date.now());
    if (Date.now() - started > Number(b.state.settings.saveTimeoutMs || 20000)) {
      throw new Error('PPM save confirmation timed out.');
    }

    if (isPpmNewEntityPage() && instructionCleared()) {
      await markPpmSaved(b, record, ppm, b.state.session.auto || auto);
      const nextIndex = nextPpmIndex(record, Number(auto.ppmIndex || 0), b.state.session.auto, b.state.session.statuses);
      if (nextIndex < 0) {
        b.state.session.auto = { ...b.state.session.auto, phase: 'wait_ppm', ppmSaveAction: '', saveStartedAt: 0 };
        await b.persistSession();
        return;
      }
      const nextPpm = linkedForAsset(record, b.state.ppms || [])[nextIndex];
      b.state.session.auto = {
        ...b.state.session.auto,
        phase: 'wait_ppm_new',
        ppmIndex: nextIndex,
        ppmKey: nextPpm?.ppmKey || '',
        ppmInstruction: nextPpm?.instruction || '',
        ppmSaveAction: '',
        saveStartedAt: 0
      };
      await b.persistSession();
      b.scheduleAuto(300);
      return;
    }
    b.scheduleAuto(300);
  }

  root.pages = root.pages || {};
  root.pages.ppmNew = Object.freeze({ processFill, processSave });
})();
