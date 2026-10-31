'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MANIFEST_NAME_PREFIX = 'Engineering Efficiency Ltd - CAFM Asset Importer';

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
}

function replaceInFile(rel, replacements) {
  let text = read(rel);
  let changed = false;
  for (const [pattern, replacement] of replacements) {
    const next = text.replace(pattern, replacement);
    if (next !== text) {
      text = next;
      changed = true;
    }
  }
  if (changed) write(rel, text);
  return changed;
}

const manifest = JSON.parse(read('manifest.json'));
const version = String(manifest.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`manifest.json "version" must be semver like 8.0.50 (got "${version}")`);
  process.exit(1);
}

const changes = [];

const nextName = `${MANIFEST_NAME_PREFIX} v${version}`;
if (manifest.name !== nextName) {
  manifest.name = nextName;
  changes.push('manifest.json name');
}
if (manifest.action?.default_title !== nextName) {
  manifest.action.default_title = nextName;
  changes.push('manifest.json default_title');
}
if (changes.some((c) => c.startsWith('manifest'))) {
  write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
}

if (replaceInFile('src/core/constants.js', [
  [/VERSION:\s*'[^']+'/, `VERSION: '${version}'`]
])) changes.push('src/core/constants.js');

const versionTxt = `${version}\n`;
if (read('VERSION.txt') !== versionTxt) {
  write('VERSION.txt', versionTxt);
  changes.push('VERSION.txt');
}

if (replaceInFile('popup.html', [
  [/Engineering Efficiency Ltd \| v[\d.]+/, `Engineering Efficiency Ltd | v${version}`],
  [/<title>[^<]*<\/title>/, '<title>CAFM Asset Importer</title>'],
  [/<h1>[^<]*<\/h1>/, '<h1>CAFM Asset Importer</h1>']
])) changes.push('popup.html');

try {
  const log = JSON.parse(read('log.json'));
  if (log.extensionVersion !== version) {
    log.extensionVersion = version;
    write('log.json', `${JSON.stringify(log, null, 2)}\n`);
    changes.push('log.json extensionVersion');
  }
} catch (_) {
  console.warn('sync-version: log.json skipped (not valid JSON)');
}

try {
  const missing = JSON.parse(read('missing-asset-codes.json'));
  if (missing.extensionVersion !== version) {
    missing.extensionVersion = version;
    write('missing-asset-codes.json', `${JSON.stringify(missing, null, 2)}\n`);
    changes.push('missing-asset-codes.json extensionVersion');
  }
} catch (_) {
  console.warn('sync-version: missing-asset-codes.json skipped (not valid JSON)');
}

const constantsText = read('src/core/constants.js');
if (!constantsText.includes(`VERSION: '${version}'`)) {
  console.error('constants.js VERSION still out of sync after patch');
  process.exit(1);
}

if (changes.length) {
  console.log(`Synced extension version ${version}:\n` + changes.map((c) => `  - ${c}`).join('\n'));
} else {
  console.log(`Extension version ${version} already synced across tracked files.`);
}
