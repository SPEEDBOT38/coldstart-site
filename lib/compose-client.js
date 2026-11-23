// Server-to-compositor calls. On Vercel the Python function sits behind the same Deployment Protection as the site, so a
// server-side fetch to its own URL gets the SSO login page (401/302) instead of the compositor. The supported fix is
// Vercel's "Protection Bypass for Automation": Vercel injects VERCEL_AUTOMATION_BYPASS_SECRET into the deployment and a
// request carrying it in `x-vercel-protection-bypass` skips protection. That secret stays on the server (never sent to the
// browser). COMPOSITE_KEY, when set, is checked by the compositor itself as a second, app-level credential.
export function compositorUrl(op, { origin } = {}) {
  const base = (process.env.COMPOSITE_API_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : origin) || '').replace(/\/$/, '');
  if (!base) return null;
  return process.env.COMPOSITE_API_URL ? base + '/' + op : base + '/api/compose/' + op;
}
export function compositorHeaders() {
  const h = { 'content-type': 'application/json' };
  if (process.env.COMPOSITE_KEY) h.authorization = 'Bearer ' + process.env.COMPOSITE_KEY;
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) h['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return h;
}
export async function callCompositor(op, body, { origin, fetchImpl = fetch, timeout = 55000 } = {}) {
  const url = compositorUrl(op, { origin });
  if (!url) return { ok: false, status: 0, reason: 'no_compositor_url' };
  let r; try { r = await fetchImpl(url, { method: 'POST', headers: compositorHeaders(), body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(timeout) }); }
  catch (e) { return { ok: false, status: 0, reason: 'unreachable: ' + (e.message || e) }; }
  const type = r.headers.get('content-type') || '';
  if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400) || /text\/html/.test(type)) {
    return { ok: false, status: r.status, reason: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? 'protected_even_with_bypass' : 'deployment_protection_blocks_server_calls' };
  }
  let j = null; try { j = await r.json(); } catch (_) { /* below */ }
  return j && r.ok ? { ok: true, status: r.status, data: j } : { ok: false, status: r.status, reason: (j && j.error) || 'bad_response' };
}
// 1x1 PNG health probe: proves the server can reach the compositor with its credentials.
export const PROBE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
