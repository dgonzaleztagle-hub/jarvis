function getByPath(source, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, source);
}

function setByPath(target, path, value) {
  const parts = String(path).split('.');
  let current = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const key = parts[index];
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

function normalizeInput(input = {}, aliases = {}) {
  const normalized = { ...input };
  for (const [canonical, candidates] of Object.entries(aliases)) {
    if (getByPath(normalized, canonical) !== undefined) continue;
    for (const candidate of candidates) {
      const value = getByPath(input, candidate);
      if (value !== undefined) {
        setByPath(normalized, canonical, value);
        break;
      }
    }
  }
  return normalized;
}

function validateRequired(input = {}, required = []) {
  const missing = required.filter((path) => {
    const value = getByPath(input, path);
    return value === undefined || value === null || value === '';
  });
  return {
    ok: missing.length === 0,
    missing
  };
}

module.exports = {
  normalizeInput,
  validateRequired,
  getByPath
};
