(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { SUPPORTED_WORKBOOK_SCHEMAS } = root.data.fieldRegistry;

  function summarize(state) {
    const assets = state.assets || [];
    const allAssets = state.allAssets || assets;
    const invalidAssets = [];

    for (const record of assets) {
      const issues = globalThis.CAFMAssetRules?.validateRecord
        ? globalThis.CAFMAssetRules.validateRecord(record)
        : (!clean(record?.assetCode) ? ['Asset Code is blank'] : []);
      if (issues.length) invalidAssets.push({ assetCode: record.assetCode, workbookRow: record.workbookRow, issues });
    }

    const schema = clean(state.cache?.schema || '');
    const schemaWarnings = [];
    if (schema && !SUPPORTED_WORKBOOK_SCHEMAS.includes(schema)) {
      schemaWarnings.push(`Workbook schema "${schema}" is not in the list (${SUPPORTED_WORKBOOK_SCHEMAS.join(', ')})`);
    }

    const blocking = [];
    if (invalidAssets.length) blocking.push(`${invalidAssets.length} NEW asset row(s) failed validation`);

    return {
      assetCount: assets.length,
      editableAssetCount: allAssets.length,
      invalidAssets,
      schema,
      schemaWarnings,
      blocking
    };
  }

  function formatSummary(report) {
    const parts = [`${report.assetCount} NEW asset(s)`];
    if (report.invalidAssets.length) parts.push(`${report.invalidAssets.length} invalid asset row(s)`);
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
    return lines.join('\n');
  }

  root.data = root.data || {};
  root.data.preflight = Object.freeze({ summarize, formatSummary, formatPanelReport });
})();
