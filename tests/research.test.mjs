import test from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../lib/plugins/research/index.js';
import { createStore } from '../lib/store.js';

const KEYS = ['TREG_TOKEN', 'FIRECRAWL_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'APIFY_TOKEN', 'RESEARCH_DAILY_SCANS'];
const clear = () => KEYS.forEach(k => delete process.env[k]);
const json = (b, h = {}) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json', ...h } });

function fakeNet(log) {
  return async (url, init = {}) => {
    const u = String(url); log.push({ url: u, init });
    if (u === 'https://treg.to/call/anyapi.reddit.search') return json({ result: { posts: [{ id: 'r1', title: 'How do I know when to water?', selftext: 'pots stay wet for a week', subreddit: 'houseplants', score: 64, num_comments: 29, created_utc: 1790000000 }] }, _treg: { charged_micro: 1200 } }, { 'x-treg-cost-micro': '1200' });
    if (u === 'https://treg.to/call/treg.x.search.posts') return json({ output: { posts: [{ id: '9', text: 'too many plant gadgets, I want a routine', username: 'plant_shelf', like_count: 110 }] }, _treg: {} }, { 'x-treg-cost-micro': '750' });
    if (u.startsWith('https://api.firecrawl.dev/v2/search')) return json({ success: true, data: { web: [{ url: 'https://www.instagram.com/p/AB1/', title: 'Sunday plant reset', description: '3 steps for busy flats' }] } });
    if (u === 'https://openrouter.ai/api/v1/chat/completions') {
      const prompt = JSON.parse(init.body).messages[1].content;
      const refs = [...prompt.matchAll(/"ref":\s*"([^"]+)"/g)].map(m => m[1]);
      return json({ choices: [{ message: { content: JSON.stringify({ summary: 'People want a simple routine.', themes: [{ name: 'Watering confusion', summary: 'Unsure when to water', refs: refs.slice(0, 1) }],
        signals: refs.map((ref, i) => ({ ref, intent: i ? 'Product feedback' : 'Customer pain', topic: 'watering', match: 90 - i, insight: 'Teach the soil check.', angle: 'A two-minute soil check' })) }) } }], usage: { cost: 0.001 } });
    }
    throw new Error('unexpected ' + u);
  };
}

test('treg first: sends the token header and the routed body, records cost', async () => {
  clear(); process.env.TREG_TOKEN = 'tt'; process.env.OPENROUTER_API_KEY = 'or';
  const log = [];
  const r = await scan({ store: createStore({ STORE: 'memory' }), fetch: fakeNet(log), ip: '1.1.1.1' }, { query: 'plant care', sources: ['reddit', 'x'], brand: { name: 'Fern', line: 'plant care kits' } });
  const red = log.find(l => l.url.endsWith('anyapi.reddit.search'));
  assert.equal(red.init.headers['x-treg-token'], 'tt');
  assert.equal(JSON.parse(red.init.body).query, 'plant care');
  assert.equal(JSON.parse(log.find(l => l.url.endsWith('treg.x.search.posts')).init.body).q, 'plant care');
  assert.equal(r.sources.reddit.provider, 'treg:anyapi.reddit.search');
  assert.equal(r.sources.reddit.count, 1);
  assert.ok(Math.abs(r.cost.usd - (0.0012 + 0.00075 + 0.001)) < 1e-9);
  clear();
});

test('enriched signals match the workspace signal shape', async () => {
  clear(); process.env.TREG_TOKEN = 'tt'; process.env.OPENROUTER_API_KEY = 'or';
  const r = await scan({ store: createStore({ STORE: 'memory' }), fetch: fakeNet([]), ip: '1.1.1.2' }, { query: 'plant care', sources: ['reddit', 'x'] });
  const s = r.signals.find(x => x.source === 'reddit');
  for (const k of ['id', 'source', 'where', 'up', 'score', 'rule', 'title', 'body', 'intent', 'topic', 'insight', 'angle', 'evidence', 'url']) assert.ok(k in s, k);
  assert.match(s.id, /^live-/);
  assert.equal(s.intent, 'Customer pain');
  assert.match(s.score, /^\d+% match$/);
  assert.match(s.up, /64 upvotes · 29 comments/);
  assert.match(s.evidence, /^Live/);
  assert.equal(r.summary, 'People want a simple routine.');
  assert.equal(r.themes[0].name, 'Watering confusion');
  clear();
});

test('falls back to Firecrawl when treg is not configured, and says so', async () => {
  clear(); process.env.FIRECRAWL_API_KEY = 'fc';
  const log = [];
  const r = await scan({ store: createStore({ STORE: 'memory' }), fetch: fakeNet(log), ip: '1.1.1.3' }, { query: 'plant care', sources: ['instagram'] });
  const fc = log.find(l => l.url.startsWith('https://api.firecrawl.dev'));
  assert.match(JSON.parse(fc.init.body).query, /^site:instagram\.com /);
  assert.equal(r.sources.instagram.provider, 'firecrawl');
  assert.equal(r.signals.length, 1);
  assert.equal(r.ai, 'heuristic', 'no AI key → heuristic tagging, labelled');
  assert.equal(r.signals[0].up, 'Found via web search · no engagement data');
  clear();
});

test('a source with no provider reports needs-setup instead of inventing rows', async () => {
  clear();
  const r = await scan({ store: createStore({ STORE: 'memory' }), fetch: fakeNet([]), ip: '1.1.1.4' }, { query: 'plant care', sources: ['x'] });
  assert.equal(r.sources.x.status, 'needs_setup');
  assert.match(r.sources.x.error, /TREG_TOKEN|FIRECRAWL/);
  assert.equal(r.signals.length, 0);
});

test('daily scan budget is enforced', async () => {
  clear(); process.env.FIRECRAWL_API_KEY = 'fc'; process.env.RESEARCH_DAILY_SCANS = '2';
  const ctx = { store: createStore({ STORE: 'memory' }), fetch: fakeNet([]), ip: '1.1.1.5' };
  await scan(ctx, { query: 'a b', sources: ['instagram'] });
  await scan(ctx, { query: 'a b', sources: ['instagram'] });
  await assert.rejects(() => scan(ctx, { query: 'a b', sources: ['instagram'] }), e => e.status === 429);
  clear();
});

test('rejects empty or oversized queries', async () => {
  const ctx = { store: createStore({ STORE: 'memory' }), fetch: fakeNet([]), ip: '1.1.1.6' };
  await assert.rejects(() => scan(ctx, { query: ' ', sources: ['x'] }), e => e.status === 400);
  await assert.rejects(() => scan(ctx, { query: 'x'.repeat(201), sources: ['x'] }), e => e.status === 400);
});
