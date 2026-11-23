import test from 'node:test'; import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js'; import { scoped } from '../lib/ops/kv.js';
import * as OB from '../lib/onboard/intel.js';
const kv = () => scoped(createStore({ STORE: 'memory' }), 'wsintel0001');
const ctxIn = { brand: { name: 'Fern', line: 'Plant care kits. For city renters.', site: 'fern.test' }, product: { name: 'Soil Mix', price: 499, currency: 'INR' }, audience: 'city renters', country: 'IN' };
test('competitors: only approved ones reach ad research; rejected are remembered; user-added are approved', async () => {
  const k = kv(), cx = OB.contextOf(ctxIn); await k.set(`ob:${cx.contextId}:competitors`, { ...cx, items: [{ id: 'a', name: 'A', domain: 'a.test', decision: 'pending' }, { id: 'b', name: 'B', domain: 'b.test', decision: 'pending' }], rejected: [] });
  await OB.decideCompetitor(k, { context: ctxIn, id: 'a', decision: 'approved' }); const r = await OB.decideCompetitor(k, { context: ctxIn, id: 'b', decision: 'rejected' });
  assert.deepEqual(r.rejected, ['b.test']); await OB.decideCompetitor(k, { context: ctxIn, add: { name: 'C Co', url: 'https://www.c.test/x' } });
  const ads = await OB.adResearch(k, { context: ctxIn });
  assert.deepEqual(ads.items.map((x) => x.domain), ['a.test', 'c.test']); assert.ok(ads.items.every((x) => x.status === 'needs_manual_review' && x.url.startsWith('https://www.facebook.com/ads/library/')));
});
test('communities: names come only from search URLs; no Reddit fetch; saved survive a refresh', async () => {
  process.env.FIRECRAWL_API_KEY = 'k'; const calls = [];
  const f = async (u) => { calls.push(String(u)); return new Response(JSON.stringify({ data: { web: [{ url: 'https://www.reddit.com/r/houseplants/comments/x/y', title: 'Help' }, { url: 'https://www.reddit.com/r/IndoorGarden/', description: 'Indoor gardening' }, { url: 'https://example.com/r/fake' }] } }), { headers: { 'content-type': 'application/json' } }); };
  const k = kv(); const r = await OB.suggestCommunities(k, { fetch: f }, ctxIn);
  assert.deepEqual(r.items.map((x) => x.name), ['r/houseplants', 'r/IndoorGarden']); assert.ok(calls.every((u) => !u.includes('reddit.com')), 'never fetches reddit');
  await OB.decideCommunity(k, { context: ctxIn, id: r.items[1].id, decision: 'saved' }); const r2 = await OB.suggestCommunities(k, { fetch: f }, ctxIn);
  assert.equal(r2.items.filter((x) => x.decision === 'saved').length, 1); assert.equal(r2.items.length, 2);
});
test('three distinct creative drafts, idempotent, editable, no images claimed', async () => {
  const k = kv(); const a = await OB.initCreatives(k, ctxIn), b = await OB.initCreatives(k, ctxIn);
  assert.equal(a.items.length, 3); assert.deepEqual(new Set(a.items.map((x) => x.layout)).size, 3); assert.equal(a.at, b.at, 'not recreated');
  assert.ok(a.items.every((x) => x.imageState === 'needs_product_photo'));
  const e = await OB.editCreative(k, { context: ctxIn, id: 'cr_spotlight', headline: 'New' }); assert.equal(e.items[0].headline, 'New'); assert.equal(e.items[0].origin, 'edited_by_user');
});

test('isolation: a second business in the same workspace sees none of the first business\'s research or approvals', async () => {
  const k = kv(); const apple = { brand: { name: 'Apple', site: 'apple.com', line: 'Computers' }, country: 'US' }, mel = { brand: { name: 'Mellooo', site: 'https://www.mellooo.co.in/', line: 'Chocolate dragees' }, country: 'IN' };
  const ca = OB.contextOf(apple); await k.set(`ob:${ca.contextId}:competitors`, { ...ca, items: [{ id: 's', name: 'Sony', domain: 'sony.com', decision: 'approved' }], rejected: [] });
  await OB.initCreatives(k, apple); await OB.adResearch(k, { context: apple });
  const snap = await OB.intelSnapshot(k, { site: 'mellooo.co.in', brand: 'Mellooo', country: 'IN' });
  assert.equal(snap.competitors, null); assert.equal(snap.creatives, null); assert.equal(snap.ads, null);
  assert.notEqual(OB.contextOf(mel).contextId, ca.contextId);
  const ads = await OB.adResearch(k, { context: mel }); assert.equal(ads.items.length, 0, 'Apple approvals never feed Mellooo ad research');
  const own = await OB.intelSnapshot(k, { site: 'apple.com', brand: 'Apple' }); assert.equal(own.competitors.items[0].name, 'Sony', 'Apple keeps its own data');
});
test('isolation: a record whose stored context does not match is quarantined on read', async () => {
  const k = kv(); const cx = OB.contextOf({ brand: { name: 'Mellooo', site: 'mellooo.co.in' } });
  await k.set(`ob:${cx.contextId}:competitors`, { contextId: 'ctx_someoneelse', items: [{ name: 'Sony', decision: 'approved' }] });
  const snap = await OB.intelSnapshot(k, { site: 'mellooo.co.in', brand: 'Mellooo' }); assert.equal(snap.competitors, null);
});
test('approval is never implied: discovered suggestions start as pending', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../lib/onboard/intel.js', import.meta.url), 'utf8');
  assert.match(src, /origin: 'ai_suggested'[\s\S]{0,400}decision: 'pending'/);
});
