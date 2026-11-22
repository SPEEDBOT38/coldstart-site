// Atomic quota ledger + durable stores. 100 simultaneous requests against: memory, SQLite (real, file-backed) and a D1 adapter whose REST endpoint is a SQLite-backed fake (SQL dialect is exercised; Cloudflare itself is not).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createStore, sqliteBackend, d1Backend } from '../lib/store.js';
import { scoped } from '../lib/ops/kv.js';
import { setPolicy } from '../lib/ops/policy.js';
import { reserve, settle, release, metered, expenses } from '../lib/ops/ledger.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  return async (url, o) => {
    const { sql, params } = JSON.parse(o.body); const st = db.prepare(sql);
    await new Promise(r => setImmediate(r));                                   // force real interleaving between requests
    if (/^\s*(SELECT|INSERT[\s\S]*RETURNING)/i.test(sql) && /RETURNING|SELECT/i.test(sql)) return new Response(JSON.stringify({ success: true, result: [{ results: st.all(...params), meta: {} }] }));
    const r = st.run(...params); return new Response(JSON.stringify({ success: true, result: [{ results: [], meta: { changes: Number(r.changes) } }] }));
  };
}
const backends = {
  memory: () => createStore({ STORE: 'memory' }),
  sqlite: () => sqliteBackend(':memory:'),
  d1: () => d1Backend({ account: 'a', database: 'd', token: 't', fetchImpl: fakeD1() }),
};
for (const [name, mk] of Object.entries(backends)) {
  test(`[${name}] 100 simultaneous reservations against a cap of 10 → exactly 10 succeed, the counter never exceeds the cap`, async () => {
    const kv = scoped(mk(), 'wsaaaaaaaa'); await setPolicy(kv, { caps: { credits: 10 } });
    const r = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => reserve(kv, { kind: 'creative', idem: 'req-unique-' + i })));
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 10); assert.ok(r.filter(x => x.status === 'rejected').every(x => x.reason.status === 429));
    assert.equal(await kv.get('cnt:creative:' + new Date().toISOString().slice(0, 7)), 10);
  });
  test(`[${name}] the same idempotency key submitted 100 times reserves once`, async () => {
    const kv = scoped(mk(), 'wsaaaaaaaa'); await setPolicy(kv, { caps: { credits: 50 } });
    const r = await Promise.all(Array.from({ length: 100 }, () => reserve(kv, { kind: 'creative', idem: 'one-key-for-all' })));
    assert.equal(r.filter(x => !x.duplicate).length, 1); assert.equal(await kv.get('cnt:creative:' + new Date().toISOString().slice(0, 7)), 1);
  });
  test(`[${name}] settle and release are exactly-once; released units are reusable; settled ones are not`, async () => {
    const kv = scoped(mk(), 'wsaaaaaaaa'); await setPolicy(kv, { caps: { credits: 2 } }); const mo = new Date().toISOString().slice(0, 7);
    await reserve(kv, { kind: 'creative', idem: 'job-a-0001' }); await reserve(kv, { kind: 'creative', idem: 'job-b-0001' });
    await assert.rejects(() => reserve(kv, { kind: 'creative', idem: 'job-c-0001' }), /reached/);
    const rel = await Promise.all(Array.from({ length: 20 }, () => release(kv, 'job-a-0001'))); assert.equal(rel.filter(x => !x.duplicate).length, 1);
    assert.equal(await kv.get('cnt:creative:' + mo), 1);
    const set = await Promise.all(Array.from({ length: 20 }, () => settle(kv, 'job-b-0001', { actualUsd: 0.04 }))); assert.equal(set.filter(x => !x.duplicate).length, 1);
    assert.equal((await release(kv, 'job-b-0001')).state, 'settled', 'a settled reservation cannot be released'); assert.equal(await kv.get('cnt:creative:' + mo), 1);
    const ex = await expenses(kv); assert.equal(ex.entries.length, 1); assert.equal(ex.aiApiMicroUsd, 40000); assert.equal(ex.entries[0].bucket, 'ai_api');
    await reserve(kv, { kind: 'creative', idem: 'job-c-0002' });
  });
  test(`[${name}] a failed provider call releases its units (retry with a new key succeeds)`, async () => {
    const kv = scoped(mk(), 'wsaaaaaaaa'); await setPolicy(kv, { caps: { credits: 1 } });
    await assert.rejects(() => metered(kv, { kind: 'creative', idem: 'fail-try-0001' }, async () => { throw new Error('provider down'); }), /provider down/);
    const out = await metered(kv, { kind: 'creative', idem: 'fail-try-0002' }, async () => ({ usd: 0.01 })); assert.equal(out.usd, 0.01);
    await assert.rejects(() => metered(kv, { kind: 'creative', idem: 'fail-try-0003' }, async () => ({})), /reached/);
  });
}
test('tenants have separate counters, Pause All refuses reservations, a missing idempotency key is refused', async () => {
  const store = createStore({ STORE: 'memory' }), a = scoped(store, 'wsaaaaaaaa'), b = scoped(store, 'wsbbbbbbbb');
  await setPolicy(a, { caps: { credits: 1 } }); await reserve(a, { kind: 'creative', idem: 'tenant-a-0001' }); await reserve(b, { kind: 'creative', idem: 'tenant-b-0001' });
  await setPolicy(b, { paused: true }); await assert.rejects(() => reserve(b, { kind: 'creative', idem: 'tenant-b-0002' }), e => e.status === 423);
  await assert.rejects(() => reserve(a, { kind: 'creative', idem: '' }), e => e.status === 400);
});
test('SQLite is durable across a restart and atomic across two connections to the same file', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-')), 'db.sqlite'); const s1 = sqliteBackend(file), s2 = sqliteBackend(file);
  const k1 = scoped(s1, 'wsaaaaaaaa'), k2 = scoped(s2, 'wsaaaaaaaa'); await setPolicy(k1, { caps: { credits: 10 } });
  const r = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => reserve(i % 2 ? k1 : k2, { kind: 'creative', idem: 'two-conn-' + i })));
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 10);
  await k1.set('master:m1', { name: 'durable' }); s1.db.close(); s2.db.close();
  const k3 = scoped(sqliteBackend(file), 'wsaaaaaaaa'); assert.deepEqual(await k3.get('master:m1'), { name: 'durable' }); assert.equal(await k3.get('cnt:creative:' + new Date().toISOString().slice(0, 7)), 10);
});
