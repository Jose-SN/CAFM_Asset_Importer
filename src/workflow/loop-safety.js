(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;

  const DEFAULT_MAX = 25;
  const MIN_MAX = 5;
  const HARD_CAP = 500;

  /** Single configurable cap for runaway loops (refresh, same-phase poll, toolbar retries). Not asset row count. */
  function safetyLoopMaxSteps(settings) {
    const raw = Number(
      settings?.safetyLoopMaxSteps
      ?? settings?.workflowLoopMaxSteps
      ?? settings?.ppmRegisterRefreshMaxClicks
      ?? DEFAULT_MAX
    );
    return Math.max(MIN_MAX, Math.min(HARD_CAP, Math.floor(raw) || DEFAULT_MAX));
  }

  function workflowLoopMaxSteps(settings) {
    return safetyLoopMaxSteps(settings);
  }

  function ppmRegisterRefreshMaxClicks(settings) {
    return safetyLoopMaxSteps(settings);
  }

  function toolbarActionMaxAttempts(settings) {
    return safetyLoopMaxSteps(settings);
  }

  function freshLoopCounters() {
    return {
      workflowLoopPhase: '',
      workflowLoopCount: 0,
      ppmRegisterRefreshTotal: 0,
      autoOrchestratorTicks: 0
    };
  }

  function resetSafetyLoopCounters() {
    return freshLoopCounters();
  }

  function nextWorkflowLoopFields(auto, settings) {
    const phase = clean(auto?.phase || '') || 'unknown';
    const max = safetyLoopMaxSteps(settings);
    const prevPhase = clean(auto?.workflowLoopPhase || '');
    const count = phase === prevPhase ? Number(auto?.workflowLoopCount || 0) + 1 : 1;
    if (count > max) {
      throw new Error(
        `Automatic import stopped: phase "${phase.replace(/_/g, ' ')}" repeated ${max} times without completing. ` +
        'Close extra CAFM tabs, download diagnostic JSON, then Resume or restart. ' +
        `(Safety loop limit — increase "Max safety loop steps" in the panel if needed.)`
      );
    }
    const fields = { workflowLoopPhase: phase, workflowLoopCount: count };
    if (phase !== prevPhase) {
      fields.autoOrchestratorTicks = 0;
    }
    return fields;
  }

  function ppmRegisterRefreshTotal(auto) {
    return Number(auto?.ppmRegisterRefreshTotal || 0);
  }

  function assertPpmRegisterRefreshAllowed(auto, settings) {
    const max = safetyLoopMaxSteps(settings);
    const total = ppmRegisterRefreshTotal(auto);
    if (total >= max) {
      throw new Error(
        `PPM register Refresh limit reached (${max} clicks for this asset). Close extra CAFM PPM tabs, pause automatic import, then Resume. ` +
        '(Adjust "Max safety loop steps" in the panel if your site needs more retries.)'
      );
    }
  }

  function assertToolbarActionAllowed(auto, settings, actionLabel = 'toolbar action') {
    const max = safetyLoopMaxSteps(settings);
    const key = `toolbarRetry_${String(actionLabel).replace(/\W+/g, '_')}`;
    const counts = auto?.toolbarRetryCounts || {};
    const total = Number(counts[key] || 0);
    if (total >= max) {
      throw new Error(
        `${actionLabel} retry limit reached (${max} attempts for this asset). Pause automatic import, fix CAFM, then Resume.`
      );
    }
  }

  function bumpToolbarActionRetry(auto, actionLabel = 'toolbar action') {
    const key = `toolbarRetry_${String(actionLabel).replace(/\W+/g, '_')}`;
    const counts = { ...(auto?.toolbarRetryCounts || {}) };
    counts[key] = Number(counts[key] || 0) + 1;
    return { toolbarRetryCounts: counts };
  }

  function bumpPpmRegisterRefreshTotal(auto) {
    return { ppmRegisterRefreshTotal: ppmRegisterRefreshTotal(auto) + 1 };
  }

  function nextOrchestratorTickFields(auto, settings) {
    const max = safetyLoopMaxSteps(settings);
    const count = Number(auto?.autoOrchestratorTicks || 0) + 1;
    if (count > max) {
      throw new Error(
        `Background workflow polling stopped after ${max} ticks without finishing the current step. Pause and Resume, or reload the CAFM tab.`
      );
    }
    return { autoOrchestratorTicks: count };
  }

  root.workflow = root.workflow || {};
  root.workflow.loopSafety = Object.freeze({
    freshLoopCounters,
    resetSafetyLoopCounters,
    nextWorkflowLoopFields,
    assertPpmRegisterRefreshAllowed,
    assertToolbarActionAllowed,
    bumpToolbarActionRetry,
    bumpPpmRegisterRefreshTotal,
    ppmRegisterRefreshTotal,
    nextOrchestratorTickFields,
    safetyLoopMaxSteps,
    workflowLoopMaxSteps,
    ppmRegisterRefreshMaxClicks,
    toolbarActionMaxAttempts
  });
})();
