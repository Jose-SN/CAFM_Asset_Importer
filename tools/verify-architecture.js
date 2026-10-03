'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const errors = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const manifest = JSON.parse(read('manifest.json'));
const scripts = manifest.content_scripts?.[0]?.js || [];

for (const rel of scripts) {
  if (!fs.existsSync(path.join(root, rel))) errors.push(`Missing script: ${rel}`);
}

const requiredNamespaces = [
  ['src/bootstrap.js', 'globalThis.CAFMImporter'],
  ['src/runtime/host.js', 'bind(bindings)'],
  ['src/pages/registry.js', 'PAGE_HANDLERS'],
  ['src/pages/asset-new.js', 'fillCurrentRecord'],
  ['src/pages/asset-saved.js', 'processActivationPage'],
  ['src/pages/ppm-register.js', 'processPpmListPage'],
  ['src/pages/ppm-editor.js', 'processPpmItemPage'],
  ['src/pages/ppm-status.js', 'processPpmStatusPage'],
  ['src/workflow/engine.js', 'runAutomatic'],
  ['src/data/field-registry.js', 'ASSET_DIRECT_FIELDS'],
  ['src/data/preflight.js', 'summarize'],
  ['src/data/asset-rules.js', 'CAFMAssetRules'],
  ['src/content-entry.js', 'CI.runtime.bind']
];

for (const [file, needle] of requiredNamespaces) {
  const text = read(file);
  if (!text.includes(needle)) errors.push(`${file} missing expected export/symbol: ${needle}`);
}

const knownPhases = new Set([
  'navigate', 'fill', 'filling', 'saving', 'await_save', 'activate_open', 'activate_select',
  'activate_confirm', 'activate_wait', 'activate_wait_user', 'ppm_open_list', 'ppm_wait_new',
  'ppm_wait_user_new', 'ppm_fill', 'ppm_await_save', 'ppm_status_open', 'ppm_status_select',
  'ppm_status_confirm', 'ppm_status_wait', 'ppm_status_wait_user', 'ppm_child_closing',
  'ppm_parent_refresh_wait', 'ppm_parent_refresh', 'ppm_next', 'complete', 'paused', 'error'
]);

const phaseMatches = read('src/workflow/engine.js')
  .match(/phase:\s*'([^']+)'|phase === '([^']+)'/g) || [];
for (const match of phaseMatches) {
  const phase = match.replace(/.*'([^']+)'.*/, '$1');
  if (phase && !knownPhases.has(phase) && !phase.startsWith('ppm_') && !phase.startsWith('activate_')) {
    warnings.push(`Unlisted phase reference in engine.js: ${phase}`);
  }
}

const registry = read('src/pages/registry.js');
const handlers = ['processActivationPage', 'processPpmListPage', 'processPpmItemPage', 'processPpmStatusPage', 'fillCurrentRecord'];
for (const handler of handlers) {
  if (!registry.includes(handler)) errors.push(`registry.js missing handler reference: ${handler}`);
}

if (errors.length) {
  console.error('Architecture verification failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

if (warnings.length) {
  console.warn('Architecture warnings:\n' + warnings.map((w) => `  - ${w}`).join('\n'));
}

console.log(`Architecture OK (${scripts.length} manifest scripts, ${handlers.length} page handlers wired).`);
