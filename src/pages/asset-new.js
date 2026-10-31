(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { wait, visible, isAssistantElement, elementValue, dispatchClick } = root.core.dom;
  const { isNewEntityPage } = root.core.pages;
  const { lookupMapping, valueEquivalent } = root.pages.assetMappings;
  const { buildAssetFillPlan, fillPlanResumeIndex } = root.pages.assetFillPlan;
  const $ = () => root.runtime.b;

  function findAssetNotesTextarea() {
    const selectors = [
      'textarea[id*="FASSETNotes_Editor_TextBoxAR_COMMENTS"]',
      'textarea[name*="TextBoxAR_COMMENTS"]',
      'textarea[name*="AR_COMMENTS"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLTextAreaElement && visible(el) && !isAssistantElement(el)) return el;
    }
    return null;
  }

  function findAssetNotesTab() {
    const tabs = [...document.querySelectorAll('span.ajax__tab_tab, a.ajax__tab_tab, [role="tab"]')]
      .filter((el) => visible(el) && !isAssistantElement(el) && norm(el.textContent) === 'notes');
    const preferred = tabs.find((el) => /FASSETEditor|TabContainer|TabPanel1/i.test(`${el.id || ''}`));
    return preferred || tabs[0] || null;
  }

  async function openAssetNotesTab() {
    if (findAssetNotesTextarea()) return true;
    const tab = findAssetNotesTab();
    if (!tab) return false;
    const clickable = tab.closest('a') || tab;
    try {
      if (typeof clickable.click === 'function') clickable.click();
      else dispatchClick(clickable, false, 'Notes');
    } catch (_) {
      dispatchClick(clickable, false, 'Notes');
    }
    const deadline = Date.now() + 2600;
    while (Date.now() < deadline) {
      await wait(0);
      if (findAssetNotesTextarea()) return true;
    }
    return Boolean(findAssetNotesTextarea());
  }

  async function persistAutoFillCursor(record, stepIndex) {
    const b = $();
    const auto = b.state.session.auto;
    if (!auto || auto.mode !== 'automatic') return;
    auto.fillPlanStep = Math.max(0, Number(stepIndex) || 0);
    auto.fillPlanAssetCode = record.assetCode;
    await b.persistSession();
  }

  async function fillAssetFieldsByTab(record, options = {}) {
    const b = $();
    const directResults = [];
    let lookupEvidence = [...(b.state.session.currentLookupEvidence || [])];
    const settings = b.state.settings || {};
    const plan = buildAssetFillPlan(record, { skipAssetCode: options.skipAssetCode, settings });
    const autoPauseRequested = () => options.respectAutoPause && b.state.session.auto && !b.state.session.auto.active;

    let startIndex = 0;
    if (options.respectAutoPause) {
      startIndex = fillPlanResumeIndex(b.state.session.auto, record.assetCode);
      if (startIndex === 0) {
        await persistAutoFillCursor(record, 0);
      }
    }

    let activeTab = '';

    for (let stepIndex = startIndex; stepIndex < plan.length; stepIndex += 1) {
      const step = plan[stepIndex];
      if (autoPauseRequested()) {
        await persistAutoFillCursor(record, stepIndex);
        return { direct: directResults, lookups: lookupEvidence, cancelled: true };
      }

      if (step.kind === 'notes') {
        if (!(await openAssetNotesTab())) throw new Error('Notes tab could not be opened.');
        b.showFieldFill?.('Notes', String(record.comments).slice(0, 2000), { meta: `Notes tab · ${record.assetCode}`, wait: false, duration: 2800, tick: false });
        let textarea = findAssetNotesTextarea();
        if (!textarea) {
          await b.recordValidationWarning(record, { scope: 'asset', tab: 'Notes', field: 'Notes', expected: String(record.comments).slice(0, 2000), actual: '', reason: 'Notes text area was not detected' });
        } else if (!b.setNativeValue(textarea, String(record.comments).slice(0, 2000))) {
          await b.recordValidationWarning(record, { scope: 'asset', tab: 'Notes', field: 'Notes', expected: String(record.comments).slice(0, 2000), actual: elementValue(textarea), reason: 'Notes could not be filled' });
        } else {
          try {
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
          } catch (_) {}
          b.addEvent('asset-field-filled', { tab: 'Notes', field: 'Notes', expected: clean(record.comments).slice(0, 2000), actual: clean(elementValue(textarea)), status: 'filled' });
          directResults.push({ tab: 'Notes', status: 'filled', label: 'Notes', expected: String(record.comments).slice(0, 2000), control: textarea });
        }
        await persistAutoFillCursor(record, stepIndex + 1);
        continue;
      }

      if (step.tab !== activeTab) {
        if (!(await b.clickTab(step.tab))) throw new Error(`${step.tab} tab could not be opened.`);
        activeTab = step.tab;
      }

      if (step.kind === 'direct') {
        const result = b.fillByLabel(step.label, step.value, { tab: `${step.tab} tab`, meta: `${step.tab} tab · ${record.assetCode}` });
        directResults.push({ tab: step.tab, ...result, expected: step.value, required: Boolean(step.required) });
        if (['missing', 'readonly', 'failed'].includes(result.status)) {
          await b.recordValidationWarning(record, { scope: 'asset', tab: step.tab, field: step.label[0], expected: step.value, actual: '', reason: `Fill result: ${result.status}` });
        } else {
          const actual = elementValue(result.control);
          if (!valueEquivalent(actual, step.value)) {
            await b.recordValidationWarning(record, { scope: 'asset', tab: step.tab, field: step.label[0], expected: step.value, actual, reason: 'Value did not remain in CAFM field' });
          } else {
            b.addEvent('asset-field-filled', { tab: step.tab, field: step.label[0], expected: clean(step.value), actual: clean(actual), status: result.status || 'filled' });
          }
        }
        await persistAutoFillCursor(record, stepIndex + 1);
        await wait(0);
        continue;
      }

      if (step.kind === 'lookup') {
        const spec = step.spec;
        try {
          if (b.state.settings?.lookupStepDebug) {
            console.log('[CAFM fill] lookup section start', {
              tab: step.tab,
              field: spec.field,
              cafmValue: spec.display || spec.value,
              assetCode: record.assetCode,
              stepIndex
            });
            debugger;
          }
          const result = await b.selectLookup(spec);
          lookupEvidence = lookupEvidence.filter((item) => item.field !== spec.field);
          lookupEvidence.push(result);
          b.state.session.currentLookupEvidence = lookupEvidence;
          b.addEvent('asset-lookup-selected', {
            tab: step.tab,
            field: spec.field,
            expected: clean(spec.value || spec.display || ''),
            selected: clean(result.selected || result.selectedText || ''),
            commitVerified: Boolean(result.commitVerified || result.alreadySelected || result.nativeSelect || result.hiddenCommitted)
          });
          await persistAutoFillCursor(record, stepIndex + 1);
        } catch (error) {
          if (autoPauseRequested() || /paused/i.test(String(error?.message || error))) {
            await persistAutoFillCursor(record, stepIndex);
            return { direct: directResults, lookups: lookupEvidence, cancelled: true };
          }
          await b.recordValidationWarning(record, { scope: 'asset', tab: step.tab, field: spec.field, expected: spec.value || spec.display || '', actual: '', reason: error.message || String(error) });
          await persistAutoFillCursor(record, stepIndex + 1);
        }
        await wait(0);
      }
    }

    if (options.respectAutoPause && b.state.session.auto) {
      b.state.session.auto.fillPlanStep = plan.length;
      b.state.session.auto.fillPlanAssetCode = record.assetCode;
      await b.persistSession();
    }

    return { direct: directResults, lookups: lookupEvidence };
  }

  async function verifyBeforeSave(record) {
    const b = $();
    const problems = [];

    for (const spec of lookupMapping(record)) {
      const evidence = (b.state.session.currentLookupEvidence || []).find((item) => item.field === spec.field);
      if (!evidence) {
        problems.push(`${spec.field} selection evidence is missing`);
        continue;
      }
      const selectedText = clean(evidence.selected || evidence.selectedText || '');
      if (selectedText && !b.lookupTextMatches(selectedText, spec)) {
        problems.push(`${spec.field} does not match the workbook value`);
      }
      if (!evidence.commitVerified && !evidence.alreadySelected && !evidence.nativeSelect && !evidence.hiddenCommitted) {
        problems.push(`${spec.field} selection could not be proven as committed`);
      }
    }

    if (b.tabContextReady('Details')) {
      for (const field of [
        { labels: ['Asset Code'], value: record.assetCode, label: 'Asset Code' },
        { labels: ['Description'], value: record.description, label: 'Description' },
        { labels: ['Qty', 'Quantity'], value: record.quantity, label: 'Qty' }
      ]) {
        if (!clean(field.value)) continue;
        const found = b.nearestControl(field.labels);
        if (!found) problems.push(`${field.label} control missing`);
        else if (!valueEquivalent(elementValue(found.control), field.value)) problems.push(`${field.label} does not match workbook`);
      }
    }

    if (problems.length) {
      for (const problem of problems) {
        await b.recordValidationWarning(record, { scope: 'asset', field: 'Pre-save audit', expected: 'Excel-backed value committed', actual: '', reason: problem });
      }
      b.addEvent('asset-pre-save-warning-summary', { warningCount: problems.length, warnings: problems });
    }
    return problems;
  }

  function clearAutoFillCursor() {
    const b = $();
    const auto = b.state.session.auto;
    if (!auto) return;
    auto.fillPlanStep = 0;
    auto.fillPlanAssetCode = '';
  }

  async function fillCurrentRecord(options = {}) {
    const b = $();
    const record = b.currentRecord();
    if (!record) throw new Error('No current asset row is loaded.');
    const issues = globalThis.CAFMAssetRules.validateRecord(record);
    if (issues.length) throw new Error(`Workbook row ${record.workbookRow}: ${issues.join('; ')}`);
    if (!isNewEntityPage()) throw new Error('Open the Asset New Entity page before filling a record.');

    const resumingAutoFill = Boolean(
      options.respectAutoPause
      && fillPlanResumeIndex(b.state.session.auto, record.assetCode) > 0
    );
    if (!resumingAutoFill) {
      b.state.session.currentLookupEvidence = [];
      if (options.respectAutoPause) clearAutoFillCursor();
    }

    await b.persistSession();
    b.showActivity?.('Filling', record.assetCode, resumingAutoFill ? 'Resuming workbook fill from last step' : 'Reading workbook fields into CAFM tabs', { wait: true, meta: `Row ${record.workbookRow}`, tick: true });
    const filled = await fillAssetFieldsByTab(record, { respectAutoPause: Boolean(options.respectAutoPause) });
    if (filled.cancelled) {
      root.ui.progressToast.stopTick?.();
      return { direct: filled.direct, lookups: filled.lookups, cancelled: true };
    }
    await wait(0);
    await verifyBeforeSave(record);
    b.state.session.manualAwaitSave = {
      index: b.state.session.index,
      assetCode: record.assetCode,
      armedAt: Date.now(),
      source: 'filled-manual-save',
      lookupEvidence: b.state.session.currentLookupEvidence || []
    };
    if (options.respectAutoPause) clearAutoFillCursor();
    await b.persistSession();
    if (!options.respectAutoPause) {
      b.showToast(`${record.assetCode} is fully filled. Save it normally; after CAFM confirms the save, the importer will change the asset to ACTIVE.`, 'success', 9000);
    }
    return { direct: filled.direct, lookups: filled.lookups };
  }

  root.pages = root.pages || {};
  root.pages.assetNew = Object.freeze({ fillAssetFieldsByTab, verifyBeforeSave, fillCurrentRecord, clearAutoFillCursor });
})();
