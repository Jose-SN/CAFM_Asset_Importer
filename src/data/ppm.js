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

  /**
   * One queue entry per distinct Asset Code on CAFM PPM Import (Import? = YES),
   * in first-seen sheet order. Multiple PPM rows for the same code → one asset step.
   */
  function assetQueueFromPpmImport(ppms = []) {
    const seen = new Set();
    const queue = [];
    for (const ppm of ppms || []) {
      const code = clean(ppm?.assetCode);
      if (!code) continue;
      const key = norm(code);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({
        assetCode: code,
        workbookRow: Number(ppm.workbookRow) || 0,
        description: '',
        ppmQueueSource: 'CAFM PPM Import'
      });
    }
    return queue;
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

  root.data = root.data || {};
  root.data.ppm = Object.freeze({
    linkedForAsset,
    assetQueueFromPpmImport,
    currentFromList,
    sourceIssues
  });
})();
