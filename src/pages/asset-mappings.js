(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { makeLookupSpec, splitLookupValue } = root.core.lookupSpec;
  const { directMappingsFromRegistry } = root.data.fieldRegistry;

  function lookupMapping(record) {
    const system = splitLookupValue(record.system);
    const tag = splitLookupValue(record.tag);
    const type = splitLookupValue(record.type);
    const name = splitLookupValue(record.name);
    const supplier = splitLookupValue(record.supplier);
    const costCentre = splitLookupValue(record.costCentre);
    const buildingDisplay = clean(record.buildingCafmValue || record.buildingDisplay || record.buildingFull || record.buildingCode || record.buildingSearch);
    const locationCode = clean(record.locationCode);
    const locationCafmValue = clean(record.locationCafmValue);
    const systemDisplay = clean(record.system);
    const systemStrict = clean(
      record.systemCode || system.code || (/^[A-Z0-9_&/+.-]+$/.test(clean(record.system)) ? clean(record.system) : '')
    );
    const systemDescription = record.systemDescription && norm(record.systemDescription) !== norm(record.system)
      ? record.systemDescription
      : system.description;
    const typeDisplay = clean(record.type);
    const typeStrict = clean(record.typeCode || type.code);
    const typeDescription = record.typeDescription || type.description;
    const supplierDisplay = clean(record.supplier);
    const supplierStrict = clean(supplier.code);
    const supplierDescription = supplier.description;
    const condition = splitLookupValue(record.condition);
    const conditionDisplay = clean(record.condition);
    const conditionStrict = clean(condition.code) || clean(record.condition).match(/^([A-Za-z0-9_.]+)/)?.[1] || '';
    const conditionDescription = condition.description;

    return [
      makeLookupSpec('Building', buildingDisplay, { display: buildingDisplay }),
      makeLookupSpec('Floor', record.floorName, { display: record.floorName, aliases: [record.floorName], searchTerms: [record.floorName] }),
      makeLookupSpec('Location', locationCode || locationCafmValue, {
        locationCode,
        locationCafmValue
      }),
      makeLookupSpec('System', systemDisplay || systemStrict, {
        strictCode: systemStrict,
        display: systemDisplay,
        description: systemDescription,
        aliases: [record.system, system.full, systemStrict, systemDescription],
        searchTerms: [systemDisplay, systemStrict, systemDescription, system.code]
      }),
      makeLookupSpec('Tag', record.tag, { strictCode: record.tagCode || tag.code || (/^[A-Z0-9_&/+.-]+$/.test(clean(record.tag)) ? clean(record.tag) : ''), description: record.tagDescription && norm(record.tagDescription) !== norm(record.tag) ? record.tagDescription : tag.description }),
      makeLookupSpec('Type', typeDisplay || typeStrict, {
        strictCode: typeStrict,
        display: typeDisplay,
        description: typeDescription,
        aliases: [record.type, type.full, typeStrict, typeDescription],
        searchTerms: [typeDisplay, typeStrict, typeDescription, type.code]
      }),
      makeLookupSpec('Name', record.name, { strictCode: record.nameCode || name.code, description: record.nameDescription || name.description }),
      makeLookupSpec('Classification', record.classification, { display: record.classification, aliases: [record.classification], searchTerms: [record.classification] }),
      makeLookupSpec('Parent Asset', record.parentAssetCode, { strictCode: record.parentAssetCode, searchTerms: [record.parentAssetCode] }),
      makeLookupSpec('Supplier', supplierDisplay || supplierStrict, {
        strictCode: supplierStrict,
        display: supplierDisplay,
        description: supplierDescription,
        aliases: [record.supplier, supplier.full, supplierStrict, supplierDescription],
        searchTerms: [supplierDisplay, supplierStrict, supplierDescription]
      }),
      makeLookupSpec('Cost Centre', record.costCentre, { strictCode: costCentre.code, description: costCentre.description }),
      makeLookupSpec('Condition', conditionDisplay || conditionStrict, {
        tab: 'Financial/Risk',
        strictCode: conditionStrict,
        display: conditionDisplay,
        description: conditionDescription,
        aliases: [record.condition, condition.full, conditionStrict, conditionDescription],
        searchTerms: [conditionDisplay, conditionStrict, conditionDescription]
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
