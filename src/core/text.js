(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  root.core = root.core || {};

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

  root.core.text = Object.freeze({ norm, clean, uniqueNonBlank, uniqueId });
})();
