'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'content.js');
let src = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');

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
  const {
    wait,
    visible,
    isAssistantElement,
    elementValue,
    dispatchClick,
    configureForm,
    waitForDom,
    labelElements,
    allVisibleControls,
    nearestControl,
    clickTab,
    setNativeValue,
    fillByLabel,
    tabContextReady,
    nearestCheckbox,
    setCheckboxByLabel,
    setSelectByLabel,
    findSaveButton,
    validationMessage
  } = CI.core.dom;
  const { configure: configureEvents, addEvent, recordValidationWarning } = CI.core.events;
  const {
    configure: configureWorkbook,
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
  } = CI.data.workbook;
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
  const {
    configure: configureLookup,
    startLookupAgent,
    selectLookup,
    lookupTextMatches,
    nearbyHiddenValues,
    hiddenCommitted,
    typeIntoInlineLookup,
    clickableLookupNode
  } = CI.core.lookup;

  const lookupMapping = (...args) => CI.pages.assetMappings.lookupMapping(...args);
  const directMappings = (...args) => CI.pages.assetMappings.directMappings(...args);
  const valueEquivalent = (...args) => CI.pages.assetMappings.valueEquivalent(...args);
  const fillAssetFieldsByTab = (...args) => CI.pages.assetNew.fillAssetFieldsByTab(...args);
  const verifyBeforeSave = (...args) => CI.pages.assetNew.verifyBeforeSave(...args);
  const fillCurrentRecord = (...args) => CI.pages.assetNew.fillCurrentRecord(...args);
  const scheduleAuto = (...args) => CI.workflow.engine.scheduleAuto(...args);
  const runAutomatic = (...args) => CI.workflow.engine.runAutomatic(...args);
  const startAutomatic = (...args) => CI.workflow.engine.startAutomatic(...args);
  const pauseAutomatic = (...args) => CI.workflow.engine.pauseAutomatic(...args);
  const stopAutomaticWithError = (...args) => CI.workflow.engine.stopAutomaticWithError(...args);
  const beginPostSave = (...args) => CI.workflow.postSave.beginPostSave(...args);
  const finishPostSave = (...args) => CI.workflow.postSave.finishPostSave(...args);
  const clickSaveTracked = (...args) => CI.workflow.postSave.clickSaveTracked(...args);
  const handlePostReloadSaveState = (...args) => CI.workflow.postSave.handlePostReloadSaveState(...args);
  const processActivationPage = (...args) => CI.pages.assetSaved.processActivationPage(...args);
  const fillExistingSavedAsset = (...args) => CI.pages.assetManual.fillExistingSavedAsset(...args);
  const saveExistingAssetChanges = (...args) => CI.pages.assetManual.saveExistingAssetChanges(...args);
  const startPpmForCurrentPage = (...args) => CI.pages.ppmRegister.startPpmForCurrentPage(...args);
  const fillEstimatedTime = (...args) => CI.pages.ppmEditor.fillEstimatedTime(...args);
  const { configure: configureMessages, initMessageListeners } = CI.runtime.messages;
  const {
    configure: configurePanel,
    injectPanel,
    render,
    showToast
  } = CI.ui.panel;
  const {
    ppmActivationTarget,
    processPpmStatusPage,
    recordPpmResult
  } = CI.pages.ppmStatus;
  const {
    configure: configureToolbar,
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
  } = CI.core.toolbar;
  const { configure: configureTeach, initTeachCapture } = CI.core.teach;
  const {
    configure: configureRecords,
    currentRecord,
    assetCodeOnPage,
    workflowAssetCodeOnPage,
    recordByAssetCode,
    ppmRecordOnCurrentPage,
    workflowRecord,
    recordForCurrentSavedAsset,
    validateRecord
  } = CI.data.records;

  const PAGE_INSTANCE = \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
  const TOP = window.top === window.self;

