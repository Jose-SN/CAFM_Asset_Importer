'use strict';

const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const outPath = path.join(__dirname, '..', 'src', 'core', 'teach.js');

const FUNCS = ['cssEsc', 'uniqueInDocument', 'cssPathForElement', 'clickFingerprint', 'bestClickedNode'];

function extract(code, name) {
  const re = new RegExp(`^  (async )?function ${name}\\([\\s\\S]*?\\)\\s*\\{`, 'm');
  const m = re.exec(code);
  if (!m) throw new Error(`Missing ${name}`);
  let i = m.index + m[0].length - 1;
  let depth = 0;
  while (i < code.length) {
    const ch = code[i++];
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) break; }
  }
  return code.slice(m.index, i).replace(/^  /gm, '').trimEnd();
}

const listenerMatch = content.match(/  document\.addEventListener\('click',[\s\S]*?\}, true\);/);
if (!listenerMatch) throw new Error('Teach click listener not found');

let body = FUNCS.map((n) => extract(content, n)).join('\n\n');
const listener = listenerMatch[0]
  .replace(/^  document\.addEventListener/, 'function initTeachCapture() {\n  document.addEventListener')
  .replace(/\}, true\);$/, '}, true);\n}');

body = body.replace(/\bTOP\b/g, 'C().TOP').replace(/\bstate\./g, 'C().state.');

const out = `(() => {
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

${body}

${listener}

  root.core = root.core || {};
  root.core.teach = Object.freeze({ configure, initTeachCapture });
})();
`;

fs.writeFileSync(outPath, out);
console.log(`Wrote ${outPath}`);
