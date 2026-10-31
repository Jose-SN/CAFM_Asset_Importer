(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;

  const NEXT_HINT = Object.freeze({
    search: 'Type Asset Code in the register filter and select the matching row',
    wait_asset: 'Click PPM in the asset side navigation',
    wait_ppm: 'PPM register is open',
    ppm_ready: 'Matching PPM listed, or waiting to create',
    navigate: 'Fill asset fields from Excel',
    fill: 'Validate and fill all asset tabs',
    filling: 'Complete remaining asset fields',
    saving: 'Click Save',
    await_save: 'Wait for CAFM save confirmation',
    asset_close_child: 'Close asset editor window',
    asset_close_wait: 'Wait for editor to close',
    activate_open: 'Open Change Asset Status',
    activate_select: 'Select Active in the status popup',
    activate_confirm: 'Confirm Active status',
    activate_wait: 'Wait until asset shows Active',
    activate_wait_user: 'You set Active — extension continues automatically',
    asset_save_and_close: 'Save menu → Save and Close',
    asset_save_and_close_wait: 'Wait for asset editor to close',
    asset_save_and_new: 'Save menu → Save and New',
    complete: 'Run finished',
    error: 'Review error and resume',
    paused: 'Resume when ready'
  });

  function buildGuide(context = {}) {
    const {
      auto = {},
      record = null,
      statuses = {},
      statusOf = () => 'pending'
    } = context;

    const phase = clean(auto.phase || '');
    const assetCode = clean(record?.assetCode || auto.assetCode || '');
    const status = record ? statusOf(record) : 'pending';
    const phaseLabel = root.ui?.progressToast?.phaseLabel?.(phase) || phase.replace(/_/g, ' ') || 'Working';

    const doneParts = [];
    const entityId = clean(auto.assetEntityId || statuses[assetCode]?.cafmEntityId || '');
    const assetActivated = Boolean(
      auto.assetActivated
      || statuses[assetCode]?.assetActivated
      || /active/i.test(clean(statuses[assetCode]?.assetStatusEvidence || ''))
    );

    if (['saved', 'asset_saved'].includes(status) || entityId) doneParts.push('Asset saved');
    if (assetActivated) doneParts.push('Status Active');
    if (!entityId && ['fill', 'filling', 'saving'].includes(phase)) doneParts.push('Workbook row loaded');
    if (!doneParts.length) doneParts.push('Starting this asset cycle');

    let next = NEXT_HINT[phase] || '';
    if (!next) next = 'Continue automatic workflow';
    if (phase === 'asset_save_and_new') {
      next = 'Save and New → asset list → Create New → fill next row';
    } else if (phase === 'navigate') {
      next = 'Click Create New on asset list, then fill next asset';
    } else if (phase === 'asset_save_and_close_wait') {
      next = 'Open next asset New Entity form';
    }

    return {
      done: doneParts.join(' · '),
      now: phaseLabel,
      next,
      pending: '',
      assetCode,
      ppmSlot: '',
      phase
    };
  }

  function formatGuideLines(guide, options = {}) {
    const waitNote = options.waiting && options.waitSec
      ? ` (checking again in ${options.waitSec}s)`
      : options.waiting
        ? ' (waiting)'
        : '';
    const lines = [
      `Done: ${guide.done || '—'}`,
      `Now: ${guide.now || '—'}${waitNote}`,
      `Next: ${guide.next || '—'}`
    ];
    if (guide.pending && !['asset_save_and_new', 'navigate', 'asset_save_and_close', 'asset_save_and_close_wait', 'complete'].includes(guide.phase)) {
      lines.push(`Queue: ${guide.pending}`);
    }
    return lines.join('\n');
  }

  root.ui = root.ui || {};
  root.ui.workflowGuide = Object.freeze({ buildGuide, formatGuideLines, NEXT_HINT });
})();
