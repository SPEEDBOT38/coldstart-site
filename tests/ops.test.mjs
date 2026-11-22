// Server-side guarantees: tenant isolation, policy/pause, caps, product-master lifecycle, job states,
// idempotency, approval binding, execution safety. Providers are MOCKED here (image worker, Meta SDK api).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createHandler } from '../lib/app.js';
import { createStore } from '../lib/store.js';

for (const k of ['META_APP_ID', 'META_APP_SECRET', 'OPENROUTER_API_KEY', 'PLUGINS']) delete process.env[k];
Object.assign(process.env, { SESSION_SECRET: 's'.repeat(40), IMAGE_ENGINE: 'flux', IMAGE_API_URL: 'https://img.test', IMAGE_API_KEY: 'k', IMAGE_DAILY_LIMIT: '1000' });

const JPG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4]);
let imgCalls = 0, imgFail = false;
const fetchMock = async url => {
  if (String(url).startsWith('https://img.test')) {
    imgCalls++;
    if (imgFail) return new Response(JSON.stringify({ error: 'capacity' }), { status: 502, headers: { 'content-type': 'application/json' } });
    return new Response(JPG, { headers: { 'content-type': 'image/jpeg', 'x-model': 'mock-flux' } });
  }
  throw new Error('unexpected ' + url);
};
const REF = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]);
const REF_URL = 'data:image/png;base64,' + REF.toString('base64');
const REF_SHA = crypto.createHash('sha256').update(REF).digest('hex');

const servers = [];
test.afterEach(() => { while (servers.length) { const s = servers.pop(); s.closeAllConnections?.(); s.close(); } });
async function start(opts = {}) {
  const store = createStore({ STORE: 'memory' });
  const server = http.createServer(createHandler({ store, fetch: fetchMock, ...opts })); servers.push(server);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { store, base: `http://127.0.0.1:${server.address().port}` };
}
function client(base) {
  const cookies = {};
  const jar = r => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); cookies[kv.slice(0, i)] = kv.slice(i + 1); } };
  const ck = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    async call(plugin, action, body) {
      const r = body === undefined
        ? await fetch(`${base}/api/plugins/${plugin}/actions/${action}`, { headers: { cookie: ck() } })
        : await fetch(`${base}/api/plugins/${plugin}/actions/${action}`, { method: 'POST', headers: { cookie: ck(), 'content-type': 'application/json', 'x-coldstart': '1' }, body: JSON.stringify(body) });
      jar(r); return { status: r.status, json: await r.json() };
    },
    get: (a, q = '') => fetch(`${base}/api/plugins/ops/actions/${a}${q}`, { headers: { cookie: ck() } }).then(async r => { jar(r); return { status: r.status, json: await r.json() }; }),
  };
}
const ident = (extra = {}) => ({ name: 'Fern kit', sku: 'FK-01', variant: '250 g', refs: [{ sha256: REF_SHA, label: 'front' }], text: ['FERN & FORM', 'Soil mix 250 g'], logo: { present: true, note: 'wordmark top' }, colors: ['#2d5a27'], regions: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.2, label: 'label' }], ...extra });
async function approvedMaster(c, alter = { background: true, relight: true }) {
  const { json } = await c.call('ops', 'saveMaster', { identity: ident(), alter });
  const a = await c.call('ops', 'approveMaster', { id: json.master.id, confirmed: { text: true, colors: true, logo: true } });
  assert.equal(a.json.master.status, 'approved'); return a.json.master;
}
const jobBody = (m, over = {}) => ({ masterId: m.id, idempotencyKey: 'idem-' + crypto.randomUUID(), direction: 'lifestyle', prompt: 'On a kitchen counter, soft window light', ratio: '4:5', alter: { background: true }, reference: REF_URL, ...over });
const launch = (over = {}) => ({ campaignId: 'c1', name: 'Fern launch', objective: 'traffic', channels: ['instagram'], budget: { mode: 'amount', amount: 500, currency: 'INR', period: 'day' }, audience: { countries: ['IN'], regions: ['Bengaluru'] }, destination: { url: 'https://example.com/shop' }, creatives: [], copy: ['Hello'], ...over });

