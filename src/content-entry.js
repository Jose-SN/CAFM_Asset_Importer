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
    downloadAssetTimeline,
    setStatus,
    statusOf,
    nextPendingIndex
  } = CI.data.workbook;
  const {
    isAssetPage,
    entityIdFromUrl,
    isAssetListPage,
    isPanelPage,
    isWorkflowPage
  } = CI.core.pages;
  const { runtimeMessage, storageGet, storageSet, storageRemove } = CI.core.storage;
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
  const runAutomatic = (...args) => CI.workflow.engine.runAutomatic(...args);
  const startAutomatic = (...args) => CI.workflow.engine.startAutomatic(...args);
  const pauseAutomatic = (...args) => CI.workflow.engine.pauseAutomatic(...args);
  const resumeAutomatic = (...args) => CI.workflow.engine.resumeAutomatic(...args);
  const clickSaveTracked = (...args) => CI.workflow.postSave.clickSaveTracked(...args);
  const handlePostReloadSaveState = (...args) => CI.workflow.postSave.handlePostReloadSaveState(...args);
  const fillExistingSavedAsset = (...args) => CI.pages.assetManual.fillExistingSavedAsset(...args);
  const saveExistingAssetChanges = (...args) => CI.pages.assetManual.saveExistingAssetChanges(...args);
  const { configure: configurePanel, injectPanel, render, showToast, showActivity, showFieldFill, showWorkflowStatus } = CI.ui.panel;
  const { configure: configureToolbar } = CI.core.toolbar;
  const { configure: configureTeach, initTeachCapture } = CI.core.teach;
  const { configure: configureMessages, initMessageListeners } = CI.runtime.messages;
  const {
    configure: configureRecords,
    currentRecord,
    assetCodeOnPage,
    workflowAssetCodeOnPage,
    workflowRecord,
    validateRecord
  } = CI.data.records;
  const { currentAssetStatusText } = CI.core.toolbar;

  const PAGE_INSTANCE = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const TOP = window.top === window.self;
  const state = CI.core.state.createInitialState();
  state.showActivity = (...args) => CI.ui.panel.showActivity(...args);
  state.showFieldFill = (...args) => CI.ui.panel.showFieldFill(...args);

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

  function linkedPpms() {
    return [];
  }

  function currentPpm() {
    return null;
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
    setNativeValue: CI.core.dom.setNativeValue,
    selectLookup,
    nearestControl: CI.core.dom.nearestControl,
    lookupTextMatches,
    nearbyHiddenValues,
    hiddenCommitted,
    findSaveButton: CI.core.dom.findSaveButton,
    clickSaveAndClose: CI.core.dom.clickSaveAndClose,
    clickSaveAndNew: CI.core.dom.clickSaveAndNew,
    validationMessage: CI.core.dom.validationMessage,
    linkedPpms,
    setStatus: CI.data.workbook.setStatus,
    workflowRecord: CI.data.records.workflowRecord,
    statusOf: CI.data.workbook.statusOf,
    nextPendingIndex: CI.data.workbook.nextPendingIndex,
    observedAssetCode: CI.core.toolbar.observedAssetCode,
    currentAssetStatusText: CI.core.toolbar.currentAssetStatusText,
    assetIsActive: CI.core.toolbar.assetIsActive,
    findChangeAssetStatusDialog: CI.core.toolbar.findChangeAssetStatusDialog,
    findConfirmButton: CI.core.toolbar.findConfirmButton,
    selectActiveFromStatusDropdown: CI.core.toolbar.selectActiveFromStatusDropdown,
    typeIntoInlineLookup,
    findChangeAssetStatusButton: CI.core.toolbar.findChangeAssetStatusButton,
    clickSaveTracked: CI.workflow.postSave.clickSaveTracked,
    tabContextReady: CI.core.dom.tabContextReady,
    recordValidationWarning: CI.core.events.recordValidationWarning,
    dispatchLegacySingleClick: CI.core.toolbar.dispatchLegacySingleClick,
    render: CI.ui.panel.render,
    showToast: CI.ui.panel.showToast,
    showActivity: CI.ui.panel.showActivity,
    showWorkflowStatus: CI.ui.panel.showWorkflowStatus,
    showFieldFill: CI.ui.panel.showFieldFill,
    downloadAssetTimeline: CI.data.workbook.downloadAssetTimeline
  });

  function reportInitFailure(error) {
    const message = clean(error?.message || error || 'Importer failed to start.');
    console.error('[CAFM Importer]', error);
    try { showToast(`Importer failed to start: ${message}`, 'error', 14000); } catch (_) {}
  }

  async function initTop() {
    configureRecords({ state, nearestControl });
    configureWorkbook({
      state, render, showToast, showActivity, validateRecord, currentRecord, linkedPpms, workflowRecord,
      currentPpm, currentAssetStatusText, validationMessage, addEvent
    });
    configureEvents({ state, workflowRecord, currentRecord, persistSession, showToast });
    configureMessages({
      state, addEvent, storageGet, persistSession, render, scheduleAuto, runAutomatic,
      isAssetPage,
      assetEntityUrl: CI.core.pages.assetEntityUrl,
      entityIdFromUrl: CI.core.pages.entityIdFromUrl,
      isSavedAssetPage: CI.core.pages.isSavedAssetPage,
      workflowRecord: CI.data.records.workflowRecord,
      showActivity: CI.ui.panel.showActivity
    });
    initMessageListeners();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.session.auto?.active) {
        scheduleAuto(0);
        try {
          chrome.runtime.sendMessage({ type: 'AUTO_ORCHESTRATOR_SYNC' }).catch(() => {});
        } catch (_) {}
      }
    }, { passive: true });

    let restoreError = null;
    try {
      await restoreState();
    } catch (error) {
      restoreError = error;
    }

    if (!isPanelPage()) {
      if (state.session.auto?.active) scheduleAuto();
      return;
    }

    configurePanel({
      state, counts, validateRecord, currentRecord, statusOf, linkedPpms, currentPpm, nextPendingIndex,
      assetCodeOnPage, workflowAssetCodeOnPage, ppmRecordOnCurrentPage: () => null,
      workflowRecord, validationMessage,
      loadWorkbookFile, fillCurrentRecord, clickSaveTracked, fillExistingSavedAsset,
      saveExistingAssetChanges, move, jumpToIndex, skipCurrent, markSavedAndNext,
      persistSession, storageSet,
      startAutomatic, pauseAutomatic, resumeAutomatic, downloadLog, clearSession, downloadDiagnostic
    });
    injectPanel();
    render();
    if (restoreError) reportInitFailure(restoreError);

    if (!isWorkflowPage()) return;

    if (isAssetPage() || isAssetListPage()) await runtimeMessage({ type: 'REGISTER_ASSET_TAB' });
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
    document.addEventListener('DOMContentLoaded', () => initTop().catch(reportInitFailure), { once: true });
  } else {
    initTop().catch(reportInitFailure);
  }
})();
