'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scripts = manifest.content_scripts?.[0]?.js || [];
const index = Object.fromEntries(scripts.map((rel, i) => [rel, i]));

/** Each pair: dependency must appear before dependent in manifest. */
const RULES = [
  ['src/core/pages.js', 'src/core/lookup.js'],
  ['src/core/storage.js', 'src/core/lookup.js'],
  ['src/core/pages.js', 'src/core/toolbar.js'],
  ['src/core/lookup.js', 'src/core/toolbar.js'],
  ['src/core/storage.js', 'src/core/teach.js'],
  ['src/core/pages.js', 'src/data/workbook.js'],
  ['src/core/storage.js', 'src/data/workbook.js'],
  ['src/data/field-registry.js', 'src/pages/asset-mappings.js'],
  ['src/data/field-registry.js', 'src/data/fill-profiles.js'],
  ['src/pages/asset-mappings.js', 'src/ui/panel.js'],
  ['src/workflow/post-save.js', 'src/pages/asset-saved.js'],
  ['src/workflow/post-save.js', 'src/pages/ppm-status.js'],
  ['src/workflow/post-save.js', 'src/workflow/engine.js'],
  ['src/core/lookup.js', 'src/pages/ppm-register.js']
];

const errors = [];
for (const [before, after] of RULES) {
  if (!(before in index) || !(after in index)) {
    errors.push(`Missing manifest script in order check: ${before} or ${after}`);
    continue;
  }
  if (index[before] >= index[after]) {
    errors.push(`${after} must load after ${before} (got indices ${index[after]} <= ${index[before]})`);
  }
}

if (errors.length) {
  console.error('Manifest load-order verification failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`Manifest load order OK (${RULES.length} dependency rules, ${scripts.length} scripts).`);
