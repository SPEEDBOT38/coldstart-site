// Tiny key/value store for server-side state that cannot live in a user's cookie:
// site keys for the public CAPI relay, Shopify shop→pixel routes, delivery logs, sandbox data.
// Backends: Upstash/Vercel KV REST (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN),
// a JSON file (local dev; /tmp on Vercel, which is per-instance), or memory (STORE=memory, tests).
import fs from 'node:fs';
import path from 'node:path';

function restBackend(url, token, fetchImpl = fetch) {
  const call = async cmd => {
    const r = await fetchImpl(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
    if (!r.ok) throw new Error('store: ' + r.status);
    return (await r.json()).result;
  };
  return {
    kind: 'kv',
    async get(k) { const v = await call(['GET', k]); return v == null ? null : JSON.parse(v); },
    async set(k, v, ttl) { await call(ttl ? ['SET', k, JSON.stringify(v), 'EX', String(ttl)] : ['SET', k, JSON.stringify(v)]); },
    async del(k) { await call(['DEL', k]); },
  };
}

function memoryBackend(kind = 'memory', persist) {
  const m = new Map();
  if (persist) try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(persist, 'utf8')))) m.set(k, v); } catch {}
  const live = k => { const e = m.get(k); if (!e) return null; if (e.x && e.x < Date.now()) { m.delete(k); return null; } return e; };
  const flush = () => { if (!persist) return; fs.mkdirSync(path.dirname(persist), { recursive: true }); fs.writeFileSync(persist, JSON.stringify(Object.fromEntries(m))); };
  return {
    kind,
    async get(k) { return live(k)?.v ?? null; },
    async set(k, v, ttl) { m.set(k, { v, x: ttl ? Date.now() + ttl * 1000 : 0 }); flush(); },
    async del(k) { m.delete(k); flush(); },
  };
}

export function createStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return restBackend(url, token);
  if (env.STORE === 'memory') return memoryBackend();
  const file = env.VERCEL ? '/tmp/coldstart-store.json' : path.resolve(env.STORE_FILE || '.data/store.json');
  return memoryBackend(env.VERCEL ? 'tmp-file (per instance, add KV for production)' : 'file', file);
}
