(() => {
  'use strict';

  const VERSION = '8.0.11';
  const PAGE_INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const TOP = window.top === window.self;
  const HOST_ID = 'ee-cafm-asset-importer-host';
  const STORAGE = {
    session: 'eeAssetImporterV80Session',
    settings: 'eeAssetImporterV80Settings',
    pendingLookup: 'eeAssetImporterV80PendingLookup',
    statusLearnRequest: 'eeAssetImporterV58StatusLearnRequest',
    learnedStatus: 'eeAssetImporterV58LearnedStatus',
    newLearnRequest: 'eeAssetImporterV69NewLearnRequest',
    learnedNew: 'eeAssetImporterV69LearnedNew'
  };
  const LARGE_KEY = 'eeAssetImporterV80Workbook';
  const DEFAULT_SETTINGS = {
    lookupTimeoutMs: 45000,
    saveTimeoutMs: 45000,
    skipInvalidRows: false,
    stopOnLookupError: true,
    panelX: null,
    panelY: 76,
    collapsed: false,
    includeNotes: false,
    includeSpatial: false,
    iterationEnabled: false,
    iterationCount: 1
  };

  const state = {
    assets: [],
    allAssets: [],
    ppms: [],
    cache: null,
    session: {
      fileName: '',
      fileSize: 0,
      fileModified: 0,
      index: 0,
      statuses: {},
      newEntityUrl: '',
      auto: null,
      manualAwaitSave: null,
      currentLookupEvidence: [],
      events: []
    },
    settings: { ...DEFAULT_SETTINGS },
    host: null,
    shadow: null,
    els: {},
    busy: false,
    lookupAgentBusy: false,
    lookupTimer: null,
    autoTimer: null,
    learnedStatus: null,
    learnedNew: null,
    teachStatusArmed: false,
    teachNewArmed: false,
    legacyClickTimes: Object.create(null),
    lastLoggedPhase: ''
  };

  const assetPagePattern = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItem\.aspx/i;
  const ppmListPagePattern = /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItemPPMs\.aspx/i;
  const ppmItemPagePattern = /\/Evolution\/!System\/PPMs\/FPPM\/ViewFPPMItem\.aspx/i;
  const isConceptHost = location.hostname.toLowerCase() === 'concept' || location.pathname.toLowerCase().includes('/evolution/');
  if (!isConceptHost) return;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }


  function waitForDom(predicate, timeoutMs = state.settings.lookupTimeoutMs, description = 'CAFM page state') {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let settled = false;
      let observer = null;
      let timeout = null;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        try { observer?.disconnect(); } catch (_) {}
        if (timeout) clearTimeout(timeout);
        if (error) reject(error); else resolve(value);
      };
      const check = () => {
        if (settled) return;
        try {
          const value = predicate();
          if (value) { finish(value); return; }
        } catch (_) {}
        if (Date.now() - started >= timeoutMs) finish(null, new Error(`Timed out waiting for ${description}.`));
      };
      observer = new MutationObserver(check);
      try { observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (_) {}
      timeout = setTimeout(check, Math.max(250, Number(timeoutMs) || 45000));
      check();
    });
  }

  function addEvent(type, details = {}) {
    const event = {
      at: new Date().toISOString(),
      type: clean(type),
      version: VERSION,
      url: location.href,
      assetCode: clean(workflowRecord(state.session.auto)?.assetCode || currentRecord()?.assetCode || ''),
      phase: clean(state.session.auto?.phase || ''),
      ...details
    };
    state.session.events = [...(state.session.events || []), event].slice(-2000);
    return event;
  }

  async function recordValidationWarning(record, details = {}) {
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
    const previous = state.session.statuses?.[record.assetCode] || {};
    const warnings = [...(previous.validationWarnings || []), warning].slice(-500);
    state.session.statuses = state.session.statuses || {};
    state.session.statuses[record.assetCode] = { ...previous, validationWarnings: warnings, updatedAt: new Date().toISOString() };
    if (state.session.auto) {
      state.session.auto = {
        ...state.session.auto,
        validationWarnings: [...(state.session.auto.validationWarnings || []), warning].slice(-500)
      };
    }
    addEvent('validation-warning', warning);
    await persistSession();
    const where = [warning.tab, warning.field].filter(Boolean).join(' / ') || warning.scope;
    showToast(`Warning: ${where} did not match Excel. Continuing.`, 'warn', 9000);
  }

  function norm(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function clean(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function uniqueNonBlank(values) {
    const output = [];
    const seen = new Set();
    for (const value of values || []) {
      const text = clean(value);
      const key = norm(text);
      if (!text || seen.has(key)) continue;
      seen.add(key);
      output.push(text);
    }
    return output;
  }

  function uniqueId(prefix = 'id') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function visible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }

  function storageRemove(keys) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
  }

  async function saveLargeWorkbook(cache) {
    const result = await runtimeMessage({ type: 'LARGE_STORAGE_PUT', key: LARGE_KEY, value: cache });
    if (!result?.ok) throw new Error(result?.error || 'Unable to cache workbook data.');
    return result;
  }

  async function loadLargeWorkbook() {
    const result = await runtimeMessage({ type: 'LARGE_STORAGE_GET', key: LARGE_KEY });
    if (!result?.ok) return null;
    return result.value || null;
  }

  async function clearLargeWorkbook() {
    await runtimeMessage({ type: 'LARGE_STORAGE_REMOVE', key: LARGE_KEY });
  }

  function isAssetPage() {
    return assetPagePattern.test(location.pathname);
  }

  function entityIdFromUrl() {
    try {
      const url = new URL(location.href);
      return url.searchParams.get('id') || '';
    } catch (_) {
      return '';
    }
  }

  function isNewEntityPage() {
    if (!isAssetPage()) return false;
    const id = entityIdFromUrl();
    if (id === '-1') return true;
    const text = [...document.querySelectorAll('h1,h2,h3,a,span,div')]
      .filter(visible)
      .map((el) => clean(el.textContent))
      .find((textValue) => textValue === 'New Entity');
    return Boolean(text);
  }

  function isSavedAssetPage() {
    if (!isAssetPage()) return false;
    const id = entityIdFromUrl();
    return Boolean(id && id !== '-1');
  }

  function isPpmListPage() {
    return ppmListPagePattern.test(location.pathname);
  }

  function isHashPpmParentPage() {
    return isPpmListPage() && String(location.href || '').endsWith('#');
  }

  function isPpmItemPage() {
    return ppmItemPagePattern.test(location.pathname);
  }

  function isPpmNewEntityPage() {
    if (!isPpmItemPage()) return false;
    return entityIdFromUrl() === '-1' || /new entity/i.test(clean(document.body?.innerText || '').slice(0, 1500));
  }

  function isWorkflowPage() {
    return isAssetPage() || isPpmListPage() || isPpmItemPage();
  }

  function assetEntityUrl(assetEntityId) {
    const id = clean(assetEntityId);
    return `${location.origin}/Evolution/!System/Asset/FASSET/ViewFASSETItem.aspx?id=${encodeURIComponent(id)}&SubNav=true`;
  }

  function ppmListUrl(assetEntityId) {
    const id = clean(assetEntityId);
    return `${location.origin}/Evolution/!System/Asset/FASSET/ViewFASSETItemPPMs.aspx?id=${encodeURIComponent(id)}&SubNav=true#`;
  }

  function ppmEntityUrl(ppmEntityId) {
    const id = clean(ppmEntityId);
    return `${location.origin}/Evolution/!System/PPMs/FPPM/ViewFPPMItem.aspx?id=${encodeURIComponent(id)}&SubNav=true`;
  }

  function isSavedPpmPage() {
    if (!isPpmItemPage()) return false;
    const id = entityIdFromUrl();
    return Boolean(id && id !== '-1');
  }

  function deriveNewEntityUrl() {
    try {
      const url = new URL(location.href);
      if (!assetPagePattern.test(url.pathname)) return '';
      url.searchParams.set('id', '-1');
      return url.toString();
    } catch (_) {
      return '';
    }
  }

  function elementValue(element) {
    if (!element) return '';
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      if (element instanceof HTMLSelectElement) {
        const selected = element.options?.[element.selectedIndex];
        return clean(selected?.textContent || element.value || '');
      }
      return clean(element.value || element.textContent || '');
    }
    return clean(element.textContent || '');
  }

  function fieldCandidates(labelNames, root = document) {
    const wanted = (Array.isArray(labelNames) ? labelNames : [labelNames]).map(norm);
    return [...root.querySelectorAll('label,a,span,td,th,div,p')]
      .filter((element) => {
        if (!visible(element) || isAssistantElement(element)) return false;
        const text = norm(element.textContent);
        if (!wanted.includes(text)) return false;
        return element.children.length <= 5 && clean(element.textContent).length <= 100;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.width * ar.height - br.width * br.height;
      });
  }

  function allVisibleControls(root = document) {
    return [...root.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]')]
      .filter((element) => visible(element) && !isAssistantElement(element));
  }

  function nearestControl(labelNames, root = document) {
    const labels = fieldCandidates(labelNames, root);
    const controls = allVisibleControls(root);
    let best = null;
    let bestScore = Infinity;

    for (const label of labels) {
      const lr = label.getBoundingClientRect();
      const lcy = lr.top + lr.height / 2;
      const containers = [
        label.closest('tr'),
        label.closest('.form-group'),
        label.closest('.row'),
        label.parentElement,
        label.parentElement?.parentElement
      ].filter(Boolean);

      for (const container of containers) {
        const local = [...container.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]')]
          .filter((element) => visible(element) && !isAssistantElement(element));
        if (!local.length) continue;
        const rightward = local.filter((control) => control.getBoundingClientRect().left >= lr.right - 12);
        const chosen = (rightward.length ? rightward : local).sort((a, b) => {
          const score = (control) => {
            const rect = control.getBoundingClientRect();
            const vertical = Math.abs(rect.top + rect.height / 2 - lcy);
            const horizontal = Math.max(0, rect.left - lr.right);
            const sameRowBonus = control.closest('tr') && control.closest('tr') === label.closest('tr') ? -220 : 0;
            const tooFarPenalty = horizontal > 520 ? 1200 : 0;
            return vertical * 18 + horizontal + sameRowBonus + tooFarPenalty;
          };
          return score(a) - score(b);
        })[0];
        if (chosen) return { label, control: chosen };
      }

      for (const control of controls) {
        const cr = control.getBoundingClientRect();
        const ccy = cr.top + cr.height / 2;
        const vertical = Math.abs(ccy - lcy);
        const horizontal = cr.left - lr.right;
        if (vertical > 34 || horizontal < -30) continue;
        const score = vertical * 5 + Math.max(0, horizontal);
        if (score < bestScore) {
          bestScore = score;
          best = { label, control };
        }
      }
    }
    return best;
  }

  function setNativeValue(control, value) {
    if (!control) return false;
    const textValue = value == null ? '' : String(value);
    try {
      control.focus();
      if (control instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(control, textValue);
        else control.value = textValue;
      } else if (control instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(control, textValue);
        else control.value = textValue;
      } else if (control instanceof HTMLSelectElement) {
        const wanted = norm(textValue);
        const option = [...control.options].find((item) => norm(item.textContent) === wanted || norm(item.value) === wanted);
        if (!option) return false;
        control.value = option.value;
      } else if (control.isContentEditable) {
        control.textContent = textValue;
      } else {
        return false;
      }
      for (const eventName of ['input', 'change', 'blur']) control.dispatchEvent(new Event(eventName, { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function tabContextReady(name) {
    const wanted = norm(name);
    if (wanted === 'details') return Boolean(nearestControl(['Asset Code']) || nearestControl(['Description']) || nearestControl(['Building']));
    if (wanted === 'notes') return [...document.querySelectorAll('textarea')].some((el) => visible(el) && !isAssistantElement(el));
    if (wanted === 'financial/risk' || wanted === 'financial risk') return Boolean(nearestControl(['Condition']) || nearestControl(['Warranty Expires']) || nearestControl(['Operational']));
    if (wanted === 'spatial') return Boolean(nearestControl(['GIS Reference']) || nearestControl(['Latitude']) || nearestControl(['External System']));
    return false;
  }

  async function clickTab(name) {
    if (tabContextReady(name)) return true;
    const wanted = norm(name);
    const matches = [...document.querySelectorAll('[role="tab"],a,button,[onclick],li,span,td,div')]
      .filter((element) => {
        if (!visible(element) || isAssistantElement(element) || norm(element.textContent) !== wanted || clean(element.textContent).length >= 60) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 20 && rect.width < 260 && rect.height > 12 && rect.height < 80 && rect.left > 140 && rect.top > 70 && rect.top < 235;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const ancestry = `${element.id || ''} ${element.className || ''} ${element.parentElement?.id || ''} ${element.parentElement?.className || ''}`.toLowerCase();
        const clickable = element.closest('[role="tab"],a,button,[onclick]') || element;
        const interactive = clickable !== element || element.matches('[role="tab"],a,button,[onclick]');
        let score = Math.abs((rect.top + rect.height / 2) - 155) * 18 + Math.abs(rect.left - 240) * 0.15 + rect.width * 0.05;
        if (element.getAttribute('role') === 'tab') score -= 2200;
        if (/tab|tabs|tabpanel|tabstrip|tab-control/.test(ancestry)) score -= 1500;
        if (interactive) score -= 900;
        else score += 1600;
        if (rect.top > 185) score += 2200; // avoid section headings such as Financial/Risk -> Details
        return { element, clickable, score };
      })
      .sort((a, b) => a.score - b.score);

    for (const item of matches.slice(0, 5)) {
      try { item.clickable.click(); } catch (_) { dispatchClick(item.clickable); }
      const end = Date.now() + 2600;
      while (Date.now() < end) {
        await wait(0);
        if (tabContextReady(name)) return true;
      }
    }
    return tabContextReady(name);
  }

  function fillByLabel(labelNames, value, options = {}) {
    if (value === '' || value == null) return { status: 'blank', label: Array.isArray(labelNames) ? labelNames[0] : labelNames };
    const found = nearestControl(labelNames, options.root || document);
    const label = Array.isArray(labelNames) ? labelNames[0] : labelNames;
    if (!found) return { status: 'missing', label };
    if (found.control.readOnly && !options.allowReadOnly) return { status: 'readonly', label, control: found.control };
    const ok = setNativeValue(found.control, value);
    if (ok) {
      const old = found.control.style.outline;
      found.control.style.outline = '2px solid #111';
      setTimeout(() => { found.control.style.outline = old; }, 550);
    }
    return { status: ok ? 'filled' : 'failed', label, control: found.control };
  }

  function clickableLookupNode(element) {
    if (!element) return null;
    return element.closest?.('button,a,input[type="button"],input[type="image"],[role="button"],[onclick]') || element;
  }

  function findLookupTrigger(control) {
    if (!control) return null;
    const cr = control.getBoundingClientRect();
    const selector = 'a,button,input[type="button"],input[type="image"],img,span,i,svg,[role="button"],[onclick],div';
    const candidates = [...document.querySelectorAll(selector)]
      .filter((element) => {
        if (!visible(element) || isAssistantElement(element) || element === control) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.width > 100 || rect.height > 65) return false;
        const sameLine = Math.abs((rect.top + rect.height / 2) - (cr.top + cr.height / 2)) < Math.max(26, cr.height * 0.95);
        const nearRight = rect.left >= cr.right - 55 && rect.left <= cr.right + 90;
        const overlaps = rect.right >= cr.right - 62 && rect.right <= cr.right + 90;
        return sameLine && (nearRight || overlaps);
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const clickable = clickableLookupNode(element);
        const clue = norm([
          element.getAttribute('title') || '', element.getAttribute('aria-label') || '', element.getAttribute('alt') || '',
          element.getAttribute('src') || '', element.id || '', element.getAttribute('name') || '',
          typeof element.className === 'string' ? element.className : '', element.getAttribute('onclick') || '',
          clickable?.getAttribute?.('title') || '', clickable?.getAttribute?.('aria-label') || '', clickable?.getAttribute?.('onclick') || ''
        ].join(' '));
        let score = 0;
        if (/search|lookup|select|find|magnif|picker|browse|choose|zoom/.test(clue)) score += 1600;
        if (element.matches('input[type="image"],img,svg,i')) score += 350;
        if (clickable?.matches?.('button,a,input[type="button"],input[type="image"],[role="button"],[onclick]')) score += 300;
        score -= Math.abs(rect.left - cr.right) * 5;
        score -= Math.abs((rect.top + rect.height / 2) - (cr.top + cr.height / 2)) * 12;
        return { clickable, score };
      })
      .filter((item) => item.clickable)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.clickable || null;
  }

  function dispatchClick(target, doubleClick = false) {
    if (!target) return;
    try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    // Evolution's legacy popup controls do not always respond to a synthetic
    // dispatchEvent('click'). Reproduce the pointer sequence and then use the
    // element's native click() method so onclick/default actions are executed.
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try {
        const EventType = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
        target.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}
    }
    try {
      if (typeof target.click === 'function') target.click();
      else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (_) {
      try { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    }
    if (doubleClick) {
      try { target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, detail: 2 })); } catch (_) {}
    }
  }


  // Legacy toolbar actions such as Change Status and PPM + New can bind their
  // popup action to more than one mouse event. The generic dispatchClick()
  // intentionally reproduces a full pointer sequence for lookup widgets, but
  // doing that on these toolbar controls can open the same popup more than
  // once. Use one native click only and debounce each workflow action.
  function dispatchLegacySingleClick(target, guardKey = '', cooldownMs = 12000) {
    if (!target) return false;
    const now = Date.now();
    const key = clean(guardKey || 'legacy-control');
    const last = Number(state.legacyClickTimes?.[key] || 0);
    if (last && now - last < cooldownMs) return false;
    if (!state.legacyClickTimes) state.legacyClickTimes = Object.create(null);
    state.legacyClickTimes[key] = now;
    try { target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    try {
      if (typeof target.click === 'function') target.click();
      else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
      return true;
    } catch (_) {
      try {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
        return true;
      } catch (_) { return false; }
    }
  }

  function nearbyHiddenValues(control) {
    if (!control) return [];
    const seen = new Set();
    const values = [];
    const add = (input) => {
      if (!(input instanceof HTMLInputElement) || input.type !== 'hidden' || seen.has(input)) return;
      const clue = `${input.id || ''} ${input.name || ''}`;
      if (/__VIEWSTATE|__EVENTVALIDATION|__VIEWSTATEGENERATOR|__EVENTTARGET|__EVENTARGUMENT/i.test(clue)) return;
      seen.add(input);
      values.push(`${input.id || input.name || 'hidden'}=${String(input.value || '')}`);
    };
    const row = control.closest('tr,.row,.form-group') || control.parentElement?.parentElement || control.parentElement;
    if (row) [...row.querySelectorAll('input[type="hidden"]')].forEach(add);
    let node = control.parentElement;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth += 1, node = node.parentElement) {
      const local = [...node.querySelectorAll('input[type="hidden"]')];
      if (local.length <= 30) local.forEach(add);
    }
    return values.slice(0, 40);
  }

  function hiddenCommitted(control) {
    return nearbyHiddenValues(control).some((entry) => {
      const value = clean(entry.split('=').slice(1).join('='));
      return value && value !== '0' && norm(value) !== 'false' && norm(value) !== 'null';
    });
  }

  function splitLookupValue(value) {
    const full = clean(value);
    const sep = full.indexOf(' - ');
    if (sep > 0) return { full, code: clean(full.slice(0, sep)), description: clean(full.slice(sep + 3)) };
    const condition = full.match(/^([A-Za-z0-9_.]+)\s+(.+)$/);
    if (condition && /^[0-9]+$/.test(condition[1])) return { full, code: condition[1], description: condition[2] };
    return { full, code: '', description: full };
  }

  function buildingNumber(value) {
    const match = clean(value).match(/(?:WCH-)?(\d{1,3})/i);
    return match ? String(Number(match[1])) : '';
  }

  function makeLookupSpec(field, value, options = {}) {
    const parts = splitLookupValue(value);
    let strictCode = clean(options.strictCode || parts.code || '');
    if (field === 'Building') strictCode = buildingNumber(options.strictCode || value) || strictCode;
    if (field === 'Condition' && !strictCode) strictCode = clean(value).match(/^([A-Za-z0-9_.]+)/)?.[1] || '';
    return {
      id: uniqueId('lookup'),
      field,
      tab: options.tab || 'Details',
      value: clean(value),
      display: clean(options.display || value),
      strictCode,
      description: clean(options.description || parts.description),
      aliases: uniqueNonBlank([value, options.display, strictCode, options.description, ...(options.aliases || [])]),
      searchTerms: uniqueNonBlank([strictCode, options.description, value, options.display, ...(options.searchTerms || [])]),
      buildingName: clean(options.buildingName || ''),
      locationDescription: clean(options.locationDescription || ''),
      floorName: clean(options.floorName || ''),
      sourceCode: clean(options.sourceCode || strictCode),
      createdAt: Date.now(),
      openedAt: 0,
      status: 'created',
      attempts: 0
    };
  }

  function lookupMapping(record) {
    const system = splitLookupValue(record.system);
    const tag = splitLookupValue(record.tag);
    const type = splitLookupValue(record.type);
    const name = splitLookupValue(record.name);
    const supplier = splitLookupValue(record.supplier);
    const costCentre = splitLookupValue(record.costCentre);
    const buildingDisplay = clean(record.buildingCafmValue || record.buildingDisplay || record.buildingFull || record.buildingCode || record.buildingSearch);
    const buildingStrict = clean(record.buildingListCode || record.buildingCode || record.buildingSearch || buildingNumber(buildingDisplay));
    const locationDisplay = clean(record.locationCafmValue || record.locationDisplay || record.locationFull || record.locationCode || record.locationSearch);
    const locationStrict = clean(record.locationCode || record.locationSearch);

    return [
      makeLookupSpec('Building', buildingDisplay || buildingStrict, {
        strictCode: buildingStrict,
        display: buildingDisplay,
        buildingName: record.buildingName,
        aliases: [record.buildingFull, record.buildingCode, record.buildingSearch, record.buildingName],
        searchTerms: [buildingStrict, record.buildingName, buildingDisplay]
      }),
      makeLookupSpec('Floor', record.floorName, { display: record.floorName, aliases: [record.floorName], searchTerms: [record.floorName] }),
      makeLookupSpec('Location', locationDisplay || locationStrict, {
        strictCode: locationStrict,
        display: locationDisplay,
        sourceCode: locationStrict,
        locationDescription: record.locationDescription,
        floorName: record.floorName,
        aliases: [record.locationFull, record.locationDescription, record.locationSearch],
        searchTerms: [locationStrict, record.locationDescription, locationDisplay]
      }),
      makeLookupSpec('System', record.system, { strictCode: record.systemCode || system.code || (/^[A-Z0-9_&/+.-]+$/.test(clean(record.system)) ? clean(record.system) : ''), description: record.systemDescription && norm(record.systemDescription) !== norm(record.system) ? record.systemDescription : system.description }),
      makeLookupSpec('Tag', record.tag, { strictCode: record.tagCode || tag.code || (/^[A-Z0-9_&/+.-]+$/.test(clean(record.tag)) ? clean(record.tag) : ''), description: record.tagDescription && norm(record.tagDescription) !== norm(record.tag) ? record.tagDescription : tag.description }),
      makeLookupSpec('Type', record.type, { strictCode: record.typeCode || type.code, description: record.typeDescription || type.description }),
      makeLookupSpec('Name', record.name, { strictCode: record.nameCode || name.code, description: record.nameDescription || name.description }),
      makeLookupSpec('Classification', record.classification, { display: record.classification, aliases: [record.classification], searchTerms: [record.classification] }),
      makeLookupSpec('Parent Asset', record.parentAssetCode, { strictCode: record.parentAssetCode, searchTerms: [record.parentAssetCode] }),
      makeLookupSpec('Supplier', record.supplier, { strictCode: supplier.code, description: supplier.description }),
      makeLookupSpec('Cost Centre', record.costCentre, { strictCode: costCentre.code, description: costCentre.description }),
      makeLookupSpec('Condition', record.condition, { tab: 'Financial/Risk' })
    ].filter((item) => clean(item.value));
  }

  function lookupTextMatches(text, spec) {
    const candidate = norm(text);
    if (!candidate || candidate === 'no selection') return false;
    const full = norm(spec.value);
    const display = norm(spec.display);
    const code = norm(spec.strictCode);
    const description = norm(spec.description);

    if (spec.field === 'Instruction') {
      const cc = ppmInstructionCanon(candidate);
      const cf = ppmInstructionCanon(full);
      const cd = ppmInstructionCanon(description);
      if (cc && ((cf && cc === cf) || (cd && (cc === cd || cc.includes(cd) || cd.includes(cc))))) return true;
    }

    if (spec.field === 'Building' && code) {
      const first = candidate.match(/^(?:wch-)?0*(\d{1,3})(?:\s*[-:]|\s|$)/i)?.[1];
      if (first && String(Number(first)) === String(Number(code.replace(/\D/g, '')))) return true;
    }
    if (code) {
      const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
      if (candidate === code || candidate.startsWith(`${code} -`) || re.test(candidate)) return true;
    }
    if (full && candidate === full) return true;
    if (display && candidate === display) return true;
    if (!code && description && (candidate === description || candidate.startsWith(`${description} -`) || (description.length >= 4 && candidate.includes(description)))) return true;
    return false;
  }

  function lookupScore(text, spec) {
    const candidate = norm(text);
    if (!candidate || candidate.length > 360) return -Infinity;
    const code = norm(spec.strictCode);
    const full = norm(spec.value);
    const display = norm(spec.display);
    const description = norm(spec.description);
    let score = 0;

    if (spec.field === 'Instruction') {
      const cc = ppmInstructionCanon(candidate);
      const cf = ppmInstructionCanon(full);
      const cd = ppmInstructionCanon(description);
      if (cc && ((cf && cc === cf) || (cd && cc === cd))) score += 14000;
      else if (cc && cd && (cc.includes(cd) || cd.includes(cc))) score += 10000;
    }

    if (candidate === full && full) score += 12000;
    if (candidate === display && display) score += 12000;

    if (spec.field === 'Building' && code) {
      const first = candidate.match(/^(?:wch-)?0*(\d{1,3})(?:\s*[-:]|\s|$)/i)?.[1];
      if (first && String(Number(first)) === String(Number(code.replace(/\D/g, '')))) score += 10000;
      else if (first) return -Infinity;
      const name = norm(spec.buildingName);
      if (name && candidate.includes(name)) score += 2200;
    } else if (code) {
      const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
      if (candidate === code) score += 11000;
      else if (candidate.startsWith(`${code} -`)) score += 10500;
      else if (re.test(candidate)) score += 8500;
      else if (candidate.includes(code)) score += 5000;
      else return -Infinity;
    }

    if (description) {
      if (candidate === description) score += 5000;
      else if (candidate.includes(description)) score += code ? 2400 : 7000;
    }
    for (const alias of spec.aliases || []) {
      const a = norm(alias);
      if (!a) continue;
      if (candidate === a) score += 5000;
      else if (a.length >= 5 && candidate.includes(a)) score += 1000;
    }
    if (spec.field === 'Location') {
      const floor = norm(spec.floorName);
      const desc = norm(spec.locationDescription);
      if (floor && candidate.includes(floor)) score += 600;
      if (desc && candidate.includes(desc)) score += 500;
    }
    return score;
  }

  function isAssistantElement(element) {
    if (!element) return false;
    return Boolean(element.closest?.(`#${HOST_ID}`));
  }

  function explicitLookupSurfaces() {
    const selector = '[role="listbox"],[role="grid"],[role="menu"],[role="dialog"],[class*="lookup" i],[id*="lookup" i],[class*="dropdown" i],[id*="dropdown" i],[class*="autocomplete" i],[class*="popup" i],[id*="popup" i],[class*="search" i],[id*="search" i]';
    return [...document.querySelectorAll(selector)]
      .filter((element) => {
        if (!visible(element) || isAssistantElement(element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 40) return false;
        const text = clean(element.textContent);
        const role = norm(element.getAttribute('role') || '');
        const rowCount = element.querySelectorAll('[role="option"],[role="row"],tr,li').length;
        const hasTableAndInput = Boolean(element.querySelector('table') && element.querySelector('input[type="text"],input[type="search"],input:not([type])'));
        const hasPaging = /items?\s+\d+\s*[-]\s*\d+\s+(?:out of|of)\s+\d+/i.test(text);
        return ['listbox', 'grid', 'menu', 'dialog'].includes(role) || rowCount >= 2 || hasTableAndInput || hasPaging;
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return ar.width * ar.height - br.width * br.height;
      });
  }

  function optionCandidates(spec) {
    const popupLikePage = !isAssetPage() || !TOP;
    const surfaces = explicitLookupSurfaces();
    const roots = surfaces.length ? surfaces.slice(0, 6) : (popupLikePage ? [document.body] : [document.body]);
    const source = TOP && isAssetPage() ? nearestControl([spec.field])?.control : null;
    const sourceRect = source?.getBoundingClientRect?.();
    const out = [];
    const seen = new Set();

    for (const root of roots) {
      const nodes = [...root.querySelectorAll('[role="option"],[role="row"],li,tr,td,a,button,div,span')];
      for (const node of nodes) {
        if (!visible(node) || isAssistantElement(node) || node === source || node.contains(source)) continue;
        if (node.matches('label,script,style,noscript')) continue;
        if (node.querySelector?.('input:not([type="hidden"]),textarea,select')) continue;
        const text = clean(node.textContent);
        if (!text || text.length < 1 || text.length > 360) continue;
        if (/^items?\s+\d+\s*[-–]\s*\d+\s+(?:out of|of)\s+\d+$/i.test(text)) continue;
        if (/^(new entity|details|notes|financial\/risk|spatial|asset|classification)$/i.test(text)) continue;
        if (sourceRect && !surfaces.length && TOP && isAssetPage()) {
          const rect = node.getBoundingClientRect();
          const below = rect.top >= sourceRect.top - 12 && rect.top <= sourceRect.bottom + 900;
          const horizontal = rect.right >= sourceRect.left - 80 && rect.left <= sourceRect.right + 500;
          if (!below || !horizontal) continue;
        }
        const score = lookupScore(text, spec);
        if (!Number.isFinite(score) || score < 4200) continue;
        const key = norm(text);
        const rect = node.getBoundingClientRect();
        const semantic = node.matches('[role="option"],[role="row"],li,tr,a,button') ? 400 : 0;
        const total = score + semantic - Math.min(600, text.length);
        const existing = seen.get(key);
        if (!existing || total > existing.score || (total === existing.score && rect.width * rect.height < existing.area)) {
          seen.set(key, { node, text, score: total, area: rect.width * rect.height });
        }
      }
    }
    out.push(...seen.values());
    out.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    return out;
  }

  function findLookupSearchInput(spec) {
    const source = TOP && isAssetPage() ? nearestControl([spec.field])?.control : null;
    const surfaces = explicitLookupSurfaces();
    if (TOP && isAssetPage() && !surfaces.length) return null;
    const roots = surfaces.length ? surfaces.slice(0, 8) : [document];
    const candidates = [];
    for (const root of roots) {
      for (const input of root.querySelectorAll('input[type="text"],input[type="search"],input:not([type])')) {
        if (!visible(input) || isAssistantElement(input) || input === source || input.readOnly || input.disabled) continue;
        const clue = norm(`${input.id || ''} ${input.name || ''} ${input.placeholder || ''} ${input.getAttribute('aria-label') || ''} ${input.getAttribute('title') || ''}`);
        let score = 0;
        if (/search|filter|find|keyword|criteria|code|description|name/.test(clue)) score += 1000;
        if (surfaces.some((surface) => surface.contains(input))) score += 600;
        const rect = input.getBoundingClientRect();
        if (rect.width > 120) score += 100;
        candidates.push({ input, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.input || null;
  }

  function findSearchButton(input) {
    if (!input) return null;
    const ir = input.getBoundingClientRect();
    const root = input.closest('form,[role="dialog"],[class*="popup" i],[id*="popup" i]') || document;
    const selectors = 'button,a,input[type="button"],input[type="submit"],input[type="image"],[role="button"],[onclick],img,svg,i,span';
    const scored = [...root.querySelectorAll(selectors)]
      .filter((element) => visible(element) && !isAssistantElement(element) && element !== input)
      .map((element) => {
        const clickable = clickableLookupNode(element);
        if (!clickable || clickable === input || isAssistantElement(clickable)) return null;
        const rect = element.getBoundingClientRect();
        const cr = clickable.getBoundingClientRect?.() || rect;
        if (Math.max(rect.width, cr.width) > 160 || Math.max(rect.height, cr.height) > 90) return null;
        const text = norm([
          element.textContent || '', element.getAttribute('title') || '', element.getAttribute('aria-label') || '',
          element.getAttribute('alt') || '', element.getAttribute('src') || '', element.id || '',
          element.getAttribute('name') || '', typeof element.className === 'string' ? element.className : '',
          element.getAttribute('onclick') || '', clickable.getAttribute?.('title') || '',
          clickable.getAttribute?.('aria-label') || '', clickable.getAttribute?.('onclick') || '',
          clickable.getAttribute?.('href') || ''
        ].join(' '));
        const vertical = Math.abs((rect.top + rect.height / 2) - (ir.top + ir.height / 2));
        const horizontal = rect.left - ir.right;
        let score = 0;
        if (/search|find|magnif|filter|quicksearch|quick search|lookup|go/.test(text)) score += 2200;
        if (element.matches('input[type="image"],img,svg,i')) score += 300;
        if (vertical < 34 && horizontal > -45 && horizontal < 150) {
          score += 1500 - vertical * 10 - Math.max(0, horizontal) * 3;
        }
        if (rect.left >= ir.right - 35 && rect.left <= ir.right + 75 && vertical < 24) score += 900;
        return { clickable, score, distance: Math.abs(horizontal) + vertical * 3 };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.distance - b.distance);

    if (scored[0]?.score > 650) return scored[0].clickable;

    // Last-resort fallback for the Concept Evolution Quick Search popup: the
    // magnifier can be an unlabelled image immediately to the right of input.
    for (const offset of [8, 16, 24, 32, 40]) {
      const x = Math.min(window.innerWidth - 2, ir.right + offset);
      const y = Math.min(window.innerHeight - 2, ir.top + ir.height / 2);
      const hit = document.elementFromPoint(x, y);
      const clickable = clickableLookupNode(hit);
      if (clickable && clickable !== input && visible(clickable) && !isAssistantElement(clickable)) return clickable;
    }
    return null;
  }

  function lookupGridSignature() {
    const surfaces = explicitLookupSurfaces();
    const root = surfaces[0] || document.body;
    if (!root) return '';
    const rows = [...root.querySelectorAll('tr,[role="row"],li')]
      .filter(visible)
      .slice(0, 35)
      .map((row) => clean(row.textContent).slice(0, 180))
      .filter(Boolean);
    const pager = clean(root.textContent).match(/(?:items?\s*)?\d+\s*(?:-|to|–)\s*\d+\s*(?:out of|of)\s*\d+/i)?.[0] || '';
    return `${pager}|${rows.join('|')}`;
  }

  async function submitLookupSearch(input, term, field) {
    const before = lookupGridSignature();
    try { input.focus(); } catch (_) {}
    setNativeValue(input, '');
    setNativeValue(input, term);

    for (const type of ['keydown', 'keypress', 'keyup']) {
      try {
        const event = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        input.dispatchEvent(event);
      } catch (_) {}
    }

    const button = findSearchButton(input);
    if (button) dispatchClick(button, false);
    try {
      await waitForDom(() => {
        const now = lookupGridSignature();
        return now && (!before || now !== before) ? now : null;
      }, state.settings.lookupTimeoutMs, `${field} lookup search results`);
      return true;
    } catch (_) {
      return lookupGridSignature() !== before;
    }
  }

  function bestClickableForOption(node) {
    if (!node) return null;
    if (node.matches('a,button,[role="option"],[onclick]')) return node;
    const child = [...node.querySelectorAll('a,button,[role="option"],[onclick]')].filter(visible)[0];
    return child || node;
  }

  async function updatePendingLookup(id, patch) {
    const data = await storageGet(STORAGE.pendingLookup);
    const current = data[STORAGE.pendingLookup];
    if (!current || current.id !== id) return null;
    const next = { ...current, ...patch };
    await storageSet({ [STORAGE.pendingLookup]: next });
    return next;
  }

  async function handlePendingLookup() {
    if (state.lookupAgentBusy) return;
    const data = await storageGet(STORAGE.pendingLookup);
    const pending = data[STORAGE.pendingLookup];
    if (!pending || !['opened', 'searching'].includes(pending.status)) return;
    if (Date.now() - Number(pending.createdAt || 0) > 180000) return;

    const candidates = optionCandidates(pending);
    const searchInput = findLookupSearchInput(pending);
    if (!candidates.length && !searchInput) return;

    state.lookupAgentBusy = true;
    let claimed = false;
    try {
      const claim = await runtimeMessage({ type: 'CLAIM_LOOKUP', pendingId: pending.id });
      if (claim && claim.claimed === false) return;
      claimed = true;

      let current = (await storageGet(STORAGE.pendingLookup))[STORAGE.pendingLookup];
      if (!current || current.id !== pending.id || !['opened', 'searching'].includes(current.status)) return;

      let options = optionCandidates(current);
      if (!options.length) {
        const input = findLookupSearchInput(current);
        if (input) {
          const terms = current.searchTerms?.length ? current.searchTerms : [current.strictCode, current.value];
          const index = Math.max(0, Math.min(terms.length - 1, Number(current.searchTermIndex) || 0));
          const term = clean(terms[index] || current.value);
          if (term) {
            await updatePendingLookup(current.id, { status: 'searching', lastSearchTerm: term });
            await submitLookupSearch(input, term, current.field);
          }
          options = optionCandidates(current);
          if (!options.length) {
            const nextIndex = index + 1;
            const attempts = Number(current.attempts || 0) + 1;
            if (nextIndex < terms.length && attempts < 10) {
              await updatePendingLookup(current.id, { status: 'opened', searchTermIndex: nextIndex, attempts });
            } else if (attempts < 10) {
              await updatePendingLookup(current.id, { status: 'opened', searchTermIndex: 0, attempts });
            } else {
              await updatePendingLookup(current.id, { status: 'error', error: `No exact CAFM option found for ${current.field}: ${current.value}` });
            }
            return;
          }
        }
      }

      if (!options.length) return;
      const best = options[0];
      const second = options[1];
      if (second && Math.abs(best.score - second.score) < 250 && norm(best.text) !== norm(second.text)) {
        await updatePendingLookup(current.id, {
          status: 'error',
          error: `Ambiguous ${current.field} lookup. More than one CAFM row matches ${current.value}`,
          candidates: options.slice(0, 5).map((item) => item.text)
        });
        return;
      }

      const clickable = bestClickableForOption(best.node);
      // Quick Search grids commonly commit the selected row on double-click.
      // A normal click is still generated by dispatchClick before dblclick.
      dispatchClick(clickable, true);
      await updatePendingLookup(current.id, {
        status: 'selected',
        selectedText: best.text,
        selectedScore: best.score,
        selectedAt: Date.now(),
        handlerUrl: location.href,
        handlerFrame: TOP ? 'top' : 'frame'
      });
      await runtimeMessage({ type: 'LOOKUP_SELECTED', pendingId: current.id });
    } catch (error) {
      await updatePendingLookup(pending.id, { status: 'error', error: `Lookup automation error: ${error.message || error}` });
    } finally {
      if (claimed) await runtimeMessage({ type: 'RELEASE_LOOKUP', pendingId: pending.id });
      state.lookupAgentBusy = false;
    }
  }

  function scheduleLookupAgent(delay = 350) {
    clearTimeout(state.lookupTimer);
    state.lookupTimer = setTimeout(() => handlePendingLookup().catch(() => {}), delay);
  }

  function startLookupAgent() {
    const observer = new MutationObserver(() => scheduleLookupAgent(200));
    try { observer.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true }); } catch (_) {}
    setInterval(() => scheduleLookupAgent(0), 900);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE.pendingLookup]) scheduleLookupAgent(80);
    });
  }

  function cssEsc(value) {
    try { return CSS.escape(String(value)); } catch (_) { return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
  }

  function uniqueInDocument(doc, selector) {
    try { return doc.querySelectorAll(selector).length === 1; } catch (_) { return false; }
  }

  function cssPathForElement(element) {
    if (!(element instanceof Element)) return '';
    const doc = element.ownerDocument || document;
    if (element.id) {
      const sel = `#${cssEsc(element.id)}`;
      if (uniqueInDocument(doc, sel)) return sel;
    }
    const parts = [];
    let node = element;
    for (let depth = 0; node && node.nodeType === 1 && depth < 9; depth += 1, node = node.parentElement) {
      let part = node.localName || node.tagName.toLowerCase();
      const name = node.getAttribute?.('name');
      if (name) {
        const named = `${part}[name="${String(name).replace(/"/g, '\\"')}"]`;
        if (uniqueInDocument(doc, named)) { parts.unshift(named); break; }
      }
      const cls = [...(node.classList || [])].filter((x) => x && !/^ng-|^ui-|active|hover|selected/i.test(x)).slice(0, 2);
      if (cls.length) part += cls.map((x) => `.${cssEsc(x)}`).join('');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((x) => x.localName === node.localName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(' > ');
      if (uniqueInDocument(doc, sel)) return sel;
    }
    return parts.join(' > ');
  }

  function clickFingerprint(element, event) {
    const rect = element.getBoundingClientRect();
    const attrs = {};
    for (const name of ['id','name','title','aria-label','alt','src','href','onclick','class','role']) {
      const value = element.getAttribute?.(name);
      if (value) attrs[name] = String(value).slice(0, 1200);
    }
    return {
      selector: cssPathForElement(element),
      tag: String(element.localName || '').toLowerCase(),
      attrs,
      text: clean(element.textContent || element.value || '').slice(0, 240),
      frameUrl: location.href,
      topFrame: TOP,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      xRatio: window.innerWidth ? event.clientX / window.innerWidth : 0,
      yRatio: window.innerHeight ? event.clientY / window.innerHeight : 0,
      capturedAt: new Date().toISOString()
    };
  }

  function bestClickedNode(event) {
    const path = (event.composedPath?.() || []).filter((x) => x instanceof Element).slice(0, 10);
    let best = event.target instanceof Element ? event.target : null;
    let bestScore = -1;
    for (let i = 0; i < path.length; i += 1) {
      const el = path[i];
      let score = 0;
      if (el.getAttribute?.('onclick')) score += 130;
      if (el.matches?.('button,a,input[type="button"],input[type="image"],[role="button"]')) score += 110;
      if (el.matches?.('img,svg,i')) score += 75;
      if (el.getAttribute?.('href')) score += 55;
      try { if (getComputedStyle(el).cursor === 'pointer') score += 35; } catch (_) {}
      score -= i * 3;
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best;
  }

  // Teach mode: capture exactly one successful manual click. Keep the armed
  // flag in memory on the visible top page so a later click in the status/new
  // popup cannot overwrite the control we meant to teach. Storage remains as
  // a cross-frame fallback for unusual same-origin frame layouts.
  document.addEventListener('click', (event) => {
    const target = bestClickedNode(event);
    if (!target || isAssistantElement(target)) return;
    const payload = clickFingerprint(target, event);

    if (TOP && state.teachStatusArmed) {
      state.teachStatusArmed = false;
      storageRemove([STORAGE.statusLearnRequest]).catch(() => {});
      storageSet({ [STORAGE.learnedStatus]: payload }).then(() => {
        state.learnedStatus = payload;
        runtimeMessage({ type: 'STATUS_BUTTON_LEARNED', payload });
      }).catch(() => {});
      return;
    }
    if (TOP && state.teachNewArmed) {
      state.teachNewArmed = false;
      storageRemove([STORAGE.newLearnRequest]).catch(() => {});
      storageSet({ [STORAGE.learnedNew]: payload }).then(() => {
        state.learnedNew = payload;
        runtimeMessage({ type: 'PPM_NEW_BUTTON_LEARNED', payload });
      }).catch(() => {});
      return;
    }

    // Cross-frame fallback. The request is removed before saving the learned
    // element so rapid follow-up clicks cannot replace it.
    storageGet([STORAGE.statusLearnRequest, STORAGE.newLearnRequest]).then(async (stored) => {
      const now = Date.now();
      const statusRequest = stored?.[STORAGE.statusLearnRequest];
      const newRequest = stored?.[STORAGE.newLearnRequest];
      if (statusRequest?.active && Number(statusRequest.expiresAt || 0) >= now) {
        await storageRemove([STORAGE.statusLearnRequest]);
        await storageSet({ [STORAGE.learnedStatus]: payload });
        runtimeMessage({ type: 'STATUS_BUTTON_LEARNED', payload });
        return;
      }
      if (newRequest?.active && Number(newRequest.expiresAt || 0) >= now) {
        await storageRemove([STORAGE.newLearnRequest]);
        await storageSet({ [STORAGE.learnedNew]: payload });
        runtimeMessage({ type: 'PPM_NEW_BUTTON_LEARNED', payload });
      }
    }).catch(() => {});
  }, true);

  startLookupAgent();
  if (!TOP) return;

  function keyboardEvent(target, type, key, options = {}) {
    if (!target) return;
    const codeMap = { Enter: 13, ArrowDown: 40, ArrowUp: 38, Backspace: 8, Tab: 9 };
    const keyCode = options.keyCode || codeMap[key] || (key && key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    try {
      target.dispatchEvent(new KeyboardEvent(type, {
        key,
        code: options.code || (key && key.length === 1 ? `Key${key.toUpperCase()}` : key),
        keyCode,
        which: keyCode,
        ctrlKey: Boolean(options.ctrlKey),
        shiftKey: Boolean(options.shiftKey),
        bubbles: true,
        cancelable: true
      }));
    } catch (_) {}
  }

  function setFocusedInputValue(control, value, inputData = null) {
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) return false;
    try {
      const proto = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(control, String(value ?? ''));
      else control.value = String(value ?? '');
      try {
        if (typeof InputEvent !== 'undefined') {
          control.dispatchEvent(new InputEvent('input', {
            data: inputData,
            inputType: inputData == null ? 'deleteContentBackward' : 'insertText',
            bubbles: true,
            cancelable: false
          }));
        } else {
          control.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (_) {
        control.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function typeIntoInlineLookup(control, term) {
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLTextAreaElement)) return false;
    try { control.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
    try { control.focus(); } catch (_) {}
    dispatchClick(control, false);
    await wait(0);

    // Clear the editable combo box without blurring it. Evolution's inline
    // dropdown listens to live keyboard/input events, so do not use the normal
    // setNativeValue helper here (that helper intentionally fires blur/change).
    keyboardEvent(control, 'keydown', 'a', { ctrlKey: true, keyCode: 65, code: 'KeyA' });
    keyboardEvent(control, 'keyup', 'a', { ctrlKey: true, keyCode: 65, code: 'KeyA' });
    keyboardEvent(control, 'keydown', 'Backspace');
    setFocusedInputValue(control, '', null);
    keyboardEvent(control, 'keyup', 'Backspace');
    await wait(0);

    let current = '';
    for (const char of String(term ?? '')) {
      const keyCode = char.toUpperCase().charCodeAt(0);
      keyboardEvent(control, 'keydown', char, { keyCode });
      keyboardEvent(control, 'keypress', char, { keyCode });
      current += char;
      setFocusedInputValue(control, current, char);
      keyboardEvent(control, 'keyup', char, { keyCode });
      await wait(0);
    }
    // A final input/keyup pulse covers older jQuery autocomplete handlers.
    try { control.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    keyboardEvent(control, 'keyup', String(term || '').slice(-1) || '');
    await wait(0);
    return true;
  }

  function inlineOptionCandidates(spec, control) {
    if (!control) return [];
    const cr = control.getBoundingClientRect();
    const out = [];
    const seen = new Map();
    const selector = '[role="option"],[role="row"],li,tr,td,a,button,div,span';
    const nodes = [...document.querySelectorAll(selector)];

    for (const node of nodes) {
      if (!visible(node) || isAssistantElement(node) || node === control || node.contains(control)) continue;
      if (node.matches('label,script,style,noscript')) continue;
      if (node.querySelector?.('input:not([type="hidden"]),textarea,select')) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.height > 80 || rect.width > 900) continue;

      // Inline Concept Evolution dropdowns are anchored directly to the edit
      // box. Limit candidates to that visual lane so rows in the underlying
      // Asset grid cannot be mistaken for dropdown options.
      const below = rect.top >= cr.bottom - 12 && rect.top <= cr.bottom + 850;
      const above = rect.bottom <= cr.top + 12 && rect.bottom >= cr.top - 550;
      if (!below && !above) continue;
      const overlap = Math.min(rect.right, cr.right + 360) - Math.max(rect.left, cr.left - 35);
      if (overlap < Math.min(60, cr.width * 0.25)) continue;
      if (rect.left > cr.right + 160 || rect.right < cr.left - 35) continue;

      const text = clean(node.textContent);
      if (!text || text.length > 300) continue;
      if (/^items?\s+\d+\s*[-–]\s*\d+\s+(?:out of|of)\s+\d+$/i.test(text)) continue;
      const score = lookupScore(text, spec);
      if (!Number.isFinite(score) || score < 4200) continue;

      const semantic = node.matches('[role="option"],li,tr,a,button') ? 900 : node.matches('td') ? 450 : 0;
      const verticalDistance = below ? Math.max(0, rect.top - cr.bottom) : Math.max(0, cr.top - rect.bottom);
      const alignmentPenalty = Math.abs(rect.left - cr.left) * 0.7;
      const area = rect.width * rect.height;
      const total = score + semantic - Math.min(650, text.length) - verticalDistance * 0.35 - alignmentPenalty;
      const key = norm(text);
      const previous = seen.get(key);
      if (!previous || total > previous.score || (total === previous.score && area < previous.area)) {
        seen.set(key, { node, text, score: total, area });
      }
    }

    out.push(...seen.values());
    out.sort((a, b) => b.score - a.score || a.area - b.area || a.text.length - b.text.length);
    return out;
  }

  async function waitForInlineOptions(spec, control, timeoutMs = state.settings.lookupTimeoutMs) {
    try {
      return await waitForDom(() => {
        const options = inlineOptionCandidates(spec, control);
        return options.length ? options : null;
      }, timeoutMs, `${spec.field} dropdown results`);
    } catch (_) {
      return [];
    }
  }

  function lookupCommitFingerprint(control) {
    if (!control) return { value: '', hidden: [], attrs: [] };
    const hidden = nearbyHiddenValues(control);
    const attrs = [];
    const nodes = [control, control.parentElement, control.parentElement?.parentElement].filter(Boolean);
    for (const node of nodes) {
      for (const name of ['data-value', 'data-selected-value', 'data-key', 'data-id', 'aria-activedescendant', 'aria-expanded']) {
        const value = node.getAttribute?.(name);
        if (value != null) attrs.push(`${name}=${value}`);
      }
    }
    return { value: elementValue(control), hidden, attrs };
  }

  function fingerprintChanged(before, after) {
    if (!before || !after) return false;
    if (JSON.stringify(before.hidden || []) !== JSON.stringify(after.hidden || [])) return true;
    if (JSON.stringify(before.attrs || []) !== JSON.stringify(after.attrs || [])) return true;
    return false;
  }

  async function commitInlineSelectionWithKeyboard(spec, control) {
    try { control.focus(); } catch (_) {}
    // Concept Evolution's editable lookup commits its internal value when the
    // user chooses an item through the combo keyboard handler. This is safer
    // than merely changing the visible input text or synthetically clicking a
    // nested DIV inside the popup.
    keyboardEvent(control, 'keydown', 'ArrowDown');
    keyboardEvent(control, 'keyup', 'ArrowDown');
    await wait(0);
    keyboardEvent(control, 'keydown', 'Enter');
    keyboardEvent(control, 'keypress', 'Enter');
    keyboardEvent(control, 'keyup', 'Enter');
    await wait(0);
    try { control.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    keyboardEvent(control, 'keydown', 'Tab');
    keyboardEvent(control, 'keyup', 'Tab');
    try { control.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (_) {}
    try { control.blur(); } catch (_) {}
    await wait(0);
  }

  async function waitForCommittedLookup(spec, beforeFingerprint, timeoutMs = state.settings.lookupTimeoutMs) {
    const evaluate = () => {
      const live = nearestControl([spec.field])?.control;
      if (!live) return null;
      const value = elementValue(live);
      const fp = lookupCommitFingerprint(live);
      const matches = lookupTextMatches(value, spec);
      const optionsOpen = inlineOptionCandidates(spec, live).length > 0;
      const relatedHiddenExist = (fp.hidden || []).length > 0;
      const hiddenOk = !relatedHiddenExist || hiddenCommitted(live) || fingerprintChanged(beforeFingerprint, fp);
      const bareCode = clean(spec.strictCode) && norm(value) === norm(spec.strictCode) && clean(spec.description) && norm(spec.description) !== norm(spec.strictCode);
      if (matches && !optionsOpen && hiddenOk && !bareCode) return { control: live, value, fingerprint: fp, hiddenOk };
      return null;
    };
    try { return await waitForDom(evaluate, timeoutMs, `${spec.field} committed lookup value`); }
    catch (_) { return null; }
  }

  async function selectInlineComboLookup(spec, control, beforeValue, beforeHidden) {
    // Searchable Evolution combo boxes often return no rows when a long lookup
    // description is typed verbatim. For PPM Instruction, type a short filter
    // first (for fire-door PPMs: "fire doors") and then choose the exact full
    // workbook instruction from the filtered dropdown. The workbook remains the
    // source of truth for which option is selected.
    const terms = spec.field === 'Instruction'
      ? uniqueNonBlank([...(spec.searchTerms || []), spec.strictCode, spec.sourceCode, spec.description, spec.value, spec.display])
      : uniqueNonBlank([
          spec.strictCode,
          spec.sourceCode,
          spec.field === 'Building' ? buildingNumber(spec.value) : '',
          spec.description,
          spec.value,
          spec.display,
          ...(spec.searchTerms || [])
        ]);

    let lastTyped = '';
    for (const term of terms) {
      lastTyped = term;
      const beforeFingerprint = lookupCommitFingerprint(control);
      await typeIntoInlineLookup(control, term);
      let options = await waitForInlineOptions(spec, control, spec.field === 'Location' ? 5600 : 4600);

      if (!options.length) {
        try { control.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        keyboardEvent(control, 'keyup', String(term).slice(-1) || '');
        await wait(0);
        options = inlineOptionCandidates(spec, control);
      }
      if (!options.length) continue;

      const exactOptions = options.filter((item) => lookupTextMatches(item.text, spec));
      if (!exactOptions.length) continue;
      const best = exactOptions[0];
      const second = exactOptions[1];
      if (second && norm(best.text) !== norm(second.text) && Math.abs(best.score - second.score) < 220) {
        throw new Error(`Ambiguous ${spec.field} dropdown. More than one inline CAFM option matches ${spec.value}.`);
      }

      // PPM Instruction is deliberately handled like the demonstrated manual
      // workflow: type a short filter, then click the exact required row from
      // the filtered dropdown. Do not rely on ArrowDown selecting the first row,
      // because several fire-door instructions are returned by the same search.
      let committed = null;
      if (spec.field === 'Instruction') {
        const clickable = bestClickableForOption(best.node);
        dispatchClick(clickable, false);
        await wait(0);
        try { control.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        try { control.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (_) {}
        try { control.blur(); } catch (_) {}
        await wait(0);
        committed = await waitForCommittedLookup(spec, beforeFingerprint, 6200);
      } else {
        // Other editable CAFM lookups retain the existing keyboard commit path.
        await commitInlineSelectionWithKeyboard(spec, control);
        committed = await waitForCommittedLookup(spec, beforeFingerprint, spec.field === 'Building' ? 7000 : 5600);
      }

      if (!committed) {
        // Re-open the dropdown before the click fallback. The Enter attempt can
        // close/re-render the popup, so never click a stale option node.
        const liveControl = nearestControl([spec.field])?.control || control;
        await typeIntoInlineLookup(liveControl, term);
        let freshOptions = await waitForInlineOptions(spec, liveControl, spec.field === 'Location' ? 5200 : 4300);
        freshOptions = freshOptions.filter((item) => lookupTextMatches(item.text, spec));
        if (freshOptions.length) {
          const clickable = bestClickableForOption(freshOptions[0].node);
          dispatchClick(clickable, false);
          await wait(0);
          try { liveControl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
          try { liveControl.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (_) {}
          try { liveControl.blur(); } catch (_) {}
          await wait(0);
          committed = await waitForCommittedLookup(spec, beforeFingerprint, spec.field === 'Building' ? 7000 : 5600);
        }
      }

      if (committed) {
        const afterHidden = nearbyHiddenValues(committed.control);
        return {
          field: spec.field,
          selected: committed.value,
          selectedText: best.text,
          inlineDropdown: true,
          typed: term,
          hiddenCommitted: hiddenCommitted(committed.control),
          hiddenChanged: JSON.stringify(afterHidden) !== JSON.stringify(beforeHidden),
          commitVerified: true
        };
      }

      // Do not allow visible search text to masquerade as a selected CAFM
      // record. Clear it before trying another search term.
      const live = nearestControl([spec.field])?.control || control;
      if (live && !lookupTextMatches(elementValue(live), spec)) {
        try { live.focus(); } catch (_) {}
        setFocusedInputValue(live, '', null);
      }
      await wait(0);
    }

    if (lastTyped) {
      const live = nearestControl([spec.field])?.control || control;
      if (live && !lookupTextMatches(elementValue(live), spec)) {
        try { live.focus(); } catch (_) {}
        setFocusedInputValue(live, '', null);
      }
    }
    throw new Error(`${spec.field} text was entered, but CAFM did not confirm a committed dropdown selection for: ${spec.value}`);
  }

  async function selectLookup(spec) {
    await clickTab(spec.tab);
    const found = nearestControl([spec.field]);
    if (!found) throw new Error(`${spec.field} dropdown field was not found on the ${spec.tab} tab.`);
    const control = found.control;
    const beforeValue = elementValue(control);
    const beforeHidden = nearbyHiddenValues(control);

    if (lookupTextMatches(beforeValue, spec) && (hiddenCommitted(control) || !beforeHidden.length)) {
      return { field: spec.field, selected: beforeValue, alreadySelected: true, hiddenCommitted: hiddenCommitted(control) };
    }

    if (control instanceof HTMLSelectElement) {
      const option = [...control.options].find((item) => lookupTextMatches(`${item.value} ${item.textContent}`, spec));
      if (!option) throw new Error(`No exact ${spec.field} option exists in the CAFM list for ${spec.value}.`);
      control.value = option.value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(0);
      const selectedValue = elementValue(control);
      if (!lookupTextMatches(selectedValue, spec)) throw new Error(`${spec.field} did not remain selected after change.`);
      return { field: spec.field, selected: selectedValue, nativeSelect: true, hiddenCommitted: true };
    }

    // In this Concept Evolution build, magnifying-glass fields are editable
    // combo boxes. The correct interaction is: click the text box -> type the
    // code/value -> select the matching item from the inline dropdown. Do not
    // open the magnifying-glass Quick Search popup.
    return selectInlineComboLookup(spec, control, beforeValue, beforeHidden);
  }

  function observedAssetCode() {
    const found = nearestControl(['Asset Code']);
    const value = clean(found?.control?.value || found?.control?.textContent || '');
    if (value) return value;
    const text = clean(document.body?.innerText || '');
    const match = text.match(/\bWCH-[A-Z0-9_\-/]+\b/i);
    return match ? match[0] : '';
  }

  function currentAssetStatusText() {
    if (!isSavedAssetPage()) return '';
    const candidates = [...document.querySelectorAll('span,div,td,a,strong,b,label')]
      .filter((element) => {
        if (!visible(element) || isAssistantElement(element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.top > 230 || rect.width > 560 || rect.height > 90) return false;
        const text = clean(element.textContent);
        return /^status\s*:/i.test(text) && text.length < 160;
      })
      .map((element) => ({ element, text: clean(element.textContent), area: element.getBoundingClientRect().width * element.getBoundingClientRect().height }))
      .sort((a, b) => a.area - b.area);
    return candidates[0]?.text || '';
  }

  function assetIsActive() {
    return /status\s*:\s*active(?:\s*-\s*active)?\b/i.test(currentAssetStatusText());
  }

  function toolbarActionClue(element) {
    if (!element) return '';
    return norm([
      element.textContent || '', element.value || '',
      element.getAttribute?.('title') || '', element.getAttribute?.('aria-label') || '', element.getAttribute?.('alt') || '',
      element.getAttribute?.('src') || '', element.getAttribute?.('id') || '', element.getAttribute?.('name') || '',
      typeof element.className === 'string' ? element.className : '', element.getAttribute?.('onclick') || ''
    ].join(' '));
  }

  function topAssetToolbarCandidates() {
    if (!isSavedAssetPage()) return [];
    const selectors = 'button,a,input[type="button"],input[type="image"],[role="button"],[onclick],img,svg,i,span,td,li,div';
    const seen = new Set();
    const candidates = [];
    for (const element of document.querySelectorAll(selectors)) {
      if (!visible(element) || isAssistantElement(element)) continue;
      const clickable = clickableLookupNode(element);
      if (!clickable || seen.has(clickable) || !visible(clickable)) continue;
      seen.add(clickable);
      const rect = clickable.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8 || rect.width > 90 || rect.height > 70) continue;
      if (rect.top < -8 || rect.top > 92 || rect.left < 150 || rect.left > Math.min(720, window.innerWidth * 0.75)) continue;
      const clue = `${toolbarActionClue(element)} ${toolbarActionClue(clickable)}`;
      const actionLike = element.matches?.('button,a,input[type="button"],input[type="image"],[role="button"],[onclick],img,svg,i')
        || clickable !== element || getComputedStyle(element).cursor === 'pointer'
        || /print|traffic|status|close|save|edit|refresh|delete|copy/.test(clue);
      if (!actionLike) continue;
      candidates.push({ clickable, element, rect, centerY: rect.top + rect.height / 2, clue, x: rect.left });
    }
    candidates.sort((a, b) => a.x - b.x);
    return candidates;
  }

  function findToolbarPrintButton() {
    const candidates = topAssetToolbarCandidates();
    const semantic = candidates
      .map((item) => {
        let score = 0;
        if (/\bprint\b|printer|printicon|print_icon/.test(item.clue)) score += 7000;
        if (item.element.matches?.('img,input[type="image"],svg,i')) score += 180;
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
    if (semantic[0]?.score >= 6500) return semantic[0].clickable;
    const compact = candidates.filter((item) => item.x < 450);
    if (compact.length >= 2) return compact[compact.length - 1].clickable;
    return null;
  }

  function findToolbarCloseButton() {
    const candidates = topAssetToolbarCandidates();
    const semantic = candidates
      .map((item) => {
        let score = 0;
        if (/\bclose\b|cancel|times|cross|icon.?close|close.?icon/.test(item.clue)) score += 7000;
        if (/print|printer|save|status|traffic/.test(item.clue)) score -= 5000;
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
    if (semantic[0]?.score >= 6000) return semantic[0].clickable;

    // On the saved Asset page shown by the user, the compact toolbar starts
    // with Close (X), then Change Asset Status (traffic light), then Print.
    const compact = candidates.filter((item) => item.x < 450);
    if (compact.length >= 3) return compact[0].clickable;
    return null;
  }

  function sameOriginDocuments(rootDoc = document, output = [], depth = 0) {
    if (!rootDoc || output.includes(rootDoc) || depth > 6) return output;
    output.push(rootDoc);
    for (const frame of rootDoc.querySelectorAll?.('iframe,frame') || []) {
      try {
        const child = frame.contentDocument;
        if (child?.documentElement) sameOriginDocuments(child, output, depth + 1);
      } catch (_) {}
    }
    return output;
  }

  function elementFromLearnedFingerprint(doc, learned) {
    if (!doc || !learned) return null;
    try {
      if (learned.selector) {
        const exact = doc.querySelector(learned.selector);
        if (exact && visible(exact)) return clickableLookupNode(exact) || exact;
      }
    } catch (_) {}
    const tag = learned.tag || '*';
    let nodes = [];
    try { nodes = [...doc.querySelectorAll(tag)]; } catch (_) { nodes = []; }
    const attrs = learned.attrs || {};
    const scored = nodes.filter(visible).map((el) => {
      let score = 0;
      for (const name of ['id','name','title','aria-label','alt','src','href','onclick','role']) {
        const expected = attrs[name];
        if (!expected) continue;
        const actual = el.getAttribute?.(name) || '';
        if (actual === expected) score += name === 'id' ? 10000 : 1800;
        else if (actual && (actual.includes(expected) || expected.includes(actual))) score += 700;
      }
      if (learned.text && clean(el.textContent || el.value || '') === learned.text) score += 450;
      const r = el.getBoundingClientRect();
      if (learned.rect) {
        const delta = Math.abs(r.left - Number(learned.rect.left || 0)) + Math.abs(r.top - Number(learned.rect.top || 0));
        score += Math.max(0, 500 - delta * 2);
      }
      return { el, score };
    }).sort((a,b) => b.score - a.score);
    if (scored[0]?.score >= 700) return clickableLookupNode(scored[0].el) || scored[0].el;
    try {
      if (Number.isFinite(Number(learned.xRatio)) && Number.isFinite(Number(learned.yRatio))) {
        const view = doc.defaultView;
        const x = Math.max(0, Math.min((view?.innerWidth || window.innerWidth) - 1, Number(learned.xRatio) * (view?.innerWidth || window.innerWidth)));
        const y = Math.max(0, Math.min((view?.innerHeight || window.innerHeight) - 1, Number(learned.yRatio) * (view?.innerHeight || window.innerHeight)));
        const byPoint = doc.elementFromPoint?.(x, y);
        if (byPoint && visible(byPoint)) return clickableLookupNode(byPoint) || byPoint;
      }
    } catch (_) {}
    return null;
  }

  function findLearnedStatusButton() {
    const learned = state.learnedStatus;
    if (!learned) return null;
    const docs = sameOriginDocuments();
    const preferred = docs.filter((doc) => {
      try { return !learned.frameUrl || doc.location.href === learned.frameUrl || new URL(doc.location.href).pathname === new URL(learned.frameUrl).pathname; }
      catch (_) { return false; }
    });
    for (const doc of [...preferred, ...docs.filter((d) => !preferred.includes(d))]) {
      const found = elementFromLearnedFingerprint(doc, learned);
      if (found) return found;
    }
    return null;
  }

  function findChangeAssetStatusButton() {
    if (!isSavedAssetPage()) return null;

    // Exact control supplied by Concept Evolution. Prefer this stable semantic
    // selector before any learned/geometry fallback. The clickable element is
    // the <a>; the SVG ID is a secondary exact route to the same anchor.
    for (const doc of sameOriginDocuments()) {
      try {
        const exactAnchor = doc.querySelector('a[title="Change Asset Status"][onclick*="Toolbar.AssetStatus"]');
        if (exactAnchor && visible(exactAnchor)) return exactAnchor;
        const exactSvg = doc.getElementById('ctl00_ctl00_ToolbarEx_AssetStatus');
        const svgAnchor = exactSvg?.closest?.('a[onclick*="Toolbar.AssetStatus"],a[title="Change Asset Status"]');
        if (svgAnchor && visible(svgAnchor)) return svgAnchor;
      } catch (_) {}
    }

    const learned = findLearnedStatusButton();
    if (learned) return learned;
    const candidates = topAssetToolbarCandidates();
    const explicit = candidates
      .map((item) => {
        let score = 0;
        if (/change\s*asset\s*status|asset\s*status|change[^a-z0-9]*status/.test(item.clue)) score += 9000;
        if (/traffic.?light|trafficlight|statusicon|status_icon/.test(item.clue)) score += 8000;
        if (/save|print|close|cancel|copy|new|edit|refresh|delete|remove/.test(item.clue)) score -= 10000;
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
    if (explicit[0]?.score >= 7500) return explicit[0].clickable;

    // Primary geometry for this Evolution build: traffic-light is the toolbar
    // action immediately to the RIGHT of the Close/X icon and immediately to
    // the LEFT of Print. This mirrors the user's marked screenshot exactly.
    const close = findToolbarCloseButton();
    if (close) {
      const cr = close.getBoundingClientRect();
      const rightOfClose = candidates
        .filter((item) => item.clickable !== close)
        .map((item) => {
          const gap = item.rect.left - cr.right;
          const vertical = Math.abs(item.centerY - (cr.top + cr.height / 2));
          let score = 0;
          if (gap >= -3 && gap <= 52 && vertical <= 14) score += 12000 - Math.max(0, gap) * 80 - vertical * 120;
          if (/print|printer|save|close|cancel|copy|new|edit|refresh|delete|remove/.test(item.clue)) score -= 10000;
          return { ...item, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      if (rightOfClose[0]) return rightOfClose[0].clickable;
    }

    const print = findToolbarPrintButton();
    if (print) {
      const pr = print.getBoundingClientRect();
      const leftOfPrint = candidates
        .filter((item) => item.clickable !== print)
        .map((item) => {
          const vertical = Math.abs(item.centerY - (pr.top + pr.height / 2));
          const gap = pr.left - item.rect.right;
          let score = 0;
          if (gap >= -4 && gap <= 55 && vertical <= 16) score += 10000 - Math.max(0, gap) * 60 - vertical * 90;
          if (/save|print|close|cancel|copy|new|edit|refresh|delete|remove/.test(item.clue)) score -= 9000;
          return { ...item, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      if (leftOfPrint[0]) return leftOfPrint[0].clickable;
    }

    // Final deterministic fallback: in the compact three-icon toolbar the
    // centre icon is Change Asset Status: [X] [traffic light] [printer].
    const compact = candidates.filter((item) => item.x < 450);
    if (compact.length >= 3) {
      for (let i = 1; i < compact.length - 1; i += 1) {
        const left = compact[i - 1], mid = compact[i], right = compact[i + 1];
        const gapL = mid.rect.left - left.rect.right;
        const gapR = right.rect.left - mid.rect.right;
        const rowAligned = Math.abs(left.centerY - mid.centerY) <= 14 && Math.abs(right.centerY - mid.centerY) <= 14;
        if (rowAligned && gapL >= -4 && gapL <= 55 && gapR >= -4 && gapR <= 55
            && !/print|printer|save|close|cancel|copy|new|edit|refresh|delete|remove/.test(mid.clue)) {
          return mid.clickable;
        }
      }
      return compact[1].clickable;
    }
    return null;
  }

  function currentPpmStatusText() {
    if (!isSavedPpmPage()) return '';
    const candidates = [...document.querySelectorAll('span,div,td,a,strong,b,label')]
      .filter((element) => {
        if (!visible(element) || isAssistantElement(element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.top > 240 || rect.width > 620 || rect.height > 100) return false;
        const text = clean(element.textContent);
        return /^status\s*:/i.test(text) && text.length < 180;
      })
      .map((element) => ({ text: clean(element.textContent), area: element.getBoundingClientRect().width * element.getBoundingClientRect().height }))
      .sort((a, b) => a.area - b.area);
    return candidates[0]?.text || '';
  }

  function ppmIsActive() {
    return /status\s*:\s*active(?:\s*-\s*active)?\b/i.test(currentPpmStatusText());
  }

  function topPpmToolbarCandidates() {
    if (!isSavedPpmPage()) return [];
    const selectors = 'button,a,input[type="button"],input[type="image"],[role="button"],[onclick],img,svg,i,span,td,li,div';
    const seen = new Set();
    const candidates = [];
    for (const element of document.querySelectorAll(selectors)) {
      if (!visible(element) || isAssistantElement(element)) continue;
      const clickable = clickableLookupNode(element);
      if (!clickable || seen.has(clickable) || !visible(clickable)) continue;
      seen.add(clickable);
      const rect = clickable.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8 || rect.width > 95 || rect.height > 70) continue;
      if (rect.top < 35 || rect.top > 130 || rect.left < 155 || rect.left > Math.min(720, window.innerWidth * 0.72)) continue;
      const clue = `${toolbarActionClue(element)} ${toolbarActionClue(clickable)}`;
      const actionLike = element.matches?.('button,a,input[type="button"],input[type="image"],[role="button"],[onclick],img,svg,i')
        || clickable !== element || getComputedStyle(element).cursor === 'pointer'
        || /print|traffic|status|close|save|edit|refresh|delete|copy/.test(clue);
      if (!actionLike) continue;
      candidates.push({ clickable, element, rect, centerY: rect.top + rect.height / 2, clue, x: rect.left });
    }
    candidates.sort((a, b) => a.x - b.x);
    return candidates;
  }

  function findChangePpmStatusButton() {
    // If the user taught the Asset status control and Evolution reuses the
    // same toolbar DOM for PPMs, prefer that learned real control first.
    const learned = findLearnedStatusButton();
    if (learned && visible(learned)) {
      const r = learned.getBoundingClientRect();
      if (r.top >= 30 && r.top <= 140 && r.left >= 140 && r.left <= Math.min(760, window.innerWidth * 0.75)) return learned;
    }
    const candidates = topPpmToolbarCandidates();
    const explicit = candidates
      .map((item) => {
        let score = 0;
        if (/change\s*(ppm|planned maintenance)?\s*status|change[^a-z0-9]*status/.test(item.clue)) score += 9000;
        if (/traffic.?light|trafficlight|statusicon|status_icon/.test(item.clue)) score += 8000;
        if (/save|print|close|cancel|copy|new|edit|refresh|delete|remove/.test(item.clue)) score -= 10000;
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
    if (explicit[0]?.score >= 7500) return explicit[0].clickable;

    const print = candidates
      .filter((item) => /\bprint\b|printer|printicon|print_icon/.test(item.clue))
      .sort((a, b) => b.x - a.x)[0];
    if (print) {
      const pr = print.rect;
      const left = candidates
        .filter((item) => item.clickable !== print.clickable && item.rect.left < pr.left)
        .map((item) => {
          const gap = pr.left - item.rect.right;
          const vertical = Math.abs(item.centerY - print.centerY);
          let score = 0;
          if (gap >= -4 && gap <= 58 && vertical <= 16) score += 10000 - Math.max(0, gap) * 65 - vertical * 90;
          if (/save|print|close|cancel|copy|new|edit|refresh|delete|remove/.test(item.clue)) score -= 9000;
          return { ...item, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      if (left[0]) return left[0].clickable;
    }

    const compact = candidates.filter((item) => item.x < 470);
    if (compact.length >= 3) {
      // Saved Evolution entity toolbars generally expose Close, Status, Print.
      for (let i = 1; i < compact.length - 1; i += 1) {
        const mid = compact[i];
        if (!/print|printer|save|close|cancel|copy|new|edit|refresh|delete|remove/.test(mid.clue)) return mid.clickable;
      }
      return compact[1].clickable;
    }
    return null;
  }

  function findChangePpmStatusDialog() {
    const titleCandidates = [...document.querySelectorAll('h1,h2,h3,h4,legend,span,div,td')]
      .filter((element) => visible(element) && !isAssistantElement(element) && /change.*status/i.test(clean(element.textContent)));
    const roots = [];
    for (const title of titleCandidates) {
      let node = title;
      for (let i = 0; i < 8 && node; i += 1, node = node.parentElement) {
        if (!visible(node) || node === document.body || node === document.documentElement) continue;
        const rect = node.getBoundingClientRect();
        const text = clean(node.textContent);
        if (rect.width >= 260 && rect.width <= 1100 && rect.height >= 120 && rect.height <= 850 && /status/i.test(text)) {
          roots.push({ node, area: rect.width * rect.height });
        }
      }
    }
    roots.sort((a, b) => a.area - b.area);
    return roots[0]?.node || null;
  }

  function findChangeAssetStatusDialog() {
    const exact = document.getElementById('ctl00_ctl00_assetStatusPopup_container');
    if (exact && visible(exact)) return exact;
    const titleCandidates = [...document.querySelectorAll('h1,h2,h3,h4,legend,span,div,td')]
      .filter((element) => visible(element) && !isAssistantElement(element) && /^change asset status\b/i.test(clean(element.textContent)));
    const roots = [];
    for (const title of titleCandidates) {
      let node = title;
      for (let i = 0; i < 8 && node; i += 1, node = node.parentElement) {
        if (!visible(node) || node === document.body || node === document.documentElement) continue;
        const rect = node.getBoundingClientRect();
        const text = clean(node.textContent);
        if (rect.width >= 280 && rect.width <= 1100 && rect.height >= 140 && rect.height <= 820
            && /change asset status/i.test(text) && /asset status/i.test(text)) {
          roots.push({ node, area: rect.width * rect.height });
        }
      }
    }
    roots.sort((a, b) => a.area - b.area);
    return roots[0]?.node || null;
  }

  function findConfirmButton(root = document) {
    const buttons = [...root.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]')]
      .filter(visible);
    return buttons.find((element) => ['select', 'ok', 'choose', 'apply', 'add', 'confirm'].includes(norm(element.textContent || element.value || ''))) || null;
  }


  function statusActiveOptionCandidates(control, dialogRoot = document) {
    if (!control) return [];
    const cr = control.getBoundingClientRect();
    const roots = [dialogRoot || document, document].filter(Boolean);
    const seen = new Set();
    const out = [];
    const selector = '[role="option"],[role="row"],li,tr,td,a,button,[onclick],div,span';

    for (const root of roots) {
      let nodes = [];
      try { nodes = [...root.querySelectorAll(selector)]; } catch (_) { continue; }
      for (const node of nodes) {
        if (!visible(node) || isAssistantElement(node) || node === control || node.contains(control)) continue;
        if (node.matches?.('label,script,style,noscript')) continue;
        const text = clean(node.textContent || node.value || '');
        if (norm(text) !== 'active') continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 35 || rect.height < 10 || rect.height > 75 || rect.width > 800) continue;
        const below = rect.top >= cr.bottom - 16 && rect.top <= cr.bottom + 360;
        const above = rect.bottom <= cr.top + 16 && rect.bottom >= cr.top - 260;
        const horizontalOverlap = Math.min(rect.right, cr.right + 220) - Math.max(rect.left, cr.left - 30);
        if ((!below && !above) || horizontalOverlap < Math.min(50, cr.width * 0.2)) continue;
        const clickTarget = node.closest?.('[role="option"],li,tr,a,button,[onclick]') || node;
        const key = `${clickTarget.tagName}|${clickTarget.id || ''}|${clickTarget.className || ''}|${Math.round(rect.left)}|${Math.round(rect.top)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let score = 0;
        if (node.matches?.('[role="option"],li,tr,a,button')) score += 1000;
        if (clickTarget !== node) score += 300;
        if (below) score += 400;
        score -= Math.abs(rect.left - cr.left) * 0.8;
        score -= Math.max(0, rect.top - cr.bottom) * 0.7;
        score -= rect.width * rect.height / 5000;
        out.push({ node: clickTarget, source: node, score, text, rect });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  async function selectActiveFromStatusDropdown(control, dialogRoot, label = 'Status') {
    if (!control) throw new Error(`${label} field was not detected.`);

    if (control instanceof HTMLSelectElement) {
      const option = [...control.options].find((item) => norm(item.textContent || item.value || '') === 'active');
      if (!option) throw new Error(`Active option was not found in ${label}.`);
      control.value = option.value;
      for (const eventName of ['input', 'change']) control.dispatchEvent(new Event(eventName, { bubbles: true }));
      await waitForDom(() => norm(elementValue(control)).includes('active') && control, state.settings.lookupTimeoutMs, `${label} Active selection`);
      if (!norm(elementValue(control)).includes('active')) throw new Error(`${label} did not retain Active after dropdown selection.`);
      return true;
    }

    try { control.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
    try { control.focus(); } catch (_) {}

    // v6.6: this Evolution status control does not reliably show choices just
    // from a click. The successful manual workflow is: TYPE a few letters
    // (for example "Act") -> wait for the filtered dropdown -> CLICK Active.
    // Reproduce that interaction instead of attempting to open an empty list.
    let options = statusActiveOptionCandidates(control, dialogRoot);
    if (!options.length) {
      await typeIntoInlineLookup(control, 'Act');
      options = await (async () => {
        const started = Date.now();
        while (Date.now() - started < 5000) {
          const found = statusActiveOptionCandidates(control, dialogRoot);
          if (found.length) return found;
          await wait(0);
        }
        return [];
      })();
    }

    // A few builds only return a result after the complete word has been typed.
    if (!options.length) {
      await typeIntoInlineLookup(control, 'Active');
      const started = Date.now();
      while (!options.length && Date.now() - started < 5000) {
        options = statusActiveOptionCandidates(control, dialogRoot);
        if (!options.length) await wait(0);
      }
    }

    if (!options.length) throw new Error(`Active dropdown option was not detected in ${label} after typing Act/Active.`);

    dispatchClick(options[0].node, false);
    await wait(0);

    // The combo can be re-rendered after selection, so verify against a fresh
    // live control rather than trusting the stale DOM node that was typed into.
    const refreshed = nearestControl([label, 'Asset Status', 'PPM Status', 'Status'], dialogRoot)?.control || control;
    const selected = norm(elementValue(refreshed));
    if (!selected.includes('active')) {
      throw new Error(`${label} did not retain Active after selecting the filtered dropdown option (shows: ${elementValue(refreshed) || 'blank'}).`);
    }
    return true;
  }

  // v5.6: exact post-save route captured in the user's successful recording.
  // After ACTIVE is accepted, use the left-hand Asset > PPM navigation item
  // before falling back to a constructed URL.
  function findAssetPpmNavLink() {
    const candidates = [...document.querySelectorAll('a,button,[role="button"],[onclick],li,span,div,td')]
      .filter((element) => {
        if (!visible(element) || isAssistantElement(element)) return false;
        if (norm(element.textContent || '') !== 'ppm') return false;
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.left < 230 && rect.top > 80 && rect.top < Math.min(window.innerHeight - 30, 620)
          && rect.width > 24 && rect.width < 220 && rect.height > 14 && rect.height < 70;
      })
      .map((element) => {
        const clickable = element.closest?.('a,button,[role="button"],[onclick],li') || element;
        const rect = clickable.getBoundingClientRect();
        let score = 0;
        if (clickable.matches?.('a,button,[role="button"],[onclick]')) score += 900;
        score -= rect.left * 2 + Math.abs(rect.top - 210);
        return { clickable, score, area: rect.width * rect.height };
      })
      .sort((a, b) => (b.score - a.score) || (a.area - b.area));
    return candidates[0]?.clickable || null;
  }

  // PPM definitions are workbook-driven only. No asset-family templates are embedded in v8.

  function linkedPpms(record) {
    if (!record) return [];
    // v6.0 is fully data-driven: every enabled CAFM PPM Import row linked by
    // Asset Code is processed in workbook-row order. No instruction, contract,
    // date, frequency, or PPM count is hard-coded in the extension.
    return (state.ppms || [])
      .filter((ppm) => norm(ppm.assetCode) === norm(record.assetCode))
      .sort((a, b) => Number(a.workbookRow || 0) - Number(b.workbookRow || 0));
  }

  function currentPpm(record = currentRecord()) {
    const list = linkedPpms(record);
    const index = Math.max(0, Number(state.session.auto?.ppmIndex) || 0);
    return list[index] || null;
  }

  function ppmSourceIssues(ppm) {
    const issues = [];
    if (!clean(ppm?.assetCode)) issues.push('PPM Asset Code is blank');
    if (!clean(ppm?.instruction)) issues.push('PPM Instruction is blank');
    const mins = ppm?.estTimeMinutes === '' ? 0 : Number(ppm?.estTimeMinutes);
    if (Number.isFinite(mins) && (mins < 0 || mins > 59)) issues.push('Est. Time Minutes must be 0-59');
    return issues;
  }

  function nearestCheckbox(labelNames, root = document) {
    const labels = fieldCandidates(labelNames, root);
    const boxes = [...root.querySelectorAll('input[type="checkbox"]')].filter(visible);
    let best = null;
    let bestScore = Infinity;
    for (const label of labels) {
      const lr = label.getBoundingClientRect();
      const lcy = lr.top + lr.height / 2;
      for (const box of boxes) {
        const br = box.getBoundingClientRect();
        const vertical = Math.abs((br.top + br.height / 2) - lcy);
        const horizontal = Math.abs(br.left - lr.right);
        const sameRow = box.closest('tr,.row,.form-group') && box.closest('tr,.row,.form-group') === label.closest('tr,.row,.form-group');
        const score = vertical * 18 + horizontal - (sameRow ? 250 : 0);
        if (vertical < 34 && score < bestScore) { best = { label, control: box }; bestScore = score; }
      }
    }
    return best;
  }

  function setCheckboxByLabel(labelNames, desired) {
    const found = nearestCheckbox(labelNames);
    const label = Array.isArray(labelNames) ? labelNames[0] : labelNames;
    if (!found) return { status: 'missing', label };
    const target = Boolean(desired);
    if (found.control.checked !== target) {
      found.control.checked = target;
      found.control.dispatchEvent(new Event('input', { bubbles: true }));
      found.control.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { status: found.control.checked === target ? 'filled' : 'failed', label, control: found.control };
  }

  function setSelectByLabel(labelNames, value) {
    if (value === '' || value == null) return { status: 'blank', label: Array.isArray(labelNames) ? labelNames[0] : labelNames };
    const found = nearestControl(labelNames);
    const label = Array.isArray(labelNames) ? labelNames[0] : labelNames;
    if (!found) return { status: 'missing', label };
    let select = found.control instanceof HTMLSelectElement ? found.control : null;
    if (!select) {
      const row = found.label.closest('tr,.row,.form-group') || found.label.parentElement?.parentElement || found.label.parentElement;
      select = [...(row?.querySelectorAll?.('select') || [])].find(visible) || null;
    }
    if (!select) return { status: 'missing-select', label };
    const target = norm(value);
    const options = [...select.options];
    const exact = options.find((o) => norm(o.textContent) === target || norm(o.value) === target);
    const partial = exact || options.find((o) => norm(o.textContent).includes(target) || target.includes(norm(o.textContent)));
    if (!partial) return { status: 'option-missing', label };
    select.value = partial.value;
    for (const eventName of ['input', 'change', 'blur']) select.dispatchEvent(new Event(eventName, { bubbles: true }));
    return { status: 'filled', label, control: select, selected: clean(partial.textContent) };
  }

  function fillEstimatedTime(ppm) {
    const hours = clean(ppm?.estTimeHours);
    const minutes = clean(ppm?.estTimeMinutes);
    if (!hours && !minutes) return { status: 'blank', label: 'Est. Time' };
    const labels = fieldCandidates(['Est. Time', 'Est Time', 'Estimated Time']);
    if (!labels.length) return { status: 'missing', label: 'Est. Time' };
    const label = labels[0];
    const lr = label.getBoundingClientRect();
    const lcy = lr.top + lr.height / 2;
    const inputs = allVisibleControls(document)
      .filter((el) => el instanceof HTMLInputElement)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return Math.abs((r.top + r.height / 2) - lcy) < 28 && r.left >= lr.right - 12 && r.left < lr.right + 300;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    if (inputs.length < 2) return { status: 'missing-inputs', label: 'Est. Time' };
    setNativeValue(inputs[0], hours || '0');
    setNativeValue(inputs[1], minutes || '0');
    return { status: 'filled', label: 'Est. Time' };
  }

  function ppmDirectMapping(ppm) {
    return [
      { kind: 'text', label: ['Family'], value: ppm.family },
      { kind: 'text', label: ['Stock Cost'], value: ppm.stockCost },
      { kind: 'text', label: ['Labour Cost'], value: ppm.labourCost },
      { kind: 'text', label: ['Est. Staff', 'Est Staff'], value: ppm.estStaff },
      { kind: 'checkbox', label: ['Permit'], value: ppm.permit },
      { kind: 'checkbox', label: ['H & S Task', 'H&S Task'], value: ppm.healthSafetyTask },
      { kind: 'checkbox', label: ['Controller'], value: ppm.controller },
      { kind: 'select', label: ['Class'], value: ppm.classValue },
      { kind: 'checkbox', label: ['Action before Task complete'], value: ppm.actionBeforeComplete },
      { kind: 'checkbox', label: ['Action before Task sign off'], value: ppm.actionBeforeSignoff },
      { kind: 'select', label: ['Generate Task Actions'], value: ppm.generateTaskActions },
      { kind: 'text', label: ['Last Service'], value: ppm.lastService },
      { kind: 'text', label: ['Next Service'], value: ppm.nextService },
      { kind: 'select', label: ['Default Day'], value: ppm.defaultDay },
      { kind: 'text', label: ['Period'], value: ppm.period },
      { kind: 'select', label: ['Frequency'], value: ppm.frequency }
    ];
  }

  function ppmLookupMapping(ppm) {
    if (!ppm) return [];
    const mk = (field, value, options = {}) => makeLookupSpec(field, value, { tab: 'General', ...options });
    return [
      // Contract first matches the demonstrated fire-door PPM workflow.
      mk('Contract', ppm.contract, { description: ppm.contract }),
      mk('Instruction', ppm.instruction, { description: ppm.instruction, searchTerms: [/fire\s+doors?/i.test(clean(ppm.instruction)) ? 'fire doors' : clean(ppm.instruction).split(/\s+/).slice(0, 2).join(' '), ppm.instruction] }),
      mk('Priority', ppm.priority, { description: ppm.priority }),
      mk('Shift', ppm.shift, { description: ppm.shift }),
      mk('Compliance', ppm.compliance, { description: ppm.compliance }),
      mk('Cost Code', ppm.costCode, { description: ppm.costCode }),
      mk('Cost Centre', ppm.costCentre, { ...splitLookupValue(ppm.costCentre), description: splitLookupValue(ppm.costCentre).description })
    ].filter((item) => clean(item.value));
  }

  async function fillPpmFields(ppm) {
    const results = [];
    await clickTab('General');
    for (const item of ppmDirectMapping(ppm)) {
      if (item.kind === 'checkbox' && item.value == null) continue;
      if (item.kind !== 'checkbox' && !clean(item.value)) continue;
      let result;
      if (item.kind === 'checkbox') result = setCheckboxByLabel(item.label, Boolean(item.value));
      else if (item.kind === 'select') result = setSelectByLabel(item.label, item.value);
      else result = fillByLabel(item.label, item.value);
      results.push({ ...result, field: item.label[0], kind: item.kind });
      addEvent('ppm-field-fill', { ppmKey: ppm.ppmKey, field: item.label[0], expected: clean(item.value), status: result.status || '', actual: result.control ? clean(elementValue(result.control)) : '' });
      if (['missing', 'failed', 'missing-select', 'option-missing'].includes(result.status)) {
        await recordValidationWarning(currentRecord(), { scope: 'ppm', tab: 'General', field: item.label[0], expected: item.value, actual: '', reason: `Fill result: ${result.status}`, ppmKey: ppm.ppmKey });
      }
    }
    const timeResult = fillEstimatedTime(ppm);
    if (!['blank', 'filled'].includes(timeResult.status)) await recordValidationWarning(currentRecord(), { scope: 'ppm', tab: 'General', field: 'Estimated Time', expected: `${ppm.estTimeHours || ''}:${ppm.estTimeMinutes || ''}`, actual: '', reason: `Fill result: ${timeResult.status}`, ppmKey: ppm.ppmKey });
    for (const [month, enabled] of Object.entries(ppm.months || {})) {
      if (enabled == null) continue;
      const result = setCheckboxByLabel([month], Boolean(enabled));
      if (result.status === 'missing') continue;
      if (result.status !== 'filled') await recordValidationWarning(currentRecord(), { scope: 'ppm', tab: 'General', field: month, expected: String(Boolean(enabled)), actual: '', reason: `Checkbox result: ${result.status}`, ppmKey: ppm.ppmKey });
    }
    if (clean(ppm.notes)) {
      if (await clickTab('Notes')) {
        let result = fillByLabel(['Notes'], ppm.notes);
        if (result.status === 'missing') {
          const area = [...document.querySelectorAll('textarea')].find((el) => visible(el) && !isAssistantElement(el));
          if (!area || !setNativeValue(area, ppm.notes)) await recordValidationWarning(currentRecord(), { scope: 'ppm', tab: 'Notes', field: 'Notes', expected: ppm.notes, actual: area ? elementValue(area) : '', reason: 'Notes could not be filled', ppmKey: ppm.ppmKey });
        }
      }
    }
    await clickTab('General');
    return results;
  }

  async function fillPpmLookups(ppm) {
    const evidence = [];
    for (const spec of ppmLookupMapping(ppm)) {
      try {
        const result = await selectLookup(spec);
        evidence.push(result);
        addEvent('ppm-lookup-selected', { ppmKey: ppm.ppmKey, field: spec.field, expected: clean(spec.value || spec.display || ''), selected: clean(result.selected || result.selectedText || ''), commitVerified: Boolean(result.commitVerified || result.alreadySelected || result.nativeSelect || result.hiddenCommitted) });
      } catch (error) {
        await recordValidationWarning(currentRecord(), { scope: 'ppm', tab: spec.tab || 'General', field: spec.field, expected: spec.value || spec.display || '', actual: '', reason: error.message || String(error), ppmKey: ppm.ppmKey });
      }
      await wait(0);
    }
    return evidence;
  }

  async function fillFireDoorPpmExact(ppm) {
    await clickTab('General');

    // Exact demonstrated order: Contract -> Instruction -> Last Service.
    const contractSpec = makeLookupSpec('Contract', ppm.contract, {
      tab: 'General',
      description: splitLookupValue(ppm.contract).description
    });
    await selectLookup(contractSpec);
    await wait(0);

    const instructionSpec = makeLookupSpec('Instruction', ppm.instruction, {
      tab: 'General',
      description: ppm.instruction,
      searchTerms: [/fire\s+doors?/i.test(clean(ppm.instruction)) ? 'fire doors' : clean(ppm.instruction).split(/\s+/).slice(0, 2).join(' '), ppm.instruction]
    });
    await selectLookup(instructionSpec);
    // Let Evolution apply the Instruction defaults (Discipline, Priority,
    // Compliance, period/frequency, time, months, etc.) before entering date.
    await wait(0);

    const last = fillByLabel(['Last Service'], ppm.lastService);
    if (!last || ['missing', 'failed', 'readonly'].includes(last.status)) {
      throw new Error(`Fire-door PPM Last Service could not be entered (${last?.status || 'missing'}).`);
    }
    try {
      last.control?.dispatchEvent(new Event('change', { bubbles: true }));
      last.control?.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (_) {}
    await wait(0);

    const lastActual = clean(elementValue(last.control));
    if (lastActual && norm(lastActual) !== norm(ppm.lastService)) {
      throw new Error(`Fire-door PPM Last Service did not retain ${ppm.lastService} (shows ${lastActual}).`);
    }

    return [
      { field: 'Contract', selected: ppm.contract },
      { field: 'Instruction', selected: ppm.instruction },
      { field: 'Last Service', selected: ppm.lastService }
    ];
  }

  async function validatePpmPageBeforeSave(ppm) {
    const errors = [];
    await clickTab('General');
    for (const spec of ppmLookupMapping(ppm)) {
      const found = nearestControl([spec.field]);
      if (!found) { errors.push(`${spec.field} dropdown missing`); continue; }
      const actual = elementValue(found.control);
      if (!lookupTextMatches(actual, spec)) errors.push(`${spec.field} is not selected from the CAFM dropdown`);
      const hidden = nearbyHiddenValues(found.control);
      if (hidden.length && !hiddenCommitted(found.control)) errors.push(`${spec.field} backing lookup ID is blank`);
    }
    if (clean(ppm?.lastService)) {
      const last = nearestControl(['Last Service']);
      const actual = clean(elementValue(last?.control));
      if (!last?.control) errors.push('Last Service field is missing');
      else if (norm(actual) !== norm(ppm.lastService)) errors.push(`Last Service is ${actual || 'blank'} instead of ${ppm.lastService}`);
    }
    return errors;
  }

  function findLearnedPpmNewButton() {
    const learned = state.learnedNew;
    if (!learned) return null;
    const docs = sameOriginDocuments();
    const preferred = docs.filter((doc) => {
      try { return !learned.frameUrl || doc.location.href === learned.frameUrl || new URL(doc.location.href).pathname === new URL(learned.frameUrl).pathname; }
      catch (_) { return false; }
    });
    for (const doc of [...preferred, ...docs.filter((d) => !preferred.includes(d))]) {
      const found = elementFromLearnedFingerprint(doc, learned);
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
      hits.sort((a,b) => b.score - a.score || a.rect.width - b.rect.width);
      return hits[0]?.node || null;
    } catch (_) { return null; }
  }

  // PPM register toolbar detector. Concept Evolution renders the visible
  // "+ New" action differently across builds (anchor, onclick cell, nested
  // span/image). Learned control is always preferred; then use DOM/text fallbacks.
  function findNewButton() {
    if (!isPpmListPage()) return null;
    for (const doc of sameOriginDocuments()) {
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
    const selector = 'a[title="Create New"][onclick*="Toolbar.New"]';
    const button = exactPpmNewButton() || findNewButton();
    const stateInfo = ppmToolbarButtonState(button, selector);
    addEvent('ppm-create-new-check', { guardKey, ...stateInfo });
    if (!button) throw new Error('The Create New control was not detected on the PPM register toolbar.');
    if (button.hasAttribute('disabled') || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
      throw new Error('The Create New control is currently disabled.');
    }
    button.click();
    addEvent('ppm-create-new-click', { guardKey, ...stateInfo, clickCalled: true });
    return true;
  }

  function ppmInstructionCanon(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

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

  function currentRecord() {
    return state.assets[state.session.index] || null;
  }

  function assetCodeOnPage() {
    if (!isAssetPage()) return '';
    const field = nearestControl(['Asset Code']);
    const direct = clean(field?.control ? elementValue(field.control) : '');
    if (direct) return direct;
    const candidates = [...document.querySelectorAll('h1,h2,h3,a,span,div')]
      .filter((el) => visible(el) && !isAssistantElement(el))
      .map((el) => clean(el.textContent))
      .filter((text) => text && text.length < 180);
    for (const text of candidates) {
      const match = text.match(/^([A-Z0-9]+(?:-[A-Z0-9_.\/]+){2,})\s+-\s+/i);
      if (match) return clean(match[1]);
    }
    return '';
  }

  function workflowAssetCodeOnPage() {
    const assetCode = assetCodeOnPage();
    if (assetCode && recordByAssetCode(assetCode)) return recordByAssetCode(assetCode).assetCode;

    const pool = state.allAssets.length ? state.allAssets : state.assets;
    const knownCodes = pool.map((record) => clean(record?.assetCode)).filter(Boolean);
    const sources = [
      clean(document.title || ''),
      ...[...document.querySelectorAll('h1,h2,h3,h4,a,strong,b,span,div')]
        .filter((el) => visible(el) && !isAssistantElement(el))
        .map((el) => clean(el.textContent))
        .filter((text) => text && text.length < 260),
      clean(document.body?.innerText || '')
    ].filter(Boolean);

    // First use the workbook itself as the dictionary. This safely handles
    // suffixes such as 0016A, where a shorter code (0016) is also a valid
    // asset. Longest exact visible code wins.
    for (const source of sources) {
      const lower = source.toLowerCase();
      const matches = knownCodes
        .filter((code) => lower.includes(code.toLowerCase()))
        .sort((a, b) => b.length - a.length);
      if (matches.length) return matches[0];
    }

    // Then parse obvious WCH asset-code tokens and resolve them back to the
    // workbook. This covers PPM-register headings and document titles even if
    // their surrounding DOM changes.
    for (const source of sources) {
      const tokens = source.match(/\bWCH(?:-[A-Z0-9_.\/]+){3,}\b/ig) || [];
      for (const token of tokens.sort((a, b) => b.length - a.length)) {
        const record = recordByAssetCode(token);
        if (record) return record.assetCode;
      }
    }

    // Last-resort identity mapping: on the PPM register the URL id is the
    // saved Asset entity id. If that id was recorded when the asset was saved,
    // use it to re-bind the workbook row even when the heading DOM is unusual.
    const entityId = entityIdFromUrl();
    if (entityId) {
      for (const record of pool) {
        const savedId = clean(state.session.statuses?.[record.assetCode]?.cafmEntityId || '');
        if (savedId && savedId === clean(entityId)) return record.assetCode;
      }
      const autoCode = clean(state.session.auto?.assetCode || '');
      const autoId = clean(state.session.auto?.assetEntityId || '');
      if (autoCode && autoId && autoId === clean(entityId) && recordByAssetCode(autoCode)) return recordByAssetCode(autoCode).assetCode;
    }

    return '';
  }

  function recordByAssetCode(assetCode) {
    const code = clean(assetCode);
    if (!code) return null;
    const pool = state.allAssets.length ? state.allAssets : state.assets;
    return pool.find((record) => norm(record?.assetCode) === norm(code)) || null;
  }

  function ppmRecordOnCurrentPage() {
    if (!isPpmListPage()) return null;
    const byVisibleCode = recordByAssetCode(workflowAssetCodeOnPage());
    if (byVisibleCode) return byVisibleCode;

    const entityId = clean(entityIdFromUrl());
    const pool = state.allAssets.length ? state.allAssets : state.assets;
    if (entityId) {
      const bySavedId = pool.find((record) => clean(state.session.statuses?.[record.assetCode]?.cafmEntityId || '') === entityId);
      if (bySavedId) return bySavedId;
      const auto = state.session.auto || {};
      if (clean(auto.assetEntityId) === entityId) {
        const byAuto = recordByAssetCode(auto.assetCode);
        if (byAuto) return byAuto;
      }
    }

    // Safe final fallback for a manually opened PPM page: only reuse the
    // current workbook row if its exact Asset Code is visibly present in the
    // PPM page title/body. This avoids silently applying PPMs to another asset.
    const current = currentRecord();
    const currentCode = clean(current?.assetCode || '');
    const pageText = `${clean(document.title || '')} ${clean(document.body?.innerText || '')}`.toLowerCase();
    if (currentCode && pageText.includes(currentCode.toLowerCase())) return current;
    return null;
  }

  function workflowRecord(auto = state.session.auto) {
    const byCode = recordByAssetCode(auto?.assetCode);
    return byCode || currentRecord();
  }

  async function startPpmForCurrentPage() {
    if (!isPpmListPage()) throw new Error('Open the saved asset PPM register before starting PPM entry.');
    if (!state.ppms.length) throw new Error('Load a workbook containing enabled CAFM PPM Import rows first.');

    // Manual PPM start is deliberately independent from any earlier Asset
    // activation failure.  Starting here replaces the failed/stopped workflow
    // with a clean PPM-only session for the asset currently shown on screen.
    const record = ppmRecordOnCurrentPage();
    if (!record) throw new Error('The PPM register could not be matched safely to an Asset Code in the loaded workbook.');
    const assetCode = record.assetCode;
    const linked = linkedPpms(record);
    if (!linked.length) throw new Error(`No enabled PPM rows are linked to ${assetCode} in CAFM PPM Import.`);
    const assetEntityId = entityIdFromUrl();
    if (!assetEntityId || assetEntityId === '-1') throw new Error('The saved Asset ID could not be read from this PPM register URL.');

    const newIndex = state.assets.findIndex((item) => norm(item.assetCode) === norm(assetCode));
    if (newIndex >= 0) state.session.index = newIndex;
    state.session.auto = {
      active: true,
      mode: 'ppm-current-page',
      phase: 'ppm_wait_new',
      index: newIndex >= 0 ? newIndex : state.session.index,
      assetCode: record.assetCode,
      assetEntityId,
      ppmIndex: 0,
      ppmResults: [],
      ppmOpenStartedAt: Date.now(),
      ppmNewClickedForIndex: -1,
      startedAt: Date.now(),
      error: ''
    };

    // One attempt only. The user's START PPM click is a real user gesture, so
    // this is the best opportunity to open Evolution's separate New PPM window.
    // Never retry the legacy control automatically: retries are what caused
    // multiple New Entity windows. If detection/click fails, switch to a safe
    // manual hand-off and automatically resume when the user clicks + New once.
    const persistPromise = persistSession();
    render();
    let openedAttempt = false;
    try {
      const key = `ppm-new:${record.assetCode}:0`;
      openedAttempt = clickPpmNewToolbar(key);
      state.session.auto.ppmNewClickedForIndex = 0;
      state.session.auto.ppmOpenStartedAt = Date.now();
      showToast(`Starting ${linked.length} PPM row(s). + New was clicked once; waiting for the New PPM window.`, 'success', 9000);
    } catch (_) {
      state.session.auto.phase = 'ppm_wait_user_new';
      state.session.auto.ppmOpenStartedAt = Date.now();
      showToast('CAFM + New could not be clicked safely. Click the real + New button ONCE; the extension will resume automatically in the New PPM window.', 'warn', 16000);
    }
    await persistPromise;
    await persistSession();
    scheduleAuto(openedAttempt ? 1800 : 900);
  }

  function recordForCurrentSavedAsset() {
    if (!isSavedAssetPage()) throw new Error('Open a saved Asset record before using Edit Existing Asset.');
    const code = assetCodeOnPage();
    if (!code) throw new Error('The saved Asset Code could not be read from this page.');
    const editPool = state.allAssets.length ? state.allAssets : state.assets;
    const matches = editPool
      .map((record, index) => ({ record, index }))
      .filter((item) => norm(item.record?.assetCode) === norm(code));
    if (!matches.length) throw new Error(`${code} was not found in the loaded CAFM Import sheet. Keep the asset row in the workbook and load that workbook before editing.`);
    if (matches.length > 1) throw new Error(`${code} appears more than once in the loaded CAFM Import sheet. Remove the duplicate workbook row before editing.`);
    return { ...matches[0], assetCode: code };
  }

  function validateRecord(record) {
    if (globalThis.CAFMAssetRules?.validateRecord) return globalThis.CAFMAssetRules.validateRecord(record);
    const issues = [];
    // v5.3 blank-field policy: empty workbook cells are intentionally skipped.
    // Asset Code remains the row identity required by the workbook reader.
    if (!clean(record?.assetCode)) issues.push('Asset Code is blank');
    return issues;
  }

  function directMappings(record) {
    return {
      Details: [
        { label: ['Asset Code'], value: record.assetCode, required: true },
        { label: ['Group'], value: record.group },
        { label: ['Site Reference', 'Site'], value: record.siteReference },
        { label: ['External Ref', 'External Reference'], value: record.externalRef },
        { label: ['Description'], value: record.description },
        { label: ['Product Code'], value: record.productCode },
        { label: ['Manufacturer'], value: record.manufacturer },
        { label: ['Barcode'], value: record.barcode },
        { label: ['Qty', 'Quantity'], value: record.quantity },
        { label: ['Serial No.', 'Serial No', 'Serial Number'], value: record.serialNumber },
        { label: ['Model', 'Model Type'], value: record.model },
        { label: ['Drawing #', 'Drawing Reference Number'], value: record.drawingReference },
        { label: ['Object Ref', 'Object Reference'], value: record.objectRef }
      ],
      'Financial/Risk': [
        { label: ['Warranty Expires', 'Warranty Expiry Date'], value: record.warrantyExpiry },
        { label: ['Replacement Cost'], value: record.replacementCost },
        { label: ['Purchase Date'], value: record.purchaseDate },
        { label: ['Purchase Cost'], value: record.purchaseCost },
        { label: ['Disposal Value'], value: record.disposalValue },
        { label: ['Lifespan'], value: record.lifespan },
        { label: ['Reducing Balance Depreciation %', 'Reducing Balance Depreciation'], value: record.reducingBalanceDepreciation },
        { label: ['Operational'], value: record.operationalRisk },
        { label: ['Health/Safety', 'Health & Safety'], value: record.healthSafetyRisk },
        { label: ['Environmental'], value: record.environmentalRisk },
        { label: ['Survey Date', 'Asset Tested Date'], value: record.surveyDate },
        { label: ['Lease Obligation'], value: record.leaseObligation },
        { label: ['Actual Risk'], value: record.actualRisk }
      ],
      Spatial: [
        { label: ['GIS Reference'], value: record.spatial?.gisReference },
        { label: ['Latitude'], value: record.spatial?.latitude },
        { label: ['Longitude'], value: record.spatial?.longitude },
        { label: ['Elevation'], value: record.spatial?.elevation },
        { label: ['External System'], value: record.spatial?.externalSystem },
        { label: ['External Object'], value: record.spatial?.externalObject },
        { label: ['External Identifier'], value: record.spatial?.externalIdentifier }
      ]
    };
  }

  function valueEquivalent(actual, expected) {
    const a = clean(actual);
    const e = clean(expected);
    if (!e) return true;
    if (norm(a) === norm(e)) return true;
    const an = Number(a.replace(/,/g, ''));
    const en = Number(e.replace(/,/g, ''));
    if (Number.isFinite(an) && Number.isFinite(en) && Math.abs(an - en) < 0.000001) return true;
    return false;
  }

  async function fillDirectFields(record, options = {}) {
    const results = [];
    const mappings = directMappings(record);
    for (const [tab, fields] of Object.entries(mappings)) {
      const nonBlank = fields.some((field) => clean(field.value));
      if (!nonBlank) continue;
      if (!(await clickTab(tab))) throw new Error(`${tab} tab could not be opened.`);
      for (const field of fields) {
        if (!clean(field.value)) continue;
        if (options.skipAssetCode && field.label.some((label) => norm(label) === 'asset code')) continue;
        const result = fillByLabel(field.label, field.value);
        results.push({ tab, ...result, expected: String(field.value), required: Boolean(field.required) });
        if (['missing', 'readonly', 'failed'].includes(result.status)) {
          throw new Error(`${field.label[0]} could not be filled on the ${tab} tab.`);
        }
        const actual = elementValue(result.control);
        if (!valueEquivalent(actual, field.value)) {
          throw new Error(`${field.label[0]} was entered but did not remain in the CAFM field.`);
        }
      }
    }

    if (clean(record.comments)) {
      if (!(await clickTab('Notes'))) throw new Error('Notes tab could not be opened.');
      let textarea = nearestControl(['Notes'])?.control;
      if (!(textarea instanceof HTMLTextAreaElement)) {
        textarea = [...document.querySelectorAll('textarea')].find((el) => visible(el) && !isAssistantElement(el));
      }
      if (!textarea) throw new Error('Notes text area was not detected.');
      if (!setNativeValue(textarea, String(record.comments).slice(0, 2000))) throw new Error('Notes could not be filled.');
      results.push({ tab: 'Notes', status: 'filled', label: 'Notes', expected: String(record.comments).slice(0, 2000), control: textarea });
    }
    return results;
  }

  async function fillDropdowns(record) {
    const evidence = [];
    const specs = lookupMapping(record);
    const sequence = ['Building', 'Floor', 'Location', 'System', 'Tag', 'Type', 'Name', 'Classification', 'Parent Asset', 'Supplier', 'Cost Centre', 'Condition'];
    for (const field of sequence) {
      const spec = specs.find((item) => item.field === field);
      if (!spec) continue;
      const result = await selectLookup(spec);
      evidence.push(result);
      state.session.currentLookupEvidence = evidence;
      await persistSession();
      if (field === 'Building') await wait(0);
      else if (field === 'Location') await wait(0);
      else if (field === 'System') await wait(0);
      else if (field === 'Tag') await wait(0);
      else if (field === 'Type' || field === 'Name') await wait(0);
      else await wait(0);
    }
    return evidence;
  }

  // Keep the Asset page on one tab until every field belonging to that tab
  // has been completed. This prevents the importer from bouncing between
  // Details and Financial/Risk while a single asset is being populated.
  async function fillAssetFieldsByTab(record, options = {}) {
    const directResults = [];
    const lookupEvidence = [];
    const mappings = directMappings(record);
    const specs = lookupMapping(record);
    const lookupSequence = ['Building', 'Floor', 'Location', 'System', 'Tag', 'Type', 'Name', 'Classification', 'Parent Asset', 'Supplier', 'Cost Centre', 'Condition'];
    const tabOrder = ['Details', 'Financial/Risk', 'Spatial'];

    for (const tab of tabOrder) {
      const fields = mappings[tab] || [];
      const tabSpecs = lookupSequence
        .map((field) => specs.find((item) => item.field === field && item.tab === tab))
        .filter(Boolean);
      const hasDirect = fields.some((field) => clean(field.value) && !(options.skipAssetCode && field.label.some((label) => norm(label) === 'asset code')));
      const hasLookups = tabSpecs.length > 0;
      if (!hasDirect && !hasLookups) continue;

      if (!(await clickTab(tab))) throw new Error(`${tab} tab could not be opened.`);

      for (const field of fields) {
        if (!clean(field.value)) continue;
        if (options.skipAssetCode && field.label.some((label) => norm(label) === 'asset code')) continue;
        const result = fillByLabel(field.label, field.value);
        directResults.push({ tab, ...result, expected: String(field.value), required: Boolean(field.required) });
        if (['missing', 'readonly', 'failed'].includes(result.status)) {
          await recordValidationWarning(record, { scope: 'asset', tab, field: field.label[0], expected: field.value, actual: '', reason: `Fill result: ${result.status}` });
          continue;
        }
        const actual = elementValue(result.control);
        if (!valueEquivalent(actual, field.value)) {
          await recordValidationWarning(record, { scope: 'asset', tab, field: field.label[0], expected: field.value, actual, reason: 'Value did not remain in CAFM field' });
        }
        else {
          addEvent('asset-field-filled', { tab, field: field.label[0], expected: clean(field.value), actual: clean(actual), status: result.status || 'filled' });
        }
      }

      for (const spec of tabSpecs) {
        try {
          const result = await selectLookup(spec);
          lookupEvidence.push(result);
          state.session.currentLookupEvidence = lookupEvidence;
          addEvent('asset-lookup-selected', { tab, field: spec.field, expected: clean(spec.value || spec.display || ''), selected: clean(result.selected || result.selectedText || ''), commitVerified: Boolean(result.commitVerified || result.alreadySelected || result.nativeSelect || result.hiddenCommitted) });
          await persistSession();
        } catch (error) {
          await recordValidationWarning(record, { scope: 'asset', tab, field: spec.field, expected: spec.value || spec.display || '', actual: '', reason: error.message || String(error) });
        }
        await wait(0);
      }
    }

    if (clean(record.comments)) {
      if (!(await clickTab('Notes'))) throw new Error('Notes tab could not be opened.');
      let textarea = nearestControl(['Notes'])?.control;
      if (!(textarea instanceof HTMLTextAreaElement)) {
        textarea = [...document.querySelectorAll('textarea')].find((el) => visible(el) && !isAssistantElement(el));
      }
      if (!textarea) {
        await recordValidationWarning(record, { scope: 'asset', tab: 'Notes', field: 'Notes', expected: String(record.comments).slice(0, 2000), actual: '', reason: 'Notes text area was not detected' });
      } else if (!setNativeValue(textarea, String(record.comments).slice(0, 2000))) {
        await recordValidationWarning(record, { scope: 'asset', tab: 'Notes', field: 'Notes', expected: String(record.comments).slice(0, 2000), actual: elementValue(textarea), reason: 'Notes could not be filled' });
      } else {
        directResults.push({ tab: 'Notes', status: 'filled', label: 'Notes', expected: String(record.comments).slice(0, 2000), control: textarea });
      }
    }

    return { direct: directResults, lookups: lookupEvidence };
  }

  async function verifyBeforeSave(record) {
    const problems = [];

    // Do not change Asset tabs during the pre-save audit. Direct fields are
    // already checked immediately after they are filled, and every lookup is
    // already verified by selectLookup(). Re-use that recorded evidence here
    // instead of reopening Details / Financial-Risk / Spatial just to inspect
    // the same values again.
    for (const spec of lookupMapping(record)) {
      const evidence = (state.session.currentLookupEvidence || []).find((item) => item.field === spec.field);
      if (!evidence) {
        problems.push(`${spec.field} selection evidence is missing`);
        continue;
      }
      const selectedText = clean(evidence.selected || evidence.selectedText || '');
      if (selectedText && !lookupTextMatches(selectedText, spec)) {
        problems.push(`${spec.field} does not match the workbook value`);
      }
      if (!evidence.commitVerified && !evidence.alreadySelected && !evidence.nativeSelect && !evidence.hiddenCommitted) {
        problems.push(`${spec.field} selection could not be proven as committed`);
      }
    }

    // If Details is already the visible tab, keep the lightweight direct-field
    // checks. Never switch tabs just for this audit.
    if (tabContextReady('Details')) {
      for (const field of [
        { labels: ['Asset Code'], value: record.assetCode, label: 'Asset Code' },
        { labels: ['Description'], value: record.description, label: 'Description' },
        { labels: ['Qty', 'Quantity'], value: record.quantity, label: 'Qty' }
      ]) {
        if (!clean(field.value)) continue;
        const found = nearestControl(field.labels);
        if (!found) problems.push(`${field.label} control missing`);
        else if (!valueEquivalent(elementValue(found.control), field.value)) problems.push(`${field.label} does not match workbook`);
      }
    }

    if (problems.length) {
      for (const problem of problems) {
        await recordValidationWarning(record, { scope: 'asset', field: 'Pre-save audit', expected: 'Excel-backed value committed', actual: '', reason: problem });
      }
      addEvent('asset-pre-save-warning-summary', { warningCount: problems.length, warnings: problems });
    }
    return problems;
  }

  async function fillCurrentRecord() {
    const record = currentRecord();
    if (!record) throw new Error('No current asset row is loaded.');
    const issues = validateRecord(record);
    if (issues.length) throw new Error(`Workbook row ${record.workbookRow}: ${issues.join('; ')}`);
    if (!isNewEntityPage()) throw new Error('Open the Asset New Entity page before filling a record.');

    state.session.currentLookupEvidence = [];
    await persistSession();
    showToast(`Filling ${record.assetCode}...`, 'info', 5000);
    const filled = await fillAssetFieldsByTab(record);
    const direct = filled.direct;
    const lookups = filled.lookups;
    // Allow all Concept Evolution dependent callbacks to finish, then audit
    // the freshly re-rendered controls rather than stale DOM references.
    await wait(0);
    await verifyBeforeSave(record);
    // Arm post-save continuation even when the user clicks CAFM Save manually.
    // The continuation is only accepted on a saved Asset page whose visible
    // Asset Code matches this row, so normal navigation cannot activate a
    // different asset by accident.
    state.session.manualAwaitSave = {
      index: state.session.index,
      assetCode: record.assetCode,
      armedAt: Date.now(),
      source: 'filled-manual-save',
      lookupEvidence: state.session.currentLookupEvidence || []
    };
    await persistSession();
    showToast(`${record.assetCode} is fully filled. Save it normally; after CAFM confirms the save, the importer will change the asset to ACTIVE and add any enabled linked PPM rows.`, 'success', 9000);
    return { direct, lookups };
  }

  async function fillExistingSavedAsset() {
    if (!state.assets.length) throw new Error('Load the CAFM import workbook first.');
    const matched = recordForCurrentSavedAsset();
    const record = matched.record;
    const issues = validateRecord(record);
    if (issues.length) throw new Error(`Workbook row ${record.workbookRow}: ${issues.join('; ')}`);

    state.session.currentLookupEvidence = [];
    await persistSession();
    showToast(`Updating saved asset ${record.assetCode} from Excel...`, 'info', 6000);

    // The saved record keeps its identity. Asset Code is matched, checked and
    // deliberately not rewritten. All other populated workbook fields are
    // refreshed; blank workbook cells remain untouched in CAFM.
    const filled = await fillAssetFieldsByTab(record, { skipAssetCode: true });
    const direct = filled.direct;
    const lookups = filled.lookups;
    await wait(0);
    await verifyBeforeSave(record);

    // Existing-asset editing must never enter the create/activate/PPM workflow.
    state.session.manualAwaitSave = null;
    await persistSession();
    showToast(`${record.assetCode} has been updated from workbook row ${record.workbookRow}. Review the fields, then click the normal CAFM Save button. This edits the existing asset only; status and existing PPMs are not changed.`, 'success', 12000);
    return { record, workbookIndex: matched.index, direct, lookups };
  }

  async function saveExistingAssetChanges() {
    if (!state.assets.length) throw new Error('Load the CAFM import workbook first.');
    const { record } = recordForCurrentSavedAsset();
    await wait(0);
    await verifyBeforeSave(record);
    const save = findSaveButton();
    if (!save) throw new Error('CAFM Save button was not detected.');

    // Explicitly suppress post-save asset activation/PPM processing.
    state.session.manualAwaitSave = null;
    await persistSession();
    showToast(`Saving changes to existing asset ${record.assetCode}...`, 'info', 5000);
    dispatchClick(save);
    await wait(0);
    const error = validationMessage();
    if (error) throw new Error(error);
    showToast(`${record.assetCode}: existing-asset Save sent. No new asset, status change or PPM creation was triggered.`, 'success', 9000);
    return true;
  }

  function findSaveButton() {
    const candidates = [...document.querySelectorAll('button,a,[role="button"],span,div')]
      .filter((element) => {
        if (!visible(element) || isAssistantElement(element)) return false;
        const text = norm(element.textContent);
        const clue = norm(`${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`);
        return (text === 'save' || clue === 'save' || /\bsave\b/.test(clue)) && clean(element.textContent).length < 35;
      })
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    const raw = candidates[0];
    return raw?.closest('button,a,[role="button"]') || raw || null;
  }

  function validationMessage() {
    const visibleText = [...document.querySelectorAll('div,span,td,p,h1,h2,h3')]
      .filter((element) => visible(element) && !isAssistantElement(element))
      .map((element) => clean(element.textContent))
      .filter((text) => text && text.length < 1200);
    const titleIndex = visibleText.findIndex((text) => /^validation message$/i.test(text));
    if (titleIndex >= 0) {
      const nearby = visibleText.slice(titleIndex, titleIndex + 8).filter((text) => !/^validation message$/i.test(text) && !/^ok$/i.test(text));
      return nearby[0] || 'CAFM returned a validation message.';
    }
    const required = visibleText.find((text) => /is a required field/i.test(text));
    if (required) return required;
    return '';
  }

  async function clickSaveTracked(mode) {
    const record = currentRecord();
    if (!record) throw new Error('No current record.');
    await wait(0);
    await verifyBeforeSave(record);
    await wait(0);
    const save = findSaveButton();
    if (!save) throw new Error('CAFM Save button was not detected.');

    if (mode === 'auto') {
      state.session.auto = {
        ...(state.session.auto || {}),
        active: true,
        phase: 'await_save',
        index: state.session.index,
        assetCode: record.assetCode,
        saveStartedAt: Date.now()
      };
    } else {
      state.session.manualAwaitSave = {
        index: state.session.index,
        assetCode: record.assetCode,
        armedAt: Date.now(),
        saveStartedAt: Date.now(),
        source: 'extension-save',
        lookupEvidence: state.session.currentLookupEvidence || []
      };
    }
    await persistSession();
    showToast(`Saving ${record.assetCode}...`, 'info', 5000);
    dispatchClick(save);

    try {
      const result = await waitForDom(() => {
        const error = validationMessage();
        if (error) return { error };
        if (isSavedAssetPage()) return { saved: true };
        return null;
      }, state.settings.saveTimeoutMs, `saved Asset ID for ${record.assetCode}`);
      if (result?.error) {
        const error = result.error;
        if (mode === 'auto') state.session.auto = { ...(state.session.auto || {}), active: false, phase: 'error', error };
        else state.session.manualAwaitSave = null;
        await setStatus(record, 'failed', error);
        await persistSession();
        throw new Error(error);
      }
      if (result?.saved) return true;
    } catch (error) {
      if (/Timed out waiting/.test(clean(error?.message))) {
        throw new Error('Save was clicked, but CAFM did not confirm a saved asset before the safety timeout. The importer did not mark the row as saved.');
      }
      throw error;
    }
    return false;
  }

  async function setStatus(record, status, note = '', extra = {}) {
    if (!record) return;
    const previous = state.session.statuses[record.assetCode] || {};
    state.session.statuses[record.assetCode] = {
      ...previous,
      ...extra,
      status,
      note: clean(note),
      workbookRow: record.workbookRow,
      updatedAt: new Date().toISOString()
    };
    await persistSession();
    render();
  }

  function statusOf(record) {
    return state.session.statuses?.[record?.assetCode]?.status || 'pending';
  }

  function nextPendingIndex(start = state.session.index + 1) {
    if (!state.assets.length) return -1;
    for (let i = Math.max(0, start); i < state.assets.length; i += 1) {
      if (!['saved', 'skipped'].includes(statusOf(state.assets[i]))) return i;
    }
    for (let i = 0; i < Math.min(start, state.assets.length); i += 1) {
      if (!['saved', 'skipped'].includes(statusOf(state.assets[i]))) return i;
    }
    return -1;
  }

  async function persistSession() {
    const phase = clean(state.session.auto?.phase || '');
    if (phase && phase !== state.lastLoggedPhase) {
      state.lastLoggedPhase = phase;
      addEvent('phase', {
        phase,
        index: Number(state.session.auto?.index ?? state.session.index) || 0,
        ppmIndex: state.session.auto?.ppmIndex ?? null,
        ppmKey: currentPpm(workflowRecord(state.session.auto) || currentRecord())?.ppmKey || ''
      });
    }
    await storageSet({ [STORAGE.session]: state.session, [STORAGE.settings]: state.settings });
  }

  async function restoreState() {
    const stored = await storageGet([STORAGE.session, STORAGE.settings, STORAGE.learnedStatus, STORAGE.learnedNew]);
    if (stored[STORAGE.settings]) {
      const previousSettings = stored[STORAGE.settings];
      state.settings = { ...DEFAULT_SETTINGS, ...previousSettings };
    }
    state.learnedStatus = stored[STORAGE.learnedStatus] || null;
    state.learnedNew = stored[STORAGE.learnedNew] || null;
    if (stored[STORAGE.session]) state.session = { ...state.session, ...stored[STORAGE.session] };
    const cache = await loadLargeWorkbook();
    if (cache?.allAssets?.length || cache?.assets?.length || cache?.ppms?.length) {
      state.cache = cache;
      state.assets = cache.assets || [];
      state.allAssets = cache.allAssets || cache.assets || [];
      state.ppms = cache.ppms || [];
      if (state.assets.length) state.session.index = Math.max(0, Math.min(Number(state.session.index) || 0, state.assets.length - 1));
    }
    if (isNewEntityPage()) {
      state.session.newEntityUrl = state.session.newEntityUrl || deriveNewEntityUrl();
      await persistSession();
    }
  }

  async function loadWorkbookFile(file) {
    if (!globalThis.CAFMXlsx?.readWorkbook) throw new Error('Workbook reader is unavailable. Reload the extension.');
    const parsed = await globalThis.CAFMXlsx.readWorkbook(file);
    if (!parsed.allAssets?.length && !parsed.ppms?.length) throw new Error('No CAFM asset or PPM rows were found in this workbook.');
    const cache = {
      assets: parsed.assets || [],
      allAssets: parsed.allAssets || parsed.assets || [],
      ppms: parsed.ppms || [],
      ppmCount: Number(parsed.ppmCount || (parsed.ppms || []).length || 0),
      ppmExcludedRows: Number(parsed.ppmExcludedRows || 0),
      fileName: parsed.fileName,
      fileSize: parsed.fileSize,
      fileModified: parsed.fileModified,
      headerRow: parsed.headerRow,
      excludedRows: parsed.excludedRows,
      locationCount: parsed.locationCount,
      schema: parsed.schema,
      loadedAt: new Date().toISOString()
    };
    await saveLargeWorkbook(cache);
    state.cache = cache;
    state.assets = cache.assets || [];
    state.allAssets = cache.allAssets || cache.assets || [];
    state.ppms = cache.ppms || [];
    state.session = {
      fileName: cache.fileName,
      fileSize: cache.fileSize,
      fileModified: cache.fileModified,
      index: 0,
      statuses: {},
      newEntityUrl: isNewEntityPage() ? deriveNewEntityUrl() : (state.session.newEntityUrl || deriveNewEntityUrl()),
      auto: null,
      manualAwaitSave: null,
      currentLookupEvidence: []
    };
    await persistSession();
    render();
    showToast(`${state.assets.length} NEW-import asset row(s), ${state.allAssets.length} total asset row(s) available for editing, and ${state.ppms.length} enabled PPM row(s) loaded from ${cache.fileName}.`, 'success', 9000);
  }

  function counts() {
    let saved = 0;
    let skipped = 0;
    let failed = 0;
    let invalid = 0;
    for (const record of state.assets) {
      const status = statusOf(record);
      if (status === 'saved') saved += 1;
      else if (status === 'skipped') skipped += 1;
      else if (status === 'failed') failed += 1;
      if (validateRecord(record).length) invalid += 1;
    }
    return { total: state.assets.length, saved, skipped, failed, invalid, remaining: Math.max(0, state.assets.length - saved - skipped) };
  }

  async function move(delta) {
    if (!state.assets.length) return;
    state.session.index = Math.max(0, Math.min(state.assets.length - 1, state.session.index + delta));
    state.session.currentLookupEvidence = [];
    await persistSession();
    render();
  }

  async function skipCurrent() {
    const record = currentRecord();
    if (!record) return;
    await setStatus(record, 'skipped', 'Skipped by user');
    const next = nextPendingIndex(state.session.index + 1);
    if (next >= 0) state.session.index = next;
    await persistSession();
    render();
  }

  async function markSavedAndNext(note = 'Confirmed saved') {
    const record = currentRecord();
    if (!record) return;
    await setStatus(record, 'saved', note);
    const next = nextPendingIndex(state.session.index + 1);
    if (next >= 0) state.session.index = next;
    await persistSession();
    render();
  }

  async function clearSession() {
    if (!confirm('Clear the loaded workbook and importer progress? This does not delete anything from CAFM.')) return;
    await clearLargeWorkbook();
    await storageRemove([STORAGE.session, STORAGE.pendingLookup]);
    state.assets = [];
    state.allAssets = [];
    state.ppms = [];
    state.cache = null;
    state.session = { fileName: '', fileSize: 0, fileModified: 0, index: 0, statuses: {}, newEntityUrl: deriveNewEntityUrl(), auto: null, manualAwaitSave: null, currentLookupEvidence: [] };
    render();
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadLog() {
    const rows = [['Asset Code', 'Workbook Row', 'Status', 'Note', 'Updated At', 'CAFM Entity ID', 'Asset Active', 'Activated At', 'Status Evidence', 'Linked PPM Count', 'PPM Results', 'Validation Warning Count', 'Validation Warnings']];
    for (const record of state.assets) {
      const info = state.session.statuses?.[record.assetCode] || {};
      const linkedCount = linkedPpms(record).length;
      const ppmResults = (info.ppmResults || []).map((item) => `${item.status || ''}:${item.ppmKey || ''}:${item.instruction || ''}`).join(' | ');
      const warnings = (info.validationWarnings || []).map((item) => `${item.scope || ''}:${item.tab || ''}:${item.field || ''}: expected=${item.expected || ''}: actual=${item.actual || ''}: ${item.reason || ''}`).join(' | ');
      rows.push([
        record.assetCode, record.workbookRow, info.status || 'pending', info.note || '', info.updatedAt || '',
        info.cafmEntityId || '', info.assetActivated ? 'YES' : 'NO', info.assetActivatedAt || '', info.assetStatusEvidence || '',
        linkedCount, ppmResults, (info.validationWarnings || []).length, warnings
      ]);
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Engineering_Efficiency_CAFM_Asset_Import_Log_v${VERSION}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadDiagnostic() {
    const auto = state.session.auto || null;
    const record = workflowRecord(auto) || currentRecord();
    const payload = {
      generatedAt: new Date().toISOString(),
      extensionVersion: VERSION,
      page: { url: location.href, title: document.title, readyState: document.readyState },
      workbook: state.cache ? {
        fileName: state.session.fileName,
        fileSize: state.session.fileSize,
        fileModified: state.session.fileModified,
        assetsLoaded: state.assets.length,
        ppmRowsLoaded: state.ppms.length
      } : null,
      current: {
        assetCode: record?.assetCode || '',
        workbookRow: record?.workbookRow || '',
        assetIndex: state.session.index,
        phase: auto?.phase || '',
        ppmIndex: auto?.ppmIndex ?? null,
        ppmKey: currentPpm(record)?.ppmKey || '',
        currentAssetStatus: currentAssetStatusText(),
        currentPpmStatus: currentPpmStatusText()
      },
      iteration: {
        enabled: Boolean(state.settings.iterationEnabled),
        configuredCount: Math.max(1, Number(state.settings.iterationCount) || 1),
        runMax: Number(auto?.maxIterations || 1),
        processedThisRun: Number(auto?.processedThisRun || 0)
      },
      settings: { ...state.settings },
      auto,
      status: record ? state.session.statuses?.[record.assetCode] || null : null,
      recentEvents: (state.session.events || []).slice(-2000),
      validationMessage: validationMessage() || '',
      learnedControls: { status: state.learnedStatus || null, ppmNew: state.learnedNew || null }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `EE_CAFM_Diagnostic_v${VERSION}_${clean(record?.assetCode || 'no-asset').replace(/[^A-Za-z0-9_-]+/g, '_')}_${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function startAutomatic() {
    if (!state.assets.length) return showToast('Load the CAFM Import workbook first.', 'warn');
    if (!isNewEntityPage()) return showToast('Open the Asset New Entity page before starting automatic import.', 'warn', 8000);
    const record = currentRecord();
    if (!record) return;
    state.session.newEntityUrl = state.session.newEntityUrl || deriveNewEntityUrl();
    const maxIterations = state.settings.iterationEnabled
      ? Math.max(1, Math.floor(Number(state.settings.iterationCount) || 1))
      : 1;
    state.session.auto = {
      active: true, mode: 'automatic', phase: 'fill', index: state.session.index,
      assetCode: record.assetCode, startedAt: Date.now(), ppmIndex: 0, ppmResults: [],
      processedThisRun: 0, maxIterations
    };
    addEvent('run-start', { maxIterations, iterationEnabled: Boolean(state.settings.iterationEnabled) });
    await persistSession();
    render();
    scheduleAuto(100);
  }

  async function pauseAutomatic() {
    if (!state.session.auto) state.session.auto = {};
    state.session.auto.active = false;
    state.session.auto.phase = 'paused';
    await persistSession();
    render();
    showToast('Automatic import paused.', 'info');
  }

  function scheduleAuto(_delay = 0) {
    // Normal transitions run immediately. Waiting phases use only a lightweight
    // watchdog recheck; DOM mutations trigger scheduleAuto() immediately, so
    // network/UI completion is never gated by a fixed sleep.
    clearTimeout(state.autoTimer);
    const phase = clean(state.session.auto?.phase || '');
    const waitingPhases = new Set([
      'await_save', 'activate_wait', 'activate_wait_user',
      'ppm_wait_new', 'ppm_wait_user_new', 'ppm_await_save',
      'ppm_status_wait', 'ppm_status_wait_user'
    ]);
    const watchdogMs = waitingPhases.has(phase) ? 750 : 0;
    state.autoTimer = setTimeout(() => runAutomatic().catch((error) => stopAutomaticWithError(error)), watchdogMs);
  }

  async function stopAutomaticWithError(error) {
    const message = clean(error?.message || error || 'Automatic import stopped.');
    addEvent('error', { message, stack: clean(error?.stack || '') });
    if (state.session.auto) {
      state.session.auto.active = false;
      state.session.auto.phase = 'error';
      state.session.auto.error = message;
    }
    const record = workflowRecord(state.session.auto);
    if (record && state.session.auto?.mode !== 'ppm-current-page' && !['saved', 'skipped'].includes(statusOf(record))) {
      await setStatus(record, 'failed', message, {
        cafmEntityId: state.session.auto?.assetEntityId || state.session.statuses?.[record.assetCode]?.cafmEntityId || '',
        assetActivated: Boolean(state.session.statuses?.[record.assetCode]?.assetActivated),
        assetStatusEvidence: state.session.statuses?.[record.assetCode]?.assetStatusEvidence || '',
        ppmResults: state.session.auto?.ppmResults || state.session.statuses?.[record.assetCode]?.ppmResults || []
      });
    }
    await persistSession();
    render();
    showToast(message, 'error', 12000);
  }

  async function beginPostSave(record, entityId, mode = 'automatic', note = 'CAFM asset save confirmed') {
    if (!record || !entityId || entityId === '-1') throw new Error('The saved CAFM asset ID could not be detected.');
    const observed = observedAssetCode();
    if (observed && norm(observed) !== norm(record.assetCode)) {
      throw new Error(`Saved asset page shows ${observed}, but ${record.assetCode} was expected.`);
    }
    const linked = linkedPpms(record);
    addEvent('asset-saved', { assetCode: record.assetCode, entityId, linkedPpmCount: linked.length });
    await setStatus(record, 'asset_saved', `${note}; activation pending${linked.length ? `; ${linked.length} linked PPM(s) pending` : ''}`, {
      cafmEntityId: entityId,
      assetActivated: false,
      assetActivatedAt: '',
      assetStatusEvidence: currentAssetStatusText(),
      ppmResults: []
    });
    state.session.auto = {
      ...(state.session.auto || {}),
      active: true,
      mode,
      phase: 'activate_open',
      index: state.session.index,
      assetCode: record.assetCode,
      assetEntityId: entityId,
      activationStartedAt: 0,
      activationConfirmStartedAt: 0,
      ppmIndex: 0,
      ppmResults: [],
      error: ''
    };
    state.session.manualAwaitSave = null;
    await persistSession();
    render();
    showToast(`${record.assetCode} saved. Changing Asset Status to Active${linked.length ? `, then adding ${linked.length} PPM(s)` : ''}.`, 'success', 8000);
    scheduleAuto(250);
  }

  async function finishPostSave(record, ppmResults = []) {
    const auto = state.session.auto || {};
    const entityId = auto.assetEntityId || state.session.statuses?.[record.assetCode]?.cafmEntityId || '';
    const activeEvidence = currentAssetStatusText() || state.session.statuses?.[record.assetCode]?.assetStatusEvidence || 'Status: ACTIVE - Active';
    const savedPpms = ppmResults.filter((item) => item.status === 'saved').length;
    const existingPpms = ppmResults.filter((item) => item.status === 'existing').length;
    const activePpms = ppmResults.filter((item) => item.active).length;
    const ppmNote = ppmResults.length ? `; PPMs: ${savedPpms} created${existingPpms ? `, ${existingPpms} already existed` : ''}${activePpms ? `, ${activePpms} ACTIVE` : ''}` : '; no enabled linked PPM rows';

    if (auto.mode === 'ppm-current-page') {
      const previous = state.session.statuses?.[record.assetCode] || {};
      state.session.statuses = state.session.statuses || {};
      state.session.statuses[record.assetCode] = {
        ...previous,
        ppmResults,
        ppmOnlyCompletedAt: new Date().toISOString(),
        note: `PPM-only current asset workflow complete${ppmNote}`,
        updatedAt: new Date().toISOString()
      };
      state.session.auto = {
        active: false,
        mode: 'ppm-current-page',
        phase: 'complete',
        completedAt: Date.now(),
        assetCode: record.assetCode,
        assetEntityId: entityId,
        ppmResults
      };
      await persistSession();
      render();
      showToast(`${record.assetCode}: PPM workflow complete${ppmNote}.`, 'success', 10000);
      return;
    }

    await setStatus(record, 'saved', `Asset saved and ACTIVE${ppmNote}`, {
      cafmEntityId: entityId,
      assetActivated: true,
      assetActivatedAt: state.session.statuses?.[record.assetCode]?.assetActivatedAt || new Date().toISOString(),
      assetStatusEvidence: activeEvidence,
      ppmResults
    });

    const completedIterations = Number(auto.processedThisRun || 0) + 1;
    addEvent('asset-cycle-complete', {
      assetCode: record.assetCode,
      completedIterations,
      maxIterations: Number(auto.maxIterations || 1),
      ppmCount: ppmResults.length,
      activePpmCount: activePpms
    });

    const next = nextPendingIndex(state.session.index + 1);
    if (auto.mode === 'manual-post-save') {
      state.session.auto = { active: false, mode: auto.mode, phase: 'complete', completedAt: Date.now(), assetEntityId: entityId };
      if (next >= 0) state.session.index = next;
      state.session.currentLookupEvidence = [];
      await persistSession();
      render();
      if (next >= 0 && state.session.newEntityUrl) {
        showToast(`${record.assetCode} is ACTIVE and PPM setup is complete. Opening the next asset.`, 'success', 8000);
        await wait(0);
        location.href = state.session.newEntityUrl;
      } else {
        showToast(`${record.assetCode} is ACTIVE and PPM setup is complete.`, 'success', 8000);
      }
      return;
    }

    if (completedIterations >= Math.max(1, Number(auto.maxIterations || 1))) {
      state.session.auto = {
        ...auto,
        active: false,
        phase: 'complete',
        completedAt: Date.now(),
        processedThisRun: completedIterations,
        maxIterations: Math.max(1, Number(auto.maxIterations || 1)),
        ppmResults
      };
      state.session.currentLookupEvidence = [];
      await persistSession();
      render();
      showToast(`Iteration limit reached: ${completedIterations} asset cycle(s) completed.`, 'success', 10000);
      return;
    }

    if (next < 0) {
      state.session.auto = { active: false, mode: auto.mode || 'automatic', phase: 'complete', completedAt: Date.now() };
      await persistSession();
      render();
      showToast('Automatic Asset + Activation + PPM import completed.', 'success', 10000);
      return;
    }

    state.session.index = next;
    state.session.currentLookupEvidence = [];
    state.session.auto = {
      active: true,
      mode: auto.mode || 'automatic',
      phase: 'navigate',
      index: next,
      assetCode: state.assets[next].assetCode,
      startedAt: auto.startedAt || Date.now(),
      processedThisRun: completedIterations,
      maxIterations: Math.max(1, Number(auto.maxIterations || 1)),
      ppmIndex: 0,
      ppmResults: []
    };
    await persistSession();
    render();
    const warningCount = (state.session.statuses?.[record.assetCode]?.validationWarnings || []).length;
    showToast(`${record.assetCode} complete: Asset saved, ${savedPpms} PPM saved, ${activePpms} ACTIVE${warningCount ? `, ${warningCount} warning(s)` : ''}. Moving to next asset.`, warningCount ? 'warn' : 'success', 14000);
    addEvent('asset-cycle-snackbar', { assetCode: record.assetCode, savedPpms, activePpms, warningCount, nextAssetCode: state.assets[next]?.assetCode || '' });
    await wait(1500);
    location.href = state.session.newEntityUrl || deriveNewEntityUrl();
  }

  async function afterActivation(record) {
    const auto = state.session.auto || {};
    const entityId = auto.assetEntityId || entityIdFromUrl();
    const statusText = currentAssetStatusText() || 'Status: ACTIVE - Active';
    await setStatus(record, 'asset_saved', 'Asset saved and status changed to ACTIVE; PPM processing pending', {
      cafmEntityId: entityId,
      assetActivated: true,
      assetActivatedAt: new Date().toISOString(),
      assetStatusEvidence: statusText,
      ppmResults: auto.ppmResults || []
    });
    const linked = linkedPpms(record);
    if (!linked.length) {
      await finishPostSave(record, auto.ppmResults || []);
      return;
    }
    state.session.auto = {
      ...auto,
      active: true,
      phase: 'ppm_open_list',
      assetEntityId: entityId,
      ppmIndex: 0,
      ppmResults: auto.ppmResults || []
    };
    await persistSession();
    render();
    showToast(`${record.assetCode} is ACTIVE. Opening PPM from the asset's left-hand PPM menu for ${linked.length} linked PPM(s).`, 'success', 7000);
    await wait(0);
    const ppmNav = findAssetPpmNavLink();
    if (ppmNav) {
      dispatchClick(ppmNav, false);
      // If the legacy navigation does not respond, runAutomatic will fall
      // back to the known PPM-list URL on the next tick.
      scheduleAuto(1100);
      return;
    }
    location.href = ppmListUrl(entityId);
  }

  async function processActivationPage(record) {
    const auto = state.session.auto || {};
    const entityId = auto.assetEntityId || entityIdFromUrl();
    if (!entityId || entityId === '-1') throw new Error(`Saved asset ID is unavailable while activating ${record.assetCode}.`);
    if (!isSavedAssetPage() || entityIdFromUrl() !== String(entityId)) {
      location.href = assetEntityUrl(entityId);
      return;
    }
    if (assetIsActive()) {
      await afterActivation(record);
      return;
    }

    if (auto.phase === 'activate_open') {
      // SIMPLE EXACT STATUS CLICK.
      // This intentionally mirrors the DevTools code confirmed to work on the
      // saved Evolution Asset page. Do not use geometry, learned selectors,
      // SVG fallbacks or synthetic MouseEvents here.
      const popup = document.getElementById('ctl00_ctl00_assetStatusPopup_container');
      if (popup && visible(popup)) {
        addEvent('asset-status-popup-open', {
          popupId: popup.id,
          clickAttempts: Number(auto.activationClickAttempts || 0),
          elapsedMs: Date.now() - Number(auto.activationButtonStartedAt || Date.now())
        });
        state.session.auto = {
          ...auto,
          phase: 'activate_select',
          activationStartedAt: auto.activationStartedAt || Date.now(),
          activationPopupDetectedAt: Date.now()
        };
        await persistSession();
        scheduleAuto(50);
        return;
      }

      const b = document.querySelector('a[title="Change Asset Status"][onclick*="Toolbar.AssetStatus"]');
      const started = Number(auto.activationButtonStartedAt || Date.now());
      const attempts = Number(auto.activationClickAttempts || 0);
      const disabledAttr = b?.getAttribute?.('disabled');
      const ready = Boolean(b) && disabledAttr === null;

      const debug = {
        found: Boolean(b),
        disabled: !ready,
        disabledAttr: disabledAttr ?? null,
        title: clean(b?.getAttribute?.('title') || ''),
        onclick: clean(b?.getAttribute?.('onclick') || ''),
        clickAttempts: attempts,
        popupPresent: Boolean(popup),
        elapsedMs: Date.now() - started
      };

      if (!auto.activationButtonStartedAt) {
        addEvent('asset-status-wait-start', debug);
        state.session.auto = { ...auto, activationButtonStartedAt: started, activationStatusDebug: debug };
        await persistSession();
      } else if (JSON.stringify(auto.activationStatusDebug || {}) !== JSON.stringify(debug)) {
        addEvent('asset-status-button-state', debug);
        state.session.auto = { ...auto, activationStatusDebug: debug };
        await persistSession();
      }

      if (Date.now() - started > state.settings.lookupTimeoutMs) {
        throw new Error(`Change Asset Status popup did not open for ${record.assetCode}; attempts=${attempts}; buttonFound=${Boolean(b)}; disabledAttr=${disabledAttr ?? 'none'}.`);
      }

      // The button exists on the saved page before Evolution has enabled it.
      // While disabled, simply recheck. As soon as disabled is removed, use the
      // same native .click() that was confirmed manually in DevTools.
      if (!ready) {
        scheduleAuto(300);
        return;
      }

      const lastClickAt = Number(auto.activationLastClickAt || 0);
      if (!lastClickAt || Date.now() - lastClickAt >= 500) {
        const now = Date.now();
        const nextAttempts = attempts + 1;
        let clickReturned = false;
        let clickError = '';
        try {
          b.click();
          clickReturned = true;
        } catch (error) {
          clickError = String(error?.message || error || 'click failed');
        }

        const popupAfterClick = document.getElementById('ctl00_ctl00_assetStatusPopup_container');
        addEvent('asset-status-click', {
          attempt: nextAttempts,
          clickReturned,
          clickError,
          disabledAttr: b.getAttribute('disabled'),
          onclick: clean(b.getAttribute('onclick') || ''),
          popupPresentImmediatelyAfterClick: Boolean(popupAfterClick && visible(popupAfterClick))
        });

        state.session.auto = {
          ...state.session.auto,
          phase: 'activate_open',
          activationStartedAt: auto.activationStartedAt || now,
          activationButtonStartedAt: started,
          activationLastClickAt: now,
          activationClickAttempts: nextAttempts,
          activationStatusDebug: debug
        };
        await persistSession();
      }

      scheduleAuto(200);
      return;
    }

    if (auto.phase === 'activate_wait_user') {
      if (assetIsActive()) { await afterActivation(record); return; }
      const dialog = findChangeAssetStatusDialog();
      if (dialog) {
        state.session.auto = { ...auto, phase: 'activate_select', activationStartedAt: Date.now(), activationButtonStartedAt: 0 };
        await persistSession();
        scheduleAuto(80);
        return;
      }
      scheduleAuto(700);
      return;
    }

    if (auto.phase === 'activate_select') {
      const dialog = document.getElementById('ctl00_ctl00_assetStatusPopup_container') || findChangeAssetStatusDialog();
      if (!dialog || !visible(dialog)) {
        // Popup disappeared or was not yet committed to the DOM. Return to the
        // simple open loop instead of waiting in a phase that assumes it opened.
        addEvent('asset-status-popup-missing-after-detect', {
          clickAttempts: Number(auto.activationClickAttempts || 0)
        });
        state.session.auto = { ...auto, phase: 'activate_open' };
        await persistSession();
        scheduleAuto(100);
        return;
      }
      const exactStatusInput = dialog.querySelector('#ctl00_ctl00_assetStatusPopup_assetStatusPopupautoCompleteAssetStatus_comboBox_Input');
      const found = exactStatusInput ? { control: exactStatusInput } : (nearestControl(['Asset Status', 'Status'], dialog) || nearestControl(['Asset Status']));
      if (!found?.control) throw new Error('Asset Status field was not detected in the Change Asset Status window.');

      // Clear any previous status (for example Redundant) before filtering and
      // selecting the exact Active option from the live Evolution dropdown.
      if (found.control instanceof HTMLInputElement || found.control instanceof HTMLTextAreaElement) {
        await typeIntoInlineLookup(found.control, '');
      }
      await selectActiveFromStatusDropdown(found.control, dialog, 'Asset Status');
      state.session.auto = { ...state.session.auto, phase: 'activate_confirm', activationTypedAt: Date.now() };
      await persistSession();
      scheduleAuto(250);
      return;
    }

    if (auto.phase === 'activate_confirm') {
      const dialog = findChangeAssetStatusDialog();
      if (!dialog) {
        if (assetIsActive()) { await afterActivation(record); return; }
        throw new Error('Change Asset Status window closed before OK was pressed.');
      }
      const ok = findConfirmButton(dialog);
      if (!ok) throw new Error('OK button was not detected in the Change Asset Status window.');
      state.session.auto = { ...auto, phase: 'activate_wait', activationConfirmStartedAt: Date.now() };
      await persistSession();
      dispatchClick(ok, false);
      scheduleAuto(850);
      return;
    }

    if (auto.phase === 'activate_wait') {
      if (assetIsActive()) {
        await afterActivation(record);
        return;
      }
      const validation = validationMessage();
      if (validation) throw new Error(`CAFM did not activate ${record.assetCode}: ${validation}`);
      const elapsed = Date.now() - Number(auto.activationConfirmStartedAt || Date.now());
      const dialog = findChangeAssetStatusDialog();
      // This Evolution build does not display a reliable "Status: Active"
      // label on the General page. In the successful recording, acceptance is
      // represented by the Change Asset Status dialog closing after OK.
      if (!dialog && elapsed >= 900) {
        await afterActivation(record);
        return;
      }
      if (elapsed > state.settings.saveTimeoutMs) {
        throw new Error(`CAFM did not accept ACTIVE status for ${record.assetCode}.`);
      }
      scheduleAuto(650);
      return;
    }

    state.session.auto = { ...auto, phase: 'activate_open' };
    await persistSession();
    scheduleAuto(100);
  }

  function ppmActivationTarget(auto = state.session.auto || {}) {
    const results = auto.ppmResults || [];
    return results.find((item) => item.activateAfterSave === true && clean(item.ppmEntityId) && !item.active) || null;
  }

  async function beginPpmActivationQueue(record, results) {
    const targets = (results || []).filter((item) => item.activateAfterSave === true && clean(item.ppmEntityId) && !item.active);
    if (!targets.length) {
      await finishPostSave(record, results || []);
      return;
    }
    state.session.auto = {
      ...(state.session.auto || {}),
      phase: 'ppm_status_open',
      ppmActivationIndex: 0,
      ppmResults: results,
      ppmStatusStartedAt: Date.now()
    };
    await persistSession();
    render();
    location.href = ppmEntityUrl(targets[0].ppmEntityId);
  }

  async function completePpmActivation(record, evidence = '') {
    const auto = state.session.auto || {};
    const target = ppmActivationTarget(auto);
    if (!target) {
      await finishPostSave(record, auto.ppmResults || []);
      return;
    }
    const results = (auto.ppmResults || []).map((item) => {
      if (item.ppmKey !== target.ppmKey || String(item.ppmEntityId || '') !== String(target.ppmEntityId || '')) return item;
      return { ...item, active: true, activatedAt: new Date().toISOString(), statusEvidence: evidence || currentPpmStatusText() || 'ACTIVE accepted' };
    });
    const remaining = results.filter((item) => item.activateAfterSave === true && clean(item.ppmEntityId) && !item.active);
    if (!remaining.length) {
      const hasNext = auto.ppmResumeAfterActivation && Number.isFinite(Number(auto.ppmResumeIndex));
      const nextIndex = hasNext ? Number(auto.ppmResumeIndex) : null;
      const afterRefreshPhase = hasNext ? 'ppm_next' : 'ppm_cycle_complete_parent';
      state.session.auto = {
        ...auto,
        phase: 'ppm_child_closing',
        ppmIndex: hasNext ? nextIndex : Number(auto.ppmIndex || 0),
        ppmResults: results,
        ppmResumeAfterActivation: false,
        ppmResumeIndex: null,
        ppmNewClickedForIndex: -1,
        ppmListReadyStartedAt: 0,
        ppmAfterRefreshPhase: afterRefreshPhase,
        ppmParentRefreshStartedAt: 0
      };
      await persistSession();
      addEvent('ppm-child-complete', { ppmKey: target.ppmKey, ppmEntityId: target.ppmEntityId, hasNext, nextPpmIndex: nextIndex, afterRefreshPhase });
      // After this PPM completes, ask the background worker to close every PPM editor
      // tab that belongs to the registered parent PPM register. The parent tab itself
      // is protected, then focused so the existing Create New loop can continue there.
      const nextPhase = hasNext ? 'ppm_next' : 'ppm_cycle_complete_parent';
      addEvent('ppm-current-editor-close-request', {
        assetCode: record.assetCode,
        ppmKey: target.ppmKey,
        nextPhase,
        currentUrl: location.href,
        strategy: 'close-all-parent-ppm-editors'
      });
      await persistSession();
      chrome.runtime.sendMessage({
        type: 'PPM_CLOSE_CURRENT_EDITOR_TAB',
        assetCode: record.assetCode,
        assetEntityId: String(auto.assetEntityId || ''),
        nextPhase
      }).catch((error) => {
        addEvent('ppm-current-editor-close-send-error', { message: String(error?.message || error), currentUrl: location.href });
        persistSession().catch(() => {});
      });
      return;
    }
    state.session.auto = {
      ...auto,
      phase: 'ppm_status_open',
      ppmActivationIndex: 0,
      ppmResults: results,
      ppmStatusStartedAt: Date.now(),
      ppmStatusButtonStartedAt: 0
    };
    await persistSession();
    render();
    location.href = ppmEntityUrl(remaining[0].ppmEntityId);
  }

  async function processPpmStatusPage(record) {
    const auto = state.session.auto || {};
    const target = ppmActivationTarget(auto);
    if (!target) {
      await finishPostSave(record, auto.ppmResults || []);
      return;
    }
    const entityId = clean(target.ppmEntityId);
    if (!entityId) throw new Error(`PPM entity ID is unavailable while activating ${target.instruction}.`);
    if (!isSavedPpmPage() || entityIdFromUrl() !== String(entityId)) {
      location.href = ppmEntityUrl(entityId);
      return;
    }
    if (ppmIsActive()) {
      await completePpmActivation(record, currentPpmStatusText());
      return;
    }

    if (auto.phase === 'ppm_status_open') {
      const button = findChangePpmStatusButton();
      if (!button) {
        const started = Number(auto.ppmStatusButtonStartedAt || Date.now());
        if (!auto.ppmStatusButtonStartedAt) {
          state.session.auto = { ...auto, ppmStatusButtonStartedAt: started };
          await persistSession();
        }
        if (Date.now() - started > state.settings.lookupTimeoutMs) {
          state.session.auto = { ...state.session.auto, phase: 'ppm_status_wait_user', ppmStatusManualStartedAt: Date.now() };
          await persistSession();
          render();
          showToast(`Click the traffic-light status icon ONCE for ${target.instruction}. Active + OK will be completed automatically.`, 'warn', 16000);
          scheduleAuto(700);
          return;
        }
        scheduleAuto(450);
        return;
      }
      state.session.auto = { ...auto, phase: 'ppm_status_select', ppmStatusStartedAt: Date.now(), ppmStatusButtonStartedAt: 0 };
      await persistSession();
      dispatchLegacySingleClick(button, `ppm-status:${target.ppmEntityId || target.ppmKey}`, 15000);
      scheduleAuto(650);
      return;
    }

    if (auto.phase === 'ppm_status_wait_user') {
      if (ppmIsActive()) { await completePpmActivation(record, currentPpmStatusText()); return; }
      const dialog = findChangePpmStatusDialog();
      if (dialog) {
        state.session.auto = { ...auto, phase: 'ppm_status_select', ppmStatusStartedAt: Date.now(), ppmStatusButtonStartedAt: 0 };
        await persistSession();
        scheduleAuto(80);
        return;
      }
      scheduleAuto(700);
      return;
    }

    if (auto.phase === 'ppm_status_select') {
      const dialog = findChangePpmStatusDialog();
      if (!dialog) {
        if (Date.now() - Number(auto.ppmStatusStartedAt || Date.now()) > state.settings.lookupTimeoutMs) throw new Error(`Change PPM Status window did not open for ${target.instruction}.`);
        scheduleAuto(500);
        return;
      }
      const found = nearestControl(['PPM Status', 'Status'], dialog) || nearestControl(['Status'], dialog);
      if (!found?.control) throw new Error('PPM Status field was not detected in the Change Status window.');
      // v6.6: use the same type-to-filter dropdown selection method for PPM
      // status. Selecting the visible Active row is required before OK.
      await selectActiveFromStatusDropdown(found.control, dialog, 'PPM Status');
      state.session.auto = { ...state.session.auto, phase: 'ppm_status_confirm' };
      await persistSession();
      scheduleAuto(250);
      return;
    }

    if (auto.phase === 'ppm_status_confirm') {
      const dialog = findChangePpmStatusDialog();
      if (!dialog) {
        if (ppmIsActive()) { await completePpmActivation(record, currentPpmStatusText()); return; }
        throw new Error('Change PPM Status window closed before OK was pressed.');
      }
      const ok = findConfirmButton(dialog);
      if (!ok) throw new Error('OK button was not detected in the Change PPM Status window.');
      state.session.auto = { ...auto, phase: 'ppm_status_wait', ppmStatusConfirmStartedAt: Date.now() };
      await persistSession();
      dispatchClick(ok, false);
      scheduleAuto(850);
      return;
    }

    if (auto.phase === 'ppm_status_wait') {
      if (ppmIsActive()) {
        await completePpmActivation(record, currentPpmStatusText());
        return;
      }
      const validation = validationMessage();
      if (validation) throw new Error(`CAFM did not activate PPM ${target.instruction}: ${validation}`);
      const elapsed = Date.now() - Number(auto.ppmStatusConfirmStartedAt || Date.now());
      const dialog = findChangePpmStatusDialog();
      if (!dialog && elapsed >= 900) {
        await completePpmActivation(record, 'ACTIVE accepted; status dialog closed');
        return;
      }
      if (elapsed > state.settings.saveTimeoutMs) throw new Error(`CAFM did not accept ACTIVE status for PPM ${target.instruction}.`);
      scheduleAuto(650);
      return;
    }

    state.session.auto = { ...auto, phase: 'ppm_status_open' };
    await persistSession();
    scheduleAuto(100);
  }

  async function recordPpmResult(record, ppm, status, note, ppmEntityId = '') {
    const auto = state.session.auto || {};
    addEvent('ppm-save-result', { ppmKey: ppm.ppmKey, instruction: ppm.instruction, status, ppmEntityId });
    const results = [...(auto.ppmResults || []), {
      ppmKey: ppm.ppmKey,
      instruction: ppm.instruction,
      status,
      note,
      ppmEntityId,
      // Every newly-created PPM is activated immediately before moving to the next PPM.
      activateAfterSave: status === 'saved',
      active: false,
      savedAt: new Date().toISOString()
    }];
    const linked = linkedPpms(record);
    const nextIndex = (Number(auto.ppmIndex) || 0) + 1;

    if (status === 'saved' && clean(ppmEntityId)) {
      state.session.auto = {
        ...auto,
        ppmResults: results,
        ppmResumeAfterActivation: nextIndex < linked.length,
        ppmResumeIndex: nextIndex < linked.length ? nextIndex : null
      };
      await persistSession();
      await beginPpmActivationQueue(record, results);
      return;
    }

    if (nextIndex >= linked.length) {
      state.session.auto = { ...auto, ppmResults: results, ppmResumeAfterActivation: false, ppmResumeIndex: null };
      await persistSession();
      await finishPostSave(record, results);
      return;
    }

    state.session.auto = {
      ...auto,
      phase: 'ppm_next',
      ppmIndex: nextIndex,
      ppmResults: results,
      ppmNewClickedForIndex: -1,
      ppmListReadyStartedAt: 0
    };
    await persistSession();
    render();
    location.href = ppmListUrl(auto.assetEntityId);
  }

  async function processPpmListPage(record) {
    let auto = state.session.auto || {};

    // v8.0.12: only the PPM register whose URL ends with # is the controller/parent.
    // A register without the trailing # is treated as a disposable secondary window.
    if (!isHashPpmParentPage()) {
      addEvent('ppm-register-passive-no-hash', { url: location.href, assetCode: record?.assetCode || '' });
      await persistSession();
      return;
    }

    if (auto.phase === 'ppm_parent_refresh') {
      const selector = 'a[title="Refresh the page"][onclick*="Toolbar.Refresh"]';
      const button = exactPpmRefreshButton();
      const info = ppmToolbarButtonState(button, selector);
      addEvent('ppm-parent-refresh-check', {
        ...info,
        targetPhase: auto.ppmAfterRefreshPhase || '',
        parentUrl: location.href,
        isPpmParentRegister: isPpmListPage()
      });
      await persistSession();
      if (!button || button.hasAttribute('disabled') || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        const started = Number(auto.ppmParentRefreshStartedAt || Date.now());
        if (!auto.ppmParentRefreshStartedAt) { state.session.auto = { ...auto, ppmParentRefreshStartedAt: started }; await persistSession(); }
        if (Date.now() - started > state.settings.lookupTimeoutMs) throw new Error('Parent PPM Refresh button did not become available before timeout.');
        scheduleAuto(300);
        return;
      }
      const clickedAt = Date.now();
      state.session.auto = {
        ...auto,
        phase: 'ppm_parent_refresh_wait',
        ppmParentRefreshPageInstance: PAGE_INSTANCE,
        ppmParentRefreshClickedAt: clickedAt,
        ppmParentRefreshSawDisabled: false
      };
      await persistSession();
      addEvent('ppm-parent-refresh-click', { ...info, clickCalled: true, parentUrl: location.href });
      await persistSession();
      button.click();
      scheduleAuto(250);
      return;
    }

    if (auto.phase === 'ppm_parent_refresh_wait') {
      const refreshButton = exactPpmRefreshButton();
      const disabledNow = Boolean(refreshButton) && (refreshButton.hasAttribute('disabled') || String(refreshButton.getAttribute('aria-disabled') || '').toLowerCase() === 'true');
      const elapsed = Date.now() - Number(auto.ppmParentRefreshClickedAt || Date.now());
      const pageReloaded = auto.ppmParentRefreshPageInstance !== PAGE_INSTANCE;
      const sawDisabled = Boolean(auto.ppmParentRefreshSawDisabled || disabledNow);
      if (sawDisabled !== Boolean(auto.ppmParentRefreshSawDisabled)) {
        state.session.auto = { ...auto, ppmParentRefreshSawDisabled: sawDisabled };
        await persistSession();
        auto = state.session.auto || {};
      }
      const toolbarReadyAgain = Boolean(refreshButton) && !disabledNow && document.readyState === 'complete' && elapsed >= 500;
      if (!pageReloaded && !toolbarReadyAgain) {
        if (elapsed > state.settings.lookupTimeoutMs) throw new Error('Parent PPM page refresh did not complete before timeout.');
        scheduleAuto(250);
        return;
      }
      const nextPhase = auto.ppmAfterRefreshPhase || 'ppm_next';
      addEvent('ppm-parent-refresh-complete', {
        nextPhase,
        pageReloaded,
        toolbarReadyAgain,
        sawDisabled,
        elapsedMs: elapsed,
        parentUrl: location.href
      });
      state.session.auto = { ...auto, phase: nextPhase, ppmParentRefreshStartedAt: 0, ppmParentRefreshClickedAt: 0, ppmParentRefreshPageInstance: '', ppmParentRefreshSawDisabled: false, ppmAfterRefreshPhase: '' };
      await persistSession();
      auto = state.session.auto || {};
      if (nextPhase === 'ppm_cycle_complete_parent') {
        await finishPostSave(record, auto.ppmResults || []);
        return;
      }
    }

    const ppm = currentPpm(record);
    if (!ppm) {
      await finishPostSave(record, auto.ppmResults || []);
      return;
    }
    if (auto.phase === 'ppm_await_save') {
      if (ppmListContainsCurrent(ppm)) {
        await recordPpmResult(record, ppm, 'saved', 'PPM detected in asset PPM register after Save', ppmListEntityId(ppm));
        return;
      }
      if (Date.now() - Number(auto.ppmSaveStartedAt || Date.now()) > state.settings.saveTimeoutMs) {
        throw new Error(`PPM Save could not be verified for ${ppm.ppmKey}.`);
      }
      scheduleAuto(0);
      return;
    }

    if (['ppm_open_list', 'ppm_next'].includes(auto.phase) && ppmListContainsCurrent(ppm)) {
      await recordPpmResult(record, ppm, 'existing', 'Equivalent PPM already exists; duplicate creation skipped', ppmListEntityId(ppm));
      return;
    }

    if (auto.phase === 'ppm_wait_new') {
      const child = await runtimeMessage({ type: 'PPM_CHILD_STATE', assetCode: record.assetCode });
      addEvent('ppm-child-check', { found: Boolean(child?.found), childTabId: child?.tabId ?? null, childUrl: child?.url || '', childStatus: child?.status || '' });
      await persistSession();
      if (child?.found) {
        scheduleAuto(150);
        return;
      }

      const elapsed = Date.now() - Number(auto.ppmOpenStartedAt || Date.now());
      if (elapsed > state.settings.lookupTimeoutMs) {
        throw new Error(`Create New was clicked/retried, but the PPM child window did not open for ${ppm.ppmKey}.`);
      }

      const button = exactPpmNewButton() || findNewButton();
      const info = ppmToolbarButtonState(button, 'a[title="Create New"][onclick*="Toolbar.New"]');
      const attempts = Number(auto.ppmNewClickAttempts || 0);
      const lastClick = Number(auto.ppmNewLastClickAt || 0);
      addEvent('ppm-create-new-retry-check', { ...info, attempt: attempts + 1, elapsedMs: elapsed });
      await persistSession();
      if (!button || button.hasAttribute('disabled') || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        scheduleAuto(500);
        return;
      }
      if (!lastClick || Date.now() - lastClick >= 700) {
        button.click();
        const now = Date.now();
        state.session.auto = { ...auto, ppmNewClickAttempts: attempts + 1, ppmNewLastClickAt: now };
        await persistSession();
        addEvent('ppm-create-new-retry-click', { ...info, attempt: attempts + 1, clickCalled: true });
        await persistSession();
      }
      scheduleAuto(200);
      return;
    }

    if (auto.phase === 'ppm_wait_user_new') {
      // Deliberately do not click + New again. A manual click opens the legacy
      // popup reliably and prevents duplicate windows. The popup content script
      // sees this same session and continues with ppm_fill automatically.
      scheduleAuto(900);
      return;
    }

    const ppmIndex = Number(auto.ppmIndex || 0);
    const alreadyClicked = Number(auto.ppmNewClickedForIndex ?? -1) === ppmIndex;
    if (alreadyClicked) {
      state.session.auto = { ...auto, phase: 'ppm_wait_new', ppmOpenStartedAt: Number(auto.ppmOpenStartedAt || Date.now()) };
      await persistSession();
      scheduleAuto(200);
      return;
    }

    const newButton = findNewButton();
    if (!newButton) {
      const started = Number(auto.ppmListReadyStartedAt || Date.now());
      if (!auto.ppmListReadyStartedAt) {
        state.session.auto = { ...auto, ppmListReadyStartedAt: started };
        await persistSession();
      }
      if (Date.now() - started > state.settings.lookupTimeoutMs) {
        state.session.auto = { ...state.session.auto, phase: 'ppm_wait_user_new', ppmOpenStartedAt: Date.now() };
        await persistSession();
        render();
        showToast('Click the real CAFM + New button ONCE to add the next PPM. Automatic filling will continue in the new window.', 'warn', 16000);
        scheduleAuto(900);
        return;
      }
      scheduleAuto(450);
      return;
    }
    await runtimeMessage({ type: 'REGISTER_PPM_PARENT', assetCode: record.assetCode });
    const info = ppmToolbarButtonState(newButton, 'a[title="Create New"][onclick*="Toolbar.New"]');
    addEvent('ppm-create-new-ready', { ...info, ppmIndex, ppmKey: ppm.ppmKey });
    await persistSession();
    if (newButton.hasAttribute('disabled') || String(newButton.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
      state.session.auto = { ...auto, phase: 'ppm_wait_new', ppmOpenStartedAt: Date.now(), ppmListReadyStartedAt: 0, ppmNewClickedForIndex: ppmIndex, ppmNewClickAttempts: 0, ppmNewLastClickAt: 0 };
      await persistSession();
      scheduleAuto(400);
      return;
    }
    state.session.auto = {
      ...auto,
      phase: 'ppm_wait_new',
      ppmOpenStartedAt: Date.now(),
      ppmListReadyStartedAt: 0,
      ppmNewClickedForIndex: ppmIndex,
      ppmNewClickAttempts: 1,
      ppmNewLastClickAt: Date.now()
    };
    await persistSession();
    newButton.click();
    addEvent('ppm-create-new-click', { ...info, ppmIndex, ppmKey: ppm.ppmKey, attempt: 1, clickCalled: true });
    await persistSession();
    scheduleAuto(200);
  }

  async function processPpmItemPage(record) {
    const auto = state.session.auto || {};
    if (['ppm_parent_refresh', 'ppm_parent_refresh_wait', 'ppm_cycle_complete_parent'].includes(auto.phase)) {
      return;
    }
    const ppm = currentPpm(record);
    if (!ppm) throw new Error(`No linked PPM row is available for ${record.assetCode}.`);

    const ppmEntityId = entityIdFromUrl();
    if (ppmEntityId && ppmEntityId !== '-1') {
      if (auto.phase === 'ppm_await_save') {
        await recordPpmResult(record, ppm, 'saved', 'CAFM PPM entity page detected after Save', ppmEntityId);
      } else {
        state.session.auto = { ...auto, phase: 'ppm_open_list' };
        await persistSession();
        location.href = ppmListUrl(auto.assetEntityId);
      }
      return;
    }

    if (!isPpmNewEntityPage()) throw new Error(`Expected a New PPM page for ${record.assetCode}.`);
    const issues = ppmSourceIssues(ppm);
    if (issues.length) throw new Error(`PPM ${ppm.ppmKey} cannot be imported: ${issues.join('; ')}`);

    if (['ppm_wait_new', 'ppm_wait_user_new', 'ppm_open_list', 'ppm_next'].includes(auto.phase)) {
      state.session.auto = { ...auto, phase: 'ppm_fill' };
      await persistSession();
      scheduleAuto(100);
      return;
    }

    if (auto.phase === 'ppm_fill') {
      showToast(`Creating PPM for ${record.assetCode}: ${ppm.instruction}`, 'info', 7000);
      // Data-driven workflow: resolve lookup controls first (Contract then
      // Instruction, followed by any other populated lookup columns). This lets
      // Evolution apply Instruction defaults before Last Service/direct fields
      // from the workbook are entered.
      await fillPpmLookups(ppm);
      await fillPpmFields(ppm);
      const errors = await validatePpmPageBeforeSave(ppm);
      if (errors.length) {
        for (const problem of errors) await recordValidationWarning(record, { scope: 'ppm', field: 'Pre-save audit', expected: 'Excel-backed value committed', actual: '', reason: problem, ppmKey: ppm.ppmKey });
        addEvent('ppm-pre-save-warning-summary', { ppmKey: ppm.ppmKey, warningCount: errors.length, warnings: errors });
      }
      const save = findSaveButton();
      if (!save) throw new Error(`CAFM PPM Save button was not detected for ${ppm.ppmKey}.`);
      state.session.auto = { ...state.session.auto, phase: 'ppm_await_save', ppmSaveStartedAt: Date.now() };
      await persistSession();
      dispatchClick(save, false);
      scheduleAuto(0);
      return;
    }

    if (auto.phase === 'ppm_await_save') {
      const validation = validationMessage();
      if (validation) throw new Error(`CAFM did not save PPM ${ppm.ppmKey}: ${validation}`);
      if (Date.now() - Number(auto.ppmSaveStartedAt || Date.now()) > state.settings.saveTimeoutMs) throw new Error(`PPM save confirmation timed out for ${ppm.ppmKey}.`);
      scheduleAuto(0);
      return;
    }

    state.session.auto = { ...auto, phase: 'ppm_fill' };
    await persistSession();
    scheduleAuto(100);
  }

  async function runAutomatic() {
    if (state.busy) return;
    const auto = state.session.auto;
    if (!auto?.active) return;
    state.busy = true;
    try {
      const index = Math.max(0, Number(auto.index ?? state.session.index) || 0);
      if (auto.mode !== 'ppm-current-page' && state.assets[index]) state.session.index = index;
      const record = workflowRecord(auto);
      if (!record) throw new Error('No asset row is available for the active workflow.');

      if (String(auto.phase || '').startsWith('activate_')) {
        if (!isSavedAssetPage()) {
          location.href = assetEntityUrl(auto.assetEntityId);
          return;
        }
        await processActivationPage(record);
        return;
      }

      if (String(auto.phase || '').startsWith('ppm_status_')) {
        const target = ppmActivationTarget(auto);
        if (!target) { await finishPostSave(record, auto.ppmResults || []); return; }
        if (!isSavedPpmPage() || entityIdFromUrl() !== String(target.ppmEntityId || '')) {
          location.href = ppmEntityUrl(target.ppmEntityId);
          return;
        }
        await processPpmStatusPage(record);
        return;
      }

      if (String(auto.phase || '').startsWith('ppm_')) {
        if (isPpmListPage()) { await processPpmListPage(record); return; }
        if (isPpmItemPage()) { await processPpmItemPage(record); return; }
        if (auto.assetEntityId) {
          location.href = ppmListUrl(auto.assetEntityId);
          return;
        }
        throw new Error(`Saved asset ID is missing before PPM creation for ${record.assetCode}.`);
      }

      if (auto.phase === 'await_save') {
        if (isSavedAssetPage()) {
          await beginPostSave(record, entityIdFromUrl(), auto.mode || 'automatic', 'CAFM asset save confirmed');
          return;
        }
        const validation = validationMessage();
        if (validation) throw new Error(validation);
        if (Date.now() - Number(auto.saveStartedAt || Date.now()) > state.settings.saveTimeoutMs) throw new Error('CAFM save confirmation timed out.');
        scheduleAuto(0);
        return;
      }

      if (auto.phase === 'navigate') {
        if (!isNewEntityPage()) {
          location.href = state.session.newEntityUrl || deriveNewEntityUrl();
          return;
        }
        state.session.auto = { ...auto, phase: 'fill', index: state.session.index, assetCode: currentRecord()?.assetCode || '' };
        await persistSession();
      }

      if (!isAssetPage() || !isNewEntityPage()) {
        location.href = state.session.newEntityUrl || deriveNewEntityUrl();
        return;
      }

      const currentStatus = statusOf(record);
      if (['saved', 'skipped'].includes(currentStatus)) {
        const next = nextPendingIndex(state.session.index + 1);
        if (next < 0) {
          state.session.auto = { active: false, mode: auto.mode || 'automatic', phase: 'complete', completedAt: Date.now() };
          await persistSession();
          render();
          showToast('Automatic Asset + Activation + PPM import completed.', 'success', 10000);
          return;
        }
        state.session.index = next;
        state.session.auto = { ...auto, phase: 'fill', index: next, assetCode: state.assets[next].assetCode };
        await persistSession();
        render();
      }

      const issues = validateRecord(currentRecord());
      if (issues.length) {
        if (state.settings.skipInvalidRows) {
          await setStatus(currentRecord(), 'skipped', `Invalid workbook row: ${issues.join('; ')}`);
          const next = nextPendingIndex(state.session.index + 1);
          if (next < 0) {
            state.session.auto = { active: false, phase: 'complete' };
            await persistSession();
            render();
            return;
          }
          state.session.index = next;
          state.session.auto = { ...state.session.auto, phase: 'navigate', index: next, assetCode: state.assets[next].assetCode };
          await persistSession();
          scheduleAuto(300);
          return;
        }
        throw new Error(`Workbook row ${currentRecord().workbookRow}: ${issues.join('; ')}`);
      }

      state.session.auto = { ...state.session.auto, active: true, mode: auto.mode || 'automatic', phase: 'filling', index: state.session.index, assetCode: currentRecord().assetCode };
      await persistSession();
      render();
      await fillCurrentRecord();
      // fillCurrentRecord arms manual continuation; automatic mode owns the flow.
      state.session.manualAwaitSave = null;
      state.session.auto = { ...state.session.auto, phase: 'saving', index: state.session.index, assetCode: currentRecord().assetCode };
      await persistSession();
      render();
      await clickSaveTracked('auto');
      if (isSavedAssetPage()) {
        await beginPostSave(currentRecord(), entityIdFromUrl(), auto.mode || 'automatic', 'CAFM asset save confirmed immediately');
      }
    } finally {
      state.busy = false;
    }
  }

  async function handlePostReloadSaveState() {
    if (!state.assets.length) return;
    const auto = state.session.auto;
    if (auto?.active) {
      scheduleAuto(150);
      return;
    }
    const manual = state.session.manualAwaitSave;
    if (!manual || !isSavedAssetPage()) return;
    const record = state.assets[Math.max(0, Number(manual.index) || 0)];
    if (!record || norm(record.assetCode) !== norm(manual.assetCode)) return;
    const age = Date.now() - Number(manual.armedAt || manual.saveStartedAt || Date.now());
    if (age > 2 * 60 * 60 * 1000) {
      state.session.manualAwaitSave = null;
      await persistSession();
      return;
    }
    const observed = observedAssetCode();
    if (observed && norm(observed) !== norm(record.assetCode)) return;
    state.session.index = Math.max(0, Number(manual.index) || 0);
    await beginPostSave(record, entityIdFromUrl(), 'manual-post-save', manual.source === 'filled-manual-save' ? 'Manual CAFM Save detected' : 'CAFM Save confirmed');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function statusClass(status) {
    return status === 'saved' ? 'ok' : status === 'failed' ? 'bad' : ['skipped', 'asset_saved'].includes(status) ? 'warn' : 'neutral';
  }

  function showToast(message, type = 'info', duration = 4500) {
    if (!state.els.toast) return;
    state.els.toast.textContent = clean(message);
    state.els.toast.className = `toast show ${type}`;
    clearTimeout(state.els.toast._timer);
    state.els.toast._timer = setTimeout(() => { state.els.toast.className = 'toast'; }, duration);
  }

  function render() {
    if (!state.shadow) return;
    const c = counts();
    const record = currentRecord();
    const status = record ? statusOf(record) : 'pending';
    const validation = record ? validateRecord(record) : [];
    const auto = state.session.auto;
    const loaded = state.assets.length > 0 || state.allAssets.length > 0;
    const savedAssetPage = isSavedAssetPage();
    const ppmRegisterPage = isPpmListPage();
    const pageAssetCode = savedAssetPage ? assetCodeOnPage() : '';
    const ppmPageMatch = ppmRegisterPage ? ppmRecordOnCurrentPage() : null;
    const ppmPageAssetCode = ppmPageMatch?.assetCode || (ppmRegisterPage ? workflowAssetCodeOnPage() : '');
    const editPool = state.allAssets.length ? state.allAssets : state.assets;
    const savedMatch = pageAssetCode ? editPool.find((item) => norm(item.assetCode) === norm(pageAssetCode)) : null;

    state.els.fileName.textContent = state.cache?.fileName ? `${state.cache.fileName} | ${state.assets.length} NEW row(s) | ${state.allAssets.length} editable asset row(s) | ${state.ppms.length} enabled PPM row(s)` : 'No workbook loaded';
    state.els.total.textContent = String(c.total);
    state.els.saved.textContent = String(c.saved);
    state.els.remaining.textContent = String(c.remaining);
    state.els.issues.textContent = String(c.failed + c.invalid);
    state.els.row.textContent = record ? `${state.session.index + 1} / ${state.assets.length} | Excel row ${record.workbookRow}` : '-';
    state.els.assetCode.textContent = record?.assetCode || '-';
    state.els.status.textContent = record ? status.toUpperCase() : '-';
    state.els.status.className = `pill ${statusClass(status)}`;
    if (savedAssetPage && loaded) {
      state.els.validation.textContent = pageAssetCode
        ? (savedMatch ? `Saved asset ${pageAssetCode} matches Excel row ${savedMatch.workbookRow}. Edit Existing Asset is available.` : `Saved asset ${pageAssetCode} is not present in the loaded import rows.`)
        : 'Saved asset page detected, but Asset Code could not be read.';
      state.els.validation.className = savedMatch ? 'validation goodtext' : 'validation badtext';
      if (savedMatch) {
        state.els.row.textContent = `Saved asset | Excel row ${savedMatch.workbookRow}`;
        state.els.assetCode.textContent = savedMatch.assetCode;
      }
    } else if (ppmRegisterPage && loaded) {
      const linkedCount = ppmPageMatch ? linkedPpms(ppmPageMatch).length : 0;
      state.els.validation.textContent = ppmPageAssetCode
        ? (ppmPageMatch ? `PPM register for ${ppmPageAssetCode}: ${linkedCount} enabled workbook PPM row(s) ready.` : `${ppmPageAssetCode} is not present in the loaded CAFM Import rows.`)
        : 'PPM register detected, but the Asset Code could not be read.';
      state.els.validation.className = ppmPageMatch && linkedCount ? 'validation goodtext' : 'validation badtext';
      if (ppmPageMatch) {
        state.els.row.textContent = `PPM register | Excel row ${ppmPageMatch.workbookRow}`;
        state.els.assetCode.textContent = ppmPageMatch.assetCode;
      }
    } else {
      state.els.validation.textContent = validation.length ? validation.join(' | ') : 'Workbook row passed local validation.';
      state.els.validation.className = validation.length ? 'validation badtext' : 'validation goodtext';
    }

    const lookupContext = savedMatch || ppmPageMatch || record;
    const lookupRows = lookupContext ? lookupMapping(lookupContext) : [];
    state.els.lookupSummary.innerHTML = lookupRows.length
      ? lookupRows.map((item) => `<div class="lookup-line"><b>${escapeHtml(item.field)}</b><span>${escapeHtml(item.value)}</span></div>`).join('')
      : '<div class="muted">No current row.</div>';

    state.els.autoState.textContent = auto?.active
      ? `Automatic import: ${String(auto.phase || 'running').replace(/_/g, ' ')} | completed ${Number(auto.processedThisRun || 0)}/${Number(auto.maxIterations || 1)} asset cycle(s)`
      : auto?.phase === 'complete'
        ? `Automatic import complete${auto?.processedThisRun != null ? ` | ${Number(auto.processedThisRun || 0)}/${Number(auto.maxIterations || auto.processedThisRun || 1)} asset cycle(s)` : ''}`
        : auto?.phase === 'error' ? `Stopped: ${auto.error || 'error'}` : 'Automatic import stopped';

    state.els.learnedStatusInfo.textContent = state.learnedStatus
      ? `Taught status button: ${state.learnedStatus.tag || 'element'}${state.learnedStatus.attrs?.id ? ` #${state.learnedStatus.attrs.id}` : ''} | ${state.learnedStatus.topFrame ? 'top page' : 'embedded frame'}`
      : 'Status button not taught yet. Click Teach, then click the traffic-light once manually.';

    const assetEntryPage = isAssetPage() && isNewEntityPage();
    for (const id of ['fill', 'saveCurrent', 'skip', 'prev', 'next', 'markSaved']) state.els[id].disabled = !loaded || !assetEntryPage;
    state.els.editExisting.disabled = !loaded || !savedAssetPage || !savedMatch;
    state.els.saveExisting.disabled = !loaded || !savedAssetPage || !savedMatch;
    state.els.downloadLog.disabled = !loaded;
    state.els.pauseAuto.disabled = !auto?.active;
    state.els.startAuto.disabled = !state.assets.length || Boolean(auto?.active) || !assetEntryPage;
    const ppmQueue = ppmPageMatch ? linkedPpms(ppmPageMatch) : [];
    const ppmReadyCount = ppmQueue.length;
    state.els.startPpmHere.hidden = !ppmRegisterPage;
    // Do not let an old failed Asset-status workflow block manual PPM entry.
    // Only disable while a live workflow is actually running.
    state.els.startPpmHere.disabled = !loaded || !ppmRegisterPage || !ppmPageMatch || !ppmReadyCount || Boolean(auto?.active);
    state.els.startPpmHere.textContent = ppmPageMatch ? `START PPM FOR THIS ASSET (${ppmReadyCount})` : 'START PPM FOR THIS ASSET';
    state.els.openPpmNew.hidden = !ppmRegisterPage;
    state.els.openPpmNew.disabled = !ppmRegisterPage;
    state.els.learnPpmNew.hidden = !ppmRegisterPage;
    state.els.learnPpmNew.disabled = !ppmRegisterPage;
    state.els.learnedNewInfo.hidden = !ppmRegisterPage;
    state.els.learnedNewInfo.textContent = state.learnedNew
      ? `Taught + New button: ${state.learnedNew.tag || 'element'}${state.learnedNew.attrs?.id ? ` #${state.learnedNew.attrs.id}` : ''} | ${state.learnedNew.topFrame ? 'top page' : 'embedded frame'}`
      : '+ New button not taught yet. Click Teach, then click the real + New control once manually.';
    if (state.els.ppmQueuePreview) {
      state.els.ppmQueuePreview.hidden = !ppmRegisterPage;
      if (!loaded) {
        state.els.ppmQueuePreview.textContent = 'Load the import workbook to start PPM entry.';
        state.els.ppmQueuePreview.className = 'validation badtext';
      } else if (!ppmPageMatch) {
        state.els.ppmQueuePreview.textContent = 'PPM page detected, but the Asset Code could not be matched to the workbook.';
        state.els.ppmQueuePreview.className = 'validation badtext';
      } else if (!ppmReadyCount) {
        state.els.ppmQueuePreview.textContent = `No enabled CAFM PPM Import rows are linked to ${ppmPageMatch.assetCode}.`;
        state.els.ppmQueuePreview.className = 'validation badtext';
      } else {
        const rows = ppmQueue.map((ppm, i) => `${i + 1}. ${clean(ppm.instruction) || clean(ppm.ppmKey) || 'PPM'}${clean(ppm.lastService) ? ` | Last Service ${clean(ppm.lastService)}` : ''}`);
        state.els.ppmQueuePreview.textContent = `${ppmReadyCount} PPM row(s) ready: ${rows.join('  |  ')}`;
        state.els.ppmQueuePreview.className = 'validation goodtext';
      }
    }
    state.els.fileInput.value = '';

    if (state.els.contextSub) {
      const page = isPpmListPage() ? 'PPM register' : isPpmNewEntityPage() ? 'New PPM' : isSavedPpmPage() ? 'Saved PPM' : isSavedAssetPage() ? 'Saved asset' : 'Asset entry';
      const phase = auto?.active ? String(auto.phase || 'running').replace(/_/g, ' ') : 'idle';
      state.els.contextSub.textContent = `Engineering Efficiency Ltd | v${VERSION} | ${page} | ${phase}`;
    }

    state.els.iterateBatch.checked = Boolean(state.settings.iterationEnabled);
    state.els.iterationCount.value = String(Math.max(1, Number(state.settings.iterationCount) || 1));
    state.els.iterationCount.disabled = !state.settings.iterationEnabled;
    state.els.includeNotes.checked = Boolean(state.settings.includeNotes);
    state.els.includeSpatial.checked = Boolean(state.settings.includeSpatial);
    state.els.skipInvalid.checked = Boolean(state.settings.skipInvalidRows);
  }

  function makeDraggable() {
    const panel = state.els.panel;
    const handle = state.els.dragHandle;
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button,input')) return;
      dragging = true;
      handle.setPointerCapture?.(event.pointerId);
      const rect = panel.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      panel.style.right = 'auto';
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - 60);
      const x = Math.max(0, Math.min(maxX, event.clientX - offsetX));
      const y = Math.max(0, Math.min(maxY, event.clientY - offsetY));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      state.settings.panelX = x;
      state.settings.panelY = y;
    });
    handle.addEventListener('pointerup', async (event) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture?.(event.pointerId);
      await persistSession();
    });
  }

  function injectPanel() {
    if (!isWorkflowPage() || document.getElementById(HOST_ID)) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.all = 'initial';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    state.host = host;
    state.shadow = shadow;
    const logo = chrome.runtime.getURL('branding/engineering_efficiency_logo.png');
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        #panel { position: fixed; top: 76px; right: 14px; width: 430px; max-width: calc(100vw - 20px); max-height: calc(100vh - 88px); z-index: 2147483646; background:#111820; color:#f4f6f8; border:1px solid #34414e; border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.35); font:13px/1.35 Arial,Helvetica,sans-serif; overflow:hidden; }
        #head { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#0b1117; border-bottom:1px solid #2c3946; cursor:move; user-select:none; }
        #head img { width:32px; height:32px; object-fit:contain; background:#fff; border-radius:5px; }
        #head .titles { flex:1; min-width:0; }
        #head h2 { margin:0; font-size:15px; color:#fff; }
        #head .sub { color:#aeb9c4; font-size:11px; margin-top:2px; }
        #head button { border:1px solid #41505e; background:#202b35; color:#fff; width:28px; height:28px; border-radius:6px; cursor:pointer; }
        #body { overflow:auto; max-height:calc(100vh - 145px); padding:10px; }
        #panel.collapsed #body { display:none; }
        #panel.ppm-workflow { width:350px; }
        #panel.ppm-workflow #workbookSection, #panel.ppm-workflow #manualSection, #panel.ppm-workflow #sessionSection { display:none; }
        #panel.ppm-workflow #currentSection #validation, #panel.ppm-workflow #currentSection #lookupSummary { display:none; }
        #panel.ppm-workflow #autoSection #startAuto, #panel.ppm-workflow #autoSection .option { display:none; }
        #panel.ppm-workflow #autoSection .buttons { grid-template-columns:1fr; }
        #panel.ppm-workflow #autoSection { margin-bottom:0; }
        #panel.ppm-workflow #body { max-height:310px; }
        .section { border:1px solid #2c3946; border-radius:8px; padding:9px; margin-bottom:9px; background:#151e27; }
        .section h3 { margin:0 0 7px; font-size:12px; color:#d9e2ea; text-transform:uppercase; letter-spacing:.35px; }
        .file { display:flex; gap:7px; align-items:center; }
        input[type=file] { width:100%; color:#c9d2da; font-size:11px; }
        .muted { color:#9ca9b5; font-size:11px; }
        .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-top:8px; }
        .kpi { background:#0f161d; border:1px solid #2d3944; border-radius:7px; padding:6px; text-align:center; }
        .kpi span { display:block; color:#8f9ca8; font-size:9px; text-transform:uppercase; }
        .kpi strong { display:block; color:#fff; font-size:16px; margin-top:2px; }
        .rowline { display:flex; gap:8px; justify-content:space-between; align-items:center; margin:4px 0; }
        .rowline b { color:#fff; }
        .asset { font-size:16px; font-weight:700; word-break:break-word; color:#fff; margin:5px 0; }
        .pill { display:inline-block; padding:3px 7px; border-radius:999px; font-size:10px; font-weight:700; }
        .pill.ok { background:#173d2a; color:#aef3c7; }
        .pill.bad { background:#4a2022; color:#ffb6ba; }
        .pill.warn { background:#4a3b17; color:#ffe19a; }
        .pill.neutral { background:#26323d; color:#d6dee5; }
        .validation { margin-top:6px; padding:6px; border-radius:6px; font-size:11px; }
        .goodtext { color:#b9efca; background:#132c20; }
        .badtext { color:#ffbec2; background:#3a1c1f; }
        .lookup-list { max-height:175px; overflow:auto; border-top:1px solid #2b3742; margin-top:7px; padding-top:4px; }
        .lookup-line { display:grid; grid-template-columns:95px 1fr; gap:7px; padding:4px 0; border-bottom:1px solid #24303a; }
        .lookup-line b { color:#cfd9e1; }
        .lookup-line span { color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .buttons { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:7px; }
        button.action { border:1px solid #40505f; background:#25313c; color:#fff; min-height:34px; border-radius:7px; cursor:pointer; padding:7px 8px; font-weight:600; }
        button.action:hover:not(:disabled) { background:#31404c; }
        button.action.primary { background:#e5e9ed; color:#111820; border-color:#fff; }
        button.action.danger { background:#54262a; border-color:#704047; }
        button.action:disabled { opacity:.38; cursor:not-allowed; }
        .wide { grid-column:1 / -1; }
        .option { display:flex; align-items:center; gap:7px; color:#cbd4dc; margin-top:6px; font-size:11px; }
        .option input[type=number] { width:80px; background:#0f161d; border:1px solid #3b4956; color:#fff; border-radius:4px; padding:4px; }
        #autoState { color:#b8c5cf; font-size:11px; margin-top:6px; }
        .toast { position:fixed; right:18px; bottom:18px; z-index:2147483647; max-width:520px; padding:11px 14px; border-radius:8px; color:#fff; background:#26333e; box-shadow:0 8px 28px rgba(0,0,0,.32); display:none; font:13px/1.35 Arial,sans-serif; }
        .toast.show { display:block; }
        .toast.success { background:#1c5134; }
        .toast.warn { background:#6a5319; }
        .toast.error { background:#702b31; }
        .footer { color:#80909c; text-align:center; font-size:10px; margin:3px 0 1px; }
      </style>
      <div id="panel">
        <div id="head">
          <img src="${logo}" alt="Engineering Efficiency Ltd">
          <div class="titles"><h2>CAFM Asset Importer</h2><div id="contextSub" class="sub">Engineering Efficiency Ltd | v${VERSION} | Asset -> ACTIVE -> data-driven linked PPMs</div></div>
          <button id="collapse" title="Collapse">-</button>
        </div>
        <div id="body">
          <div id="workbookSection" class="section">
            <h3>Workbook</h3>
            <div class="file"><input id="fileInput" type="file" accept=".xlsx"></div>
            <div id="fileName" class="muted" style="margin-top:5px"></div>
            <div class="kpis">
              <div class="kpi"><span>Total</span><strong id="total">0</strong></div>
              <div class="kpi"><span>Saved</span><strong id="saved">0</strong></div>
              <div class="kpi"><span>Remaining</span><strong id="remaining">0</strong></div>
              <div class="kpi"><span>Issues</span><strong id="issues">0</strong></div>
            </div>
          </div>
          <div id="currentSection" class="section">
            <h3>Current asset</h3>
            <div class="rowline"><span id="row" class="muted">-</span><span id="status" class="pill neutral">-</span></div>
            <div id="assetCode" class="asset">-</div>
            <div id="validation" class="validation goodtext">Load a workbook to begin.</div>
            <div id="lookupSummary" class="lookup-list"></div>
          </div>
          <div id="manualSection" class="section">
            <h3>Manual control</h3>
            <div class="buttons">
              <button id="fill" class="action primary wide">Fill current NEW record</button>
              <button id="saveCurrent" class="action primary wide">Save NEW -> ACTIVE -> linked PPMs -> next</button>
              <button id="editExisting" class="action wide">Fill saved asset from workbook</button>
              <button id="saveExisting" class="action wide">Save existing changes only</button>
              <button id="prev" class="action">Previous</button>
              <button id="next" class="action">Next</button>
              <button id="skip" class="action">Skip current</button>
              <button id="markSaved" class="action">Mark saved + next</button>
              <button id="learnStatus" class="action wide">Teach / capture status button</button>
            </div>
            <div id="learnedStatusInfo" class="muted" style="margin-top:7px">Status button not taught yet.</div>
          </div>
          <div id="autoSection" class="section">
            <h3>Automatic Asset + PPM import</h3>
            <div class="buttons">
              <button id="startPpmHere" class="action primary wide" hidden>START PPM FOR THIS ASSET</button>
              <button id="openPpmNew" class="action wide" hidden>OPEN + NEW PPM WINDOW</button>
              <button id="learnPpmNew" class="action wide" hidden>TEACH / CAPTURE + NEW BUTTON</button>
              <button id="startAuto" class="action primary">Start automatic</button>
              <button id="pauseAuto" class="action danger">Pause / Stop</button>
            </div>
            <div id="ppmQueuePreview" class="validation goodtext" hidden style="margin-top:8px"></div>
            <div id="learnedNewInfo" class="muted" hidden style="margin-top:7px">+ New button not taught yet.</div>
            <div id="autoState">Automatic import stopped</div>
            <label class="option"><input id="iterateBatch" type="checkbox"> Enable multiple asset iterations</label>
            <label class="option">Asset iteration count <input id="iterationCount" type="number" min="1" max="10000" step="1" value="1" style="width:90px"></label>
            <div class="muted" style="margin:4px 0 8px">Unchecked = exactly one complete Asset + linked PPM cycle, then stop. Checked = continue until the asset iteration count is reached.</div>
            <label class="option"><input id="includeNotes" type="checkbox"> Include Notes tab only when workbook data is populated</label>
            <label class="option"><input id="includeSpatial" type="checkbox"> Include Spatial / GIS tab only when workbook data is populated</label>
            <label class="option"><input id="skipInvalid" type="checkbox"> Skip invalid workbook rows instead of stopping</label>
            <div class="muted">v8 has no per-record pacing delay. It proceeds when CAFM state is verified; 45-second safety timeouts remain for stalled network/UI operations.</div>
          </div>
          <div id="sessionSection" class="section">
            <h3>Session</h3>
            <div class="buttons">
              <button id="downloadLog" class="action">Download CSV log</button>
              <button id="downloadDiagnostic" class="action">Download diagnostic JSON</button>
              <button id="clear" class="action danger">Clear session</button>
            </div>
            <div class="muted" style="margin-top:7px">NEW asset sequence: fill populated workbook fields -> Save -> verify saved Asset ID -> Change Asset Status -> Active -> PPM workflow. Legacy toolbar detection is corrected to use page-relative coordinates and one-click protection. v8 uses state-driven progression with no inter-record pacing delay and skips optional Notes/Spatial tabs unless enabled and populated. EDIT EXISTING: open a saved asset, use Fill saved asset from workbook, review, then Save existing changes only (or the normal CAFM Save). Edit mode matches by Asset Code, never creates a duplicate, never clears blank workbook fields, and does not alter asset status or existing PPMs.</div>
          </div>
          <div class="footer">Move this panel by dragging the header. Site and calculated/read-only fields are not overwritten.</div>
        </div>
      </div>
      <div id="toast" class="toast"></div>
    `;

    const ids = ['panel', 'head', 'contextSub', 'workbookSection', 'currentSection', 'manualSection', 'autoSection', 'sessionSection', 'collapse', 'fileInput', 'fileName', 'total', 'saved', 'remaining', 'issues', 'row', 'status', 'assetCode', 'validation', 'lookupSummary', 'fill', 'saveCurrent', 'editExisting', 'saveExisting', 'prev', 'next', 'skip', 'markSaved', 'learnStatus', 'learnedStatusInfo', 'startPpmHere', 'openPpmNew', 'learnPpmNew', 'ppmQueuePreview', 'learnedNewInfo', 'startAuto', 'pauseAuto', 'autoState', 'iterateBatch', 'iterationCount', 'includeNotes', 'includeSpatial', 'skipInvalid', 'downloadLog', 'downloadDiagnostic', 'clear', 'toast'];
    for (const id of ids) state.els[id] = shadow.getElementById(id);
    state.els.dragHandle = state.els.head;
    if (!isAssetPage()) state.els.panel.classList.add('ppm-workflow');

    if (state.settings.panelX != null) {
      state.els.panel.style.right = 'auto';
      state.els.panel.style.left = `${Math.max(0, Number(state.settings.panelX) || 0)}px`;
    }
    state.els.panel.style.top = `${Math.max(0, Number(state.settings.panelY) || 76)}px`;
    if (state.settings.collapsed) state.els.panel.classList.add('collapsed');

    state.els.collapse.addEventListener('click', async () => {
      state.settings.collapsed = !state.settings.collapsed;
      state.els.panel.classList.toggle('collapsed', state.settings.collapsed);
      state.els.collapse.textContent = state.settings.collapsed ? '+' : '-';
      await persistSession();
    });
    state.els.collapse.textContent = state.settings.collapsed ? '+' : '-';

    state.els.fileInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try { await loadWorkbookFile(file); }
      catch (error) { showToast(error.message || String(error), 'error', 12000); }
    });
    state.els.fill.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = true;
      try { await fillCurrentRecord(); }
      catch (error) { showToast(error.message || String(error), 'error', 12000); }
      finally { state.busy = false; render(); }
    });
    state.els.saveCurrent.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = true;
      try { await clickSaveTracked('manual'); }
      catch (error) { showToast(error.message || String(error), 'error', 12000); }
      finally { state.busy = false; render(); }
    });
    state.els.editExisting.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = true;
      try { await fillExistingSavedAsset(); }
      catch (error) { showToast(error.message || String(error), 'error', 14000); }
      finally { state.busy = false; render(); }
    });
    state.els.saveExisting.addEventListener('click', async () => {
      if (state.busy) return;
      state.busy = true;
      try { await saveExistingAssetChanges(); }
      catch (error) { showToast(error.message || String(error), 'error', 14000); }
      finally { state.busy = false; render(); }
    });
    state.els.prev.addEventListener('click', () => move(-1));
    state.els.next.addEventListener('click', () => move(1));
    state.els.skip.addEventListener('click', skipCurrent);
    state.els.markSaved.addEventListener('click', () => markSavedAndNext('Manually confirmed by user'));
    state.els.learnStatus.addEventListener('click', async () => {
      state.teachStatusArmed = true;
      state.teachNewArmed = false;
      const auto = state.session.auto || {};
      if (String(auto.phase || '').startsWith('activate_')) state.session.auto = { ...auto, phase: 'activate_wait_user', activationManualStartedAt: Date.now() };
      else if (String(auto.phase || '').startsWith('ppm_status_')) state.session.auto = { ...auto, phase: 'ppm_status_wait_user', ppmStatusManualStartedAt: Date.now() };
      await storageSet({ [STORAGE.statusLearnRequest]: { active: true, startedAt: Date.now(), expiresAt: Date.now() + 90000 } });
      await persistSession();
      showToast('Teach mode armed. Click the real traffic-light status icon ONCE. This click will be captured only once; automation will not click it again while teaching.', 'warn', 14000);
    });
    state.els.startPpmHere.addEventListener('click', async () => {
      if (state.busy) return;
      try { await startPpmForCurrentPage(); }
      catch (error) { showToast(error.message || String(error), 'error', 14000); }
    });
    state.els.openPpmNew.addEventListener('click', () => {
      try {
        const record = ppmRecordOnCurrentPage() || currentRecord();
        const idx = Number(state.session.auto?.ppmIndex || 0);
        clickPpmNewToolbar(`manual-open:${record?.assetCode || 'asset'}:${idx}`);
        showToast('Clicked CAFM + New ONCE. Waiting for the New PPM window; do not click again.', 'success', 8000);
      } catch (error) {
        showToast(error.message || String(error), 'error', 12000);
      }
    });
    state.els.learnPpmNew.addEventListener('click', async () => {
      state.teachNewArmed = true;
      state.teachStatusArmed = false;
      const auto = state.session.auto || {};
      if (String(auto.phase || '').startsWith('ppm_')) state.session.auto = { ...auto, phase: 'ppm_wait_user_new', ppmOpenStartedAt: Date.now() };
      await storageSet({ [STORAGE.newLearnRequest]: { active: true, startedAt: Date.now(), expiresAt: Date.now() + 90000 } });
      await persistSession();
      showToast('Teach + New is armed. Click the REAL CAFM + New button ONCE. The extension will capture only that click and will not issue a second popup click while teaching.', 'warn', 16000);
    });
    state.els.startAuto.addEventListener('click', startAutomatic);
    state.els.pauseAuto.addEventListener('click', pauseAutomatic);
    state.els.downloadLog.addEventListener('click', downloadLog);
    state.els.clear.addEventListener('click', clearSession);
    state.els.includeNotes.addEventListener('change', async () => {
      state.settings.includeNotes = state.els.includeNotes.checked;
      await persistSession();
      render();
    });
    state.els.includeSpatial.addEventListener('change', async () => {
      state.settings.includeSpatial = state.els.includeSpatial.checked;
      await persistSession();
      render();
    });
    state.els.skipInvalid.addEventListener('change', async () => {
      state.settings.skipInvalidRows = state.els.skipInvalid.checked;
      await persistSession();
    });
    state.els.iterateBatch.addEventListener('change', async () => {
      state.settings.iterationEnabled = state.els.iterateBatch.checked;
      await persistSession();
      render();
    });
    state.els.iterationCount.addEventListener('change', async () => {
      state.settings.iterationCount = Math.max(1, Math.min(10000, Math.floor(Number(state.els.iterationCount.value) || 1)));
      await persistSession();
      render();
    });
    state.els.downloadDiagnostic.addEventListener('click', downloadDiagnostic);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let changed = false;
      if (changes[STORAGE.learnedStatus]) {
        state.learnedStatus = changes[STORAGE.learnedStatus].newValue || null;
        changed = true;
        if (state.learnedStatus) showToast('Status button captured successfully. Future activation will use this exact element before any fallback detector.', 'success', 9000);
      }
      if (changes[STORAGE.learnedNew]) {
        state.learnedNew = changes[STORAGE.learnedNew].newValue || null;
        changed = true;
        if (state.learnedNew) showToast('+ New button captured successfully. Future PPM creation will use this exact learned control before any fallback detector.', 'success', 10000);
      }
      if (changed) render();
    });
    makeDraggable();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'EE_PPM_CURRENT_EDITOR_CLOSED' && isHashPpmParentPage()) {
      addEvent('ppm-parent-current-editor-close-message', {
        closedTabId: message.closedTabId ?? null,
        closedTabIds: Array.isArray(message.closedTabIds) ? message.closedTabIds : [],
        closedCount: Number(message.closedCount || 0),
        closeErrors: Array.isArray(message.closeErrors) ? message.closeErrors : [],
        candidateInfo: Array.isArray(message.candidateInfo) ? message.candidateInfo : [],
        nextPhase: message.nextPhase || '',
        closeStrategy: message.closeStrategy || '',
        parentUrl: location.href
      });
      storageGet([STORAGE.session]).then(async (stored) => {
        if (stored[STORAGE.session]) state.session = { ...state.session, ...stored[STORAGE.session] };
        const currentAuto = state.session.auto || {};
        const nextPhase = String(message.nextPhase || 'ppm_next');
        state.session.auto = {
          ...currentAuto,
          phase: nextPhase,
          ppmAfterRefreshPhase: '',
          ppmParentRefreshStartedAt: 0,
          ppmParentRefreshClickedAt: 0,
          ppmParentRefreshPageInstance: '',
          ppmParentRefreshSawDisabled: false,
          ppmNewClickedForIndex: -1,
          ppmListReadyStartedAt: 0,
          ppmOpenStartedAt: 0,
          ppmNewClickAttempts: 0,
          ppmNewLastClickAt: 0
        };
        await persistSession();
        render();
        scheduleAuto(100);
      }).catch(() => scheduleAuto(200));
      return;
    }

    if (message.type === 'EE_PPM_CHILD_DONE' && isHashPpmParentPage()) {
      addEvent('ppm-parent-child-done-message', {
        childTabId: message.childTabId ?? null,
        childClosed: Boolean(message.childClosed),
        afterRefreshPhase: message.afterRefreshPhase || '',
        closeError: message.closeError || '',
        parentUrl: location.href
      });
      storageGet([STORAGE.session]).then(async (stored) => {
        if (stored[STORAGE.session]) state.session = { ...state.session, ...stored[STORAGE.session] };
        const currentAuto = state.session.auto || {};
        const nextPhase = String(message.afterRefreshPhase || currentAuto.ppmAfterRefreshPhase || 'ppm_next');
        state.session.auto = {
          ...currentAuto,
          phase: nextPhase,
          ppmAfterRefreshPhase: '',
          ppmParentRefreshStartedAt: 0,
          ppmParentRefreshClickedAt: 0,
          ppmParentRefreshPageInstance: '',
          ppmParentRefreshSawDisabled: false,
          ppmNewClickedForIndex: -1,
          ppmListReadyStartedAt: 0,
          ppmOpenStartedAt: 0,
          ppmNewClickAttempts: 0,
          ppmNewLastClickAt: 0
        };
        await persistSession();
        render();
        scheduleAuto(50);
      }).catch(() => scheduleAuto(150));
    }
  });

  async function initTop() {
    if (!isWorkflowPage()) return;
    if (isAssetPage()) await runtimeMessage({ type: 'REGISTER_ASSET_TAB' });
    await restoreState();
    injectPanel();
    render();
    if (isAssetPage()) await handlePostReloadSaveState();
    const autoObserver = new MutationObserver(() => {
      if (state.session.auto?.active) scheduleAuto();
    });
    try { autoObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (_) {}
    if (state.session.auto?.active) scheduleAuto();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initTop().catch(() => {}), { once: true });
  else initTop().catch(() => {});
})();
