import test from 'node:test';
import assert from 'node:assert/strict';
import { generateJson, extractJson, modelChain } from '../lib/ai.js';

const KEYS = ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_MODEL', 'OPENROUTER_MODEL', 'OPENROUTER_MODELS', 'OPENROUTER_FAST_MODELS'];
const clear = () => KEYS.forEach(k => delete process.env[k]);
const res = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const orOk = content => res(200, { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { cost: 0.001 } });
// a fake network that answers each call from a script, and records which model each call used
function scripted(steps) {
  const calls = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url: String(url), model: body.model || 'gemini', body });
    const s = steps[calls.length - 1];
    if (!s) throw new Error('no more scripted replies');
    if (s instanceof Error) throw s;
    return s;
  };
  return { f, calls };
}

test('extractJson finds JSON inside prose, fences and nested strings', () => {
  assert.deepEqual(extractJson('Sure! Here it is:\n```json\n{"a":[1,{"b":"}"}]}\n```\nThanks'), { a: [1, { b: '}' }] });
  assert.deepEqual(extractJson('noise [1,2] noise'), [1, 2]);
  assert.equal(extractJson('nothing here'), null);
});

test('chain: Gemini direct first, then Google models on OpenRouter, cheapest-first for fast jobs', () => {
  clear(); process.env.GEMINI_API_KEY = 'g'; process.env.OPENROUTER_API_KEY = 'o';
  const c = modelChain({ fast: true });
  assert.equal(c[0].provider, 'gemini');
  assert.ok(c.some(m => m.model === 'google/gemini-3.5-flash-lite'));
  assert.ok(c.findIndex(m => m.model === 'google/gemini-3.5-flash-lite') < c.findIndex(m => m.model === 'google/gemini-3.7-flash'));
  clear();
});

test('429 then success on the same model: retried with backoff, not dropped', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'o';
  const { f, calls } = scripted([res(429, { error: { message: 'rate' } }), orOk('{"ok":1}')]);
  const r = await generateJson({ prompt: 'p', fetch: f });
  assert.deepEqual(r.data, { ok: 1 });
  assert.equal(calls[0].model, calls[1].model);
  clear();
});

test('empty reply, then unreadable reply → next models, each with a correction note', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'o';
  const { f, calls } = scripted([res(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] }), orOk('I think the answer is great'), orOk('{"ok":2}')]);
  const r = await generateJson({ prompt: 'p', fetch: f });
  assert.deepEqual(r.data, { ok: 2 });
  assert.equal(new Set(calls.map(c => c.model)).size, 3, 'three different models');
  assert.match(calls[2].body.messages[1].content, /could not be read as JSON/);
  assert.deepEqual(r.attempts.map(a => !!a.ok), [false, false, true]);
  clear();
});

test('validate() rejects a wrong shape → next model is told why', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'o';
  const { f, calls } = scripted([orOk('{"posts":[]}'), orOk('{"signals":[{"ref":"0"}]}')]);
  const r = await generateJson({ prompt: 'p', fetch: f, validate: d => Array.isArray(d.signals) ? null : 'missing "signals" array' });
  assert.ok(Array.isArray(r.data.signals));
  assert.match(calls[1].body.messages[1].content, /rejected: missing "signals" array/);
  clear();
});

test('timeouts and network errors move on; total failure throws with every attempt listed', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'o';
  const abort = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const { f } = scripted([abort, new Error('ECONNRESET'), res(500, 'x'), res(500, 'x'), res(500, 'x')]);
  await assert.rejects(() => generateJson({ prompt: 'p', fetch: f }), e => e.status === 502 && e.attempts.length === 3 && /timed out/.test(e.attempts[0].error) && /network/.test(e.attempts[1].error));
  clear();
});

test('bad key or no credits is a setup error at once, never a silent fallback', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'o';
  const a = scripted([res(401, { error: { message: 'bad key' } })]);
  await assert.rejects(() => generateJson({ prompt: 'p', fetch: a.f }), e => e.status === 503 && /rejected the API key/.test(e.message));
  const b = scripted([res(402, { error: { message: 'credits' } })]);
  await assert.rejects(() => generateJson({ prompt: 'p', fetch: b.f }), e => /out of credits/.test(e.message));
  assert.equal(a.calls.length + b.calls.length, 2);
  clear();
});

test('Google-hosted only on OpenRouter, thinking models get reasoning room', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'o'; process.env.OPENROUTER_MODELS = 'google/gemini-3.7-flash';
  const { f, calls } = scripted([orOk('{"a":1}')]);
  await generateJson({ prompt: 'p', maxTokens: 1000, fetch: f });
  assert.deepEqual(calls[0].body.provider.only, ['google-vertex', 'google-ai-studio']);
  assert.equal(calls[0].body.max_tokens, 2500);
  assert.equal(calls[0].body.reasoning.effort, 'low');
  clear();
});

test('BYOK cost is read from upstream_inference_cost', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'o';
  const { f } = scripted([res(200, { choices: [{ message: { content: '{"a":1}' } }], usage: { cost: 0, is_byok: true, cost_details: { upstream_inference_cost: 0.0021 } } })]);
  assert.equal((await generateJson({ prompt: 'p', fetch: f })).usd, 0.0021);
  clear();
});

test('respects the deadline: does not start a model with < 4 s left', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'o';
  const { f, calls } = scripted([]);
  await assert.rejects(() => generateJson({ prompt: 'p', fetch: f, deadline: 3000 }), e => e.attempts.every(a => /out of time/.test(a.error)));
  assert.equal(calls.length, 0);
  clear();
});
