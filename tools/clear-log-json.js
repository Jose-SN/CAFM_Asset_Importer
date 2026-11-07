'use strict';

/**
 * Reset repo log.json (saved diagnostic snapshot). Does not clear chrome.storage events.
 * Use the panel "Clear progress & diagnostic log" or "Clear session" for in-browser logs.
 *
 * Usage: node tools/clear-log-json.js [--delete]
 *   (default) writes {}
 *   --delete    removes log.json
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const logPath = path.join(root, 'log.json');
const deleteFile = process.argv.includes('--delete');

if (deleteFile) {
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
    console.log('Removed log.json');
  } else {
    console.log('log.json does not exist (nothing to delete)');
  }
} else {
  fs.writeFileSync(logPath, '{}\n', 'utf8');
  console.log('Reset log.json to {}');
}

console.log('Note: extension diagnostic events in the browser are unchanged.');
