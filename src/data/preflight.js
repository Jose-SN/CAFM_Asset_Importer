(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { SUPPORTED_WORKBOOK_SCHEMAS } = root.data.fieldRegistry;

  function summarize(state) {
    const assets = state.assets || [];
    const allAssets = state.allAssets || assets;
    const ppms = state.ppms || [];
    const assetCodes = new Set(allAssets.map((row) => norm(row?.assetCode)).filter(Boolean));
    const invalidAssets = [];
    const orphanPpms = [];
    const ppmLinks = new Map();

    for (const record of assets) {
      const issues = globalThis.CAFMAssetRules?.validateRecord
        ? globalThis.CAFMAssetRules.validateRecord(record)
        : (!clean(record?.assetCode) ? ['Asset Code is blank'] : []);
      if (issues.length) invalidAssets.push({ assetCode: record.assetCode, workbookRow: record.workbookRow, issues });
    }

    for (const ppm of ppms) {
      const code = norm(ppm?.assetCode);
      if (!code) continue;
      ppmLinks.set(code, (ppmLinks.get(code) || 0) + 1);
      if (!assetCodes.has(code)) orphanPpms.push({ assetCode: ppm.assetCode, workbookRow: ppm.workbookRow, instruction: ppm.instruction });
    }

    const zeroPpmAssets = assets.filter((record) => !ppmLinks.has(norm(record.assetCode))).length;
    const multiPpmAssets = [...ppmLinks.values()].filter((count) => count > 1).length;
    const schema = clean(state.cache?.schema || '');
    const schemaWarnings = [];
    if (schema && !SUPPORTED_WORKBOOK_SCHEMAS.includes(schema)) {
      schemaWarnings.push(`Workbook schema "${schema}" is not in the supported list (${SUPPORTED_WORKBOOK_SCHEMAS.join(', ')})`);
    }

    const blocking = [];
    if (invalidAssets.length) blocking.push(`${invalidAssets.length} NEW asset row(s) failed validation`);

    return {
      assetCount: assets.length,
      editableAssetCount: allAssets.length,
      ppmCount: ppms.length,
      invalidAssets,
      orphanPpms,
      zeroPpmAssets,
      multiPpmAssetCount: multiPpmAssets,
      schema,
      schemaWarnings,
      blocking
    };
  }

  function formatSummary(report) {
    const parts = [
      `${report.assetCount} NEW asset(s)`,
      `${report.ppmCount} enabled PPM(s)`,
      `${report.zeroPpmAssets} asset(s) with 0 PPM`
    ];
    if (report.invalidAssets.length) parts.push(`${report.invalidAssets.length} invalid asset row(s)`);
    if (report.orphanPpms.length) parts.push(`${report.orphanPpms.length} orphan PPM row(s)`);
    if (report.schema) parts.push(`schema ${report.schema}`);
    return parts.join(' | ');
  }

  function formatPanelReport(report) {
    const lines = [formatSummary(report)];
    if (report.schemaWarnings?.length) lines.push(...report.schemaWarnings);
    if (report.invalidAssets?.length) {
      lines.push(...report.invalidAssets.slice(0, 5).map((row) => `Row ${row.workbookRow} (${row.assetCode}): ${row.issues.join('; ')}`));
      if (report.invalidAssets.length > 5) lines.push(`…and ${report.invalidAssets.length - 5} more invalid row(s)`);
    }
    if (report.orphanPpms?.length) {
      lines.push(...report.orphanPpms.slice(0, 3).map((row) => `Orphan PPM row ${row.workbookRow}: ${row.assetCode} / ${row.instruction || 'no instruction'}`));
      if (report.orphanPpms.length > 3) lines.push(`…and ${report.orphanPpms.length - 3} more orphan PPM row(s)`);
    }
    return lines.join('\n');
  }

  root.data = root.data || {};
  root.data.preflight = Object.freeze({ summarize, formatSummary, formatPanelReport });
})();
