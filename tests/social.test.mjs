// Social Intelligence pipeline. The X API is MOCKED with fixtures shaped like the official v2 responses; no live X call is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeywords, dedupe, cluster, detectTrend, regionOf, scoreItem, runPipeline } from '../lib/social/pipeline.js';
import { xSource, redditSource, manualItem } from '../lib/social/sources.js';
import { validateDraft, draftFor } from '../lib/social/draft.js';
import { createStore } from '../lib/store.js';
import { scoped } from '../lib/ops/kv.js';
import { setPolicy } from '../lib/ops/policy.js';

const brand = { name: 'Fern & Form', category: 'potting soil', products: ['organic potting soil', 'succulent soil mix'], keywords: ['houseplants'] };
const NOW = Date.parse('2026-11-20T00:00:00Z'), day = n => new Date(NOW - n * 864e5).toISOString();

test('keywords are bounded and derived from the brand profile', () => {
  const k = buildKeywords(brand, { maxQueries: 3 }); assert.ok(k.queries.length <= 3); assert.ok(k.queries.every(q => q.q.length > 2)); assert.ok(k.brandTerms.includes('soil'));
});
test('trend: a single popular post is not a trend; one-conversation clusters are refused', () => {
  assert.equal(detectTrend({ current: 500, baseline: [] }).label, 'insufficient_data');
  assert.equal(detectTrend({ current: 40, baseline: [10, 12, 11], distinctAuthors: 1 }).label, 'insufficient_data');
  assert.equal(detectTrend({ current: 3, baseline: [2, 1, 2] }).label, 'insufficient_data', 'low volume');
});
test('trend: rising / steady / declining only against comparable baseline windows', () => {
  assert.equal(detectTrend({ current: 60, baseline: [20, 22, 18] }).label, 'rising'); assert.equal(detectTrend({ current: 21, baseline: [20, 22, 18] }).label, 'steady'); assert.equal(detectTrend({ current: 8, baseline: [30, 28, 32] }).label, 'declining');
  assert.equal(detectTrend({ current: 60, baseline: [20, 22, 18] }).ratio, 3);
});
test('region: confirmed only from a platform geo field; text match is inferred; otherwise unknown and not local', () => {
  const m = { places: ['bengaluru'], countryCodes: ['IN'] };
  assert.equal(regionOf({ text: 'x', geo: { country: 'in' } }, m).basis, 'confirmed'); assert.equal(regionOf({ text: 'Any nursery in Bengaluru?' }, m).basis, 'inferred');
  const u = regionOf({ text: 'Any nursery near me?' }, m); assert.equal(u.basis, 'unknown'); assert.equal(u.match, false);
});
test('dedupe removes same URL (tracking params ignored) and near-identical text', () => {
  const a = { url: 'https://x.com/i/web/status/1?utm_source=a', text: 'Best soil for succulents? mine keep rotting', query: 'q' };
  const out = dedupe([a, { ...a, url: 'https://www.x.com/i/web/status/1' }, { url: 'https://x.com/i/web/status/2', text: 'Best soil for succulents? mine keep rotting!', query: 'q' }, { url: 'https://x.com/i/web/status/3', text: 'Totally different topic about pots', query: 'q' }]);
  assert.equal(out.length, 2);
});
test('clustering groups related posts and labels them with real terms', () => {
  const c = cluster([{ text: 'succulent soil drainage rotting roots', url: 'a' }, { text: 'succulent soil mix drainage help', url: 'b' }, { text: 'orchid bark repotting schedule', url: 'c' }]); assert.equal(c.length, 2); assert.ok(c[0].label.includes('succulent') || c[0].label.includes('soil'));
});
test('scoring: eligibility is a hard gate — a high-relevance Reddit item gets no score; intent beats a plain discussion', () => {
  const it = { text: 'Looking for a recommendation: best soil for succulents?', title: '', createdAt: day(1) }, region = regionOf(it, {}), base = { brandTerms: ['soil', 'succulent'], trend: null, region };
  const gated = scoreItem(it, { ...base, eligibility: redditSource.eligibility() }); assert.equal(gated.score, null); assert.equal(gated.gated, true);
  const ok = scoreItem(it, { ...base, eligibility: { allowed: true } }), plain = scoreItem({ ...it, text: 'My succulent soil photo from today', createdAt: day(1) }, { ...base, eligibility: { allowed: true } });
  assert.equal(ok.opportunity_type, 'participate'); assert.ok(ok.score > plain.score); assert.notEqual(plain.opportunity_type, 'participate');
});
const xFetch = (calls) => async (url) => {
  calls.push(String(url)); const u = new URL(url);
  if (u.pathname.endsWith('/search/recent')) return new Response(JSON.stringify({ data: [
    { id: '1', text: 'Looking for the best organic potting soil for my succulents in Bengaluru, any recommendation?', created_at: day(1), author_id: 'a1', lang: 'en', public_metrics: { like_count: 4 }, geo: { place_id: 'p1' } },
    { id: '2', text: 'Looking for the best organic potting soil for my succulents in Bengaluru, any recommendation?', created_at: day(1), author_id: 'a2', lang: 'en' },
    { id: '3', text: 'Just repotted my monstera today', created_at: day(2), author_id: 'a3', lang: 'en' }], includes: { places: [{ id: 'p1', country_code: 'IN', full_name: 'Bengaluru' }] } }));
  if (u.pathname.endsWith('/counts/recent')) { const d = []; for (let w = 0; w < 4; w++) for (let i = 0; i < 7; i++) d.push({ tweet_count: w === 3 ? 12 : 3 }); return new Response(JSON.stringify({ data: d })); }
  return new Response('{}', { status: 404 });
};
test('X adapter + pipeline (mocked official responses): evidence, region, rising trend, cost, bounded calls', async () => {
  process.env.X_BEARER_TOKEN = 'test'; const calls = [];
  const out = await runPipeline({ brand, market: { places: ['Bengaluru'], countryCodes: ['IN'] }, sources: [xSource, redditSource], now: NOW, maxQueries: 2, fetch: xFetch(calls) });
  delete process.env.X_BEARER_TOKEN;
  assert.equal(calls.length, 4, '2 queries × (search + counts)'); assert.equal(out.counts.unique, 2);
  const top = out.opportunities[0]; assert.equal(top.platform, 'x'); assert.equal(top.geo.basis, 'confirmed'); assert.equal(top.trend.label, 'rising'); assert.equal(top.trend.basis, 'platform_counts'); assert.ok(top.source_url.startsWith('https://x.com/'));
  assert.ok(top.explanation.length > 30 && top.posted_at && top.fetched_at && top.cost_units !== undefined);
  assert.ok(out.blocked.some(b => b.source === 'reddit.assisted' && b.state === 'requires_approval'), 'Reddit is reported blocked, not silently skipped');
  assert.equal(out.opportunities.filter(o => o.platform === 'reddit').length, 0);
});
test('without credentials every source is reported blocked and no opportunities are invented', async () => {
  delete process.env.X_BEARER_TOKEN; const out = await runPipeline({ brand, sources: [xSource, redditSource], now: NOW, fetch: async () => { throw new Error('must not be called'); } });
  assert.equal(out.opportunities.length, 0); assert.equal(out.blocked.length, 2); assert.equal(out.blocked[0].state, 'requires_credentials');
});
test('Reddit assisted import accepts only reddit.com and never fetches', () => {
  assert.throws(() => manualItem({ url: 'https://evil.test/r/x', text: 'abc' }), /reddit/i); assert.equal(manualItem({ url: 'https://www.reddit.com/r/plants/comments/abc/t/?utm=1', text: 'help' }).manual, true);
});
test('draft rules enforced in code: reddit disclosure, X length, no unsupported claims, no links in replies', () => {
  assert.ok(validateDraft({ platform: 'reddit', text: 'Use a gritty mix.', kind: 'reply' }).some(i => /disclose/i.test(i)));
  assert.equal(validateDraft({ platform: 'reddit', text: 'Disclosure: I work on Fern & Form. Use a gritty mix.', kind: 'reply' }).length, 0);
  assert.ok(validateDraft({ platform: 'x', text: 'a'.repeat(300), kind: 'post' }).some(i => /Too long/.test(i)));
  assert.ok(validateDraft({ platform: 'x', text: 'It guarantees growth', kind: 'post' }).length); assert.ok(validateDraft({ platform: 'x', text: 'see https://a.co', kind: 'reply' }).length);
});
test('with no AI connected the draft is a labelled template that must be edited, not passed off as written content', async () => {
  for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY']) delete process.env[k];
  const d = await draftFor({ opportunity: { id: 'op_1', platform: 'reddit', opportunity_type: 'participate', title: 'Soil?', excerpt: 'help', cluster: { label: 'soil' }, source_url: 'https://reddit.com/x' }, brand: { name: 'Fern & Form' }, fetch: async () => { throw new Error('no network'); } });
  assert.equal(d.mode, 'template'); assert.equal(d.needsEdit, true); assert.match(d.text, /Disclosure/);
});
