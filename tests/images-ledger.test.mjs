import test from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, ledger } from '../lib/plugins/images.js';
import { paintImage } from '../lib/gemini-image.js';
import { createStore } from '../lib/store.js';

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
const ok = (id, cost) => ({ status: 200, text: async () => JSON.stringify({ id, usage: cost == null ? {} : { cost }, choices: [{ message: { images: [{ image_url: { url: IMG } }] } }] }) });
const empty = id => ({ status: 200, text: async () => JSON.stringify({ id, choices: [{ message: { content: '' } }] }) });
const seq = (...rs) => { let i = 0; const calls = []; const f = async (u, o) => { calls.push(u); if (String(u).includes('/generation?')) return { ok: false, status: 404, json: async () => ({}) }; return rs[Math.min(i++, rs.length - 1)]; }; f.calls = calls; return f; };
process.env.OPENROUTER_API_KEY = 'test-key';

test('cost is null (unknown) when the provider does not report it, never 0', async () => {
  const r = await paintImage({ prompt: 'x', fetchImpl: seq(ok('g1', null)) });
  assert.equal(r.usd, null); assert.equal(r.generation_id, 'g1'); assert.equal(r.attempts.length, 1);
});

test('reported cost is kept', async () => {
  const r = await paintImage({ prompt: 'x', fetchImpl: seq(ok('g2', 0.134)) });
  assert.equal(r.usd, 0.134);
});

test('an empty 200 is recorded and retried once (bounded), then succeeds', async () => {
  const f = seq(empty('e1'), ok('g3', 0.13));
  const r = await paintImage({ prompt: 'x', fetchImpl: f, deadline: Date.now() + 60000 });
  assert.equal(r.attempts.length, 2); assert.equal(r.attempts[0].empty, true); assert.equal(r.attempts[0].generation_id, 'e1');
});

test('repeated empty responses stop after the bound and every attempt is in the error', async () => {
  const f = seq(empty('e1'), empty('e2'), empty('e3'), empty('e4'), empty('e5'));
  await assert.rejects(paintImage({ prompt: 'x', fetchImpl: f, deadline: Date.now() + 60000 }), e => { assert.ok(e.attempts.length <= 4, 'bounded: ' + e.attempts.length); assert.ok(e.attempts.every(a => a.empty)); return true; });
});

test('ledger records attempts per job and the same requestId is not billed twice', async () => {
  process.env.IMAGE_ENGINE = 'gemini';
  const store = createStore({ STORE: 'memory' }); const f = seq(empty('e1'), ok('g9', 0.12));
  const ctx = { store, fetch: f, ip: '1.1.1.1', ws: 'w1' };
  const a = await generateImage(ctx, { prompt: 'empty plinth scene', aspect: '4:5', requestId: 'req-abcdef12', job: 'cr_spotlight', raw: true });
  const n = f.calls.length;
  const b = await generateImage(ctx, { prompt: 'empty plinth scene', aspect: '4:5', requestId: 'req-abcdef12', job: 'cr_spotlight', raw: true });
  assert.equal(f.calls.length, n, 'replay must not call the provider'); assert.equal(b.idempotent_replay, true); assert.equal(a.usd, 0.12);
  const l = await ledger(ctx);
  assert.equal(l.total.attempts, 2); assert.equal(l.total.empty, 1); assert.equal(l.by_job.cr_spotlight.attempts, 2); assert.equal(l.total.unknown_cost, 1);
});

test('the ad pipeline is gated off in Production unless CREATIVE_PIPELINE=on', async () => {
  const { creativePipelineOn } = await import('../lib/plugins/images.js');
  const env = { ...process.env };
  process.env.VERCEL_ENV = 'production'; delete process.env.CREATIVE_PIPELINE; assert.equal(creativePipelineOn(), false);
  const store = createStore({ STORE: 'memory' });
  await assert.rejects(generateImage({ store, fetch: seq(ok('g', 0.1)), ip: '1.1.1.1', ws: 'w' }, { prompt: 'scene', job: 'cr_spotlight', raw: true }), /paused/);
  process.env.CREATIVE_PIPELINE = 'on'; assert.equal(creativePipelineOn(), true);
  process.env.VERCEL_ENV = 'preview'; delete process.env.CREATIVE_PIPELINE; assert.equal(creativePipelineOn(), true);
  Object.assign(process.env, env); if (!env.VERCEL_ENV) delete process.env.VERCEL_ENV;
});
