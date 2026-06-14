// Simple in-memory TTL cache for connector read operations.
// Entries expire after `ttlMs` milliseconds. Cache resets on process restart.
// Write operations (create/update/delete) should call invalidate() to bust
// relevant entries immediately rather than waiting for TTL expiry.

class ConnectorCache {
  constructor({ ttlMs = 30 * 60 * 1000 } = {}) {
    this._ttl = ttlMs;
    this._store = new Map();
  }

  _key(namespace, params = {}) {
    return `${namespace}:${JSON.stringify(params, Object.keys(params).sort())}`;
  }

  get(namespace, params = {}) {
    const key = this._key(namespace, params);
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this._ttl) {
      this._store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(namespace, params = {}, data) {
    const key = this._key(namespace, params);
    this._store.set(key, { ts: Date.now(), data });
  }

  invalidate(namespace) {
    const prefix = `${namespace}:`;
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key);
    }
  }

  invalidateAll() {
    this._store.clear();
  }

  size() {
    return this._store.size;
  }
}

module.exports = { ConnectorCache };
