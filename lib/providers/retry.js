// Retry policy shared by every provider adapter: p-retry with exponential backoff on 429/5xx/network errors,
// never on other 4xx (those are our bug or the user's permissions, retrying only burns rate limit).
import pRetry, { AbortError } from 'p-retry';

export const classify = e => {
  const s = e?.status ?? e?.response?.status ?? e?.statusCode;
  const code = e?.response?.data?.error?.code ?? e?.code;
  if ([4, 17, 32, 613, 80004].includes(code)) return { retry: true, kind: 'rate_limit' };           // Meta throttling codes
  if (s === 429) return { retry: true, kind: 'rate_limit' };
  if (!s || s >= 500) return { retry: true, kind: 'transient' };
  if (s === 401 || s === 403 || code === 190) return { retry: false, kind: 'auth' };
  return { retry: false, kind: 'client' };
};
export function withRetry(fn, { retries = 2, minTimeout = 400, onRetry } = {}) {
  return pRetry(async n => { try { return await fn(n); } catch (e) { const c = classify(e); if (!c.retry) throw new AbortError(Object.assign(e, { kind: c.kind })); throw Object.assign(e, { kind: c.kind }); } },
    { retries, minTimeout, factor: 2, onFailedAttempt: onRetry });
}
