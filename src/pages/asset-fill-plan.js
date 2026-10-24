(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { lookupMapping, directMappings } = root.pages.assetMappings;
  const { assetProfileForRecord, resolveAssetTabOrder, shouldFillAssetNotes } = root.data.fillProfiles;

  /** @typedef {{ kind: 'direct', tab: string, label: string[], value: string, required?: boolean }} DirectFillStep */
  /** @typedef {{ kind: 'lookup', tab: string, field: string }} LookupFillStep */
  /** @typedef {{ kind: 'notes' }} NotesFillStep */

  function buildAssetFillPlan(record, options = {}) {
    const mappings = directMappings(record);
    const specs = lookupMapping(record);
    const profile = assetProfileForRecord(record);
    const lookupSequence = profile.assetLookupSequence;
    const tabOrder = resolveAssetTabOrder(record, options.settings || {});
    const steps = [];

    for (const tab of tabOrder) {
      const fields = mappings[tab] || [];
      const tabSpecs = lookupSequence
        .map((field) => specs.find((item) => item.field === field && item.tab === tab))
        .filter(Boolean);
      const hasDirect = fields.some((field) => clean(field.value) && !(options.skipAssetCode && field.label.some((label) => norm(label) === 'asset code')));
      const hasLookups = tabSpecs.length > 0;
      if (!hasDirect && !hasLookups) continue;

      for (const field of fields) {
        if (!clean(field.value)) continue;
        if (options.skipAssetCode && field.label.some((label) => norm(label) === 'asset code')) continue;
        steps.push({
          kind: 'direct',
          tab,
          label: field.label,
          value: String(field.value),
          required: Boolean(field.required)
        });
      }
      for (const spec of tabSpecs) {
        steps.push({ kind: 'lookup', tab, field: spec.field, spec });
      }
    }

    if (shouldFillAssetNotes(record, options.settings || {})) {
      steps.push({ kind: 'notes' });
    }
    return steps;
  }

  function fillPlanResumeIndex(auto, assetCode) {
    if (!auto || clean(auto.fillPlanAssetCode) !== clean(assetCode)) return 0;
    return Math.max(0, Number(auto.fillPlanStep) || 0);
  }

  root.pages = root.pages || {};
  root.pages.assetFillPlan = Object.freeze({
    buildAssetFillPlan,
    fillPlanResumeIndex
  });
})();
