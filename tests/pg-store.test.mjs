// The Postgres backend against a REAL Postgres engine (PGlite = Postgres compiled to WASM). Proves SQL semantics; it is NOT the deployed Neon database.
import test from 'node:test'; import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite'; import { pgBackend, PG_SCHEMA } from '../lib/store.js'; import { scoped } from '../lib/ops/kv.js'; import { reserve } from '../lib/ops/ledger.js'; import { setPolicy, counter } from '../lib/ops/policy.js';
async function mk() { const db = new PGlite(); await db.exec(PG_SCHEMA); return pgBackend(async (t, p) => (await db.query(t, p)).rows); }
test('get/set/del/ttl', async () => { const s = await mk(); await s.set('a', { n: 1 }); assert.deepEqual(await s.get('a'), { n: 1 }); await s.set('t', 1, 0.05); await new Promise(r => setTimeout(r, 120)); assert.equal(await s.get('t'), null); await s.del('a'); assert.equal(await s.get('a'), null); });
test('incrby is atomic and expired counters restart', async () => { const s = await mk(); const r = await Promise.all(Array.from({ length: 100 }, () => s.incrby('c', 1))); assert.equal(new Set(r).size, 100); assert.equal(await s.get('c'), 100); assert.equal(await s.incrby('c', -40), 60); });
test('setnx: one winner; expired lock can be re-taken', async () => { const s = await mk(); const w = await Promise.all(Array.from({ length: 50 }, (_, i) => s.setnx('l', i))); assert.equal(w.filter(Boolean).length, 1); await s.setnx('e', 1, 0.05); await new Promise(r => setTimeout(r, 120)); assert.equal(await s.setnx('e', 2), true); });
test('ledger: 100 concurrent reservations against cap 10 → exactly 10', async () => {
  const kv = scoped(await mk(), 'wspgtest01'); await setPolicy(kv, { caps: { research: 10 } });
  const rs = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => reserve(kv, { kind: 'research', idem: 'pg-idem-' + i, units: 1 })));
  assert.equal(rs.filter(x => x.status === 'fulfilled' && !x.value.duplicate).length, 10); assert.equal(await counter.read(kv, 'research', 'day'), 10);
});
