// Publish outbox: authorization binding, crash/timeout safety, duplicate prevention, pause. Providers are MOCKED (fetch); nothing here touches X.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
import { scoped } from '../lib/ops/kv.js';
import { setPolicy } from '../lib/ops/policy.js';
import { markManual, refreshMetrics, createPublish, authorizePublish, editPublish, cancelPublish, runPublish, resolveUnknown, getPublish } from '../lib/ops/outbox.js';
import { integrationStatus } from '../lib/providers/adapters.js';

process.env.X_PUBLISH_ENABLED = '1';   // live publishing is opt-in; tests exercise the opted-in path against mocks
const mk = (ws = 'wsaaaaaaaa') => scoped(createStore({ STORE: 'memory' }), ws);
const payload = { channel: 'x', text: 'Fresh soil mix, 250 g.' };
const live = (fetch, extra = {}) => ({ getConn: id => id === 'x' ? { mode: 'live', secrets: { token: 't', expires: Date.now() + 3600e3 } } : null, fetch, ...extra });
const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
async function ready(kv, p = payload, key = 'idem-key-0001') {
  await setPolicy(kv, { allow: { organic: true } });
  const { job } = await createPublish(kv, { payload: p, idempotencyKey: key }); await authorizePublish(kv, job.id, { hash: job.payloadHash }); return job.id;
}

test('a post is verified by reading it back before it counts as published', async () => {
  const kv = mk(), calls = [];
  const f = async (u, o) => { calls.push([o?.method || 'GET', String(u)]); return o?.method === 'POST' ? ok({ data: { id: '123', text: 'x' } }) : ok({ data: { id: '123' } }); };
  const id = await ready(kv); const { job } = await runPublish(kv, live(f), id);
  assert.equal(job.state, 'completed'); assert.equal(job.externalId, '123'); assert.deepEqual(calls.map(c => c[0]), ['POST', 'GET']);
});
test('accepted but unreadable → unknown_external_state, never a green check; retry refused', async () => {
  const kv = mk(), f = async (u, o) => o?.method === 'POST' ? ok({ data: { id: '9' } }) : ok({ data: {} });
  const id = await ready(kv); const r = await runPublish(kv, live(f), id); assert.equal(r.job.state, 'unknown_external_state');
  await assert.rejects(() => runPublish(kv, live(f), id), /unknown/i);
});
test('a timeout during the write is ambiguous: no automatic retry, no second POST', async () => {
  const kv = mk(); let posts = 0; const f = async (u, o) => { if (o?.method === 'POST') { posts++; throw new Error('timeout'); } return ok({}); };
  const id = await ready(kv); const r = await runPublish(kv, live(f), id); assert.equal(r.unknown, true);
  await assert.rejects(() => runPublish(kv, live(f), id)); assert.equal(posts, 1);
  const j = await resolveUnknown(kv, id, { outcome: 'not_published' }); assert.equal(j.state, 'failed');
  const r2 = await runPublish(kv, live(async (u, o) => o?.method === 'POST' ? ok({ data: { id: '5' } }) : ok({ data: { id: '5' } })), id); assert.equal(r2.job.state, 'completed');
});
test('the attempt is persisted before the provider is called (crash safety)', async () => {
  const kv = mk(); let seen; const id = await ready(kv);
  const f = async (u, o) => { if (o?.method === 'POST') { seen = JSON.parse(JSON.stringify(await getPublish(kv, id))); return ok({ data: { id: '1' } }); } return ok({ data: { id: '1' } }); };
  await runPublish(kv, live(f), id); assert.equal(seen.state, 'executing'); assert.equal(seen.attempts, 1);
});
test('authorization is bound to the exact content; editing voids it', async () => {
  const kv = mk(); await setPolicy(kv, { allow: { organic: true } });
  const { job } = await createPublish(kv, { payload, idempotencyKey: 'idem-key-0002' });
  await assert.rejects(() => authorizePublish(kv, job.id, { hash: 'f'.repeat(64) }), /changed/);
  await assert.rejects(() => runPublish(kv, live(async () => ok({})), job.id), /Cannot run|authorized/i);
  await authorizePublish(kv, job.id, { hash: job.payloadHash });
  const e = await editPublish(kv, job.id, { ...payload, text: 'Different text' }); assert.equal(e.state, 'requested'); assert.equal(e.authorized, null);
  await assert.rejects(() => runPublish(kv, live(async () => ok({})), job.id));
});
test('the same idempotency key never creates a second job', async () => {
  const kv = mk(); const a = await createPublish(kv, { payload, idempotencyKey: 'idem-key-0003' }), b = await createPublish(kv, { payload, idempotencyKey: 'idem-key-0003' });
  assert.equal(b.duplicate, true); assert.equal(a.job.id, b.job.id);
});
test('Pause All and the organic switch block the external call', async () => {
  const kv = mk(); let posts = 0; const f = async (u, o) => { if (o?.method === 'POST') posts++; return ok({ data: { id: '1' } }); };
  const id = await ready(kv); await setPolicy(kv, { paused: true });
  await assert.rejects(() => runPublish(kv, live(f), id), /paused/); assert.equal(posts, 0); assert.equal((await getPublish(kv, id)).state, 'blocked');
  await setPolicy(kv, { paused: false, allow: { organic: false } }); await assert.rejects(() => runPublish(kv, live(f), id), /switched off/); assert.equal(posts, 0);
});
test('not connected, Reddit and Meta pages are blocked with an honest reason, not simulated', async () => {
  const kv = mk(); await setPolicy(kv, { allow: { organic: true } });
  const id = await ready(kv, payload, 'idem-key-0004'); const r = await runPublish(kv, { getConn: () => null, fetch: async () => ok({}) }, id);
  assert.equal(r.job.state, 'blocked'); assert.equal(r.blocked.state, 'requires_credentials');
  const st = integrationStatus({ getConn: () => null }); assert.equal(st.reddit.state, 'requires_approval'); assert.equal(st.facebook.state, 'requires_credentials'); assert.equal(st.x.integration, 'requires_credentials');
  assert.equal(integrationStatus(live(null)).x.integration, 'mock_only', 'a connected X is still labelled mock_only until a live test is recorded');
});
test('sandbox X is labelled and its fake id is never reported as a real post', async () => {
  const kv = mk(); const id = await ready(kv); const r = await runPublish(kv, { getConn: () => ({ mode: 'sandbox', secrets: {} }), fetch: null }, id);
  assert.equal(r.job.state, 'unknown_external_state', 'sandbox cannot be read back, so it can never become completed');
});
test('cancel after publish is refused; tenants cannot see each other’s jobs', async () => {
  const store = createStore({ STORE: 'memory' }), a = scoped(store, 'wsaaaaaaaa'), b = scoped(store, 'wsbbbbbbbb');
  const f = async (u, o) => ok({ data: { id: '7' } }); const id = await ready(a);
  await runPublish(a, live(f), id); await assert.rejects(() => cancelPublish(a, id), /Already published/);
  await assert.rejects(() => getPublish(b, id), /Unknown publish job/);
});

