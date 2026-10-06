(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { wait, visible, isAssistantElement, elementValue, dispatchClick, labelElements, allVisibleControls, setNativeValue } = root.core.dom;
  const { makeLookupSpec, splitLookupValue } = root.core.lookupSpec;
  const { ppmDirectMapping, ppmLookupMapping } = root.pages.ppmMappings;
  const {
    entityIdFromUrl,
    isPpmNewEntityPage,
    isSavedPpmPage,
    ppmListUrl
  } = root.core.pages;
  const $ = () => root.runtime.b;

  function fillEstimatedTime(ppm, meta = '') {
    const hours = clean(ppm?.estTimeHours);
    const minutes = clean(ppm?.estTimeMinutes);
    if (!hours && !minutes) return { status: 'blank', label: 'Est. Time' };
    const b = $();
    b.showFieldFill?.('Est. Time', `${hours || '0'}h ${minutes || '0'}m`, { meta, wait: false, duration: 2800, tick: false });
    const labels = labelElements(['Est. Time', 'Est Time', 'Estimated Time']);
    if (!labels.length) return { status: 'missing', label: 'Est. Time' };
    const label = labels[0];
    const lr = label.getBoundingClientRect();
    const lcy = lr.top + lr.height / 2;
    const inputs = allVisibleControls(document)
      .filter((el) => el instanceof HTMLInputElement)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return Math.abs((r.top + r.height / 2) - lcy) < 28 && r.left >= lr.right - 12 && r.left < lr.right + 300;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    if (inputs.length < 2) return { status: 'missing-inputs', label: 'Est. Time' };
    setNativeValue(inputs[0], hours || '0');
    setNativeValue(inputs[1], minutes || '0');
    return { status: 'filled', label: 'Est. Time' };
  }

  async function fillPpmFields(ppm) {
    const b = $();
    const results = [];
    const fillMeta = `PPM · ${ppm.ppmKey || b.currentRecord()?.assetCode || ''}`;
    await b.clickTab('General');
    for (const item of ppmDirectMapping(ppm)) {
      if (item.kind === 'checkbox' && item.value == null) continue;
      if (item.kind !== 'checkbox' && !clean(item.value)) continue;
      const fieldStart = performance.now();
      const fillOpts = { meta: fillMeta };
      let result;
      if (item.kind === 'checkbox') result = b.setCheckboxByLabel(item.label, Boolean(item.value), fillOpts);
      else if (item.kind === 'select') result = b.setSelectByLabel(item.label, item.value, fillOpts);
      else result = b.fillByLabel(item.label, item.value, fillOpts);
      results.push({ ...result, field: item.label[0], kind: item.kind });
      b.addEvent('ppm-field-fill', {
        ppmKey: ppm.ppmKey,
        field: item.label[0],
        expected: clean(item.value),
        status: result.status || '',
        actual: result.control ? clean(elementValue(result.control)) : '',
        durationMs: Math.round(performance.now() - fieldStart)
      });
      if (['missing', 'failed', 'missing-select', 'option-missing'].includes(result.status)) {
        await b.recordValidationWarning(b.currentRecord(), { scope: 'ppm', tab: 'General', field: item.label[0], expected: item.value, actual: '', reason: `Fill result: ${result.status}`, ppmKey: ppm.ppmKey });
      }
    }
    const timeResult = b.fillEstimatedTime(ppm, fillMeta);
    if (!['blank', 'filled'].includes(timeResult.status)) await b.recordValidationWarning(b.currentRecord(), { scope: 'ppm', tab: 'General', field: 'Estimated Time', expected: `${ppm.estTimeHours || ''}:${ppm.estTimeMinutes || ''}`, actual: '', reason: `Fill result: ${timeResult.status}`, ppmKey: ppm.ppmKey });
    for (const [month, enabled] of Object.entries(ppm.months || {})) {
      if (enabled == null) continue;
      const result = b.setCheckboxByLabel([month], Boolean(enabled), { meta: fillMeta });
      if (result.status === 'missing') continue;
      if (result.status !== 'filled') await b.recordValidationWarning(b.currentRecord(), { scope: 'ppm', tab: 'General', field: month, expected: String(Boolean(enabled)), actual: '', reason: `Checkbox result: ${result.status}`, ppmKey: ppm.ppmKey });
    }
    if (clean(ppm.notes)) {
      if (await b.clickTab('Notes')) {
        let result = b.fillByLabel(['Notes'], ppm.notes, { meta: `${fillMeta} · Notes tab` });
        if (result.status === 'missing') {
          const area = [...document.querySelectorAll('textarea')].find((el) => visible(el) && !isAssistantElement(el));
          if (!area || !b.setNativeValue(area, ppm.notes)) await b.recordValidationWarning(b.currentRecord(), { scope: 'ppm', tab: 'Notes', field: 'Notes', expected: ppm.notes, actual: area ? elementValue(area) : '', reason: 'Notes could not be filled', ppmKey: ppm.ppmKey });
        }
      }
    }
    await b.clickTab('General');
    return results;
  }

  async function fillPpmLookups(ppm) {
    const b = $();
    const evidence = [];
    for (const spec of ppmLookupMapping(ppm)) {
      const stepStart = performance.now();
      try {
        const result = await b.selectLookup(spec);
        evidence.push(result);
        const durationMs = Math.round(performance.now() - stepStart);
        b.addEvent('ppm-fill-step', {
          ppmKey: ppm.ppmKey,
          step: spec.field,
          kind: 'lookup',
          durationMs,
          selected: clean(result.selected || result.selectedText || ''),
          commitVerified: Boolean(result.commitVerified || result.alreadySelected || result.nativeSelect || result.hiddenCommitted)
        });
        b.addEvent('ppm-lookup-selected', {
          ppmKey: ppm.ppmKey,
          field: spec.field,
          expected: clean(spec.value || spec.display || ''),
          selected: clean(result.selected || result.selectedText || ''),
          commitVerified: Boolean(result.commitVerified || result.alreadySelected || result.nativeSelect || result.hiddenCommitted),
          durationMs
        });
      } catch (error) {
        b.addEvent('ppm-fill-step', {
          ppmKey: ppm.ppmKey,
          step: spec.field,
          kind: 'lookup',
          durationMs: Math.round(performance.now() - stepStart),
          status: 'error',
          reason: error.message || String(error)
        });
        await b.recordValidationWarning(b.currentRecord(), { scope: 'ppm', tab: spec.tab || 'General', field: spec.field, expected: spec.value || spec.display || '', actual: '', reason: error.message || String(error), ppmKey: ppm.ppmKey });
      }
      await wait(0);
    }
    return evidence;
  }

  async function fillFireDoorPpmExact(ppm) {
    const b = $();
    await b.clickTab('General');
    const contractSpec = makeLookupSpec('Contract', ppm.contract, { tab: 'General', description: splitLookupValue(ppm.contract).description });
    await b.selectLookup(contractSpec);
    await wait(0);
    const instructionSpec = makeLookupSpec('Instruction', ppm.instruction, {
      tab: 'General',
      description: ppm.instruction,
      searchTerms: [/fire\s+doors?/i.test(clean(ppm.instruction)) ? 'fire doors' : clean(ppm.instruction).split(/\s+/).slice(0, 2).join(' '), ppm.instruction]
    });
    await b.selectLookup(instructionSpec);
    await wait(0);
    const last = b.fillByLabel(['Last Service'], ppm.lastService, { meta: `PPM · ${ppm.ppmKey || ''}` });
    if (!last || ['missing', 'failed', 'readonly'].includes(last.status)) {
      throw new Error(`Fire-door PPM Last Service could not be entered (${last?.status || 'missing'}).`);
    }
    try {
      last.control?.dispatchEvent(new Event('change', { bubbles: true }));
      last.control?.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (_) {}
    await wait(0);
    const lastActual = clean(elementValue(last.control));
    if (lastActual && norm(lastActual) !== norm(ppm.lastService)) {
      throw new Error(`Fire-door PPM Last Service did not retain ${ppm.lastService} (shows ${lastActual}).`);
    }
    return [
      { field: 'Contract', selected: ppm.contract },
      { field: 'Instruction', selected: ppm.instruction },
      { field: 'Last Service', selected: ppm.lastService }
    ];
  }

  async function validatePpmPageBeforeSave(ppm) {
    const b = $();
    const errors = [];
    await b.clickTab('General');
    for (const spec of ppmLookupMapping(ppm)) {
      const found = b.nearestControl([spec.field]);
      if (!found) { errors.push(`${spec.field} dropdown missing`); continue; }
      const actual = elementValue(found.control);
      if (!b.lookupTextMatches(actual, spec)) errors.push(`${spec.field} is not selected from the CAFM dropdown`);
      const hidden = b.nearbyHiddenValues(found.control);
      if (hidden.length && !b.hiddenCommitted(found.control)) errors.push(`${spec.field} backing lookup ID is blank`);
    }
    if (clean(ppm?.lastService)) {
      const last = b.nearestControl(['Last Service']);
      const actual = clean(elementValue(last?.control));
      if (!last?.control) errors.push('Last Service field is missing');
      else if (norm(actual) !== norm(ppm.lastService)) errors.push(`Last Service is ${actual || 'blank'} instead of ${ppm.lastService}`);
    }
    return errors;
  }

  async function processPpmItemPage(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    if (['ppm_parent_refresh', 'ppm_parent_refresh_wait', 'ppm_cycle_complete_parent', 'ppm_cycle_general_wait'].includes(auto.phase)) {
      return;
    }

    const ppm = b.currentPpm(record);
    if (!ppm && auto.phase !== 'ppm_child_closing') {
      throw new Error(`No linked PPM row is available for ${record.assetCode}.`);
    }

    if (auto.phase === 'ppm_child_closing') {
      const currentId = entityIdFromUrl();
      if (currentId && currentId !== '-1') {
        b.scheduleAuto(300);
        return;
      }
      if (isPpmNewEntityPage() && ppm) {
        b.addEvent('ppm-child-closing-resume-save', { ppmKey: ppm.ppmKey, url: location.href });
        b.state.session.auto = { ...auto, phase: 'ppm_fill', ppmSaveStartedAt: 0, ppmSaveMethod: '' };
        await b.persistSession();
        b.scheduleAuto(150);
        return;
      }
      b.scheduleAuto(300);
      return;
    }

    if (!ppm) throw new Error(`No linked PPM row is available for ${record.assetCode}.`);

    const ppmEntityId = entityIdFromUrl();
    if (ppmEntityId && ppmEntityId !== '-1') {
      if (auto.phase === 'ppm_await_save') {
        await b.recordPpmResult(record, ppm, 'saved', 'CAFM PPM entity page detected after Save', ppmEntityId);
      } else {
        b.state.session.auto = { ...auto, phase: 'ppm_open_list' };
        await b.persistSession();
        const ppmNav = b.findAssetPpmNavLink?.();
        if (ppmNav) {
          dispatchClick(ppmNav, false);
          b.scheduleAuto(900);
        } else {
          location.href = ppmListUrl(auto.assetEntityId);
        }
      }
      return;
    }

    if (!isPpmNewEntityPage()) throw new Error(`Expected a New PPM page for ${record.assetCode}.`);
    const issues = b.ppmSourceIssues(ppm);
    if (issues.length) throw new Error(`PPM ${ppm.ppmKey} cannot be imported: ${issues.join('; ')}`);

    if (['ppm_wait_new', 'ppm_wait_user_new', 'ppm_open_list', 'ppm_next'].includes(auto.phase)) {
      b.state.session.auto = { ...auto, phase: 'ppm_fill' };
      await b.persistSession();
      b.scheduleAuto(100);
      return;
    }

    if (auto.phase === 'ppm_fill') {
      root.core.events.markRunStart();
      const fillStart = performance.now();
      b.showActivity?.('Creating PPM', record.assetCode, ppm.instruction, { wait: true, meta: ppm.ppmKey, tick: true });
      await fillPpmLookups(ppm);
      b.showActivity?.('Filling PPM', 'Remaining fields', ppm.instruction, { wait: true, meta: record.assetCode, tick: true });
      await fillPpmFields(ppm);
      b.addEvent('ppm-fill-complete', {
        ppmKey: ppm.ppmKey,
        instruction: ppm.instruction,
        durationMs: Math.round(performance.now() - fillStart)
      });
      const errors = await validatePpmPageBeforeSave(ppm);
      if (errors.length) {
        for (const problem of errors) await b.recordValidationWarning(record, { scope: 'ppm', field: 'Pre-save audit', expected: 'Excel-backed value committed', actual: '', reason: problem, ppmKey: ppm.ppmKey });
        b.addEvent('ppm-pre-save-warning-summary', { ppmKey: ppm.ppmKey, warningCount: errors.length, warnings: errors });
      }
      const linked = b.linkedPpms(record);
      const nextIndex = (Number(auto.ppmIndex) || 0) + 1;
      const tentativeNextPhase = nextIndex < linked.length ? 'ppm_next' : 'ppm_cycle_complete_parent';
      const canSaveAndClose = Boolean(
        (typeof Toolbar !== 'undefined' && typeof Toolbar.SaveAndClose === 'function')
        || document.querySelector('a[onclick*="Toolbar.SaveAndClose"], a[title*="Save and Close" i]')
      );

      if (canSaveAndClose) {
        b.showActivity?.('Clicking', 'PPM Save and Close', ppm.instruction, { wait: false, meta: `${record.assetCode} · PPM ${(Number(auto.ppmIndex) || 0) + 1}/${linked.length}`, duration: 2800, tick: false });
        const handoff = await b.commitPpmSaveHandoff?.(record, ppm, 'PPM Save and Close clicked');
        try {
          await b.runtimeMessage({
            type: 'PPM_PREPARE_CLOSE',
            assetCode: record.assetCode,
            assetEntityId: String(auto.assetEntityId || ''),
            nextPhase: handoff?.afterPhase || tentativeNextPhase,
            afterRefreshPhase: handoff?.afterPhase || tentativeNextPhase
          });
        } catch (_) {}
        const saveClose = b.clickSaveAndClose?.() || { ok: false };
        const saveMethod = saveClose.ok ? saveClose.method : 'save-only';
        if (!saveClose.ok) throw new Error(`CAFM PPM Save and Close was not detected for ${ppm.ppmKey}.`);
        b.addEvent('ppm-save-click', { ppmKey: ppm.ppmKey, method: saveMethod, handoff: true });
        b.state.session.auto = {
          ...b.state.session.auto,
          phase: 'ppm_await_save',
          ppmSaveStartedAt: Date.now(),
          ppmSaveMethod: saveMethod
        };
        await b.persistSession();
        b.scheduleAuto(0);
        return;
      }

      try {
        await b.runtimeMessage({
          type: 'PPM_PREPARE_CLOSE',
          assetCode: record.assetCode,
          assetEntityId: String(auto.assetEntityId || ''),
          nextPhase: tentativeNextPhase,
          afterRefreshPhase: tentativeNextPhase
        });
      } catch (_) {}

      const save = b.findSaveButton();
      if (!save) throw new Error(`CAFM PPM Save button was not detected for ${ppm.ppmKey}.`);
      b.showActivity?.('Clicking', 'PPM Save', ppm.instruction, { wait: true, meta: record.assetCode, tick: true });
      dispatchClick(save, false);
      b.addEvent('ppm-save-click', { ppmKey: ppm.ppmKey, method: saveMethod });
      b.state.session.auto = {
        ...b.state.session.auto,
        phase: 'ppm_await_save',
        ppmSaveStartedAt: Date.now(),
        ppmSaveMethod: saveMethod
      };
      await b.persistSession();
      b.scheduleAuto(0);
      return;
    }

    if (auto.phase === 'ppm_await_save') {
      const validation = b.validationMessage();
      if (validation) throw new Error(`CAFM did not save PPM ${ppm.ppmKey}: ${validation}`);
      const savedEntityId = entityIdFromUrl();
      if (savedEntityId && savedEntityId !== '-1') {
        await b.recordPpmResult(record, ppm, 'saved', 'CAFM PPM entity page detected after Save', savedEntityId);
        return;
      }
      const elapsed = Date.now() - Number(auto.ppmSaveStartedAt || Date.now());
      const saveTimeoutMs = document.hidden
        ? Math.max(Number(b.state.settings.backgroundSaveTimeoutMs) || 0, Number(b.state.settings.saveTimeoutMs) * 3)
        : Number(b.state.settings.saveTimeoutMs);
      if (elapsed > saveTimeoutMs) throw new Error(`PPM save confirmation timed out for ${ppm.ppmKey}.`);
      b.scheduleAuto(0);
      return;
    }

    b.state.session.auto = { ...auto, phase: 'ppm_fill' };
    await b.persistSession();
    b.scheduleAuto(100);
  }

  root.pages = root.pages || {};
  root.pages.ppmEditor = Object.freeze({
    fillEstimatedTime,
    fillPpmFields,
    fillPpmLookups,
    fillFireDoorPpmExact,
    validatePpmPageBeforeSave,
    processPpmItemPage
  });
})();
