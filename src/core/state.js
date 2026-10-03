(() => {
  'use strict';

  const root = globalThis.CAFMImporter;
  const { DEFAULT_SETTINGS } = root.core.constants;

  function createInitialState() {
    return {
      assets: [],
      allAssets: [],
      ppms: [],
      cache: null,
      session: {
        fileName: '',
        fileSize: 0,
        fileModified: 0,
        index: 0,
        statuses: {},
        newEntityUrl: '',
        auto: null,
        manualAwaitSave: null,
        currentLookupEvidence: [],
        events: []
      },
      settings: { ...DEFAULT_SETTINGS },
      host: null,
      shadow: null,
      els: {},
      busy: false,
      lookupAgentBusy: false,
      lookupTimer: null,
      autoTimer: null,
      learnedStatus: null,
      learnedNew: null,
      teachStatusArmed: false,
      teachNewArmed: false,
      legacyClickTimes: Object.create(null),
      lastLoggedPhase: ''
    };
  }

  root.core = root.core || {};
  root.core.state = Object.freeze({ createInitialState });
})();
