(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { ASSET_LOOKUP_FIELDS } = root.data.fieldRegistry;

  const DEFAULT_ASSET_PROFILE = Object.freeze({
    id: 'default',
    label: 'Standard CAFM asset',
    assetTabOrder: ['Details', 'Financial/Risk', 'Spatial'],
    assetLookupSequence: ASSET_LOOKUP_FIELDS,
    ppmTabOrder: ['General', 'Notes']
  });

  function assetProfileForRecord(_record) {
    return DEFAULT_ASSET_PROFILE;
  }

  root.data = root.data || {};
  root.data.fillProfiles = Object.freeze({
    DEFAULT_ASSET_PROFILE,
    assetProfileForRecord
  });
})();
