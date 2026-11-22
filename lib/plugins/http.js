// Shared HTTP plumbing for plugins: JSON fetch with readable errors, form encoding, basic auth.
export class PluginError extends Error {
  constructor(message, status = 502, detail, http) { super(message); this.status = status; this.detail = detail; this.http = http; }
}

export async function requestJson(fetchImpl, url, { method = 'GET', headers = {}, body, form, json, timeout = 15000 } = {}) {
  const h = { accept: 'application/json', ...headers };
  let payload = body;
  if (form) { payload = new URLSearchParams(Object.entries(form).filter(([, v]) => v != null).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
  if (json) { payload = JSON.stringify(json); h['content-type'] = 'application/json'; }
  let r;
  try { r = await fetchImpl(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new PluginError('Network error calling ' + new URL(url).host + ': ' + (e.message || e), 502); }
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!r.ok || data?.error) {
    const e = data?.error;
    const msg = typeof e === 'string' ? (data.error_description || e) : e?.message || data?.detail || data?.message || data?.errors?.[0]?.message || ('HTTP ' + r.status);
    throw new PluginError(msg, r.status >= 400 && r.status < 500 ? 400 : 502, data, r.status);
  }
  return data;
}

export const basic = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
export const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
export const need = (cond, msg) => { if (!cond) throw new PluginError(msg, 400); };
