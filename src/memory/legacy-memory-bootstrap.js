const fs = require('fs');
const path = require('path');

const LEGACY_MEMORY_DIR = 'C:\\proyectos\\jarvis-companion\\memory_vault';

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function bootstrapLegacyMemory({ memoryStore, legacyDir = LEGACY_MEMORY_DIR }) {
  if (!memoryStore || !fs.existsSync(legacyDir)) return { imported: 0 };

  const records = [
    {
      file: 'preferences.json',
      map: (data) => ({
        key: 'legacy_preferences',
        title: 'Preferencias del usuario heredadas',
        type: 'preference',
        state: 'verified',
        confidence: 0.95,
        tags: ['legacy', 'preferences'],
        aliases: ['preferencias', 'forma de trabajo', 'estilo'],
        content: data?.data || {}
      })
    },
    {
      file: 'irigoyenrosa93_gmail_com_wife.json',
      map: (data) => ({
        key: 'legacy_contact_wife',
        title: 'Rosa Irigoyen',
        type: 'contact',
        state: 'verified',
        confidence: 0.98,
        tags: ['legacy', 'contact', 'family'],
        aliases: ['esposa', 'mi esposa', 'rosa'],
        content: data?.data || {}
      })
    },
    {
      file: 'user_identity.json',
      map: (data) => ({
        key: 'legacy_user_identity',
        title: 'Identidad del usuario',
        type: 'preference',
        state: 'verified',
        confidence: 0.9,
        tags: ['legacy', 'identity'],
        aliases: ['usuario', 'daniel', 'señor'],
        content: data?.data || {}
      })
    }
  ];

  let imported = 0;
  for (const item of records) {
    const parsed = readJson(path.join(legacyDir, item.file));
    if (!parsed) continue;
    const mapped = item.map(parsed);
    // Skip if already exists — don't overwrite manually enriched records
    const existing = memoryStore.getByKey?.(mapped.key);
    if (existing) continue;
    memoryStore.upsert(mapped);
    imported += 1;
  }

  return { imported };
}

module.exports = {
  bootstrapLegacyMemory
};
