// Memoria externa en Google Sheets — capa de persistencia remota sobre el
// conector google-sheets.js ya existente.
//
// El Sheet maestra vive en el Drive del usuario y sirve como respaldo que
// sobrevive al disco local: proyectos, contactos, decisiones, corridas de
// agentes. No reemplaza el knowledge graph local (rápido, sin red) sino que
// lo complementa para datos pesados y de larga vida.
//
// Escritura siempre en modo append (nunca pisa filas), lectura directa.
// El usuario puede abrir el Sheet en cualquier momento y editarlo a mano.

const fs = require('fs');
const path = require('path');
const { withRetry } = require('../utils/retry');
const { google } = require('googleapis');

const SHEET_ID_FILE = 'memory/external-sheet-id.json';
const MASTER_TITLE = 'Jarvis — Memoria Externa';

const TABS = {
  proyectos: {
    name: 'Proyectos',
    headers: ['id', 'nombre', 'cliente', 'estado', 'notas', 'inicio', 'entrega']
  },
  contactos: {
    name: 'Contactos',
    headers: ['id', 'nombre', 'empresa', 'rol', 'email', 'telefono', 'notas']
  },
  decisiones: {
    name: 'Decisiones',
    headers: ['id', 'proyecto', 'decision', 'razon', 'fecha']
  },
  corridas: {
    name: 'Corridas',
    headers: ['id', 'agente', 'accion', 'resultado', 'costoUsd', 'fecha']
  }
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function createSheetsMemoryTools({ authFactory, dataDir }) {
  const idFile = path.join(dataDir, SHEET_ID_FILE);

  function loadSpreadsheetId() {
    try {
      const raw = fs.readFileSync(idFile, 'utf-8');
      return JSON.parse(raw).spreadsheetId || null;
    } catch (_) {
      return null;
    }
  }

  function saveSpreadsheetId(spreadsheetId) {
    fs.mkdirSync(path.dirname(idFile), { recursive: true });
    fs.writeFileSync(idFile, JSON.stringify({ spreadsheetId, createdAt: new Date().toISOString() }, null, 2));
  }

  async function getSheets() {
    const auth = authFactory.getClient();
    return google.sheets({ version: 'v4', auth });
  }

  async function appendRow(spreadsheetId, tabName, rowArray) {
    const sheets = await getSheets();
    await withRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tabName}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowArray] }
      })
    );
  }

  async function readTab(spreadsheetId, tabName) {
    const sheets = await getSheets();
    const res = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tabName}!A1:Z`,
        valueRenderOption: 'FORMATTED_VALUE'
      })
    );
    const rows = res.data.values || [];
    if (rows.length === 0) return { headers: [], data: [] };
    const headers = rows[0].map((h) => String(h || '').trim());
    const data = rows.slice(1).map((row) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    });
    return { headers, data };
  }

  return [
    {
      name: 'memory.setup_external',
      description: 'Crear la hoja maestra de Memoria Externa en el Google Drive del usuario. Crea tabs: Proyectos, Contactos, Decisiones, Corridas. Guarda el ID localmente. Solo es necesario hacerlo una vez.',
      risk: 'medium',
      permissions: ['google:sheets:write'],
      execute: async () => {
        const existing = loadSpreadsheetId();
        if (existing) {
          return {
            ok: true,
            spreadsheetId: existing,
            note: 'Ya configurado. La hoja maestra existe.',
            url: `https://docs.google.com/spreadsheets/d/${existing}`
          };
        }

        const auth = authFactory.getClient();
        const sheets = google.sheets({ version: 'v4', auth });

        // Crear el spreadsheet con todos los tabs de una sola llamada
        const tabDefs = Object.values(TABS).map((t, i) => ({
          properties: { title: t.name, index: i }
        }));

        const created = await withRetry(() =>
          sheets.spreadsheets.create({
            requestBody: {
              properties: { title: MASTER_TITLE },
              sheets: tabDefs
            }
          })
        );

        const spreadsheetId = created.data.spreadsheetId;

        // Escribir headers en cada tab
        const headerData = Object.values(TABS).map((t) => ({
          range: `${t.name}!A1`,
          values: [t.headers]
        }));
        await withRetry(() =>
          sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: 'USER_ENTERED',
              data: headerData
            }
          })
        );

        saveSpreadsheetId(spreadsheetId);

        return {
          ok: true,
          spreadsheetId,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          tabs: Object.values(TABS).map((t) => t.name),
          note: 'Hoja maestra creada en tu Drive. Ya puedes usar memory.save, memory.load y los shortcuts de proyectos/contactos.'
        };
      }
    },

    {
      name: 'memory.save',
      description: 'Guardar un registro en la hoja de memoria externa. Input: { tab ("proyectos"|"contactos"|"decisiones"|"corridas"), data: { campo: valor, ... } }. Se agrega como fila nueva (nunca pisa datos existentes). Requiere memory.setup_external hecho una vez.',
      risk: 'low',
      permissions: ['google:sheets:write'],
      required: ['tab', 'data'],
      execute: async (input) => {
        const spreadsheetId = loadSpreadsheetId();
        if (!spreadsheetId) {
          return { ok: false, error: 'Primero ejecuta memory.setup_external para crear la hoja maestra.' };
        }

        const tabKey = String(input.tab || '').toLowerCase();
        const tabDef = TABS[tabKey];
        if (!tabDef) {
          return { ok: false, error: `Tab desconocido: "${input.tab}". Opciones: ${Object.keys(TABS).join(', ')}` };
        }

        const record = Object.assign({}, input.data);
        if (!record.id) record.id = generateId();
        if (!record.fecha && tabDef.headers.includes('fecha')) record.fecha = new Date().toISOString().slice(0, 10);

        const row = tabDef.headers.map((h) => (record[h] !== undefined ? String(record[h]) : ''));
        await appendRow(spreadsheetId, tabDef.name, row);

        return { ok: true, tab: tabDef.name, id: record.id, fields: Object.keys(record).length };
      }
    },

    {
      name: 'memory.load',
      description: 'Leer registros de la hoja de memoria externa. Input: { tab ("proyectos"|"contactos"|"decisiones"|"corridas"), query? (texto libre para filtrar por cualquier campo) }.',
      risk: 'low',
      permissions: ['google:sheets:read'],
      required: ['tab'],
      execute: async (input) => {
        const spreadsheetId = loadSpreadsheetId();
        if (!spreadsheetId) {
          return { ok: false, error: 'Primero ejecuta memory.setup_external.' };
        }

        const tabKey = String(input.tab || '').toLowerCase();
        const tabDef = TABS[tabKey];
        if (!tabDef) {
          return { ok: false, error: `Tab desconocido: "${input.tab}". Opciones: ${Object.keys(TABS).join(', ')}` };
        }

        const { headers, data } = await readTab(spreadsheetId, tabDef.name);
        let result = data;

        if (input.query) {
          const q = String(input.query).toLowerCase();
          result = data.filter((row) =>
            Object.values(row).some((v) => String(v).toLowerCase().includes(q))
          );
        }

        return { ok: true, tab: tabDef.name, count: result.length, headers, data: result };
      }
    },

    {
      name: 'memory.list_projects',
      description: 'Listar todos los proyectos guardados en la hoja de memoria externa. Shortcut de memory.load con tab="proyectos". Input opcional: { query } para filtrar.',
      risk: 'low',
      permissions: ['google:sheets:read'],
      execute: async (input = {}) => {
        const spreadsheetId = loadSpreadsheetId();
        if (!spreadsheetId) {
          return { ok: false, error: 'Primero ejecuta memory.setup_external.' };
        }
        const { data } = await readTab(spreadsheetId, TABS.proyectos.name);
        let result = data;
        if (input.query) {
          const q = String(input.query).toLowerCase();
          result = data.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q)));
        }
        return { ok: true, count: result.length, projects: result };
      }
    },

    {
      name: 'memory.list_contacts',
      description: 'Listar todos los contactos guardados en la hoja de memoria externa. Shortcut de memory.load con tab="contactos". Input opcional: { query } para filtrar.',
      risk: 'low',
      permissions: ['google:sheets:read'],
      execute: async (input = {}) => {
        const spreadsheetId = loadSpreadsheetId();
        if (!spreadsheetId) {
          return { ok: false, error: 'Primero ejecuta memory.setup_external.' };
        }
        const { data } = await readTab(spreadsheetId, TABS.contactos.name);
        let result = data;
        if (input.query) {
          const q = String(input.query).toLowerCase();
          result = data.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q)));
        }
        return { ok: true, count: result.length, contacts: result };
      }
    },

    {
      name: 'memory.external_status',
      description: 'Ver si la hoja maestra de Memoria Externa está configurada y cuál es su URL.',
      risk: 'low',
      permissions: [],
      execute: async () => {
        const spreadsheetId = loadSpreadsheetId();
        if (!spreadsheetId) {
          return {
            configured: false,
            note: 'No configurada. Usa memory.setup_external para crear la hoja maestra en tu Drive.'
          };
        }
        return {
          configured: true,
          spreadsheetId,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          tabs: Object.values(TABS).map((t) => t.name)
        };
      }
    }
  ];
}

module.exports = { createSheetsMemoryTools };
