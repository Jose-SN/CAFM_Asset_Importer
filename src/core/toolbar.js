(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { wait, visible, isAssistantElement, elementValue, dispatchClick } = root.core.dom;
  const { isSavedAssetPage, isSavedPpmPage } = root.core.pages;
  const { clickableLookupNode, typeIntoInlineLookup } = root.core.lookup;

  /** @type {null | { state: object, waitForDom: Function, nearestControl: Function }} */
  let cfg = null;
  function configure(deps) { cfg = Object.freeze({ ...deps }); }
  function C() {
    if (!cfg) throw new Error('CAFMImporter toolbar module is not configured yet.');
    return cfg;
  }
  const waitForDom = (...args) => C().waitForDom(...args);
  const nearestControl = (...args) => C().nearestControl(...args);

function dispatchLegacySingleClick(target, guardKey = '', cooldownMs = 12000) {
  if (!target) return false;
  const now = Date.now();
  const key = clean(guardKey || 'legacy-control');
  const last = Number(C().state.legacyClickTimes?.[key] || 0);
  if (last && now - last < cooldownMs) return false;
  if (!C().state.legacyClickTimes) C().state.legacyClickTimes = Object.create(null);
  C().state.legacyClickTimes[key] = now;
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
  const learned = C().state.learnedStatus;
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
    await waitForDom(() => norm(elementValue(control)).includes('active') && control, C().state.settings.lookupTimeoutMs, `${label} Active selection`);
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

function findAssetGeneralNavLink() {
  const docs = [document, ...sameOriginDocuments().filter((doc) => doc !== document)];
  for (const doc of docs) {
    try {
      const exact = doc.querySelector([
        'a.fsiNavItem[title="General"]',
        'a#Fsi\\.Concept\\.Asset\\.Entities\\.FASSET\\.Common\\.Edit',
        'a#Fsi\\.Concept\\.Asset\\.Entities\\.FASSET\\.Common\\.New'
      ].join(', '));
      if (exact && visible(exact) && !isAssistantElement(exact)) return exact;
      const candidates = [...doc.querySelectorAll('a.fsiNavItem, a[title="General"]')]
        .filter((element) => {
          if (!visible(element) || isAssistantElement(element)) return false;
          const title = norm(element.getAttribute('title') || '');
          const text = norm(element.querySelector('.fsiNavItemText')?.textContent || element.textContent || '');
          return title === 'general' || text === 'general';
        });
      if (candidates[0]) return candidates[0];
    } catch (_) {}
  }
  return null;
}

function findAssetListCreateNewButton() {
  const docs = [document, ...sameOriginDocuments().filter((doc) => doc !== document)];
  for (const doc of docs) {
    try {
      const exact = doc.querySelector('a[title="Create New"][onclick*="Toolbar.New"]');
      if (exact && visible(exact) && !isAssistantElement(exact)) return exact;
      const menuAnchor = doc.querySelector('a.x-button-drop-menu-link[onclick*="Toolbar.New"]');
      if (menuAnchor && visible(menuAnchor) && !isAssistantElement(menuAnchor)) return menuAnchor;
    } catch (_) {}
  }
  return null;
}

function clickAssetListCreateNew() {
  const target = findAssetListCreateNewButton();
  if (target) {
    if (target.hasAttribute('disabled') || String(target.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
      return { ok: false, reason: 'create-new-disabled' };
    }
    if (target.classList.contains('x-button-drop-menu-link')) {
      try {
        if (typeof Toolbar !== 'undefined' && typeof Toolbar.New === 'function') {
          Toolbar.New();
          return { ok: true, method: 'Toolbar.New-menu-link' };
        }
      } catch (_) {}
    }
    if (visible(target)) {
      dispatchClick(target, false, 'Create New Asset');
      return { ok: true, method: 'create-new-link' };
    }
  }
  try {
    if (typeof Toolbar !== 'undefined' && typeof Toolbar.New === 'function') {
      Toolbar.New();
      return { ok: true, method: 'Toolbar.New-direct' };
    }
  } catch (_) {}
  return { ok: false, reason: 'create-new-not-found' };
}

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

  root.core = root.core || {};
  root.core.toolbar = Object.freeze({
    configure,
    dispatchLegacySingleClick,
    observedAssetCode,
    currentAssetStatusText,
    assetIsActive,
    sameOriginDocuments,
    elementFromLearnedFingerprint,
    findToolbarCloseButton,
    findChangeAssetStatusButton,
    findChangeAssetStatusDialog,
    findChangePpmStatusButton,
    findChangePpmStatusDialog,
    findConfirmButton,
    selectActiveFromStatusDropdown,
    findAssetGeneralNavLink,
    findAssetListCreateNewButton,
    clickAssetListCreateNew,
    findAssetPpmNavLink,
    currentPpmStatusText,
    ppmIsActive
  });
})();
