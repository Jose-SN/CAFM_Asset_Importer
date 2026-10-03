(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { VERSION } = root.core.constants;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;
  let phaseStartedAt = 0;
  let lastStepAt = 0;

  function configure(deps) {
    cfg = Object.freeze({ ...deps });
  }

  function C() {
    if (!cfg) throw new Error('CAFMImporter events module is not configured yet.');
    return cfg;
  }

  function markRunStart() {
    phaseStartedAt = performance.now();
    lastStepAt = phaseStartedAt;
  }

  function stepDurationMs() {
    const now = performance.now();
    const durationMs = Math.round(now - lastStepAt);
    lastStepAt = now;
    return durationMs;
  }

  function addEvent(type, details = {}) {
    const b = C();
    const now = performance.now();
    let durationMs = details.durationMs;
    if (durationMs == null && clean(type) === 'phase' && phaseStartedAt) {
      durationMs = Math.round(now - phaseStartedAt);
    }
    const event = {
      at: new Date().toISOString(),
      type: clean(type),
      version: VERSION,
      url: location.href,
      assetCode: clean(b.workflowRecord(b.state.session.auto)?.assetCode || b.currentRecord()?.assetCode || ''),
      phase: clean(b.state.session.auto?.phase || ''),
      ...(durationMs != null ? { durationMs } : {}),
      ...details
    };
    if (clean(type) === 'phase') phaseStartedAt = now;
    b.state.session.events = [...(b.state.session.events || []), event].slice(-2000);
    return event;
  }

  async function recordValidationWarning(record, details = {}) {
    const b = C();
    if (!record) return;
    const warning = {
      at: new Date().toISOString(),
      scope: clean(details.scope || 'asset'),
      tab: clean(details.tab || ''),
      field: clean(details.field || ''),
      expected: clean(details.expected || ''),
      actual: clean(details.actual || ''),
      reason: clean(details.reason || 'Value could not be verified'),
      ppmKey: clean(details.ppmKey || '')
    };
    const previous = b.state.session.statuses?.[record.assetCode] || {};
    const warnings = [...(previous.validationWarnings || []), warning].slice(-500);
    b.state.session.statuses = b.state.session.statuses || {};
    b.state.session.statuses[record.assetCode] = { ...previous, validationWarnings: warnings, updatedAt: new Date().toISOString() };
    if (b.state.session.auto) {
      b.state.session.auto = {
        ...b.state.session.auto,
        validationWarnings: [...(b.state.session.auto.validationWarnings || []), warning].slice(-500)
      };
    }
    addEvent('validation-warning', warning);
    await b.persistSession();
    const where = [warning.tab, warning.field].filter(Boolean).join(' / ') || warning.scope;
    b.showToast(`Warning: ${where} did not match Excel. Continuing.`, 'warn', 9000);
  }

  root.core = root.core || {};
  root.core.events = Object.freeze({ configure, addEvent, recordValidationWarning, markRunStart, stepDurationMs });
})();
