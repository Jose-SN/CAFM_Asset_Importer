(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const pages = root.core.pages;

  const PAGE_HANDLERS = Object.freeze([
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
      phases: ['activate_open', 'activate_select', 'activate_confirm', 'activate_wait', 'activate_wait_user'],
      handler: 'processActivationPage'
    },
    {
      id: 'ppm-register',
      label: 'PPM Register (parent #)',
      test: () => pages.isHashPpmParentPage(),
      phases: ['ppm_open_list', 'ppm_wait_new', 'ppm_wait_user_new', 'ppm_next', 'ppm_parent_refresh_wait'],
      handler: 'processPpmListPage'
    },
    {
      id: 'ppm-editor',
      label: 'PPM Editor',
      test: () => pages.isPpmItemPage(),
      phases: ['ppm_fill', 'ppm_await_save', 'ppm_status_open', 'ppm_status_select', 'ppm_status_confirm', 'ppm_status_wait', 'ppm_status_wait_user'],
      handler: 'processPpmItemPage'
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
