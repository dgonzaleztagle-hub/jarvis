const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { withRetry } = require('../utils/retry');

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

const GOOGLE_MIME_LABELS = {
  'application/vnd.google-apps.document': 'Google Doc',
  'application/vnd.google-apps.spreadsheet': 'Google Sheets',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.folder': 'Carpeta',
  'application/pdf': 'PDF',
  'image/jpeg': 'Imagen',
  'image/png': 'Imagen',
  'text/plain': 'Texto',
  'text/csv': 'CSV'
};

function formatFile(f) {
  return {
    id: f.id,
    name: f.name,
    type: GOOGLE_MIME_LABELS[f.mimeType] || f.mimeType,
    mimeType: f.mimeType,
    size: f.size ? Number(f.size) : null,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
    url: f.webViewLink || null,
    downloadUrl: f.webContentLink || null,
    parents: f.parents || [],
    starred: f.starred || false,
    shared: f.shared || false,
    owners: (f.owners || []).map((o) => o.emailAddress).filter(Boolean)
  };
}

// Resuelve un nombre de carpeta a su ID en Drive.
async function resolveFolderId(drive, raw) {
  if (!raw) return null;
  if (raw === 'root' || raw === 'raiz' || raw.startsWith('root')) return 'root';
  // Si parece un ID (no contiene espacios ni caracteres especiales, >20 chars)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;

  const res = await withRetry(() =>
    drive.files.list({
      q: `name = '${raw.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      pageSize: 1,
      fields: 'files(id,name)'
    })
  );
  const folder = res.data.files?.[0];
  if (!folder) throw new Error(`DRIVE_FOLDER_NOT_FOUND: ${raw}`);
  return folder.id;
}

// Resuelve fileId desde id directo o búsqueda por nombre.
async function resolveFileId(drive, input) {
  const id = input.fileId || input.id;
  if (id) return id;
  const name = String(input.name || input.fileName || '').trim();
  if (!name) throw new Error('DRIVE_REQUIRES_FILE_ID_OR_NAME');

  const res = await withRetry(() =>
    drive.files.list({
      q: `name contains '${name.replace(/'/g, "\\'")}' and trashed=false`,
      pageSize: 1,
      fields: 'files(id,name)',
      orderBy: 'modifiedTime desc'
    })
  );
  const file = res.data.files?.[0];
  if (!file) throw new Error(`DRIVE_FILE_NOT_FOUND: ${name}`);
  return file.id;
}

