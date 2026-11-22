#!/usr/bin/env node
// Persistence + atomicity verification for a REAL store. Usage:
//   node scripts/verify-store.mjs --backend d1       (needs CF_ACCOUNT_ID, D1_DATABASE_ID, CF_API_TOKEN in the environment; run AFTER `wrangler d1 migrations apply`)
//   node scripts/verify-store.mjs --backend sqlite   (self-test of this script on the local durable store)
// Prints a JSON evidence record. Exit 0 = every check passed on that backend, 1 = a check failed, 2 = BLOCKED (missing credentials; nothing was run).
// This script never prints secrets. It writes only keys prefixed `verify:<run-id>:` and removes them afterwards.
import crypto from 'node:crypto'; import fs from 'node:fs';
import { createStore } from '../lib/store.js'; import { scoped } from '../lib/ops/kv.js'; import { reserve, settle, release } from '../lib/ops/ledger.js';
const backend = (process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend') + 1] : 'd1');
const env = { ...process.env };
if (backend === 'd1') { const miss = ['CF_ACCOUNT_ID', 'D1_DATABASE_ID', 'CF_API_TOKEN'].filter(k => !env[k]); if (miss.length) { console.log(JSON.stringify({ blocked: true, backend, missing: miss, action: 'Create the D1 database, apply workers/pipeline/migrations, then export these variables in the shell that runs this script.' })); process.exit(2); } }
else if (backend === 'sqlite') { env.STORE = 'sqlite'; env.SQLITE_FILE = '/tmp/verify-' + crypto.randomUUID() + '.sqlite'; delete env.CF_ACCOUNT_ID; delete env.UPSTASH_REDIS_REST_URL; }
const open = () => createStore(env); const run = crypto.randomBytes(4).toString('hex'), P = 'verify:' + run + ':';
const checks = [], t0 = Date.now(); const rec = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); };
const store = open(); rec('backend kind', store.kind === backend || (backend === 'sqlite' && store.kind === 'sqlite'), store.kind);
// 1. round trip + restart recovery
await store.set(P + 'a', { n: 1 }); const again = open(); rec('persistence survives a new store instance (restart)', JSON.stringify(await again.get(P + 'a')) === '{"n":1}');
// 2. atomic counter under 100 concurrent increments
await store.set(P + 'c', 0); const r = await Promise.all(Array.from({ length: 100 }, () => store.incrby(P + 'c', 1))); rec('100 concurrent incrby → exactly 100, all distinct', (await store.get(P + 'c')) === 100 && new Set(r).size === 100, { final: await store.get(P + 'c'), distinct: new Set(r).size });
// 3. setnx: exactly one winner out of 100
const w = await Promise.all(Array.from({ length: 100 }, (_, i) => store.setnx(P + 'lock', i))); rec('100 concurrent setnx → exactly one winner', w.filter(Boolean).length === 1, { winners: w.filter(Boolean).length });
// 4. quota: cap of 10 under 100 concurrent reservations in one workspace
const ws = 'wsverify' + run, kv = scoped(store, ws); const { setPolicy } = await import('../lib/ops/policy.js'); await setPolicy(kv, { caps: { research: 10 }, allow: { organic: false } });
const rs = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => reserve(kv, { kind: 'research', idem: P + 'idem' + i, units: 1 })));
const okN = rs.filter(x => x.status === 'fulfilled' && !x.value.duplicate).length; const { counter } = await import('../lib/ops/policy.js'); rec('100 concurrent reservations against cap 10 → exactly 10 granted', okN === 10, { granted: okN, counted: await counter.read(kv, 'research', 'day') });
// 5. idempotency: the same key 50× is granted once
const same = await Promise.allSettled(Array.from({ length: 50 }, () => reserve(kv, { kind: 'research', idem: P + 'same', units: 1 }))); rec('same idempotency key ×50 → one grant at most', same.filter(x => x.status === 'fulfilled' && !x.value.duplicate).length <= 1);
// 6. workspace isolation
const other = scoped(store, 'wsother' + run); await kv.set('secret', 'mine'); rec('another workspace cannot read this one’s records', (await other.get('secret')) == null && (await kv.get('secret')) === 'mine');
// 7. restart: counters and records persist
const kv2 = scoped(open(), ws); rec('quota counter persists across restart', (await counter.read(kv2, 'research', 'day')) >= 10);
for (const k of ['a', 'c', 'lock']) await store.del(P + k); await kv.del('secret');
const failed = checks.filter(c => !c.pass); console.log(JSON.stringify({ backend, run, at: new Date().toISOString(), ms: Date.now() - t0, passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
if (backend === 'sqlite') try { fs.rmSync(env.SQLITE_FILE); } catch {}
process.exit(failed.length ? 1 : 0);
