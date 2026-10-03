(() => {
  'use strict';

  const root = globalThis.CAFMImporter;

  /** @typedef {{ tab: string, labels: string[], path: string, required?: boolean, kind?: string }} DirectFieldDef */

  /** @type {DirectFieldDef[]} */
  const ASSET_DIRECT_FIELDS = [
    { tab: 'Details', labels: ['Asset Code'], path: 'assetCode', required: true, kind: 'text' },
    { tab: 'Details', labels: ['Group'], path: 'group', kind: 'text' },
    { tab: 'Details', labels: ['Site Reference', 'Site'], path: 'siteReference', kind: 'text' },
    { tab: 'Details', labels: ['External Ref', 'External Reference'], path: 'externalRef', kind: 'text' },
    { tab: 'Details', labels: ['Description'], path: 'description', kind: 'text' },
    { tab: 'Details', labels: ['Product Code'], path: 'productCode', kind: 'text' },
    { tab: 'Details', labels: ['Manufacturer'], path: 'manufacturer', kind: 'text' },
    { tab: 'Details', labels: ['Barcode'], path: 'barcode', kind: 'text' },
    { tab: 'Details', labels: ['Qty', 'Quantity'], path: 'quantity', kind: 'text' },
    { tab: 'Details', labels: ['Serial No.', 'Serial No', 'Serial Number'], path: 'serialNumber', kind: 'text' },
    { tab: 'Details', labels: ['Model', 'Model Type'], path: 'model', kind: 'text' },
    { tab: 'Details', labels: ['Drawing #', 'Drawing Reference Number'], path: 'drawingReference', kind: 'text' },
    { tab: 'Details', labels: ['Object Ref', 'Object Reference'], path: 'objectRef', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Warranty Expires', 'Warranty Expiry Date'], path: 'warrantyExpiry', kind: 'date' },
    { tab: 'Financial/Risk', labels: ['Replacement Cost'], path: 'replacementCost', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Purchase Date'], path: 'purchaseDate', kind: 'date' },
    { tab: 'Financial/Risk', labels: ['Purchase Cost'], path: 'purchaseCost', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Disposal Value'], path: 'disposalValue', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Lifespan'], path: 'lifespan', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Reducing Balance Depreciation %', 'Reducing Balance Depreciation'], path: 'reducingBalanceDepreciation', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Operational'], path: 'operationalRisk', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Health/Safety', 'Health & Safety'], path: 'healthSafetyRisk', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Environmental'], path: 'environmentalRisk', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Survey Date', 'Asset Tested Date'], path: 'surveyDate', kind: 'date' },
    { tab: 'Financial/Risk', labels: ['Lease Obligation'], path: 'leaseObligation', kind: 'text' },
    { tab: 'Financial/Risk', labels: ['Actual Risk'], path: 'actualRisk', kind: 'text' },
    { tab: 'Spatial', labels: ['GIS Reference'], path: 'spatial.gisReference', kind: 'text' },
    { tab: 'Spatial', labels: ['Latitude'], path: 'spatial.latitude', kind: 'text' },
    { tab: 'Spatial', labels: ['Longitude'], path: 'spatial.longitude', kind: 'text' },
    { tab: 'Spatial', labels: ['Elevation'], path: 'spatial.elevation', kind: 'text' },
    { tab: 'Spatial', labels: ['External System'], path: 'spatial.externalSystem', kind: 'text' },
    { tab: 'Spatial', labels: ['External Object'], path: 'spatial.externalObject', kind: 'text' },
    { tab: 'Spatial', labels: ['External Identifier'], path: 'spatial.externalIdentifier', kind: 'text' }
  ];

  /** Lookup fields — spec builders remain in asset-mappings.js; order lives in fill-profiles.js */
  const ASSET_LOOKUP_FIELDS = [
    'Building', 'Floor', 'Location', 'System', 'Tag', 'Type', 'Name',
    'Classification', 'Parent Asset', 'Supplier', 'Cost Centre', 'Condition'
  ];

  /** @type {{ kind: string, labels: string[], path: string }[]} */
  const PPM_DIRECT_FIELDS = [
    { kind: 'text', labels: ['Family'], path: 'family' },
    { kind: 'text', labels: ['Stock Cost'], path: 'stockCost' },
    { kind: 'text', labels: ['Labour Cost'], path: 'labourCost' },
    { kind: 'text', labels: ['Est. Staff', 'Est Staff'], path: 'estStaff' },
    { kind: 'checkbox', labels: ['Permit'], path: 'permit' },
    { kind: 'checkbox', labels: ['H & S Task', 'H&S Task'], path: 'healthSafetyTask' },
    { kind: 'checkbox', labels: ['Controller'], path: 'controller' },
    { kind: 'select', labels: ['Class'], path: 'classValue' },
    { kind: 'checkbox', labels: ['Action before Task complete'], path: 'actionBeforeComplete' },
    { kind: 'checkbox', labels: ['Action before Task sign off'], path: 'actionBeforeSignoff' },
    { kind: 'select', labels: ['Generate Task Actions'], path: 'generateTaskActions' },
    { kind: 'text', labels: ['Last Service'], path: 'lastService' },
    { kind: 'text', labels: ['Next Service'], path: 'nextService' },
    { kind: 'select', labels: ['Default Day'], path: 'defaultDay' },
    { kind: 'text', labels: ['Period'], path: 'period' },
    { kind: 'select', labels: ['Frequency'], path: 'frequency' }
  ];

  const PPM_LOOKUP_FIELDS = ['Contract', 'Instruction', 'Priority', 'Shift', 'Compliance', 'Cost Code', 'Cost Centre'];

  const SUPPORTED_WORKBOOK_SCHEMAS = [
    'CAFM Asset + PPM Import v6.0',
    'CAFM Asset + PPM Import v8.0'
  ];

  function valueAtPath(record, path) {
    if (!record || !path) return '';
    const parts = String(path).split('.');
    let cur = record;
    for (const part of parts) {
      if (cur == null) return '';
      cur = cur[part];
    }
    return cur;
  }

  function directMappingsFromRegistry(record, fields = ASSET_DIRECT_FIELDS) {
    const out = {};
    for (const field of fields) {
      if (!out[field.tab]) out[field.tab] = [];
      out[field.tab].push({
        label: field.labels,
        value: valueAtPath(record, field.path),
        required: Boolean(field.required)
      });
    }
    return out;
  }

  function ppmDirectFromRegistry(ppm, fields = PPM_DIRECT_FIELDS) {
    return fields.map((field) => ({
      kind: field.kind,
      label: field.labels,
      value: valueAtPath(ppm, field.path)
    }));
  }

  root.data = root.data || {};
  root.data.fieldRegistry = Object.freeze({
    ASSET_DIRECT_FIELDS,
    ASSET_LOOKUP_FIELDS,
    PPM_DIRECT_FIELDS,
    PPM_LOOKUP_FIELDS,
    SUPPORTED_WORKBOOK_SCHEMAS,
    valueAtPath,
    directMappingsFromRegistry,
    ppmDirectFromRegistry
  });
})();
