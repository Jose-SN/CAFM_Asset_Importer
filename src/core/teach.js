(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { isAssistantElement } = root.core.dom;
  const { STORAGE } = root.core.constants;
  const { storageGet, storageSet, storageRemove, runtimeMessage } = root.core.storage;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;
  function configure(deps) { cfg = Object.freeze({ ...deps }); }
  function C() {
    if (!cfg) throw new Error('CAFMImporter teach module is not configured yet.');
    return cfg;
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
    topFrame: C().TOP,
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

function initTeachCapture() {
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
}

  root.core = root.core || {};
  root.core.teach = Object.freeze({ configure, initTeachCapture });
})();
