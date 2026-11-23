import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCopy, summary, initCreatives } from '../lib/onboard/intel.js';

const items = () => [{ id: 'cr_spotlight', headline: 'x', body: 'x', cta: 'x' }, { id: 'cr_audience', headline: 'x', body: 'x', cta: 'x' }, { id: 'cr_diff', headline: 'x', body: 'x', cta: 'x' }];
const facts = { brand: 'Mello', line: 'Artisanal hot chocolate, dragees, and chocolate barks made for casual cravings, quiet rituals, and modern gifting.', product: 'Almond dragees', price: '549 INR', audience: 'Urban professionals aged 22–35' };
// emulate generateJson's contract: validate returns a rejection message or null; result wrapped in {data, model}
const fakeGen = (answer) => async ({ validate }) => { const bad = validate(answer); if (bad) throw new Error('rejected: ' + bad); return { data: answer, model: 'fake' }; };
const good = { spotlight: { headline: 'Roasted almonds, dark chocolate.', body: 'Almond dragees · 549 INR', cta: 'Shop now' }, lifestyle: { headline: 'Your afternoon crunch, sorted.', body: 'Almond dragees for quiet rituals at your desk.', cta: 'Order a pouch' }, contrast: { headline: 'Crunch first. Think later.', body: 'Almond dragees', cta: 'Try Mello' } };

test('valid AI copy is applied (validator contract: null = accept)', async () => {
  const it = items(); const r = await writeCopy(it, facts, { gen: fakeGen(good) });
  assert.equal(r.ok, true); assert.equal(it[0].headline, good.spotlight.headline); assert.equal(it[2].origin, 'ai_copy_from_confirmed_facts');
});
test('placeholder, invented numbers, truncation and duplicate headlines are rejected', async () => {
  for (const bad of [
    { ...good, contrast: { ...good.contrast, body: 'Edit with your real advantage' } },
    { ...good, lifestyle: { ...good.lifestyle, headline: 'Loved by 10000 fans' } },
    { ...good, spotlight: { ...good.spotlight, body: 'Artisanal hot chocolate and…' } },
    { ...good, lifestyle: { ...good.lifestyle, headline: good.spotlight.headline } },
  ]) { const it = items(); const r = await writeCopy(it, facts, { gen: fakeGen(bad) }); assert.equal(r.ok, false); assert.match(it[0].copyNote, /fallback/); }
});
test('summary never cuts a word', () => {
  const s = summary(facts.line, 90); assert.ok(s.length <= 90); assert.ok(!/\bmodern$/.test(s)); assert.ok(facts.line.replace(/\.$/, '').startsWith(s.replace(/\.$/, '')));
});
test('fallback drafts contain no placeholder language', async () => {
  const kv = new Map(); const store = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => kv.set(k, v), audit: () => {} };
  const rec = await initCreatives(store, { brand: { name: 'Mello', line: facts.line, site: 'mellooo.co.in' }, product: { name: 'Almond dragees', price: 549, currency: 'INR' }, audience: facts.audience, aiCopy: false });
  for (const x of rec.items) for (const f of ['headline', 'body', 'cta']) assert.ok(!/approve competitors|edit with|state your|…/i.test(x[f]), x[f]);
});

test('approval is blocked by failed checks and only overridable for reviewer opinions', async () => {
  const { editCreative } = await import('../lib/onboard/intel.js');
  const kv = new Map(); const store = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => kv.set(k, v), audit: () => {} };
  const ctx = { brand: { name: 'Mello', line: 'x', site: 'mellooo.co.in' }, product: { name: 'Almond dragees' }, aiCopy: false };
  await initCreatives(store, ctx);
  const q = (o) => ({ protected_pixels: 'pass', mask_completeness: 'pass', text_issues: [], critique: { blocking_issues: [] }, ...o });
  await editCreative(store, { context: ctx, id: 'cr_spotlight', design: { qa: q({ protected_pixels: 'fail' }) } });
  await assert.rejects(editCreative(store, { context: ctx, id: 'cr_spotlight', approve: true, override: 'I like it a lot' }), /pixels changed/);
  await editCreative(store, { context: ctx, id: 'cr_spotlight', design: { qa: q({ critique: { blocking_issues: ['floats'] } }) } });
  await assert.rejects(editCreative(store, { context: ctx, id: 'cr_spotlight', approve: true }), /blocking/);
  const r = await editCreative(store, { context: ctx, id: 'cr_spotlight', approve: true, override: 'shadow checked by eye, acceptable' });
  const x = r.items.find((y) => y.id === 'cr_spotlight'); assert.equal(x.status, 'approved'); assert.match(x.approvalOverride, /shadow/); assert.equal(x.override, undefined);
});
