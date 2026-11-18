// Meta plugin: dataset (Pixel) setup + Conversions API. Live with META_APP_ID/SECRET (Facebook Login),
// or live through a pasted dataset ID + Conversions API token from Events Manager, else sandbox.
import { requestJson, qs, need, PluginError } from '../http.js';
import { liveGraph, sandboxGraph, version } from './graph.js';
import { createSite, dropSite, loadSite, updateSite, deliver, getLog } from './relay.js';
import { storefrontSnippet, shopifyCustomPixel } from './snippet.js';
import { STANDARD_EVENTS } from './capi.js';

const SCOPES = ['ads_management', 'business_management', 'ads_read'];
const graph = ctx => ctx.conn.mode === 'live' ? liveGraph(ctx.conn.secrets.token, ctx.fetch) : sandboxGraph(ctx.store, ctx.conn.account.id);
const pixelOf = ctx => { need(ctx.conn.pixel?.id, 'Choose a dataset first.'); return ctx.conn.pixel; };

export default {
  id: 'meta',
  name: 'Meta',
  vendor: 'Meta Platforms',
  category: 'Tracking',
  description: 'Meta Pixel (dataset) setup and the Conversions API, with browser↔server deduplication by event_id.',
  capabilities: ['dataset.select', 'dataset.create', 'pixel.snippet', 'capi.send', 'capi.relay', 'events.stats'],
  env: ['META_APP_ID', 'META_APP_SECRET'],
  optionalEnv: ['META_CONFIG_ID', 'META_GRAPH_VERSION'],
  docs: 'https://developers.facebook.com/docs/marketing-api/conversions-api',
  auth: { type: 'oauth2', scopes: SCOPES, token: { fields: ['pixel_id', 'access_token'], hint: 'Events Manager → your dataset → Settings → Conversions API → Generate access token' } },
  liveReady: () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET),

  authorizeUrl({ state, redirectUri }) {
    const p = { client_id: process.env.META_APP_ID, redirect_uri: redirectUri, state, response_type: 'code' };
    if (process.env.META_CONFIG_ID) p.config_id = process.env.META_CONFIG_ID; else p.scope = SCOPES.join(',');
    return `https://www.facebook.com/${version()}/dialog/oauth?${qs(p)}`;
  },

  async exchange({ code, redirectUri, fetch: f = fetch }) {
    const base = `https://graph.facebook.com/${version()}/oauth/access_token`;
    const app = { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET };
    const short = await requestJson(f, `${base}?${qs({ ...app, redirect_uri: redirectUri, code })}`);
    const long = await requestJson(f, `${base}?${qs({ ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`);
    const token = long.access_token || short.access_token;
    const me = await liveGraph(token, f).get('me', { fields: 'id,name' });
    return { mode: 'live', via: 'oauth', account: { id: me.id, name: me.name }, secrets: { token, expires: long.expires_in ? Date.now() + long.expires_in * 1000 : null } };
  },

  sandboxAccount: () => ({ mode: 'sandbox', via: 'oauth', account: { id: 'sbx_' + Math.random().toString(36).slice(2, 10), name: 'Sandbox Business User' }, secrets: {} }),

  /** Manual path: dataset ID + CAPI token generated in Events Manager. Works without a Meta app. */
  async connectToken({ pixel_id, access_token }, ctx) {
    need(/^\d{6,20}$/.test(String(pixel_id || '')), 'Dataset (Pixel) ID should be the numeric ID from Events Manager.');
    need(typeof access_token === 'string' && access_token.length > 20, 'Paste the Conversions API access token.');
    const px = await liveGraph(access_token, ctx.fetch).get(String(pixel_id), { fields: 'id,name' });
    const conn = { mode: 'live', via: 'token', account: { id: 'dataset_' + px.id, name: px.name || 'Dataset ' + px.id }, secrets: { token: access_token }, pixel: { id: px.id, name: px.name || '' } };
    conn.siteKey = await createSite(ctx.store, { pixelId: px.id, pixelName: px.name, token: access_token, mode: 'live', acct: conn.account.id });
    return conn;
  },

  async onDisconnect(ctx) { await dropSite(ctx.store, ctx.conn.siteKey); },

  actions: {
    status: { method: 'GET', async run(ctx) {
      const site = ctx.conn.siteKey ? await loadSite(ctx.store, ctx.conn.siteKey) : null;
      return { mode: ctx.conn.mode, via: ctx.conn.via, account: ctx.conn.account, pixel: ctx.conn.pixel || null, siteKey: ctx.conn.siteKey || null, consent: site?.consent || 'grant',
        expires: ctx.conn.secrets?.expires || null, graphVersion: version(), standardEvents: STANDARD_EVENTS };
    } },
    adAccounts: { method: 'GET', async run(ctx) {
      need(ctx.conn.via !== 'token', 'Token connections are scoped to one dataset. Connect with Facebook to browse ad accounts.');
      const r = await graph(ctx).get('me/adaccounts', { fields: 'id,account_id,name,account_status,currency', limit: 100 });
      return { data: r.data.map(a => ({ id: a.id, name: a.name, currency: a.currency, active: a.account_status === 1 })) };
    } },
    pixels: { method: 'GET', async run(ctx, input) {
      need(/^act_\d+$/.test(input.ad_account_id || ''), 'Pick an ad account.');
      const r = await graph(ctx).get(`${input.ad_account_id}/adspixels`, { fields: 'id,name,creation_time,last_fired_time', limit: 100 });
      return { data: r.data };
    } },
    createPixel: { method: 'POST', async run(ctx, input) {
      need(/^act_\d+$/.test(input.ad_account_id || ''), 'Pick an ad account.');
      const name = String(input.name || '').trim();
      need(name.length >= 2 && name.length <= 100, 'Name the dataset (2–100 characters).');
      const r = await graph(ctx).post(`${input.ad_account_id}/adspixels`, { name });
      return { id: r.id, name };
    } },
    selectPixel: { method: 'POST', async run(ctx, input) {
      need(/^\d{6,20}$/.test(String(input.pixel_id || '')), 'Pick a dataset.');
      const px = await graph(ctx).get(String(input.pixel_id), { fields: 'id,name' });
      if (ctx.conn.siteKey) await dropSite(ctx.store, ctx.conn.siteKey);
      const siteKey = await createSite(ctx.store, { pixelId: px.id, pixelName: px.name, token: ctx.conn.secrets.token, mode: ctx.conn.mode, acct: ctx.conn.account.id, consent: input.consent === 'wait' ? 'wait' : 'grant' });
      ctx.setConn({ pixel: { id: px.id, name: px.name }, siteKey });
      return { pixel: { id: px.id, name: px.name }, siteKey };
    } },
    setConsent: { method: 'POST', async run(ctx, input) {
      need(ctx.conn.siteKey, 'Choose a dataset first.');
      const consent = input.consent === 'wait' ? 'wait' : 'grant';
      await updateSite(ctx.store, ctx.conn.siteKey, { consent });
      return { consent };
    } },
    snippet: { method: 'GET', async run(ctx) {
      const px = pixelOf(ctx);
      const site = await loadSite(ctx.store, ctx.conn.siteKey);
      const o = { pixelId: px.id, siteKey: ctx.conn.siteKey, origin: ctx.origin, consent: site?.consent };
      return { storefront: storefrontSnippet(o), shopify: shopifyCustomPixel(o), collectUrl: `${ctx.origin}/api/collect/${ctx.conn.siteKey}` };
    } },
    sendTestEvent: { method: 'POST', async run(ctx, input) {
      pixelOf(ctx);
      const name = String(input.event_name || 'PageView');
      const id = 'test_' + Date.now().toString(36);
      const custom = ['Purchase', 'AddToCart', 'InitiateCheckout', 'ViewContent'].includes(name) ? { value: Number(input.value || 49), currency: String(input.currency || 'USD') } : {};
      const tc = String(input.test_event_code || '').trim();
      need(!tc || /^TEST\w{1,20}$/.test(tc), 'Test event codes look like TEST12345 (Events Manager → Test events).');
      const r = await deliver(ctx, ctx.conn.siteKey, {
        event_name: name, event_id: id, event_source_url: ctx.origin + '/coldstart-test', ip: ctx.req.ip, user_agent: ctx.req.ua || 'Coldstart test',
        user: { email: input.email || undefined, external_id: 'coldstart-test' }, custom_data: custom,
      }, { source: 'test', test_event_code: tc || undefined });
      if (!r.ok) throw new PluginError(r.error || r.errors?.join(' '), r.status || 400, r);
      return { sent: r.event, response: r.response, mode: r.mode };
    } },
    stats: { method: 'GET', async run(ctx) {
      const px = pixelOf(ctx);
      let counts = {}, note = '';
      try {
        const r = await graph(ctx).get(`${px.id}/stats`, { aggregation: 'event', start_time: Math.floor(Date.now() / 1000) - 7 * 86400 });
        for (const b of r.data || []) for (const d of b.data || []) counts[d.value] = (counts[d.value] || 0) + Number(d.count || 0);
      } catch (e) { note = 'Meta stats unavailable: ' + e.message; }
      const log = await getLog(ctx.store, ctx.conn.siteKey);
      return { counts, log: log.slice(0, 25), note };
    } },
  },
};
