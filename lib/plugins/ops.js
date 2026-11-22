// Ops plugin: the server-side source of truth for workspace policy, pause, caps, product masters,
// generation jobs, approvals and launch execution. Always "live": it needs no third-party credentials.
import { z } from 'zod';
import { PluginError } from './http.js';
import { scoped } from '../ops/kv.js';
import { getPolicy, setPolicy, counter, defaultCaps, enforce } from '../ops/policy.js';
import { saveMaster, approveMaster, listMasters, getMaster, deleteMaster } from '../ops/masters.js';
import { createJob, getJob, listJobs, cancelJob, validateJob, retryJob } from '../ops/jobs.js';
import { createPublish, authorizePublish, editPublish, cancelPublish, runPublish, getPublish, listPublish, resolveUnknown } from '../ops/outbox.js';
import { integrationStatus } from '../providers/adapters.js';
import { composite } from '../providers/composite.js';
import crypto from 'node:crypto';
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
    integrations: { method: 'GET', run: wrap(async (kv, ctx) => ({ integrations: integrationStatus(ctx), compositor: process.env.COMPOSITE_API_URL ? 'configured (not live-verified unless a test recorded it)' : 'requires_credentials' })) },
    createPublish: { method: 'POST', run: wrap(async (kv, _c, i) => createPublish(kv, { payload: i.payload, idempotencyKey: i.idempotencyKey })) },
    authorizePublish: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await authorizePublish(kv, i.id, { hash: i.hash }) })) },
    editPublish: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await editPublish(kv, i.id, i.payload) })) },
    cancelPublish: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await cancelPublish(kv, i.id) })) },
    runPublish: { method: 'POST', run: wrap((kv, ctx, i) => runPublish(kv, ctx, i.id)) },
    resolvePublish: { method: 'POST', run: wrap(async (kv, _c, i) => ({ job: await resolveUnknown(kv, i.id, i) })) },
    publishJobs: { method: 'GET', run: wrap(async kv => ({ jobs: await listPublish(kv) })) },
    publishJob: { method: 'GET', run: wrap(async (kv, _c, i) => ({ job: await getPublish(kv, i.id) })) },
    compositeAd: { method: 'POST', run: wrap(async (kv, ctx, i) => {
      const z2 = z.object({ masterId: z.string().max(60), reference: z.string().startsWith('data:image/').max(30e6), background: z.string().startsWith('data:image/').max(30e6).optional(), ratio: z.enum(['4:5', '9:16', '1:1']).default('4:5') }).parse(i);
      const master = await getMaster(kv, z2.masterId); if (!master) throw new PluginError('Unknown product master.', 404);
      if (master.status !== 'approved') throw new PluginError('Approve the product master first.', 403, { code: 'master_not_approved' });
      const sha = crypto.createHash('sha256').update(Buffer.from(z2.reference.split(',')[1] || '', 'base64')).digest('hex');
      if (!master.identity.refs.some(r => r.sha256 === sha)) throw new PluginError('That photo is not part of the approved product master.', 403, { code: 'unknown_reference' });
      await enforce(kv, 'creative');
      const [w, h] = { '4:5': [1080, 1350], '9:16': [1080, 1920], '1:1': [1080, 1080] }[z2.ratio];
      const out = await composite({ reference: z2.reference, background: z2.background, width: w, height: h, fetch: ctx.fetch });
      await counter.bump(kv, 'creative', 'month');
      const rep = { ...out.report, masterId: master.id, masterVersion: master.version, ratio: z2.ratio, mode: 'pixel-locked', synthesized: false, backgroundSynthesized: z2.background ? true : false, verified: false, needsHumanReview: true, at: new Date().toISOString() };
      await kv.audit('creative', 'Pixel-locked composite (' + rep.protected_pixel_equality + ')', { master: master.id, output: rep.output_sha256, protectedChanged: rep.protected_pixels_changed });
      return { image: out.image, report: rep };
    }) },
    revoke: { method: 'POST', run: wrap(async (kv, _c, i) => ({ approval: await revokeApproval(kv, i.id) })) },
    execute: { method: 'POST', run: wrap((kv, ctx, i) => execute(kv, ctx, { approvalId: i.approvalId, payload: i.payload })) },
    execution: { method: 'GET', run: wrap(async (kv, _c, i) => ({ execution: (await getExecution(kv, i.approvalId)) || null })) },
  },
};
