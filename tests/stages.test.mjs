// compositeAd stage handling with a STUB compositor and STUB Cloudflare. Proves bookkeeping (labels, retry-only-failed-stage, no double generation). Not a quality test.
import test from 'node:test'; import assert from 'node:assert/strict'; import http from 'node:http'; import crypto from 'node:crypto';
import opsPlugin from '../lib/plugins/ops.js'; import { createStore } from '../lib/store.js'; import { scoped } from '../lib/ops/kv.js'; import { saveMaster, approveMaster } from '../lib/ops/masters.js';
const png = 'data:image/png;base64,' + Buffer.from('fakepng-bytes').toString('base64'); const sha = crypto.createHash('sha256').update(Buffer.from('fakepng-bytes')).digest('hex');
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
async function setup(compositorOk) {
  let compositeCalls = 0; const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { compositeCalls++; if (!compositorOk()) { res.writeHead(502); return res.end('{"error":"boom"}'); } res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ image: png, report: { matte_model: 'stub', protected_pixels_changed: 0, protected_pixels: 200000, protected_pixel_equality: 'pass', output_sha256: 'x' } })); }); }).listen(0);
  process.env.COMPOSITE_API_URL = 'http://127.0.0.1:' + srv.address().port; const store = createStore({ STORE: 'memory' }), kv = scoped(store, 'wsstages001');
  const m = await saveMaster(kv, { identity: { name: 'Test', sku: 'T1', refs: [{ sha256: sha, label: 'front' }], text: ['TEST'], colors: [], regions: [] } }); await approveMaster(kv, m.id, { confirmed: { text: true, colors: true, logo: true } });
  return { srv, store, m, calls: () => compositeCalls };
}
test('no generator configured → background is labelled procedural_gradient, never AI', async () => {
  delete process.env.BACKGROUND_PROVIDER; const { srv, store, m } = await setup(() => true);
  const r = await opsPlugin.actions.compositeAd.run({ store, ws: 'wsstages001', fetch }, { masterId: m.id, reference: png, scene: 'sunlit shelf' }); srv.closeAllConnections(); srv.close();
  assert.equal(r.report.background_kind, 'procedural_gradient'); assert.equal(r.report.backgroundSynthesized, false); assert.equal(r.report.verified, false);
  assert.equal(r.report.stages.find(s => s.name === 'background').status, 'skipped'); assert.equal(r.report.stages.find(s => s.name === 'qa').status, 'needs_human_review');
});
test('generated background is labelled ai_generated with provider/model; a compositor failure keeps it and the retry does not generate again', async () => {
  process.env.BACKGROUND_PROVIDER = 'cloudflare'; process.env.CF_ACCOUNT_ID = 'a'; process.env.CF_AI_TOKEN = 't'; let ok = false, gen = 0;
  const { srv, store, m } = await setup(() => ok); const cf = async (u, o) => { if (String(u).includes('api.cloudflare.com')) { gen++; return J({ result: { image: 'A'.repeat(300) } }); } return fetch(u, o); };
  const base = { masterId: m.id, reference: png, scene: 'sunlit shelf', idempotencyKey: 'stage-key-0001' };
  await assert.rejects(opsPlugin.actions.compositeAd.run({ store, ws: 'wsstages001', fetch: cf }, base), e => e.detail?.stage === 'composite' && e.detail.stages.some(s => s.name === 'background' && s.status === 'ok'));
  assert.equal(gen, 1); ok = true;
  const r = await opsPlugin.actions.compositeAd.run({ store, ws: 'wsstages001', fetch: cf }, { ...base, idempotencyKey: 'stage-key-0002', retryOf: 'stage-key-0001' }); srv.closeAllConnections(); srv.close();
  assert.equal(gen, 1, 'background was not generated again'); assert.equal(r.report.background_kind, 'ai_generated'); assert.equal(r.report.stages.find(s => s.name === 'background').status, 'reused'); assert.equal(r.report.backgroundProvider.model, '@cf/black-forest-labs/flux-1-schnell');
  delete process.env.BACKGROUND_PROVIDER; delete process.env.CF_ACCOUNT_ID; delete process.env.CF_AI_TOKEN;
});
test('a photo that is not in the approved master is refused before any provider call', async () => {
  const { srv, store, m, calls } = await setup(() => true); await assert.rejects(opsPlugin.actions.compositeAd.run({ store, ws: 'wsstages001', fetch }, { masterId: m.id, reference: 'data:image/png;base64,' + Buffer.from('other').toString('base64') }), /not part of the approved/); srv.closeAllConnections(); srv.close(); assert.equal(calls(), 0);
});
