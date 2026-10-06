(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;

  /** @type {null | { toast: HTMLElement, toastTitle: HTMLElement, toastMeta: HTMLElement, toastDetail: HTMLElement }} */
  let els = null;
  let tickTimer = null;
  let waitStartedAt = 0;
  /** @type {null | { verb: string, target: string, detail: string, wait: boolean, meta: string }} */
  let current = null;

  const PHASE_LABELS = Object.freeze({
    navigate: 'Open next asset form',
    fill: 'Prepare asset form',
    filling: 'Fill asset fields from Excel',
    saving: 'Save asset',
    await_save: 'Wait for asset save confirmation',
    asset_close_child: 'Close asset editor window',
    asset_close_wait: 'Wait for asset editor to close',
    activate_open: 'Open Change Asset Status',
    activate_select: 'Select Active status',
    activate_confirm: 'Confirm Active status',
    activate_wait: 'Wait for activation to complete',
    activate_wait_user: 'Waiting for you to set Active status',
    asset_save_and_new: 'Save and New for next asset',
    asset_save_and_close: 'Save and Close on General tab',
    asset_save_and_close_wait: 'Wait for Save and Close to finish',
    run_complete_finalize: 'Finish run and return to asset list',
    ppm_open_list: 'Open PPM register',
    ppm_wait_new: 'Wait for PPM Create New window',
    ppm_wait_user_new: 'Waiting for you to click Create New',
    ppm_fill: 'Fill PPM form from Excel',
    ppm_await_save: 'Wait for PPM save confirmation',
    ppm_parent_refresh: 'Click PPM register Refresh',
    ppm_parent_refresh_wait: 'Wait for PPM register refresh',
    ppm_next: 'Prepare next linked PPM',
    ppm_cycle_complete_parent: 'Finish PPM cycle on asset',
    ppm_cycle_general_wait: 'Open General tab after PPMs',
    ppm_child_closing: 'Close PPM editor window',
    ppm_status_open: 'Open PPM status change',
    ppm_status_select: 'Select PPM Active status',
    ppm_status_confirm: 'Confirm PPM status',
    ppm_status_wait: 'Wait for PPM activation',
    ppm_status_wait_user: 'Waiting for you to activate PPM'
  });

  function phaseLabel(phase) {
    const key = clean(phase || '');
    return PHASE_LABELS[key] || key.replace(/_/g, ' ') || 'Working';
  }

  function formatFieldValue(value, maxLength = 140) {
    if (value === true) return 'YES';
    if (value === false) return 'NO';
    const text = clean(value);
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  function showFieldFill(field, value, options = {}) {
    const display = formatFieldValue(value, options.maxLength || 140);
    showActivity(
      clean(options.verb || 'Filling'),
      clean(field || 'Field'),
      display ? `→ ${display}` : '',
      {
        wait: options.wait !== false,
        type: options.type || 'info',
        meta: clean(options.meta || ''),
        tick: options.tick !== false,
        duration: Number(options.duration) || 0
      }
    );
  }

  function configureToastElements(elements) {
    els = elements ? Object.freeze({ ...elements }) : null;
  }

  function stopTick() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function elapsedSec() {
    if (!waitStartedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - waitStartedAt) / 1000));
  }

  function paint(type = 'info') {
    if (!els?.toast || !els.toastTitle) return;
    const title = current
      ? `${current.verb}: ${current.target}`
      : '';
    const meta = current?.meta || '';
    let detail = current?.detail || '';
    if (current?.wait) {
      const sec = elapsedSec();
      detail = detail
        ? `${detail} · waiting ${sec}s`
        : `Waiting for response · ${sec}s`;
    }
    els.toastTitle.textContent = title;
    if (els.toastMeta) {
      els.toastMeta.textContent = meta;
      els.toastMeta.hidden = !meta;
    }
    if (els.toastDetail) {
      els.toastDetail.textContent = detail;
      els.toastDetail.hidden = !detail;
    }
    els.toast.className = `toast show ${type}${current?.wait ? ' progress' : ''}`;
  }

  function showActivity(verb, target, detail = '', options = {}) {
    if (!els?.toast) return;
    const wait = options.wait !== false;
    waitStartedAt = Date.now();
    current = {
      verb: clean(verb || 'Working'),
      target: clean(target || ''),
      detail: clean(detail || ''),
      wait,
      meta: clean(options.meta || '')
    };
    paint(options.type || 'info');
    stopTick();
    if (wait && options.tick !== false) {
      tickTimer = setInterval(() => paint(options.type || 'info'), 1000);
    }
    if (options.duration > 0) {
      clearTimeout(els.toast._timer);
      els.toast._timer = setTimeout(() => {
        if (current?.verb === verb && current?.target === clean(target || '')) {
          current = null;
          stopTick();
          if (els.toast) els.toast.className = 'toast';
        }
      }, options.duration);
    } else {
      clearTimeout(els.toast._timer);
      els.toast._timer = null;
    }
  }

  function showToast(message, type = 'info', duration = 4500) {
    if (!els?.toast || !els.toastTitle) return;
    stopTick();
    current = null;
    els.toastTitle.textContent = clean(message);
    if (els.toastMeta) {
      els.toastMeta.textContent = '';
      els.toastMeta.hidden = true;
    }
    if (els.toastDetail) {
      els.toastDetail.textContent = '';
      els.toastDetail.hidden = true;
    }
    els.toast.className = `toast show ${type}`;
    clearTimeout(els.toast._timer);
    els.toast._timer = null;
    if (duration > 0) {
      els.toast._timer = setTimeout(() => { els.toast.className = 'toast'; }, duration);
    }
  }

  function showPhase(phase, detail = '', options = {}) {
    showActivity(
      options.verb || (options.wait === false ? 'Running' : 'Waiting'),
      phaseLabel(phase),
      detail,
      { wait: options.wait !== false, type: 'info', meta: options.meta || '', tick: options.tick !== false }
    );
  }

  root.ui = root.ui || {};
  root.ui.progressToast = Object.freeze({
    configureToastElements,
    showToast,
    showActivity,
    showFieldFill,
    showPhase,
    phaseLabel,
    formatFieldValue,
    stopTick
  });
})();
