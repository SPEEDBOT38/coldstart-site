import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSignals, teardownAds } from '../lib/plugins/research/enrich.js';
import { generateJson } from '../lib/ai.js';

process.env.GEMINI_API_KEY = 'fixture';
process.env.GEMINI_MODEL = 'configured-pro';
process.env.GEMINI_FAST_MODEL = 'configured-fast';
delete process.env.OPENROUTER_API_KEY;
const posts = [0,1,2].map(i => ({ title: `Plant ${i}`, text: `My plant ${i} needs water.`, source: 'reddit' }));
const tags = posts.map((_, i) => ({ ref: String(i), intent: 'Customer pain', topic: 'water', match: 80, insight: 'Explain watering.', angle: 'When to water' }));
const synthesis = { summary: 'Watering is a concern in these posts.', themes: [{ name: 'Water', summary: 'Watering questions', refs: ['1'] }] };
function network(...steps) {
  const calls = [];
  return { calls, fetch: async url => {
    calls.push(url.split('/models/')[1].split(':')[0]);
    const data = steps.shift();
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] });
  } };
}
test('fast tagging then configured synthesis retries unknown theme refs and maps valid refs', async () => {
  const net = network({ signals: tags }, { ...synthesis, themes: [{ ...synthesis.themes[0], refs: ['99'] }] }, synthesis);
  const r = await enrichSignals(posts, { query: 'plant', fetch: net.fetch });
  assert.deepEqual(net.calls, ['configured-fast', 'configured-pro', 'configured-fast']);
  assert.deepEqual(r.themes[0].refs, [r.signals[1].id]);
});
for (const bad of [{ ref: '9' }, { match: 101 }, { match: null }, { insight: {} }, { quote: 'not in this post' }]) {
  test(`bad tag ${JSON.stringify(bad)} falls back without being labelled AI`, async () => {
    const signals = [{ ...tags[0], ...bad }];
    const net = network({ signals }, { signals });
    const r = await enrichSignals(posts.slice(0,1), { query: 'plant', fetch: net.fetch });
    assert.equal(r.signals[0]?.tagged, 'keywords');
  });
}
test('a deadline spent during tagging is not renewed for synthesis', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const deadlineAt = now + 8000;
  const net = network({ signals: tags }, synthesis);
  const r = await enrichSignals(posts, { query: 'plant', deadlineAt, fetch: async (...args) => { now += 5000; return net.fetch(...args); } });
  assert.equal(net.calls.length, 1);
  assert.equal(r.signals.length, 3);
  assert.equal(r.summary, '');
});
test('validator exceptions do not bypass the model chain', async () => {
  const net = network({}, { items: ['ok'] });
  const r = await generateJson({ prompt: 'test', fetch: net.fetch, validate: d => d.items.length ? null : 'empty' });
  assert.equal(r.attempts.length, 2);
});
const ad = { author: 'Fern', text: 'Water your plants.' };
test('a valid off-topic assessment is not reported as a keyword fallback', async () => {
  const net = network({ signals: [{ ...tags[0], match: 10 }] });
  const r = await enrichSignals(posts.slice(0, 1), { query: 'plant', fetch: net.fetch });
  assert.equal(r.quality.offTopic, 1);
  assert.equal(r.ai, 'gemini');
  assert.deepEqual(r.notes, []);
});
const td = { ref: '0', hook: ad.text, observed: 'Gives advice.', gap: 'Timing', angle: 'Watering routine', format: 'Text' };
const competitor = { name: 'Fern', position: 'Plant advice', paid: 'Watering', organic: 'Not checked', gap: 'Timing' };
for (const invalid of [{ teardowns: [{ ...td, hook: 'Fake quote' }], competitors: [] }, { teardowns: [td], competitors: [{ ...competitor, name: 'Invented' }] }]) {
  test(`ad analysis retries unsupported evidence: ${JSON.stringify(invalid)}`, async () => {
    const net = network(invalid, { teardowns: [td], competitors: [competitor] });
    const r = await teardownAds([ad], { query: 'plants', fetch: net.fetch });
    assert.deepEqual(net.calls, ['configured-pro', 'configured-fast']);
    assert.equal(r.teardowns[0].hook, ad.text);
    assert.deepEqual(r.competitors, [competitor]);
  });
}
