(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const pages = root.core.pages;

  const PAGE_HANDLERS = Object.freeze([
    {
      id: 'asset-search',
      label: 'Asset register search',
      test: () => pages.isAssetListPage(),
      phases: ['search', 'wait_asset'],
      handler: 'processSearch'
    },
    {
      id: 'asset-detail',
      label: 'Asset details PPM nav',
      test: () => pages.isSavedAssetPage(),
      phases: ['wait_asset', 'wait_ppm'],
      handler: 'processOpenPpm'
    },
    {
      id: 'ppm-list',
      label: 'Asset PPM list',
      test: () => pages.isPpmListPage(),
      phases: ['wait_ppm', 'ppm_ready', 'wait_ppm_new'],
      handler: 'processList'
    },
    {
      id: 'ppm-new',
      label: 'PPM New Entity',
      test: () => pages.isPpmNewEntityPage(),
      phases: ['wait_ppm_new', 'ppm_fill', 'ppm_filled'],
      handler: 'processFill'
    },
    {
      id: 'asset-new',
      label: 'Asset New Entity',
      test: () => pages.isAssetPage() && pages.isNewEntityPage(),
      phases: ['navigate', 'fill', 'filling', 'saving', 'await_save'],
      handler: 'fillCurrentRecord'
    },
    {
      id: 'asset-saved',
      label: 'Asset Saved',
      test: () => pages.isAssetPage() && pages.isSavedAssetPage(),
      phases: ['asset_close_child', 'asset_close_wait', 'activate_open', 'activate_select', 'activate_confirm', 'activate_wait', 'activate_wait_user', 'asset_save_and_new', 'asset_save_and_close', 'asset_save_and_close_wait'],
      handler: 'processActivationPage'
    }
  ]);

  function detectCurrentPage() {
    return PAGE_HANDLERS.find((entry) => {
      try { return entry.test(); } catch (_) { return false; }
    }) || null;
  }

  root.pages = root.pages || {};
  root.pages.registry = Object.freeze({ PAGE_HANDLERS, detectCurrentPage });
})();
