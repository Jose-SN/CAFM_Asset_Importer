'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const logPath = path.join(root, 'log.json');
const templatePath = path.join(__dirname, 'log-json-template.json');

if (fs.existsSync(logPath)) {
  process.exit(0);
}

const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
const payload = {
  ...template,
  generatedAt: new Date().toISOString(),
  extensionVersion: (() => {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      return manifest.version || '';
    } catch (_) {
      return '';
    }
  })()
};

fs.writeFileSync(logPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log('Created log.json from template (file was missing).');
