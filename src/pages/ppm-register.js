(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { visible, isAssistantElement, dispatchClick } = root.core.dom;
  const { isPpmListPage, isPpmRegisterParentPage, isEmbeddedAssetPpmPage, isSavedAssetPage, entityIdFromUrl, assetEntityUrl } = root.core.pages;
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

  function ppmCreateNewCallable(button) {
    try {
      if (typeof Toolbar !== 'undefined' && typeof Toolbar.New === 'function') return true;
    } catch (_) {}
    return Boolean(button && /Toolbar\.New\s*\(/.test(button.getAttribute('onclick') || ''));
  }

  function canInvokePpmCreateNew(button) {
    if (button && (button.hasAttribute('disabled') || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true')) return false;
    return ppmCreateNewCallable(button) || Boolean(button && visible(button));
  }

  async function expectPpmChildWindow(assetCode) {
    try {
      await $().runtimeMessage({ type: 'PPM_EXPECT_CHILD', assetCode, expectMs: 90000 });
    } catch (_) {}
  }

  function analyzePpmChildUrl(url) {
    if (!url) return { kind: 'unknown' };
    try {
      const u = new URL(url, location.href);
      if (/ViewFASSETItemPPMs\.aspx/i.test(u.pathname)) return { kind: 'parent-register' };
      if (/ViewFPPMItem\.aspx/i.test(u.pathname)) {
        const id = u.searchParams.get('id');
        if (id && id !== '-1') return { kind: 'saved-ppm', ppmEntityId: id };
        return { kind: 'new-ppm' };
      }
    } catch (_) {}
    return { kind: 'unknown' };
  }

  async function getPpmChildState(assetCode) {
    try {
      return await $().runtimeMessage({ type: 'PPM_CHILD_STATE', assetCode }) || { found: false };
    } catch (_) {
      return { found: false };
    }
  }

  /** Returns true when parent should stop clicking Create New and wait for the child editor. */
  async function handlePpmChildWindow(record, auto, ppm, child, openElapsed = 0) {
    if (!child?.found) return false;
    const b = $();
    const analysis = analyzePpmChildUrl(child.url);
    b.addEvent('ppm-child-check', {
      found: true,
      childTabId: child.tabId ?? null,
      childUrl: child.url || '',
      childStatus: child.status || '',
      childKind: analysis.kind,
      elapsedMs: openElapsed
    });
    if (analysis.kind === 'new-ppm') {
      b.addEvent('ppm-child-handoff-resume', {
        ppmKey: ppm.ppmKey,
        assetCode: record.assetCode,
        childTabId: child.tabId ?? null,
        childUrl: child.url || '',
        manual: auto.phase === 'ppm_wait_user_new'
      });
      b.state.session.auto = {
        ...auto,
        ppmChildHandoffAt: auto.ppmChildHandoffAt || Date.now(),
        ppmNewClickedForIndex: Number(auto.ppmIndex) || 0
      };
      await b.persistSession();
      b.showActivity?.(
        'Waiting',
        'PPM editor open',
        `→ ${ppm.instruction || ppm.ppmKey}`,
        { wait: true, meta: record.assetCode, tick: true }
      );
      b.scheduleAuto(400);
      return true;
    }
    const duplicateReady = analysis.kind === 'parent-register'
      || (analysis.kind === 'saved-ppm' && openElapsed >= 800);
    if (duplicateReady) {
      b.addEvent('ppm-duplicate-child-detected', {
        childTabId: child.tabId ?? null,
        childUrl: child.url || '',
        kind: analysis.kind,
        ppmEntityId: analysis.ppmEntityId || '',
        elapsedMs: openElapsed
      });
      await sweepPpmChildren(record, { context: 'duplicate-child-detected' });
      await beginPpmParentRefresh(auto, auto.ppmAfterRefreshPhase || 'ppm_next');
      return true;
    }
    b.scheduleAuto(150);
    return true;
  }

  function diagnosePpmCreateNewWait(record, auto, ppm, options = {}) {
    const { child = null, button = null, info = {}, elapsed = 0, attempts = 0 } = options;
    const idx = Number(auto.ppmIndex) || 0;
    const linked = $().linkedPpms(record);
    const slot = `${idx + 1}/${linked.length}`;

    if (!isPpmRegisterParentPage()) {
      return {
        code: 'not-parent',
        title: 'Wrong page for Create New',
        reason: 'PPM register parent page is not active',
        detail: `Open the asset PPM register (currently ${location.pathname.split('/').pop() || 'unknown page'})`,
        failAfterMs: 2500
      };
    }
    if (!isPpmListPage()) {
      return {
        code: 'not-ppm-list',
        title: 'PPM grid not visible',
        reason: 'The PPM list toolbar is not on screen',
        detail: 'Click PPM in the asset left menu, then retry',
        failAfterMs: 4000
      };
    }
    if (child?.found) {
      const analysis = analyzePpmChildUrl(child.url);
      if (analysis.kind === 'new-ppm') {
        return {
          code: 'child-new-ppm',
          title: 'New PPM window opening',
          reason: 'CAFM opened a New PPM editor',
          detail: clean(child.url || '').slice(-72) || 'Loading editor…',
          failAfterMs: null
        };
      }
      if (analysis.kind === 'saved-ppm') {
        return {
          code: 'wrong-child-saved',
          title: 'Wrong window opened',
          reason: 'A saved PPM opened instead of New Entity',
          detail: `Existing PPM id ${analysis.ppmEntityId || '?'} — closing and retrying`,
          failAfterMs: null
        };
      }
      if (analysis.kind === 'parent-register') {
        return {
          code: 'wrong-child-register',
          title: 'Wrong window opened',
          reason: 'PPM register opened in popup instead of New PPM',
          detail: 'Closing stray window and refreshing register',
          failAfterMs: null
        };
      }
      return {
        code: 'unknown-child',
        title: 'Unexpected popup',
        reason: 'CAFM opened an unrecognized window',
        detail: clean(child.url || 'unknown URL').slice(-72),
        failAfterMs: 8000
      };
    }
    if (!button) {
      return {
        code: 'no-button',
        title: 'Create New not found',
        reason: 'Toolbar.New / Create New control missing',
        detail: 'Ensure the PPM register finished loading after Refresh',
        failAfterMs: 6000
      };
    }
    if (!visible(button)) {
      if (ppmCreateNewCallable(button)) {
        return {
          code: 'pending-click',
          title: 'Prepare Create New',
          reason: 'Create New is in the toolbar menu — invoking Toolbar.New',
          detail: `${ppm.instruction || ppm.ppmKey} · PPM ${slot}`,
          failAfterMs: null
        };
      }
      return {
        code: 'button-hidden',
        title: 'Create New not visible',
        reason: 'The Create New control exists but is hidden',
        detail: 'Scroll the PPM toolbar into view or widen the window',
        failAfterMs: 6000
      };
    }
    if (button.hasAttribute('disabled') || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
      return {
        code: 'button-disabled',
        title: 'Create New disabled',
        reason: 'CAFM has disabled the Create New button',
        detail: info.title ? `${info.title} — wait for refresh or close leftover PPM popups` : 'Wait for register refresh to finish',
        failAfterMs: 8000
      };
    }
    if (attempts >= 4 && elapsed >= 5000) {
      return {
        code: 'popup-blocked',
        title: 'No new PPM window',
        reason: `Create New clicked ${attempts}× but no popup appeared`,
        detail: 'Allow popups for Concept Evolution or check for blocked windows',
        failAfterMs: Math.max(6000, elapsed)
      };
    }
    if (attempts > 0) {
      return {
        code: 'await-popup',
        title: 'Waiting for New PPM window',
        reason: `Create New clicked ${attempts}× — waiting for CAFM popup`,
        detail: `${ppm.instruction || ppm.ppmKey} · PPM ${slot} · ${Math.round(elapsed / 1000)}s`,
        failAfterMs: null
      };
    }
    return {
      code: 'pending-click',
      title: 'Prepare Create New',
      reason: 'Ready to click Create New on PPM register',
      detail: `${ppm.instruction || ppm.ppmKey} · PPM ${slot}`,
      failAfterMs: null
    };
  }

  function formatPpmCreateNewFailure(diagnosis, ppm, record) {
    const parts = [
      diagnosis.reason || 'PPM Create New window did not open',
      diagnosis.detail || '',
      ppm?.ppmKey ? `Row: ${ppm.ppmKey}` : '',
      record?.assetCode ? `Asset: ${record.assetCode}` : ''
    ].filter(Boolean);
    return parts.join(' · ');
  }

  function showPpmCreateNewWaitActivity(diagnosis, options = {}) {
    const b = $();
    const wait = options.wait !== false;
    const type = options.type || (diagnosis.code === 'child-new-ppm' ? 'success' : 'info');
    b.showActivity?.(
      wait ? 'Waiting' : 'Checking',
      diagnosis.title || 'PPM Create New window',
      diagnosis.reason ? `→ ${diagnosis.reason}${diagnosis.detail ? ` · ${diagnosis.detail}` : ''}` : diagnosis.detail || '',
      { wait, type, meta: options.meta || '', tick: wait, duration: options.duration || 0 }
    );
  }

  function shouldFailPpmCreateNewWait(diagnosis, elapsed, childTimeoutMs) {
    if (diagnosis.failAfterMs != null && elapsed >= diagnosis.failAfterMs) return true;
    if (['popup-blocked', 'unknown-child', 'not-parent'].includes(diagnosis.code) && diagnosis.failAfterMs != null && elapsed >= diagnosis.failAfterMs) return true;
    return elapsed > childTimeoutMs;
  }

  async function sweepPpmChildren(record, options = {}) {
    const b = $();
    const auto = b.state.session.auto || {};
    const assetCode = record?.assetCode || auto.assetCode || '';
    const assetEntityId = String(options.assetEntityId || auto.assetEntityId || entityIdFromUrl() || '');
    const context = clean(options.context || 'post-refresh');
    const started = performance.now();
    try {
      const sweep = await b.runtimeMessage({
        type: 'PPM_SWEEP_CHILDREN',
        assetCode,
        assetEntityId
      });
      const durationMs = Math.round(performance.now() - started);
      b.addEvent('ppm-post-refresh-close-sweep', {
        context,
        durationMs,
        closedCount: sweep?.closedCount ?? 0,
        closedTabIds: sweep?.closedTabIds ?? [],
        closeErrors: sweep?.closeErrors ?? [],
        parentNotified: false
      });
      if (Number(sweep?.closedCount || 0) > 0) {
        b.showToast(`Closed ${sweep.closedCount} leftover PPM popup(s).`, 'info', 4000);
      }
      return sweep;
    } catch (error) {
      b.addEvent('ppm-post-refresh-close-sweep-error', {
        context,
        message: String(error?.message || error)
      });
      return null;
    }
  }

  async function beginPpmParentRefresh(auto, afterRefreshPhase) {
    const b = $();
    const phase = String(auto.phase || '');
    if (['ppm_parent_refresh', 'ppm_parent_refresh_wait'].includes(phase)) {
      const mergedAfter = afterRefreshPhase || auto.ppmAfterRefreshPhase || 'ppm_next';
      if (mergedAfter !== auto.ppmAfterRefreshPhase) {
        b.state.session.auto = { ...auto, ppmAfterRefreshPhase: mergedAfter };
        await b.persistSession();
      }
      b.scheduleAuto(200);
      return;
    }
    b.state.session.auto = {
      ...auto,
      phase: 'ppm_parent_refresh',
      ppmAfterRefreshPhase: afterRefreshPhase,
      ppmParentRefreshStartedAt: 0,
      ppmParentRefreshClickedAt: 0,
      ppmParentRefreshPageInstance: '',
      ppmParentRefreshSawDisabled: false,
      ppmParentRefreshCycleId: `${Date.now()}-${Number(auto.ppmIndex || 0)}`
    };
    await b.persistSession();
    b.scheduleAuto(100);
  }

  function clickPpmCreateNew(button, guardKey = 'ppm-new') {
    const b = $();
    const selector = 'a[title="Create New"][onclick*="Toolbar.New"]';
    const target = button || exactPpmNewButton() || findNewButton();
    const stateInfo = ppmToolbarButtonState(target, selector);
    if (target && (target.hasAttribute('disabled') || String(target.getAttribute('aria-disabled') || '').toLowerCase() === 'true')) {
      throw new Error('The Create New control is currently disabled.');
    }
    if (!target && !ppmCreateNewCallable()) {
      throw new Error('The Create New control was not detected on the PPM register toolbar.');
    }
    b.addEvent('ppm-create-new-check', { guardKey, ...stateInfo, callable: ppmCreateNewCallable(target) });
    try {
      if (typeof Toolbar !== 'undefined' && typeof Toolbar.New === 'function') {
        Toolbar.New();
        b.addEvent('ppm-create-new-click', { guardKey, ...stateInfo, clickCalled: true, method: 'Toolbar.New' });
        return { ...stateInfo, clickCalled: true, method: 'Toolbar.New' };
      }
    } catch (_) {}
    if (!target) throw new Error('The Create New control was not detected on the PPM register toolbar.');
    try { target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    if (visible(target)) {
      dispatchClick(target, false, 'Create New');
      b.addEvent('ppm-create-new-click', { guardKey, ...stateInfo, clickCalled: true, method: 'visible-click' });
      return { ...stateInfo, clickCalled: true, method: 'visible-click' };
    }
    target.click();
    b.addEvent('ppm-create-new-click', { guardKey, ...stateInfo, clickCalled: true, method: 'hidden-menu-link' });
    return { ...stateInfo, clickCalled: true, method: 'hidden-menu-link' };
  }

  function clickPpmNewToolbar(guardKey = 'ppm-new') {
    clickPpmCreateNew(exactPpmNewButton() || findNewButton(), guardKey);
    return true;
  }

  const ppmInstructionCanon = root.core.lookup.ppmInstructionCanon;
  const ppmAlreadyProcessed = root.data.ppm.alreadyProcessed;

  function assertPpmAssetContext(record, auto) {
    if (!record?.assetCode || !auto?.assetCode) return;
    if (norm(record.assetCode) !== norm(auto.assetCode)) {
      throw new Error(`PPM workflow asset mismatch: session expects ${auto.assetCode}, workbook row is ${record.assetCode}.`);
    }
  }

  function ppmGridRows() {
    return [...document.querySelectorAll('tr')].filter(visible);
  }

  function ppmListContainsCurrent(ppm) {
    if (!ppm) return false;
    const instruction = ppmInstructionCanon(ppm.instruction || '');
    if (!instruction) return false;
    for (const row of ppmGridRows()) {
      const text = ppmInstructionCanon(row.textContent || '');
      if (instruction && text.includes(instruction)) return true;
    }
    const fallback = ppmInstructionCanon(document.body?.innerText || '');
    return Boolean(instruction && fallback.includes(instruction));
  }

  function ppmListEntityId(ppm) {
    if (!ppm) return '';
    const instruction = ppmInstructionCanon(ppm.instruction || '');
    if (!instruction) return '';
    const rows = ppmGridRows();
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

  function needsPpmGridRefresh(auto, ppmIndex) {
    return Number(auto.ppmGridRefreshedForIndex ?? -1) !== Number(ppmIndex);
  }

  function allLinkedPpmsDone(record, auto) {
    const b = $();
    const linked = b.linkedPpms(record);
    if (!linked.length) return false;
    const statuses = b.state.session.statuses || {};
    return linked.every((ppm) => ppmAlreadyProcessed(record, ppm, auto, statuses));
  }

  async function trySkipExistingPpm(record, ppm, auto, note = 'Equivalent PPM already exists on this asset; duplicate creation skipped') {
    const b = $();
    if (ppmAlreadyProcessed(record, ppm, auto, b.state.session.statuses || {})) {
      b.addEvent('ppm-session-skip', { ppmKey: ppm.ppmKey, assetCode: record.assetCode, reason: 'already-processed-in-session' });
      await b.recordPpmResult(record, ppm, 'existing', 'PPM row already processed for this asset in this session', ppmListEntityId(ppm));
      return true;
    }
    if (ppmListContainsCurrent(ppm)) {
      b.addEvent('ppm-grid-skip', { ppmKey: ppm.ppmKey, assetCode: record.assetCode, ppmEntityId: ppmListEntityId(ppm) });
      await b.recordPpmResult(record, ppm, 'existing', note, ppmListEntityId(ppm));
      return true;
    }
    return false;
  }

  async function beginPpmCycleGeneralWait(record, ppmResults = []) {
    const b = $();
    const auto = b.state.session.auto || {};
    const entityId = String(auto.assetEntityId || entityIdFromUrl() || '');
    b.addEvent('ppm-cycle-general-nav', {
      assetCode: record?.assetCode || '',
      url: location.href,
      entityId,
      embeddedPpm: isEmbeddedAssetPpmPage(),
      onPpmRegister: isPpmRegisterParentPage()
    });
    b.state.session.auto = {
      ...auto,
      phase: 'ppm_cycle_general_wait',
      ppmResults,
      ppmCycleGeneralStartedAt: Date.now()
    };
    await b.persistSession();
    if (!isSavedAssetPage() && entityId) {
      location.href = assetEntityUrl(entityId);
      return;
    }
    const general = root.core.toolbar.findAssetGeneralNavLink();
    if (general && !general.classList.contains('fsiNavSelectedItem')) {
      b.showActivity?.('Clicking', 'General tab', 'After all PPMs saved', { wait: false, meta: record?.assetCode || '', duration: 2200, tick: false });
      dispatchClick(general, false);
      b.scheduleAuto(450);
      return;
    }
    if (!general && (isEmbeddedAssetPpmPage() || isPpmListPage()) && entityId) {
      b.addEvent('ppm-cycle-general-reload', { entityId, reason: 'general-nav-not-found' });
      location.href = assetEntityUrl(entityId);
      return;
    }
    b.scheduleAuto(150);
  }

  async function completePpmCycleOnParent(record, ppmResults = []) {
    const b = $();
    await sweepPpmChildren(record, { context: 'ppm-cycle-complete' });
    await beginPpmCycleGeneralWait(record, ppmResults);
  }

  async function processPpmCycleGeneralWaitPage(record) {
    const b = $();
    const autoNow = b.state.session.auto || {};
    const entityId = String(autoNow.assetEntityId || entityIdFromUrl() || '');
    if (!isSavedAssetPage() && entityId) {
      location.href = assetEntityUrl(entityId);
      return;
    }
    const general = root.core.toolbar.findAssetGeneralNavLink();
    if (general && !general.classList.contains('fsiNavSelectedItem')) {
      const started = Number(autoNow.ppmCycleGeneralStartedAt || Date.now());
      if (Date.now() - started > b.state.settings.lookupTimeoutMs) {
        throw new Error('General tab did not become available after the PPM cycle completed.');
      }
      dispatchClick(general, false);
      b.scheduleAuto(450);
      return;
    }
    b.showActivity?.('Running', 'General tab ready', 'Save and New next', { wait: true, meta: record?.assetCode || '', tick: true });
    const handoff = await root.workflow.postSave.beginPostPpmHandoff(record, autoNow.ppmResults || []);
    if (handoff) b.scheduleAuto(150);
  }

  async function processPpmListPage(record) {
    const b = $();
    let auto = b.state.session.auto || {};

    if (auto.phase === 'ppm_cycle_general_wait') {
      await processPpmCycleGeneralWaitPage(record);
      return;
    }

    if (auto.phase === 'ppm_cycle_complete_parent') {
      await completePpmCycleOnParent(record, auto.ppmResults || []);
      return;
    }

    if (!isPpmRegisterParentPage()) {
      b.addEvent('ppm-register-passive-not-parent', { url: location.href, assetCode: record?.assetCode || '' });
      await b.persistSession();
      return;
    }

    if (auto.phase === 'ppm_parent_refresh') {
      const inFlightClick = Number(auto.ppmParentRefreshClickedAt || 0);
      if (inFlightClick && Date.now() - inFlightClick < 8000) {
        b.state.session.auto = { ...auto, phase: 'ppm_parent_refresh_wait' };
        await b.persistSession();
        b.scheduleAuto(250);
        return;
      }
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
      b.showActivity?.('Clicking', 'PPM register Refresh', 'Waiting for grid to reload', { wait: true, meta: record?.assetCode || '', tick: true });
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
      await sweepPpmChildren(record, { context: 'post-refresh' });
      b.state.session.auto = {
        ...auto,
        phase: nextPhase,
        ppmParentRefreshStartedAt: 0,
        ppmParentRefreshClickedAt: 0,
        ppmParentRefreshPageInstance: '',
        ppmParentRefreshSawDisabled: false,
        ppmAfterRefreshPhase: '',
        ppmGridRefreshedForIndex: Number(auto.ppmIndex ?? 0)
      };
      await b.persistSession();
      auto = b.state.session.auto || {};
      if (nextPhase === 'ppm_cycle_complete_parent') {
        await completePpmCycleOnParent(record, auto.ppmResults || []);
        return;
      }
    }

    assertPpmAssetContext(record, auto);

    if (
      allLinkedPpmsDone(record, auto)
      && !['ppm_cycle_general_wait', 'ppm_cycle_complete_parent', 'asset_save_and_new'].includes(auto.phase)
    ) {
      b.addEvent('ppm-cycle-all-linked-done', {
        assetCode: record.assetCode,
        phase: auto.phase || '',
        ppmIndex: Number(auto.ppmIndex) || 0,
        resultCount: (auto.ppmResults || []).length
      });
      await completePpmCycleOnParent(record, auto.ppmResults || []);
      return;
    }

    const ppm = b.currentPpm(record);
    if (!ppm) {
      if (allLinkedPpmsDone(record, auto) || ['ppm_cycle_complete_parent', 'ppm_cycle_general_wait'].includes(auto.phase)) {
        if (auto.phase === 'ppm_cycle_general_wait') {
          await processPpmCycleGeneralWaitPage(record);
          return;
        }
        await completePpmCycleOnParent(record, auto.ppmResults || []);
        return;
      }
      await b.finishPostSave(record, auto.ppmResults || []);
      return;
    }

    const ppmIndex = Number(auto.ppmIndex || 0);
    const preCreatePhases = ['ppm_open_list', 'ppm_next'];
    if (preCreatePhases.includes(auto.phase) && needsPpmGridRefresh(auto, ppmIndex)) {
      await beginPpmParentRefresh(auto, auto.phase);
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

    if (preCreatePhases.includes(auto.phase)) {
      if (await trySkipExistingPpm(record, ppm, auto)) return;
    }

    if (auto.phase === 'ppm_wait_new' || auto.phase === 'ppm_wait_user_new') {
      if (await trySkipExistingPpm(record, ppm, auto)) return;

      const openElapsed = Date.now() - Number(auto.ppmOpenStartedAt || Date.now());
      const child = await getPpmChildState(record.assetCode);
      if (await handlePpmChildWindow(record, auto, ppm, child, openElapsed)) return;

      if (auto.phase === 'ppm_wait_user_new') {
        b.scheduleAuto(900);
        return;
      }

      const elapsed = openElapsed;
      const childTimeoutMs = Number(b.state.settings.ppmChildTimeoutMs) || Number(b.state.settings.lookupTimeoutMs) || 15000;
      const attempts = Number(auto.ppmNewClickAttempts || 0);
      if (elapsed > childTimeoutMs) {
        throw new Error(`Create New was clicked/retried, but the PPM child window did not open for ${ppm.ppmKey}.`);
      }

      if (attempts >= 1 && elapsed >= 2500) {
        b.state.session.auto = {
          ...auto,
          phase: 'ppm_wait_user_new',
          ppmOpenStartedAt: Date.now()
        };
        await b.persistSession();
        b.render();
        b.showToast('PPM window may not have opened — click Create New once if needed. Automation will resume in the new window without creating a duplicate.', 'warn', 14000);
        b.scheduleAuto(500);
        return;
      }

      const button = exactPpmNewButton() || findNewButton();
      const info = ppmToolbarButtonState(button, 'a[title="Create New"][onclick*="Toolbar.New"]');
      const lastClick = Number(auto.ppmNewLastClickAt || 0);
      b.addEvent('ppm-create-new-retry-check', { ...info, attempt: attempts + 1, elapsedMs: elapsed });
      await b.persistSession();
      if (!canInvokePpmCreateNew(button)) {
        b.scheduleAuto(500);
        return;
      }
      if (!lastClick || Date.now() - lastClick >= 700) {
        const childBeforeClick = await getPpmChildState(record.assetCode);
        if (childBeforeClick?.found && analyzePpmChildUrl(childBeforeClick.url).kind === 'new-ppm') {
          await handlePpmChildWindow(record, auto, ppm, childBeforeClick, elapsed);
          return;
        }
        await expectPpmChildWindow(record.assetCode);
        const clickResult = clickPpmCreateNew(button, 'ppm-wait-new-retry');
        const now = Date.now();
        b.state.session.auto = { ...auto, ppmNewClickAttempts: attempts + 1, ppmNewLastClickAt: now };
        await b.persistSession();
        b.addEvent('ppm-create-new-retry-click', { ...info, ...clickResult, attempt: attempts + 1, clickCalled: true });
        await b.persistSession();
      }
      b.scheduleAuto(200);
      return;
    }

    const alreadyClicked = Number(auto.ppmNewClickedForIndex ?? -1) === ppmIndex;
    if (alreadyClicked) {
      b.state.session.auto = { ...auto, phase: 'ppm_wait_new', ppmOpenStartedAt: Number(auto.ppmOpenStartedAt || Date.now()) };
      await b.persistSession();
      b.scheduleAuto(200);
      return;
    }

    const newButton = findNewButton();
    if (!newButton && !ppmCreateNewCallable()) {
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

    if (needsPpmGridRefresh(auto, ppmIndex)) {
      await beginPpmParentRefresh(auto, auto.phase || 'ppm_open_list');
      return;
    }
    if (await trySkipExistingPpm(record, ppm, auto)) return;

    const existingChild = await getPpmChildState(record.assetCode);
    if (existingChild?.found && analyzePpmChildUrl(existingChild.url).kind === 'new-ppm') {
      b.state.session.auto = {
        ...auto,
        phase: 'ppm_wait_new',
        ppmOpenStartedAt: Date.now(),
        ppmChildHandoffAt: Date.now(),
        ppmNewClickedForIndex: ppmIndex
      };
      await b.persistSession();
      await handlePpmChildWindow(record, b.state.session.auto, ppm, existingChild, 0);
      return;
    }

    await b.runtimeMessage({ type: 'REGISTER_PPM_PARENT', assetCode: record.assetCode, assetEntityId: String(auto.assetEntityId || entityIdFromUrl() || '') });
    await expectPpmChildWindow(record.assetCode);
    const clickTarget = newButton || exactPpmNewButton();
    const info = ppmToolbarButtonState(clickTarget, 'a[title="Create New"][onclick*="Toolbar.New"]');
    b.addEvent('ppm-create-new-ready', { ...info, ppmIndex, ppmKey: ppm.ppmKey });
    await b.persistSession();
    if (clickTarget && (clickTarget.hasAttribute('disabled') || String(clickTarget.getAttribute('aria-disabled') || '').toLowerCase() === 'true') && !ppmCreateNewCallable(clickTarget)) {
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
    b.showActivity?.('Clicking', 'Create New PPM', ppm.ppmKey, { wait: true, meta: record.assetCode, tick: true });
    const clickResult = clickPpmCreateNew(clickTarget, 'ppm-open-list');
    b.addEvent('ppm-create-new-click', { ...info, ...clickResult, ppmIndex, ppmKey: ppm.ppmKey, attempt: 1, clickCalled: true });
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
      phase: 'ppm_open_list',
      index: newIndex >= 0 ? newIndex : b.state.session.index,
      assetCode: record.assetCode,
      assetEntityId,
      ppmIndex: 0,
      ppmResults: [],
      ppmGridRefreshedForIndex: -1,
      ppmOpenStartedAt: Date.now(),
      ppmNewClickedForIndex: -1,
      startedAt: Date.now(),
      error: ''
    };

    await b.persistSession();
    b.render();
    b.showToast(`Checking PPM register for ${assetCode} (${linked.length} linked row(s)) before Create New.`, 'info', 7000);
    b.scheduleAuto(200);
  }

  root.pages = root.pages || {};
  root.pages.ppmRegister = Object.freeze({
    findNewButton,
    ppmToolbarButtonState,
    exactPpmNewButton,
    exactPpmRefreshButton,
    clickPpmCreateNew,
    clickPpmNewToolbar,
    ppmInstructionCanon,
    ppmListContainsCurrent,
    ppmListEntityId,
    analyzePpmChildUrl,
    sweepPpmChildren,
    beginPpmParentRefresh,
    beginPpmCycleGeneralWait,
    completePpmCycleOnParent,
    allLinkedPpmsDone,
    processPpmCycleGeneralWaitPage,
    processPpmListPage,
    startPpmForCurrentPage
  });
})();
