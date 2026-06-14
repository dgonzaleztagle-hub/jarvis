const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']);

function isRetryable(err) {
  const status = err?.response?.status || err?.status;
  if (status && RETRYABLE_STATUS.has(status)) return true;
  if (err?.code && RETRYABLE_CODES.has(err.code)) return true;
  return false;
}

async function withRetry(fn, { maxRetries = 3, baseDelayMs = 800 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) throw err;
      const jitter = Math.random() * 200;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt + jitter));
    }
  }
  throw lastError;
}

module.exports = { withRetry };
