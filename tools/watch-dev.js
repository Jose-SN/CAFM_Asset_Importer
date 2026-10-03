'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const debounceMs = 400;
const pending = new Map();

const watchTargets = [
  path.join(root, 'src'),
  path.join(root, 'manifest.json'),
  path.join(root, 'background.js'),
  path.join(root, 'xlsx_reader.js'),
  path.join(root, 'asset_rules.js')
];

function remind(changed) {
  const rel = path.relative(root, changed) || changed;
  const time = new Date().toLocaleTimeString();
  console.log('');
  console.log(`[${time}] Changed: ${rel}`);
  console.log('  -> chrome://extensions  Reload extension');
  console.log('  -> F5 on open Concept Evolution tabs');
}

function schedule(file) {
  clearTimeout(pending.get(file));
  pending.set(file, setTimeout(() => {
    pending.delete(file);
    remind(file);
  }, debounceMs));
}

function watchPath(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    fs.watch(target, { recursive: true }, (_event, name) => {
      if (!name || name.includes('node_modules') || name.includes('.git')) return;
      schedule(path.join(target, name));
    });
    console.log(`Watching: ${path.relative(root, target)}\\`);
    return;
  }
  fs.watch(target, () => schedule(target));
  console.log(`Watching: ${path.relative(root, target)}`);
}

console.log('Dev watch running. Save a file to get reload instructions. Ctrl+C to stop.\n');
for (const target of watchTargets) watchPath(target);
