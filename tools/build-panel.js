'use strict';

const fs = require('fs');
const path = require('path');

const contentPath = path.join(__dirname, '..', 'content.js');
const outPath = path.join(__dirname, '..', 'src', 'ui', 'panel.js');

const PANEL_FUNCS = [
  'escapeHtml',
  'statusClass',
  'showToast',
  'render',
  'makeDraggable',
  'injectPanel'
];

const CFG_CALLS = [
  'counts', 'currentRecord', 'statusOf', 'validateRecord', 'linkedPpms',
  'assetCodeOnPage', 'ppmRecordOnCurrentPage', 'workflowAssetCodeOnPage',
  'workflowRecord', 'currentPpm', 'validationMessage', 'persistSession', 'storageSet',
  'loadWorkbookFile', 'fillCurrentRecord', 'clickSaveTracked', 'fillExistingSavedAsset',
  'saveExistingAssetChanges', 'move', 'skipCurrent', 'markSavedAndNext',
  'startPpmForCurrentPage', 'clickPpmNewToolbar', 'startAutomatic', 'pauseAutomatic',
  'downloadLog', 'downloadDiagnostic', 'clearSession'
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
  let body = code.slice(start, i);
  body = body.replace(/^  /gm, '');
  return body.trimEnd();
}

const content = fs.readFileSync(contentPath, 'utf8');
const bodies = PANEL_FUNCS.map((name) => extractFunction(content, name));

const header = `(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean } = root.core.text;
  const { VERSION, HOST_ID, STORAGE } = root.core.constants;
  const {
    isAssetPage,
    isNewEntityPage,
    isSavedAssetPage,
    isPpmListPage,
    isPpmNewEntityPage,
    isSavedPpmPage,
    isWorkflowPage
  } = root.core.pages;
  const { lookupMapping } = root.pages.assetMappings;

  /** @type {null | Record<string, unknown>} */
  let cfg = null;

  function configure(deps) {
    cfg = Object.freeze({ ...deps });
  }

  function C() {
    if (!cfg) throw new Error('CAFMImporter panel is not configured yet.');
    return cfg;
  }

`;

const footer = `
  root.ui = root.ui || {};
  root.ui.panel = Object.freeze({
    configure,
    injectPanel,
    render,
    showToast
  });
})();
`;

let transformed = bodies.join('\n\n');

transformed = transformed.replace(/\bstate\./g, 'C().state.');

for (const name of CFG_CALLS) {
  transformed = transformed.replace(new RegExp(`\\b${name}\\(`, 'g'), `C().${name}(`);
}

// Event listener callbacks passed by reference.
for (const name of ['skipCurrent', 'startAutomatic', 'pauseAutomatic', 'downloadLog', 'clearSession', 'downloadDiagnostic']) {
  transformed = transformed.replace(
    new RegExp(`addEventListener\\('click', ${name}\\)`, 'g'),
    `addEventListener('click', () => C().${name}())`
  );
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, header + transformed + footer);
console.log(`Wrote ${outPath} (${PANEL_FUNCS.length} functions)`);
