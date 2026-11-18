// Reddit plugin: OAuth (permanent), identity, self-post submission. Sandbox until REDDIT_CLIENT_ID/SECRET.
import { requestJson, qs, need, basic } from './http.js';

const UA = () => process.env.REDDIT_USER_AGENT || 'web:coldstart:0.2 (by /u/coldstart)';
const SCOPES = ['identity', 'submit', 'read'];

async function token(ctx) {
  const s = ctx.conn.secrets;
  if (s.expires && s.expires > Date.now() + 60e3) return s.token;
  const t = await requestJson(ctx.fetch, 'https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { authorization: basic(process.env.REDDIT_CLIENT_ID, process.env.REDDIT_CLIENT_SECRET), 'user-agent': UA() }, form: { grant_type: 'refresh_token', refresh_token: s.refresh } });
  ctx.setConn({ secrets: { ...s, token: t.access_token, expires: Date.now() + t.expires_in * 1000 } });
  return t.access_token;
}

export default {
  id: 'reddit', name: 'Reddit', vendor: 'Reddit', category: 'Publishing',
  description: 'Post to communities you choose, as your account, after you approve each draft.',
  capabilities: ['publish.self_post', 'account.identity'],
  env: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'], optionalEnv: ['REDDIT_USER_AGENT'],
  docs: 'https://github.com/reddit-archive/reddit/wiki/OAuth2',
  auth: { type: 'oauth2', scopes: SCOPES },
  liveReady: () => !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),
  authorizeUrl: ({ state, redirectUri }) => `https://www.reddit.com/api/v1/authorize?${qs({ client_id: process.env.REDDIT_CLIENT_ID, response_type: 'code', state, redirect_uri: redirectUri, duration: 'permanent', scope: SCOPES.join(' ') })}`,
  async exchange({ code, redirectUri, fetch: f = fetch }) {
    const t = await requestJson(f, 'https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { authorization: basic(process.env.REDDIT_CLIENT_ID, process.env.REDDIT_CLIENT_SECRET), 'user-agent': UA() }, form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri } });
    const me = await requestJson(f, 'https://oauth.reddit.com/api/v1/me', { headers: { authorization: 'bearer ' + t.access_token, 'user-agent': UA() } });
    return { mode: 'live', via: 'oauth', account: { id: me.id, name: 'u/' + me.name }, secrets: { token: t.access_token, refresh: t.refresh_token, expires: Date.now() + t.expires_in * 1000 } };
  },
  sandboxAccount: () => ({ mode: 'sandbox', via: 'oauth', account: { id: 'sbx_reddit', name: 'u/sandbox_founder' }, secrets: {} }),
  actions: {
    submit: { method: 'POST', async run(ctx, input) {
      const sr = String(input.subreddit || '').replace(/^\/?r\//, '');
      need(/^[A-Za-z0-9_]{2,21}$/.test(sr), 'Enter a subreddit name.');
      need(String(input.title || '').trim().length >= 3 && String(input.title).length <= 300, 'Title must be 3–300 characters.');
      need(input.rules_checked === true, 'Confirm you read the community rules.');
      if (ctx.conn.mode === 'sandbox') return { url: `https://www.reddit.com/r/${sr}/comments/sbx${Date.now().toString(36)}/`, sandbox: true };
      const r = await requestJson(ctx.fetch, 'https://oauth.reddit.com/api/submit', { method: 'POST', headers: { authorization: 'bearer ' + await token(ctx), 'user-agent': UA() }, form: { sr, kind: 'self', title: input.title, text: input.body || '', api_type: 'json' } });
      const errs = r.json?.errors || [];
      need(!errs.length, 'Reddit: ' + errs.map(e => e.join(' ')).join('; '));
      return { url: r.json?.data?.url };
    } },
  },
};
