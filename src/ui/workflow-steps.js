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
      show(b, 'Window 1 idle', 'Asset register', 'Window 2: open asset → PPM tab', { meta, wait: true, tick: true });
      return;
    }
    if (key === 'wait_ppm') {
      show(b, 'Window 1 idle', 'Asset register', 'Window 2: click Create New on PPM tab', { meta, wait: true, tick: true });
      return;
    }
    if (key === 'wait_ppm_new') {
      show(b, 'Window 1 idle', 'Asset register', 'Window 3: new FPPM form should open', { meta, wait: true, tick: true });
      return;
    }
    if (key === 'ppm_fill' || key === 'ppm_filled') {
      show(b, 'Window 1 idle', 'Asset register', 'Window 3: filling PPM from workbook', { meta, wait: true, tick: true });
      return;
    }
    if (key === 'ppm_saving' || key === 'ppm_await_save') {
      show(b, 'Window 1 idle', 'Asset register', 'Window 3: Save and New or Save and Close', { meta, wait: true, tick: true });
      return;
    }
    show(b, 'Waiting', 'Child window', key.replace(/_/g, ' ') || 'workflow', { meta, wait: true, tick: true });
  }

  root.ui = root.ui || {};
  root.ui.workflowSteps = Object.freeze({ show, showRegisterWait });
})();
