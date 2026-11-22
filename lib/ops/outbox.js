// Durable publish outbox. One record per external write, persisted BEFORE the provider is called, so a crash or timeout can never
// cause a blind duplicate post: an uncertain write becomes `unknown_external_state` and must be verified or resolved by a person.
//   requested → authorized → queued → executing → verified → completed      (+ blocked | failed | cancelled | unknown_external_state)
import { z } from 'zod';
import { PluginError } from '../plugins/http.js';
import { sha256, nid, now } from './kv.js';
import { enforce, getPolicy } from './policy.js';
import { adapterFor } from '../providers/adapters.js';

export const PublishPayload = z.object({
  channel: z.enum(['x', 'facebook', 'instagram', 'reddit']),
  accountId: z.string().max(80).optional(),
  text: z.string().min(1).max(5000), link: z.string().url().max(300).optional(),
  mediaAssetIds: z.array(z.string().max(60)).max(10).default([]),
  scheduledAt: z.string().datetime().optional(),
});
const NEXT = { requested: ['authorized', 'cancelled'], authorized: ['queued', 'requested', 'cancelled'], queued: ['executing', 'cancelled', 'blocked'],
  executing: ['verified', 'failed', 'blocked', 'unknown_external_state'], verified: ['completed'], blocked: ['queued', 'cancelled'], failed: ['queued', 'cancelled'],
  unknown_external_state: ['verified', 'failed', 'cancelled'], completed: [], cancelled: [] };
const save = (kv, j) => kv.set('pub:' + j.id, j);
async function move(kv, j, to, patch = {}) {
  if (!NEXT[j.state].includes(to)) throw new PluginError(`Publish ${j.id} cannot go from ${j.state} to ${to}.`, 409, { code: 'bad_transition' });
  j.state = to; j.updatedAt = now(); Object.assign(j, patch); j.history.push({ state: to, at: j.updatedAt }); await save(kv, j); return j;
}
export const getPublish = async (kv, id) => { const j = await kv.get('pub:' + id); if (!j) throw new PluginError('Unknown publish job.', 404); return j; };
export async function listPublish(kv) { return (await Promise.all((await kv.list('pubs')).map(i => kv.get('pub:' + i)))).filter(Boolean); }

export async function createPublish(kv, { payload, idempotencyKey }) {
  const p = PublishPayload.parse(payload); if (!z.string().min(8).max(80).safeParse(idempotencyKey).success) throw new PluginError('idempotencyKey is required (8–80 chars).', 400);
  const ik = 'pidem:' + sha256(idempotencyKey), ex = await kv.get(ik);
  if (ex) return { job: await getPublish(kv, ex), duplicate: true };
  const j = { id: nid('pub_'), ws: kv.ws, provider: p.channel, state: 'requested', payload: p, payloadHash: sha256(p), idempotencyKey: sha256(idempotencyKey), authorized: null, attempts: 0, externalId: null, url: null,
    cost: { estimateUsd: 0, actualUsd: null }, error: null, createdAt: now(), updatedAt: now(), history: [{ state: 'requested', at: now() }], trace: nid('tr_', 6) };
  await save(kv, j); await kv.set(ik, j.id, 2 * 86400); await kv.push('pubs', j.id, 300); await kv.audit('publish', `Publish requested (${p.channel})`, { job: j.id, hash: j.payloadHash });
  return { job: j, duplicate: false };
}
/** The person approves this exact payload hash. Editing the payload afterwards voids the authorization. */
export async function authorizePublish(kv, id, { actor = 'owner', hash }) {
  const j = await getPublish(kv, id); if (j.state !== 'requested') throw new PluginError(`Only a requested item can be authorized (it is ${j.state}).`, 409);
  if (hash !== j.payloadHash) throw new PluginError('The content changed since you reviewed it. Review it again.', 409, { code: 'payload_changed', hash: j.payloadHash });
  await move(kv, j, 'authorized', { authorized: { actor, at: now(), hash: j.payloadHash } }); await kv.audit('publish', 'Publish authorized', { job: j.id, hash: j.payloadHash, actor }); return j;
}
export async function editPublish(kv, id, payload) {
  const j = await getPublish(kv, id); if (!['requested', 'authorized', 'blocked', 'failed'].includes(j.state)) throw new PluginError('This item can no longer be edited.', 409);
  const p = PublishPayload.parse(payload); j.payload = p; j.payloadHash = sha256(p); j.authorized = null; j.state = 'requested'; j.updatedAt = now(); j.history.push({ state: 'requested', at: j.updatedAt, note: 'edited; authorization voided' });
  await save(kv, j); await kv.audit('publish', 'Publish edited; authorization voided', { job: j.id, hash: j.payloadHash }); return j;
}
export async function cancelPublish(kv, id) {
  const j = await getPublish(kv, id);
  if (['verified', 'completed'].includes(j.state)) throw new PluginError('Already published. Cancelling cannot remove it: delete it on the platform.', 409, { code: 'already_published', url: j.url });
  await move(kv, j, 'cancelled'); await kv.audit('publish', 'Publish cancelled', { job: j.id }); return j;
}

