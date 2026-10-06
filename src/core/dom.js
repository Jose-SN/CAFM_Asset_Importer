(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { HOST_ID } = root.core.constants;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function visible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isAssistantElement(element) {
    if (!element || !(element instanceof Element)) return false;
    return Boolean(element.closest?.(`#${HOST_ID}`) || element.id === HOST_ID);
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

  function dispatchClick(target, doubleClick = false, hint = '') {
    if (!target) return;
    try {
      const label = clean(hint || target.getAttribute?.('title') || target.textContent || '').slice(0, 80);
      if (label && formCfg().state?.showActivity) {
        formCfg().state.showActivity('Clicking', label, doubleClick ? 'Double-click' : 'Single click', { wait: false, type: 'info', duration: 1800, tick: false });
      }
    } catch (_) {}
    try { target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
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

  let cfg = null;
  function configureForm(deps) { cfg = Object.freeze({ ...deps }); }
  function formCfg() {
    if (!cfg) throw new Error('CAFMImporter dom form helpers are not configured yet.');
    return cfg;
  }

function labelElements(labelNames, root = document) {
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

function waitForDom(predicate, timeoutMs = formCfg().state.settings.lookupTimeoutMs, description = 'CAFM page state') {
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

function allVisibleControls(root = document) {
  return [...root.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]')]
    .filter((element) => visible(element) && !isAssistantElement(element));
}

function nearestControl(labelNames, root = document) {
  const labels = labelElements(labelNames, root);
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

function nearestCheckbox(labelNames, root = document) {
  const labels = labelElements(labelNames, root);
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

function findSaveButton() {
  const candidates = [...document.querySelectorAll('button,a,[role="button"],span,div')]
    .filter((element) => {
      if (!visible(element) || isAssistantElement(element)) return false;
      const text = norm(element.textContent);
      const clue = norm(`${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`);
      if (/save and close|saveandclose/.test(text) || /save and close/i.test(clue)) return false;
      return (text === 'save' || clue === 'save' || /\bsave\b/.test(clue)) && clean(element.textContent).length < 35;
    })
    .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
  const raw = candidates[0];
  return raw?.closest('button,a,[role="button"]') || raw || null;
}

function findSaveAndCloseButton() {
  const exact = document.querySelector('a[onclick*="Toolbar.SaveAndClose"], a[title*="Save and Close" i]');
  if (exact && visible(exact) && !isAssistantElement(exact)) return exact;
  const candidates = [...document.querySelectorAll('a,button,[role="button"]')]
    .filter((element) => {
      if (!visible(element) || isAssistantElement(element)) return false;
      const text = norm(element.textContent);
      const onclick = norm(element.getAttribute('onclick') || '');
      const title = norm(element.getAttribute('title') || '');
      return /save and close/.test(text) || onclick.includes('toolbar.saveandclose') || /save and close/.test(title);
    });
  return candidates[0]?.closest?.('a,button,[role="button"]') || candidates[0] || null;
}

function findSaveAndNewButton() {
  const exact = document.querySelector('a[onclick*="Toolbar.SaveAndNew"], a[title*="Save and New" i]');
  if (exact && visible(exact) && !isAssistantElement(exact)) return exact;
  const candidates = [...document.querySelectorAll('a,button,[role="button"]')]
    .filter((element) => {
      if (!visible(element) || isAssistantElement(element)) return false;
      const text = norm(element.textContent);
      const onclick = norm(element.getAttribute('onclick') || '');
      const title = norm(element.getAttribute('title') || '');
      return /save and new/.test(text) || onclick.includes('toolbar.saveandnew') || /save and new/.test(title);
    });
  return candidates[0]?.closest?.('a,button,[role="button"]') || candidates[0] || null;
}

function clickSaveAndClose() {
  try {
    if (typeof Toolbar !== 'undefined' && typeof Toolbar.SaveAndClose === 'function') {
      Toolbar.SaveAndClose();
      return { ok: true, method: 'Toolbar.SaveAndClose' };
    }
  } catch (_) {}
  const direct = findSaveAndCloseButton();
  if (direct && visible(direct)) {
    dispatchClick(direct, false);
    return { ok: true, method: 'menu-link' };
  }
  const saveTriggers = [...document.querySelectorAll('a[onclick*="Toolbar.Save"], button[onclick*="Toolbar.Save"]')]
    .filter((element) => visible(element) && !isAssistantElement(element));
  for (const trigger of saveTriggers) {
    dispatchClick(trigger, false);
    const menuItem = findSaveAndCloseButton();
    if (menuItem && visible(menuItem)) {
      dispatchClick(menuItem, false);
      return { ok: true, method: 'dropdown-menu-link' };
    }
  }
  return { ok: false, method: '' };
}

function clickSaveAndNew() {
  try {
    if (typeof Toolbar !== 'undefined' && typeof Toolbar.SaveAndNew === 'function') {
      Toolbar.SaveAndNew();
      return { ok: true, method: 'Toolbar.SaveAndNew' };
    }
  } catch (_) {}
  const direct = findSaveAndNewButton();
  if (direct && visible(direct)) {
    dispatchClick(direct, false);
    return { ok: true, method: 'menu-link' };
  }
  const saveTriggers = [...document.querySelectorAll('a[onclick*="Toolbar.Save"], button[onclick*="Toolbar.Save"]')]
    .filter((element) => visible(element) && !isAssistantElement(element));
  for (const trigger of saveTriggers) {
    dispatchClick(trigger, false);
    const menuItem = findSaveAndNewButton();
    if (menuItem && visible(menuItem)) {
      dispatchClick(menuItem, false);
      return { ok: true, method: 'dropdown-menu-link' };
    }
  }
  return { ok: false, method: '' };
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

  root.core.dom = Object.freeze({
    wait, visible, isAssistantElement, elementValue, dispatchClick,
    configureForm, waitForDom, labelElements, allVisibleControls, nearestControl,
    setNativeValue, tabContextReady, clickTab, fillByLabel, nearestCheckbox,
    setCheckboxByLabel, setSelectByLabel, findSaveButton, findSaveAndCloseButton, findSaveAndNewButton, clickSaveAndClose, clickSaveAndNew, validationMessage
  });
})();
