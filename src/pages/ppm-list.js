(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { wait, visible, isAssistantElement, dispatchClick } = root.core.dom;
  const { entityIdFromUrl, isPpmListPage } = root.core.pages;
  const { linkedForAsset, instructionCanon } = root.data.ppm;
  const $ = () => root.runtime.b;

  function showStep(b, verb, target, detail, options) {
    return root.ui.workflowSteps?.show(b, verb, target, detail, options);
  }

  /** Single settle delay after PPM tab is shown — then read grid once (no poll loop). */
  const PPM_GRID_SETTLE_MS = 3000;
  const CLOSE_BUTTON = 'a[title="Click to close the form without saving changes"][onclick*="Toolbar.Close"], a[onclick*="Toolbar.Close()"]';
  const CREATE_NEW = 'a[title="Create New"][onclick*="Toolbar.New"]';

  /** fsiGridPPMs data columns: [0]=Open, [1]=PPM ID, [2]=Instruction, [3]=Frequency, … */
  const GRID_COL = Object.freeze({
    open: 0,
    ppmSeq: 1,
    instruction: 2,
    frequency: 3,
    discipline: 4,
    priority: 5
  });

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

  function cellText(td) {
    return clean(td?.textContent || '').replace(/\u00a0/g, ' ');
  }

  function rowFromGridRow(tr) {
    const cells = [...tr.querySelectorAll('td')];
    return {
      ppmSeq: cellText(cells[GRID_COL.ppmSeq]),
      instruction: cellText(cells[GRID_COL.instruction]),
      frequency: cellText(cells[GRID_COL.frequency]),
      discipline: cellText(cells[GRID_COL.discipline]),
      priority: cellText(cells[GRID_COL.priority])
    };
  }

  function instructionMatches(workbookInstruction, gridInstruction) {
    const want = instructionCanon(workbookInstruction);
    const got = instructionCanon(gridInstruction);
    if (!want || !got) return false;
    if (want === got) return true;
    if (want.length >= 8 && got.length >= 8 && (got.includes(want) || want.includes(got))) return true;
    return false;
  }

  function findPpmMasterTable(doc = ppmGridDocument()) {
    return (
      doc.querySelector('table.rgMasterTable[id*="fsiGridPPMs"]')
      || doc.querySelector('table[id*="fsiGridPPMs"].rgMasterTable')
      || doc.querySelector('table.rgMasterTable')
      || doc.querySelector('table[id*="fsiGridPPMs"]')
    );
  }

  function isVisibleDataGridRow(tr) {
    if (!tr || isAssistantElement(tr)) return false;
    if (tr.classList.contains('rgNoRecords')) return false;
    const style = tr.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(style)) return false;
    if (/visibility\s*:\s*hidden/i.test(style)) return false;
    const cells = [...tr.querySelectorAll('td')];
    if (cells.length <= GRID_COL.instruction) return false;
    const instruction = cellText(cells[GRID_COL.instruction]);
    if (!instruction) return false;
    return true;
  }

  function listedPpmRows(doc = ppmGridDocument()) {
    const table = findPpmMasterTable(doc);
    if (!table) return [];
    return [...table.querySelectorAll('tbody tr.rgRow, tbody tr.rgAltRow, tbody tr.rgSelectedRow')]
      .filter(isVisibleDataGridRow)
      .map(rowFromGridRow);
  }

  function rowMatchesPpm(ppm, row) {
    return instructionMatches(ppm.instruction, row.instruction);
  }

  function matchLinkedToListed(linked, listed) {
    const pool = [...listed];
    const matched = [];
    for (const ppm of linked) {
      const idx = pool.findIndex((row) => rowMatchesPpm(ppm, row));
      if (idx < 0) continue;
      matched.push(ppm);
      pool.splice(idx, 1);
    }
    return matched;
  }

  function clickCreateNew(doc = document) {
    const link = doc.querySelector(CREATE_NEW) || document.querySelector(CREATE_NEW);
    if (link && !isAssistantElement(link) && link.classList.contains('x-button-drop-menu-link')) {
      try {
        if (typeof Toolbar !== 'undefined' && typeof Toolbar.New === 'function') {
          Toolbar.New();
          return 'Toolbar.New-menu-link';
        }
      } catch (_) {}
    }
    if (link && visible(link) && !isAssistantElement(link)) {
      dispatchClick(link, false, 'Create New');
      return 'create-new-link';
    }
    try {
      if (typeof Toolbar !== 'undefined' && typeof Toolbar.New === 'function') {
        Toolbar.New();
        return 'Toolbar.New';
      }
    } catch (_) {}
    return '';
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

  async function processList(record) {
    const b = $();
    let auto = b.state.session.auto || {};
    if (!auto.active) return;
    if (auto.phase !== 'wait_ppm') return;
    if (!isPpmListPage() && !ppmGridDocument().querySelector('[id*="fsiGridPPMs"]')) return;

    if (auto.ppmListRunning) {
      b.scheduleAuto(600);
      return;
    }

    if (typeof b.ensureWorkbookLoaded === 'function') {
      await b.ensureWorkbookLoaded();
    }

    const entityId = entityIdFromUrl() || auto.assetEntityId || '';
    b.state.session.auto = {
      ...auto,
      phase: 'wait_ppm',
      ppmListRunning: true,
      assetEntityId: entityId || auto.assetEntityId || ''
    };
    auto = b.state.session.auto;
    await b.persistSession();

    const gridDoc = ppmGridDocument();
    const linked = linkedForAsset(record, b.state.ppms || []);
    const code = record?.assetCode || '';

    try {
      showStep(b, 'PPM tab ready', 'Checking PPM data', `Waiting ${PPM_GRID_SETTLE_MS / 1000}s for grid`, {
        meta: code,
        wait: true,
        tick: true
      });
      await wait(PPM_GRID_SETTLE_MS);
      const gridDocAfter = ppmGridDocument();
      const masterTable = findPpmMasterTable(gridDocAfter);
      const listed = listedPpmRows(gridDocAfter);
      showStep(b, 'Checking', 'PPM instructions', `${listed.length} grid row(s), ${linked.length} workbook row(s)`, {
        meta: code,
        wait: false,
        duration: 4000
      });
      const matched = matchLinkedToListed(linked, listed);
      b.addEvent('ppm-list-scan', {
        assetCode: record.assetCode,
        entityId,
        masterTableId: masterTable?.id || '',
        listedCount: listed.length,
        linkedCount: linked.length,
        matchedCount: matched.length,
        listedInstructions: listed.map((row) => row.instruction),
        linkedInstructions: linked.map((ppm) => ppm.instruction)
      });

      if (!linked.length) {
        showStep(b, 'PPM check done', 'No workbook rows', 'Closing PPM window', { meta: code, wait: false, duration: 4000 });
        await root.pages.assetSearch.finishRow(record, 'saved', 'No workbook PPM rows for this asset', { schedule: true });
        const method = clickClose(gridDoc);
        b.addEvent('ppm-list-close', { assetCode: record.assetCode, method, reason: 'no-linked-ppms' });
        showStep(b, 'Window closed', 'PPM list', 'Checking next asset on register', { meta: code, wait: false, duration: 5000, type: 'success' });
        return;
      }

      if (matched.length !== linked.length) {
        const ppmIndex = linked.findIndex((ppm) => !listed.some((row) => rowMatchesPpm(ppm, row)));
        const nextPpm = linked[Math.max(0, ppmIndex)];
        showStep(b, 'PPM data not fully matched', 'Create New', `${matched.length}/${linked.length} found — ${clean(nextPpm.instruction) || 'next row'}`, {
          meta: code,
          wait: false,
          duration: 6000,
          type: 'warn'
        });
        b.state.session.auto = {
          ...b.state.session.auto,
          phase: 'wait_ppm_new',
          ppmListRunning: false,
          assetEntityId: entityId || auto.assetEntityId || '',
          ppmIndex: Math.max(0, ppmIndex),
          ppmKey: nextPpm.ppmKey || '',
          ppmInstruction: nextPpm.instruction || ''
        };
        await b.persistSession();
        const method = clickCreateNew(gridDoc);
        b.addEvent('ppm-create-new', {
          assetCode: record.assetCode,
          method,
          instruction: nextPpm.instruction || '',
          listedCount: listed.length,
          linkedCount: linked.length,
          matchedCount: matched.length
        });
        if (!method) throw new Error('Create New was not found on the asset PPM list.');
        showStep(b, 'Opening', 'New PPM editor', clean(nextPpm.instruction) || code, { meta: code, wait: true, tick: true });
        b.scheduleAuto(500);
        return;
      }

      showStep(b, 'PPM data matched', 'All workbook rows', `${matched.length}/${linked.length} in CAFM grid`, {
        meta: code,
        wait: false,
        duration: 4000,
        type: 'success'
      });
      showStep(b, 'Closing', 'PPM window', 'Clicking Close — return to asset register', { meta: code, wait: true, tick: true });
      await root.pages.assetSearch.finishRow(record, 'saved', 'PPM list complete for this asset', { schedule: true });
      const method = clickClose(gridDoc);
      b.addEvent('ppm-list-close', {
        assetCode: record.assetCode,
        method,
        matched: matched.map((ppm) => ppm.instruction)
      });
      showStep(b, 'Window closed', 'PPM list', method ? 'Checking next asset on register' : 'Close button not found — close manually', {
        meta: code,
        wait: false,
        duration: method ? 6000 : 10000,
        type: method ? 'success' : 'warn'
      });
    } finally {
      if (b.state.session.auto?.ppmListRunning) {
        b.state.session.auto = { ...b.state.session.auto, ppmListRunning: false };
        await b.persistSession();
      }
    }
  }

  root.pages = root.pages || {};
  root.pages.ppmList = Object.freeze({ processList });
})();
