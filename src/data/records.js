(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { visible, isAssistantElement, elementValue } = root.core.dom;
  const { isAssetPage, isSavedAssetPage, isPpmListPage, entityIdFromUrl } = root.core.pages;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;
  function configure(deps) { cfg = Object.freeze({ ...deps }); }
  function C() {
    if (!cfg) throw new Error('CAFMImporter records module is not configured yet.');
    return cfg;
  }

function currentRecord() {
  return C().state.assets[C().state.session.index] || null;
}

function assetCodeOnPage() {
  if (!isAssetPage()) return '';
  const field = C().nearestControl(['Asset Code']);
  const direct = clean(field?.control ? elementValue(field.control) : '');
  if (direct) return direct;
  const candidates = [...document.querySelectorAll('h1,h2,h3,a,span,div')]
    .filter((el) => visible(el) && !isAssistantElement(el))
    .map((el) => clean(el.textContent))
    .filter((text) => text && text.length < 180);
  for (const text of candidates) {
    const match = text.match(/^([A-Z0-9]+(?:-[A-Z0-9_.\/]+){2,})\s+-\s+/i);
    if (match) return clean(match[1]);
  }
  return '';
}

function workflowAssetCodeOnPage() {
  const assetCode = assetCodeOnPage();
  if (assetCode && recordByAssetCode(assetCode)) return recordByAssetCode(assetCode).assetCode;

  const pool = C().state.allAssets.length ? C().state.allAssets : C().state.assets;
  const knownCodes = pool.map((record) => clean(record?.assetCode)).filter(Boolean);
  const sources = [
    clean(document.title || ''),
    ...[...document.querySelectorAll('h1,h2,h3,h4,a,strong,b,span,div')]
      .filter((el) => visible(el) && !isAssistantElement(el))
      .map((el) => clean(el.textContent))
      .filter((text) => text && text.length < 260),
    clean(document.body?.innerText || '')
  ].filter(Boolean);

  // First use the workbook itself as the dictionary. This safely handles
  // suffixes such as 0016A, where a shorter code (0016) is also a valid
  // asset. Longest exact visible code wins.
  for (const source of sources) {
    const lower = source.toLowerCase();
    const matches = knownCodes
      .filter((code) => lower.includes(code.toLowerCase()))
      .sort((a, b) => b.length - a.length);
    if (matches.length) return matches[0];
  }

  // Then parse obvious WCH asset-code tokens and resolve them back to the
  // workbook. This covers PPM-register headings and document titles even if
  // their surrounding DOM changes.
  for (const source of sources) {
    const tokens = source.match(/\bWCH(?:-[A-Z0-9_.\/]+){3,}\b/ig) || [];
    for (const token of tokens.sort((a, b) => b.length - a.length)) {
      const record = recordByAssetCode(token);
      if (record) return record.assetCode;
    }
  }

  // Last-resort identity mapping: on the PPM register the URL id is the
  // saved Asset entity id. If that id was recorded when the asset was saved,
  // use it to re-bind the workbook row even when the heading DOM is unusual.
  const entityId = entityIdFromUrl();
  if (entityId) {
    for (const record of pool) {
      const savedId = clean(C().state.session.statuses?.[record.assetCode]?.cafmEntityId || '');
      if (savedId && savedId === clean(entityId)) return record.assetCode;
    }
    const autoCode = clean(C().state.session.auto?.assetCode || '');
    const autoId = clean(C().state.session.auto?.assetEntityId || '');
    if (autoCode && autoId && autoId === clean(entityId) && recordByAssetCode(autoCode)) return recordByAssetCode(autoCode).assetCode;
  }

  return '';
}

function recordByAssetCode(assetCode) {
  const code = clean(assetCode);
  if (!code) return null;
  const pool = C().state.allAssets.length ? C().state.allAssets : C().state.assets;
  return pool.find((record) => norm(record?.assetCode) === norm(code)) || null;
}

function ppmRecordOnCurrentPage() {
  if (!isPpmListPage()) return null;
  const byVisibleCode = recordByAssetCode(workflowAssetCodeOnPage());
  if (byVisibleCode) return byVisibleCode;

  const entityId = clean(entityIdFromUrl());
  const pool = C().state.allAssets.length ? C().state.allAssets : C().state.assets;
  if (entityId) {
    const bySavedId = pool.find((record) => clean(C().state.session.statuses?.[record.assetCode]?.cafmEntityId || '') === entityId);
    if (bySavedId) return bySavedId;
    const auto = C().state.session.auto || {};
    if (clean(auto.assetEntityId) === entityId) {
      const byAuto = recordByAssetCode(auto.assetCode);
      if (byAuto) return byAuto;
    }
  }

  // Safe final fallback for a manually opened PPM page: only reuse the
  // current workbook row if its exact Asset Code is visibly present in the
  // PPM page title/body. This avoids silently applying PPMs to another asset.
  const current = currentRecord();
  const currentCode = clean(current?.assetCode || '');
  const pageText = `${clean(document.title || '')} ${clean(document.body?.innerText || '')}`.toLowerCase();
  if (currentCode && pageText.includes(currentCode.toLowerCase())) return current;
  return null;
}

function workflowRecord(auto = C().state.session.auto) {
  const byCode = recordByAssetCode(auto?.assetCode);
  return byCode || currentRecord();
}

function recordForCurrentSavedAsset() {
  if (!isSavedAssetPage()) throw new Error('Open a saved Asset record before using Edit Existing Asset.');
  const code = assetCodeOnPage();
  if (!code) throw new Error('The saved Asset Code could not be read from this page.');
  const editPool = C().state.allAssets.length ? C().state.allAssets : C().state.assets;
  const matches = editPool
    .map((record, index) => ({ record, index }))
    .filter((item) => norm(item.record?.assetCode) === norm(code));
  if (!matches.length) throw new Error(`${code} was not found in the loaded CAFM Import sheet. Keep the asset row in the workbook and load that workbook before editing.`);
  if (matches.length > 1) throw new Error(`${code} appears more than once in the loaded CAFM Import sheet. Remove the duplicate workbook row before editing.`);
  return { ...matches[0], assetCode: code };
}

function validateRecord(record) {
  if (globalThis.CAFMAssetRules?.validateRecord) return globalThis.CAFMAssetRules.validateRecord(record);
  const issues = [];
  // v5.3 blank-field policy: empty workbook cells are intentionally skipped.
  // Asset Code remains the row identity required by the workbook reader.
  if (!clean(record?.assetCode)) issues.push('Asset Code is blank');
  return issues;
}

  root.data = root.data || {};
  root.data.records = Object.freeze({
    configure,
    currentRecord,
    assetCodeOnPage,
    workflowAssetCodeOnPage,
    recordByAssetCode,
    ppmRecordOnCurrentPage,
    workflowRecord,
    recordForCurrentSavedAsset,
    validateRecord
  });
})();
