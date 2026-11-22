// Atomic quota ledger: reserve → execute → settle | release.
//  • reserve:  idempotent (SETNX on the key), then one atomic INCRBY; if the cap is exceeded the increment is undone and the call is refused.
//  • settle:   exactly once (SETNX on the finalisation flag); records the provider cost under the `ai_api` bucket.
//  • release:  exactly once; gives the units back. A settled reservation can never be released, nor a released one settled.
// Three money buckets are never summed: ai_api (our provider spend), subscription (not billed in this build), ad_spend (Meta bills the customer directly;
// we only set provider-side budgets and observe — never write to it here).
import { PluginError } from '../plugins/http.js';
import { sha256, nid, now } from './kv.js';
import { getPolicy, counter } from './policy.js';

const KINDS = { research: ['research', 'day', 'Daily research cap'], creative: ['credits', 'month', 'Monthly creative-credit cap'], social: ['research', 'day', 'Daily research cap'] };
const TTL = 40 * 86400, micro = usd => Math.round(Number(usd) * 1e6);
const rkey = idem => 'rsv:' + sha256(String(idem)).slice(0, 40);

export async function reserve(kv, { kind, idem, units = 1, estimateUsd = null }) {
  const k = KINDS[kind]; if (!k) throw new Error('unknown quota kind ' + kind);
  if (!idem || String(idem).length < 8) throw new PluginError('A unique idempotency key is required for billable requests.', 400, { code: 'idempotency_required' });
  const p = await getPolicy(kv);
  if (p.paused) throw new PluginError('All automation is paused for this workspace. Resume it in Settings → Automations.', 423, { code: 'paused' });
  const cap = p.caps[k[0]];
  const rec = { id: nid('rv_', 6), kind, units, state: 'reserved', estimateUsd, span: k[1], at: now() };
  if (!(await kv.setnx(rkey(idem), rec, TTL))) {                                        // duplicate request or retry: never reserve twice
    const ex = await kv.get(rkey(idem));
    if (ex.state === 'rejected') throw new PluginError(`${k[2]} reached.`, 429, { code: 'cap', kind });
    return { reservation: ex, duplicate: true };
  }
  const ck = counter.key(kind === 'social' ? 'research' : kind, k[1]);
  if (cap === 0) { rec.state = 'rejected'; await kv.set(rkey(idem), rec, TTL); throw new PluginError(`${k[2]} is set to 0, so this is switched off.`, 429, { code: 'cap', kind, cap }); }
  const used = await kv.incrby(ck, units);
  if (cap > 0 && used > cap) { await kv.incrby(ck, -units); rec.state = 'rejected'; await kv.set(rkey(idem), rec, TTL); throw new PluginError(`${k[2]} reached (${used - units}/${cap}). Raise it in Settings → Automations.`, 429, { code: 'cap', kind, used: used - units, cap }); }
  rec.ck = ck; await kv.set(rkey(idem), rec, TTL);
  return { reservation: rec, duplicate: false };
}
async function finalize(kv, idem, state) { return kv.setnx(rkey(idem) + ':fin', { state, at: now() }, TTL); }
export async function settle(kv, idem, { actualUsd = null, note = '' } = {}) {
  const rec = await kv.get(rkey(idem)); if (!rec || rec.state === 'rejected') throw new PluginError('Unknown reservation.', 404);
  if (!(await finalize(kv, idem, 'settled'))) return { duplicate: true, state: (await kv.get(rkey(idem) + ':fin')).state };
  rec.state = 'settled'; rec.actualUsd = typeof actualUsd === 'number' ? actualUsd : null; await kv.set(rkey(idem), rec, TTL);
  const seq = await kv.incrby('exp:seq', 1);
  await kv.set('exp:' + seq, { seq, bucket: 'ai_api', kind: rec.kind, usd: rec.actualUsd, reported: rec.actualUsd !== null, estimateUsd: rec.estimateUsd, reservation: rec.id, note, at: now() }, 400 * 86400);
  if (rec.actualUsd !== null) await kv.incrby('tot:ai_api:' + new Date().toISOString().slice(0, 7), micro(rec.actualUsd));
  return { duplicate: false, state: 'settled' };
}
export async function release(kv, idem) {
  const rec = await kv.get(rkey(idem)); if (!rec || rec.state === 'rejected') return { duplicate: true, state: 'none' };
  if (!(await finalize(kv, idem, 'released'))) return { duplicate: true, state: (await kv.get(rkey(idem) + ':fin')).state };
  await kv.incrby(rec.ck, -rec.units); rec.state = 'released'; await kv.set(rkey(idem), rec, TTL); return { duplicate: false, state: 'released' };
}
/** Runs `fn` between reserve and settle/release. A thrown error releases the units. */
export async function metered(kv, opts, fn) {
  const { reservation, duplicate } = await reserve(kv, opts);
  if (duplicate) throw new PluginError('This request was already submitted (duplicate idempotency key). Nothing was charged twice.', 409, { code: 'duplicate_request', reservation });
  let out; try { out = await fn(); } catch (e) { await release(kv, opts.idem); throw e; }
  await settle(kv, opts.idem, { actualUsd: out?.usd ?? null }); return out;
}
export async function expenses(kv, limit = 50) {
  const top = Number(await kv.get('exp:seq')) || 0, out = [];
  for (let i = top; i > 0 && out.length < limit; i--) { const e = await kv.get('exp:' + i); if (e) out.push(e); }
  return { entries: out, aiApiMicroUsd: Number(await kv.get('tot:ai_api:' + new Date().toISOString().slice(0, 7))) || 0 };
}
