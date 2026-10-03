'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scripts = manifest.content_scripts?.[0]?.js || [];
const errors = [];

for (const rel of scripts) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    errors.push(`Missing manifest script: ${rel}`);
    continue;
  }
  const buf = fs.readFileSync(abs);
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    errors.push(`${rel}: UTF-16 LE encoding (use UTF-8)`);
    continue;
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    errors.push(`${rel}: UTF-16 BE encoding (use UTF-8)`);
    continue;
  }
  try {
    execSync(`node --check "${abs}"`, { stdio: 'pipe' });
  } catch (error) {
    errors.push(`Syntax error in ${rel}: ${String(error.stderr || error.message).trim()}`);
  }
}

if (errors.length) {
  console.error('Module verification failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log(`Verified ${scripts.length} manifest scripts (syntax OK, files present).`);
