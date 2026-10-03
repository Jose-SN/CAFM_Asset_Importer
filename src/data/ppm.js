(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;

  function linkedForAsset(record, ppms = []) {
    if (!record) return [];
    return (ppms || [])
      .filter((ppm) => norm(ppm.assetCode) === norm(record.assetCode))
      .sort((a, b) => Number(a.workbookRow || 0) - Number(b.workbookRow || 0));
  }

  function currentFromList(record, ppms, ppmIndex = 0) {
    const list = linkedForAsset(record, ppms);
    const index = Math.max(0, Number(ppmIndex) || 0);
    return list[index] || null;
  }

  function sourceIssues(ppm) {
    const issues = [];
    if (!clean(ppm?.assetCode)) issues.push('PPM Asset Code is blank');
    if (!clean(ppm?.instruction)) issues.push('PPM Instruction is blank');
    const mins = ppm?.estTimeMinutes === '' ? 0 : Number(ppm?.estTimeMinutes);
    if (Number.isFinite(mins) && (mins < 0 || mins > 59)) issues.push('Est. Time Minutes must be 0-59');
    return issues;
  }

  function instructionCanon(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** True when this workbook PPM row was already saved/skipped for this asset in session or stored status. */
  function alreadyProcessed(record, ppm, auto = {}, statuses = {}) {
    if (!record || !ppm) return false;
    if (norm(record.assetCode) !== norm(ppm.assetCode)) return false;
    const key = clean(ppm.ppmKey);
    const merged = [
      ...(auto.ppmResults || []),
      ...(statuses[record.assetCode]?.ppmResults || [])
    ];
    return Boolean(key && merged.some((item) => clean(item.ppmKey) === key && ['saved', 'existing'].includes(clean(item.status))));
  }

  root.data = root.data || {};
  root.data.ppm = Object.freeze({ linkedForAsset, currentFromList, sourceIssues, instructionCanon, alreadyProcessed });
})();
