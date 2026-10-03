(() => {
  'use strict';

  const CI = globalThis.CAFMImporter;
  if (!CI?.core?.constants) return;

  const { clean, norm } = CI.core.text;
  const {
    wait,
    visible,
    isAssistantElement,
    elementValue,
    dispatchClick,
    configureForm,
    waitForDom,
    nearestControl,
    clickTab,
    setNativeValue,
    tabContextReady,
    findSaveButton,
    validationMessage
  } = CI.core.dom;
  const { configure: configureEvents, addEvent } = CI.core.events;
  const {
    configure: configureWorkbook,
    persistSession,
    restoreState,
    loadWorkbookFile,
    counts,
    move,
    jumpToIndex,
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
    isHashPpmParentPage,
    isWorkflowPage
  } = CI.core.pages;
  const { runtimeMessage, storageGet, storageSet, storageRemove } = CI.core.storage;
  const ppmData = CI.data.ppm;
  const {
    configure: configureLookup,
    startLookupAgent,
    selectLookup,
    lookupTextMatches,
    nearbyHiddenValues,
    hiddenCommitted,
    typeIntoInlineLookup
  } = CI.core.lookup;

  const fillCurrentRecord = (...args) => CI.pages.assetNew.fillCurrentRecord(...args);
  const scheduleAuto = (...args) => CI.workflow.engine.scheduleAuto(...args);
  const startAutomatic = (...args) => CI.workflow.engine.startAutomatic(...args);
  const pauseAutomatic = (...args) => CI.workflow.engine.pauseAutomatic(...args);
  const resumeAutomatic = (...args) => CI.workflow.engine.resumeAutomatic(...args);
  const clickSaveTracked = (...args) => CI.workflow.postSave.clickSaveTracked(...args);
  const handlePostReloadSaveState = (...args) => CI.workflow.postSave.handlePostReloadSaveState(...args);
  const fillExistingSavedAsset = (...args) => CI.pages.assetManual.fillExistingSavedAsset(...args);
  const saveExistingAssetChanges = (...args) => CI.pages.assetManual.saveExistingAssetChanges(...args);
  const startPpmForCurrentPage = (...args) => CI.pages.ppmRegister.startPpmForCurrentPage(...args);
  const { configure: configurePanel, injectPanel, render, showToast } = CI.ui.panel;
  const { configure: configureToolbar } = CI.core.toolbar;
  const { configure: configureTeach, initTeachCapture } = CI.core.teach;
  const { configure: configureMessages, initMessageListeners } = CI.runtime.messages;
  const {
    configure: configureRecords,
    currentRecord,
    assetCodeOnPage,
    workflowAssetCodeOnPage,
    ppmRecordOnCurrentPage,
    workflowRecord,
    validateRecord
  } = CI.data.records;
  const { currentAssetStatusText, currentPpmStatusText } = CI.core.toolbar;

  const PAGE_INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const TOP = window.top === window.self;
  const state = CI.core.state.createInitialState();

  const isConceptHost = location.hostname.toLowerCase() === 'concept'
    || location.pathname.toLowerCase().includes('/evolution/');
  if (!isConceptHost) return;

  configureForm({ state });
  configureToolbar({ state, waitForDom, nearestControl });
  configureTeach({ state, TOP, storageGet, storageSet, storageRemove, runtimeMessage });
  initTeachCapture();
  configureLookup({ state, TOP, waitForDom, nearestControl, clickTab, setNativeValue });
  startLookupAgent();
  if (!TOP) return;

  function linkedPpms(record) {
    return ppmData.linkedForAsset(record, state.ppms);
  }

  function currentPpm(record = currentRecord()) {
    return ppmData.currentFromList(record, state.ppms, state.session.auto?.ppmIndex);
  }

  function ppmSourceIssues(ppm) {
    return ppmData.sourceIssues(ppm);
  }

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

  async function initTop() {
    await restoreState();
    configureRecords({ state, nearestControl });
    configureWorkbook({
      state, render, showToast, validateRecord, currentRecord, linkedPpms, workflowRecord,
      currentPpm, currentAssetStatusText, currentPpmStatusText, validationMessage, addEvent
    });
    configureEvents({ state, workflowRecord, currentRecord, persistSession, showToast });
    configureMessages({
      state, addEvent, storageGet, persistSession, render, scheduleAuto, isHashPpmParentPage,
      isAssetPage,
      assetEntityUrl: CI.core.pages.assetEntityUrl,
      entityIdFromUrl: CI.core.pages.entityIdFromUrl,
      isSavedAssetPage: CI.core.pages.isSavedAssetPage
    });
    initMessageListeners();

    if (!isWorkflowPage()) {
      if (state.session.auto?.active) scheduleAuto();
      return;
    }

    if (isAssetPage()) await runtimeMessage({ type: 'REGISTER_ASSET_TAB' });
    configurePanel({
      state, counts, validateRecord, currentRecord, statusOf, linkedPpms,
      assetCodeOnPage, ppmRecordOnCurrentPage, workflowAssetCodeOnPage,
      workflowRecord, currentPpm, validationMessage,
      loadWorkbookFile, fillCurrentRecord, clickSaveTracked, fillExistingSavedAsset,
      saveExistingAssetChanges, move, jumpToIndex, skipCurrent, markSavedAndNext,
      persistSession, storageSet, startPpmForCurrentPage,
      clickPpmNewToolbar: CI.pages.ppmRegister.clickPpmNewToolbar,
      startAutomatic, pauseAutomatic, resumeAutomatic, downloadLog, clearSession, downloadDiagnostic
    });
    injectPanel();
    render();
    if (isAssetPage()) await handlePostReloadSaveState();
    const autoObserver = new MutationObserver(() => {
      if (state.session.auto?.active) scheduleAuto();
    });
    try {
      autoObserver.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true
      });
    } catch (_) {}
    if (state.session.auto?.active) scheduleAuto();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initTop().catch(() => {}), { once: true });
  } else {
    initTop().catch(() => {});
  }
})();
