(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  root.workflow = root.workflow || {};

  const ASSET_PHASES = Object.freeze([
    'search',
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
    'asset_save_and_new',
    'asset_save_and_close',
    'asset_save_and_close_wait'
  ]);

  const WAITING_PHASES = new Set([
    'await_save',
    'asset_close_wait',
    'activate_wait',
    'activate_wait_user',
    'navigate',
    'asset_save_and_close_wait'
  ]);

  function phasePrefix(phase, prefix) {
    return String(phase || '').startsWith(prefix);
  }

  root.workflow.phases = Object.freeze({
    ASSET_PHASES,
    WAITING_PHASES,
    phasePrefix,
    isActivationPhase: (phase) => phasePrefix(phase, 'activate_')
  });
})();
