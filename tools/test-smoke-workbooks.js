'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const fixturesDir = path.join(root, 'test-fixtures');
const errors = [];

const EXPECTED = {
  'smoke-scenario-1-zero-ppm.xlsx': { assets: 1, ppms: 0 },
  'smoke-scenario-2-two-ppm.xlsx': { assets: 1, ppms: 2 },
  'smoke-scenario-3-fire-door.xlsx': { assets: 1, ppms: 1 }
};

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function loadReader() {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'xlsx_reader.js'), 'utf8'), { filename: 'xlsx_reader.js' });
}

async function parseFixture(name) {
  const filePath = path.join(fixturesDir, name);
  const buf = fs.readFileSync(filePath);
  const file = {
    name,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  };
  return globalThis.CAFMXlsx.readWorkbook(file);
}

async function main() {
  const missing = Object.keys(EXPECTED).filter((name) => !fs.existsSync(path.join(fixturesDir, name)));
  if (missing.length) {
    execSync('node tools/generate-smoke-workbook.js', { cwd: root, stdio: 'inherit' });
  }

  loadReader();
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const parsed = await parseFixture(name);
    assert(parsed.assets.length === expected.assets, `${name}: expected ${expected.assets} asset(s), got ${parsed.assets.length}`);
    assert(parsed.ppms.length === expected.ppms, `${name}: expected ${expected.ppms} PPM(s), got ${parsed.ppms.length}`);
    assert(parsed.schema === 'CAFM Asset + PPM Import v8.0', `${name}: schema should be v8.0`);
    assert(parsed.assets[0]?.assetCode?.startsWith('WCH-SMOKE-'), `${name}: asset code should be WCH-SMOKE-*`);
  }

  if (errors.length) {
    console.error('Smoke workbook tests failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }

  console.log(`Smoke workbook tests passed (${Object.keys(EXPECTED).length} fixtures validated).`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
