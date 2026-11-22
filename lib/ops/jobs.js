// Durable generation jobs. State is kept in the workspace store (Upstash/KV in production), not in the browser.
//   queued → processing → validating → completed | failed | cancelled
// "validating" = the image exists and is waiting for identity QA findings (OCR/colour checks run client-side).
// Nothing here marks a creative as verified: `verified` stays false unless QA findings arrive with no failures.
import crypto from 'node:crypto';
import { z } from 'zod';
import { PluginError } from '../plugins/http.js';
import { generateImage } from '../plugins/images.js';
import { enforce, counter } from './policy.js';
import { getMaster, Alter } from './masters.js';
import { sha256, nid, now } from './kv.js';

export const WORKFLOW = 'creative-first@1';
export const STATES = ['queued', 'processing', 'validating', 'completed', 'failed', 'cancelled'];
const NEXT = { queued: ['processing', 'cancelled'], processing: ['validating', 'failed', 'cancelled'], validating: ['completed', 'failed', 'cancelled'], failed: ['queued'], completed: [], cancelled: [] };

const Input = z.object({
  masterId: z.string().min(3), idempotencyKey: z.string().min(8).max(80),
  direction: z.string().min(1).max(60), prompt: z.string().min(3).max(2000),
  ratio: z.enum(['1:1', '4:5', '9:16', '16:9']).default('4:5'),
  alter: Alter.default({ background: false, relight: false, recolor: false, viewpoint: false }),
  reference: z.string().regex(/^data:image\/(png|jpe?g|webp);base64,/).max(6_000_000),
  parentJobId: z.string().optional(),
});
const bytesOf = dataUrl => Buffer.from(dataUrl.split(',')[1] || '', 'base64');

async function move(kv, job, to, patch = {}) {
  if (!NEXT[job.state].includes(to)) throw new PluginError(`Job ${job.id} cannot go from ${job.state} to ${to}.`, 409);
  job.state = to; job.updatedAt = now(); Object.assign(job, patch); job.history.push({ state: to, at: job.updatedAt });
  await kv.set('job:' + job.id, job); return job;
}
const publicJob = j => j && ({ ...j });

export async function createJob(kv, ctx, raw) {
  const input = Input.parse(raw);
  const idemKey = 'idem:' + sha256({ k: input.idempotencyKey });
  const existing = await kv.get(idemKey);
  if (existing) { const j = await kv.get('job:' + existing); if (j) return { job: publicJob(j), duplicate: true }; }

  await enforce(kv, 'creative');   // 423 if paused, 429 if over the workspace cap
  const master = await getMaster(kv, input.masterId);
  if (!master) throw new PluginError('Unknown product master.', 404);
  if (master.status !== 'approved') throw new PluginError(master.status === 'needs_reapproval' ? 'Product identity changed. Re-approve the product master before generating.' : 'Approve the product master before generating.', 403, { code: 'master_not_approved' });
  const denied = Object.keys(input.alter).filter(k => input.alter[k] && !master.alter[k]);
  if (denied.length) throw new PluginError('This product master does not allow: ' + denied.join(', ') + '. Enable it on the product first.', 403, { code: 'alteration_denied', denied });
  if (!Object.values(input.alter).some(Boolean)) throw new PluginError('Choose what may change (background, lighting, colour or viewpoint). Nothing to generate otherwise.', 400, { code: 'no_alteration' });
  const refSha = crypto.createHash('sha256').update(bytesOf(input.reference)).digest('hex');
  if (!master.identity.refs.some(r => r.sha256 === refSha)) throw new PluginError('That reference image is not part of the approved product master.', 403, { code: 'unknown_reference' });

  const est = Number(process.env.IMAGE_COST_EST_USD);
  const job = {
    id: nid('job_'), ws: kv.ws, kind: 'creative.generate', state: 'queued', workflow: WORKFLOW, idempotencyKey: sha256(input.idempotencyKey),
    createdAt: now(), updatedAt: now(), attempts: 0, prompt: input.prompt, parentJobId: input.parentJobId || null,
    inputRefs: { masterId: master.id, masterVersion: master.version, masterHash: master.hash, refSha, direction: input.direction, ratio: input.ratio, alter: input.alter },
    model: null, output: null, error: null,
    cost: { estimateUsd: Number.isFinite(est) && est > 0 ? est : null, actualUsd: null, basis: 'estimate is configured (IMAGE_COST_EST_USD); actual is whatever the provider reports' },
    review: { synthesized: true, viewpointChanged: !!input.alter.viewpoint, verified: false, findings: null },
    history: [{ state: 'queued', at: now() }],
  };
  await kv.set('job:' + job.id, job); await kv.set(idemKey, job.id, 2 * 86400); await kv.push('jobs', job.id, 200);
  await kv.audit('job', 'Queued generation ' + job.id, { job: job.id, masterId: master.id, version: master.version, alter: input.alter });
  const image = await run(kv, ctx, job, input);
  return { job: publicJob(await kv.get('job:' + job.id)), image, duplicate: false };
}

