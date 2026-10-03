'use strict';

const fs = require('fs');
const path = require('path');

const contentPath = path.join(__dirname, '..', 'content.js');
const outPath = path.join(__dirname, '..', 'src', 'core', 'lookup.js');

const LOOKUP_FUNCS = [
  'clickableLookupNode',
  'findLookupTrigger',
  'nearbyHiddenValues',
  'hiddenCommitted',
  'lookupTextMatches',
  'lookupScore',
  'explicitLookupSurfaces',
  'optionCandidates',
  'findLookupSearchInput',
  'findSearchButton',
  'lookupGridSignature',
  'submitLookupSearch',
  'bestClickableForOption',
  'updatePendingLookup',
  'handlePendingLookup',
  'scheduleLookupAgent',
  'startLookupAgent',
  'keyboardEvent',
  'setFocusedInputValue',
  'typeIntoInlineLookup',
  'inlineOptionCandidates',
  'waitForInlineOptions',
  'lookupCommitFingerprint',
  'fingerprintChanged',
  'commitInlineSelectionWithKeyboard',
  'waitForCommittedLookup',
  'selectInlineComboLookup',
  'selectLookup'
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
const bodies = LOOKUP_FUNCS.map((name) => extractFunction(content, name));

const header = `(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { clean, norm, uniqueNonBlank } = root.core.text;
  const { wait, visible, isAssistantElement, elementValue, dispatchClick } = root.core.dom;
  const { buildingNumber } = root.core.lookupSpec;
  const { STORAGE } = root.core.constants;
  const { isAssetPage } = root.core.pages;
  const { storageGet, storageSet, runtimeMessage } = root.core.storage;

  /** @type {null | {
   *   state: object,
   *   TOP: boolean,
   *   waitForDom: Function,
   *   nearestControl: Function,
   *   clickTab: Function,
   *   setNativeValue: Function
   * }} */
  let cfg = null;

  function configure(deps) {
    cfg = Object.freeze({ ...deps });
  }

  function C() {
    if (!cfg) throw new Error('CAFMImporter lookup is not configured yet.');
    return cfg;
  }

  function ppmInstructionCanon(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim();
  }

`;

const footer = `
  root.core = root.core || {};
  root.core.lookup = Object.freeze({
    configure,
    startLookupAgent,
    selectLookup,
    lookupTextMatches,
    nearbyHiddenValues,
    hiddenCommitted,
    typeIntoInlineLookup,
    clickableLookupNode,
    ppmInstructionCanon
  });
})();
`;

let transformed = bodies.join('\n\n');

// Route content.js runtime references through configure().
transformed = transformed
  .replace(/\bstate\./g, 'C().state.')
  .replace(/\bTOP\b/g, 'C().TOP')
  .replace(/\bwaitForDom\b/g, 'C().waitForDom')
  .replace(/\bnearestControl\b/g, 'C().nearestControl')
  .replace(/\bclickTab\b/g, 'C().clickTab')
  .replace(/\bsetNativeValue\b/g, 'C().setNativeValue');

// Fix over-replacement in export names (none should match)

fs.writeFileSync(outPath, header + transformed + footer);
console.log(`Wrote ${outPath} (${LOOKUP_FUNCS.length} functions)`);
