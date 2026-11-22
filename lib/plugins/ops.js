// Ops plugin: the server-side source of truth for workspace policy, pause, caps, product masters,
// generation jobs, approvals and launch execution. Always "live": it needs no third-party credentials.
import { z } from 'zod';
import { PluginError } from './http.js';
import { scoped, sha256 } from '../ops/kv.js';
import { reserve, settle, release, expenses } from '../ops/ledger.js';
import { getPolicy, setPolicy, counter, defaultCaps, enforce } from '../ops/policy.js';
import { saveMaster, approveMaster, listMasters, getMaster, deleteMaster } from '../ops/masters.js';
import { createJob, getJob, listJobs, cancelJob, validateJob, retryJob } from '../ops/jobs.js';
import { markManual, refreshMetrics, createPublish, authorizePublish, editPublish, cancelPublish, runPublish, getPublish, listPublish, resolveUnknown } from '../ops/outbox.js';
import { integrationStatus } from '../providers/adapters.js';
import { composite } from '../providers/composite.js';
import { inspectSite, installGuidance, assessTracking } from '../tracking/inspect.js';
import { pick as pickBg, backgroundPrompt, backgroundStatus } from '../providers/background.js';
import crypto from 'node:crypto';
import { runPipeline } from '../social/pipeline.js';
import { SOURCES, manualItem } from '../social/sources.js';
import { draftFor, validateDraft } from '../social/draft.js';
import { createApproval, listApprovals, revokeApproval, execute, getExecution, verify } from '../ops/approvals.js';

const kvOf = ctx => scoped(ctx.store, ctx.ws);
const wrap = fn => async (ctx, input) => {
  try { return await fn(kvOf(ctx), ctx, input || {}); }
  catch (e) { if (e instanceof z.ZodError) throw new PluginError(e.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).slice(0, 4).join('; '), 400, { code: 'invalid' }); throw e; }
};

