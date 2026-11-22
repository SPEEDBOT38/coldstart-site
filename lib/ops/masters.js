// Product master: the approved identity of a product (SKU, variant, protected text/logo/colours/regions)
// and what generation is allowed to change. Server-authoritative: jobs read it from here, never from the client.
import { z } from 'zod';
import { PluginError } from '../plugins/http.js';
import { sha256, nid, now } from './kv.js';

const Region = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1), label: z.string().max(60).default('protected') });
export const Identity = z.object({
  name: z.string().min(1).max(120), sku: z.string().min(1).max(60), variant: z.string().max(80).default(''),
  refs: z.array(z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), label: z.string().max(40).default('front') })).min(1).max(8),
  text: z.array(z.string().min(1).max(120)).max(30).default([]),         // packaging text the user confirmed
  logo: z.object({ present: z.boolean().default(false), note: z.string().max(120).default('') }).default({ present: false, note: '' }),
  colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(8).default([]),
  regions: z.array(Region).max(12).default([]),
});
export const Alter = z.object({ background: z.boolean().default(false), relight: z.boolean().default(false), recolor: z.boolean().default(false), viewpoint: z.boolean().default(false) });
const ALL_OFF = { background: false, relight: false, recolor: false, viewpoint: false };

/** Hash covers exactly the protected identity. Changing it voids approval. */
export const identityHash = id => sha256(Identity.parse(id));

export async function saveMaster(kv, input) {
  const id = Identity.parse(input.identity), alter = Alter.parse({ ...ALL_OFF, ...(input.alter || {}) });
  const hash = identityHash(id);
  const cur = input.id ? await kv.get('master:' + input.id) : null;
  if (input.id && !cur) throw new PluginError('Unknown product master.', 404);
  const m = cur || { id: nid('pm_'), createdAt: now(), version: 0, status: 'draft', history: [] };
  const identityChanged = !cur || cur.hash !== hash;
  if (identityChanged) { m.version += 1; if (cur && m.status === 'approved') m.status = 'needs_reapproval'; m.approved = null; }
  m.identity = id; m.hash = hash; m.updatedAt = now();
  // widening what generation may touch is an identity-level change: it needs a fresh approval too
  const widened = Object.keys(alter).some(k => alter[k] && !(cur?.alter || ALL_OFF)[k]);
  if (widened && m.status === 'approved') { m.status = 'needs_reapproval'; m.approved = null; }
  m.alter = alter;
  m.history.unshift({ at: now(), version: m.version, hash, event: !cur ? 'created' : identityChanged ? 'identity changed' : widened ? 'alterations widened' : 'saved' });
  m.history = m.history.slice(0, 30);
  await kv.set('master:' + m.id, m); await kv.push('masters', m.id, 100);
  await kv.audit('master', `${m.status === 'needs_reapproval' ? 'Identity changed, approval voided: ' : 'Saved: '}${id.name}`, { id: m.id, version: m.version, hash });
  return m;
}
export async function approveMaster(kv, id, { confirmed }) {
  const m = await kv.get('master:' + id); if (!m) throw new PluginError('Unknown product master.', 404);
  if (!confirmed || !confirmed.text || !confirmed.colors || !confirmed.logo) throw new PluginError('Confirm packaging text, colours and logo before approving.', 400);
  if (!m.identity.text.length && !m.identity.logo.present) throw new PluginError('Add at least one confirmed packaging text line or mark a logo, so there is something to check generated images against.', 400);
  m.status = 'approved'; m.approved = { at: now(), hash: m.hash, version: m.version };
  m.history.unshift({ at: now(), version: m.version, hash: m.hash, event: 'approved' });
  await kv.set('master:' + id, m); await kv.audit('master', 'Approved product master: ' + m.identity.name, { id, version: m.version, hash: m.hash });
  return m;
}
export const getMaster = async (kv, id) => kv.get('master:' + id);
export async function listMasters(kv) { return (await Promise.all((await kv.list('masters')).map(i => kv.get('master:' + i)))).filter(Boolean); }
export async function deleteMaster(kv, id) { await kv.del('master:' + id); await kv.set('masters', (await kv.list('masters')).filter(i => i !== id)); await kv.audit('master', 'Deleted product master', { id }); }
