import test from 'node:test';
import assert from 'node:assert/strict';
import { draftPost, PLATFORM_RULES } from '../lib/plugins/studio.js';
import { createStore } from '../lib/store.js';

const json = b => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const model = out => { const calls = []; return { calls, fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return json({ choices: [{ message: { content: JSON.stringify(out) } }], usage: { cost: 0.0003 } }); } }; };
const ctx = f => ({ store: createStore({ STORE: 'memory' }), fetch: f, ip: '9.9.9.9' });
const signal = { title: 'How do I know when to water?', body: 'pots stay wet', source: 'reddit', where: 'r/houseplants', insight: 'Teach the soil check', angle: 'Two-minute soil check', url: 'https://reddit.com/r/houseplants/x' };
const brand = { name: 'Fern & Form', line: 'plant care kits', voice: 'warm, practical', avoid: 'miracle' };

test('every publishing destination has rules', () => {
  for (const p of ['reddit', 'x', 'instagram', 'facebook', 'shopify']) assert.ok(PLATFORM_RULES[p], p);
});

test('X drafts are clipped to 280 characters on a word boundary', async () => {
  process.env.OPENROUTER_API_KEY = 'or';
  const m = model({ title: 'Soil check', body: 'word '.repeat(90).trim() });
  const d = await draftPost(ctx(m.fetch), { platform: 'x', signal, brand });
  assert.ok(d.body.length <= 280, d.body.length);
  assert.ok(!d.body.endsWith(' '));
  assert.match(m.calls[0].messages[1].content, /280/);
  assert.match(m.calls[0].messages[1].content, /How do I know when to water\?/, 'grounded in the source signal');
  assert.match(m.calls[0].messages[1].content, /miracle/, 'brand avoid-list passed to the model');
  delete process.env.OPENROUTER_API_KEY;
});

test('Reddit drafts strip links and keep a title', async () => {
  process.env.OPENROUTER_API_KEY = 'or';
  const m = model({ title: 'A two-minute soil check', body: 'Push a finger in. Buy ours at https://fern.shop/kit today.' });
  const d = await draftPost(ctx(m.fetch), { platform: 'reddit', signal, brand });
  assert.ok(!/https?:\/\//.test(d.body));
  assert.equal(d.title, 'A two-minute soil check');
  delete process.env.OPENROUTER_API_KEY;
});

test('Instagram returns alt text and Shopify returns an SEO title', async () => {
  process.env.OPENROUTER_API_KEY = 'or';
  let d = await draftPost(ctx(model({ title: 't', body: 'caption', altText: 'A hand pressing soil' }).fetch), { platform: 'instagram', signal, brand });
  assert.equal(d.altText, 'A hand pressing soil');
  d = await draftPost(ctx(model({ title: 'Guide', body: 'long article', seoTitle: 'How to check soil moisture' }).fetch), { platform: 'shopify', signal, brand });
  assert.equal(d.seoTitle, 'How to check soil moisture');
  delete process.env.OPENROUTER_API_KEY;
});

test('without an AI key it refuses instead of faking a draft', async () => {
  delete process.env.OPENROUTER_API_KEY; delete process.env.GEMINI_API_KEY;
  await assert.rejects(() => draftPost(ctx(async () => { throw new Error('no net'); }), { platform: 'x', signal, brand }), e => e.status === 503);
});

test('unknown platform is a 400', async () => {
  await assert.rejects(() => draftPost(ctx(fetch), { platform: 'myspace', signal, brand }), e => e.status === 400);
});
