'use strict';

const fs = require('fs');
const path = require('path');

const contentPath = path.join(__dirname, '..', 'content.js');
const outPath = path.join(__dirname, '..', 'src', 'data', 'workbook.js');

const WORKBOOK_FUNCS = [
  'persistSession',
  'restoreState',
  'loadWorkbookFile',
  'counts',
  'move',
  'skipCurrent',
  'markSavedAndNext',
  'clearSession',
  'csvCell',
  'downloadLog',
  'downloadDiagnostic',
  'setStatus',
  'statusOf',
  'nextPendingIndex'
];

function extractFunction(code, name) {
  const re = new RegExp(`^  (async )?function ${name}\\([\\s\\S]*?\\)\\s*\\{`, 'm');
  const match = re.exec(code);
  if (!match) throw new Error(`Function not found: ${name}`);
  const start = match.index;
  const bodyStart = match.index + match[0].length - 1;
  let depth = 0;
  let i = bodyStart;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    i += 1;
  }
  return code.slice(start, i).replace(/^  /gm, '').trimEnd();
}

const content = fs.readFileSync(contentPath, 'utf8');
const bodies = WORKBOOK_FUNCS.map((name) => extractFunction(content, name));

const header = `(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm } = root.core.text;
  const { VERSION, STORAGE, DEFAULT_SETTINGS } = root.core.constants;
  const {
    isNewEntityPage,
    deriveNewEntityUrl
  } = root.core.pages;
  const {
    storageGet,
    storageSet,
    storageRemove,
    saveLargeWorkbook,
    loadLargeWorkbook,
    clearLargeWorkbook
  } = root.core.storage;
  const ppmData = root.data.ppm;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;

  function configure(deps) {
    cfg = Object.freeze({ ...deps });
  }

  function C() {
    if (!cfg) throw new Error('CAFMImporter workbook module is not configured yet.');
    return cfg;
  }

`;

const footer = `
  root.data = root.data || {};
  root.data.workbook = Object.freeze({
    configure,
    persistSession,
    restoreState,
    loadWorkbookFile,
    counts,
    move,
    skipCurrent,
    markSavedAndNext,
    clearSession,
    downloadLog,
    downloadDiagnostic,
    setStatus,
    statusOf,
    nextPendingIndex
  });
})();
`;

let transformed = bodies.join('\n\n');
transformed = transformed
  .replace(/\bstate\./g, 'C().state.')
  .replace(/\brender\(\)/g, 'C().render()')
  .replace(/\bshowToast\(/g, 'C().showToast(')
  .replace(/\bvalidateRecord\(/g, 'C().validateRecord(')
  .replace(/\bcurrentRecord\(/g, 'C().currentRecord(')
  .replace(/\bsetStatus\(/g, 'setStatus(')
  .replace(/\blinkedPpms\(/g, 'C().linkedPpms(')
  .replace(/\bworkflowRecord\(/g, 'C().workflowRecord(')
  .replace(/\bcurrentPpm\(/g, 'C().currentPpm(')
  .replace(/\bcurrentAssetStatusText\(/g, 'C().currentAssetStatusText(')
  .replace(/\bcurrentPpmStatusText\(/g, 'C().currentPpmStatusText(')
  .replace(/\bvalidationMessage\(/g, 'C().validationMessage(')
  .replace(/\baddEvent\(/g, 'C().addEvent(')
  .replace(/\bglobalThis\.CAFMXlsx/g, 'globalThis.CAFMXlsx');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, header + transformed + footer);
console.log(`Wrote ${outPath} (${WORKBOOK_FUNCS.length} functions)`);
