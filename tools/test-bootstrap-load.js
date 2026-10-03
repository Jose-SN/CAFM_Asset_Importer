'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function load(rel) {
  const file = path.join(root, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: rel });
}

// Minimal browser surface for module IIFEs that reference globals at load time.
globalThis.document = {
  readyState: 'complete',
  documentElement: {},
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => ({ attachShadow: () => ({ innerHTML: '', getElementById: () => null }) })
};
globalThis.window = globalThis;
globalThis.location = { hostname: 'concept', pathname: '/Evolution/', href: 'http://concept/' };
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.chrome = {
  runtime: { onMessage: { addListener: () => {} }, sendMessage: () => Promise.resolve({}) },
  storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve({}), remove: () => Promise.resolve({}) } }
};
globalThis.indexedDB = undefined;

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const skip = new Set(['src/content-entry.js', 'xlsx_reader.js']);

for (const rel of manifest.content_scripts[0].js) {
  if (skip.has(rel)) continue;
  try {
    load(rel);
  } catch (error) {
    errors.push(`${rel}: ${error.message.split('\n')[0]}`);
  }
}

const CI = globalThis.CAFMImporter;
assert(CI, 'CAFMImporter namespace missing after bootstrap load');

const namespaces = [
  ['core.constants', CI?.core?.constants],
  ['core.state.createInitialState', typeof CI?.core?.state?.createInitialState === 'function'],
  ['core.dom.configureForm', typeof CI?.core?.dom?.configureForm === 'function'],
  ['core.lookup.configure', typeof CI?.core?.lookup?.configure === 'function'],
  ['core.pages.isAssetPage', typeof CI?.core?.pages?.isAssetPage === 'function'],
  ['core.storage.storageGet', typeof CI?.core?.storage?.storageGet === 'function'],
  ['data.ppm.linkedForAsset', typeof CI?.data?.ppm?.linkedForAsset === 'function'],
  ['data.workbook.persistSession', typeof CI?.data?.workbook?.persistSession === 'function'],
  ['data.preflight.summarize', typeof CI?.data?.preflight?.summarize === 'function'],
  ['data.fieldRegistry.ASSET_DIRECT_FIELDS', Array.isArray(CI?.data?.fieldRegistry?.ASSET_DIRECT_FIELDS)],
  ['data.fillProfiles.assetProfileForRecord', typeof CI?.data?.fillProfiles?.assetProfileForRecord === 'function'],
  ['pages.registry.PAGE_HANDLERS', Array.isArray(CI?.pages?.registry?.PAGE_HANDLERS)],
  ['pages.assetNew.fillCurrentRecord', typeof CI?.pages?.assetNew?.fillCurrentRecord === 'function'],
  ['pages.assetSaved.processActivationPage', typeof CI?.pages?.assetSaved?.processActivationPage === 'function'],
  ['pages.ppmRegister.processPpmListPage', typeof CI?.pages?.ppmRegister?.processPpmListPage === 'function'],
  ['pages.ppmEditor.processPpmItemPage', typeof CI?.pages?.ppmEditor?.processPpmItemPage === 'function'],
  ['pages.ppmStatus.processPpmStatusPage', typeof CI?.pages?.ppmStatus?.processPpmStatusPage === 'function'],
  ['workflow.engine.runAutomatic', typeof CI?.workflow?.engine?.runAutomatic === 'function'],
  ['workflow.postSave.beginPostSave', typeof CI?.workflow?.postSave?.beginPostSave === 'function'],
  ['ui.panel.injectPanel', typeof CI?.ui?.panel?.injectPanel === 'function'],
  ['runtime.host.bind', typeof CI?.runtime?.bind === 'function'],
  ['runtime.messages.configure', typeof CI?.runtime?.messages?.configure === 'function']
];

for (const [name, ok] of namespaces) {
  assert(ok, `Missing export: ${name}`);
}

assert(globalThis.CAFMAssetRules?.validateRecord, 'CAFMAssetRules.validateRecord missing');

const handlerMap = {
  fillCurrentRecord: CI?.pages?.assetNew,
  processActivationPage: CI?.pages?.assetSaved,
  processPpmListPage: CI?.pages?.ppmRegister,
  processPpmItemPage: CI?.pages?.ppmEditor,
  processPpmStatusPage: CI?.pages?.ppmStatus
};

for (const entry of CI?.pages?.registry?.PAGE_HANDLERS || []) {
  const mod = handlerMap[entry.handler];
  assert(typeof mod?.[entry.handler] === 'function', `Registry handler not wired: ${entry.id} → ${entry.handler}`);
}

if (errors.length) {
  console.error('Bootstrap load test failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`Bootstrap load test passed (${manifest.content_scripts[0].js.length - skip.size} modules, ${CI.pages.registry.PAGE_HANDLERS.length} page handlers).`);
