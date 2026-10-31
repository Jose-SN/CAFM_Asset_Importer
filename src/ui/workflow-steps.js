(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;

  function show(b, verb, target, detail = '', options = {}) {
    if (!b?.showActivity) return;
    b.showActivity(clean(verb), clean(target), clean(detail), {
      wait: options.wait !== false,
      type: options.type || 'info',
      meta: clean(options.meta || ''),
      tick: options.tick !== false && options.wait !== false,
      duration: Math.max(0, Number(options.duration) || 0)
    });
  }

  /** Register tab is idle while child windows run — show what the child should be doing. */
  function showRegisterWait(b, phase, record) {
    const code = clean(record?.assetCode || b?.state?.session?.auto?.assetCode || '');
    const meta = code ? `Asset ${code}` : '';
    const key = clean(phase || '');
    if (key === 'wait_asset') {
      show(b, 'Waiting', 'Asset editor window', 'Child tab: switch to PPM register', { meta, wait: true, tick: true });
      return;
    }
    if (key === 'wait_ppm') {
      show(b, 'Waiting', 'PPM register', 'Child tab: Create New for next workbook row', { meta, wait: true, tick: true });
      return;
    }
    if (key === 'wait_ppm_new') {
      show(b, 'Waiting', 'New PPM form', 'Child tab: Create New → fill from Excel', { meta, wait: true, tick: true });
      return;
    }
    if (key === 'ppm_fill' || key === 'ppm_filled') {
      show(b, 'Waiting', 'PPM fill', 'Child tab: filling new PPM fields', { meta, wait: true, tick: true });
      return;
    }
    if (key === 'ppm_saving' || key === 'ppm_await_save') {
      show(b, 'Waiting', 'PPM save', 'Child tab: Save and New or Save and Close', { meta, wait: true, tick: true });
      return;
    }
    show(b, 'Waiting', 'Child window', key.replace(/_/g, ' ') || 'workflow', { meta, wait: true, tick: true });
  }

  root.ui = root.ui || {};
  root.ui.workflowSteps = Object.freeze({ show, showRegisterWait });
})();
