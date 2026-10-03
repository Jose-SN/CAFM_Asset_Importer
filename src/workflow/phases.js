(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  root.workflow = root.workflow || {};

  const ASSET_PHASES = Object.freeze([
    'navigate',
    'fill',
    'filling',
    'saving',
    'await_save',
    'asset_close_child',
    'asset_close_wait',
    'activate_open',
    'activate_select',
    'activate_confirm',
    'activate_wait',
    'activate_wait_user',
    'asset_save_and_new'
  ]);

  const PPM_PHASES = Object.freeze([
    'ppm_open_list',
    'ppm_wait_new',
    'ppm_wait_user_new',
    'ppm_fill',
    'ppm_await_save',
    'ppm_status_open',
    'ppm_status_select',
    'ppm_status_confirm',
    'ppm_status_wait',
    'ppm_status_wait_user',
    'ppm_child_closing',
    'ppm_parent_refresh_wait',
    'ppm_next'
  ]);

  const WAITING_PHASES = new Set([
    'await_save',
    'asset_close_wait',
    'activate_wait',
    'activate_wait_user',
    'asset_save_and_new',
    'ppm_wait_new',
    'ppm_wait_user_new',
    'ppm_await_save',
    'ppm_cycle_general_wait',
    'ppm_status_wait',
    'ppm_status_wait_user'
  ]);

  function phasePrefix(phase, prefix) {
    return String(phase || '').startsWith(prefix);
  }

  root.workflow.phases = Object.freeze({
    ASSET_PHASES,
    PPM_PHASES,
    WAITING_PHASES,
    phasePrefix,
    isActivationPhase: (phase) => phasePrefix(phase, 'activate_'),
    isPpmPhase: (phase) => phasePrefix(phase, 'ppm_'),
    isPpmStatusPhase: (phase) => phasePrefix(phase, 'ppm_status_')
  });
})();
