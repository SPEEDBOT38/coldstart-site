// Store verification that runs against whatever store the process is configured with (used by scripts/verify-store.mjs and by the CRON_SECRET-guarded /api/diag/store route, so it can run INSIDE the deployed function against the deployed database).
import crypto from 'node:crypto';
import { scoped } from './kv.js'; import { reserve } from './ledger.js'; import { setPolicy, counter } from './policy.js';
export async function verifyStore(open) {
  const checks = [], t0 = Date.now(), rec = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const run = crypto.randomBytes(4).toString('hex'), P = 'verify:' + run + ':', store = open();
  rec('backend kind', true, store.kind);
  await store.set(P + 'a', { n: 1 }); rec('persistence survives a new store instance (restart)', JSON.stringify(await open().get(P + 'a')) === '{"n":1}');
  await store.set(P + 'c', 0); const r = await Promise.all(Array.from({ length: 100 }, () => store.incrby(P + 'c', 1))); rec('100 concurrent incrby → exactly 100, all distinct', (await store.get(P + 'c')) === 100 && new Set(r).size === 100, { distinct: new Set(r).size });
  const w = await Promise.all(Array.from({ length: 100 }, (_, i) => store.setnx(P + 'lock', i))); rec('100 concurrent setnx → exactly one winner', w.filter(Boolean).length === 1, { winners: w.filter(Boolean).length });
  const ws = 'wsverify' + run, kv = scoped(store, ws); await setPolicy(kv, { caps: { research: 10 } });
  const rs = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => reserve(kv, { kind: 'research', idem: P + 'idem' + i, units: 1 }))); const okN = rs.filter(x => x.status === 'fulfilled' && !x.value.duplicate).length;
  rec('100 concurrent reservations against cap 10 → exactly 10 granted', okN === 10, { granted: okN, counted: await counter.read(kv, 'research', 'day') });
  const same = await Promise.allSettled(Array.from({ length: 50 }, () => reserve(kv, { kind: 'research', idem: P + 'same', units: 1 }))); rec('same idempotency key ×50 → at most one grant', same.filter(x => x.status === 'fulfilled' && !x.value.duplicate).length <= 1);
  const other = scoped(store, 'wsother' + run); await kv.set('secret', 'mine'); rec('another workspace cannot read this one’s records', (await other.get('secret')) == null && (await kv.get('secret')) === 'mine');
  rec('quota counter persists across restart', (await counter.read(scoped(open(), ws), 'research', 'day')) >= 10);
  for (const k of ['a', 'c', 'lock']) await store.del(P + k); await kv.del('secret');
  const failed = checks.filter(c => !c.pass); return { run, at: new Date().toISOString(), ms: Date.now() - t0, store: store.kind, passed: checks.length - failed.length, failed: failed.length, checks };
}
