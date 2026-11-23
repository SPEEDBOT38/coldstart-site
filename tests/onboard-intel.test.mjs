import test from 'node:test'; import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js'; import { scoped } from '../lib/ops/kv.js';
import * as OB from '../lib/onboard/intel.js';
const kv = () => scoped(createStore({ STORE: 'memory' }), 'wsintel0001');
const ctxIn = { brand: { name: 'Fern', line: 'Plant care kits. For city renters.', site: 'fern.test' }, product: { name: 'Soil Mix', price: 499, currency: 'INR' }, audience: 'city renters', country: 'IN' };
test('competitors: only approved ones reach ad research; rejected are remembered; user-added are approved', async () => {
  const k = kv(); await k.set('ob:competitors', { items: [{ id: 'a', name: 'A', domain: 'a.test', decision: 'pending' }, { id: 'b', name: 'B', domain: 'b.test', decision: 'pending' }], rejected: [] });
  await OB.decideCompetitor(k, { id: 'a', decision: 'approved' }); const r = await OB.decideCompetitor(k, { id: 'b', decision: 'rejected' });
  assert.deepEqual(r.rejected, ['b.test']); await OB.decideCompetitor(k, { add: { name: 'C Co', url: 'https://www.c.test/x' } });
  const ads = await OB.adResearch(k, { country: 'IN' });
  assert.deepEqual(ads.items.map((x) => x.domain), ['a.test', 'c.test']); assert.ok(ads.items.every((x) => x.status === 'needs_manual_review' && x.url.startsWith('https://www.facebook.com/ads/library/')));
});
test('communities: names come only from search URLs; no Reddit fetch; saved survive a refresh', async () => {
  process.env.FIRECRAWL_API_KEY = 'k'; const calls = [];
  const f = async (u) => { calls.push(String(u)); return new Response(JSON.stringify({ data: { web: [{ url: 'https://www.reddit.com/r/houseplants/comments/x/y', title: 'Help' }, { url: 'https://www.reddit.com/r/IndoorGarden/', description: 'Indoor gardening' }, { url: 'https://example.com/r/fake' }] } }), { headers: { 'content-type': 'application/json' } }); };
  const k = kv(); const r = await OB.suggestCommunities(k, { fetch: f }, ctxIn);
  assert.deepEqual(r.items.map((x) => x.name), ['r/houseplants', 'r/IndoorGarden']); assert.ok(calls.every((u) => !u.includes('reddit.com')), 'never fetches reddit');
  await OB.decideCommunity(k, { id: r.items[1].id, decision: 'saved' }); const r2 = await OB.suggestCommunities(k, { fetch: f }, ctxIn);
  assert.equal(r2.items.filter((x) => x.decision === 'saved').length, 1); assert.equal(r2.items.length, 2);
});
test('three distinct creative drafts, idempotent, editable, no images claimed', async () => {
  const k = kv(); const a = await OB.initCreatives(k, ctxIn), b = await OB.initCreatives(k, ctxIn);
  assert.equal(a.items.length, 3); assert.deepEqual(new Set(a.items.map((x) => x.layout)).size, 3); assert.equal(a.at, b.at, 'not recreated');
  assert.ok(a.items.every((x) => x.imageState === 'needs_product_photo'));
  const e = await OB.editCreative(k, { id: 'cr_spotlight', headline: 'New' }); assert.equal(e.items[0].headline, 'New'); assert.equal(e.items[0].origin, 'edited_by_user');
});
