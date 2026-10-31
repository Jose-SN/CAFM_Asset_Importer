(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { wait, visible, isAssistantElement, dispatchClick } = root.core.dom;
  const { typeIntoInlineLookup } = root.core.lookup;
  const { isAssetListPage } = root.core.pages;
  const { VERSION } = root.core.constants;
  const $ = () => root.runtime.b;

  const FILTER_INPUT = 'input.rcbInput[id*="listFASSET_AR_CODE_3_Input"]';
  const FILTER_DROPDOWN = '[id*="listFASSET_AR_CODE_3_DropDown"]';
  const OPEN_LINK = 'a.gridImageColumn[title="Open dialog to edit the selected entity"]';
  const SEARCH_WAIT_MS = 5000;
  const SEARCH_POLL_MS = 100;
  const OPTION_WAIT_MS = 4000;
  const OPTION_POLL_MS = 150;
  const AFTER_CLICK_MS = 300;
  const DONE = new Set(['found', 'not_found', 'skipped', 'saved', 'existing']);

  function findFilterInput() {
    const el = document.querySelector(FILTER_INPUT);
    return el instanceof HTMLInputElement && visible(el) && !isAssistantElement(el) ? el : null;
  }

  function withoutLastHyphenSegment(code) {
    const full = clean(code);
    const idx = full.lastIndexOf('-');
    if (idx <= 0) return '';
    return clean(full.slice(0, idx));
  }

  function isEmptyDropdownText(text) {
    const t = clean(text);
    return !t || /^(no (records|matches|items|data)|no selection)$/i.test(t);
  }

  function dropdownItems() {
    const drop = document.querySelector(FILTER_DROPDOWN);
    if (!drop || !visible(drop)) return [];
    return [...drop.querySelectorAll('ul.rcbList li')]
      .filter((li) => visible(li) && !isAssistantElement(li) && !isEmptyDropdownText(li.textContent));
  }

  function findDropdownOption(code) {
    const wanted = norm(code);
    if (!wanted) return null;
    const items = dropdownItems();
    return items.find((li) => norm(li.textContent) === wanted)
      || items.find((li) => {
        const text = norm(li.textContent);
        return text.startsWith(`${wanted} `) || text.startsWith(`${wanted}-`) || text.includes(wanted);
      })
      || null;
  }

  async function waitForDropdownOption(code, timeoutMs = SEARCH_WAIT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const option = findDropdownOption(code);
      if (option) return option;
      await wait(SEARCH_POLL_MS);
    }
    return findDropdownOption(code);
  }

  async function focusAndSearch(input, term) {
    dispatchClick(input, false);
    try { input.focus(); } catch (_) {}
    await wait(0);
    await typeIntoInlineLookup(input, term);
  }

  function missingAssetCodes() {
    const log = $().state.session.missingAssetLog;
    if (Array.isArray(log?.codes)) {
      return log.codes.map((item) => (typeof item === 'string' ? item : item?.assetCode)).filter(Boolean);
    }
    const list = $().state.session.missingAssetCodes;
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  function missingAssetLog() {
    const b = $();
    const existing = b.state.session.missingAssetLog;
    if (existing && typeof existing === 'object' && Array.isArray(existing.codes)) return existing;
    return {
      generatedAt: new Date().toISOString(),
      updatedAt: '',
      extensionVersion: VERSION,
      fileName: 'missing-asset-codes.json',
      page: {
        url: String(location.href || ''),
        title: String(document.title || '')
      },
      workbook: {
        fileName: b.state.session.fileName || '',
        assetsLoaded: (b.state.assets || []).length
      },
      codes: []
    };
  }

  async function recordMissingCode(record, code) {
    const b = $();
    const log = missingAssetLog();
    const already = (log.codes || []).some((item) => norm(typeof item === 'string' ? item : item?.assetCode) === norm(code));
    if (!already) {
      log.codes = [...(log.codes || []), {
        assetCode: code,
        workbookRow: Number(record?.workbookRow) || 0,
        at: new Date().toISOString()
      }];
    }
    if (!log.generatedAt) log.generatedAt = new Date().toISOString();
    log.updatedAt = new Date().toISOString();
    log.extensionVersion = VERSION;
    log.fileName = 'missing-asset-codes.json';
    log.page = { url: String(location.href || ''), title: String(document.title || '') };
    log.workbook = { fileName: b.state.session.fileName || '', assetsLoaded: (b.state.assets || []).length };
    b.state.session.missingAssetLog = log;
    b.state.session.missingAssetCodes = missingAssetCodes();
    await b.persistSession();
  }

  function savedAssetCodes() {
    const list = $().state.session.savedAssetCodes;
    return Array.isArray(list) ? list.filter(Boolean) : [];
  }

  function isAssetFinished(record) {
    const code = norm(record?.assetCode);
    if (!code) return false;
    if (DONE.has($().statusOf(record))) return true;
    if (savedAssetCodes().some((item) => norm(item) === code)) return true;
    if (missingAssetCodes().some((item) => norm(item) === code)) return true;
    return false;
  }

  function nextSearchIndex(start) {
    const assets = $().state.assets || [];
    for (let i = Math.max(0, Number(start) || 0); i < assets.length; i += 1) {
      if (!isAssetFinished(assets[i])) return i;
    }
    return -1;
  }

  function findGridRow(code) {
    const rows = [...document.querySelectorAll('tr.rgRow, tr.rgAltRow, tr.rgSelectedRow')];
    return rows.find((row) => {
      if (!visible(row) || isAssistantElement(row)) return false;
      return [...row.querySelectorAll('td')].some((td) => norm(td.textContent) === norm(code));
    }) || null;
  }

  function findOpenLink(row) {
    if (!row) return null;
    const link = row.querySelector(OPEN_LINK);
    return link && visible(link) && !isAssistantElement(link) ? link : null;
  }

  async function waitForGridRow(code) {
    const deadline = Date.now() + OPTION_WAIT_MS;
    while (Date.now() < deadline) {
      const row = findGridRow(code);
      if (row && findOpenLink(row)) return row;
      await wait(OPTION_POLL_MS);
    }
    return findGridRow(code);
  }

  async function stayOnOpenedAsset(record) {
    const b = $();
    if (!DONE.has(b.statusOf(record))) {
      await b.setStatus(record, 'found', 'Asset row opened');
    }
    b.state.session.auto = {
      active: true,
      mode: 'ppm',
      phase: 'wait_asset',
      index: Number(b.state.session.index || 0),
      assetCode: record.assetCode,
      processedThisRun: Number(b.state.session.auto?.processedThisRun || 0),
      startedAt: b.state.session.auto?.startedAt
    };
    await b.persistSession();
    b.render();
    b.showToast(`${record.assetCode} opened. Waiting on the asset details window.`, 'success', 8000);
  }

  async function completeRun(processed) {
    const b = $();
    const missingCount = missingAssetCodes().length;
    b.state.session.auto = {
      ...(b.state.session.auto || {}),
      active: false,
      phase: 'complete',
      processedThisRun: processed,
      completedAt: Date.now()
    };
    await b.persistSession();
    b.render();
    const extra = missingCount
      ? ` ${missingCount} Asset Code(s) were not in the register. They are stored in missing-asset-codes.json.`
      : '';
    b.showToast(`Asset Code search complete. ${savedAssetCodes().length} saved, ${processed} row(s) processed.${extra}`, missingCount ? 'warn' : 'success', 12000);
  }

  async function rememberCompletedAsset(record) {
    const b = $();
    const code = clean(record?.assetCode);
    if (!code) return;
    const list = savedAssetCodes();
    if (!list.some((item) => norm(item) === norm(code))) {
      b.state.session.savedAssetCodes = [...list, code];
    }
  }

  async function goToNext(fromIndex, processed, options = {}) {
    const b = $();
    const assets = b.state.assets || [];
    const startedAt = b.state.session.auto?.startedAt;
    b.state.session.currentLookupEvidence = [];
    if (processed >= assets.length) {
      await completeRun(processed);
      return;
    }
    const next = nextSearchIndex(fromIndex + 1);
    if (next < 0 || next <= fromIndex) {
      await completeRun(processed);
      return;
    }
    b.state.session.index = next;
    b.state.session.auto = {
      active: true,
      mode: 'ppm',
      phase: 'search',
      index: next,
      assetCode: assets[next].assetCode,
      processedThisRun: processed,
      startedAt
    };
    await b.persistSession();
    b.render();
    if (options.schedule !== false) b.scheduleAuto(400);
  }

  async function finishRow(record, status, note, options = {}) {
    const b = $();
    const fromIndex = Math.max(0, Number(b.state.session.index) || 0);
    const current = b.statusOf(record);
    if (!DONE.has(current) || (status === 'existing' && current === 'found') || (status === 'saved' && current === 'found')) {
      await b.setStatus(record, status, note);
    }
    if (status === 'saved' || status === 'existing') await rememberCompletedAsset(record);
    const processed = Math.max(savedAssetCodes().length, Number(b.state.session.auto?.processedThisRun || 0) + 1);
    await goToNext(fromIndex, processed, options);
  }

  async function recordMissingAsset(record, code) {
    const b = $();
    await recordMissingCode(record, code);
    b.addEvent('asset-search-not-found', { assetCode: code, workbookRow: record.workbookRow });
    b.showToast(`Asset Code ${code} was not found. It was added to missing-asset-codes.json.`, 'warn', 8000);
    await finishRow(record, 'not_found', 'Asset Code not found in the register filter');
  }

  async function processSearch(record) {
    const b = $();
    const auto = b.state.session.auto || {};
    if (auto.phase !== 'search' || !auto.active) return;
    if (!isAssetListPage()) throw new Error('Open the Asset register (ViewFASSETItems.aspx) before searching.');

    const fromIndex = Math.max(0, Number(b.state.session.index) || 0);
    if (isAssetFinished(record) && b.statusOf(record) !== 'found') {
      await goToNext(fromIndex, Number(auto.processedThisRun || 0) || savedAssetCodes().length);
      return;
    }

    const code = clean(record?.assetCode);
    if (!code) throw new Error(`Workbook row ${record?.workbookRow || '?'} has no Asset Code.`);
    const input = findFilterInput();
    if (!input) throw new Error('Asset Code filter box was not found on the register (listFASSET_AR_CODE_3).');

    b.showActivity?.('Searching', 'Asset Code filter', code, { wait: true, meta: code, tick: true });
    b.addEvent('asset-search-focus', { assetCode: code, previous: clean(input.value) });
    await focusAndSearch(input, code);
    b.addEvent('asset-search-type', { assetCode: code, workbookRow: record.workbookRow, term: code });

    let option = await waitForDropdownOption(code, SEARCH_WAIT_MS);
    let usedTerm = code;
    if (!option) {
      const shorter = withoutLastHyphenSegment(code);
      if (shorter && norm(shorter) !== norm(code)) {
        b.addEvent('asset-search-retry', { assetCode: code, term: shorter });
        b.showActivity?.('Searching', 'Asset Code filter', shorter, { wait: true, meta: code, tick: true });
        await focusAndSearch(input, shorter);
        option = await waitForDropdownOption(code, SEARCH_WAIT_MS);
        usedTerm = shorter;
      }
    }
    if (!option) {
      await recordMissingAsset(record, code);
      return;
    }

    dispatchClick(option, false);
    b.addEvent('asset-search-select', {
      assetCode: code,
      selected: clean(option.textContent),
      typed: usedTerm
    });

    const row = await waitForGridRow(code);
    const openLink = findOpenLink(row);
    if (!openLink) {
      b.showToast(`Asset Code ${code} was selected, but the register row open button was not found.`, 'warn', 10000);
      await recordMissingAsset(record, code);
      return;
    }

    await stayOnOpenedAsset(record);
    dispatchClick(openLink, false);
    b.addEvent('asset-search-open', { assetCode: code, workbookRow: record.workbookRow });
    await wait(AFTER_CLICK_MS);
  }

  root.pages = root.pages || {};
  root.pages.assetSearch = Object.freeze({
    processSearch,
    nextSearchIndex,
    missingAssetCodes,
    missingAssetLog,
    finishRow
  });
})();