test('Reddit assisted: only a person can complete it, and it is recorded as user-attested, not platform-verified', async () => {
  const kv = mk(); await setPolicy(kv, { allow: { organic: true } });
  const { job } = await createPublish(kv, { payload: { channel: 'reddit', text: 'Disclosure: I work on Fern & Form. Try a gritty mix.' }, idempotencyKey: 'idem-key-0009' });
  await assert.rejects(() => markManual(kv, job.id, { url: 'https://www.reddit.com/r/plants/comments/abc/t/' }), /Approve this exact content/);
  await authorizePublish(kv, job.id, { hash: job.payloadHash });
  const r = await runPublish(kv, { getConn: () => null, fetch: async () => ok({}) }, job.id); assert.equal(r.job.state, 'blocked'); assert.equal(r.blocked.state, 'requires_approval');
  await assert.rejects(() => markManual(kv, job.id, { url: 'javascript:alert(1)' }), /link/);
  const j = await markManual(kv, job.id, { url: 'https://www.reddit.com/r/plants/comments/abc/t/' }); assert.equal(j.state, 'completed'); assert.equal(j.verification, 'user_attested');
  assert.equal((await refreshMetrics(kv, live(null), job.id)).metrics, null, 'no invented metrics for manual posts');
});
test('X metrics are stored as dated snapshots after a verified publish', async () => {
  const kv = mk(); const f = async (u, o) => String(u).includes('public_metrics') ? ok({ data: { id: '7', public_metrics: { like_count: 3, impression_count: 120 } } }) : ok({ data: { id: '7' } });
  const id = await ready(kv); await runPublish(kv, live(f), id); const r = await refreshMetrics(kv, live(f), id); assert.equal(r.metrics.impressions, 120); assert.equal(r.metrics.raw.impression_count, 120); assert.equal((await getPublish(kv, id)).metrics.length, 1);
});
