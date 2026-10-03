(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { visible, isAssistantElement } = root.core.dom;
  const { isPpmListPage, isHashPpmParentPage, entityIdFromUrl } = root.core.pages;
  const $ = () => root.runtime.b;

  function findLearnedPpmNewButton() {
    const b = $();
    const learned = b.state.learnedNew;
    if (!learned) return null;
    const docs = b.sameOriginDocuments();
    const preferred = docs.filter((doc) => {
      try { return !learned.frameUrl || doc.location.href === learned.frameUrl || new URL(doc.location.href).pathname === new URL(learned.frameUrl).pathname; }
      catch (_) { return false; }
    });
    for (const doc of [...preferred, ...docs.filter((d) => !preferred.includes(d))]) {
      const found = b.elementFromLearnedFingerprint(doc, learned);
      if (found) return found;
    }
    return null;
  }

  function ppmNewTextNodeFallback() {
    if (!isPpmListPage()) return null;
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      let node;
      while ((node = walker.nextNode())) {
        if (norm(node.nodeValue) !== 'new') continue;
        let el = node.parentElement;
        if (!el || !visible(el) || isAssistantElement(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.top < -8 || r.top > 92 || r.left < 140 || r.left > 360) continue;
        let clickable = el;
        for (let depth = 0; clickable && depth < 9; depth += 1, clickable = clickable.parentElement) {
          if (!visible(clickable) || isAssistantElement(clickable)) continue;
          const cr = clickable.getBoundingClientRect();
          if (cr.top < -10 || cr.top > 105 || cr.left < 135 || cr.left > 410 || cr.width > 280 || cr.height > 105) continue;
          const clue = norm(`${clickable.textContent || ''} ${clickable.getAttribute?.('onclick') || ''} ${clickable.getAttribute?.('href') || ''} ${clickable.getAttribute?.('title') || ''}`);
          let score = 0;
          if (clickable.matches?.('a,button,[role="button"],[onclick],td,li')) score += 3000;
          if (/new/.test(clue)) score += 1800;
          if (getComputedStyle(clickable).cursor === 'pointer') score += 900;
          score += Math.max(0, 1200 - Math.abs(cr.left - 200) * 6 - Math.abs(cr.top - 73) * 9);
          hits.push({ node: clickable, score, rect: cr });
        }
      }
      hits.sort((a, b) => b.score - a.score || a.rect.width - b.rect.width);
      return hits[0]?.node || null;
    } catch (_) { return null; }
  }

  function findNewButton() {
    if (!isPpmListPage()) return null;
    for (const doc of $().sameOriginDocuments()) {
      try {
        const exact = doc.querySelector('a[title="Create New"][onclick*="Toolbar.New"]');
        if (exact && visible(exact)) return exact;
      } catch (_) {}
    }
    const learned = findLearnedPpmNewButton();
    if (learned) return learned;
    const nodes = [...document.querySelectorAll('a,button,[role="button"],[onclick],td,li,span,div,input[type="button"],input[type="image"],img')];
    const scored = [];
    for (const el of nodes) {
      if (!visible(el) || isAssistantElement(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < -8 || rect.top > 92 || rect.left < 145 || rect.left > 450 || rect.height < 8 || rect.height > 85) continue;
      const text = norm(`${el.textContent || ''} ${el.getAttribute?.('value') || ''} ${el.getAttribute?.('title') || ''} ${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('alt') || ''}`);
      const isNew = text === 'new' || text === '+ new' || /(^|\s|\+)new($|\s)/.test(text) || /create\s+(new\s+)?ppm/.test(text);
      if (!isNew) continue;
      let clickable = el.closest?.('a,button,[role="button"],[onclick]') || null;
      if (!clickable) {
        let node = el;
        for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
          if (node.matches?.('a,button,[role="button"],[onclick],td,li')) { clickable = node; break; }
        }
      }
      clickable = clickable || el;
      if (!visible(clickable)) continue;
      const cr = clickable.getBoundingClientRect();
      if (cr.top < -10 || cr.top > 105 || cr.left < 135 || cr.left > 490 || cr.width > 280 || cr.height > 100) continue;
      let score = 0;
      if (clickable.matches?.('a,button,[role="button"],[onclick]')) score += 2500;
      if (text === 'new' || text === '+ new') score += 1800;
      score += Math.max(0, 1000 - Math.abs(cr.left - 205) * 5 - Math.abs(cr.top - 74) * 8);
      score -= Math.max(0, cr.width - 100) * 2;
      scored.push({ node: clickable, score, rect: cr });
    }
    scored.sort((a, b) => b.score - a.score || a.rect.width - b.rect.width);
    if (scored[0]?.node) return scored[0].node;
    return ppmNewTextNodeFallback();
  }

  function ppmToolbarButtonState(button, selector = '') {
    if (!button) return { found: false, selector, disabled: null, ariaDisabled: '', onclick: '', title: '' };
    return {
      found: true,
      selector,
      disabled: button.getAttribute('disabled'),
      ariaDisabled: button.getAttribute('aria-disabled') || '',
      onclick: button.getAttribute('onclick') || '',
      title: button.getAttribute('title') || '',
      visible: visible(button)
    };
  }

  function exactPpmNewButton() {
    if (!isPpmListPage()) return null;
    try {
      return document.querySelector('a[title="Create New"][onclick*="Toolbar.New"]');
    } catch (_) { return null; }
  }

  function exactPpmRefreshButton() {
    if (!isPpmListPage()) return null;
    try {
      return document.querySelector('a[title="Refresh the page"][onclick*="Toolbar.Refresh"]');
    } catch (_) { return null; }
  }

  function clickPpmNewToolbar(guardKey = 'ppm-new') {
    const b = $();
    const selector = 'a[title="Create New"][onclick*="Toolbar.New"]';
    const button = exactPpmNewButton() || findNewButton();
    const stateInfo = ppmToolbarButtonState(button, selector);
    b.addEvent('ppm-create-new-check', { guardKey, ...stateInfo });
    if (!button) throw new Error('The Create New control was not detected on the PPM register toolbar.');
    if (button.hasAttribute('disabled') || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
      throw new Error('The Create New control is currently disabled.');
    }
    button.click();
    b.addEvent('ppm-create-new-click', { guardKey, ...stateInfo, clickCalled: true });
    return true;
  }

  const ppmInstructionCanon = root.core.lookup.ppmInstructionCanon;

  function ppmListContainsCurrent(ppm) {
    if (!ppm) return false;
    const text = ppmInstructionCanon(document.body?.innerText || '');
    const instruction = ppmInstructionCanon(ppm.instruction || '');
    return Boolean(instruction && text.includes(instruction));
  }

  function ppmListEntityId(ppm) {
    if (!ppm) return '';
    const instruction = ppmInstructionCanon(ppm.instruction || '');
    if (!instruction) return '';
    const rows = [...document.querySelectorAll('tr')].filter(visible);
    for (const row of rows) {
      const text = ppmInstructionCanon(row.textContent || '');
      if (!text.includes(instruction)) continue;
      for (const link of row.querySelectorAll('a[href]')) {
        try {
          const u = new URL(link.href, location.href);
          if (/ViewFPPMItem\.aspx/i.test(u.pathname) && u.searchParams.get('id')) return u.searchParams.get('id');
        } catch (_) {}
      }
      const cells = [...row.querySelectorAll('td')].map((td) => clean(td.textContent));
      const numeric = cells.find((value) => /^\d{2,}$/.test(value));
      if (numeric) return numeric;
    }
    return '';
  }

  async function processPpmListPage(record) {
    const b = $();
    let auto = b.state.session.auto || {};

    if (!isHashPpmParentPage()) {
      b.addEvent('ppm-register-passive-no-hash', { url: location.href, assetCode: record?.assetCode || '' });
      await b.persistSession();
      return;
    }

    if (auto.phase === 'ppm_parent_refresh') {
      const selector = 'a[title="Refresh the page"][onclick*="Toolbar.Refresh"]';
      const button = exactPpmRefreshButton();
      const info = ppmToolbarButtonState(button, selector);
      b.addEvent('ppm-parent-refresh-check', {
        ...info,
        targetPhase: auto.ppmAfterRefreshPhase || '',
        parentUrl: location.href,
        isPpmParentRegister: isPpmListPage()
      });
      await b.persistSession();
      if (!button || button.hasAttribute('disabled') || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        const started = Number(auto.ppmParentRefreshStartedAt || Date.now());
        if (!auto.ppmParentRefreshStartedAt) { b.state.session.auto = { ...auto, ppmParentRefreshStartedAt: started }; await b.persistSession(); }
        if (Date.now() - started > b.state.settings.lookupTimeoutMs) throw new Error('Parent PPM Refresh button did not become available before timeout.');
        b.scheduleAuto(300);
        return;
      }
      const clickedAt = Date.now();
      b.state.session.auto = {
        ...auto,
        phase: 'ppm_parent_refresh_wait',
        ppmParentRefreshPageInstance: b.PAGE_INSTANCE,
        ppmParentRefreshClickedAt: clickedAt,
        ppmParentRefreshSawDisabled: false
      };
      await b.persistSession();
      b.addEvent('ppm-parent-refresh-click', { ...info, clickCalled: true, parentUrl: location.href });
      await b.persistSession();
      button.click();
      b.scheduleAuto(250);
      return;
    }

    if (auto.phase === 'ppm_parent_refresh_wait') {
      const refreshButton = exactPpmRefreshButton();
      const disabledNow = Boolean(refreshButton) && (refreshButton.hasAttribute('disabled') || String(refreshButton.getAttribute('aria-disabled') || '').toLowerCase() === 'true');
      const elapsed = Date.now() - Number(auto.ppmParentRefreshClickedAt || Date.now());
      const pageReloaded = auto.ppmParentRefreshPageInstance !== b.PAGE_INSTANCE;
      const sawDisabled = Boolean(auto.ppmParentRefreshSawDisabled || disabledNow);
      if (sawDisabled !== Boolean(auto.ppmParentRefreshSawDisabled)) {
        b.state.session.auto = { ...auto, ppmParentRefreshSawDisabled: sawDisabled };
        await b.persistSession();
        auto = b.state.session.auto || {};
      }
      const toolbarReadyAgain = Boolean(refreshButton) && !disabledNow && document.readyState === 'complete' && elapsed >= 500;
      if (!pageReloaded && !toolbarReadyAgain) {
        if (elapsed > b.state.settings.lookupTimeoutMs) throw new Error('Parent PPM page refresh did not complete before timeout.');
        b.scheduleAuto(250);
        return;
      }
      const nextPhase = auto.ppmAfterRefreshPhase || 'ppm_next';
      b.addEvent('ppm-parent-refresh-complete', {
        nextPhase,
        pageReloaded,
        toolbarReadyAgain,
        sawDisabled,
        elapsedMs: elapsed,
        parentUrl: location.href
      });
      b.state.session.auto = { ...auto, phase: nextPhase, ppmParentRefreshStartedAt: 0, ppmParentRefreshClickedAt: 0, ppmParentRefreshPageInstance: '', ppmParentRefreshSawDisabled: false, ppmAfterRefreshPhase: '' };
      await b.persistSession();
      auto = b.state.session.auto || {};
      if (nextPhase === 'ppm_cycle_complete_parent') {
        await b.finishPostSave(record, auto.ppmResults || []);
        return;
      }
    }

    const ppm = b.currentPpm(record);
    if (!ppm) {
      await b.finishPostSave(record, auto.ppmResults || []);
      return;
    }
    if (auto.phase === 'ppm_await_save') {
      if (ppmListContainsCurrent(ppm)) {
        await b.recordPpmResult(record, ppm, 'saved', 'PPM detected in asset PPM register after Save', ppmListEntityId(ppm));
        return;
      }
      if (Date.now() - Number(auto.ppmSaveStartedAt || Date.now()) > b.state.settings.saveTimeoutMs) {
        throw new Error(`PPM Save could not be verified for ${ppm.ppmKey}.`);
      }
      b.scheduleAuto(0);
      return;
    }

    if (['ppm_open_list', 'ppm_next'].includes(auto.phase) && ppmListContainsCurrent(ppm)) {
      await b.recordPpmResult(record, ppm, 'existing', 'Equivalent PPM already exists; duplicate creation skipped', ppmListEntityId(ppm));
      return;
    }

    if (auto.phase === 'ppm_wait_new') {
      const child = await b.runtimeMessage({ type: 'PPM_CHILD_STATE', assetCode: record.assetCode });
      b.addEvent('ppm-child-check', { found: Boolean(child?.found), childTabId: child?.tabId ?? null, childUrl: child?.url || '', childStatus: child?.status || '' });
      await b.persistSession();
      if (child?.found) {
        b.scheduleAuto(150);
        return;
      }

      const elapsed = Date.now() - Number(auto.ppmOpenStartedAt || Date.now());
      if (elapsed > b.state.settings.lookupTimeoutMs) {
        throw new Error(`Create New was clicked/retried, but the PPM child window did not open for ${ppm.ppmKey}.`);
      }

      const button = exactPpmNewButton() || findNewButton();
      const info = ppmToolbarButtonState(button, 'a[title="Create New"][onclick*="Toolbar.New"]');
      const attempts = Number(auto.ppmNewClickAttempts || 0);
      const lastClick = Number(auto.ppmNewLastClickAt || 0);
      b.addEvent('ppm-create-new-retry-check', { ...info, attempt: attempts + 1, elapsedMs: elapsed });
      await b.persistSession();
      if (!button || button.hasAttribute('disabled') || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        b.scheduleAuto(500);
        return;
      }
      if (!lastClick || Date.now() - lastClick >= 700) {
        button.click();
        const now = Date.now();
        b.state.session.auto = { ...auto, ppmNewClickAttempts: attempts + 1, ppmNewLastClickAt: now };
        await b.persistSession();
        b.addEvent('ppm-create-new-retry-click', { ...info, attempt: attempts + 1, clickCalled: true });
        await b.persistSession();
      }
      b.scheduleAuto(200);
      return;
    }

    if (auto.phase === 'ppm_wait_user_new') {
      b.scheduleAuto(900);
      return;
    }

    const ppmIndex = Number(auto.ppmIndex || 0);
    const alreadyClicked = Number(auto.ppmNewClickedForIndex ?? -1) === ppmIndex;
    if (alreadyClicked) {
      b.state.session.auto = { ...auto, phase: 'ppm_wait_new', ppmOpenStartedAt: Number(auto.ppmOpenStartedAt || Date.now()) };
      await b.persistSession();
      b.scheduleAuto(200);
      return;
    }

    const newButton = findNewButton();
    if (!newButton) {
      const started = Number(auto.ppmListReadyStartedAt || Date.now());
      if (!auto.ppmListReadyStartedAt) {
        b.state.session.auto = { ...auto, ppmListReadyStartedAt: started };
        await b.persistSession();
      }
      if (Date.now() - started > b.state.settings.lookupTimeoutMs) {
        b.state.session.auto = { ...b.state.session.auto, phase: 'ppm_wait_user_new', ppmOpenStartedAt: Date.now() };
        await b.persistSession();
        b.render();
        b.showToast('Click the real CAFM + New button ONCE to add the next PPM. Automatic filling will continue in the new window.', 'warn', 16000);
        b.scheduleAuto(900);
        return;
      }
      b.scheduleAuto(450);
      return;
    }
    await b.runtimeMessage({ type: 'REGISTER_PPM_PARENT', assetCode: record.assetCode });
    const info = ppmToolbarButtonState(newButton, 'a[title="Create New"][onclick*="Toolbar.New"]');
    b.addEvent('ppm-create-new-ready', { ...info, ppmIndex, ppmKey: ppm.ppmKey });
    await b.persistSession();
    if (newButton.hasAttribute('disabled') || String(newButton.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
      b.state.session.auto = { ...auto, phase: 'ppm_wait_new', ppmOpenStartedAt: Date.now(), ppmListReadyStartedAt: 0, ppmNewClickedForIndex: ppmIndex, ppmNewClickAttempts: 0, ppmNewLastClickAt: 0 };
      await b.persistSession();
      b.scheduleAuto(400);
      return;
    }
    b.state.session.auto = {
      ...auto,
      phase: 'ppm_wait_new',
      ppmOpenStartedAt: Date.now(),
      ppmListReadyStartedAt: 0,
      ppmNewClickedForIndex: ppmIndex,
      ppmNewClickAttempts: 1,
      ppmNewLastClickAt: Date.now()
    };
    await b.persistSession();
    newButton.click();
    b.addEvent('ppm-create-new-click', { ...info, ppmIndex, ppmKey: ppm.ppmKey, attempt: 1, clickCalled: true });
    await b.persistSession();
    b.scheduleAuto(200);
  }

  async function startPpmForCurrentPage() {
    const b = $();
    if (!isPpmListPage()) throw new Error('Open the saved asset PPM register before starting PPM entry.');
    if (!b.state.ppms.length) throw new Error('Load a workbook containing enabled CAFM PPM Import rows first.');

    const record = root.data.records.ppmRecordOnCurrentPage();
    if (!record) throw new Error('The PPM register could not be matched safely to an Asset Code in the loaded workbook.');
    const assetCode = record.assetCode;
    const linked = b.linkedPpms(record);
    if (!linked.length) throw new Error(`No enabled PPM rows are linked to ${assetCode} in CAFM PPM Import.`);
    const assetEntityId = entityIdFromUrl();
    if (!assetEntityId || assetEntityId === '-1') throw new Error('The saved Asset ID could not be read from this PPM register URL.');

    const newIndex = b.state.assets.findIndex((item) => norm(item.assetCode) === norm(assetCode));
    if (newIndex >= 0) b.state.session.index = newIndex;
    b.state.session.auto = {
      active: true,
      mode: 'ppm-current-page',
      phase: 'ppm_wait_new',
      index: newIndex >= 0 ? newIndex : b.state.session.index,
      assetCode: record.assetCode,
      assetEntityId,
      ppmIndex: 0,
      ppmResults: [],
      ppmOpenStartedAt: Date.now(),
      ppmNewClickedForIndex: -1,
      startedAt: Date.now(),
      error: ''
    };

    const persistPromise = b.persistSession();
    b.render();
    let openedAttempt = false;
    try {
      const key = `ppm-new:${record.assetCode}:0`;
      openedAttempt = clickPpmNewToolbar(key);
      b.state.session.auto.ppmNewClickedForIndex = 0;
      b.state.session.auto.ppmOpenStartedAt = Date.now();
      b.showToast(`Starting ${linked.length} PPM row(s). + New was clicked once; waiting for the New PPM window.`, 'success', 9000);
    } catch (_) {
      b.state.session.auto.phase = 'ppm_wait_user_new';
      b.state.session.auto.ppmOpenStartedAt = Date.now();
      b.showToast('CAFM + New could not be clicked safely. Click the real + New button ONCE; the extension will resume automatically in the New PPM window.', 'warn', 16000);
    }
    await persistPromise;
    await b.persistSession();
    b.scheduleAuto(openedAttempt ? 1800 : 900);
  }

  root.pages = root.pages || {};
  root.pages.ppmRegister = Object.freeze({
    findNewButton,
    ppmToolbarButtonState,
    exactPpmNewButton,
    exactPpmRefreshButton,
    clickPpmNewToolbar,
    ppmInstructionCanon,
    ppmListContainsCurrent,
    ppmListEntityId,
    processPpmListPage,
    startPpmForCurrentPage
  });
})();