/** Inline executor. A queue adapter (workers/pipeline, Cloudflare Queues) would call this same function. */
async function run(kv, ctx, job, input) {
  await move(kv, job, 'processing', { attempts: job.attempts + 1 });
  let r;
  try {
    r = await generateImage({ store: ctx.store, fetch: ctx.fetch, ip: ctx.req?.ip }, { prompt: input.prompt, reference: input.reference, aspect: input.ratio, model: 'pro', palette: {} });
  } catch (e) {
    await move(kv, job, 'failed', { error: { code: e.status === 429 ? 'rate_limited' : 'provider_error', message: String(e.message).slice(0, 300), retryable: !(e.status >= 400 && e.status < 500 && e.status !== 429) } });
    await kv.audit('job', 'Generation failed ' + job.id, { job: job.id, error: job.error.message });
    return null;
  }
  const buf = bytesOf(r.image);
  const sniff = buf[0] === 0xff && buf[1] === 0xd8 || buf.subarray(1, 4).toString() === 'PNG' || buf.subarray(0, 4).toString() === 'RIFF';
  if (!sniff || buf.length < 4) { await move(kv, job, 'failed', { error: { code: 'bad_output', message: 'Provider returned data that is not an image.', retryable: true } }); return null; }
  const out = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length, mime: r.image.slice(5, r.image.indexOf(';')), model: r.model };
  await counter.bump(kv, 'creative', 'month');
  await move(kv, job, 'validating', { model: r.model, output: out, cost: { ...job.cost, actualUsd: typeof r.usd === 'number' ? r.usd : null } });
  return r.image;
}

export async function getJob(kv, id) { const j = await kv.get('job:' + id); if (!j) throw new PluginError('Unknown job.', 404); return publicJob(j); }
export async function listJobs(kv) { return (await Promise.all((await kv.list('jobs')).map(i => kv.get('job:' + i)))).filter(Boolean); }

export async function cancelJob(kv, id) {
  const j = await getJob(kv, id);
  if (['completed', 'cancelled'].includes(j.state)) throw new PluginError(`A ${j.state} job cannot be cancelled.`, 409);
  const out = await move(kv, j, 'cancelled'); await kv.audit('job', 'Cancelled ' + id, { job: id }); return out;
}
/** Client posts QA findings from the OCR/colour checks. Completed only when there is no failing finding. */
export async function validateJob(kv, id, findings) {
  const F = z.array(z.object({ check: z.string().max(60), status: z.enum(['pass', 'fail', 'unverified']), detail: z.string().max(300).default('') })).min(1).max(30).parse(findings);
  const j = await getJob(kv, id);
  if (j.state !== 'validating') throw new PluginError(`Job is ${j.state}, not validating.`, 409);
  const failed = F.some(f => f.status === 'fail'), unverified = F.some(f => f.status === 'unverified');
  j.review = { ...j.review, findings: F, verified: !failed && !unverified, needsReview: true };
  const out = await move(kv, j, failed ? 'failed' : 'completed', failed ? { error: { code: 'qa_failed', message: F.filter(f => f.status === 'fail').map(f => f.check).join(', '), retryable: true } } : {});
  await kv.audit('job', `QA ${failed ? 'failed' : 'recorded'} for ${id}`, { job: id, findings: F });
  return out;
}
/** Safe retry: only failed jobs; reuses the id so the idempotency key still points at one job. Needs a fresh reference. */
export async function retryJob(kv, ctx, id, reference) {
  const j = await getJob(kv, id);
  if (j.state !== 'failed') throw new PluginError('Only failed jobs can be retried.', 409);
  if (j.error?.retryable === false) throw new PluginError('This failure is not retryable: ' + j.error.message, 409);
  const master = await getMaster(kv, j.inputRefs.masterId);
  if (!master || master.status !== 'approved' || master.hash !== j.inputRefs.masterHash) throw new PluginError('The product master changed since this job was queued. Start a new generation.', 409);
  await enforce(kv, 'creative');
  const input = Input.parse({ masterId: master.id, idempotencyKey: 'retry-' + id + '-' + (j.attempts + 1) + '-xxxx', direction: j.inputRefs.direction, prompt: j.prompt, ratio: j.inputRefs.ratio, alter: j.inputRefs.alter, reference });
  await move(kv, j, 'queued', { error: null });
  const image = await run(kv, ctx, j, input);
  return { job: await getJob(kv, id), image };
}
