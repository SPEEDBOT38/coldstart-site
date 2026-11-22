// Tiny key/value store for server-side state that cannot live in a user's cookie:
// site keys for the public CAPI relay, Shopify shop→pixel routes, delivery logs, sandbox data.
// Backends: Upstash/Vercel KV REST (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN),
// a JSON file (local dev; /tmp on Vercel, which is per-instance), or memory (STORE=memory, tests).
import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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
    async incrby(k, by) { return Number(await call(['INCRBY', k, String(by)])); },                       // atomic on the server
    async setnx(k, v, ttl) { const r = await call(ttl ? ['SET', k, JSON.stringify(v), 'EX', String(ttl), 'NX'] : ['SET', k, JSON.stringify(v), 'NX']); return r === 'OK'; },
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
    // No await between read and write: atomic within one process.
    async incrby(k, by) { const e = live(k); const n = (Number(e?.v) || 0) + by; m.set(k, { v: n, x: e?.x || 0 }); flush(); return n; },
    async setnx(k, v, ttl) { if (live(k)) return false; m.set(k, { v, x: ttl ? Date.now() + ttl * 1000 : 0 }); flush(); return true; },
  };
}


/** Durable, transactional store on SQLite (STORE=sqlite, SQLITE_FILE). Atomic across processes via SQLite locking. Uses node:sqlite (Node 22.5+). */
export function sqliteBackend(file = '.data/coldstart.sqlite') {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file); db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, x INTEGER NOT NULL DEFAULT 0)');
  const run = (sql, ...a) => db.prepare(sql).run(...a), one = (sql, ...a) => db.prepare(sql).get(...a);
  const nowS = () => Date.now();
  const purge = k => run('DELETE FROM kv WHERE k = ? AND x > 0 AND x < ?', k, nowS());
  return {
    kind: 'sqlite', db,
    async get(k) { purge(k); const r = one('SELECT v FROM kv WHERE k = ?', k); return r ? JSON.parse(r.v) : null; },
    async set(k, v, ttl) { run('INSERT INTO kv (k, v, x) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, x = excluded.x', k, JSON.stringify(v), ttl ? nowS() + ttl * 1000 : 0); },
    async del(k) { run('DELETE FROM kv WHERE k = ?', k); },
    async incrby(k, by) { purge(k); return Number(JSON.parse(one('INSERT INTO kv (k, v, x) VALUES (?, ?, 0) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(kv.v AS INTEGER) + ? AS TEXT) RETURNING v', k, String(by), by).v)); },
    async setnx(k, v, ttl) { purge(k); return run('INSERT OR IGNORE INTO kv (k, v, x) VALUES (?, ?, ?)', k, JSON.stringify(v), ttl ? nowS() + ttl * 1000 : 0).changes === 1; },
  };
}

/** Cloudflare D1 over its REST API (CF_ACCOUNT_ID, D1_DATABASE_ID, CF_API_TOKEN). Same SQL as the SQLite backend: D1 is SQLite. Contract-tested against a SQLite-backed fake only. */
export function d1Backend({ account, database, token, fetchImpl = fetch }) {
  const q = async (sql, params = []) => {
    const r = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) });
    const d = await r.json().catch(() => ({})); if (!r.ok || d.success === false) throw new Error('d1: ' + (d.errors?.[0]?.message || r.status)); return d.result?.[0] || { results: [], meta: {} };
  };
  let ready; const init = () => ready ||= q('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, x INTEGER NOT NULL DEFAULT 0)');
  const purge = k => q('DELETE FROM kv WHERE k = ? AND x > 0 AND x < ?', [k, Date.now()]);
  return {
    kind: 'd1',
    async get(k) { await init(); await purge(k); const r = (await q('SELECT v FROM kv WHERE k = ?', [k])).results[0]; return r ? JSON.parse(r.v) : null; },
    async set(k, v, ttl) { await init(); await q('INSERT INTO kv (k, v, x) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, x = excluded.x', [k, JSON.stringify(v), ttl ? Date.now() + ttl * 1000 : 0]); },
    async del(k) { await init(); await q('DELETE FROM kv WHERE k = ?', [k]); },
    async incrby(k, by) { await init(); await purge(k); const r = (await q('INSERT INTO kv (k, v, x) VALUES (?, ?, 0) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(kv.v AS INTEGER) + ? AS TEXT) RETURNING v', [k, String(by), by])).results[0]; return Number(JSON.parse(r.v)); },
    async setnx(k, v, ttl) { await init(); await purge(k); return (await q('INSERT OR IGNORE INTO kv (k, v, x) VALUES (?, ?, ?)', [k, JSON.stringify(v), ttl ? Date.now() + ttl * 1000 : 0])).meta?.changes === 1; },
  };
}


