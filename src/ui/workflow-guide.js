(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;

  const NEXT_HINT = Object.freeze({
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
    ppm_open_list: 'Open PPM register for this asset',
    ppm_wait_new: 'Wait for New PPM editor window',
    ppm_wait_user_new: 'Click Create New once if the popup did not open',
    ppm_fill: 'Fill PPM fields and save',
    ppm_await_save: 'Wait for PPM save confirmation',
    ppm_child_closing: 'Close PPM editor and refresh register',
    ppm_parent_refresh: 'Click Refresh on PPM register',
    ppm_parent_refresh_wait: 'Wait for PPM register to reload',
    ppm_next: 'Create the next linked PPM',
    ppm_cycle_complete_parent: 'Finish PPM cycle on this asset',
    ppm_cycle_general_wait: 'Open General tab on saved asset',
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
      currentPpm = null,
      linkedPpms = [],
      statuses = {},
      statusOf = () => 'pending'
    } = context;

    const phase = clean(auto.phase || '');
    const assetCode = clean(record?.assetCode || auto.assetCode || '');
    const linked = Array.isArray(linkedPpms) ? linkedPpms : [];
    const ppmIdx = Math.max(0, Number(auto.ppmIndex) || 0);
    const ppmResults = auto.ppmResults || statuses[assetCode]?.ppmResults || [];
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

    const savedPpms = ppmResults.filter((row) => clean(row.status) === 'saved');
    const existingPpms = ppmResults.filter((row) => clean(row.status) === 'existing');
    const donePpmCount = savedPpms.length + existingPpms.length;
    if (donePpmCount > 0) {
      const labels = [...savedPpms, ...existingPpms]
        .map((row) => clean(row.instruction || row.ppmKey))
        .filter(Boolean)
        .slice(0, 2);
      const suffix = donePpmCount > labels.length ? ` +${donePpmCount - labels.length} more` : '';
      const slot = linked.length ? ` (${donePpmCount}/${linked.length})` : '';
      doneParts.push(`PPM${slot}${labels.length ? `: ${labels.join('; ')}${suffix}` : ''}`);
    }

    if (!entityId && ['fill', 'filling', 'saving'].includes(phase)) doneParts.push('Workbook row loaded');
    if (!doneParts.length) doneParts.push('Starting this asset cycle');

    const activePpm = currentPpm || linked[ppmIdx] || null;
    const ppmSlot = linked.length ? ` · PPM ${Math.min(ppmIdx + 1, linked.length)}/${linked.length}` : '';
    const now = activePpm?.instruction
      ? `${phaseLabel} — ${clean(activePpm.instruction)}`
      : phaseLabel;

    let next = NEXT_HINT[phase] || '';
    if (phase.startsWith('ppm_status_')) next = NEXT_HINT.ppm_child_closing;
    if (!next) next = 'Continue automatic workflow';

    if (phase === 'ppm_wait_new' && activePpm) {
      next = `Editor opens → fill and save "${clean(activePpm.instruction || activePpm.ppmKey)}"`;
    } else if (phase === 'ppm_next' && linked[ppmIdx]) {
      next = `Create New → "${clean(linked[ppmIdx].instruction || linked[ppmIdx].ppmKey)}"`;
    } else if (phase === 'ppm_cycle_general_wait' || phase === 'asset_save_and_new') {
      next = 'Save and New → asset list → Create New → fill next row';
    } else if (phase === 'navigate') {
      next = 'Click Create New on asset list, then fill next asset';
    } else if (phase === 'asset_save_and_close_wait') {
      next = 'Open next asset New Entity form';
    }

    const pendingPpms = linked
      .filter((ppm) => !ppmResults.some((row) => clean(row.ppmKey) === clean(ppm.ppmKey) && ['saved', 'existing'].includes(clean(row.status))))
      .map((ppm) => clean(ppm.instruction || ppm.ppmKey))
      .filter(Boolean);

    return {
      done: doneParts.join(' · '),
      now,
      next,
      pending: pendingPpms.length ? pendingPpms.slice(0, 3).join('; ') : '',
      assetCode,
      ppmSlot: ppmSlot.trim(),
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
    if (guide.pending && !['ppm_cycle_general_wait', 'asset_save_and_new', 'navigate', 'asset_save_and_close', 'asset_save_and_close_wait', 'complete'].includes(guide.phase)) {
      lines.push(`Queue: ${guide.pending}`);
    }
    return lines.join('\n');
  }

  root.ui = root.ui || {};
  root.ui.workflowGuide = Object.freeze({ buildGuide, formatGuideLines, NEXT_HINT });
})();
