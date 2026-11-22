// Approvals bind a person's "yes" to one immutable launch payload (RFC 8785 canonical JSON → SHA-256).
// Executing re-hashes the payload being sent: any change to content, budget, audience, destination or creatives
// voids the approval (409) instead of running something nobody approved.
import { z } from 'zod';
import { PluginError } from '../plugins/http.js';
import { sha256, nid, now } from './kv.js';
import { getPolicy } from './policy.js';
import { createDraft, makeApi } from '../providers/meta-ads.js';

export const LaunchPayload = z.object({
  campaignId: z.string().min(1).max(60), name: z.string().min(2).max(120),
  objective: z.enum(['sales', 'traffic', 'awareness']), channels: z.array(z.enum(['instagram', 'facebook', 'x', 'reddit'])).min(1).max(4),
  budget: z.object({ mode: z.enum(['none', 'amount']), amount: z.number().min(0).max(1e7).default(0), currency: z.string().length(3).default('INR'), period: z.enum(['day', 'month']).default('day') }),
  audience: z.object({ countries: z.array(z.string().length(2)).max(20).default([]), regions: z.array(z.string().max(60)).max(30).default([]) }).default({ countries: [], regions: [] }),
  destination: z.object({ url: z.string().url().max(300).optional(), adAccountId: z.string().regex(/^act_\d+$/).optional() }).default({}),
  creatives: z.array(z.object({ assetId: z.string().max(60), sha256: z.string().regex(/^[a-f0-9]{64}$/), jobId: z.string().optional() })).max(30).default([]),
  copy: z.array(z.string().max(500)).max(30).default([]),
});

export async function createApproval(kv, { payload, actor = 'owner' }) {
  const p = LaunchPayload.parse(payload);
  const a = { id: nid('ap_'), ws: kv.ws, actor, at: now(), version: 1, status: 'active', action: 'launch.draft', hash: sha256(p), payload: p,
    scope: { channels: p.channels, publish: false, spend: p.budget.mode === 'amount' ? `${p.budget.currency} ${p.budget.amount}/${p.budget.period} (cap, not spent)` : 'none' } };
  await kv.set('appr:' + a.id, a); await kv.push('approvals', a.id, 200);
  await kv.audit('approval', `Approved ${p.name}`, { approval: a.id, hash: a.hash, scope: a.scope });
  return a;
}
export const getApproval = async (kv, id) => { const a = await kv.get('appr:' + id); if (!a) throw new PluginError('Unknown approval.', 404); return a; };
export async function listApprovals(kv) { return (await Promise.all((await kv.list('approvals')).map(i => kv.get('appr:' + i)))).filter(Boolean); }

/** Revoking is only possible before execution. After that, content already exists at the provider: use pause/delete there. */
export async function revokeApproval(kv, id) {
  const a = await getApproval(kv, id), ex = await kv.get('exec:' + id);
  if (ex && ['created', 'simulated'].includes(ex.state)) {
    await kv.audit('approval', 'Revoke refused: already executed ' + id, { approval: id, execution: ex.state });
    throw new PluginError('This approval was already executed, so the draft exists at the provider. Revoking cannot undo it. Pause or delete the draft in Meta, then mark it paused here.', 409, { code: 'already_executed', execution: ex });
  }
  a.status = 'revoked'; a.revokedAt = now(); await kv.set('appr:' + id, a); await kv.audit('approval', 'Revoked unexecuted approval ' + id, { approval: id }); return a;
}

/** Non-mutating-except-invalidation check the UI runs whenever it shows an approved campaign. */
export async function verify(kv, { approvalId, payload }) {
  const a = await getApproval(kv, approvalId);
  if (a.status !== 'active') return { valid: false, status: a.status, reason: 'Approval is ' + a.status + '.' };
  const p = LaunchPayload.safeParse(payload);
  if (p.success && sha256(p.data) === a.hash) return { valid: true, status: a.status, hash: a.hash };
  a.status = 'invalidated'; a.invalidatedAt = now(); await kv.set('appr:' + a.id, a);
  await kv.audit('approval', 'Approval invalidated: payload changed ' + a.id, { approval: a.id, approvedHash: a.hash, attemptedHash: p.success ? sha256(p.data) : null });
  return { valid: false, status: 'invalidated', reason: 'The campaign changed after you approved it.' };
}
export async function execute(kv, ctx, { approvalId, payload }) {
  const a = await getApproval(kv, approvalId), policy = await getPolicy(kv);
  if (policy.paused) throw new PluginError('All automation is paused. No external action will run.', 423, { code: 'paused' });
  const done = await kv.get('exec:' + approvalId);
  if (done && ['created', 'simulated'].includes(done.state)) return { execution: done, duplicate: true };       // duplicate-publish guard
  if (a.status !== 'active') throw new PluginError(`Approval is ${a.status}.`, 409, { code: 'approval_' + a.status });
  const p = LaunchPayload.safeParse(payload);
  if (!p.success || sha256(p.data) !== a.hash) {
    a.status = 'invalidated'; a.invalidatedAt = now(); await kv.set('appr:' + a.id, a);
    await kv.audit('approval', 'Approval invalidated: payload changed ' + a.id, { approval: a.id, approvedHash: a.hash, attemptedHash: p.success ? sha256(p.data) : null });
    throw new PluginError('What you are launching changed after you approved it. Review and approve again.', 409, { code: 'payload_changed', approvedHash: a.hash });
  }
  const conn = ctx.getConn('meta');
  const rec = { id: nid('ex_'), approvalId, ws: kv.ws, at: now(), provider: 'meta', hash: a.hash };
  let out;
  if (!conn) out = { ...rec, state: 'blocked', reason: 'not_connected', note: 'Meta is not connected. Nothing was sent.' };
  else if (conn.mode === 'sandbox') out = { ...rec, state: 'simulated', simulated: true, note: 'Sandbox connection. This is a simulation: nothing exists on Meta.' };
  else {
    try {
      const api = ctx.metaApi ? ctx.metaApi(conn.secrets.token) : makeApi(conn.secrets.token);
      const d = await createDraft({ api, payload: p.data });
      out = { ...rec, state: 'created', ...d };
    } catch (e) {
      out = { ...rec, state: 'failed', reason: e.kind || 'error', note: String(e.message).slice(0, 300), retryable: e.kind !== 'auth' && e.kind !== 'client' };
    }
  }
  await kv.set('exec:' + approvalId, out);
  await kv.audit('execution', `Launch ${out.state}: ${p.data.name}`, { approval: approvalId, state: out.state, reason: out.reason });
  return { execution: out, duplicate: false };
}
export const getExecution = (kv, approvalId) => kv.get('exec:' + approvalId);