`;

src = src.replace(/^(\uFEFF?)\(\(\) => \{\s*'use strict';[\s\S]*?const state = \{/m, `${header}  const state = {`);

const NL = '\\r?\\n';

src = src.replace(
  /\r?\n  const isConceptHost =[^\n]+\r?\n  if \(!isConceptHost\) return;/,
  "\n  const isConceptHost = location.hostname.toLowerCase() === 'concept' || location.pathname.toLowerCase().includes('/evolution/');\n  if (!isConceptHost) return;\n  configureForm({ state });\n  configureToolbar({ state, waitForDom, nearestControl });\n  configureTeach({ state, TOP, storageGet, storageSet, storageRemove, runtimeMessage });\n  initTeachCapture();"
);

src = src.replace(
  /(\r?\n  configureForm\(\{ state \}\);\r?\n  configureToolbar\(\{ state, waitForDom, nearestControl \}\);\r?\n  configureTeach\(\{ state, TOP, storageGet, storageSet, storageRemove, runtimeMessage \}\);\r?\n  initTeachCapture\(\);)+/g,
  '\n  configureForm({ state });\n  configureToolbar({ state, waitForDom, nearestControl });\n  configureTeach({ state, TOP, storageGet, storageSet, storageRemove, runtimeMessage });\n  initTeachCapture();'
);

src = src.replace(
  new RegExp(`${NL}  function norm\\([\\s\\S]*?function deriveNewEntityUrl\\([\\s\\S]*?\\}${NL}${NL}  function elementValue\\(`, 'm'),
  '\n  function fieldCandidates('
);

src = src.replace(
  /\r?\n  function linkedPpms\(record\) \{[\s\S]*?\r?\n  \}\r?\n\r?\n  function currentPpm/m,
  `\n  function linkedPpms(record) {\n    return ppmData.linkedForAsset(record, state.ppms);\n  }\n\n  function currentPpm`
);
src = src.replace(
  /\r?\n  function currentPpm\(record = currentRecord\(\)\) \{[\s\S]*?\r?\n  \}\r?\n\r?\n  function ppmSourceIssues/m,
  `\n  function currentPpm(record = currentRecord()) {\n    return ppmData.currentFromList(record, state.ppms, state.session.auto?.ppmIndex);\n  }\n\n  function ppmSourceIssues`
);

src = src.replace(
  /\r?\n  function ppmSourceIssues\(ppm\) \{[\s\S]*?\r?\n  \}\r?\n\r?\n  function fillEstimatedTime/m,
  `\n  function ppmSourceIssues(ppm) {\n    return ppmData.sourceIssues(ppm);\n  }\n\n  function fillEstimatedTime`
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
  'lookupMapping', 'directMappings', 'valueEquivalent',
  'fillAssetFieldsByTab', 'verifyBeforeSave', 'fillCurrentRecord',
  'startAutomatic', 'pauseAutomatic', 'scheduleAuto', 'stopAutomaticWithError',
  'beginPostSave', 'finishPostSave', 'afterActivation', 'processActivationPage', 'runAutomatic',
  'ppmDirectMapping', 'ppmLookupMapping', 'fillPpmFields', 'fillPpmLookups', 'fillFireDoorPpmExact', 'validatePpmPageBeforeSave',
  'findLearnedPpmNewButton', 'ppmNewTextNodeFallback', 'findNewButton', 'ppmToolbarButtonState', 'exactPpmNewButton', 'exactPpmRefreshButton',
  'clickPpmNewToolbar', 'ppmInstructionCanon', 'ppmListContainsCurrent', 'ppmListEntityId', 'processPpmListPage', 'processPpmItemPage',
  'clickableLookupNode', 'findLookupTrigger', 'nearbyHiddenValues', 'hiddenCommitted', 'lookupTextMatches', 'lookupScore',
  'explicitLookupSurfaces', 'optionCandidates', 'findLookupSearchInput', 'findSearchButton', 'lookupGridSignature',
  'submitLookupSearch', 'bestClickableForOption', 'updatePendingLookup', 'handlePendingLookup', 'scheduleLookupAgent',
  'startLookupAgent', 'keyboardEvent', 'setFocusedInputValue', 'typeIntoInlineLookup', 'inlineOptionCandidates',
  'waitForInlineOptions', 'lookupCommitFingerprint', 'fingerprintChanged', 'commitInlineSelectionWithKeyboard',
  'waitForCommittedLookup', 'selectInlineComboLookup', 'selectLookup',
  'ppmActivationTarget', 'beginPpmActivationQueue', 'completePpmActivation', 'processPpmStatusPage', 'recordPpmResult',
  'escapeHtml', 'statusClass', 'showToast', 'render', 'makeDraggable', 'injectPanel',
  'waitForDom', 'fieldCandidates', 'allVisibleControls', 'nearestControl', 'setNativeValue',
  'tabContextReady', 'clickTab', 'fillByLabel', 'nearestCheckbox', 'setCheckboxByLabel',
  'setSelectByLabel', 'findSaveButton', 'validationMessage', 'addEvent', 'recordValidationWarning',
  'persistSession', 'restoreState', 'loadWorkbookFile', 'counts', 'move', 'skipCurrent',
  'markSavedAndNext', 'clearSession', 'csvCell', 'downloadLog', 'downloadDiagnostic',
  'setStatus', 'statusOf', 'nextPendingIndex',
  'dispatchLegacySingleClick', 'cssEsc', 'uniqueInDocument', 'cssPathForElement', 'clickFingerprint', 'bestClickedNode',
  'observedAssetCode', 'currentAssetStatusText', 'assetIsActive', 'toolbarActionClue', 'topAssetToolbarCandidates',
  'findToolbarPrintButton', 'findToolbarCloseButton', 'sameOriginDocuments', 'elementFromLearnedFingerprint',
  'findLearnedStatusButton', 'findChangeAssetStatusButton', 'currentPpmStatusText', 'ppmIsActive',
  'topPpmToolbarCandidates', 'findChangePpmStatusButton', 'findChangePpmStatusDialog', 'findChangeAssetStatusDialog',
  'findConfirmButton', 'statusActiveOptionCandidates', 'selectActiveFromStatusDropdown', 'findAssetPpmNavLink',
  'currentRecord', 'assetCodeOnPage', 'workflowAssetCodeOnPage', 'recordByAssetCode', 'ppmRecordOnCurrentPage',
  'workflowRecord', 'recordForCurrentSavedAsset', 'validateRecord',
  'fillEstimatedTime', 'startPpmForCurrentPage', 'fillDirectFields', 'fillDropdowns',
  'fillExistingSavedAsset', 'saveExistingAssetChanges', 'clickSaveTracked', 'handlePostReloadSaveState'
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
  /\r?\n  \/\/ Teach mode:[\s\S]*?\}, true\);\r?\n/g,
  '\n'
);

function removeMessageListener(code) {
  const start = code.indexOf('chrome.runtime.onMessage.addListener');
  if (start < 0) {
    const orphan = code.indexOf("message.type === 'EE_PPM_CHILD_DONE'");
    if (orphan < 0) return code;
    const bind = code.indexOf('CI.runtime.bind({', orphan);
    if (bind < 0) return code;
    return code.slice(0, code.lastIndexOf('\n', orphan)) + '\n' + code.slice(bind);
  }
  let depth = 0;
  let i = start;
  while (i < code.length) {
    if (code.startsWith('addListener(', i) || code[i] === '(') depth += 1;
    if (code[i] === ')') {
      depth -= 1;
      if (depth === 0 && code.slice(i, i + 3) === ');') {
        i += 3;
        break;
      }
    }
    i += 1;
  }
  return code.slice(0, code.lastIndexOf('\n', start)) + code.slice(i);
}

src = removeMessageListener(src);

// Remove any prior bind block + PPM wrappers (idempotent re-patch).
src = src.replace(/\r?\n  CI\.runtime\.bind\(\{[\s\S]*?\}\);\r?\n/g, '\n');
src = src.replace(
  /\r?\n  const processPpmListPage = \(\.\.\.args\) => CI\.pages\.ppmRegister\.processPpmListPage\(\.\.\.args\);\r?\n  const processPpmItemPage = \(\.\.\.args\) => CI\.pages\.ppmEditor\.processPpmItemPage\(\.\.\.args\);\r?\n  const findNewButton = \(\.\.\.args\) => CI\.pages\.ppmRegister\.findNewButton\(\.\.\.args\);\r?\n  const clickPpmNewToolbar = \(\.\.\.args\) => CI\.pages\.ppmRegister\.clickPpmNewToolbar\(\.\.\.args\);\r?\n/g,
  '\n'
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
    addEvent: CI.core.events.addEvent,
    persistSession: CI.data.workbook.persistSession,
    scheduleAuto: CI.workflow.engine.scheduleAuto,
    finishPostSave: CI.workflow.postSave.finishPostSave,
    currentPpm,
    currentRecord: CI.data.records.currentRecord,
    runtimeMessage,
    sameOriginDocuments: CI.core.toolbar.sameOriginDocuments,
    elementFromLearnedFingerprint: CI.core.toolbar.elementFromLearnedFingerprint,
    clickTab: CI.core.dom.clickTab,
    fillByLabel: CI.core.dom.fillByLabel,
    setCheckboxByLabel: CI.core.dom.setCheckboxByLabel,
    setSelectByLabel: CI.core.dom.setSelectByLabel,
    fillEstimatedTime: CI.pages.ppmEditor.fillEstimatedTime,
    setNativeValue: CI.core.dom.setNativeValue,
    selectLookup,
    nearestControl: CI.core.dom.nearestControl,
    lookupTextMatches,
    nearbyHiddenValues,
    hiddenCommitted,
    findSaveButton: CI.core.dom.findSaveButton,
    validationMessage: CI.core.dom.validationMessage,
    ppmSourceIssues,
    linkedPpms,
    setStatus: CI.data.workbook.setStatus,
    workflowRecord: CI.data.records.workflowRecord,
    statusOf: CI.data.workbook.statusOf,
    nextPendingIndex: CI.data.workbook.nextPendingIndex,
    observedAssetCode: CI.core.toolbar.observedAssetCode,
    currentAssetStatusText: CI.core.toolbar.currentAssetStatusText,
    assetIsActive: CI.core.toolbar.assetIsActive,
    findAssetPpmNavLink: CI.core.toolbar.findAssetPpmNavLink,
    findChangeAssetStatusDialog: CI.core.toolbar.findChangeAssetStatusDialog,
    findConfirmButton: CI.core.toolbar.findConfirmButton,
    selectActiveFromStatusDropdown: CI.core.toolbar.selectActiveFromStatusDropdown,
    typeIntoInlineLookup,
    processPpmStatusPage: CI.pages.ppmStatus.processPpmStatusPage,
    ppmActivationTarget: CI.pages.ppmStatus.ppmActivationTarget,
    recordPpmResult: CI.pages.ppmStatus.recordPpmResult,
    ppmIsActive: CI.core.toolbar.ppmIsActive,
    currentPpmStatusText: CI.core.toolbar.currentPpmStatusText,
    findChangePpmStatusButton: CI.core.toolbar.findChangePpmStatusButton,
    findChangePpmStatusDialog: CI.core.toolbar.findChangePpmStatusDialog,
    findChangeAssetStatusButton: CI.core.toolbar.findChangeAssetStatusButton,
    clickSaveTracked: CI.workflow.postSave.clickSaveTracked,
    tabContextReady: CI.core.dom.tabContextReady,
    recordValidationWarning: CI.core.events.recordValidationWarning,
    dispatchLegacySingleClick: CI.core.toolbar.dispatchLegacySingleClick,
    render: CI.ui.panel.render,
    showToast: CI.ui.panel.showToast
  });

  const processPpmListPage = (...args) => CI.pages.ppmRegister.processPpmListPage(...args);
  const processPpmItemPage = (...args) => CI.pages.ppmEditor.processPpmItemPage(...args);
  const findNewButton = (...args) => CI.pages.ppmRegister.findNewButton(...args);
  const clickPpmNewToolbar = (...args) => CI.pages.ppmRegister.clickPpmNewToolbar(...args);

`;

src = src.replace(
  /\r?\n  configureLookup\(\{ state, TOP, waitForDom, nearestControl, clickTab, setNativeValue \}\);\r?\n/g,
  '\n'
);
src = src.replace(
  /\r?\n  startLookupAgent\(\);\r?\n  if \(!TOP\) return;/,
  `\n  configureLookup({ state, TOP, waitForDom, nearestControl, clickTab, setNativeValue });\n  startLookupAgent();\n  if (!TOP) return;\n  configureMessages({ state, addEvent, storageGet, persistSession, render, scheduleAuto, isHashPpmParentPage });\n  initMessageListeners();`
);

src = src.replace(/\r?\n  async function initTop\(/, `${bindBlock}  async function initTop(`);

if (!src.includes('configureRecords({')) {
  src = src.replace(
    /await restoreState\(\);\r?\n    configureWorkbook\(\{/,
    `await restoreState();
    configureRecords({ state, nearestControl });
    configureWorkbook({`
  );
}

if (!src.includes('configureWorkbook({')) {
  src = src.replace(
    /await restoreState\(\);\r?\n    configurePanel\(\{/,
    `    await restoreState();
    configureRecords({ state, nearestControl });
    configureWorkbook({
      state, render, showToast, validateRecord, currentRecord, linkedPpms, workflowRecord,
      currentPpm, currentAssetStatusText, currentPpmStatusText, validationMessage, addEvent
    });
    configureEvents({ state, workflowRecord, currentRecord, persistSession, showToast });
    configurePanel({`
  );
}

fs.writeFileSync(target, src);
console.log('Patched content.js successfully');
