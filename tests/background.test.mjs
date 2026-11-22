import test from 'node:test'; import assert from 'node:assert/strict';
import { providers, backgroundPrompt, pick, backgroundStatus } from '../lib/providers/background.js';
test('prompt never describes a product and is bounded', () => {
  const p = backgroundPrompt({ scene: 'sunlit balcony shelf', mood: 'warm', palette: ['#2d5a27'], ratio: '9:16' });
  assert.match(p, /no product/); assert.ok(p.length <= 2048);
});
test('without credentials: blocked, no network call', async () => {
  let called = false;
  await assert.rejects(providers.cloudflare.generate({ prompt: 'x', env: {}, fetch: async () => { called = true; } }), /CF_ACCOUNT_ID/);
  assert.equal(called, false); assert.equal(backgroundStatus({}).provider, 'procedural');
  assert.equal(backgroundStatus({ BACKGROUND_PROVIDER: 'cloudflare' }).state, 'requires_credentials');
});
test('request matches the documented endpoint and handles both response envelopes', async () => {
  const seen = []; const img = 'A'.repeat(200);
  for (const body of [{ result: { image: img } }, { image: img }]) {
    const out = await providers.cloudflare.generate({ prompt: 'p', steps: 99, env: { CF_ACCOUNT_ID: 'acc', CF_AI_TOKEN: 't' }, fetch: async (u, o) => { seen.push([u, o]); return { ok: true, json: async () => body }; } });
    assert.ok(out.dataUrl.startsWith('data:image/jpeg;base64,'));
  }
  assert.equal(seen[0][0], 'https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/black-forest-labs/flux-1-schnell');
  assert.equal(JSON.parse(seen[0][1].body).steps, 8); assert.equal(seen[0][1].headers.authorization, 'Bearer t');
});
test('provider failure surfaces as an error, not an image', async () => {
  await assert.rejects(providers.cloudflare.generate({ prompt: 'p', env: { CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't' }, fetch: async () => ({ ok: false, status: 500 }) }), /500/);
  await assert.rejects(providers.cloudflare.generate({ prompt: 'p', env: { CF_ACCOUNT_ID: 'a', CF_AI_TOKEN: 't' }, fetch: async () => ({ ok: true, json: async () => ({}) }) }), /no image/);
});
