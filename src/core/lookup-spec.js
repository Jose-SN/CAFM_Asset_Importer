(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, uniqueNonBlank, uniqueId } = root.core.text;

  function splitLookupValue(value) {
    const full = clean(value);
    const sep = full.indexOf(' - ');
    if (sep > 0) return { full, code: clean(full.slice(0, sep)), description: clean(full.slice(sep + 3)) };
    const condition = full.match(/^([A-Za-z0-9_.]+)\s+(.+)$/);
    if (condition && /^[0-9]+$/.test(condition[1])) return { full, code: condition[1], description: condition[2] };
    return { full, code: '', description: full };
  }

  function buildingNumber(value) {
    const match = clean(value).match(/(?:WCH-)?(\d{1,3})/i);
    return match ? String(Number(match[1])) : '';
  }

  function makeLookupSpec(field, value, options = {}) {
    const parts = splitLookupValue(value);
    let strictCode = clean(options.strictCode || parts.code || '');
    if (field === 'Building') strictCode = buildingNumber(options.strictCode || value) || strictCode;
    if (field === 'Condition' && !strictCode) strictCode = clean(value).match(/^([A-Za-z0-9_.]+)/)?.[1] || '';
    return {
      id: uniqueId('lookup'),
      field,
      tab: options.tab || 'Details',
      value: clean(value),
      display: clean(options.display || value),
      strictCode,
      description: clean(options.description || parts.description),
      aliases: uniqueNonBlank([value, options.display, strictCode, options.description, ...(options.aliases || [])]),
      searchTerms: uniqueNonBlank([strictCode, options.description, value, options.display, ...(options.searchTerms || [])]),
      labelAliases: uniqueNonBlank(options.labelAliases || []),
      buildingName: clean(options.buildingName || ''),
      locationDescription: clean(options.locationDescription || ''),
      floorName: clean(options.floorName || ''),
      sourceCode: clean(options.sourceCode || strictCode),
      createdAt: Date.now(),
      openedAt: 0,
      status: 'created',
      attempts: 0
    };
  }

  root.core.lookupSpec = Object.freeze({ splitLookupValue, buildingNumber, makeLookupSpec });
})();
