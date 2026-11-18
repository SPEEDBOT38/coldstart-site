import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/image/worker.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 9, 9]);
const env = (run = async () => ({ image: Buffer.from(JPG).toString('base64') })) => {
  const calls = [];
  return { calls, API_KEY: 'k'.repeat(32), AI: { run: async (model, input) => { calls.push({ model, input }); return run(model, input); } } };
};
const req = (body, { key = 'k'.repeat(32), method = 'POST', path = '/' } = {}) => new Request('https://img.example' + path, {
  method, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });

test('rejects a wrong key and a missing key', async () => {
  const e = env();
  assert.equal((await worker.fetch(req({ prompt: 'a' }, { key: 'nope' }), e)).status, 401);
  assert.equal((await worker.fetch(new Request('https://img.example/', { method: 'POST', body: '{}' }), e)).status, 401);
  assert.equal(e.calls.length, 0);
});

test('refuses to run without an API_KEY configured', async () => {
  const e = env(); e.API_KEY = '';
  assert.equal((await worker.fetch(req({ prompt: 'a' }, { key: '' }), e)).status, 500);
});

test('FLUX schnell returns base64 JSON → served as image bytes', async () => {
  const e = env();
  const r = await worker.fetch(req({ prompt: 'a cobalt plant shelf' }), e);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), JPG);
  assert.equal(e.calls[0].model, '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(e.calls[0].input.steps, 4);
  assert.equal(r.headers.get('x-model'), '@cf/black-forest-labs/flux-1-schnell');
});

test('SDXL Lightning returns a byte stream and honours size limits', async () => {
  const e = env(async () => new ReadableStream({ start(c) { c.enqueue(PNG); c.close(); } }));
  const r = await worker.fetch(req({ prompt: 'x', model: 'sdxl', width: 4000, height: 333 }), e);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(e.calls[0].model, '@cf/bytedance/stable-diffusion-xl-lightning');
  assert.equal(e.calls[0].input.width, 1024);
  assert.equal(e.calls[0].input.height, 336);
});

test('validates prompt and model, never passes unknown models through', async () => {
  const e = env();
  assert.equal((await worker.fetch(req({ prompt: '' }), e)).status, 400);
  assert.equal((await worker.fetch(req({ prompt: 'x'.repeat(2049) }), e)).status, 400);
  assert.equal((await worker.fetch(req({ prompt: 'x', model: '@cf/meta/llama-3.1-70b-instruct' }), e)).status, 400);
  assert.equal(e.calls.length, 0);
});

test('model errors come back as JSON 502 without leaking the key', async () => {
  const e = env(async () => { throw new Error('capacity exceeded'); });
  const r = await worker.fetch(req({ prompt: 'x' }), e);
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.match(j.error, /capacity exceeded/);
  assert.ok(!JSON.stringify(j).includes('k'.repeat(32)));
});

test('GET /health lists models and needs no key', async () => {
  const r = await worker.fetch(new Request('https://img.example/health'), env());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.models.fast && j.models.sdxl);
});
