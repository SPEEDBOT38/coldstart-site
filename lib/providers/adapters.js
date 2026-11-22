// ProviderAdapter contract used by the publish outbox:
//   status(ctx)  → { state: 'ready' | 'requires_credentials' | 'requires_approval' | 'not_implemented', integration: <label>, reason }
//   publish(ctx, job) → { externalId, url?, costUsd? }   throws Error{ ambiguous:true } when the provider may have acted (timeouts)
//   verify(ctx, job)  → { exists: boolean }               reads the post back from the provider
// Integration labels never say "live" unless a live test recorded it (see docs/IMPLEMENTATION-MATRIX.md): verified_live | tested_sandbox | mock_only.
import { requestJson, PluginError } from '../plugins/http.js';

import { classify } from './classify.js';
import { liveGraph } from '../plugins/meta/graph.js';
const fail = e => { const c = classify(e); throw Object.assign(e, { kind: c.kind, ambiguous: c.ambiguous, retryable: c.retryable, message: c.message }); };

/** X user-context token (OAuth 2.0 PKCE, scopes tweet.read tweet.write users.read offline.access). App-only bearer (X_BEARER_TOKEN) is for search/counts and can NOT post. */
async function xAuth(ctx) {
  const c = ctx.getConn('x'); if (!c) return null; if (c.mode === 'sandbox') return { sandbox: true };
  const s = c.secrets || {}; if (!s.token) return null;
  if (process.env.X_ALLOWED_ACCOUNT && c.account && c.account.name.toLowerCase() !== process.env.X_ALLOWED_ACCOUNT.toLowerCase()) throw Object.assign(new Error('This workspace may only post from the designated test account ' + process.env.X_ALLOWED_ACCOUNT + '.'), { kind: 'client' });
  if (s.expires && s.expires < Date.now() + 60e3) {
    if (!s.refresh || !process.env.X_CLIENT_ID) throw Object.assign(new Error('X token expired. Reconnect X.'), { kind: 'auth' });
    let t; try { t = await requestJson(ctx.fetch, 'https://api.x.com/2/oauth2/token', { method: 'POST', headers: process.env.X_CLIENT_SECRET ? { authorization: 'Basic ' + Buffer.from(process.env.X_CLIENT_ID + ':' + process.env.X_CLIENT_SECRET).toString('base64') } : {}, form: { grant_type: 'refresh_token', refresh_token: s.refresh, client_id: process.env.X_CLIENT_ID } }); }
    catch (e) { throw Object.assign(new Error('X token refresh failed. Reconnect X.'), { kind: 'auth' }); }
    const secrets = { token: t.access_token, refresh: t.refresh_token || s.refresh, expires: Date.now() + t.expires_in * 1000 };
    ctx.setConnFor && ctx.setConnFor('x', { secrets }); return { token: secrets.token };
  }
  return { token: s.token };
}
const X = {
  id: 'x', integration: 'mock_only',
  status(ctx) {
    const c = ctx.getConn('x'); if (!c) return { state: 'requires_credentials', integration: 'requires_credentials', reason: 'Connect X with the publishing account (Settings → Connections).' };
    if (c.mode === 'sandbox') return { state: 'ready', integration: 'tested_sandbox', reason: 'Sandbox connection: nothing is posted.' };
    if (process.env.X_PUBLISH_ENABLED !== '1') return { state: 'requires_approval', integration: 'mock_only', reason: 'Live X publishing is switched off. The account owner must set X_PUBLISH_ENABLED=1 after choosing a designated test account (X_ALLOWED_ACCOUNT).' };
    return { state: 'ready', integration: 'mock_only', reason: 'Connected. Not marked verified_live until a real post has been read back (see docs/ACCEPTANCE-CP4.md).' };
  },
  async publish(ctx, j) {
    const a = await xAuth(ctx); if (!a) throw Object.assign(new Error('X is not connected.'), { kind: 'auth' });
    if (a.sandbox) return { externalId: 'sbx_' + j.id, url: 'sandbox://no-such-post', sandbox: true };
    let r; try { r = await requestJson(ctx.fetch, 'https://api.x.com/2/tweets', { method: 'POST', headers: { authorization: 'Bearer ' + a.token }, json: { text: j.payload.link ? j.payload.text + ' ' + j.payload.link : j.payload.text }, timeout: 15000 }); } catch (e) { fail(e); }
    if (!r.data || !r.data.id) throw Object.assign(new Error('X accepted the request but returned no post id.'), { ambiguous: true });
    return { externalId: r.data.id, url: 'https://x.com/i/web/status/' + r.data.id };
  },
  async verify(ctx, j) {
    const a = await xAuth(ctx); if (a && a.sandbox) return { exists: false, sandbox: true };
    const r = await requestJson(ctx.fetch, 'https://api.x.com/2/tweets/' + encodeURIComponent(j.externalId), { headers: { authorization: 'Bearer ' + a.token } }); return { exists: r.data?.id === j.externalId };
  },
};
X.metrics = async (ctx, j) => { const a = await xAuth(ctx); if (!a || a.sandbox) return { source: 'none', note: 'No live X connection.' }; const r = await requestJson(ctx.fetch, 'https://api.x.com/2/tweets/' + encodeURIComponent(j.externalId) + '?tweet.fields=public_metrics', { headers: { authorization: 'Bearer ' + a.token } }); const m = r.data.public_metrics || {}; return { source: 'x.public_metrics', observed_at: new Date().toISOString(), likes: m.like_count ?? null, comments: m.reply_count ?? null, reposts: m.retweet_count ?? null, quotes: m.quote_count ?? null, impressions: m.impression_count ?? null, raw: m }; };
const notImplemented = (id, why) => ({ id, status: () => ({ state: 'not_implemented', integration: 'not_implemented', reason: why }), publish: async () => { throw new Error(why); }, verify: async () => ({ exists: null }) });

