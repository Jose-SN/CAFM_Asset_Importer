'use strict';

const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const outPath = path.join(__dirname, '..', 'src', 'data', 'records.js');

const FUNCS = [
  'currentRecord', 'assetCodeOnPage', 'workflowAssetCodeOnPage', 'recordByAssetCode',
  'ppmRecordOnCurrentPage', 'workflowRecord', 'recordForCurrentSavedAsset', 'validateRecord'
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
    if (ch === '}') { depth -= 1; if (depth === 0) break; }
  }
  return code.slice(m.index, i).replace(/^  /gm, '').trimEnd();
}

let body = FUNCS.map((n) => extract(content, n)).join('\n\n');
body = body
  .replace(/\bstate\./g, 'C().state.')
  .replace(/\bnearestControl\b/g, 'C().nearestControl')
  .replace(/\bobservedAssetCode\b/g, 'C().observedAssetCode')
  .replace(/\bassetCodeOnPage\b/g, 'assetCodeOnPage')
  .replace(/\bworkflowAssetCodeOnPage\b/g, 'workflowAssetCodeOnPage');

const out = `(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { visible, isAssistantElement, elementValue } = root.core.dom;
  const { isAssetPage, isSavedAssetPage, isPpmListPage, entityIdFromUrl } = root.core.pages;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;
  function configure(deps) { cfg = Object.freeze({ ...deps }); }
  function C() {
    if (!cfg) throw new Error('CAFMImporter records module is not configured yet.');
    return cfg;
  }

${body}

  root.data = root.data || {};
  root.data.records = Object.freeze({
    configure,
    currentRecord,
    assetCodeOnPage,
    workflowAssetCodeOnPage,
    recordByAssetCode,
    ppmRecordOnCurrentPage,
    workflowRecord,
    recordForCurrentSavedAsset,
    validateRecord
  });
})();
`;

fs.writeFileSync(outPath, out);
console.log(`Wrote ${outPath}`);
