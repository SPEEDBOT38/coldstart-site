// treg (treg.to): one token, thousands of per-call priced tools. We call it over plain HTTP:
// POST|GET https://treg.to/call/<tool id> with X-Treg-Token; the cost comes back in X-Treg-Cost-Micro.
import { PluginError } from './plugins/http.js';

export const hasTreg = () => !!process.env.TREG_TOKEN;

export async function tregCall(fetchImpl, id, { method = 'POST', body, query, timeout = 25000 } = {}) {
  if (!hasTreg()) throw new PluginError('TREG_TOKEN is not set on the server.', 503);
  const url = new URL('https://treg.to/call/' + id);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const headers = { 'x-treg-token': process.env.TREG_TOKEN, accept: 'application/json' };
  if (process.env.TREG_ORG) headers['x-treg-org'] = process.env.TREG_ORG;
  if (body) headers['content-type'] = 'application/json';
  let r;
  try { r = await fetchImpl(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new PluginError('treg unreachable: ' + (e.message || e), 502); }
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  const micro = Number(r.headers.get('x-treg-cost-micro') ?? data?._treg?.charged_micro ?? 0) || 0;
  if (r.status === 402) throw new PluginError('treg balance is empty. Top up at treg.to.', 402, data);
  if (!r.ok) throw new PluginError('treg ' + id + ': ' + (data?.detail || data?.error || data?.message || 'HTTP ' + r.status), r.status === 429 ? 429 : 502, data);
  return { data: data?.output ?? data?.result ?? data, usd: micro / 1e6, servedBy: r.headers.get('x-treg-served-by') || null };
}
