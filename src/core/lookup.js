(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm, uniqueNonBlank } = root.core.text;
  const { wait, visible, isAssistantElement, elementValue, dispatchClick } = root.core.dom;
  const { buildingNumber } = root.core.lookupSpec;
  const { STORAGE } = root.core.constants;
  const { isAssetPage } = root.core.pages;
  const { storageGet, storageSet, runtimeMessage } = root.core.storage;

  /** @type {null | {
   *   state: object,
   *   TOP: boolean,
   *   waitForDom: Function,
   *   nearestControl: Function,
   *   clickTab: Function,
   *   setNativeValue: Function
   * }} */
  let cfg = null;

  function configure(deps) {
    cfg = Object.freeze({ ...deps });
  }

  function C() {
    if (!cfg) throw new Error('CAFMImporter lookup is not configured yet.');
    return cfg;
  }

  function ppmInstructionCanon(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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
  const popupLikePage = !isAssetPage() || !C().TOP;
  const surfaces = explicitLookupSurfaces();
  const roots = surfaces.length ? surfaces.slice(0, 6) : (popupLikePage ? [document.body] : [document.body]);
  const source = C().TOP && isAssetPage() ? C().nearestControl([spec.field])?.control : null;
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
      if (sourceRect && !surfaces.length && C().TOP && isAssetPage()) {
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
  const source = C().TOP && isAssetPage() ? C().nearestControl([spec.field])?.control : null;
  const surfaces = explicitLookupSurfaces();
  if (C().TOP && isAssetPage() && !surfaces.length) return null;
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
  C().setNativeValue(input, '');
  C().setNativeValue(input, term);

  for (const type of ['keydown', 'keypress', 'keyup']) {
    try {
      const event = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
    } catch (_) {}
  }

  const button = findSearchButton(input);
  if (button) dispatchClick(button, false);
  try {
    await C().waitForDom(() => {
      const now = lookupGridSignature();
      return now && (!before || now !== before) ? now : null;
    }, C().state.settings.lookupTimeoutMs, `${field} lookup search results`);
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
  if (C().state.lookupAgentBusy) return;
  const data = await storageGet(STORAGE.pendingLookup);
  const pending = data[STORAGE.pendingLookup];
  if (!pending || !['opened', 'searching'].includes(pending.status)) return;
  if (Date.now() - Number(pending.createdAt || 0) > 180000) return;

  const candidates = optionCandidates(pending);
  const searchInput = findLookupSearchInput(pending);
  if (!candidates.length && !searchInput) return;

  C().state.lookupAgentBusy = true;
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
      handlerFrame: C().TOP ? 'top' : 'frame'
    });
    await runtimeMessage({ type: 'LOOKUP_SELECTED', pendingId: current.id });
  } catch (error) {
    await updatePendingLookup(pending.id, { status: 'error', error: `Lookup automation error: ${error.message || error}` });
  } finally {
    if (claimed) await runtimeMessage({ type: 'RELEASE_LOOKUP', pendingId: pending.id });
    C().state.lookupAgentBusy = false;
  }
}

function scheduleLookupAgent(delay = 350) {
  clearTimeout(C().state.lookupTimer);
  C().state.lookupTimer = setTimeout(() => handlePendingLookup().catch(() => {}), delay);
}

function startLookupAgent() {
  const observer = new MutationObserver(() => scheduleLookupAgent(200));
  try { observer.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true }); } catch (_) {}
  setInterval(() => scheduleLookupAgent(0), 900);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE.pendingLookup]) scheduleLookupAgent(80);
  });
}

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
  // C().setNativeValue helper here (that helper intentionally fires blur/change).
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

async function waitForInlineOptions(spec, control, timeoutMs = C().state.settings.lookupTimeoutMs) {
  try {
    return await C().waitForDom(() => {
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

async function waitForCommittedLookup(spec, beforeFingerprint, timeoutMs = C().state.settings.lookupTimeoutMs) {
  const evaluate = () => {
    const live = C().nearestControl([spec.field])?.control;
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
  try { return await C().waitForDom(evaluate, timeoutMs, `${spec.field} committed lookup value`); }
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
      const liveControl = C().nearestControl([spec.field])?.control || control;
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
    const live = C().nearestControl([spec.field])?.control || control;
    if (live && !lookupTextMatches(elementValue(live), spec)) {
      try { live.focus(); } catch (_) {}
      setFocusedInputValue(live, '', null);
    }
    await wait(0);
  }

  if (lastTyped) {
    const live = C().nearestControl([spec.field])?.control || control;
    if (live && !lookupTextMatches(elementValue(live), spec)) {
      try { live.focus(); } catch (_) {}
      setFocusedInputValue(live, '', null);
    }
  }
  throw new Error(`${spec.field} text was entered, but CAFM did not confirm a committed dropdown selection for: ${spec.value}`);
}

async function selectLookup(spec) {
  await C().clickTab(spec.tab);
  const found = C().nearestControl([spec.field]);
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
  root.core = root.core || {};
  root.core.lookup = Object.freeze({
    configure,
    startLookupAgent,
    selectLookup,
    lookupTextMatches,
    nearbyHiddenValues,
    hiddenCommitted,
    typeIntoInlineLookup,
    clickableLookupNode,
    ppmInstructionCanon
  });
})();
