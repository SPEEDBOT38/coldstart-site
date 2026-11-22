// Client for workers/composite (rembg matte + Pillow composite). Returns { image, report } or throws PluginError.
import { PluginError } from '../plugins/http.js';
export const compositeConfigured = () => !!process.env.COMPOSITE_API_URL;
export async function composite({ reference, background, mask, width, height, scale, fetch: f = globalThis.fetch }) {
  if (!compositeConfigured()) throw new PluginError('The product compositor is not connected (set COMPOSITE_API_URL). Nothing was generated.', 503, { code: 'requires_credentials' });
  let r;
  try { r = await f(process.env.COMPOSITE_API_URL.replace(/\/$/, '') + '/composite', { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.COMPOSITE_KEY ? { authorization: 'Bearer ' + process.env.COMPOSITE_KEY } : {}) }, body: JSON.stringify({ reference, background, mask, width, height, scale }), signal: AbortSignal.timeout(120000) }); }
  catch (e) { throw new PluginError('Compositor unreachable: ' + e.message, 502, { code: 'unreachable' }); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new PluginError(d.error || 'Compositor error ' + r.status, r.status === 400 ? 400 : 502, { code: 'compositor' });
  return d;
}

/** Candidate mattes (primary + independent second opinion) for the cutout editor. No compositing, no generation cost. */
export async function matte({ reference, fetch: f = globalThis.fetch }) {
  if (!compositeConfigured()) throw new PluginError('The product compositor is not connected (set COMPOSITE_API_URL).', 503, { code: 'requires_credentials' });
  let r; try { r = await f(process.env.COMPOSITE_API_URL.replace(/\/$/, '') + '/matte', { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.COMPOSITE_KEY ? { authorization: 'Bearer ' + process.env.COMPOSITE_KEY } : {}) }, body: JSON.stringify({ reference }), signal: AbortSignal.timeout(90000) }); }
  catch (e) { throw new PluginError('Compositor unreachable: ' + e.message, 502, { code: 'unreachable' }); }
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new PluginError(d.error || 'Compositor error ' + r.status, 502, { code: 'compositor' }); return d;
}
