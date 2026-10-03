'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'content.js');
let src = fs.readFileSync(target, 'utf8');

const header = `(() => {
  'use strict';

  const CI = globalThis.CAFMImporter;
  if (!CI?.core?.constants) return;

  const {
    VERSION,
    HOST_ID,
    STORAGE,
    DEFAULT_SETTINGS
  } = CI.core.constants;
  const { clean, norm, uniqueNonBlank, uniqueId } = CI.core.text;
  const { wait, visible, isAssistantElement, elementValue, dispatchClick } = CI.core.dom;
  const {
    isAssetPage,
    entityIdFromUrl,
    isNewEntityPage,
    isSavedAssetPage,
    isPpmListPage,
    isHashPpmParentPage,
    isPpmItemPage,
    isPpmNewEntityPage,
    isWorkflowPage,
    assetEntityUrl,
    ppmListUrl,
    ppmEntityUrl,
    isSavedPpmPage,
    deriveNewEntityUrl
  } = CI.core.pages;
  const {
    runtimeMessage,
    storageGet,
    storageSet,
    storageRemove,
    saveLargeWorkbook,
    loadLargeWorkbook,
    clearLargeWorkbook
  } = CI.core.storage;
  const { WAITING_PHASES } = CI.workflow.phases;
  const ppmData = CI.data.ppm;
  const { splitLookupValue, buildingNumber, makeLookupSpec } = CI.core.lookupSpec;

  const PAGE_INSTANCE = \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
  const TOP = window.top === window.self;

`;

src = src.replace(/^\(\(\) => \{\s*'use strict';[\s\S]*?const state = \{/m, `${header}  const state = {`);

const NL = '\\r?\\n';

src = src.replace(
  new RegExp(`${NL}  const assetPagePattern =[\\s\\S]*?if \\(!isConceptHost\\) return;${NL}${NL}  function wait\\(ms\\) \\{[\\s\\S]*?\\}${NL}${NL}${NL}  function waitForDom`, 'm'),
  "\n  const isConceptHost = location.hostname.toLowerCase() === 'concept' || location.pathname.toLowerCase().includes('/evolution/');\n  if (!isConceptHost) return;\n\n  function waitForDom"
);

src = src.replace(
  new RegExp(`${NL}  function norm\\([\\s\\S]*?function deriveNewEntityUrl\\([\\s\\S]*?\\}${NL}${NL}  function elementValue\\(`, 'm'),
  '\n  function fieldCandidates('
);

src = src.replace(
  /\n  function linkedPpms\(record\) \{[\s\S]*?\n  \}\n\n  function currentPpm/m,
  `\n  function linkedPpms(record) {\n    return ppmData.linkedForAsset(record, state.ppms);\n  }\n\n  function currentPpm`
);

src = src.replace(
  /\n  function currentPpm\(record = currentRecord\(\)\) \{[\s\S]*?\n  \}\n\n  function ppmSourceIssues/m,
  `\n  function currentPpm(record = currentRecord()) {\n    return ppmData.currentFromList(record, state.ppms, state.session.auto?.ppmIndex);\n  }\n\n  function ppmSourceIssues`
);

src = src.replace(
  /\n  function ppmSourceIssues\(ppm\) \{[\s\S]*?\n  \}\n\n  function nearestCheckbox/m,
  `\n  function ppmSourceIssues(ppm) {\n    return ppmData.sourceIssues(ppm);\n  }\n\n  function nearestCheckbox`
);

src = src.replace(
  new RegExp(`${NL}  function splitLookupValue\\([\\s\\S]*?function lookupMapping`, 'm'),
  '\n  function lookupMapping'
);

src = src.replace(
  new RegExp(`${NL}  function dispatchClick\\([\\s\\S]*?\\/\\/ Legacy toolbar actions`, 'm'),
  '\n  // Legacy toolbar actions'
);

src = src.replace(
  new RegExp(`${NL}  function isAssistantElement\\([\\s\\S]*?function explicitLookupSurfaces`, 'm'),
  '\n  function explicitLookupSurfaces'
);

const removeFuncs = new Set([
  'ppmDirectMapping', 'ppmLookupMapping', 'fillPpmFields', 'fillPpmLookups', 'fillFireDoorPpmExact', 'validatePpmPageBeforeSave',
  'findLearnedPpmNewButton', 'ppmNewTextNodeFallback', 'findNewButton', 'ppmToolbarButtonState', 'exactPpmNewButton', 'exactPpmRefreshButton',
  'clickPpmNewToolbar', 'ppmInstructionCanon', 'ppmListContainsCurrent', 'ppmListEntityId', 'processPpmListPage', 'processPpmItemPage'
]);

function removeNamedFunctions(code) {
  const lines = code.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^  (async )?function ([A-Za-z0-9_]+)/);
    if (m && removeFuncs.has(m[2])) {
      let depth = 0;
      let started = false;
      while (i < lines.length) {
        const line = lines[i];
        for (const ch of line) {
          if (ch === '{') { depth += 1; started = true; }
          if (ch === '}') depth -= 1;
        }
        i += 1;
        if (started && depth === 0) break;
      }
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n');
}

src = removeNamedFunctions(src);

src = src.replace(
  /const waitingPhases = new Set\([\s\S]*?\);\r?\n    const watchdogMs = waitingPhases\.has\(phase\)/,
  'const watchdogMs = WAITING_PHASES.has(phase)'
);

const bindBlock = `
  CI.runtime.bind({
    state,
    PAGE_INSTANCE,
    clean,
    norm,
    wait,
    visible,
    isAssistantElement,
    elementValue,
    dispatchClick,
    addEvent,
    persistSession,
    scheduleAuto,
    finishPostSave,
    recordPpmResult,
    currentPpm,
    currentRecord,
    runtimeMessage,
    render,
    showToast,
    sameOriginDocuments,
    elementFromLearnedFingerprint,
    clickTab,
    fillByLabel,
    setCheckboxByLabel,
    setSelectByLabel,
    fillEstimatedTime,
    setNativeValue,
    selectLookup,
    nearestControl,
    lookupTextMatches,
    nearbyHiddenValues,
    hiddenCommitted,
    findSaveButton,
    validationMessage,
    ppmSourceIssues
  });

  const processPpmListPage = (...args) => CI.pages.ppmRegister.processPpmListPage(...args);
  const processPpmItemPage = (...args) => CI.pages.ppmEditor.processPpmItemPage(...args);
  const findNewButton = (...args) => CI.pages.ppmRegister.findNewButton(...args);
  const clickPpmNewToolbar = (...args) => CI.pages.ppmRegister.clickPpmNewToolbar(...args);

`;

src = src.replace(/\r?\n  async function initTop\(/, `${bindBlock}  async function initTop(`);

fs.writeFileSync(target, src);
console.log('Patched content.js successfully');
