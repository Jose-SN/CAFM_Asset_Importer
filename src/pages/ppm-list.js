(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { wait, visible, isAssistantElement, dispatchClick } = root.core.dom;
  const { entityIdFromUrl, isPpmListPage, isPpmRegisterParentPage } = root.core.pages;
  const { linkedForAsset } = root.data.ppm;
  const $ = () => root.runtime.b;

  function showStep(b, verb, target, detail, options) {
    return root.ui.workflowSteps?.show(b, verb, target, detail, options);
  }

  const PPM_TAB_SETTLE_MS = 1200;
  const CLOSE_BUTTON = 'a[title="Click to close the form without saving changes"][onclick*="Toolbar.Close"], a[onclick*="Toolbar.Close()"]';
  const CREATE_NEW = 'a[title="Create New"][onclick*="Toolbar.New"]';

  function toolbarDocuments() {
    const docs = [document];
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const doc = frame.contentDocument;
        if (doc?.documentElement) docs.push(doc);
      } catch (_) {}
    }
    return docs;
  }

  function findCreateNewControl() {
    for (const doc of toolbarDocuments()) {
      const link = doc.querySelector(CREATE_NEW);
      if (link && !isAssistantElement(link)) return link;
    }
    return null;
  }

  function clickCreateNew() {
    try {
      if (typeof Toolbar !== 'undefined' && typeof Toolbar.New === 'function') {
        Toolbar.New();
        return 'Toolbar.New';
      }
    } catch (_) {}

    const link = findCreateNewControl();
    if (!link) return '';

    if (link.classList.contains('x-button-drop-menu-link')) {
      try {
        if (typeof Toolbar !== 'undefined' && typeof Toolbar.New === 'function') {
          Toolbar.New();
          return 'Toolbar.New-menu-link';
        }
      } catch (_) {}
    }

    const b = $();
    const legacyClick = b?.dispatchLegacySingleClick;
    if (typeof legacyClick === 'function' && legacyClick(link, 'ppm-create-new', 800)) {
      return 'legacy-click';
    }
    if (visible(link)) {
      dispatchClick(link, false, 'Create New');
      return 'create-new-link';
    }
    dispatchClick(link, false, 'Create New');
    return 'create-new-link-forced';
  }

  function ppmGridDocument() {
    if (document.querySelector('[id*="fsiGridPPMs"]')) return document;
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const doc = frame.contentDocument;
        if (doc?.querySelector('[id*="fsiGridPPMs"]')) return doc;
      } catch (_) {}
    }
    return document;
  }

  function clickClose(doc = document) {
    const button = doc.querySelector(CLOSE_BUTTON) || document.querySelector(CLOSE_BUTTON);
    if (button && !isAssistantElement(button)) {
      dispatchClick(button, false, 'Close');
      return 'close-button';
    }
    try {
      if (typeof Toolbar !== 'undefined' && typeof Toolbar.Close === 'function') {
        Toolbar.Close();
        return 'Toolbar.Close';
      }
    } catch (_) {}
    return '';
  }

  async function closeAssetEditorWindow(b, record, entityId) {
    const gridDoc = ppmGridDocument();
    let method = clickClose(document) || clickClose(gridDoc);
    const toolbarClose = root.core.toolbar.findToolbarCloseButton?.();
    if (toolbarClose && !isAssistantElement(toolbarClose)) {
      dispatchClick(toolbarClose, false, 'Close');
      method = method || 'toolbar-close';
    }
    try {
      await chrome.runtime.sendMessage({
        type: 'ASSET_CLOSE_EDITOR_TAB',
        assetCode: record?.assetCode || '',
        assetEntityId: String(entityId || '')
      });
      method = method || 'ASSET_CLOSE_EDITOR_TAB';
    } catch (error) {
      b.addEvent('ppm-list-close-tab-error', { message: String(error?.message || error) });
    }
    await wait(700);
    return method;
  }

  async function handoffToRegisterAfterClose(b, record, entityId, handoff, note) {
    b.state.session.auto = {
      ...(b.state.session.auto || {}),
      ppmRegisterHandoff: handoff,
      ppmRegisterHandoffNote: clean(note),
      ppmListRunning: false
    };
    await b.persistSession();
    const method = await closeAssetEditorWindow(b, record, entityId);
    b.addEvent('ppm-list-handoff', { assetCode: record?.assetCode || '', handoff, method });
    showStep(b, 'Waiting', 'Asset register', 'Editor closing — next step on register tab', {
      meta: record?.assetCode || '',
      wait: true,
      tick: true
    });
    b.scheduleAuto(800);
    return method;
  }

  async function processWaitForNewEditor(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    if (!auto.active || auto.mode !== 'ppm') return;
    if (auto.phase !== 'wait_ppm_new') return;
    if (!isPpmRegisterParentPage() && !isPpmListPage() && !ppmGridDocument().querySelector('[id*="fsiGridPPMs"]')) return;

    const code = record?.assetCode || '';
    showStep(b, 'Waiting', 'New PPM editor', 'Create New — waiting for FPPM form in child window', {
      meta: code,
      wait: true,
      tick: true
    });
    await root.workflow.engine?.touchPpmPhaseProgress?.();
    b.scheduleAuto(700);
  }

  async function processList(record) {
    const b = $();
    let auto = b.state.session.auto || {};
    if (!auto.active) return;
    if (auto.phase !== 'wait_ppm') return;
    if (!isPpmListPage() && !ppmGridDocument().querySelector('[id*="fsiGridPPMs"]')) return;

    if (auto.ppmListRunning) {
      const started = Number(auto.ppmListStartedAt) || 0;
      if (started && Date.now() - started > 25000) {
        b.state.session.auto = { ...auto, ppmListRunning: false };
        await b.persistSession();
      } else {
        b.scheduleAuto(600);
        return;
      }
    }

    if (typeof b.ensureWorkbookLoaded === 'function') {
      await b.ensureWorkbookLoaded();
    }

    const entityId = entityIdFromUrl() || auto.assetEntityId || '';
    b.state.session.auto = {
      ...auto,
      phase: 'wait_ppm',
      ppmListRunning: true,
      ppmListStartedAt: Date.now(),
      assetEntityId: entityId || auto.assetEntityId || '',
      phaseProgressAt: Date.now()
    };
    auto = b.state.session.auto;
    await b.persistSession();
    await root.workflow.engine?.touchPpmPhaseProgress?.();

    const linked = linkedForAsset(record, b.state.ppms || []);
    const code = record?.assetCode || '';
    const ppmIndex = Math.max(0, Number(auto.ppmIndex) || 0);

    try {
      showStep(b, 'PPM tab ready', 'Create New', `Preparing toolbar (${PPM_TAB_SETTLE_MS / 1000}s)`, {
        meta: code,
        wait: true,
        tick: true
      });
      await wait(PPM_TAB_SETTLE_MS);
      await root.workflow.engine?.touchPpmPhaseProgress?.();

      b.addEvent('ppm-list-queue', {
        assetCode: record.assetCode,
        entityId,
        linkedCount: linked.length,
        ppmIndex,
        createNewFound: Boolean(findCreateNewControl())
      });

      if (!linked.length) {
        showStep(b, 'No workbook PPM rows', 'Closing editor', code, { meta: code, wait: false, duration: 4000 });
        const method = await handoffToRegisterAfterClose(b, record, entityId, 'saved', 'No workbook PPM rows for this asset');
        b.addEvent('ppm-list-close', { assetCode: record.assetCode, method, reason: 'no-linked-ppms' });
        return;
      }

      if (ppmIndex >= linked.length) {
        showStep(b, 'Workbook PPM rows done', 'Closing editor', `${linked.length} row(s) processed`, {
          meta: code,
          wait: false,
          duration: 4000,
          type: 'success'
        });
        const method = await handoffToRegisterAfterClose(b, record, entityId, 'saved', 'All workbook PPM rows processed for this asset');
        b.addEvent('ppm-list-close', { assetCode: record.assetCode, method, reason: 'workbook-queue-complete', linkedCount: linked.length });
        return;
      }

      const nextPpm = linked[ppmIndex];
      showStep(
        b,
        'Clicking',
        'Create New',
        `PPM ${ppmIndex + 1} of ${linked.length} — ${clean(nextPpm.instruction) || code}`,
        { meta: code, wait: false, duration: 4000 }
      );

      const method = clickCreateNew();
      b.addEvent('ppm-create-new', {
        assetCode: record.assetCode,
        method,
        instruction: nextPpm.instruction || '',
        ppmIndex,
        linkedCount: linked.length
      });
      if (!method) throw new Error('Create New was not found on the asset PPM list.');

      b.state.session.auto = {
        ...b.state.session.auto,
        phase: 'wait_ppm_new',
        ppmListRunning: false,
        assetEntityId: entityId || auto.assetEntityId || '',
        ppmIndex,
        ppmKey: nextPpm.ppmKey || '',
        ppmInstruction: nextPpm.instruction || '',
        ppmCreateNewAt: Date.now(),
        phaseProgressAt: Date.now()
      };
      await b.persistSession();
      showStep(b, 'Create New sent', 'New PPM window', clean(nextPpm.instruction) || code, { meta: code, wait: true, tick: true });
      b.scheduleAuto(400);
    } finally {
      if (b.state.session.auto?.ppmListRunning) {
        b.state.session.auto = { ...b.state.session.auto, ppmListRunning: false };
        await b.persistSession();
      }
    }
  }

  root.pages = root.pages || {};
  root.pages.ppmList = Object.freeze({ processList, processWaitForNewEditor });
})();
