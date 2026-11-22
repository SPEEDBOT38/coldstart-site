// Failure-path tests for X / Facebook / Instagram adapters. Providers are MOCKED: these prove our handling, not the providers' behaviour.
import test from 'node:test'; import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js'; import { scoped } from '../lib/ops/kv.js'; import { setPolicy } from '../lib/ops/policy.js';
import { createPublish, authorizePublish, runPublish, getPublish } from '../lib/ops/outbox.js'; import { classify } from '../lib/providers/classify.js';
import { PluginError } from '../lib/plugins/http.js';
process.env.X_PUBLISH_ENABLED = '1'; process.env.META_PUBLISH_ENABLED = '1'; process.env.META_PAGE_ID = '1234567890';
const mk = () => scoped(createStore({ STORE: 'memory' }), 'wscp4aaaaa');
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const xconn = (o = {}) => ({ mode: 'live', account: { id: '1', name: '@test_acct' }, secrets: { token: 't', refresh: 'r', expires: Date.now() + 3600e3, ...o } });
const ctxOf = (conns, fetch) => { const c = { ...conns }; return { getConn: id => c[id] || null, setConnFor: (id, p) => { c[id] = { ...c[id], ...p }; }, fetch, _c: c }; };
async function job(kv, p, key) { await setPolicy(kv, { allow: { organic: true } }); const { job } = await createPublish(kv, { payload: p, idempotencyKey: key }); await authorizePublish(kv, job.id, { hash: job.payloadHash }); return job.id; }