test('each browser gets its own workspace; records are not readable across tenants', async () => {
  const { base } = await start(); const a = client(base), b = client(base);
  const wa = (await a.get('workspace')).json.workspace, wb = (await b.get('workspace')).json.workspace;
  assert.notEqual(wa, wb);
  const m = await approvedMaster(a);
  assert.equal((await b.get('masters')).json.masters.length, 0);
  const j = await a.call('ops', 'createJob', jobBody(m)); assert.equal(j.status, 200);
  assert.equal((await b.get('job', '?id=' + j.json.job.id)).status, 404);
  const ap = await a.call('ops', 'approve', { payload: launch() });
  assert.equal((await b.call('ops', 'execute', { approvalId: ap.json.approval.id, payload: launch() })).status, 404);
});

test('POST without x-coldstart header is refused', async () => {
  const { base } = await start();
  const r = await fetch(`${base}/api/plugins/ops/actions/setPolicy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"paused":true}' });
  assert.equal(r.status, 403);
});

test('product master: needs confirmation, identity change voids approval, widening alterations voids approval', async () => {
  const { base } = await start(); const c = client(base);
  const { json } = await c.call('ops', 'saveMaster', { identity: ident({ text: [], logo: { present: false, note: '' } }), alter: {} });
  const bad = await c.call('ops', 'approveMaster', { id: json.master.id, confirmed: { text: true, colors: true, logo: true } });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /at least one/);
  assert.equal((await c.call('ops', 'approveMaster', { id: json.master.id, confirmed: {} })).status, 400);
  const m = await approvedMaster(c);
  const same = await c.call('ops', 'saveMaster', { id: m.id, identity: ident(), alter: { background: true, relight: true } });
  assert.equal(same.json.master.status, 'approved'); assert.equal(same.json.master.version, m.version);
  const edited = await c.call('ops', 'saveMaster', { id: m.id, identity: ident({ text: ['FERN & FORM', 'Soil mix 500 g'] }), alter: { background: true, relight: true } });
  assert.equal(edited.json.master.status, 'needs_reapproval'); assert.equal(edited.json.master.version, m.version + 1);
  const blocked = await c.call('ops', 'createJob', jobBody(edited.json.master));
  assert.equal(blocked.status, 403); assert.equal(blocked.json.detail, undefined); assert.match(blocked.json.error, /Re-approve/);
  await c.call('ops', 'approveMaster', { id: m.id, confirmed: { text: true, colors: true, logo: true } });
  const widen = await c.call('ops', 'saveMaster', { id: m.id, identity: ident({ text: ['FERN & FORM', 'Soil mix 500 g'] }), alter: { background: true, relight: true, recolor: true } });
  assert.equal(widen.json.master.status, 'needs_reapproval');
});

test('generation respects allowed alterations and approved references', async () => {
  const { base } = await start(); const c = client(base); const m = await approvedMaster(c);
  const recolor = await c.call('ops', 'createJob', jobBody(m, { alter: { recolor: true } }));
  assert.equal(recolor.status, 403); assert.match(recolor.json.error, /does not allow: recolor/);
  assert.equal((await c.call('ops', 'createJob', jobBody(m, { alter: {} }))).status, 400);
  const other = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 1, 1]).toString('base64');
  assert.equal((await c.call('ops', 'createJob', jobBody(m, { reference: other }))).status, 403);
  assert.equal((await c.call('ops', 'createJob', { ...jobBody(m), alter: { background: 'yes' } })).status, 400);
  // direct image endpoint cannot be used to dodge the master gate
  const direct = await c.call('images', 'generate', { prompt: 'a jar on a table', reference: REF_URL });
  assert.equal(direct.status, 403); assert.equal(direct.json.code, 'use_jobs');
});

test('job lifecycle, never verified without QA; failing QA fails the job; unverified stays unverified', async () => {
  const { base } = await start(); const c = client(base); const m = await approvedMaster(c);
  const r = await c.call('ops', 'createJob', jobBody(m, { alter: { background: true, viewpoint: false } }) );
  assert.equal(r.status, 200);
  const j = r.json.job; assert.equal(j.state, 'validating'); assert.deepEqual(j.history.map(h => h.state), ['queued', 'processing', 'validating']);
  assert.equal(j.model, 'mock-flux'); assert.equal(j.workflow, 'creative-first@1'); assert.equal(j.inputRefs.refSha, REF_SHA); assert.equal(j.output.sha256, crypto.createHash('sha256').update(JPG).digest('hex'));
  assert.equal(j.cost.actualUsd, null, 'unreported cost is null, not 0'); assert.equal(j.review.verified, false);
  assert.match(r.json.image, /^data:image\/jpeg/);
  const un = await c.call('ops', 'validateJob', { id: j.id, findings: [{ check: 'Packaging text', status: 'pass' }, { check: 'Segmentation', status: 'unverified', detail: 'no model' }] });
  assert.equal(un.json.job.state, 'completed'); assert.equal(un.json.job.review.verified, false);
  assert.equal((await c.call('ops', 'validateJob', { id: j.id, findings: [{ check: 'x', status: 'pass' }] })).status, 409);
  const r2 = await c.call('ops', 'createJob', jobBody(m));
  const bad = await c.call('ops', 'validateJob', { id: r2.json.job.id, findings: [{ check: 'Packaging text', status: 'fail', detail: 'FERN missing' }] });
  assert.equal(bad.json.job.state, 'failed'); assert.equal(bad.json.job.error.code, 'qa_failed');
  const r3 = await c.call('ops', 'createJob', jobBody(m, { alter: { background: true, relight: true } }));
  const ok = await c.call('ops', 'validateJob', { id: r3.json.job.id, findings: [{ check: 'Packaging text', status: 'pass' }, { check: 'Colour', status: 'pass' }] });
  assert.equal(ok.json.job.review.verified, true); assert.equal(ok.json.job.review.needsReview, true, 'still needs a human review');
});

test('viewpoint changes are flagged; cancel; retry only failed; idempotency prevents double charge', async () => {
  const { base } = await start(); const c = client(base); const m = await approvedMaster(c, { background: true, viewpoint: true });
  const v = (await c.call('ops', 'createJob', jobBody(m, { alter: { viewpoint: true } }))).json.job; assert.equal(v.review.viewpointChanged, true);
  const calls = imgCalls, key = 'idem-fixed-key-1';
  const a = await c.call('ops', 'createJob', jobBody(m, { idempotencyKey: key })), b = await c.call('ops', 'createJob', jobBody(m, { idempotencyKey: key }));
  assert.equal(imgCalls, calls + 1, 'second submit made no provider call'); assert.equal(b.json.duplicate, true); assert.equal(a.json.job.id, b.json.job.id);
  assert.equal((await c.get('usage')).json.used.creativeMonth, 2);
  assert.equal((await c.call('ops', 'cancelJob', { id: a.json.job.id })).json.job.state, 'cancelled');
  assert.equal((await c.call('ops', 'cancelJob', { id: a.json.job.id })).status, 409);
  assert.equal((await c.call('ops', 'retryJob', { id: v.id, reference: REF_URL })).status, 409);
  imgFail = true; const f = await c.call('ops', 'createJob', jobBody(m)); imgFail = false;
  assert.equal(f.json.job.state, 'failed'); assert.equal(f.json.job.error.code, 'provider_error'); assert.equal(f.json.job.error.retryable, true);
  const used = (await c.get('usage')).json.used.creativeMonth;
  const rt = await c.call('ops', 'retryJob', { id: f.json.job.id, reference: REF_URL });
  assert.equal(rt.json.job.state, 'validating'); assert.equal(rt.json.job.attempts, 2); assert.equal((await c.get('usage')).json.used.creativeMonth, used + 1, 'failed attempt was not charged');
  const list = (await c.get('jobs')).json.jobs; assert.equal(list.length, 3);
});

test('server-side caps and pause are enforced regardless of the browser', async () => {
  const { base } = await start(); const c = client(base); const m = await approvedMaster(c);
  await c.call('ops', 'setPolicy', { caps: { credits: 2 } });
  assert.equal((await c.call('ops', 'createJob', jobBody(m))).status, 200); assert.equal((await c.call('ops', 'createJob', jobBody(m))).status, 200);
  const capped = await c.call('ops', 'createJob', jobBody(m)); assert.equal(capped.status, 429); assert.match(capped.json.error, /cap reached \(2\/2\)/);
  await c.call('ops', 'setPolicy', { caps: { credits: 50 } });
  assert.equal((await c.call('ops', 'setPolicy', { paused: true })).json.policy.paused, true);
  const p = await c.call('ops', 'createJob', jobBody(m)); assert.equal(p.status, 423);
  const g = await c.call('images', 'generate', { prompt: 'a jar on a table' }); assert.equal(g.status, 423);
  await c.call('ops', 'setPolicy', { paused: false });
  assert.equal((await c.call('ops', 'setPolicy', { caps: { research: 0 } })).json.policy.caps.research, 0);
  const rs = await c.call('research', 'scan', { query: 'x', sources: ['reddit'] }); assert.equal(rs.status, 429); assert.match(rs.json.error, /switched off/);
  assert.equal((await c.call('ops', 'setPolicy', { caps: { credits: -1 } })).status, 400);
  const types = (await c.get('audit')).json.events.map(e => e.type); assert.ok(types.includes('policy'));
});

test('approval is bound to its payload: any change voids it; execution is blocked/simulated honestly', async () => {
  const { base } = await start(); const c = client(base);
  const ap = (await c.call('ops', 'approve', { payload: launch() })).json.approval;
  assert.match(ap.hash, /^[a-f0-9]{64}$/); assert.equal(ap.actor, 'owner'); assert.equal(ap.status, 'active');
  // key order must not matter (canonical JSON)
  const reordered = Object.fromEntries(Object.entries(launch()).reverse());
  const blocked = await c.call('ops', 'execute', { approvalId: ap.id, payload: reordered });
  assert.equal(blocked.status, 200); assert.equal(blocked.json.execution.state, 'blocked'); assert.equal(blocked.json.execution.reason, 'not_connected');
  for (const change of [{ budget: { mode: 'amount', amount: 5000, currency: 'INR', period: 'day' } }, { audience: { countries: ['US'], regions: [] } }, { destination: { url: 'https://evil.example/' } }, { copy: ['Different'] }, { channels: ['instagram', 'x'] }]) {
    const a2 = (await c.call('ops', 'approve', { payload: launch() })).json.approval;
    const r = await c.call('ops', 'execute', { approvalId: a2.id, payload: launch(change) });
    assert.equal(r.status, 409, JSON.stringify(change)); assert.equal(r.json.detail, undefined);
    const after = (await c.get('approvals')).json.approvals.find(x => x.id === a2.id); assert.equal(after.status, 'invalidated');
    assert.equal((await c.call('ops', 'execute', { approvalId: a2.id, payload: launch() })).status, 409, 'invalidated approval cannot be replayed');
  }
  assert.equal((await c.call('ops', 'execute', { approvalId: ap.id, payload: { ...launch(), name: 'x' } })).status, 409);
});

test('sandbox Meta connection yields a labelled simulation; duplicate execute does not repeat; revoke semantics', async () => {
  const { base } = await start(); const c = client(base);
  const r1 = await fetch(`${base}/api/plugins/meta/connect`, { redirect: 'manual' });  // fresh jar for state cookie
  const jar = r1.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  const page = await (await fetch(base + new URL(r1.headers.get('location'), base).pathname + new URL(r1.headers.get('location'), base).search, { headers: { cookie: jar } })).text();
  const approve = page.match(/href="([^"]+callback[^"]+)"/)[1].replace(/&amp;/g, '&');
  const r2 = await fetch(base + approve, { headers: { cookie: jar }, redirect: 'manual' }); const vault = r2.headers.getSetCookie().map(s => s.split(';')[0]);
  const cookie = [...jar.split('; '), ...vault].filter(x => !x.startsWith('cs_oauth')).join('; ');
  const call = async (a, body) => { const r = await fetch(`${base}/api/plugins/ops/actions/${a}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-coldstart': '1' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  const ap = (await call('approve', { payload: launch() })).json.approval;
  const ex = await call('execute', { approvalId: ap.id, payload: launch() });
  assert.equal(ex.json.execution.state, 'simulated'); assert.equal(ex.json.execution.simulated, true); assert.match(ex.json.execution.note, /nothing exists on Meta/);
  const again = await call('execute', { approvalId: ap.id, payload: launch() }); assert.equal(again.json.duplicate, true); assert.equal(again.json.execution.id, ex.json.execution.id);
  const rv = await call('revoke', { id: ap.id }); assert.equal(rv.status, 409); assert.equal(rv.json.code, 'already_executed');
  const ap2 = (await call('approve', { payload: launch({ name: 'Second' }) })).json.approval;
  assert.equal((await call('revoke', { id: ap2.id })).json.approval.status, 'revoked');
  assert.equal((await call('execute', { approvalId: ap2.id, payload: launch({ name: 'Second' }) })).status, 409);
  await call('setPolicy', { paused: true });
  const ap3 = (await call('approve', { payload: launch({ name: 'Third' }) })).json.approval;
  assert.equal((await call('execute', { approvalId: ap3.id, payload: launch({ name: 'Third' }) })).status, 423, 'Pause All blocks new external actions');
});

test('audit log is hash-chained and exportData is tenant-scoped', async () => {
  const { base } = await start(); const c = client(base);
  await c.call('ops', 'setPolicy', { paused: true }); await c.call('ops', 'setPolicy', { paused: false });
  const ev = (await c.get('audit')).json.events; assert.ok(ev.length >= 2);
  assert.equal(ev[0].prev, ev[1].hash);
  const exp = (await c.get('exportData')).json; assert.ok(exp.audit.length >= 2);
  const del = await c.call('ops', 'deleteWorkspace', { confirm: 'nope' }); assert.equal(del.status, 400);
});

test('verify invalidates an approval as soon as the campaign changes', async () => {
  const { base } = await start(); const c = client(base);
  const ap = (await c.call('ops', 'approve', { payload: launch() })).json.approval;
  assert.equal((await c.call('ops', 'verify', { approvalId: ap.id, payload: launch() })).json.valid, true);
  const bad = (await c.call('ops', 'verify', { approvalId: ap.id, payload: launch({ budget: { mode: 'amount', amount: 9, currency: 'INR', period: 'day' } }) })).json;
  assert.equal(bad.valid, false); assert.equal(bad.status, 'invalidated');
  assert.equal((await c.call('ops', 'verify', { approvalId: ap.id, payload: launch() })).json.valid, false, 'stays invalid even if changed back');
});

test('100 simultaneous generation requests against a cap of 5: provider called 5 times; the same key 100 times: once', async () => {
  const { base } = await start(); const c = client(base); const m = await approvedMaster(c);
  await c.call('ops', 'setPolicy', { caps: { credits: 5 } }); const before = imgCalls;
  const rs = await Promise.all(Array.from({ length: 100 }, () => c.call('ops', 'createJob', jobBody(m))));
  assert.equal(rs.filter(r => r.status === 200).length, 5); assert.equal(rs.filter(r => r.status === 429).length, 95); assert.equal(imgCalls - before, 5);
  await c.call('ops', 'setPolicy', { caps: { credits: 50 } }); const key = 'same-key-' + crypto.randomUUID(), b2 = imgCalls;
  const same = await Promise.all(Array.from({ length: 100 }, () => c.call('ops', 'createJob', jobBody(m, { idempotencyKey: key }))));
  assert.equal(imgCalls - b2, 1, 'provider billed once'); assert.ok(same.every(r => [200, 409].includes(r.status)));
  const u = (await c.get('usage')).json; assert.equal(u.used.creativeMonth, 6);
});
