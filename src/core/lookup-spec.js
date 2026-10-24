(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm, uniqueNonBlank, uniqueId } = root.core.text;

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

  /** Building CAFM Value: split on hyphen, left segment, remove all spaces (e.g. "0 0 4 - X" -> "004"). */
  function buildingCodeBeforeHyphen(value) {
    const full = clean(value);
    if (!full) return '';
    const left = full.split(/\s*-\s*/)[0] || '';
    return left.replace(/\s+/g, '');
  }

  function makeLookupSpec(field, value, options = {}) {
    const parts = splitLookupValue(value);
    let strictCode = clean(options.strictCode || parts.code || '');
    if (field === 'Condition' && !strictCode) strictCode = clean(value).match(/^([A-Za-z0-9_.]+)/)?.[1] || '';
    let searchTerms = uniqueNonBlank(options.searchTerms || (strictCode ? [strictCode] : []));
    let aliases = uniqueNonBlank([value, options.display, strictCode, options.description, ...(options.aliases || [])]);
    let description = clean(options.description || parts.description);
    let display = clean(options.display || value);

    if (field === 'Building') {
      strictCode = buildingCodeBeforeHyphen(value || options.display);
      searchTerms = uniqueNonBlank(strictCode ? [strictCode] : []);
      aliases = searchTerms;
      description = '';
      display = clean(options.display || value);
    } else if (field === 'Location') {
      const locationCode = clean(options.locationCode || strictCode);
      const locationCafmValue = clean(options.locationCafmValue || '');
      strictCode = locationCode;
      display = locationCafmValue || locationCode;
      searchTerms = uniqueNonBlank(
        locationCode
          ? (locationCafmValue && norm(locationCafmValue) !== norm(locationCode) ? [locationCode, locationCafmValue] : [locationCode])
          : (locationCafmValue ? [locationCafmValue] : [])
      );
      aliases = searchTerms;
      description = '';
    }

    return {
      id: uniqueId('lookup'),
      field,
      tab: options.tab || 'Details',
      value: clean(value),
      display,
      strictCode,
      description,
      aliases,
      searchTerms,
      buildingName: '',
      locationDescription: '',
      floorName: '',
      sourceCode: clean(options.sourceCode || strictCode),
      createdAt: Date.now(),
      openedAt: 0,
      status: 'created',
      attempts: 0
    };
  }

  root.core.lookupSpec = Object.freeze({
    splitLookupValue,
    buildingNumber,
    buildingCodeBeforeHyphen,
    makeLookupSpec
  });
})();