/** Postgres (Neon via Vercel Marketplace, or any Postgres). `query(text, params) → rows[]`. Every operation is ONE statement, so atomicity comes from Postgres, not from this code.
 *  TTL is lazy: expired rows are treated as absent by every statement and overwritten in place; a rare sweep deletes them. */
export function pgBackend(query, { kind = 'postgres' } = {}) {
  const now = () => Date.now(); let swept = 0;
  const sweep = () => { if (now() - swept > 600e3) { swept = now(); query('DELETE FROM kv WHERE x > 0 AND x < $1', [now()]).catch(() => {}); } };
  return {
    kind,
    async get(k) { sweep(); const r = await query('SELECT v FROM kv WHERE k = $1 AND (x = 0 OR x > $2)', [k, now()]); return r[0] ? JSON.parse(r[0].v) : null; },
    async set(k, v, ttl) { await query('INSERT INTO kv (k, v, x) VALUES ($1, $2, $3) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, x = EXCLUDED.x', [k, JSON.stringify(v), ttl ? now() + ttl * 1000 : 0]); },
    async del(k) { await query('DELETE FROM kv WHERE k = $1', [k]); },
    async incrby(k, by) {
      const r = await query('INSERT INTO kv (k, v, x) VALUES ($1, $2::text, 0) ON CONFLICT (k) DO UPDATE SET v = CASE WHEN kv.x > 0 AND kv.x < $3 THEN $2::text ELSE ((kv.v)::bigint + $2::bigint)::text END, x = CASE WHEN kv.x > 0 AND kv.x < $3 THEN 0 ELSE kv.x END RETURNING v', [k, String(by), now()]);
      return Number(JSON.parse(r[0].v));
    },
    async setnx(k, v, ttl) { const r = await query('INSERT INTO kv (k, v, x) VALUES ($1, $2, $3) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, x = EXCLUDED.x WHERE kv.x > 0 AND kv.x < $4 RETURNING k', [k, JSON.stringify(v), ttl ? now() + ttl * 1000 : 0, now()]); return r.length === 1; },
  };
}
export function neonBackend(url) { const sql = neon(url); return pgBackend((text, params) => sql.query(text, params), { kind: 'postgres(neon)' }); }
export const PG_SCHEMA = 'CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v text NOT NULL, x bigint NOT NULL DEFAULT 0)';

export function createStore(env = process.env) {
  const pg = env.DATABASE_URL || env.POSTGRES_URL;
  if (pg && env.STORE !== 'memory') return neonBackend(pg);
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (env.CF_ACCOUNT_ID && env.D1_DATABASE_ID && env.CF_API_TOKEN) return d1Backend({ account: env.CF_ACCOUNT_ID, database: env.D1_DATABASE_ID, token: env.CF_API_TOKEN });
  if (url && token) return restBackend(url, token);
  if (env.STORE === 'memory') return memoryBackend();
  if (env.STORE === 'sqlite') return sqliteBackend(env.SQLITE_FILE || '.data/coldstart.sqlite');
  const file = env.VERCEL ? '/tmp/coldstart-store.json' : path.resolve(env.STORE_FILE || '.data/store.json');
  return memoryBackend(env.VERCEL ? 'tmp-file (per instance, add KV for production)' : 'file', file);
}
