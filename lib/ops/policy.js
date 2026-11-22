// Server-authoritative automation policy, pause switch and usage caps (per workspace).
import { z } from 'zod';
import { PluginError } from '../plugins/http.js';

export const PolicySchema = z.object({
  approval: z.literal('each').default('each'),                      // locked: every post, ad and budget change needs approval
  allow: z.object({ draft: z.literal(true).default(true), organic: z.boolean().default(false), paid: z.boolean().default(false), budget: z.boolean().default(false) }).default({ draft: true, organic: false, paid: false, budget: false }),
  caps: z.object({ research: z.number().int().min(0).max(1000).default(20), credits: z.number().int().min(0).max(5000).default(40) }).default({ research: 20, credits: 40 }),
  paused: z.boolean().default(false),
});
export const defaultPolicy = () => PolicySchema.parse({});
export const getPolicy = async kv => PolicySchema.parse((await kv.get('policy')) || {});
export async function setPolicy(kv, patch) {
  const cur = await getPolicy(kv);
  const next = PolicySchema.parse({ ...cur, ...patch, allow: { ...cur.allow, ...(patch.allow || {}) }, caps: { ...cur.caps, ...(patch.caps || {}) } });
  await kv.set('policy', next);
  const widened = ['organic', 'paid', 'budget'].filter(k => !cur.allow[k] && next.allow[k]);
  await kv.audit('policy', next.paused !== cur.paused ? (next.paused ? 'Paused all automation' : 'Resumed automation') : widened.length ? 'Scope widened: ' + widened.join(', ') : 'Policy updated', { before: cur, after: next });
  return next;
}
export const defaultCaps = () => defaultPolicy().caps;

const day = () => new Date().toISOString().slice(0, 10), month = () => new Date().toISOString().slice(0, 7);
export const counter = {
  key: (kind, span) => `cnt:${kind}:${span === 'day' ? day() : month()}`,
  async read(kv, kind, span) { return Number(await kv.get(counter.key(kind, span))) || 0; },
  async bump(kv, kind, span, by = 1) { const n = await counter.read(kv, kind, span) + by; await kv.set(counter.key(kind, span), n, 40 * 86400); return n; },
};
const CAPS = { research: ['research', 'day', 'Daily research cap'], creative: ['credits', 'month', 'Monthly creative-credit cap'] };

/** Throws 423 while paused, 429 when the workspace cap for `kind` is used up. Returns the policy. */
export async function enforce(kv, kind) {
  const p = await getPolicy(kv);
  if (p.paused) throw new PluginError('All automation is paused for this workspace. Resume it in Settings → Automations.', 423, { code: 'paused' });
  const c = CAPS[kind];
  if (c) {
    const used = await counter.read(kv, kind, c[1]), cap = p.caps[c[0]];
    if (cap > 0 && used >= cap) throw new PluginError(`${c[2]} reached (${used}/${cap}). Raise it in Settings → Automations.`, 429, { code: 'cap', kind, used, cap });
    if (cap === 0) throw new PluginError(`${c[2]} is set to 0, so this is switched off.`, 429, { code: 'cap', kind, used, cap });
  }
  return p;
}
