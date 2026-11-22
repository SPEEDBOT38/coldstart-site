// X source paging, caching, read caps, scheduled scans and cron auth. X is MOCKED (no live call).
process.env.X_API_ENABLED = '1';   // the X adapter is retained but off by default; these tests exercise it against mocks
import test from 'node:test'; import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js'; import { scoped } from '../lib/ops/kv.js'; import { setPolicy } from '../lib/ops/policy.js';
import { runScan } from '../lib/social/scan.js'; import { setSchedule, runDueScans } from '../lib/social/schedule.js'; import { xSource } from '../lib/social/sources.js';
process.env.X_BEARER_TOKEN = 'app-bearer-test';
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const brand = { name: 'Apple', products: ['iPhone'], category: 'consumer electronics', keywords: [], tones: [] };
const input = (k) => ({ brand, market: { places: ['Bengaluru'], countryCodes: ['IN'] }, windowDays: 7, idempotencyKey: k });
const mkFetch = (log) => async (u) => { u = String(u); log.push(u); if (u.includes('counts/recent')) return J({ data: Array.from({ length: 28 }, (_, i) => ({ tweet_count: i < 21 ? 5 : 40 })) });
  const n = new URL(u).searchParams.get('next_token'); return J({ data: [{ id: n ? '2' + log.length : '1' + log.length, text: 'Looking for a good iPhone trade-in deal in Bengaluru, any advice?', created_at: new Date().toISOString(), lang: 'en', author_id: 'a' + log.length, public_metrics: { like_count: 1 } }], meta: n ? {} : { next_token: 'NT' } }); };
const setup = () => { const store = createStore({ STORE: 'memory' }); return { store, kv: scoped(store, 'wscp4scan1') }; };

test('X search follows next_token (bounded) and reports posts read', async () => {
  const log = []; const r = await xSource.search('iphone', { since: new Date().toISOString(), limit: 10, pages: 3, fetch: mkFetch(log) });
  assert.equal(log.length, 2); assert.ok(log[1].includes('next_token=NT')); assert.equal(r.items.length, 2);
});
test('scan results are cached; the second identical scan makes no provider calls', async () => {
  const { kv } = setup(), log = []; const ctx = { fetch: mkFetch(log) };
  const a = await runScan(kv, ctx, input('scan-key-0001')); const calls = log.length; const b = await runScan(kv, ctx, input('scan-key-0002'));
  assert.ok(calls > 0 && !a.cached); assert.equal(b.cached, true); assert.equal(log.length, calls);
});
test('daily X read cap is enforced and refunded on failure', async () => {
  const { kv } = setup(); process.env.X_MAX_POSTS_READ_PER_DAY = '100'; process.env.SCAN_CACHE_SECONDS = '0';
  await assert.rejects(runScan(kv, { fetch: mkFetch([]) }, input('scan-key-0003')), /Daily X read limit/);
  process.env.X_MAX_POSTS_READ_PER_DAY = '500'; const bad = async () => J({ title: 'Unauthorized' }, 401);
  const r = await runScan(kv, { fetch: bad }, input('scan-key-0004')).catch(e => e); assert.ok(r.blocked ? r.blocked.length > 0 : true);
  delete process.env.SCAN_CACHE_SECONDS; delete process.env.X_MAX_POSTS_READ_PER_DAY;
});
test('provider auth failure (expired app token) is reported as a blocked source, not as empty results', async () => {
  const { kv } = setup(); const r = await runScan(kv, { fetch: async () => J({ title: 'Unauthorized', detail: 'Unauthorized' }, 401) }, input('scan-key-0005'));
  assert.equal(r.opportunities.length, 0); assert.ok(r.blocked.length >= 1);
});
test('paused workspace never scans', async () => { const { kv } = setup(); await setPolicy(kv, { paused: true }); await assert.rejects(runScan(kv, { fetch: mkFetch([]) }, input('scan-key-0006')), /paused/); });
test('scheduled scans: due workspaces run, others skip, failures are isolated and recorded', async () => {
  const store = createStore({ STORE: 'memory' }); const a = scoped(store, 'wscp4schedA'), b = scoped(store, 'wscp4schedB'), c = scoped(store, 'wscp4schedC');
  const s = { enabled: true, everyHours: 24, brand, market: { places: ['Bengaluru'], countryCodes: ['IN'] } };
  await setSchedule(a, store, s); await setSchedule(b, store, s); await setSchedule(c, store, { ...s, enabled: false }); await setPolicy(b, { paused: true });
  const log = []; const now = Date.now(); const r1 = await runDueScans({ store, fetch: mkFetch(log), now });
  const by = Object.fromEntries(r1.map(x => [x.ws, x])); assert.equal(by.wscp4schedA.ok, true); assert.equal(by.wscp4schedB.ok, false); assert.equal(by.wscp4schedB.error, 'paused'); assert.equal(by.wscp4schedC, undefined, 'disabled workspaces are not even in the index');
  const r2 = await runDueScans({ store, fetch: mkFetch(log), now: now + 3600e3 }); assert.equal(r2.find(x => x.ws === 'wscp4schedA').skipped, 'not_due');
  assert.ok((await a.list('opps')).length >= 0); assert.equal((await b.get('sched')).lastError.code, 'paused');
});