/* Meta Graph publishing. Needs App Review (pages_manage_posts / instagram_content_publish). Page ids are configuration, not secrets. Never marked verified_live without a read-back. */
const metaGate = (ctx, what) => {
  const c = ctx.getConn('meta'); if (!c) return { state: 'requires_credentials', integration: 'requires_credentials', reason: 'Connect Meta (Settings → Connections).' };
  if (c.mode === 'sandbox') return { state: 'ready', integration: 'tested_sandbox', reason: 'Sandbox connection: nothing is posted.' };
  if (process.env.META_PUBLISH_ENABLED !== '1') return { state: 'requires_approval', integration: 'mock_only', reason: `Live ${what} publishing is off. It needs Meta App Review for the publishing permission, then META_PUBLISH_ENABLED=1.` };
  if (!process.env.META_PAGE_ID) return { state: 'requires_credentials', integration: 'requires_credentials', reason: 'Set META_PAGE_ID to the Page you designated for test posts.' };
  return { state: 'ready', integration: 'mock_only', reason: 'Configured. Not verified_live until a post is read back.' };
};
async function pageToken(ctx) {
  const c = ctx.getConn('meta'); const g = liveGraph(c.secrets.token, ctx.fetch);
  const p = await g.get(process.env.META_PAGE_ID, { fields: 'access_token,instagram_business_account' }); if (!p.access_token) throw Object.assign(new Error('No Page access token. The connected user needs a role on the Page and pages_manage_posts.'), { kind: 'permission' });
  return { token: p.access_token, ig: p.instagram_business_account && p.instagram_business_account.id };
}
const FB = {
  id: 'facebook', status: ctx => metaGate(ctx, 'Facebook Page'),
  async publish(ctx, j) {
    if (ctx.getConn('meta').mode === 'sandbox') return { externalId: 'sbx_' + j.id, url: 'sandbox://no-such-post', sandbox: true };
    try { const t = await pageToken(ctx), g = liveGraph(t.token, ctx.fetch); const r = await g.post(process.env.META_PAGE_ID + '/feed', { message: j.payload.text, link: j.payload.link }); if (!r.id) throw Object.assign(new Error('Facebook returned no post id.'), { ambiguous: true }); return { externalId: r.id, url: 'https://www.facebook.com/' + r.id }; } catch (e) { if (e.kind) throw e; fail(e); }
  },
  async verify(ctx, j) { const t = await pageToken(ctx), r = await liveGraph(t.token, ctx.fetch).get(j.externalId, { fields: 'id,created_time' }); return { exists: r.id === j.externalId }; },
  async metrics(ctx, j) { const t = await pageToken(ctx), r = await liveGraph(t.token, ctx.fetch).get(j.externalId, { fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0),shares' }); return { source: 'facebook_graph', observed_at: new Date().toISOString(), likes: r.likes?.summary?.total_count ?? null, comments: r.comments?.summary?.total_count ?? null, shares: r.shares?.count ?? null, note: 'Reach/impressions need pages_read_engagement insights and are reported as unavailable here.' }; },
};
const IG = {
  id: 'instagram', status: ctx => metaGate(ctx, 'Instagram'),
  async publish(ctx, j) {
    if (ctx.getConn('meta').mode === 'sandbox') return { externalId: 'sbx_' + j.id, url: 'sandbox://no-such-post', sandbox: true };
    if (!j.payload.imageUrl) throw Object.assign(new Error('Instagram needs a public https image URL (imageUrl). Text-only posts are not supported.'), { kind: 'client' });
    try {
      const t = await pageToken(ctx); if (!t.ig) throw Object.assign(new Error('The Page has no linked Instagram professional account.'), { kind: 'permission' });
      const g = liveGraph(t.token, ctx.fetch); const c = await g.post(t.ig + '/media', { image_url: j.payload.imageUrl, caption: j.payload.text });
      const m = await g.post(t.ig + '/media_publish', { creation_id: c.id }); if (!m.id) throw Object.assign(new Error('Instagram returned no media id.'), { ambiguous: true });
      return { externalId: m.id, url: null };
    } catch (e) { if (e.kind) throw e; fail(e); }
  },
  async verify(ctx, j) { const t = await pageToken(ctx), r = await liveGraph(t.token, ctx.fetch).get(j.externalId, { fields: 'id,permalink' }); return { exists: r.id === j.externalId, url: r.permalink }; },
  async metrics(ctx, j) { const t = await pageToken(ctx), r = await liveGraph(t.token, ctx.fetch).get(j.externalId, { fields: 'like_count,comments_count' }); return { source: 'instagram_graph', observed_at: new Date().toISOString(), likes: r.like_count ?? null, comments: r.comments_count ?? null, note: 'Reach and saves need the insights endpoint and are reported as unavailable here.' }; },
};
const REG = {
  x: X,
  facebook: FB,
  instagram: IG,
  reddit: { id: 'reddit', status: () => ({ state: 'requires_approval', integration: 'requires_approval', reason: 'Reddit commercial API access needs Reddit’s written approval. Use Assisted mode: draft here, post it yourself.' }), publish: async () => { throw new Error('requires_approval'); }, verify: async () => ({ exists: null }) },
};
export const adapterFor = ch => { const a = REG[ch]; if (!a) throw new PluginError('Unknown channel.', 400); return a; };
export const integrationStatus = ctx => Object.fromEntries(Object.entries(REG).map(([k, a]) => [k, a.status(ctx)]));
