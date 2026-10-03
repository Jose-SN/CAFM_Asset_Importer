(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { makeLookupSpec, splitLookupValue, buildingNumber } = root.core.lookupSpec;
  const { directMappingsFromRegistry } = root.data.fieldRegistry;

  function lookupMapping(record) {
    const system = splitLookupValue(record.system);
    const tag = splitLookupValue(record.tag);
    const type = splitLookupValue(record.type);
    const name = splitLookupValue(record.name);
    const supplier = splitLookupValue(record.supplier);
    const costCentre = splitLookupValue(record.costCentre);
    const buildingDisplay = clean(record.buildingCafmValue || record.buildingDisplay || record.buildingFull || record.buildingCode || record.buildingSearch);
    const buildingStrict = clean(record.buildingListCode || record.buildingCode || record.buildingSearch || buildingNumber(buildingDisplay));
    const locationDisplay = clean(record.locationCafmValue || record.locationDisplay || record.locationFull || record.locationCode || record.locationSearch);
    const locationStrict = clean(record.locationCode || record.locationSearch);

    return [
      makeLookupSpec('Building', buildingDisplay || buildingStrict, {
        strictCode: buildingStrict,
        display: buildingDisplay,
        buildingName: record.buildingName,
        aliases: [record.buildingFull, record.buildingCode, record.buildingSearch, record.buildingName],
        searchTerms: [buildingNumber(buildingDisplay || buildingStrict), buildingStrict, record.buildingName, buildingDisplay]
      }),
      makeLookupSpec('Floor', record.floorName, { display: record.floorName, aliases: [record.floorName], searchTerms: [record.floorName] }),
      makeLookupSpec('Location', locationDisplay || locationStrict, {
        strictCode: locationStrict,
        display: locationDisplay,
        sourceCode: locationStrict,
        locationDescription: record.locationDescription,
        floorName: record.floorName,
        aliases: [record.locationFull, record.locationDescription, record.locationSearch],
        searchTerms: [locationStrict, record.locationDescription, locationDisplay]
      }),
      makeLookupSpec('System', record.system, { strictCode: record.systemCode || system.code || (/^[A-Z0-9_&/+.-]+$/.test(clean(record.system)) ? clean(record.system) : ''), description: record.systemDescription && norm(record.systemDescription) !== norm(record.system) ? record.systemDescription : system.description }),
      makeLookupSpec('Tag', record.tag, { strictCode: record.tagCode || tag.code || (/^[A-Z0-9_&/+.-]+$/.test(clean(record.tag)) ? clean(record.tag) : ''), description: record.tagDescription && norm(record.tagDescription) !== norm(record.tag) ? record.tagDescription : tag.description }),
      makeLookupSpec('Type', record.type, { strictCode: record.typeCode || type.code, description: record.typeDescription || type.description }),
      makeLookupSpec('Name', record.name, { strictCode: record.nameCode || name.code, description: record.nameDescription || name.description }),
      makeLookupSpec('Classification', record.classification, { display: record.classification, aliases: [record.classification], searchTerms: [record.classification] }),
      makeLookupSpec('Parent Asset', record.parentAssetCode, { strictCode: record.parentAssetCode, searchTerms: [record.parentAssetCode] }),
      makeLookupSpec('Supplier', record.supplier, { strictCode: supplier.code, description: supplier.description }),
      makeLookupSpec('Cost Centre', record.costCentre, { strictCode: costCentre.code, description: costCentre.description }),
      makeLookupSpec('Condition', record.condition, { tab: 'Financial/Risk' })
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