test('classify: 401→auth, 429→rate_limit, 403 duplicate/permission, 4xx→not ambiguous, 5xx/network→ambiguous', () => {
  const e = (http, m = 'x') => new PluginError(m, http >= 500 ? 502 : 400, {}, http);
  assert.equal(classify(e(401)).kind, 'auth'); assert.equal(classify(e(429)).kind, 'rate_limit'); assert.equal(classify(e(429)).retryable, true);
  assert.equal(classify(e(403, 'You are not allowed to create a Tweet with duplicate content.')).kind, 'duplicate'); assert.equal(classify(e(403)).kind, 'permission');
  assert.equal(classify(e(400)).ambiguous, false); assert.equal(classify(e(503)).ambiguous, true); assert.equal(classify(new PluginError('Network error', 502)).ambiguous, true);
});
test('X: expired token is refreshed once and persisted; the new token is used', async () => {
  const kv = mk(), seen = [];
  const f = async (u, o) => { seen.push([String(u), o?.headers?.authorization]); if (String(u).includes('oauth2/token')) return J({ access_token: 'new', refresh_token: 'r2', expires_in: 7200 }); return o?.method === 'POST' ? J({ data: { id: '77' } }) : J({ data: { id: '77' } }); };
  process.env.X_CLIENT_ID = 'cid'; const ctx = ctxOf({ x: xconn({ expires: Date.now() - 1000 }) }, f);
  const r = await runPublish(kv, ctx, await job(kv, { channel: 'x', text: 'approved test post' }, 'cp4-key-0001')); delete process.env.X_CLIENT_ID;
  assert.equal(r.job.state, 'completed'); assert.equal(ctx._c.x.secrets.token, 'new'); assert.ok(seen.some(([u, a]) => u.endsWith('/2/tweets') && a === 'Bearer new'));
});
test('X: refresh failure → auth failure, nothing posted, not ambiguous', async () => {
  const kv = mk(); let posted = false; process.env.X_CLIENT_ID = 'cid';
  const f = async (u, o) => { if (String(u).includes('oauth2/token')) return J({ error: 'invalid_request' }, 400); posted = true; return J({}); };
  const r = await runPublish(kv, ctxOf({ x: xconn({ expires: Date.now() - 1 }) }, f), await job(kv, { channel: 'x', text: 'approved test post' }, 'cp4-key-0002')); delete process.env.X_CLIENT_ID;
  assert.equal(r.job.state, 'failed'); assert.equal(r.job.error.code, 'auth'); assert.equal(r.job.error.retryable, false); assert.equal(posted, false);
});
test('X: designated test account guard blocks other accounts before any call', async () => {
  const kv = mk(); process.env.X_ALLOWED_ACCOUNT = '@someone_else'; let called = false;
  const r = await runPublish(kv, ctxOf({ x: xconn() }, async () => { called = true; return J({}); }), await job(kv, { channel: 'x', text: 'approved test post' }, 'cp4-key-0003')); delete process.env.X_ALLOWED_ACCOUNT;
  assert.equal(r.job.state, 'failed'); assert.match(r.job.error.message, /designated test account/); assert.equal(called, false);
});
test('X: 429 and spend-cap errors are failures (not ambiguous) with the right codes', async () => {
  for (const [status, body, code] of [[429, { title: 'Too Many Requests' }, 'rate_limit'], [402, { title: 'CreditsDepleted', detail: 'credits' }, 'quota'], [403, { detail: 'You are not permitted to create a Tweet with duplicate content.' }, 'duplicate']]) {
    const kv = mk(); const r = await runPublish(kv, ctxOf({ x: xconn() }, async () => J(body, status)), await job(kv, { channel: 'x', text: 'approved test post' }, 'cp4-key-' + status));
    assert.equal(r.job.state, 'failed'); assert.equal(r.job.error.code, code);
  }
});
test('X: publish disabled unless the owner opts in', async () => {
  const kv = mk(); delete process.env.X_PUBLISH_ENABLED; let called = false;
  const r = await runPublish(kv, ctxOf({ x: xconn() }, async () => { called = true; return J({}); }), await job(kv, { channel: 'x', text: 'approved test post' }, 'cp4-key-0004')); process.env.X_PUBLISH_ENABLED = '1';
  assert.equal(r.job.state, 'blocked'); assert.equal(r.blocked.state, 'requires_approval'); assert.equal(called, false);
});
test('daily publish cap is enforced server-side', async () => {
  const kv = mk(); process.env.PUBLISH_DAILY_CAP = '1'; const f = async (u, o) => J({ data: { id: String(Math.random()).slice(2, 8) } });
  const a = await runPublish(kv, ctxOf({ x: xconn() }, async (u, o) => J({ data: { id: '5' } })), await job(kv, { channel: 'x', text: 'approved test post' }, 'cp4-key-0005'));
  const id2 = (await createPublish(kv, { payload: { channel: 'x', text: 'second approved post' }, idempotencyKey: 'cp4-key-0006' })).job; await authorizePublish(kv, id2.id, { hash: id2.payloadHash });
  const b = await runPublish(kv, ctxOf({ x: xconn() }, f), id2.id); delete process.env.PUBLISH_DAILY_CAP;
  assert.equal(a.job.state, 'completed'); assert.equal(b.job.state, 'blocked'); assert.equal(b.job.error.code, 'daily_cap');
});
test('Facebook: posts to the designated Page with a Page token, reads the post back, returns the provider id', async () => {
  const kv = mk(), calls = [];
  const f = async (u, o) => { u = String(u); calls.push([o?.method || 'GET', u.split('?')[0]]); if (u.includes('1234567890?') ) return J({ access_token: 'PT', instagram_business_account: { id: '999' } }); if (u.endsWith('/feed')) return J({ id: '1234567890_555' }); return J({ id: '1234567890_555', created_time: 'now' }); };
  const r = await runPublish(kv, ctxOf({ meta: { mode: 'live', secrets: { token: 'U' } } }, f), await job(kv, { channel: 'facebook', text: 'approved test post' }, 'cp4-key-0007'));
  assert.equal(r.job.state, 'completed'); assert.equal(r.job.externalId, '1234567890_555'); assert.ok(calls.some(c => c[0] === 'POST' && c[1].endsWith('/1234567890/feed')));
});
test('Facebook: permission error (no App Review) is a clear non-ambiguous failure', async () => {
  const kv = mk(); const f = async (u) => String(u).includes('1234567890?') ? J({ access_token: 'PT' }) : J({ error: { message: '(#200) requires pages_manage_posts', code: 200 } }, 403);
  const r = await runPublish(kv, ctxOf({ meta: { mode: 'live', secrets: { token: 'U' } } }, f), await job(kv, { channel: 'facebook', text: 'approved test post' }, 'cp4-key-0008'));
  assert.equal(r.job.state, 'failed'); assert.equal(r.job.error.code, 'permission');
});
test('Instagram: requires an image URL; two-step container → publish; text-only refused', async () => {
  const kv = mk(), calls = [];
  const f = async (u, o) => { u = String(u); calls.push(u.split('?')[0].split('/').slice(-2).join('/')); if (u.includes('1234567890?')) return J({ access_token: 'PT', instagram_business_account: { id: '999' } }); if (u.endsWith('/999/media')) return J({ id: 'c1' }); if (u.endsWith('/media_publish')) return J({ id: 'm1' }); return J({ id: 'm1', permalink: 'https://instagram.com/p/x' }); };
  const ok = await runPublish(kv, ctxOf({ meta: { mode: 'live', secrets: { token: 'U' } } }, f), await job(kv, { channel: 'instagram', text: 'approved test caption', imageUrl: 'https://example.com/a.jpg' }, 'cp4-key-0009'));
  assert.equal(ok.job.state, 'completed'); assert.equal(ok.job.externalId, 'm1');
  const kv2 = mk(); const bad = await runPublish(kv2, ctxOf({ meta: { mode: 'live', secrets: { token: 'U' } } }, f), await job(kv2, { channel: 'instagram', text: 'no image here' }, 'cp4-key-0010'));
  assert.equal(bad.job.state, 'failed'); assert.match(bad.job.error.message, /image/i);
});
test('Meta publishing stays blocked until the owner opts in (App Review)', async () => {
  const kv = mk(); delete process.env.META_PUBLISH_ENABLED; let called = false;
  const r = await runPublish(kv, ctxOf({ meta: { mode: 'live', secrets: { token: 'U' } } }, async () => { called = true; return J({}); }), await job(kv, { channel: 'facebook', text: 'approved test post' }, 'cp4-key-0011')); process.env.META_PUBLISH_ENABLED = '1';
  assert.equal(r.job.state, 'blocked'); assert.equal(called, false);
});
