const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('../core/atomic-json');

class CredentialVault {
  constructor({ dataDir }) {
    this.vaultDir = path.join(dataDir, 'vault');
    this.keyPath = path.join(this.vaultDir, '.local-key');
    this.vaultPath = path.join(this.vaultDir, 'credentials.enc');
    fs.mkdirSync(this.vaultDir, { recursive: true });
    this.key = this.loadOrCreateKey();
  }

  loadOrCreateKey() {
    if (fs.existsSync(this.keyPath)) {
      return fs.readFileSync(this.keyPath);
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, key);
    return key;
  }

  encrypt(data) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(payload) {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  readAll() {
    if (!fs.existsSync(this.vaultPath)) return {};
    return this.decrypt(fs.readFileSync(this.vaultPath, 'utf-8'));
  }

  writeAll(data) {
    // Atómico: el vault es UN blob cifrado. Una escritura cortada acá perdía
    // TODAS las credenciales (keys, tokens de Google) sin recuperación posible.
    writeFileAtomic(this.vaultPath, this.encrypt(data));
  }

  set(name, value, metadata = {}) {
    const all = this.readAll();
    all[name] = {
      value,
      metadata,
      updatedAt: new Date().toISOString()
    };
    this.writeAll(all);
    return { name, metadata: all[name].metadata, updatedAt: all[name].updatedAt };
  }

  get(name) {
    const entry = this.readAll()[name];
    return entry ? entry.value : null;
  }

  delete(name) {
    const all = this.readAll();
    if (!(name in all)) return false;
    delete all[name];
    this.writeAll(all);
    return true;
  }

  list() {
    return Object.entries(this.readAll()).map(([name, entry]) => ({
      name,
      metadata: entry.metadata,
      updatedAt: entry.updatedAt
    }));
  }
}

module.exports = {
  CredentialVault
};
