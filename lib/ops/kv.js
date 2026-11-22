// Workspace-scoped storage helpers on top of lib/store.js. Every key is prefixed with the workspace id,
// so one tenant can never read another's records by guessing an id.
import crypto from 'node:crypto';
import { canonicalize } from 'json-canonicalize';

export const sha256 = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : canonicalize(v)).digest('hex');
export const nid = (p, n = 9) => p + crypto.randomBytes(n).toString('base64url');
export const now = () => new Date().toISOString();

export function scoped(store, ws) {
  if (!/^[\w-]{8,40}$/.test(String(ws || ''))) throw Object.assign(new Error('No workspace.'), { status: 401 });
  const k = s => `ws:${ws}:${s}`;
  return {
    ws,
    get: s => store.get(k(s)), set: (s, v, ttl) => store.set(k(s), v, ttl), del: s => store.del(k(s)),
    async list(s) { return (await store.get(k(s))) || []; },
    async push(s, id, cap = 300) { const l = await this.list(s); if (!l.includes(id)) l.unshift(id); await store.set(k(s), l.slice(0, cap)); },
    async audit(type, text, payload) {
      const l = await this.list('audit'); const prev = l[0]?.hash || '0'.repeat(64);
      const e = { id: nid('ev_', 6), at: now(), type, text, payload: payload ?? null, prev };
      e.hash = sha256({ ...e }); l.unshift(e); await store.set(k('audit'), l.slice(0, 500)); return e;
    },
  };
}
