import test from 'node:test'; import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js'; import { scoped } from '../lib/ops/kv.js'; import { setPolicy } from '../lib/ops/policy.js';
import { createPublish, authorizePublish, runPublish, refreshMetrics, markManual } from '../lib/ops/outbox.js'; import { resultsSnapshot } from '../lib/ops/results.js';
process.env.X_PUBLISH_ENABLED = '1';
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
test('observed metrics carry a timestamp; manual posts are unavailable, never zero; estimates are empty; ads are unavailable while paused', async () => {
  const store = createStore({ STORE: 'memory' }), kv = scoped(store, 'wsresults01'); await setPolicy(kv, { allow: { organic: true } });
  const f = async (u, o) => String(u).includes('public_metrics') ? J({ data: { id: '9', public_metrics: { like_count: 3, reply_count: 1, retweet_count: 2, impression_count: 120 } } }) : J({ data: { id: '9' } });
  const ctx = { getConn: id => id === 'x' ? { mode: 'live', account: { name: '@t' }, secrets: { token: 't', expires: Date.now() + 1e7 } } : null, fetch: f, store };
  const a = (await createPublish(kv, { payload: { channel: 'x', text: 'approved test' }, idempotencyKey: 'res-key-0001' })).job; await authorizePublish(kv, a.id, { hash: a.payloadHash }); await runPublish(kv, ctx, a.id); await refreshMetrics(kv, ctx, a.id);
  const b = (await createPublish(kv, { payload: { channel: 'reddit', text: 'manual one' }, idempotencyKey: 'res-key-0002' })).job; await authorizePublish(kv, b.id, { hash: b.payloadHash }); await markManual(kv, b.id, { url: 'https://www.reddit.com/r/x/comments/1/a/2/' });
  const r = await resultsSnapshot(kv, ctx); const px = r.posts.find(p => p.channel === 'x'), pr = r.posts.find(p => p.channel === 'reddit');
  assert.equal(px.provider_post_id, '9'); assert.equal(px.engagement.provenance, 'observed'); assert.ok(px.engagement.observed_at); assert.equal(px.engagement.likes, 3);
  assert.equal(pr.provider_post_id, null); assert.equal(pr.verified_by, 'user_attested'); assert.equal(pr.engagement.provenance, 'unavailable');
  assert.deepEqual(r.estimates.items, []); assert.equal(r.tracking.provenance, 'unavailable'); assert.equal(r.conversions.provenance, 'unavailable');
});
