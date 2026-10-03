'use strict';

const fs = require('fs');
const path = require('path');

const contentPath = path.join(__dirname, '..', 'content.js');
const domPath = path.join(__dirname, '..', 'src', 'core', 'dom.js');

const FORM_FUNCS = [
  'waitForDom',
  'allVisibleControls',
  'nearestControl',
  'setNativeValue',
  'tabContextReady',
  'clickTab',
  'fillByLabel',
  'nearestCheckbox',
  'setCheckboxByLabel',
  'setSelectByLabel',
  'findSaveButton',
  'validationMessage'
];

function extractFunction(code, name) {
  const re = new RegExp(`^  (async )?function ${name}\\([\\s\\S]*?\\)\\s*\\{`, 'm');
  const match = re.exec(code);
  if (!match) throw new Error(`Function not found: ${name}`);
  const start = match.index;
  const bodyStart = match.index + match[0].length - 1;
  let depth = 0;
  let i = bodyStart;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    i += 1;
  }
  return code.slice(start, i).replace(/^  /gm, '').trimEnd();
}

function extractLabelFieldCandidates(code) {
  const re = /^  function fieldCandidates\(labelNames, root = document\) \{[\s\S]*?\n  \}/m;
  const match = re.exec(code);
  if (!match) throw new Error('fieldCandidates(labelNames) not found');
  return match[0].replace(/^  /gm, '').replace('function fieldCandidates(labelNames', 'function labelElements(labelNames');
}

const content = fs.readFileSync(contentPath, 'utf8');
const labelElements = extractLabelFieldCandidates(content);
const bodies = FORM_FUNCS.map((name) => extractFunction(content, name));

let transformed = [labelElements, ...bodies].join('\n\n');
transformed = transformed
  .replace(/\bfieldCandidates\(/g, 'labelElements(')
  .replace(/\bstate\.settings/g, 'cfg.state.settings')
  .replace(/\bwait\b/g, 'wait')
  .replace(/\bvisible\b/g, 'visible')
  .replace(/\bisAssistantElement\b/g, 'isAssistantElement')
  .replace(/\bdispatchClick\b/g, 'dispatchClick')
  .replace(/\bclean\b/g, 'clean')
  .replace(/\bnorm\b/g, 'norm');

const base = fs.readFileSync(domPath, 'utf8');
const insertMarker = /  root\.core\.dom = Object\.freeze\(\{[\s\S]*?\}\);/;
const extended = base.replace(
  insertMarker,
  `  let cfg = null;
  function configureForm(deps) { cfg = Object.freeze({ ...deps }); }
  function formCfg() {
    if (!cfg) throw new Error('CAFMImporter dom form helpers are not configured yet.');
    return cfg;
  }

${transformed.replace(/cfg\.state/g, 'formCfg().state')}

  root.core.dom = Object.freeze({
    wait,
    visible,
    isAssistantElement,
    elementValue,
    dispatchClick,
    configureForm,
    waitForDom,
    labelElements,
    allVisibleControls,
    nearestControl,
    setNativeValue,
    tabContextReady,
    clickTab,
    fillByLabel,
    nearestCheckbox,
    setCheckboxByLabel,
    setSelectByLabel,
    findSaveButton,
    validationMessage
  });`
);

fs.writeFileSync(domPath, extended);
console.log(`Extended ${domPath}`);
