(() => {
  'use strict';

  const textDecoder = new TextDecoder('utf-8');

  function readUInt16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUInt32(view, offset) {
    return view.getUint32(offset, true);
  }

  function normalisePath(path) {
    const parts = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }

  class ZipArchive {
    constructor(buffer) {
      this.buffer = buffer;
      this.view = new DataView(buffer);
      this.entries = new Map();
      this._readCentralDirectory();
    }

    _findEndOfCentralDirectory() {
      const minimum = Math.max(0, this.buffer.byteLength - 65557);
      for (let offset = this.buffer.byteLength - 22; offset >= minimum; offset -= 1) {
        if (readUInt32(this.view, offset) === 0x06054b50) return offset;
      }
      throw new Error('The selected file is not a valid XLSX/ZIP file.');
    }

    _readCentralDirectory() {
      const eocd = this._findEndOfCentralDirectory();
      const totalEntries = readUInt16(this.view, eocd + 10);
      const centralOffset = readUInt32(this.view, eocd + 16);
      let offset = centralOffset;

      for (let i = 0; i < totalEntries; i += 1) {
        if (readUInt32(this.view, offset) !== 0x02014b50) {
          throw new Error('Unable to read the XLSX central directory.');
        }
        const flags = readUInt16(this.view, offset + 8);
        const method = readUInt16(this.view, offset + 10);
        const compressedSize = readUInt32(this.view, offset + 20);
        const uncompressedSize = readUInt32(this.view, offset + 24);
        const fileNameLength = readUInt16(this.view, offset + 28);
        const extraLength = readUInt16(this.view, offset + 30);
        const commentLength = readUInt16(this.view, offset + 32);
        const localHeaderOffset = readUInt32(this.view, offset + 42);
        const nameBytes = new Uint8Array(this.buffer, offset + 46, fileNameLength);
        const name = textDecoder.decode(nameBytes);
        this.entries.set(normalisePath(name), {
          flags,
          method,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
        });
        offset += 46 + fileNameLength + extraLength + commentLength;
      }
    }

    has(name) {
      return this.entries.has(normalisePath(name));
    }

    async getBytes(name) {
      const key = normalisePath(name);
      const entry = this.entries.get(key);
      if (!entry) throw new Error(`Missing XLSX entry: ${key}`);
      const offset = entry.localHeaderOffset;
      if (readUInt32(this.view, offset) !== 0x04034b50) {
        throw new Error(`Invalid local ZIP header for ${key}`);
      }
      const fileNameLength = readUInt16(this.view, offset + 26);
      const extraLength = readUInt16(this.view, offset + 28);
      const dataOffset = offset + 30 + fileNameLength + extraLength;
      const compressed = new Uint8Array(this.buffer, dataOffset, entry.compressedSize);

      if (entry.method === 0) return new Uint8Array(compressed);
      if (entry.method !== 8) {
        throw new Error(`Unsupported XLSX compression method ${entry.method}.`);
      }
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This Chrome/Edge version cannot decompress XLSX files. Please update the browser.');
      }
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    async getText(name) {
      // Accept standard OOXML with or without an element namespace prefix.
      // Relationship attributes (r:id) are preserved for sheet resolution.
      return textDecoder.decode(await this.getBytes(name)).replace(/(<\/?)[A-Za-z_][\w.-]*:/g, '$1');
    }
  }

  function decodeXml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function parseAttributes(raw) {
    const attrs = Object.create(null);
    const re = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = re.exec(raw)) !== null) {
      attrs[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
    }
    return attrs;
  }

  function columnNumber(cellReference) {
    const letters = String(cellReference || '').match(/[A-Z]+/i)?.[0]?.toUpperCase() || '';
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return n;
  }

  function xmlTextFromRichText(fragment) {
    const pieces = [];
    const textRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let match;
    while ((match = textRe.exec(fragment)) !== null) pieces.push(decodeXml(match[1]));
    return pieces.join('');
  }

  function parseSharedStrings(xml) {
    const strings = [];
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let match;
    while ((match = re.exec(xml)) !== null) strings.push(xmlTextFromRichText(match[1]));
    return strings;
  }

  function getCellValue(attrs, body, sharedStrings) {
    if (!body) return '';
    if (attrs.t === 'inlineStr') {
      const isMatch = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      return isMatch ? xmlTextFromRichText(isMatch[1]) : '';
    }
    const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
    if (!valueMatch) {
      const textMatch = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      return textMatch ? decodeXml(textMatch[1]) : '';
    }
    const raw = decodeXml(valueMatch[1]);
    if (attrs.t === 's') return sharedStrings[Number(raw)] ?? '';
    if (attrs.t === 'str') return raw;
    if (attrs.t === 'b') return raw === '1';
    if (attrs.t === 'e') throw new Error(`Excel error in ${attrs.r || 'a cell'}: ${raw}. Correct the workbook and save it again.`);
    if (raw === '') return '';
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }

  function parseWorksheet(xml, sharedStrings, wantedColumns = null) {
    const rows = [];
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(xml)) !== null) {
      const rowAttrs = parseAttributes(rowMatch[1]);
      const rowNo = Number(rowAttrs.r || rows.length + 1);
      const cells = new Map();
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[2])) !== null) {
        const attrs = parseAttributes(cellMatch[1]);
        const column = columnNumber(attrs.r);
        if (!column || (wantedColumns && !wantedColumns.has(column))) continue;
        cells.set(column, getCellValue(attrs, cellMatch[2] || '', sharedStrings));
      }
      rows.push({ rowNo, cells });
    }
    return rows;
  }

  function findSheetRelationshipId(workbookXml, sheetName) {
    const sheetRe = /<sheet\b([^>]*)\/?\s*>/g;
    let match;
    while ((match = sheetRe.exec(workbookXml)) !== null) {
      const attrs = parseAttributes(match[1]);
      if (String(attrs.name || '').trim().toLowerCase() === sheetName.toLowerCase()) {
        return attrs['r:id'];
      }
    }
    throw new Error(`The workbook does not contain a '${sheetName}' sheet.`);
  }

  function relationshipTarget(relsXml, relationshipId) {
    const relRe = /<Relationship\b([^>]*)\/?\s*>/g;
    let match;
    while ((match = relRe.exec(relsXml)) !== null) {
      const attrs = parseAttributes(match[1]);
      if (attrs.Id === relationshipId) return attrs.Target;
    }
    throw new Error(`Unable to locate worksheet relationship ${relationshipId}.`);
  }

  async function sheetXml(zip, workbookXml, relsXml, sheetName) {
    const rid = findSheetRelationshipId(workbookXml, sheetName);
    const target = relationshipTarget(relsXml, rid);
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    return zip.getText(normalisePath(path));
  }

  function rowToObject(row, headers) {
    const output = Object.create(null);
    for (const [column, header] of headers.entries()) {
      if (!header) continue;
      output[String(header).trim()] = row.cells.get(column) ?? '';
    }
    output.__rowNumber = row.rowNo;
    return output;
  }

  function trimValue(value) {
    if (value == null) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return String(value).replace(/\u0000/g, '').trim();
  }

  function excelDate(value) {
    if (value === '' || value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Math.round(value * 86400000));
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function parseAssetLocation(locationText, assetCode, barcode) {
    const text = String(locationText || '').trim();
    const codeMatch = text.match(/\((WCH-[^)]+)\)\s*$/i);
    const locationCode = (codeMatch?.[1] || barcode || '').trim();
    const buildingMatch = text.match(/\bWCH-\d+(?:-[A-Z])?\b/i);
    let buildingCode = buildingMatch?.[0] || '';
    if (!buildingCode && assetCode) {
      const m = String(assetCode).match(/^(WCH-\d+(?:-[A-Z])?)/i);
      buildingCode = m?.[1] || '';
    }

    const floorNames = [
      'Basement Level 2', 'Basement Level 1', 'Ground Floor', 'First Floor',
      'Second Floor', 'Third Floor', 'Fourth Floor', 'Fifth Floor'
    ];
    const floor = floorNames.find((name) => text.toLowerCase().includes(` - ${name.toLowerCase()} - `)) || '';
    const withoutRoomCode = codeMatch
      ? text.slice(0, codeMatch.index).replace(/\s*-\s*$/, '').trim()
      : text;
    let buildingFull = '';
    let locationDescription = '';
    if (floor) {
      const marker = ` - ${floor} - `;
      const markerIndex = withoutRoomCode.toLowerCase().lastIndexOf(marker.toLowerCase());
      if (markerIndex >= 0) {
        buildingFull = withoutRoomCode.slice(0, markerIndex).trim();
        locationDescription = withoutRoomCode.slice(markerIndex + marker.length).trim();
      }
    }
    if (!buildingFull && buildingCode) {
      const position = withoutRoomCode.toLowerCase().indexOf(buildingCode.toLowerCase());
      if (position >= 0) buildingFull = withoutRoomCode.slice(0, position + buildingCode.length).trim();
    }

    return {
      locationCode,
      buildingCode,
      fullLocation: text,
      buildingFull,
      floor,
      locationDescription,
    };
  }

  function buildingNameFromFull(value, buildingCode) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (buildingCode) {
      const position = text.toLowerCase().indexOf(String(buildingCode).toLowerCase());
      if (position >= 0) {
        const tail = text.slice(position + String(buildingCode).length).replace(/^\s*-\s*/, '').trim();
        if (tail) return tail;
      }
    }
    const parts = text.split(/\s+-\s+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : text;
  }

  function numericText(value) {
    if (value === '' || value == null) return '';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
    return String(value).trim();
  }

  function normalizeHeader(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function readSchemaVersionRow(rows) {
    for (const row of rows.slice(0, 8)) {
      const entries = [...row.cells.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
      for (let i = 0; i < entries.length - 1; i += 1) {
        const label = normalizeHeader(entries[i][1]);
        if (label === 'schema version' || label === 'workbook schema') {
          const value = trimValue(entries[i + 1][1]);
          if (value) return value;
        }
      }
    }
    return '';
  }

  function findImportHeaderRow(rows) {
    for (const row of rows.slice(0, 25)) {
      const values = [...row.cells.values()].map(normalizeHeader);
      const hasAsset = values.includes('asset code');
      const hasBuilding = values.includes('building cafm value') || values.includes('building code');
      const hasLocation = values.includes('location code');
      if (hasAsset && hasBuilding && hasLocation) return row;
    }
    throw new Error("The 'CAFM Import' sheet headers were not recognised. Keep the supplied header names unchanged.");
  }

  function valueByAliases(object, aliases) {
    const byNormal = new Map(Object.entries(object).map(([key, value]) => [normalizeHeader(key), value]));
    for (const alias of aliases) {
      const value = byNormal.get(normalizeHeader(alias));
      if (value !== undefined && value !== null) return value;
    }
    return '';
  }

  function enabledForImport(value) {
    const text = normalizeHeader(value);
    return text === 'yes';
  }

  function splitBuildingDisplay(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/^\s*(\d{1,3})\s*[-:]\s*(.+)$/);
    return {
      listCode: match ? String(Number(match[1])).padStart(3, '0') : '',
      name: match ? match[2].trim() : ''
    };
  }

  function splitLookupDisplay(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const separator = text.indexOf(' - ');
    if (separator <= 0) return { full: text, code: '', description: text };
    return {
      full: text,
      code: text.slice(0, separator).trim(),
      description: text.slice(separator + 3).trim()
    };
  }


  function yesNo(value) {
    const text = normalizeHeader(value);
    if (!text) return null;
    if (['yes', 'y', 'true', '1', 'checked'].includes(text)) return true;
    if (['no', 'n', 'false', '0', 'unchecked'].includes(text)) return false;
    return null;
  }

  async function optionalSheetXml(zip, workbookXml, relsXml, sheetName) {
    try { return await sheetXml(zip, workbookXml, relsXml, sheetName); }
    catch (_) { return ''; }
  }

  function findPpmHeaderRow(rows) {
    for (const row of rows.slice(0, 25)) {
      const values = [...row.cells.values()].map(normalizeHeader);
      if (values.includes('asset code') && values.includes('instruction') && values.includes('import?')) return row;
    }
    throw new Error("The 'CAFM PPM Import' sheet headers were not recognised. Keep the supplied header names unchanged.");
  }

  function parsePpmRows(rows, assetByWorkbookRow = new Map()) {
    if (!rows.length) return { ppms: [], excludedRows: 0 };
    const headerRow = findPpmHeaderRow(rows);
    const headers = headerRow.cells;
    const ppms = [];
    let excludedRows = 0;
    for (const row of rows) {
      if (row.rowNo <= headerRow.rowNo) continue;
      const obj = rowToObject(row, headers);
      const explicitAssetCode = String(valueByAliases(obj, ['Asset Code']) || '').trim();
      const sameRowAsset = assetByWorkbookRow.get(row.rowNo) || null;
      const assetCode = explicitAssetCode || String(sameRowAsset?.assetCode || '').trim();
      const instruction = trimValue(valueByAliases(obj, ['Instruction', 'PPM Instruction']));
      const importFlag = valueByAliases(obj, ['Import?', 'Import', 'Include?']);
      if (!assetCode && !instruction) continue;
      if (!enabledForImport(importFlag)) { excludedRows += 1; continue; }
      if (!assetCode) throw new Error(`PPM row ${row.rowNo} is marked YES but no enabled asset exists on the matching CAFM Import row.`);
      if (!instruction) throw new Error(`PPM row ${row.rowNo} is marked YES but Instruction is blank.`);
      const key = trimValue(valueByAliases(obj, ['PPM Key', 'Key'])) || `${assetCode}|${instruction}|${row.rowNo}`;
      ppms.push({
        workbookRow: row.rowNo,
        ppmKey: String(key),
        assetCode,
        assetLinkMode: explicitAssetCode ? 'asset-code' : 'same-row-auto',
        family: trimValue(valueByAliases(obj, ['Family'])),
        instruction,
        stockCost: numericText(valueByAliases(obj, ['Stock Cost'])),
        labourCost: numericText(valueByAliases(obj, ['Labour Cost'])),
        estTimeHours: numericText(valueByAliases(obj, ['Est. Time Hours', 'Estimated Time Hours'])),
        estTimeMinutes: numericText(valueByAliases(obj, ['Est. Time Minutes', 'Estimated Time Minutes'])),
        estStaff: numericText(valueByAliases(obj, ['Est. Staff', 'Estimated Staff'])),
        permit: yesNo(valueByAliases(obj, ['Permit?', 'Permit'])),
        healthSafetyTask: yesNo(valueByAliases(obj, ['H&S Task?', 'H & S Task', 'Health & Safety Task'])),
        costCentre: trimValue(valueByAliases(obj, ['Cost Centre'])),
        contract: trimValue(valueByAliases(obj, ['Contract'])),
        disciplineExpected: trimValue(valueByAliases(obj, ['Discipline (Expected)', 'Discipline'])),
        priority: trimValue(valueByAliases(obj, ['Priority'])),
        shift: trimValue(valueByAliases(obj, ['Shift'])),
        compliance: trimValue(valueByAliases(obj, ['Compliance'])),
        costCode: trimValue(valueByAliases(obj, ['Cost Code'])),
        controller: yesNo(valueByAliases(obj, ['Controller?', 'Controller'])),
        classValue: trimValue(valueByAliases(obj, ['Class', 'PPM Class'])),
        actionBeforeComplete: yesNo(valueByAliases(obj, ['Action before Task complete?', 'Action before Task complete'])),
        actionBeforeSignoff: yesNo(valueByAliases(obj, ['Action before Task sign off?', 'Action before Task sign off'])),
        generateTaskActions: trimValue(valueByAliases(obj, ['Generate Task Actions'])),
        lastService: excelDate(valueByAliases(obj, ['Last Service'])),
        nextService: excelDate(valueByAliases(obj, ['Next Service'])),
        defaultDay: trimValue(valueByAliases(obj, ['Default Day'])),
        period: numericText(valueByAliases(obj, ['Period'])),
        frequency: trimValue(valueByAliases(obj, ['Frequency', 'PPM Frequency'])),
        months: {
          January: yesNo(valueByAliases(obj, ['January'])), February: yesNo(valueByAliases(obj, ['February'])),
          March: yesNo(valueByAliases(obj, ['March'])), April: yesNo(valueByAliases(obj, ['April'])),
          May: yesNo(valueByAliases(obj, ['May'])), June: yesNo(valueByAliases(obj, ['June'])),
          July: yesNo(valueByAliases(obj, ['July'])), August: yesNo(valueByAliases(obj, ['August'])),
          September: yesNo(valueByAliases(obj, ['September'])), October: yesNo(valueByAliases(obj, ['October'])),
          November: yesNo(valueByAliases(obj, ['November'])), December: yesNo(valueByAliases(obj, ['December']))
        },
        notes: trimValue(valueByAliases(obj, ['Notes', 'PPM Notes'])),
        activateAfterSave: yesNo(valueByAliases(obj, ['Activate after Save?', 'Activate after Save', 'Activate?', 'Set Active?']))
      });
    }
    return { ppms, excludedRows, headerRow: headerRow.rowNo };
  }

  async function readWorkbook(file) {
    const buffer = await file.arrayBuffer();
    const zip = new ZipArchive(buffer);
    const workbookXml = await zip.getText('xl/workbook.xml');
    const relsXml = await zip.getText('xl/_rels/workbook.xml.rels');
    const sharedStrings = zip.has('xl/sharedStrings.xml')
      ? parseSharedStrings(await zip.getText('xl/sharedStrings.xml'))
      : [];

    const importXml = await sheetXml(zip, workbookXml, relsXml, 'CAFM Import');
    const rows = parseWorksheet(importXml, sharedStrings, null);
    const schemaFromWorkbook = readSchemaVersionRow(rows);
    const headerRow = findImportHeaderRow(rows);
    const headers = headerRow.cells;
    const ppmXml = await optionalSheetXml(zip, workbookXml, relsXml, 'CAFM PPM Import');
    const ppmRows = ppmXml ? parseWorksheet(ppmXml, sharedStrings, null) : [];

    const assets = [];
    const allAssets = [];
    const assetReferenceByWorkbookRow = new Map();
    let excludedRows = 0;
    const uniqueLocations = new Set();

    for (const row of rows) {
      if (row.rowNo <= headerRow.rowNo) continue;
      const obj = rowToObject(row, headers);
      const assetCode = String(valueByAliases(obj, ['Asset Code']) || '').trim();
      if (!assetCode) {
        if (enabledForImport(valueByAliases(obj, ['Import?', 'Import', 'Include?']))) {
          throw new Error(`Row ${row.rowNo} is marked YES but Asset Code is blank. Enter an Asset Code or set Import? to NO.`);
        }
        continue;
      }
      if (assetCode.toUpperCase() === 'END') continue;

      // Keep the row-to-Asset-Code relationship even when Asset Import? is NO.
      // This allows the SAME combined workbook to be used later in PPM-only mode
      // without re-enabling asset creation.
      assetReferenceByWorkbookRow.set(row.rowNo, { workbookRow: row.rowNo, assetCode });

      const assetImportEnabled = enabledForImport(valueByAliases(obj, ['Import?', 'Import', 'Include?']));
      if (!assetImportEnabled) excludedRows += 1;

      const buildingCafmValue = trimValue(valueByAliases(obj, ['Building CAFM Value', 'Building Dropdown Value']));
      const buildingCode = trimValue(valueByAliases(obj, ['Building Code']));
      const displayParts = splitBuildingDisplay(buildingCafmValue);
      const buildingName = trimValue(valueByAliases(obj, ['Building Name'])) || displayParts.name;
      const locationCode = trimValue(valueByAliases(obj, ['Location Code', 'Room Number']));
      const locationCafmValue = trimValue(valueByAliases(obj, ['Location CAFM Value', 'Location Dropdown Value'])) || locationCode;
      const locationDescription = trimValue(valueByAliases(obj, ['Location Description']));
      const fullLocation = trimValue(valueByAliases(obj, ['Full Location', 'Full Location Description']))
        || [buildingCafmValue, valueByAliases(obj, ['Floor']), locationCafmValue].filter(Boolean).join(' - ');
      if (locationCode) uniqueLocations.add(String(locationCode).toUpperCase());

      const systemValue = trimValue(valueByAliases(obj, ['System CAFM Value', 'System', 'Asset System']));
      const tagValue = trimValue(valueByAliases(obj, ['Tag CAFM Value', 'Tag', 'Asset Tag']));
      const typeValue = trimValue(valueByAliases(obj, ['Type CAFM Value', 'Type', 'Asset Type']));
      const nameValue = trimValue(valueByAliases(obj, ['Name CAFM Value', 'Name', 'Asset Name']));
      const systemParts = splitLookupDisplay(systemValue);
      const tagParts = splitLookupDisplay(tagValue);
      const typeParts = splitLookupDisplay(typeValue);
      const nameParts = splitLookupDisplay(nameValue);

      const assetRecord = {
        workbookRow: row.rowNo,
        assetCode,
        description: trimValue(valueByAliases(obj, ['Description', 'Asset Description'])),
        quantity: numericText(valueByAliases(obj, ['Quantity', 'Qty'])),
        system: systemValue,
        systemCode: trimValue(valueByAliases(obj, ['System Code'])) || systemParts.code,
        systemDescription: trimValue(valueByAliases(obj, ['System Description'])) || systemParts.description,
        tag: tagValue,
        tagCode: trimValue(valueByAliases(obj, ['Tag Code'])) || tagParts.code,
        tagDescription: trimValue(valueByAliases(obj, ['Tag Description'])) || tagParts.description,
        type: typeValue,
        typeCode: trimValue(valueByAliases(obj, ['Type Code'])) || typeParts.code,
        typeDescription: trimValue(valueByAliases(obj, ['Type Description'])) || typeParts.description,
        name: nameValue,
        nameCode: trimValue(valueByAliases(obj, ['Name Code'])) || nameParts.code,
        nameDescription: trimValue(valueByAliases(obj, ['Name Description'])) || nameParts.description,
        group: trimValue(valueByAliases(obj, ['Group'])),
        classification: trimValue(valueByAliases(obj, ['Classification'])),
        condition: trimValue(valueByAliases(obj, ['Condition'])),

        buildingCafmValue,
        buildingSearch: buildingCode || displayParts.listCode,
        buildingCode,
        buildingDisplay: buildingCafmValue,
        buildingFull: buildingCafmValue,
        buildingName,
        buildingListCode: displayParts.listCode,
        floorName: trimValue(valueByAliases(obj, ['Floor'])),

        locationSearch: locationCode,
        locationCode,
        locationCafmValue,
        locationDisplay: locationCafmValue,
        locationDescription,
        locationFull: fullLocation,
        locationMatched: Boolean(locationCode && buildingCafmValue),

        siteReference: trimValue(valueByAliases(obj, ['Site Reference', 'Site'])),
        externalRef: trimValue(valueByAliases(obj, ['External Ref', 'External Reference'])),
        serialNumber: trimValue(valueByAliases(obj, ['Serial No.', 'Serial No', 'Serial Number'])),
        productCode: trimValue(valueByAliases(obj, ['Product Code'])),
        drawingReference: trimValue(valueByAliases(obj, ['Drawing #', 'Drawing Reference Number'])),
        barcode: trimValue(valueByAliases(obj, ['Barcode'])),
        model: trimValue(valueByAliases(obj, ['Model', 'Model Type'])),
        manufacturer: trimValue(valueByAliases(obj, ['Manufacturer', 'Manufacturer Name'])),
        parentAssetCode: trimValue(valueByAliases(obj, ['Parent Asset', 'Parent Asset Code'])),
        supplier: trimValue(valueByAliases(obj, ['Supplier', 'Supplier Name'])),
        costCentre: trimValue(valueByAliases(obj, ['Cost Centre', 'Cost Centre Name'])),
        objectRef: trimValue(valueByAliases(obj, ['Object Ref', 'Object Reference'])),
        comments: trimValue(valueByAliases(obj, ['Notes', 'Comments'])),

        purchaseDate: excelDate(valueByAliases(obj, ['Purchase Date'])),
        purchaseCost: numericText(valueByAliases(obj, ['Purchase Cost'])),
        warrantyExpiry: excelDate(valueByAliases(obj, ['Warranty Expires', 'Warranty Expiry Date'])),
        surveyDate: excelDate(valueByAliases(obj, ['Survey Date', 'Asset Tested Date'])),
        replacementCost: numericText(valueByAliases(obj, ['Replacement Cost'])),
        disposalValue: numericText(valueByAliases(obj, ['Disposal Value'])),
        lifespan: numericText(valueByAliases(obj, ['Lifespan'])),
        reducingBalanceDepreciation: numericText(valueByAliases(obj, ['Reducing Balance Depreciation %', 'Reducing Balance Depreciation'])),
        operationalRisk: numericText(valueByAliases(obj, ['Operational Risk', 'Operational'])),
        healthSafetyRisk: numericText(valueByAliases(obj, ['Health/Safety Risk', 'Health/Safety'])),
        environmentalRisk: numericText(valueByAliases(obj, ['Environmental Risk', 'Environmental'])),
        leaseObligation: numericText(valueByAliases(obj, ['Lease Obligation'])),
        actualRisk: numericText(valueByAliases(obj, ['Actual Risk'])),

        spatial: {
          gisReference: trimValue(valueByAliases(obj, ['GIS Reference', 'GIS'])),
          latitude: numericText(valueByAliases(obj, ['Latitude'])),
          longitude: numericText(valueByAliases(obj, ['Longitude'])),
          elevation: numericText(valueByAliases(obj, ['Elevation'])),
          externalSystem: trimValue(valueByAliases(obj, ['External System'])),
          externalObject: trimValue(valueByAliases(obj, ['External Object'])),
          externalIdentifier: trimValue(valueByAliases(obj, ['External Identifier'])),
        },
      };
      allAssets.push(assetRecord);
      if (assetImportEnabled) assets.push(assetRecord);
    }

    // PPM rows may be imported independently from asset creation. The PPM row
    // still resolves its Asset Code from the matching CAFM Import row, even when
    // that asset row is set to Import? = NO.
    const ppmParsed = ppmXml ? parsePpmRows(ppmRows, assetReferenceByWorkbookRow) : { ppms: [], excludedRows: 0, headerRow: 0 };

    if (!allAssets.length && !ppmParsed.ppms.length) {
      throw new Error("No CAFM asset or PPM rows were found in the workbook.");
    }

    return {
      assets,
      allAssets,
      ppms: ppmParsed.ppms,
      ppmCount: ppmParsed.ppms.length,
      ppmExcludedRows: ppmParsed.excludedRows,
      ppmHeaderRow: ppmParsed.headerRow || 0,
      locationCount: uniqueLocations.size,
      excludedRows,
      headerRow: headerRow.rowNo,
      fileName: file.name,
      fileSize: file.size,
      fileModified: file.lastModified,
      schema: schemaFromWorkbook || 'CAFM Asset + PPM Import v8.0'
    };
  }

  globalThis.CAFMXlsx = { readWorkbook };
})();
