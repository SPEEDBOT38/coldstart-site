// Client for workers/composite (rembg matte + Pillow composite). Returns { image, report } or throws PluginError.
import { PluginError } from '../plugins/http.js';
// COMPOSITE_API_URL points at a container host; COMPOSITE_ON_VERCEL=1 uses the Python function in this same deployment (/api/compose/*).
const base = () => (process.env.COMPOSITE_API_URL || (process.env.COMPOSITE_ON_VERCEL === '1' && process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL + '/api/compose' : '')).replace(/\/$/, '');
const hdrs = () => ({ 'content-type': 'application/json', ...(process.env.COMPOSITE_KEY ? { authorization: 'Bearer ' + process.env.COMPOSITE_KEY } : {}), ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && !process.env.COMPOSITE_API_URL ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) });
export const compositeConfigured = () => !!base();
export async function composite({ reference, background, mask, width, height, scale, fetch: f = globalThis.fetch }) {
  if (!compositeConfigured()) throw new PluginError('The product compositor is not connected (set COMPOSITE_API_URL). Nothing was generated.', 503, { code: 'requires_credentials' });
  let r;
  try { r = await f(base() + '/composite', { method: 'POST', headers: hdrs(), body: JSON.stringify({ reference, background, mask, width, height, scale }), signal: AbortSignal.timeout(120000) }); }
  catch (e) { throw new PluginError('Compositor unreachable: ' + e.message, 502, { code: 'unreachable' }); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new PluginError(d.error || 'Compositor error ' + r.status, r.status === 400 ? 400 : 502, { code: 'compositor' });
  return d;
}

/** Candidate mattes (primary + independent second opinion) for the cutout editor. No compositing, no generation cost. */
export async function matte({ reference, fetch: f = globalThis.fetch }) {
  if (!compositeConfigured()) throw new PluginError('The product compositor is not connected (set COMPOSITE_API_URL).', 503, { code: 'requires_credentials' });
  let r; try { r = await f(base() + '/matte', { method: 'POST', headers: hdrs(), body: JSON.stringify({ reference }), signal: AbortSignal.timeout(90000) }); }
  catch (e) { throw new PluginError('Compositor unreachable: ' + e.message, 502, { code: 'unreachable' }); }
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new PluginError(d.error || 'Compositor error ' + r.status, 502, { code: 'compositor' }); return d;
}
