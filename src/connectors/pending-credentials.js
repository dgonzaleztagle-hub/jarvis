// Registro de solicitudes de credenciales pendientes.
// El tool hud.request_credentials crea una entrada y espera;
// el endpoint POST /credentials/respond la resuelve.

const TIMEOUT_MS = 120_000; // 2 minutos para que el usuario llene el formulario

const pending = new Map(); // requestId → { resolve, reject, timer, meta }

function createRequest(requestId, meta = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('CREDENTIAL_REQUEST_TIMEOUT: el usuario no respondió en 2 minutos'));
    }, TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer, meta });
  });
}

function resolveRequest(requestId, values = {}) {
  const entry = pending.get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(values);
  return true;
}

function cancelRequest(requestId) {
  const entry = pending.get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.reject(new Error('CREDENTIAL_REQUEST_CANCELLED'));
  return true;
}

function listPending() {
  return Array.from(pending.entries()).map(([id, e]) => ({ id, ...e.meta }));
}

module.exports = { createRequest, resolveRequest, cancelRequest, listPending };
