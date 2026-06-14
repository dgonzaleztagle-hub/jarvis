const { google } = require('googleapis');
const { withRetry } = require('../utils/retry');

function buildRange(sheetName, startCell, endCell) {
  if (!sheetName) return endCell ? `${startCell}:${endCell}` : startCell;
  return endCell ? `${sheetName}!${startCell}:${endCell}` : `${sheetName}!${startCell}`;
}

function rowsToObjects(rows) {
  if (!rows || rows.length === 0) return { headers: [], data: [] };
  const headers = rows[0].map((h) => String(h || '').trim());
  const data = rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] !== undefined ? row[i] : '';
    });
    return obj;
  });
  return { headers, data };
}

function normalizeWriteValues(values) {
  if (!Array.isArray(values)) return [];
  if (values.length === 0) return [];
  if (Array.isArray(values[0])) return values;
  const keys = Object.keys(values[0]);
  return values.map((obj) => keys.map((k) => (obj[k] !== undefined ? obj[k] : '')));
}

function createGoogleSheetsTools({ authFactory }) {
  async function listSpreadsheets(input = {}) {
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const queryParts = ["mimeType='application/vnd.google-apps.spreadsheet'"];
    if (input.query) {
      queryParts.push(`name contains '${input.query.replace(/'/g, "\\'")}'`);
    }
    const response = await withRetry(() =>
      drive.files.list({
        q: queryParts.join(' and '),
        pageSize: Math.min(Number(input.maxResults) || 20, 50),
        fields: 'files(id,name,modifiedTime,webViewLink)',
        orderBy: 'modifiedTime desc'
      })
    );
    return {
      spreadsheets: (response.data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        url: f.webViewLink,
        modifiedTime: f.modifiedTime
      }))
    };
  }

  async function getInfo(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');
    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await withRetry(() =>
      sheets.spreadsheets.get({
        spreadsheetId: input.spreadsheetId,
        fields: 'spreadsheetId,properties.title,sheets.properties'
      })
    );
    return {
      spreadsheetId: response.data.spreadsheetId,
      title: response.data.properties?.title,
      url: `https://docs.google.com/spreadsheets/d/${response.data.spreadsheetId}`,
      sheets: (response.data.sheets || []).map((s) => ({
        sheetId: s.properties?.sheetId,
        title: s.properties?.title,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount
      }))
    };
  }

  async function readRange(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');
    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const range = input.range || buildRange(
      input.sheetName,
      input.startCell || 'A1',
      input.endCell || null
    );

    const response = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: input.spreadsheetId,
        range,
        valueRenderOption: input.valueRenderOption || 'FORMATTED_VALUE'
      })
    );

    const rawRows = response.data.values || [];
    const asObjects = input.firstRowHeaders !== false && rawRows.length > 1;
    const result = {
      spreadsheetId: input.spreadsheetId,
      range: response.data.range,
      totalRows: rawRows.length
    };

    if (asObjects) {
      const { headers, data } = rowsToObjects(rawRows);
      result.headers = headers;
      result.rows = data;
    } else {
      result.rows = rawRows;
    }

    return result;
  }

  async function writeRange(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');
    if (!input.values) throw new Error('SHEETS_REQUIRES_VALUES');

    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const range = input.range || buildRange(
      input.sheetName,
      input.startCell || 'A1',
      null
    );

    const normalizedValues = normalizeWriteValues(input.values);
    const append = input.mode === 'append';

    let response;
    if (append) {
      response = await withRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId: input.spreadsheetId,
          range,
          valueInputOption: input.valueInputOption || 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: normalizedValues }
        })
      );
      return {
        spreadsheetId: input.spreadsheetId,
        updatedRange: response.data.updates?.updatedRange,
        updatedRows: response.data.updates?.updatedRows,
        mode: 'append'
      };
    }

    response = await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId: input.spreadsheetId,
        range,
        valueInputOption: input.valueInputOption || 'USER_ENTERED',
        requestBody: { values: normalizedValues }
      })
    );
    return {
      spreadsheetId: input.spreadsheetId,
      updatedRange: response.data.updatedRange,
      updatedRows: response.data.updatedRows,
      updatedColumns: response.data.updatedColumns,
      updatedCells: response.data.updatedCells,
      mode: 'overwrite'
    };
  }

  async function createSpreadsheet(input = {}) {
    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const title = String(input.title || 'Nueva planilla').trim();
    const response = await withRetry(() =>
      sheets.spreadsheets.create({
        requestBody: {
          properties: { title },
          sheets: input.sheetName ? [{ properties: { title: String(input.sheetName).trim() } }] : undefined
        }
      })
    );
    const spreadsheetId = response.data.spreadsheetId;

    // Si vienen encabezados, los escribe como primera fila.
    if (Array.isArray(input.headers) && input.headers.length > 0) {
      await withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: input.sheetName ? `${String(input.sheetName).trim()}!A1` : 'A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [input.headers] }
        })
      );
    }

    return {
      spreadsheetId,
      title,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      headers: input.headers || []
    };
  }

  return [
    {
      name: 'google.sheets.create_spreadsheet',
      description: 'Crear una planilla de Google Sheets nueva desde cero. Input: { title, sheetName (opcional, nombre de la primera hoja), headers (opcional, array de encabezados para la primera fila, ej: ["Fecha","Comercio","Monto","Categoría"]) }. Devuelve el spreadsheetId y la URL. Úsalo cuando el usuario quiere empezar a llevar un registro/control/contabilidad y no hay una planilla existente.',
      risk: 'medium',
      permissions: ['google:sheets:write'],
      required: ['title'],
      aliases: { title: ['nombre', 'name'], sheetName: ['sheet_name', 'hoja'], headers: ['encabezados', 'columnas'] },
      execute: createSpreadsheet
    },
    {
      name: 'google.sheets.list_spreadsheets',
      description: 'List Google Sheets spreadsheets in the user Drive, optionally filtered by name.',
      risk: 'low',
      permissions: ['google:drive:read'],
      aliases: {
        query: ['search', 'buscar', 'nombre', 'name', 'filter'],
        maxResults: ['max_results', 'limit', 'count']
      },
      execute: listSpreadsheets
    },
    {
      name: 'google.sheets.get_info',
      description: 'Get spreadsheet title and list of sheet tabs with their dimensions.',
      risk: 'low',
      permissions: ['google:sheets:read'],
      required: ['spreadsheetId'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id', 'sheet_id', 'sheetId']
      },
      execute: getInfo
    },
    {
      name: 'google.sheets.read_range',
      description: 'Read data from a Google Sheets range. Returns rows as objects if the first row contains headers.',
      risk: 'low',
      permissions: ['google:sheets:read'],
      required: ['spreadsheetId'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id', 'sheet_id'],
        sheetName: ['sheet_name', 'sheet', 'tab', 'hoja'],
        startCell: ['start_cell', 'start', 'desde'],
        endCell: ['end_cell', 'end', 'hasta'],
        range: ['rango', 'cells', 'celdas']
      },
      execute: readRange
    },
    {
      name: 'google.sheets.write_range',
      description: 'Write data to a Google Sheets range. Use mode "append" to add rows (safe, default for registering data), or omit mode to overwrite the range. Para registrar/anotar datos que el usuario pide explícitamente, usa SIEMPRE mode "append".',
      risk: 'medium',
      permissions: ['google:sheets:write'],
      required: ['spreadsheetId', 'values'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id', 'sheet_id'],
        sheetName: ['sheet_name', 'sheet', 'tab', 'hoja'],
        startCell: ['start_cell', 'start', 'desde'],
        range: ['rango'],
        mode: ['modo', 'insert_mode']
      },
      execute: writeRange
    }
  ];
}

module.exports = { createGoogleSheetsTools };
