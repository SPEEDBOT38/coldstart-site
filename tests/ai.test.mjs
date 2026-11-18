import test from 'node:test';
import assert from 'node:assert/strict';
import { generateJson, aiProvider } from '../lib/ai.js';

const clear = () => { for (const k of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_MODEL', 'OPENROUTER_MODEL']) delete process.env[k]; };
const reply = body => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('prefers a direct Gemini key, then OpenRouter, else none', () => {
  clear();
  assert.equal(aiProvider().name, 'none');
  process.env.OPENROUTER_API_KEY = 'or';
  assert.equal(aiProvider().name, 'openrouter');
  process.env.GEMINI_API_KEY = 'g';
  assert.equal(aiProvider().name, 'gemini');
  clear();
});

test('Gemini call sends the key as a header, asks for JSON and parses the reply', async () => {
  clear(); process.env.GEMINI_API_KEY = 'gkey';
  let seen;
  const fetchImpl = async (url, init) => { seen = { url: String(url), init }; return reply({ candidates: [{ content: { parts: [{ text: '{"ok":true,"n":2}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })(); };
  const r = await generateJson({ system: 'sys', prompt: 'hi', fetch: fetchImpl });
  assert.deepEqual(r.data, { ok: true, n: 2 });
  assert.equal(r.provider, 'gemini');
  assert.match(seen.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/[^/]+:generateContent$/);
  assert.ok(!seen.url.includes('gkey'), 'key never in the URL');
  assert.equal(seen.init.headers['x-goog-api-key'], 'gkey');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  clear();
});

test('OpenRouter call uses a Gemini model and tolerates fenced JSON', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'or';
  let seen;
  const fetchImpl = async (url, init) => { seen = { url: String(url), body: JSON.parse(init.body) }; return reply({ choices: [{ message: { content: '```json\n{"title":"x"}\n```' } }], usage: { cost: 0.0004 } })(); };
  const r = await generateJson({ system: 's', prompt: 'p', fetch: fetchImpl });
  assert.deepEqual(r.data, { title: 'x' });
  assert.match(seen.body.model, /^google\/gemini/);
  assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(r.usd, 0.0004);
  clear();
});

test('no provider → throws a setup error the caller can fall back on', async () => {
  clear();
  await assert.rejects(() => generateJson({ prompt: 'p' }), e => e.code === 'NO_AI');
});
