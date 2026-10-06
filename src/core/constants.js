(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  root.core = root.core || {};

  root.core.constants = Object.freeze({
    VERSION: '8.0.30',
    HOST_ID: 'ee-cafm-asset-importer-host',
    STORAGE: Object.freeze({
      session: 'eeAssetImporterV80Session',
      settings: 'eeAssetImporterV80Settings',
      pendingLookup: 'eeAssetImporterV80PendingLookup',
      statusLearnRequest: 'eeAssetImporterV58StatusLearnRequest',
      learnedStatus: 'eeAssetImporterV58LearnedStatus',
      newLearnRequest: 'eeAssetImporterV69NewLearnRequest',
      learnedNew: 'eeAssetImporterV69LearnedNew'
    }),
    LARGE_KEY: 'eeAssetImporterV80Workbook',
    DEFAULT_SETTINGS: Object.freeze({
      lookupTimeoutMs: 20000,
      saveTimeoutMs: 20000,
      backgroundSaveTimeoutMs: 90000,
      lookupCommitTimeoutMs: 8000,
      ppmChildTimeoutMs: 15000,
      backgroundOrchestrator: true,
      skipInvalidRows: false,
      stopOnLookupError: true,
      panelX: null,
      panelY: 76,
      collapsed: false,
      includeNotes: false,
      includeSpatial: false,
      iterationEnabled: false,
      iterationCount: 1,
      autoDownloadTimeline: false,
      autoContinueNext: true,
      useSaveAndNew: true,
      backgroundOrchestratorMs: 2500
    }),
    assetPagePattern: /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItem\.aspx/i,
    assetListPagePattern: /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItems\.aspx/i,
    ppmListPagePattern: /\/Evolution\/!System\/Asset\/FASSET\/ViewFASSETItemPPMs\.aspx/i,
    ppmItemPagePattern: /\/Evolution\/!System\/PPMs\/FPPM\/ViewFPPMItem\.aspx/i
  });
})();
