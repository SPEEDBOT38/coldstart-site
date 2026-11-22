// ProviderAdapter contract used by the publish outbox:
//   status(ctx)  → { state: 'ready' | 'requires_credentials' | 'requires_approval' | 'not_implemented', integration: <label>, reason }
//   publish(ctx, job) → { externalId, url?, costUsd? }   throws Error{ ambiguous:true } when the provider may have acted (timeouts)
//   verify(ctx, job)  → { exists: boolean }               reads the post back from the provider
// Integration labels never say "live" unless a live test recorded it (see docs/IMPLEMENTATION-MATRIX.md): verified_live | tested_sandbox | mock_only.
import { requestJson, PluginError } from '../plugins/http.js';

const xAuth = async ctx => {
  const c = ctx.getConn('x'); if (!c) return null; if (c.mode === 'sandbox') return { sandbox: true };
  const s = c.secrets; if (!s.token) return null;
  if (s.expires && s.expires < Date.now() + 60e3) throw Object.assign(new Error('X token expired. Reconnect X.'), { kind: 'auth' });
  return { token: s.token };
};
const X = {
  id: 'x', integration: 'mock_only',
  status(ctx) { const c = ctx.getConn('x'); return c ? (c.mode === 'sandbox' ? { state: 'ready', integration: 'tested_sandbox', reason: 'Sandbox connection: nothing is posted.' } : { state: 'ready', integration: 'mock_only', reason: 'Live API contract is coded; no live post has been verified yet.' }) : { state: 'requires_credentials', integration: 'requires_credentials', reason: 'X is not connected.' }; },
  async publish(ctx, j) {
    const a = await xAuth(ctx); if (!a) throw Object.assign(new Error('X is not connected.'), { kind: 'auth' });
    if (a.sandbox) return { externalId: 'sbx_' + j.id, url: 'sandbox://no-such-post', sandbox: true };
    let r; try { r = await requestJson(ctx.fetch, 'https://api.x.com/2/tweets', { method: 'POST', headers: { authorization: 'Bearer ' + a.token }, json: { text: j.payload.link ? j.payload.text + ' ' + j.payload.link : j.payload.text }, timeout: 15000 }); }
    catch (e) { if (e instanceof PluginError && e.status === 502) throw Object.assign(e, { ambiguous: true }); throw Object.assign(e, { kind: e.status === 400 ? 'client' : 'error' }); }
    return { externalId: r.data.id, url: 'https://x.com/i/web/status/' + r.data.id };
  },
  async verify(ctx, j) {
    const a = await xAuth(ctx); if (a && a.sandbox) return { exists: false, sandbox: true };
    const r = await requestJson(ctx.fetch, 'https://api.x.com/2/tweets/' + encodeURIComponent(j.externalId), { headers: { authorization: 'Bearer ' + a.token } }); return { exists: r.data?.id === j.externalId };
  },
};
X.metrics = async (ctx, j) => { const a = await xAuth(ctx); if (!a || a.sandbox) return { source: 'none', note: 'No live X connection.' }; const r = await requestJson(ctx.fetch, 'https://api.x.com/2/tweets/' + encodeURIComponent(j.externalId) + '?tweet.fields=public_metrics', { headers: { authorization: 'Bearer ' + a.token } }); return { source: 'x.public_metrics', ...r.data.public_metrics }; };
const notImplemented = (id, why) => ({ id, status: () => ({ state: 'not_implemented', integration: 'not_implemented', reason: why }), publish: async () => { throw new Error(why); }, verify: async () => ({ exists: null }) });
const REG = {
  x: X,
  facebook: notImplemented('facebook', 'Page publishing needs Meta App Review (pages_manage_posts). Not implemented.'),
  instagram: notImplemented('instagram', 'Instagram publishing needs Meta App Review (instagram_content_publish). Not implemented.'),
  reddit: { id: 'reddit', status: () => ({ state: 'requires_approval', integration: 'requires_approval', reason: 'Reddit commercial API access needs Reddit’s written approval. Use Assisted mode: draft here, post it yourself.' }), publish: async () => { throw new Error('requires_approval'); }, verify: async () => ({ exists: null }) },
};
export const adapterFor = ch => { const a = REG[ch]; if (!a) throw new PluginError('Unknown channel.', 400); return a; };
export const integrationStatus = ctx => Object.fromEntries(Object.entries(REG).map(([k, a]) => [k, a.status(ctx)]));
