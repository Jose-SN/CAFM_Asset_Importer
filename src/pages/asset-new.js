(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { wait, visible, isAssistantElement, elementValue } = root.core.dom;
  const { isNewEntityPage } = root.core.pages;
  const { lookupMapping, directMappings, valueEquivalent } = root.pages.assetMappings;
  const { assetProfileForRecord, resolveAssetTabOrder, shouldFillAssetNotes } = root.data.fillProfiles;
  const $ = () => root.runtime.b;

  async function fillAssetFieldsByTab(record, options = {}) {
    const b = $();
    const directResults = [];
    const lookupEvidence = [];
    const mappings = directMappings(record);
    const specs = lookupMapping(record);
    const profile = assetProfileForRecord(record);
    const lookupSequence = profile.assetLookupSequence;
    const tabOrder = resolveAssetTabOrder(record, b.state.settings || {});

    for (const tab of tabOrder) {
      const fields = mappings[tab] || [];
      const tabSpecs = lookupSequence
        .map((field) => specs.find((item) => item.field === field && item.tab === tab))
        .filter(Boolean);
      const hasDirect = fields.some((field) => clean(field.value) && !(options.skipAssetCode && field.label.some((label) => norm(label) === 'asset code')));
      const hasLookups = tabSpecs.length > 0;
      if (!hasDirect && !hasLookups) continue;

      if (!(await b.clickTab(tab))) throw new Error(`${tab} tab could not be opened.`);

      for (const field of fields) {
        if (!clean(field.value)) continue;
        if (options.skipAssetCode && field.label.some((label) => norm(label) === 'asset code')) continue;
        const result = b.fillByLabel(field.label, field.value, { tab: `${tab} tab`, meta: `${tab} tab · ${record.assetCode}` });
        directResults.push({ tab, ...result, expected: String(field.value), required: Boolean(field.required) });
        if (['missing', 'readonly', 'failed'].includes(result.status)) {
          await b.recordValidationWarning(record, { scope: 'asset', tab, field: field.label[0], expected: field.value, actual: '', reason: `Fill result: ${result.status}` });
          continue;
        }
        const actual = elementValue(result.control);
        if (!valueEquivalent(actual, field.value)) {
          await b.recordValidationWarning(record, { scope: 'asset', tab, field: field.label[0], expected: field.value, actual, reason: 'Value did not remain in CAFM field' });
        } else {
          b.addEvent('asset-field-filled', { tab, field: field.label[0], expected: clean(field.value), actual: clean(actual), status: result.status || 'filled' });
        }
      }

      for (const spec of tabSpecs) {
        try {
          const result = await b.selectLookup(spec);
          lookupEvidence.push(result);
          b.state.session.currentLookupEvidence = lookupEvidence;
          b.addEvent('asset-lookup-selected', { tab, field: spec.field, expected: clean(spec.value || spec.display || ''), selected: clean(result.selected || result.selectedText || ''), commitVerified: Boolean(result.commitVerified || result.alreadySelected || result.nativeSelect || result.hiddenCommitted) });
          await b.persistSession();
        } catch (error) {
          await b.recordValidationWarning(record, { scope: 'asset', tab, field: spec.field, expected: spec.value || spec.display || '', actual: '', reason: error.message || String(error) });
        }
        await wait(0);
      }
    }

    if (shouldFillAssetNotes(record, b.state.settings || {})) {
      if (!(await b.clickTab('Notes'))) throw new Error('Notes tab could not be opened.');
      b.showFieldFill?.('Notes', String(record.comments).slice(0, 2000), { meta: `Notes tab · ${record.assetCode}`, wait: false, duration: 2800, tick: false });
      let textarea = b.nearestControl(['Notes'])?.control;
      if (!(textarea instanceof HTMLTextAreaElement)) {
        textarea = [...document.querySelectorAll('textarea')].find((el) => visible(el) && !isAssistantElement(el));
      }
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

  async function fillCurrentRecord() {
    const b = $();
    const record = b.currentRecord();
    if (!record) throw new Error('No current asset row is loaded.');
    const issues = globalThis.CAFMAssetRules.validateRecord(record);
    if (issues.length) throw new Error(`Workbook row ${record.workbookRow}: ${issues.join('; ')}`);
    if (!isNewEntityPage()) throw new Error('Open the Asset New Entity page before filling a record.');

    b.state.session.currentLookupEvidence = [];
    await b.persistSession();
    b.showActivity?.('Filling', record.assetCode, 'Reading workbook fields into CAFM tabs', { wait: true, meta: `Row ${record.workbookRow}`, tick: true });
    const filled = await fillAssetFieldsByTab(record);
    await wait(0);
    await verifyBeforeSave(record);
    b.state.session.manualAwaitSave = {
      index: b.state.session.index,
      assetCode: record.assetCode,
      armedAt: Date.now(),
      source: 'filled-manual-save',
      lookupEvidence: b.state.session.currentLookupEvidence || []
    };
    await b.persistSession();
    b.showToast(`${record.assetCode} is fully filled. Save it normally; after CAFM confirms the save, the importer will change the asset to ACTIVE and add any enabled linked PPM rows.`, 'success', 9000);
    return { direct: filled.direct, lookups: filled.lookups };
  }

  root.pages = root.pages || {};
  root.pages.assetNew = Object.freeze({ fillAssetFieldsByTab, verifyBeforeSave, fillCurrentRecord });
})();