function createGoogleDriveTools({ authFactory, dataDir }) {
  const inboxDir = dataDir ? path.join(dataDir, 'inbox') : null;

  async function listFiles(input = {}) {
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });

    const conditions = ['trashed=false'];
    if (input.query) {
      conditions.push(`name contains '${String(input.query).replace(/'/g, "\\'")}'`);
    }
    if (input.folder) {
      const folderId = await resolveFolderId(drive, input.folder);
      conditions.push(`'${folderId}' in parents`);
    }
    if (input.type) {
      const typeMap = {
        docs: 'application/vnd.google-apps.document',
        sheets: 'application/vnd.google-apps.spreadsheet',
        slides: 'application/vnd.google-apps.presentation',
        folder: 'application/vnd.google-apps.folder',
        pdf: 'application/pdf',
        image: "mimeType contains 'image/'",
        video: "mimeType contains 'video/'"
      };
      const mapped = typeMap[String(input.type).toLowerCase()];
      if (mapped) {
        conditions.push(mapped.includes('mimeType') ? mapped : `mimeType='${mapped}'`);
      }
    }

    const res = await withRetry(() =>
      drive.files.list({
        q: conditions.join(' and '),
        pageSize: Math.min(Number(input.maxResults) || 25, 100),
        fields: 'files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,webContentLink,parents,starred,shared,owners)',
        orderBy: input.orderBy === 'name' ? 'name' : 'modifiedTime desc'
      })
    );

    return { files: (res.data.files || []).map(formatFile) };
  }

  async function searchFiles(input = {}) {
    if (!input.query) throw new Error('DRIVE_SEARCH_REQUIRES_QUERY');
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });

    const q = `(name contains '${String(input.query).replace(/'/g, "\\'")}' or fullText contains '${String(input.query).replace(/'/g, "\\'")}') and trashed=false`;

    const res = await withRetry(() =>
      drive.files.list({
        q,
        pageSize: Math.min(Number(input.maxResults) || 20, 50),
        fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,parents,starred,shared,owners)',
        orderBy: 'modifiedTime desc'
      })
    );

    return { query: input.query, files: (res.data.files || []).map(formatFile) };
  }

  async function getFile(input = {}) {
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const fileId = await resolveFileId(drive, input);

    const res = await withRetry(() =>
      drive.files.get({
        fileId,
        fields: 'id,name,mimeType,size,modifiedTime,createdTime,webViewLink,webContentLink,parents,starred,shared,owners,description,permissions'
      })
    );

    return formatFile(res.data);
  }

  async function uploadFile(input = {}) {
    if (!inboxDir) throw new Error('DRIVE_UPLOAD_NO_INBOX_DIR');
    const fileName = path.basename(String(input.file || ''));
    if (!fileName) throw new Error('DRIVE_UPLOAD_REQUIRES_FILE_NAME');
    const filePath = path.join(inboxDir, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`INBOX_FILE_NOT_FOUND: ${fileName}`);

    const ext = path.extname(fileName).toLowerCase();
    const mimeType = MIME_MAP[ext] || 'application/octet-stream';

    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });

    const metadata = { name: input.name || fileName };
    if (input.folder) {
      const folderId = await resolveFolderId(drive, input.folder);
      metadata.parents = [folderId];
    }

    const res = await withRetry(() =>
      drive.files.create({
        requestBody: metadata,
        media: { mimeType, body: fs.createReadStream(filePath) },
        fields: 'id,name,mimeType,webViewLink,webContentLink'
      })
    );

    return {
      ok: true,
      id: res.data.id,
      name: res.data.name,
      mimeType: res.data.mimeType,
      url: res.data.webViewLink || null,
      downloadUrl: res.data.webContentLink || null
    };
  }

  async function createFolder(input = {}) {
    if (!input.name) throw new Error('DRIVE_FOLDER_REQUIRES_NAME');
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });

    const metadata = { name: String(input.name).trim(), mimeType: 'application/vnd.google-apps.folder' };
    if (input.parent) {
      const parentId = await resolveFolderId(drive, input.parent);
      metadata.parents = [parentId];
    }

    const res = await withRetry(() =>
      drive.files.create({
        requestBody: metadata,
        fields: 'id,name,webViewLink'
      })
    );

    return { ok: true, id: res.data.id, name: res.data.name, url: res.data.webViewLink };
  }

  async function moveFile(input = {}) {
    if (!input.folder) throw new Error('DRIVE_MOVE_REQUIRES_DESTINATION');
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const fileId = await resolveFileId(drive, input);
    const destId = await resolveFolderId(drive, input.folder);

    // Obtiene los padres actuales para removerlos.
    const meta = await withRetry(() => drive.files.get({ fileId, fields: 'parents' }));
    const currentParents = (meta.data.parents || []).join(',');

    const res = await withRetry(() =>
      drive.files.update({
        fileId,
        addParents: destId,
        removeParents: currentParents,
        fields: 'id,name,parents,webViewLink'
      })
    );

    return { ok: true, id: res.data.id, name: res.data.name, movedTo: destId, url: res.data.webViewLink };
  }

  async function copyFile(input = {}) {
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const fileId = await resolveFileId(drive, input);

    const metadata = {};
    if (input.newName) metadata.name = String(input.newName).trim();
    if (input.folder) {
      const folderId = await resolveFolderId(drive, input.folder);
      metadata.parents = [folderId];
    }

    const res = await withRetry(() =>
      drive.files.copy({
        fileId,
        requestBody: metadata,
        fields: 'id,name,mimeType,webViewLink'
      })
    );

    return { ok: true, id: res.data.id, name: res.data.name, url: res.data.webViewLink };
  }

  async function trashFile(input = {}) {
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const fileId = await resolveFileId(drive, input);

    await withRetry(() =>
      drive.files.update({ fileId, requestBody: { trashed: true }, fields: 'id,name' })
    );

    return { ok: true, trashed: true, fileId };
  }

  async function shareFile(input = {}) {
    const auth = authFactory.getClient();
    const drive = google.drive({ version: 'v3', auth });
    const fileId = await resolveFileId(drive, input);

    const role = String(input.role || 'reader').toLowerCase();
    if (!['reader', 'writer', 'commenter'].includes(role)) {
      throw new Error('DRIVE_SHARE_INVALID_ROLE: usa reader, writer o commenter');
    }

    let permission;
    if (input.email) {
      permission = { type: 'user', role, emailAddress: String(input.email) };
    } else {
      permission = { type: 'anyone', role };
    }

    await withRetry(() =>
      drive.permissions.create({
        fileId,
        requestBody: permission,
        sendNotificationEmail: input.email ? (input.notify !== false) : false
      })
    );

    const fileRes = await withRetry(() =>
      drive.files.get({ fileId, fields: 'id,name,webViewLink' })
    );

    return {
      ok: true,
      fileId,
      name: fileRes.data.name,
      sharedWith: input.email || 'público (cualquiera con el link)',
      role,
      url: fileRes.data.webViewLink
    };
  }

  return [
    {
      name: 'google.drive.list_files',
      description: 'Listar archivos en Google Drive. Filtra por tipo (docs, sheets, slides, pdf, image, video, folder), carpeta, o texto en el nombre. Input: { query?, folder?, type?, maxResults?, orderBy? (name | modifiedTime) }.',
      risk: 'low',
      permissions: ['google:drive:read'],
      aliases: {
        query: ['buscar', 'busca', 'search', 'nombre', 'name'],
        folder: ['carpeta', 'en', 'directorio'],
        type: ['tipo', 'formato'],
        maxResults: ['max_results', 'limit', 'count']
      },
      execute: listFiles
    },
    {
      name: 'google.drive.search_files',
      description: 'Buscar archivos en Google Drive por nombre o contenido. Input: { query (texto a buscar), maxResults? }. Más completo que list_files: busca dentro del texto de los archivos también.',
      risk: 'low',
      permissions: ['google:drive:read'],
      required: ['query'],
      aliases: {
        query: ['buscar', 'texto', 'contenido', 'search', 'q'],
        maxResults: ['max_results', 'limit', 'count']
      },
      execute: searchFiles
    },
    {
      name: 'google.drive.get_file',
      description: 'Obtener metadatos completos de un archivo específico de Drive: nombre, tipo, tamaño, fecha, link de acceso, propietarios. Input: { fileId } o { name: "parte del nombre" }.',
      risk: 'low',
      permissions: ['google:drive:read'],
      aliases: {
        fileId: ['file_id', 'id', 'documentId'],
        name: ['nombre', 'archivo', 'file']
      },
      execute: getFile
    },
    {
      name: 'google.drive.upload_file',
      description: 'Subir un archivo de la bandeja local (data/inbox/) a Google Drive. Input: { file (nombre del archivo en la bandeja), name? (nombre en Drive), folder? (carpeta destino, nombre o id) }.',
      risk: 'medium',
      permissions: ['google:drive:write'],
      required: ['file'],
      aliases: {
        file: ['archivo', 'filename', 'nombre_local'],
        name: ['nombre', 'title', 'titulo'],
        folder: ['carpeta', 'destino', 'parent']
      },
      execute: uploadFile
    },
    {
      name: 'google.drive.create_folder',
      description: 'Crear una carpeta nueva en Google Drive. Input: { name, parent? (carpeta contenedora, nombre o id) }.',
      risk: 'medium',
      permissions: ['google:drive:write'],
      required: ['name'],
      aliases: {
        name: ['nombre', 'title', 'titulo'],
        parent: ['en', 'dentro_de', 'carpeta_padre']
      },
      execute: createFolder
    },
    {
      name: 'google.drive.move_file',
      description: 'Mover un archivo a otra carpeta en Drive. Input: { fileId } o { name }, más { folder: "nombre o id de la carpeta destino" }.',
      risk: 'medium',
      permissions: ['google:drive:write'],
      required: ['folder'],
      aliases: {
        fileId: ['file_id', 'id'],
        name: ['nombre', 'archivo'],
        folder: ['carpeta', 'destino', 'mover_a']
      },
      execute: moveFile
    },
    {
      name: 'google.drive.copy_file',
      description: 'Hacer una copia de un archivo en Drive. Input: { fileId } o { name }, más { newName? (nombre de la copia), folder? (carpeta destino) }.',
      risk: 'medium',
      permissions: ['google:drive:write'],
      aliases: {
        fileId: ['file_id', 'id'],
        name: ['nombre', 'archivo'],
        newName: ['new_name', 'nombre_copia', 'copia'],
        folder: ['carpeta', 'destino']
      },
      execute: copyFile
    },
    {
      name: 'google.drive.share_file',
      description: 'Compartir un archivo de Drive. Input: { fileId } o { name }, más { email? (si se omite, genera link público), role: reader|writer|commenter (default: reader), notify? (enviar email de notificación, default true si hay email) }. Devuelve el link al archivo.',
      risk: 'medium',
      permissions: ['google:drive:write'],
      aliases: {
        fileId: ['file_id', 'id'],
        name: ['nombre', 'archivo'],
        email: ['correo', 'con', 'para'],
        role: ['permiso', 'acceso'],
        notify: ['notificar', 'enviar_email']
      },
      execute: shareFile
    },
    {
      name: 'google.drive.trash_file',
      description: 'Mover un archivo a la papelera de Drive (recuperable desde Drive durante 30 días). Input: { fileId } o { name }.',
      risk: 'high',
      permissions: ['google:drive:write'],
      aliases: {
        fileId: ['file_id', 'id'],
        name: ['nombre', 'archivo']
      },
      execute: trashFile
    }
  ];
}

module.exports = { createGoogleDriveTools };
