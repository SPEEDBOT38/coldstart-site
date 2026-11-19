import test from 'node:test';
import assert from 'node:assert/strict';
import { generateImage } from '../lib/plugins/images.js';
import { createStore } from '../lib/store.js';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
function net(log, { fail } = {}) {
  return async (url, init = {}) => {
    const u = String(url); log.push({ url: u, init });
    if (u.startsWith('https://img.test')) {
      if (fail) return new Response(JSON.stringify({ error: 'Generation failed: capacity' }), { status: 502, headers: { 'content-type': 'application/json' } });
      return new Response(JPG, { status: 200, headers: { 'content-type': 'image/jpeg', 'x-model': '@cf/black-forest-labs/flux-1-schnell', 'x-ms': '1900' } });
    }
    if (u === 'https://openrouter.ai/api/v1/chat/completions') return new Response(JSON.stringify({ choices: [{ message: { content: '{"prompt":"overhead photo of a hand pressing soil in a terracotta pot, soft daylight, no text"}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error('unexpected ' + u);
  };
}
const ctx = (f, store = createStore({ STORE: 'memory' })) => ({ store, fetch: f, ip: '7.7.7.7' });
// These tests cover the FLUX path on Cloudflare (IMAGE_ENGINE=flux); the Gemini path has its own test at the end.
const setEnv = () => { process.env.IMAGE_API_URL = 'https://img.test'; process.env.IMAGE_API_KEY = 'secret-key'; process.env.OPENROUTER_API_KEY = 'or'; process.env.IMAGE_ENGINE = 'flux'; };
const clear = () => { for (const k of ['IMAGE_API_URL', 'IMAGE_API_KEY', 'OPENROUTER_API_KEY', 'IMAGE_DAILY_LIMIT', 'IMAGE_ENGINE']) delete process.env[k]; };
const post = { platform: 'instagram', title: 'Two-minute soil check', body: 'Push a finger in to the second knuckle before you water.' };

test('Gemini writes the image prompt from the post, then the worker draws it', async () => {
  setEnv(); const log = [];
  const r = await generateImage(ctx(net(log)), { post, brand: { name: 'Fern', line: 'plant kits', avoid: 'miracle' } });
  const ai = log.find(l => l.url.includes('openrouter'));
  assert.match(JSON.parse(ai.init.body).messages[1].content, /Two-minute soil check/);
  const w = log.find(l => l.url.startsWith('https://img.test'));
  assert.equal(w.init.headers.authorization, 'Bearer secret-key');
  const sent = JSON.parse(w.init.body);
  assert.match(sent.prompt, /hand pressing soil/);
  assert.equal(r.image, 'data:image/jpeg;base64,' + JPG.toString('base64'));
  assert.equal(r.model, '@cf/black-forest-labs/flux-1-schnell');
  assert.match(r.prompt, /hand pressing soil/);
  clear();
});

test('an explicit prompt skips Gemini; SDXL gets the platform aspect', async () => {
  setEnv(); const log = [];
  await generateImage(ctx(net(log)), { prompt: 'cobalt sticker of a watering can', model: 'sdxl', post: { platform: 'instagram' } });
  assert.ok(!log.some(l => l.url.includes('openrouter')));
  const sent = JSON.parse(log[0].init.body);
  assert.equal(sent.prompt, 'cobalt sticker of a watering can');
  assert.equal(sent.width, 816); assert.equal(sent.height, 1024);
  clear();
});

test('worker errors surface as a readable 502', async () => {
  setEnv();
  await assert.rejects(() => generateImage(ctx(net([], { fail: true })), { prompt: 'x' }), e => e.status === 502 && /capacity/.test(e.message));
  clear();
});

test('needs the worker configured, and says which keys', async () => {
  clear();
  await assert.rejects(() => generateImage(ctx(net([])), { prompt: 'x' }), e => e.status === 503 && /IMAGE_API_URL/.test(e.message));
});

test('daily image cap protects the free neuron budget', async () => {
  setEnv(); process.env.IMAGE_DAILY_LIMIT = '2';
  const c = ctx(net([]));
  await generateImage(c, { prompt: 'a' }); await generateImage(c, { prompt: 'b' });
  await assert.rejects(() => generateImage(c, { prompt: 'c' }), e => e.status === 429);
  clear();
});

test('Gemini engine: the product photo goes in as the reference and the image comes back as data', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'or';
  const log = [];
  const f = async (url, init = {}) => {
    log.push({ url: String(url), body: JSON.parse(init.body || '{}') });
    return new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] } }], usage: { cost: 0.04 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const ref = 'data:image/jpeg;base64,' + JPG.toString('base64');
  const out = await generateImage(ctx(f), { prompt: 'a jar of scrub on warm sand', reference: ref, palette: { primary: '#05AC98' }, aspect: '4:5' });
  assert.equal(out.model, 'google/gemini-3-pro-image-preview');
  assert.match(out.image, /^data:image\/png;base64,/);
  const parts = log[0].body.messages[0].content;
  assert.equal(parts[1].type, 'image_url');
  assert.equal(log[0].body.image_config.aspect_ratio, '4:5');
  assert.match(parts[0].text, /No added text/);
  clear();
});
