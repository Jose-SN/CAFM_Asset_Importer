'use strict';

const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const outPath = path.join(__dirname, '..', 'src', 'core', 'toolbar.js');

const FUNCS = [
  'dispatchLegacySingleClick', 'observedAssetCode', 'currentAssetStatusText', 'assetIsActive',
  'toolbarActionClue', 'topAssetToolbarCandidates', 'findToolbarPrintButton', 'findToolbarCloseButton',
  'sameOriginDocuments', 'elementFromLearnedFingerprint', 'findLearnedStatusButton',
  'findChangeAssetStatusButton', 'currentPpmStatusText', 'ppmIsActive', 'topPpmToolbarCandidates',
  'findChangePpmStatusButton', 'findChangePpmStatusDialog', 'findChangeAssetStatusDialog',
  'findConfirmButton', 'statusActiveOptionCandidates', 'selectActiveFromStatusDropdown', 'findAssetPpmNavLink'
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
  .replace(/\bwaitForDom\b/g, 'waitForDom')
  .replace(/\bwait\b/g, 'wait');

const out = `(() => {
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

${body}

  root.core = root.core || {};
  root.core.toolbar = Object.freeze({
    configure,
    dispatchLegacySingleClick,
    observedAssetCode,
    currentAssetStatusText,
    assetIsActive,
    sameOriginDocuments,
    elementFromLearnedFingerprint,
    findChangeAssetStatusButton,
    findChangeAssetStatusDialog,
    findChangePpmStatusButton,
    findChangePpmStatusDialog,
    findConfirmButton,
    selectActiveFromStatusDropdown,
    findAssetPpmNavLink,
    currentPpmStatusText,
    ppmIsActive
  });
})();
`;

fs.writeFileSync(outPath, out);
console.log(`Wrote ${outPath}`);
