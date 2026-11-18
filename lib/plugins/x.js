// X plugin: OAuth 2.0 with PKCE, post creation. Sandbox until X_CLIENT_ID exists.
import { requestJson, qs, need, basic } from './http.js';

const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'];
const tokenHeaders = () => process.env.X_CLIENT_SECRET ? { authorization: basic(process.env.X_CLIENT_ID, process.env.X_CLIENT_SECRET) } : {};

async function token(ctx) {
  const s = ctx.conn.secrets;
  if (s.expires && s.expires > Date.now() + 60e3) return s.token;
  const t = await requestJson(ctx.fetch, 'https://api.x.com/2/oauth2/token', { method: 'POST', headers: tokenHeaders(), form: { grant_type: 'refresh_token', refresh_token: s.refresh, client_id: process.env.X_CLIENT_ID } });
  ctx.setConn({ secrets: { token: t.access_token, refresh: t.refresh_token || s.refresh, expires: Date.now() + t.expires_in * 1000 } });
  return t.access_token;
}

export default {
  id: 'x', name: 'X', vendor: 'X Corp', category: 'Publishing',
  description: 'Publish approved posts to your X account. Search access is separate and paid.',
  capabilities: ['publish.post', 'account.identity'],
  env: ['X_CLIENT_ID'], optionalEnv: ['X_CLIENT_SECRET'],
  docs: 'https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code',
  auth: { type: 'oauth2', scopes: SCOPES, pkce: true },
  liveReady: () => !!process.env.X_CLIENT_ID,
  authorizeUrl: ({ state, redirectUri, challenge }) => `https://x.com/i/oauth2/authorize?${qs({ response_type: 'code', client_id: process.env.X_CLIENT_ID, redirect_uri: redirectUri, scope: SCOPES.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256' })}`,
  async exchange({ code, redirectUri, verifier, fetch: f = fetch }) {
    const t = await requestJson(f, 'https://api.x.com/2/oauth2/token', { method: 'POST', headers: tokenHeaders(), form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: process.env.X_CLIENT_ID } });
    const me = await requestJson(f, 'https://api.x.com/2/users/me', { headers: { authorization: 'Bearer ' + t.access_token } });
    return { mode: 'live', via: 'oauth', account: { id: me.data.id, name: '@' + me.data.username }, secrets: { token: t.access_token, refresh: t.refresh_token, expires: Date.now() + t.expires_in * 1000 } };
  },
  sandboxAccount: () => ({ mode: 'sandbox', via: 'oauth', account: { id: 'sbx_x', name: '@sandbox_founder' }, secrets: {} }),
  actions: {
    post: { method: 'POST', async run(ctx, input) {
      const text = String(input.text || '').trim();
      need(text.length >= 1 && text.length <= 280, 'Posts are 1–280 characters.');
      if (ctx.conn.mode === 'sandbox') return { id: 'sbx' + Date.now(), url: 'https://x.com/sandbox_founder/status/sbx', sandbox: true };
      const r = await requestJson(ctx.fetch, 'https://api.x.com/2/tweets', { method: 'POST', headers: { authorization: 'Bearer ' + await token(ctx) }, json: { text } });
      return { id: r.data.id, url: `https://x.com/i/web/status/${r.data.id}` };
    } },
  },
};
