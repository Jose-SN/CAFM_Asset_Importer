'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildWorkbookXlsx } = require('./xlsx-minimal-writer');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'test-fixtures');

const IMPORT_HEADERS = ['Import?', 'Asset Code', 'Description', 'Building CAFM Value', 'Location Code'];
const PPM_HEADERS = ['Import?', 'Asset Code', 'Instruction', 'Contract', 'Last Service'];
const SCHEMA_ROW = ['Schema Version', 'CAFM Asset + PPM Import v8.0'];

function importSheet(assetRows) {
  return { name: 'CAFM Import', rows: [SCHEMA_ROW, IMPORT_HEADERS, ...assetRows] };
}

function ppmSheet(ppmRows) {
  return { name: 'CAFM PPM Import', rows: [PPM_HEADERS, ...ppmRows] };
}

const SCENARIOS = {
  1: {
    file: 'smoke-scenario-1-zero-ppm.xlsx',
    sheets: [
      importSheet([['YES', 'WCH-SMOKE-001', 'Smoke test asset zero PPM', '001 - Test Building', 'WCH-LOC-001']]),
      ppmSheet([])
    ]
  },
  2: {
    file: 'smoke-scenario-2-two-ppm.xlsx',
    sheets: [
      importSheet([['YES', 'WCH-SMOKE-002', 'Smoke test asset two PPM', '001 - Test Building', 'WCH-LOC-002']]),
      ppmSheet([
        ['YES', 'WCH-SMOKE-002', 'SMOKE-PPM-A', '', ''],
        ['YES', 'WCH-SMOKE-002', 'SMOKE-PPM-B', '', '']
      ])
    ]
  },
  3: {
    file: 'smoke-scenario-3-fire-door.xlsx',
    sheets: [
      importSheet([['YES', 'WCH-SMOKE-003', 'Smoke test fire-door PPM', '001 - Test Building', 'WCH-LOC-003']]),
      ppmSheet([
        ['YES', 'WCH-SMOKE-003', 'Fire door inspection - monthly', 'REPLACE-WITH-CONTRACT', '01/01/2025']
      ])
    ]
  }
};

async function validateWithReader(filePath) {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'xlsx_reader.js'), 'utf8'), { filename: 'xlsx_reader.js' });
  const buf = fs.readFileSync(filePath);
  const file = {
    name: path.basename(filePath),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  };
  return globalThis.CAFMXlsx.readWorkbook(file);
}

async function writeScenario(id) {
  const scenario = SCENARIOS[id];
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  const target = path.join(outDir, scenario.file);
  fs.writeFileSync(target, buildWorkbookXlsx(scenario.sheets));
  const parsed = await validateWithReader(target);
  return { target, parsed };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const ids = process.argv.slice(2).length
    ? process.argv.slice(2).map((arg) => Number(String(arg).replace(/\D/g, '')))
    : [1, 2, 3];

  for (const id of ids) {
    const { target, parsed } = await writeScenario(id);
    console.log(`Scenario ${id}: ${path.relative(root, target)}`);
    console.log(`  assets=${parsed.assets.length} ppms=${parsed.ppms.length} schema=${parsed.schema || 'default'}`);
  }
  console.log('\nAdd live CAFM Contract/lookup values before running scenarios 2-3 on Concept Evolution.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
