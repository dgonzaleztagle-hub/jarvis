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
    headers.forEach((header, i) => { obj[header] = row[i] !== undefined ? row[i] : ''; });
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

// Resuelve el sheetId numérico a partir del nombre de la hoja.
async function resolveSheetId(sheets, spreadsheetId, sheetName) {
  const info = await withRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })
  );
  const sheet = (info.data.sheets || []).find(
    (s) => s.properties?.title?.toLowerCase() === String(sheetName || '').toLowerCase()
  );
  if (!sheet) throw new Error(`SHEET_NOT_FOUND: ${sheetName}`);
  return sheet.properties.sheetId;
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

    const range = input.range || buildRange(input.sheetName, input.startCell || 'A1', input.endCell || null);
    const response = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: input.spreadsheetId,
        range,
        valueRenderOption: input.valueRenderOption || 'FORMATTED_VALUE'
      })
    );

    const rawRows = response.data.values || [];
    const asObjects = input.firstRowHeaders !== false && rawRows.length > 1;
    const result = { spreadsheetId: input.spreadsheetId, range: response.data.range, totalRows: rawRows.length };

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
    const range = input.range || buildRange(input.sheetName, input.startCell || 'A1', null);
    const normalizedValues = normalizeWriteValues(input.values);
    const append = input.mode === 'append';

    if (append) {
      const response = await withRetry(() =>
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

    const response = await withRetry(() =>
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

  async function findRows(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');

    const data = await readRange({
      spreadsheetId: input.spreadsheetId,
      sheetName: input.sheetName,
      firstRowHeaders: true
    });

    const query = String(input.query || '').trim().toLowerCase();
    const column = String(input.column || '').trim().toLowerCase();

    if (!query) return { ...data, found: (data.rows || []).length };

    const matches = (data.rows || []).filter((row, index) => {
      if (column) {
        const key = Object.keys(row).find((k) => k.toLowerCase() === column);
        return key ? String(row[key]).toLowerCase().includes(query) : false;
      }
      return Object.values(row).some((v) => String(v).toLowerCase().includes(query));
    });

    return {
      spreadsheetId: input.spreadsheetId,
      sheetName: input.sheetName || null,
      query,
      column: column || null,
      found: matches.length,
      rows: matches
    };
  }

  async function deleteRows(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');
    if (input.startRow === undefined) throw new Error('SHEETS_DELETE_ROWS_REQUIRES_START_ROW');

    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // startRow y endRow son 1-based (fila 1 = encabezado).
    const startIndex = Number(input.startRow) - 1;
    const endIndex = Number(input.endRow || input.startRow);
    if (startIndex < 0) throw new Error('SHEETS_DELETE_ROWS_INVALID_INDEX');

    let sheetId = 0;
    if (input.sheetName) {
      sheetId = await resolveSheetId(sheets, input.spreadsheetId, input.sheetName);
    }

    await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex, endIndex }
            }
          }]
        }
      })
    );

    return { ok: true, spreadsheetId: input.spreadsheetId, deletedRows: endIndex - startIndex };
  }

  async function clearRange(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');
    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const range = input.range || buildRange(input.sheetName, input.startCell || 'A1', input.endCell || null);

    await withRetry(() =>
      sheets.spreadsheets.values.clear({ spreadsheetId: input.spreadsheetId, range })
    );

    return { ok: true, spreadsheetId: input.spreadsheetId, clearedRange: range };
  }

  async function addSheet(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');
    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const title = String(input.title || input.sheetName || 'Hoja nueva').trim();

    const response = await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] }
      })
    );

    const props = response.data.replies?.[0]?.addSheet?.properties;
    return {
      ok: true,
      spreadsheetId: input.spreadsheetId,
      sheetId: props?.sheetId,
      title: props?.title,
      url: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId}`
    };
  }

  async function renameSheet(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');
    if (!input.sheetName) throw new Error('SHEETS_RENAME_REQUIRES_SHEET_NAME');
    if (!input.newTitle) throw new Error('SHEETS_RENAME_REQUIRES_NEW_TITLE');

    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = await resolveSheetId(sheets, input.spreadsheetId, input.sheetName);

    await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: {
          requests: [{
            updateSheetProperties: {
              properties: { sheetId, title: String(input.newTitle).trim() },
              fields: 'title'
            }
          }]
        }
      })
    );

    return { ok: true, spreadsheetId: input.spreadsheetId, oldTitle: input.sheetName, newTitle: input.newTitle };
  }

  async function deleteSheet(input = {}) {
    if (!input.spreadsheetId) throw new Error('SHEETS_REQUIRES_SPREADSHEET_ID');
    if (!input.sheetName) throw new Error('SHEETS_DELETE_SHEET_REQUIRES_SHEET_NAME');

    const auth = authFactory.getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetId = await resolveSheetId(sheets, input.spreadsheetId, input.sheetName);

    await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: input.spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId } }] }
      })
    );

    return { ok: true, spreadsheetId: input.spreadsheetId, deletedSheet: input.sheetName };
  }

  return [
    {
      name: 'google.sheets.create_spreadsheet',
      description: 'Crear una planilla de Google Sheets nueva. Input: { title, sheetName (opcional), headers (opcional, array de encabezados para la primera fila) }. Devuelve spreadsheetId y URL.',
      risk: 'medium',
      permissions: ['google:sheets:write'],
      required: ['title'],
      aliases: { title: ['nombre', 'name'], sheetName: ['sheet_name', 'hoja'], headers: ['encabezados', 'columnas'] },
      execute: createSpreadsheet
    },
    {
      name: 'google.sheets.list_spreadsheets',
      description: 'Listar planillas de Google Sheets del Drive, con filtro opcional por nombre.',
      risk: 'low',
      permissions: ['google:drive:read'],
      aliases: { query: ['search', 'buscar', 'nombre', 'name', 'filter'], maxResults: ['max_results', 'limit', 'count'] },
      execute: listSpreadsheets
    },
    {
      name: 'google.sheets.get_info',
      description: 'Ver título y lista de hojas (tabs) de una planilla con sus dimensiones.',
      risk: 'low',
      permissions: ['google:sheets:read'],
      required: ['spreadsheetId'],
      aliases: { spreadsheetId: ['spreadsheet_id', 'id', 'sheet_id', 'sheetId'] },
      execute: getInfo
    },
    {
      name: 'google.sheets.read_range',
      description: 'Leer datos de un rango de Google Sheets. Devuelve filas como objetos si la primera fila tiene encabezados. Input: { spreadsheetId, sheetName?, range? o startCell/endCell }.',
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
      description: 'Escribir datos en un rango de Sheets. mode "append" agrega filas al final (seguro, default para registrar datos); sin mode sobreescribe el rango.',
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
    },
    {
      name: 'google.sheets.find_rows',
      description: 'Buscar filas en una planilla que contengan un valor. Input: { spreadsheetId, query: "valor a buscar", column: "nombre de columna (opcional, si se omite busca en todas)" , sheetName? }. Devuelve las filas que hacen match como objetos. Úsalo para "¿está registrado X?", "dame todos los gastos de restaurante", etc.',
      risk: 'low',
      permissions: ['google:sheets:read'],
      required: ['spreadsheetId'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id'],
        sheetName: ['sheet_name', 'sheet', 'tab', 'hoja'],
        query: ['buscar', 'search', 'valor', 'value', 'q'],
        column: ['columna', 'col', 'field', 'campo']
      },
      execute: findRows
    },
    {
      name: 'google.sheets.delete_rows',
      description: 'Eliminar filas de una planilla por número de fila (1-based, donde fila 1 es el encabezado). Input: { spreadsheetId, startRow, endRow? (opcional, si se omite borra solo startRow), sheetName? }. Úsalo cuando el usuario pide borrar un registro específico.',
      risk: 'high',
      permissions: ['google:sheets:write'],
      required: ['spreadsheetId', 'startRow'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id'],
        sheetName: ['sheet_name', 'sheet', 'tab', 'hoja'],
        startRow: ['start_row', 'row', 'fila', 'row_index'],
        endRow: ['end_row', 'fila_fin']
      },
      execute: deleteRows
    },
    {
      name: 'google.sheets.clear_range',
      description: 'Limpiar el contenido de un rango de celdas (sin borrar las filas). Input: { spreadsheetId, range? o startCell/endCell, sheetName? }.',
      risk: 'medium',
      permissions: ['google:sheets:write'],
      required: ['spreadsheetId'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id'],
        sheetName: ['sheet_name', 'sheet', 'tab', 'hoja'],
        startCell: ['start_cell', 'start', 'desde'],
        endCell: ['end_cell', 'end', 'hasta'],
        range: ['rango']
      },
      execute: clearRange
    },
    {
      name: 'google.sheets.add_sheet',
      description: 'Agregar una nueva hoja (tab) a una planilla existente. Input: { spreadsheetId, title: "nombre de la hoja nueva" }.',
      risk: 'medium',
      permissions: ['google:sheets:write'],
      required: ['spreadsheetId'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id'],
        title: ['sheetName', 'sheet_name', 'nombre', 'name']
      },
      execute: addSheet
    },
    {
      name: 'google.sheets.rename_sheet',
      description: 'Cambiar el nombre de una hoja (tab) de una planilla. Input: { spreadsheetId, sheetName: "nombre actual", newTitle: "nombre nuevo" }.',
      risk: 'medium',
      permissions: ['google:sheets:write'],
      required: ['spreadsheetId', 'sheetName', 'newTitle'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id'],
        sheetName: ['sheet_name', 'sheet', 'hoja', 'tab'],
        newTitle: ['new_title', 'nuevo_nombre', 'newName']
      },
      execute: renameSheet
    },
    {
      name: 'google.sheets.delete_sheet',
      description: 'Eliminar una hoja (tab) completa de una planilla. Input: { spreadsheetId, sheetName }. Requiere confirmación.',
      risk: 'high',
      permissions: ['google:sheets:write'],
      required: ['spreadsheetId', 'sheetName'],
      aliases: {
        spreadsheetId: ['spreadsheet_id', 'id'],
        sheetName: ['sheet_name', 'sheet', 'hoja', 'tab']
      },
      execute: deleteSheet
    }
  ];
}

module.exports = { createGoogleSheetsTools };
