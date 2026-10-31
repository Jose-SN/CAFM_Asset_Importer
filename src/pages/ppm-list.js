(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { wait, visible, isAssistantElement, dispatchClick } = root.core.dom;
  const { entityIdFromUrl, isPpmListPage } = root.core.pages;
  const { linkedForAsset, instructionCanon } = root.data.ppm;
  const $ = () => root.runtime.b;

  const GRID_WAIT_MS = 4000;
  const GRID_POLL_MS = 150;
  const CLOSE_BUTTON = 'a[title="Click to close the form without saving changes"][onclick*="Toolbar.Close"], a[onclick*="Toolbar.Close()"]';
  const CREATE_NEW = 'a[title="Create New"][onclick*="Toolbar.New"]';

  function cellText(td) {
    return clean(td?.textContent || '').replace(/\u00a0/g, ' ');
  }

  function listedPpms() {
    const rows = [...document.querySelectorAll('[id*="fsiGridPPMs"] tr.rgRow, [id*="fsiGridPPMs"] tr.rgAltRow, [id*="fsiGridPPMs"] tr.rgSelectedRow')];
    return rows
      .filter((row) => visible(row) && !isAssistantElement(row))
      .map((row) => {
        const cells = [...row.querySelectorAll('td')];
        return {
          instruction: cellText(cells[2]),
          frequency: cellText(cells[3]),
          discipline: cellText(cells[4]),
          priority: cellText(cells[5])
        };
      })
      .filter((row) => row.instruction);
  }

  function rowMatchesPpm(ppm, row) {
    if (instructionCanon(ppm.instruction) !== instructionCanon(row.instruction)) return false;
    if (clean(ppm.frequency) && instructionCanon(ppm.frequency) !== instructionCanon(row.frequency)) return false;
    return true;
  }

  async function waitForGrid() {
    const deadline = Date.now() + GRID_WAIT_MS;
    while (Date.now() < deadline) {
      if (document.querySelector('[id*="fsiGridPPMs"]')) return listedPpms();
      await wait(GRID_POLL_MS);
    }
    return listedPpms();
  }

  function clickCreateNew() {
    const link = document.querySelector(CREATE_NEW);
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

  function clickClose() {
    const button = document.querySelector(CLOSE_BUTTON);
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
    const auto = b.state.session.auto || {};
    if (!auto.active || auto.phase !== 'wait_ppm') return;
    if (!isPpmListPage()) return;

    const listed = await waitForGrid();
    const linked = linkedForAsset(record, b.state.ppms || []);
    const matched = linked.filter((ppm) => listed.some((row) => rowMatchesPpm(ppm, row)));
    b.addEvent('ppm-list-scan', {
      assetCode: record.assetCode,
      entityId: entityIdFromUrl(),
      listedCount: listed.length,
      linkedCount: linked.length,
      matchedCount: matched.length,
      listedInstructions: listed.map((row) => row.instruction)
    });

    if (!linked.length) {
      b.state.session.auto = { ...auto, phase: 'ppm_ready', assetEntityId: entityIdFromUrl() || auto.assetEntityId || '' };
      await b.persistSession();
      b.render();
      b.showToast(`${record.assetCode}: PPM list is open. No workbook PPM rows for this asset.`, 'info', 9000);
      return;
    }

    if (matched.length !== linked.length) {
      const ppmIndex = linked.findIndex((ppm) => !listed.some((row) => rowMatchesPpm(ppm, row)));
      const nextPpm = linked[Math.max(0, ppmIndex)];
      b.state.session.auto = {
        ...auto,
        phase: 'wait_ppm_new',
        assetEntityId: entityIdFromUrl() || auto.assetEntityId || '',
        ppmIndex: Math.max(0, ppmIndex),
        ppmKey: nextPpm.ppmKey || '',
        ppmInstruction: nextPpm.instruction || ''
      };
      await b.persistSession();
      const method = clickCreateNew();
      b.addEvent('ppm-create-new', {
        assetCode: record.assetCode,
        method,
        instruction: nextPpm.instruction || '',
        listedCount: listed.length,
        linkedCount: linked.length
      });
      if (!method) throw new Error('Create New was not found on the asset PPM list.');
      b.showActivity?.('Clicking', 'Create New', nextPpm.instruction || record.assetCode, { wait: true, meta: record.assetCode, tick: true });
      b.showToast(`${record.assetCode}: listed PPMs do not match the workbook. Opening Create New.`, 'info', 8000);
      return;
    }

    b.showActivity?.('Closing', 'Asset window', 'PPM already listed', { wait: false, meta: record.assetCode, duration: 4000, tick: false });
    await root.pages.assetSearch.finishRow(record, 'existing', 'PPM already listed on the asset', { schedule: false });
    const method = clickClose();
    b.addEvent('ppm-list-close', {
      assetCode: record.assetCode,
      method,
      matched: matched.map((ppm) => ppm.instruction)
    });
    b.showToast(`${record.assetCode}: matching PPM(s) already listed. Closing the asset window.`, 'success', 8000);
  }

  root.pages = root.pages || {};
  root.pages.ppmList = Object.freeze({ processList });
})();
