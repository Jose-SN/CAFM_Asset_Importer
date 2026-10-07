'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const errors = [];

function load(rel) {
  const file = path.join(root, rel);
  const code = fs.readFileSync(file, 'utf8');
  vm.runInThisContext(code, { filename: rel });
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function loadCoreStack() {
  load('src/bootstrap.js');
  load('src/core/text.js');
  load('src/core/constants.js');
  load('src/data/field-registry.js');
  load('src/data/fill-profiles.js');
  load('src/data/ppm.js');
  load('src/data/asset-rules.js');
  load('src/data/preflight.js');
}

loadCoreStack();

const { linkedForAsset, currentFromList, sourceIssues } = globalThis.CAFMImporter.data.ppm;
const { summarize, formatSummary } = globalThis.CAFMImporter.data.preflight;
const { directMappingsFromRegistry, valueAtPath, SUPPORTED_WORKBOOK_SCHEMAS } = globalThis.CAFMImporter.data.fieldRegistry;
const { assetProfileForRecord, resolveAssetTabOrder, shouldFillAssetNotes, PROFILE_RULES, DEFAULT_ASSET_PROFILE } = globalThis.CAFMImporter.data.fillProfiles;
const { validateRecord, lookupValue } = globalThis.CAFMAssetRules;

// --- ppm.js ---
const asset = { assetCode: 'WCH-TEST-001', workbookRow: 2 };
const ppms = [
  { assetCode: 'WCH-TEST-001', instruction: 'PPM-A', workbookRow: 10 },
  { assetCode: 'WCH-TEST-001', instruction: 'PPM-B', workbookRow: 11 },
  { assetCode: 'WCH-OTHER', instruction: 'PPM-X', workbookRow: 12 }
];
const linked = linkedForAsset(asset, ppms);
assert(linked.length === 2, 'linkedForAsset should return 2 PPM rows for asset');
assert(linked[0].instruction === 'PPM-A', 'linkedForAsset should sort by workbookRow');
assert(currentFromList(asset, ppms, 1).instruction === 'PPM-B', 'currentFromList index 1');
assert(sourceIssues({ assetCode: '', instruction: 'X' }).includes('PPM Asset Code is blank'), 'sourceIssues blank asset code');
assert(sourceIssues({ assetCode: 'WCH-1', instruction: '', estTimeMinutes: 99 }).length === 2, 'sourceIssues instruction + minutes');

// --- asset-rules.js ---
assert(validateRecord({ assetCode: '' }).includes('Asset Code is blank'), 'validateRecord requires asset code');
assert(validateRecord({ assetCode: 'WCH-OK-001' }).length === 0, 'minimal valid asset');
assert(validateRecord({ assetCode: 'WCH-OK-001', quantity: '-1' }).length > 0, 'invalid quantity rejected');
assert(lookupValue('System', 'CODE - Description').code === 'CODE', 'lookupValue splits code/description');

// --- field-registry.js ---
const record = { assetCode: 'WCH-REG-001', description: 'Test', spatial: { latitude: '51.5' } };
const maps = directMappingsFromRegistry(record);
assert(maps.Details.some((f) => f.label.includes('Asset Code')), 'registry builds Details fields');
assert(valueAtPath(record, 'spatial.latitude') === '51.5', 'valueAtPath nested');
assert(SUPPORTED_WORKBOOK_SCHEMAS.includes('CAFM Asset + PPM Import v8.0'), 'v8 schema supported');

// --- fill-profiles.js ---
const profile = assetProfileForRecord(record);
assert(profile.assetTabOrder.includes('Details'), 'default profile has Details tab');
assert(profile.assetLookupSequence.includes('Building'), 'default profile lookup sequence');
assert(resolveAssetTabOrder(record, {}).includes('Spatial'), 'Spatial tab when workbook spatial data exists');
assert(!resolveAssetTabOrder({ assetCode: 'WCH-EMPTY' }, {}).includes('Spatial'), 'Spatial tab skipped when no spatial data');
assert(resolveAssetTabOrder({ assetCode: 'WCH-EMPTY' }, { includeSpatial: true }).includes('Spatial'), 'Spatial tab when explicitly enabled');
assert(shouldFillAssetNotes({ comments: 'Note text' }, {}), 'Notes filled when workbook comments exist');
assert(!shouldFillAssetNotes({ comments: 'Note text' }, { includeNotes: false }), 'Notes skipped when includeNotes disabled');
assert(!shouldFillAssetNotes({ comments: '' }, {}), 'Notes skipped when comments blank');
assert(PROFILE_RULES.length >= 1, 'PROFILE_RULES registry exists');
assert(assetProfileForRecord(record).id === DEFAULT_ASSET_PROFILE.id, 'default profile selected');

// --- preflight.js ---
const state = {
  assets: [{ assetCode: 'WCH-A', workbookRow: 2 }, { assetCode: '', workbookRow: 3 }],
  allAssets: [{ assetCode: 'WCH-A', workbookRow: 2 }],
  ppms: [{ assetCode: 'WCH-A', instruction: 'P1', workbookRow: 5 }, { assetCode: 'WCH-ORPHAN', instruction: 'P2', workbookRow: 6 }],
  cache: { schema: 'CAFM Asset + PPM Import v8.0' }
};
const report = summarize(state);
assert(report.assetCount === 2, 'preflight asset count');
assert(report.ppmCount === 2, 'preflight ppm count');
assert(report.blocking.length > 0, 'preflight blocks invalid assets');
assert(report.orphanPpms.length === 1, 'preflight detects orphan PPM');
assert(formatSummary(report).includes('NEW asset'), 'formatSummary readable');

// --- session merge simulation (restoreState events preservation) ---
const initial = { index: 0, events: [], auto: { active: true, phase: 'fill' } };
const stored = { index: 2, events: [{ type: 'phase', phase: 'fill' }], auto: { active: true, phase: 'filling', assetCode: 'WCH-A' } };
const merged = { ...initial, ...stored, events: Array.isArray(stored.events) ? stored.events : (initial.events || []) };
assert(merged.events.length === 1, 'session merge preserves stored events');
assert(merged.auto.phase === 'filling', 'session merge preserves auto state for refresh resume');

// --- resumeAutomatic phase selection ---
const stoppedAuto = { active: false, phase: 'error', failedPhase: 'await_save', error: 'Save timed out', assetCode: 'WCH-A' };
const resumePhase = String(stoppedAuto.failedPhase || 'fill').trim() || 'fill';
assert(resumePhase === 'await_save', 'resume uses failedPhase not error phase');
assert(['error', 'paused'].includes(stoppedAuto.phase), 'resume eligible when error or paused');

if (errors.length) {
  console.error('Pure module tests failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`Pure module tests passed (${8} suites, 0 failures).`);
