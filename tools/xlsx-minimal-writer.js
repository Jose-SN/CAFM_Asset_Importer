'use strict';

const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) { return Buffer.from([n & 0xff, (n >>> 8) & 0xff]); }
function u32(n) { return Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]); }

function zipStore(name, data, localHeaderOffset) {
  const nameBuf = Buffer.from(name, 'utf8');
  const compressed = zlib.deflateRawSync(data);
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8),
    u32(0), u32(crc32(data)), u32(compressed.length), u32(data.length),
    u16(nameBuf.length), u16(0), nameBuf, compressed
  ]);
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8),
    u32(0), u32(crc32(data)), u32(compressed.length), u32(data.length),
    u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(localHeaderOffset),
    nameBuf
  ]);
  return { local, central };
}

function buildZip(entries) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const { local, central } = zipStore(name, buf, offset);
    parts.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralStart = offset;
  for (const central of centrals) {
    parts.push(central);
    offset += central.length;
  }
  const centralSize = offset - centralStart;
  parts.push(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(centrals.length), u16(centrals.length),
    u32(centralSize), u32(centralStart), u16(0)
  ]));
  return Buffer.concat(parts);
}

function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineCell(col, row, value) {
  const ref = `${colLetter(col)}${row}`;
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(rows) {
  const rowXml = rows.map((cells, idx) => {
    const r = idx + 1;
    return `<row r="${r}">${cells.map((value, col) => inlineCell(col, r, value)).join('')}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function buildWorkbookXlsx(sheets) {
  const entries = [];
  const sheetEntries = sheets.map((sheet, i) => {
    const id = i + 1;
    entries.push([`xl/worksheets/sheet${id}.xml`, worksheetXml(sheet.rows)]);
    return { name: sheet.name, id };
  });

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetEntries.map((s) => `<sheet name="${escapeXml(s.name)}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join('')}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries.map((s) => `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`).join('')}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetEntries.map((s) => `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"/><fills count="1"/><borders count="1"/><cellStyleXfs count="1"/><cellXfs count="1"/></styleSheet>`;

  entries.unshift(['xl/styles.xml', styles]);
  entries.unshift(['xl/_rels/workbook.xml.rels', workbookRels]);
  entries.unshift(['xl/workbook.xml', workbookXml]);
  entries.unshift(['_rels/.rels', rootRels]);
  entries.unshift(['[Content_Types].xml', contentTypes]);

  return buildZip(entries);
}

module.exports = { buildWorkbookXlsx };
