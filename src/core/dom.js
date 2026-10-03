(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
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

  function dispatchClick(target, doubleClick = false) {
    if (!target) return;
    try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
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

  root.core.dom = Object.freeze({ wait, visible, isAssistantElement, elementValue, dispatchClick });
})();
