'use strict';

/**
 * Single source of truth: manifest.json "version".
 * Run via `node tools/sync-version-from-manifest.js` or automatically from verify-architecture.js.
 * When releasing: change only manifest.json "version", then run sync (or verify).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const MANIFEST_NAME_PREFIX = 'Engineering Efficiency Ltd - CAFM Asset + PPM Importer';

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
}

function syncVersionFromManifest(options = {}) {
  const quiet = Boolean(options.quiet);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(read('manifest.json'));
  const version = String(manifest.version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`manifest.json "version" must be semver like 8.0.49 (got "${version}")`);
  }

  const changes = [];

  const nextName = `${MANIFEST_NAME_PREFIX} v${version}`;
  if (manifest.name !== nextName) {
    manifest.name = nextName;
    changes.push(`manifest.json name → ${nextName}`);
  }

  if (typeof manifest.description === 'string' && /\bv\d+\.\d+\.\d+\b/.test(manifest.description)) {
    const nextDescription = manifest.description.replace(/\bv\d+\.\d+\.\d+\b/g, `v${version}`);
    if (nextDescription !== manifest.description) {
      manifest.description = nextDescription;
      changes.push('manifest.json description (version token)');
    }
  }

  const manifestSerialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (read('manifest.json') !== manifestSerialized) {
    fs.writeFileSync(manifestPath, manifestSerialized, 'utf8');
  }

  const versionTxt = `${version}\n`;
  if (read('VERSION.txt') !== versionTxt) {
    write('VERSION.txt', versionTxt);
    changes.push('VERSION.txt');
  }

  const logPath = 'log.json';
  try {
    const log = JSON.parse(read(logPath));
    if (log.extensionVersion !== version) {
      log.extensionVersion = version;
      write(logPath, `${JSON.stringify(log, null, 2)}\n`);
      changes.push('log.json extensionVersion');
    }
  } catch (_) {
    if (!quiet) {
      console.warn('sync-version: log.json skipped (not valid JSON template)');
    }
  }

  const constantsRel = 'src/core/constants.js';
  let constantsSrc = read(constantsRel);
  const fallbackRe = /return\s+'(\d+\.\d+\.\d+)';(\s*\/\/[^\n]*)?/;
  const nextConstants = constantsSrc.replace(
    fallbackRe,
    `return '${version}'; // fallback — auto-synced from manifest.json; run tools/sync-version-from-manifest.js`
  );
  if (nextConstants !== constantsSrc) {
    write(constantsRel, nextConstants);
    changes.push('src/core/constants.js fallback');
  }

  if (!quiet && changes.length) {
    console.log(`Version sync (${version}):\n` + changes.map((c) => `  - ${c}`).join('\n'));
  }
  return { version, changes };
}

if (require.main === module) {
  try {
    const { version, changes } = syncVersionFromManifest();
    if (!changes.length) {
      console.log(`Version ${version} — all derived files already in sync.`);
    }
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(1);
  }
}

module.exports = { syncVersionFromManifest, MANIFEST_NAME_PREFIX };