export default {
  id: 'ops', name: 'Operations', vendor: 'Coldstart', category: 'Core',
  description: 'Workspace policy, pause switch, usage caps, product masters, generation jobs, approvals and launch execution.',
  capabilities: ['policy', 'pause', 'caps', 'masters', 'jobs', 'approvals', 'execute'],
  env: [], optionalEnv: ['IMAGE_COST_EST_USD'], docs: 'docs/INTEGRATIONS.md', auth: { type: 'server', scopes: [] },
  liveReady: () => true,
  actions: {
    workspace: { method: 'GET', run: wrap(async (kv, ctx) => ({ workspace: kv.ws, store: ctx.store.kind, durable: !String(ctx.store.kind).startsWith('tmp-file') && ctx.store.kind !== 'memory', policy: await getPolicy(kv) })) },
    policy: { method: 'GET', run: wrap(async kv => ({ policy: await getPolicy(kv) })) },
    setPolicy: { method: 'POST', run: wrap(async (kv, _c, i) => ({ policy: await setPolicy(kv, z.object({ paused: z.boolean(), allow: z.object({ organic: z.boolean(), paid: z.boolean(), budget: z.boolean() }).partial(), caps: z.object({ research: z.number(), credits: z.number() }).partial() }).partial().parse(i)) })) },
    resetPolicy: { method: 'POST', run: wrap(async kv => { await kv.del('policy'); await kv.audit('policy', 'Reset to safe defaults', null); return { policy: await getPolicy(kv) }; }) },
    usage: { method: 'GET', run: wrap(async kv => {
      const p = await getPolicy(kv), jobs = await listJobs(kv), month = new Date().toISOString().slice(0, 7);
      const mj = jobs.filter(j => j.createdAt.startsWith(month)), known = mj.filter(j => typeof j.cost.actualUsd === 'number');
      return { caps: p.caps, used: { researchToday: await counter.read(kv, 'research', 'day'), creativeMonth: await counter.read(kv, 'creative', 'month') },
        // three buckets, never summed together
        aiApiCost: { usd: known.reduce((a, j) => a + j.cost.actualUsd, 0), reportedFor: known.length, unreported: mj.length - known.length },
        adSpend: { usd: 0, note: 'No ad has run. Meta bills ad spend directly to your ad account.' },
        subscription: { usd: null, note: 'No billing in this build.' }, defaults: defaultCaps() };
    }) },
    expenses: { method: 'GET', run: wrap(async kv => expenses(kv)) },
    audit: { method: 'GET', run: wrap(async kv => ({ events: await kv.list('audit') })) },
    exportData: { method: 'GET', run: wrap(async kv => ({ masters: await listMasters(kv), jobs: await listJobs(kv), approvals: await listApprovals(kv), audit: await kv.list('audit'), policy: await getPolicy(kv) })) },
    deleteWorkspace: { method: 'POST', run: wrap(async (kv, _c, i) => {
      if (i.confirm !== kv.ws.slice(0, 6)) throw new PluginError('Type the first six characters of the workspace id to confirm.', 400);
      for (const id of await kv.list('masters')) await kv.del('master:' + id);
      for (const id of await kv.list('jobs')) await kv.del('job:' + id);
      for (const id of await kv.list('approvals')) { await kv.del('appr:' + id); await kv.del('exec:' + id); }
      for (const k of ['masters', 'jobs', 'approvals', 'audit', 'policy']) await kv.del(k);
      return { deleted: true };
    }) },

    masters: { method: 'GET', run: wrap(async kv => ({ masters: await listMasters(kv) })) },
    saveMaster: { method: 'POST', run: wrap(async (kv, _c, i) => ({ master: await saveMaster(kv, i) })) },
    approveMaster: { method: 'POST', run: wrap(async (kv, _c, i) => ({ master: await approveMaster(kv, i.id, { confirmed: i.confirmed }) })) },
    deleteMaster: { method: 'POST', run: wrap(async (kv, _c, i) => { await deleteMaster(kv, i.id); return { ok: true }; }) },

    createJob: { method: 'POST', run: wrap((kv, ctx, i) => createJob(kv, ctx, i)) },
    job: { method: 'GET', run: wrap(async (kv, _c, i) => ({ job: await getJob(kv, i.id) })) },
    jobs: { method: 'GET', run: wrap(async kv => ({ jobs: await listJobs(kv) })) },
    cancelJob: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await cancelJob(kv, i.id) })) },
    validateJob: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await validateJob(kv, i.id, i.findings) })) },
    retryJob: { method: 'POST', run: wrap((kv, ctx, i) => retryJob(kv, ctx, i.id, i.reference)) },

    report: { method: 'POST', run: wrap(async (kv, _c, i) => { const n = z.object({ assetId: z.string().max(60), jobId: z.string().max(60).optional(), note: z.string().min(3).max(500) }).parse(i); const e = await kv.audit('report', 'Inaccuracy reported', n); return { reported: true, id: e.id }; }) },
    approve: { method: 'POST', run: wrap(async (kv, _c, i) => ({ approval: await createApproval(kv, { payload: i.payload }) })) },
    approvals: { method: 'GET', run: wrap(async kv => ({ approvals: await listApprovals(kv) })) },
    verify: { method: 'POST', run: wrap(async (kv, _c, i) => verify(kv, { approvalId: i.approvalId, payload: i.payload })) },
    socialSources: { method: 'GET', run: wrap(async () => ({ sources: SOURCES.map(s => ({ id: s.id, platform: s.platform, ...s.status() })) })) },
    socialScan: { method: 'POST', run: wrap(async (kv, ctx, i) => {
      const inp = z.object({ brand: z.object({ name: z.string().max(80), line: z.string().max(400).optional(), category: z.string().max(80).optional(), products: z.array(z.string().max(80)).max(10).default([]), keywords: z.array(z.string().max(60)).max(10).default([]), tones: z.array(z.string()).max(5).optional() }), market: z.object({ places: z.array(z.string().max(60)).max(20).default([]), countryCodes: z.array(z.string().length(2)).max(10).default([]) }).default({}), idempotencyKey: z.string().min(8).max(80), windowDays: z.number().int().min(1).max(14).default(7) }).parse(i);
      const queries = 4, rk = 'social:' + inp.idempotencyKey; const rv = await reserve(kv, { kind: 'social', idem: rk, units: 1 });
      if (rv.duplicate) { const prev = await kv.get('scan:' + sha256(rk).slice(0, 16)); if (prev) return { ...prev, duplicate: true }; throw new PluginError('This scan is already running.', 409, { code: 'duplicate_request' }); }
      let out; try { out = await runPipeline({ brand: inp.brand, market: inp.market, sources: SOURCES, windowDays: inp.windowDays, maxQueries: queries, fetch: ctx.fetch, known: new Set((await kv.list('opps'))) }); } catch (e) { await release(kv, rk); throw e; }
      await settle(kv, rk, { actualUsd: out.cost.usd || null });
      for (const o of out.opportunities) { o.cost_units = { usd: out.cost.usd, queries: out.cost.calls, shared_across: out.opportunities.length }; if (!(await kv.get('opp:' + o.id))) { await kv.set('opp:' + o.id, o); await kv.push('opps', o.id, 500); } }
      const rec = { ...out, at: new Date().toISOString(), sources: SOURCES.map(s => ({ id: s.id, ...s.status() })) }; await kv.set('scan:' + sha256(rk).slice(0, 16), rec, 7 * 86400);
      await kv.audit('social', `Social scan: ${out.opportunities.length} opportunities, ${out.blocked.length} blocked source(s)`, { cost: out.cost }); return rec;
    }) },
    importReddit: { method: 'POST', run: wrap(async (kv, _c, i) => {
      const it = manualItem(z.object({ url: z.string().url().max(300), title: z.string().max(300).default(''), text: z.string().min(10).max(3000), subreddit: z.string().max(40).optional() }).parse(i));
      const brand = z.object({ products: z.array(z.string()).default([]), category: z.string().optional() }).parse(i.brand || {});
      const { buildKeywords, scoreItem, regionOf, explain } = await import('../social/pipeline.js'); const { redditSource } = await import('../social/sources.js');
      const kw = buildKeywords(brand), region = regionOf(it, i.market || {}), elig = redditSource.eligibility(it), s = scoreItem({ ...it, text: it.text }, { brandTerms: kw.brandTerms, trend: null, region, eligibility: elig });
      const o = { id: 'op_' + sha256(it.url).slice(0, 16), platform: 'reddit', source_id: 'reddit.manual', source_url: it.url, posted_at: it.createdAt, fetched_at: new Date().toISOString(), title: it.title, excerpt: it.text.slice(0, 280), cluster: null, query: null, trend: { label: 'insufficient_data', reason: 'A single user-supplied thread cannot show a trend.' }, geo: { basis: region.basis, evidence: region.evidence }, eligibility: elig, intent_score: s.parts.intent, relevance_score: s.parts.audience_fit, freshness_score: s.parts.freshness, score: s.score, gated: s.gated, opportunity_type: 'participate', explanation: explain(it, s, null, region) + ' Supplied by you; Cold Start did not fetch it.', confidence: 'low', channel_mode: 'organic', recommended_action: 'Read the subreddit rules, then post it yourself.', status: 'new', manual: true, cost_units: { usd: 0, queries: 0 } };
      await kv.set('opp:' + o.id, o); await kv.push('opps', o.id, 500); return { opportunity: o };
    }) },
    opportunities: { method: 'GET', run: wrap(async kv => ({ opportunities: (await Promise.all((await kv.list('opps')).map(id => kv.get('opp:' + id)))).filter(Boolean).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) })) },
    draftPost: { method: 'POST', run: wrap(async (kv, ctx, i) => {
      const o = await kv.get('opp:' + z.string().max(40).parse(i.opportunityId)); if (!o) throw new PluginError('Unknown opportunity.', 404);
      const brand = z.object({ name: z.string().max(80), line: z.string().max(400).optional(), tones: z.array(z.string()).max(5).optional(), facts: z.array(z.string().max(200)).max(10).optional() }).parse(i.brand);
      const d = await draftFor({ opportunity: o, brand, fetch: ctx.fetch }); await kv.audit('social', 'Draft created for ' + o.id, { mode: d.mode, issues: d.issues.length }); return { draft: d, opportunity: o };
    }) },
    checkDraft: { method: 'POST', run: wrap(async (kv, _c, i) => ({ issues: validateDraft(z.object({ platform: z.enum(['x', 'reddit', 'facebook', 'instagram']), text: z.string().max(6000), kind: z.enum(['post', 'reply']).default('post') }).parse(i)) })) },
    integrations: { method: 'GET', run: wrap(async (kv, ctx) => ({ integrations: integrationStatus(ctx), background: backgroundStatus(), compositor: process.env.COMPOSITE_API_URL ? 'configured (not live-verified unless a test recorded it)' : 'requires_credentials' })) },
    createPublish: { method: 'POST', run: wrap(async (kv, _c, i) => createPublish(kv, { payload: i.payload, idempotencyKey: i.idempotencyKey })) },
    authorizePublish: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await authorizePublish(kv, i.id, { hash: i.hash }) })) },
    editPublish: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await editPublish(kv, i.id, i.payload) })) },
    cancelPublish: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await cancelPublish(kv, i.id) })) },
    runPublish: { method: 'POST', run: wrap((kv, ctx, i) => runPublish(kv, ctx, i.id)) },
    resolvePublish: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await resolveUnknown(kv, i.id, i) })) },
    markManual: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await markManual(kv, i.id, { url: i.url }) })) },
    refreshMetrics: { method: 'POST', run: wrap((kv, ctx, i) => refreshMetrics(kv, ctx, i.id)) },
    trackingInspect: { method: 'POST', run: wrap(async (kv, ctx, i) => { const r = await inspectSite(z.object({ url: z.string().max(300) }).parse(i).url, ctx.fetch); await kv.audit('tracking', 'Inspected ' + new URL(r.url).host, { pixels: r.pixelIds.length, platform: r.platform }); return { inspection: r, guidance: installGuidance(r.platform) }; }) },
    trackingAssess: { method: 'POST', run: wrap(async (_kv, _c, i) => ({ assessment: assessTracking(z.object({ site: z.any().optional(), log: z.array(z.any()).max(100).default([]) }).parse(i)) })) },
    publishJobs: { method: 'GET', run: wrap(async kv => ({ jobs: await listPublish(kv) })) },
    publishJob: { method: 'GET', run: wrap(async (kv, _c, i) => ({ job: await getPublish(kv, i.id) })) },
    compositeAd: { method: 'POST', run: wrap(async (kv, ctx, i) => {
      const z2 = z.object({ masterId: z.string().max(60), reference: z.string().startsWith('data:image/').max(30e6), background: z.string().startsWith('data:image/').max(30e6).optional(), scene: z.string().max(200).optional(), mood: z.string().max(100).optional(), ratio: z.enum(['4:5', '9:16', '1:1']).default('4:5'), idempotencyKey: z.string().min(8).max(80).optional() }).parse(i);
      const master = await getMaster(kv, z2.masterId); if (!master) throw new PluginError('Unknown product master.', 404);
      if (master.status !== 'approved') throw new PluginError('Approve the product master first.', 403, { code: 'master_not_approved' });
      const sha = crypto.createHash('sha256').update(Buffer.from(z2.reference.split(',')[1] || '', 'base64')).digest('hex');
      if (!master.identity.refs.some(r => r.sha256 === sha)) throw new PluginError('That photo is not part of the approved product master.', 403, { code: 'unknown_reference' });
      const rk = 'comp:' + (z2.idempotencyKey || crypto.randomUUID()); await reserve(kv, { kind: 'creative', idem: rk });
      const [w, h] = { '4:5': [1080, 1350], '9:16': [1080, 1920], '1:1': [1080, 1080] }[z2.ratio];
      let bg = z2.background, bgInfo = null; const gen = pickBg(); if (!bg && gen && z2.scene) { try { const g = await gen.generate({ prompt: backgroundPrompt({ scene: z2.scene, mood: z2.mood, ratio: z2.ratio }), fetch: ctx.fetch }); bg = g.dataUrl; bgInfo = { provider: gen.id, model: g.model, prompt_has_product: false }; } catch (e) { await release(kv, rk); throw e; } }
      let out; try { out = await composite({ reference: z2.reference, background: bg, width: w, height: h, fetch: ctx.fetch }); } catch (e) { await release(kv, rk); throw e; }
      await settle(kv, rk, { actualUsd: null });
      const rep = { ...out.report, masterId: master.id, masterVersion: master.version, ratio: z2.ratio, mode: 'pixel-locked', synthesized: false, backgroundSynthesized: bg ? true : false, backgroundProvider: bgInfo, verified: false, needsHumanReview: true, at: new Date().toISOString() };
      await kv.audit('creative', 'Pixel-locked composite (' + rep.protected_pixel_equality + ')', { master: master.id, output: rep.output_sha256, protectedChanged: rep.protected_pixels_changed });
      return { image: out.image, report: rep };
    }) },
    revoke: { method: 'POST', run: wrap(async (kv, _c, i) => ({ approval: await revokeApproval(kv, i.id) })) },
    execute: { method: 'POST', run: wrap((kv, ctx, i) => execute(kv, ctx, { approvalId: i.approvalId, payload: i.payload })) },
    execution: { method: 'GET', run: wrap(async (kv, _c, i) => ({ execution: (await getExecution(kv, i.approvalId)) || null })) },
  },
};
