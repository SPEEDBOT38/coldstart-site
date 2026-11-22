// Provider adapter contract tests. The Meta SDK is real; its transport is MOCKED (no network, no credentials).
// These prove request shape and retry behaviour, NOT that Meta accepts the call. Live verification needs a real token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraft } from '../lib/providers/meta-ads.js';
import { withRetry, classify } from '../lib/providers/retry.js';

function fakeApi(script = []) {
  const calls = [];
  return { calls, getVersion: () => 'v25.0', call: async (method, path, params) => {
    calls.push({ method, path: [].concat(path).join('/'), params });
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next || { id: String(100 + calls.length) };
  } };
}
const payload = { name: 'Fern', objective: 'sales', budget: { amount: 15000, period: 'month' }, audience: { countries: ['IN'] }, destination: { adAccountId: 'act_123' } };

test('meta adapter creates PAUSED campaign + ad set only, with the budget in minor units', async () => {
  const api = fakeApi(); const r = await createDraft({ api, payload });
  assert.equal(r.status, 'PAUSED'); assert.equal(r.creatives, 'pending');
  const camp = api.calls[0], set = api.calls[1];
  assert.equal(camp.method, 'POST'); assert.match(camp.path, /act_123\/campaigns$/); assert.equal(camp.params.status, 'PAUSED'); assert.equal(camp.params.objective, 'OUTCOME_SALES');
  assert.match(set.path, /act_123\/adsets$/); assert.equal(set.params.status, 'PAUSED'); assert.equal(set.params.daily_budget, 50000, 'monthly 15000 → daily 500 → 50000 minor units');
  assert.ok(api.calls.every(c => c.params.status !== 'ACTIVE'));
});
test('meta adapter refuses without a country', async () => {
  await assert.rejects(createDraft({ api: fakeApi(), payload: { ...payload, audience: { countries: [] } } }), /country/);
});
test('meta adapter refuses without an ad account', async () => {
  await assert.rejects(createDraft({ api: fakeApi(), payload: { ...payload, destination: {} } }), /ad account/);
});
test('rate-limit and 5xx are retried; auth and client errors are not', async () => {
  const rate = Object.assign(new Error('slow down'), { response: { status: 400, data: { error: { code: 17 } } } });
  const api = fakeApi([rate, { id: '1' }, { id: '2' }]);
  const r = await createDraft({ api, payload, retries: 2 }); assert.equal(r.campaignId, '1'); assert.equal(api.calls.length, 3);
  const auth = Object.assign(new Error('expired'), { status: 401 });
  const a2 = fakeApi([auth]); await assert.rejects(createDraft({ api: a2, payload, retries: 3 }), e => e.kind === 'auth'); assert.equal(a2.calls.length, 1);
  assert.deepEqual(classify({ status: 503 }), { retry: true, kind: 'transient' }); assert.deepEqual(classify({ status: 422 }), { retry: false, kind: 'client' });
  let n = 0; await assert.rejects(withRetry(async () => { n++; throw Object.assign(new Error('x'), { status: 500 }); }, { retries: 1, minTimeout: 1 })); assert.equal(n, 2);
});
