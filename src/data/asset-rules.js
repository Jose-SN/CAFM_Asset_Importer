(() => {
  'use strict';
  // Shared by preflight and the on-page importer. No asset-family defaults.
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const blank = value => clean(value) === '';
  // v5.3: blank workbook fields are valid and are skipped by the importer.
  // Asset Code remains the workbook row identity; every other field is optional
  // from the extension's perspective and is only validated when populated.
  const checkedFields = [
    ['assetCode','Asset Code'], ['description','Description'], ['quantity','Quantity'],
    ['buildingSearch','Building'], ['locationSearch','Location Code'],
    ['system','System'], ['tag','Tag'], ['type','Type'], ['name','Name']
  ];

  function lookupValue(kind, value, suppliedCode = '', suppliedDescription = '') {
    const full = clean(value);
    const separator = full.indexOf(' - ');
    // Prefer the actual cell. Do not reinterpret a door type, infer a tag,
    // or substitute BLDFAB/FDR when another asset class is supplied.
    if (separator > 0) return {
      full, code: full.slice(0,separator).trim(),
      description: full.slice(separator+3).trim()
    };
    if (full) {
      const code = clean(suppliedCode) || (/^[A-Za-z0-9][A-Za-z0-9_&/+.-]*$/.test(full) ? full : '');
      return { full, code, description: clean(suppliedDescription) === full && code === full ? '' : (clean(suppliedDescription) || (code ? '' : full)) };
    }
    // A blank source cell stays blank and the importer skips that CAFM field.
    return { full: '', code: '', description: '' };
  }

  function validDate(value) {
    const match=clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return false;
    const day=Number(match[1]), month=Number(match[2]), year=Number(match[3]);
    const d=new Date(Date.UTC(year,month-1,day));
    return year>=1900 && year<=9999 && d.getUTCFullYear()===year && d.getUTCMonth()===month-1 && d.getUTCDate()===day;
  }

  function validateRecord(record) {
    const r=record || {}; const issues=[];
    for (const [key,label] of checkedFields) {
      const value = clean(r[key]);
      if (!value) {
        if (key === 'assetCode') issues.push(`${label} is blank`);
        continue;
      }
      if (/^#(?:REF!|VALUE!|N\/A|NAME\?|DIV\/0!|NUM!|NULL!)/i.test(value)) issues.push(`${label} contains an Excel error`);
      else if (/<[^>]+>|^(?:enter|replace|select)\b/i.test(value)) issues.push(`${label} still contains an instruction/placeholder`);
    }
    if (!blank(r.assetCode) && !/^WCH-/i.test(clean(r.assetCode))) issues.push('Asset Code does not begin with WCH-');
    if (!blank(r.locationSearch) && !/^WCH-/i.test(clean(r.locationSearch))) issues.push('Location Code does not begin with WCH-');
    if (!blank(r.quantity) && (!Number.isFinite(Number(r.quantity)) || Number(r.quantity)<=0)) issues.push('Quantity must be a positive number');
    if (String(r.comments || '').length>2000) issues.push('Notes exceed the 2,000-character CAFM limit');
    for (const [key,label] of [['warrantyExpiry','Warranty Expires'],['purchaseDate','Purchase Date'],['surveyDate','Survey Date']]) {
      if (!blank(r[key]) && !validDate(r[key])) issues.push(`${label} must be a real date in DD/MM/YYYY format`);
    }
    for (const [key,label] of [
      ['replacementCost','Replacement Cost'],['purchaseCost','Purchase Cost'],['disposalValue','Disposal Value'],
      ['lifespan','Lifespan'],['reducingBalanceDepreciation','Reducing Balance Depreciation %'],
      ['operationalRisk','Operational Risk'],['healthSafetyRisk','Health/Safety Risk'],
      ['environmentalRisk','Environmental Risk'],['leaseObligation','Lease Obligation'],['actualRisk','Actual Risk']
    ]) {
      if (!blank(r[key]) && (!Number.isFinite(Number(r[key])) || Number(r[key])<0)) issues.push(`${label} must be a non-negative number`);
    }
    if (!blank(r.reducingBalanceDepreciation) && Number(r.reducingBalanceDepreciation)>100) issues.push('Reducing Balance Depreciation % must be 0 to 100');
    const spatial=r.spatial || {};
    for (const [key,label,min,max] of [['latitude','Latitude',-90,90],['longitude','Longitude',-180,180],['elevation','Elevation',-Infinity,Infinity]]) {
      if (!blank(spatial[key]) && (!Number.isFinite(Number(spatial[key])) || Number(spatial[key])<min || Number(spatial[key])>max)) issues.push(`${label} is not a valid numeric value/range`);
    }
    return issues;
  }
  globalThis.CAFMAssetRules=Object.freeze({lookupValue,validateRecord,validDate});
})();
