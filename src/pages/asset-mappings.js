(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { makeLookupSpec, splitLookupValue } = root.core.lookupSpec;
  const { directMappingsFromRegistry } = root.data.fieldRegistry;

  function lookupMapping(record) {
    const tag = splitLookupValue(record.tag);
    const nameParts = splitLookupValue(record.name);
    const supplierParts = splitLookupValue(record.supplier);
    const costCentre = splitLookupValue(record.costCentre);
    const buildingDisplay = clean(record.buildingCafmValue || record.buildingDisplay || record.buildingFull || record.buildingCode || record.buildingSearch);
    const locationCode = clean(record.locationCode);
    const locationCafmValue = clean(record.locationCafmValue);

    const systemCafmValue = clean(record.system);
    const systemFallback = clean(record.systemCode || splitLookupValue(record.system).code);
    const typeDisplay = clean(record.type);
    const nameCafmValue = clean(record.name);
    const nameFallback = clean(record.nameCode || nameParts.code);
    const supplierCafmValue = clean(record.supplier);
    const supplierFallback = clean(record.supplierCode || supplierParts.code);
    const conditionValue = clean(record.condition);

    return [
      makeLookupSpec('Building', buildingDisplay, { display: buildingDisplay }),
      makeLookupSpec('Floor', record.floorName, { display: record.floorName, aliases: [record.floorName], searchTerms: [record.floorName] }),
      makeLookupSpec('Location', locationCode || locationCafmValue, {
        locationCode,
        locationCafmValue
      }),
      makeLookupSpec('System', systemCafmValue || systemFallback, {
        lookupCafmValue: systemCafmValue,
        lookupFallback: systemFallback
      }),
      makeLookupSpec('Tag', record.tag, {
        strictCode: record.tagCode || tag.code || (/^[A-Z0-9_&/+.-]+$/.test(clean(record.tag)) ? clean(record.tag) : ''),
        description: record.tagDescription && norm(record.tagDescription) !== norm(record.tag) ? record.tagDescription : tag.description
      }),
      makeLookupSpec('Type', typeDisplay, { display: typeDisplay }),
      makeLookupSpec('Name', nameCafmValue || nameFallback, {
        lookupCafmValue: nameCafmValue,
        lookupFallback: nameFallback
      }),
      makeLookupSpec('Classification', record.classification, { display: record.classification, aliases: [record.classification], searchTerms: [record.classification] }),
      makeLookupSpec('Parent Asset', record.parentAssetCode, { strictCode: record.parentAssetCode, searchTerms: [record.parentAssetCode] }),
      makeLookupSpec('Supplier', supplierCafmValue || supplierFallback, {
        lookupCafmValue: supplierCafmValue,
        lookupFallback: supplierFallback
      }),
      makeLookupSpec('Cost Centre', record.costCentre, { strictCode: costCentre.code, description: costCentre.description }),
      makeLookupSpec('Condition', conditionValue, {
        tab: 'Financial/Risk',
        conditionValue
      })
    ].filter((item) => clean(item.value));
  }

  function directMappings(record) {
    return directMappingsFromRegistry(record);
  }

  function valueEquivalent(actual, expected) {
    const a = clean(actual);
    const e = clean(expected);
    if (!e) return true;
    if (norm(a) === norm(e)) return true;
    const an = Number(a.replace(/,/g, ''));
    const en = Number(e.replace(/,/g, ''));
    if (Number.isFinite(an) && Number.isFinite(en) && Math.abs(an - en) < 0.000001) return true;
    return false;
  }

  root.pages = root.pages || {};
  root.pages.assetMappings = Object.freeze({ lookupMapping, directMappings, valueEquivalent });
})();
