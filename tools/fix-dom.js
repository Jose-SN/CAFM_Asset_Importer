'use strict';

const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const FORM = [
  'waitForDom', 'allVisibleControls', 'nearestControl', 'setNativeValue', 'tabContextReady',
  'clickTab', 'fillByLabel', 'nearestCheckbox', 'setCheckboxByLabel', 'setSelectByLabel',
  'findSaveButton', 'validationMessage'
];

function extract(code, name) {
  const re = new RegExp(`^  (async )?function ${name}\\([\\s\\S]*?\\)\\s*\\{`, 'm');
  const m = re.exec(code);
  if (!m) throw new Error(`Missing ${name}`);
  let i = m.index + m[0].length - 1;
  let depth = 0;
  while (i < code.length) {
    const ch = code[i++];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return code.slice(m.index, i).replace(/^  /gm, '').trimEnd();
}

const labelMatch = content.match(/^  function fieldCandidates\(labelNames[\s\S]*?\n  \}/m);
if (!labelMatch) throw new Error('label fieldCandidates missing');
const label = labelMatch[0].replace(/^  /gm, '').replace('fieldCandidates(labelNames', 'labelElements(labelNames');

let body = [label, ...FORM.map((n) => extract(content, n))].join('\n\n');
body = body
  .replace(/\bstate\.settings/g, 'formCfg().state.settings')
  .replace(/\bfieldCandidates\(/g, 'labelElements(');

const out = `(() => {
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
    return Boolean(element.closest?.(\`#\${HOST_ID}\`) || element.id === HOST_ID);
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

  function dispatchClick(target, doubleClick = false) {
    if (!target) return;
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

${body}

  root.core.dom = Object.freeze({
    wait, visible, isAssistantElement, elementValue, dispatchClick,
    configureForm, waitForDom, labelElements, allVisibleControls, nearestControl,
    setNativeValue, tabContextReady, clickTab, fillByLabel, nearestCheckbox,
    setCheckboxByLabel, setSelectByLabel, findSaveButton, validationMessage
  });
})();
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'core', 'dom.js'), out);
console.log('Fixed dom.js');
