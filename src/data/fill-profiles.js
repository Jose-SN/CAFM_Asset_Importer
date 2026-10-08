(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { ASSET_LOOKUP_FIELDS } = root.data.fieldRegistry;

  const DEFAULT_ASSET_PROFILE = Object.freeze({
    id: 'default',
    label: 'Standard CAFM asset',
    assetTabOrder: ['Details', 'Financial/Risk', 'Spatial'],
    assetLookupSequence: ASSET_LOOKUP_FIELDS,
    ppmTabOrder: ['General', 'Notes']
  });

  /** Add { test(record), profile } entries ahead of the default rule to override tab order per asset type. */
  const PROFILE_RULES = Object.freeze([
    { id: 'default', test: () => true, profile: DEFAULT_ASSET_PROFILE }
  ]);

  function assetProfileForRecord(record) {
    const rule = PROFILE_RULES.find((entry) => {
      try { return entry.test(record); } catch (_) { return false; }
    });
    return rule?.profile || DEFAULT_ASSET_PROFILE;
  }

  function hasAssetSpatialData(record) {
    const spatial = record?.spatial || {};
    return [
      spatial.gisReference,
      spatial.latitude,
      spatial.longitude,
      spatial.elevation,
      spatial.externalSystem,
      spatial.externalObject,
      spatial.externalIdentifier
    ].some((value) => clean(value));
  }

  function resolveAssetTabOrder(record, settings = {}) {
    const order = [...assetProfileForRecord(record).assetTabOrder];
    const includeSpatial = settings.includeSpatial === true || hasAssetSpatialData(record);
    if (!includeSpatial) return order.filter((tab) => tab !== 'Spatial');
    return order;
  }

  function shouldFillAssetNotes(record) {
    return Boolean(clean(record?.comments));
  }

  root.data = root.data || {};
  root.data.fillProfiles = Object.freeze({
    DEFAULT_ASSET_PROFILE,
    PROFILE_RULES,
    assetProfileForRecord,
    hasAssetSpatialData,
    resolveAssetTabOrder,
    shouldFillAssetNotes
  });
})();