/** Runs one authorized job. `ctx` supplies getConn/fetch. The attempt is recorded before the provider call. */
export async function runPublish(kv, ctx, id) {
  let j = await getPublish(kv, id);
  if (j.state === 'completed') return { job: j, duplicate: true };
  if (j.state === 'unknown_external_state') throw new PluginError('The result of the last attempt is unknown. Check the platform and resolve it before retrying; retrying could post twice.', 409, { code: 'unknown_external_state' });
  if (j.state === 'authorized' || j.state === 'blocked' || j.state === 'failed') { if (!j.authorized || j.authorized.hash !== sha256(j.payload)) throw new PluginError('Not authorized for this exact content.', 403, { code: 'not_authorized' }); await move(kv, j, 'queued'); }
  if (j.state !== 'queued') throw new PluginError(`Cannot run a ${j.state} item.`, 409);
  const policy = await getPolicy(kv);
  if (policy.paused) { await move(kv, j, 'blocked', { error: { code: 'paused', message: 'All automation is paused.' } }); throw new PluginError('All automation is paused. Nothing was sent.', 423, { code: 'paused' }); }
  if (!policy.allow.organic) { await move(kv, j, 'blocked', { error: { code: 'not_allowed', message: 'Organic publishing is switched off in Settings → Automations.' } }); throw new PluginError('Publishing is switched off for this workspace.', 403, { code: 'not_allowed' }); }
  if (j.payload.scheduledAt && new Date(j.payload.scheduledAt) > new Date()) throw new PluginError('Scheduled for later. It will not run before ' + j.payload.scheduledAt, 409, { code: 'not_due' });
  const ad = adapterFor(j.provider), st = ad.status(ctx);
  if (st.state !== 'ready') { await move(kv, j, 'blocked', { error: { code: st.state, message: st.reason } }); return { job: j, blocked: st }; }
  await move(kv, j, 'executing', { attempts: j.attempts + 1, error: null });              // persisted before the external write
  let r;
  try { r = await ad.publish(ctx, j); }
  catch (e) {
    if (e.ambiguous) { await move(kv, j, 'unknown_external_state', { error: { code: 'ambiguous', message: String(e.message).slice(0, 200) } }); await kv.audit('publish', 'Publish outcome unknown', { job: j.id }); return { job: j, unknown: true }; }
    await move(kv, j, 'failed', { error: { code: e.kind || 'error', message: String(e.message).slice(0, 300), retryable: e.kind !== 'auth' && e.kind !== 'client' } }); await kv.audit('publish', 'Publish failed', { job: j.id, code: e.kind }); return { job: j };
  }
  j.externalId = r.externalId; j.url = r.url || null; if (typeof r.costUsd === 'number') j.cost.actualUsd = r.costUsd;
  let seen; try { seen = await ad.verify(ctx, j); } catch (e) { seen = { exists: null }; }
  if (seen.exists === true) { await move(kv, j, 'verified'); await move(kv, j, 'completed'); await kv.audit('publish', 'Published and verified', { job: j.id, externalId: j.externalId }); }
  else { await move(kv, j, 'unknown_external_state', { error: { code: 'unverified', message: 'The platform accepted the request but the post could not be read back.' } }); await kv.audit('publish', 'Published but not verified', { job: j.id, externalId: j.externalId }); }
  return { job: j };
}
/** A person checked the platform. Only here may an unknown item become published or failed. */
export async function resolveUnknown(kv, id, { outcome, externalId, url }) {
  const j = await getPublish(kv, id); if (j.state !== 'unknown_external_state') throw new PluginError('Nothing to resolve.', 409);
  if (outcome === 'published') { if (!externalId) throw new PluginError('Give the post id or URL you found.', 400); await move(kv, j, 'verified', { externalId, url: url || j.url, error: null }); await move(kv, j, 'completed'); }
  else await move(kv, j, 'failed', { error: { code: 'confirmed_not_published', message: 'Confirmed by a person: nothing was posted.', retryable: true } });
  await kv.audit('publish', 'Unknown outcome resolved: ' + outcome, { job: j.id, externalId }); return j;
}
