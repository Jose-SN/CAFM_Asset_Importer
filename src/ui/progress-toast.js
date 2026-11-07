(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;

  /** @type {null | { progress: object, alert: object }} */
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
    asset_save_and_new: 'Save menu → Save and New for next asset',
    navigate: 'Open next asset New Entity form',
    asset_save_and_close: 'Save and Close on General tab',
    asset_save_and_close_wait: 'Wait for Save and Close to finish',
    asset_copy_click: 'Click Copy (template window)',
    asset_copy_post_click_wait: 'Wait 5s after Copy click',
    asset_copy_dialog_wait: 'Copy Settings popup (child)',
    asset_copy_dialog_confirm: 'Copy PPMs (3s) → OK (child)',
    asset_copy_post_ok_click_wait: 'After OK → fill (no extra wait)',
    asset_copy_post_ok_wait: 'After OK → fill (no extra wait)',
    asset_copy_wait_editor: 'Asset Code empty → fill',
    asset_copy_post_cycle_wait: 'Wait 5s → Copy next row',
    asset_copy_wait_user: 'Legacy: auto cycle hand-off',
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
    ppm_child_closing: 'PPM saved — closing editor',
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
    if (!elements) {
      els = null;
      return;
    }
    const progress = {
      toast: elements.progressToast || elements.toast,
      title: elements.progressTitle || elements.toastTitle,
      meta: elements.progressMeta || elements.toastMeta,
      detail: elements.progressDetail || elements.toastDetail
    };
    const alert = {
      toast: elements.alertToast,
      title: elements.alertTitle,
      meta: elements.alertMeta,
      detail: elements.alertDetail
    };
    els = Object.freeze({ progress, alert });
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
    const p = els?.progress;
    if (!p?.toast || !p.title) return;
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
    p.title.textContent = title;
    if (p.meta) {
      p.meta.textContent = meta;
      p.meta.hidden = !meta;
    }
    if (p.detail) {
      p.detail.textContent = detail;
      p.detail.hidden = !detail;
    }
    p.toast.className = `toast toast-progress show ${type}${current?.wait ? ' progress' : ''}`;
  }

  function showActivity(verb, target, detail = '', options = {}) {
    const type = clean(options.type || 'info');
    if (type === 'error' || type === 'warn') {
      const msg = detail
        ? `${clean(verb || 'Notice')}: ${clean(target || '')} — ${clean(detail)}`
        : `${clean(verb || 'Notice')}: ${clean(target || '')}`;
      showToast(msg, type, Number(options.duration) || (type === 'error' ? 12000 : 9000));
      if (type === 'error') return;
    }
    if (!els?.progress?.toast) return;
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
    const progressEl = els.progress.toast;
    if (options.duration > 0) {
      clearTimeout(progressEl._timer);
      progressEl._timer = setTimeout(() => {
        if (current?.verb === verb && current?.target === clean(target || '')) {
          current = null;
          stopTick();
          if (progressEl) progressEl.className = 'toast toast-progress';
        }
      }, options.duration);
    } else {
      clearTimeout(progressEl._timer);
      progressEl._timer = null;
    }
  }

  function alertPlacementClass(type) {
    const key = clean(type || 'info');
    if (key === 'error' || key === 'warn') return 'toast-alert-left';
    return 'toast-alert-right';
  }

  function showToast(message, type = 'info', duration = 4500) {
    const a = els?.alert;
    if (!a?.toast || !a.title) return;
    a.title.textContent = clean(message);
    if (a.meta) {
      a.meta.textContent = '';
      a.meta.hidden = true;
    }
    if (a.detail) {
      a.detail.textContent = '';
      a.detail.hidden = true;
    }
    const placement = alertPlacementClass(type);
    a.toast.className = `toast toast-alert show ${type} ${placement}`;
    clearTimeout(a.toast._timer);
    if (duration > 0) {
      a.toast._timer = setTimeout(() => {
        a.toast.className = 'toast toast-alert';
      }, duration);
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

  function showWorkflowStatus(context = {}, options = {}) {
    if (!root.ui?.workflowGuide?.buildGuide) {
      showPhase(context?.auto?.phase || '', options.detail || '', options);
      return;
    }
    const guide = root.ui.workflowGuide.buildGuide(context);
    const wait = options.wait !== false;
    const detail = root.ui.workflowGuide.formatGuideLines(guide, {
      waiting: wait,
      waitSec: Number(options.waitSec) || 0
    });
    const verb = options.verb || (wait ? 'Waiting' : 'Running');
    showActivity(
      verb,
      phaseLabel(guide.phase || context?.auto?.phase || ''),
      detail,
      {
        wait,
        type: options.type || 'info',
        meta: [guide.assetCode, guide.ppmSlot].filter(Boolean).join(''),
        tick: options.tick !== false && wait,
        duration: Number(options.duration) || 0
      }
    );
  }

  root.ui = root.ui || {};
  root.ui.progressToast = Object.freeze({
    configureToastElements,
    showToast,
    showActivity,
    showFieldFill,
    showPhase,
    showWorkflowStatus,
    phaseLabel,
    formatFieldValue,
    stopTick
  });
})();
