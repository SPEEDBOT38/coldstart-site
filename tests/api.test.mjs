import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createHandler } from '../lib/app.js';
import { createStore } from '../lib/store.js';

for (const k of ['META_APP_ID', 'META_APP_SECRET', 'SHOPIFY_API_KEY', 'REDDIT_CLIENT_ID', 'X_CLIENT_ID', 'PLUGINS']) delete process.env[k];
process.env.SESSION_SECRET = 's'.repeat(40);

const servers = [];
test.afterEach(() => { while (servers.length) { const s = servers.pop(); s.closeAllConnections?.(); s.close(); } });
function start(opts = {}) {
  const store = createStore({ STORE: 'memory' });
  const server = http.createServer(createHandler({ store, ...opts }));
  servers.push(server);
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, store, base: `http://127.0.0.1:${server.address().port}` })));
}
function client(base) {
  let cookies = {};
  const jar = res => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); const val = v.join('='); if (val) cookies[k] = val; else delete cookies[k]; } };
  const cookie = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    cookies: () => cookies,
    async get(path, { follow = false } = {}) {
      const r = await fetch(base + path, { headers: { cookie: cookie() }, redirect: 'manual' }); jar(r);
      if (follow && r.status === 302) return this.get(new URL(r.headers.get('location'), base).pathname + new URL(r.headers.get('location'), base).search, { follow });
      return r;
    },
    async post(path, body = {}, headers = { 'x-coldstart': '1' }) {
      const r = await fetch(base + path, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }); jar(r);
      return r;
    },
  };
}
const act = async (c, plugin, action, body) => {
  const r = body === undefined ? await c.get(`/api/plugins/${plugin}/actions/${action}`) : await c.post(`/api/plugins/${plugin}/actions/${action}`, body);
  const j = await r.json(); if (r.status !== 200) throw new Error(`${plugin}.${action} ${r.status}: ${JSON.stringify(j)}`); return j;
};
async function connectSandbox(c, plugin, extra = '') {
  const r1 = await c.get(`/api/plugins/${plugin}/connect${extra}`);
  assert.equal(r1.status, 302);
  const consent = new URL(r1.headers.get('location'), 'http://x');
  assert.equal(consent.pathname, '/api/sandbox/authorize');
  const page = await (await c.get(consent.pathname + consent.search)).text();
  const approve = page.match(/href="([^"]+callback[^"]+)"/)[1].replace(/&amp;/g, '&');
  const r2 = await c.get(approve);
  assert.equal(r2.status, 302);
  assert.match(r2.headers.get('location'), new RegExp(`/app\\.html#/(tracking|connections)\\?connected=${plugin}`));
}

test('health and plugin list report sandbox mode without secrets', async () => {
  const { server, base } = await start();
  const c = client(base);
  const h = await (await c.get('/api/health')).json();
  assert.equal(h.ok, true);
  const list = await (await c.get('/api/plugins')).json();
  const meta = list.plugins.find(p => p.id === 'meta');
  assert.equal(meta.mode, 'sandbox');
  assert.deepEqual(meta.missingEnv, ['META_APP_ID', 'META_APP_SECRET']);
  assert.equal(meta.connection, null);
  server.close();
});

test('full Meta Pixel + CAPI flow in sandbox, then Shopify orders dedupe by order id', async () => {
  const { server, base } = await start();
  const c = client(base);
  await connectSandbox(c, 'meta');
  assert.ok(c.cookies().cs_vault, 'vault cookie set');
  assert.ok(!decodeURIComponent(c.cookies().cs_vault).includes('Sandbox'), 'vault is sealed');

  const accounts = await act(c, 'meta', 'adAccounts');
  const acct = accounts.data[0].id;
  const created = await act(c, 'meta', 'createPixel', { ad_account_id: acct, name: 'Fern & Form web' });
  const pixels = await act(c, 'meta', 'pixels?ad_account_id=' + acct);
  assert.ok(pixels.data.some(p => p.id === created.id));
  const sel = await act(c, 'meta', 'selectPixel', { pixel_id: created.id });
  assert.match(sel.siteKey, /^cs_/);

  const snip = await act(c, 'meta', 'snippet');
  assert.match(snip.storefront, new RegExp(`fbq\\('init','${created.id}'\\)`));
  assert.match(snip.storefront, new RegExp(`/api/collect/${sel.siteKey}`));
  assert.match(snip.shopify, /analytics\.subscribe\('checkout_completed'/);

  const t = await act(c, 'meta', 'sendTestEvent', { event_name: 'Purchase', value: 30, currency: 'usd', email: 'Ana@Example.com', test_event_code: 'TEST123' });
  assert.equal(t.response.events_received, 1);
  assert.equal(t.sent.custom_data.currency, 'USD');
  assert.equal(t.sent.user_data.em[0], crypto.createHash('sha256').update('ana@example.com').digest('hex'));

  // browser mirror: sendBeacon posts text/plain without cookies or custom headers
  const beacon = await fetch(`${base}/api/collect/${sel.siteKey}`, { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 test' },
    body: JSON.stringify({ event_name: 'AddToCart', event_id: 'atc_1', event_source_url: 'https://fern.example/p/1', custom_data: { value: 12, currency: 'USD' }, user: { fbp: 'fb.1.1.1' } }) });
  assert.equal(beacon.status, 204);
  assert.equal(beacon.headers.get('access-control-allow-origin'), '*');
  const bad = await fetch(`${base}/api/collect/${sel.siteKey}`, { method: 'POST', body: JSON.stringify({ event_name: 'PageView' }) });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${base}/api/collect/cs_doesnotexist`, { method: 'POST', body: '{}' })).status, 404);

  await connectSandbox(c, 'shopify', '?shop=fern-and-form.myshopify.com');
  const link = await act(c, 'shopify', 'linkMeta', {});
  assert.equal(link.linked, sel.siteKey);
  const o = await act(c, 'shopify', 'simulateOrder', { value: '58.00' });
  assert.equal(o.sent.event_id, 'order_' + o.order.id);
  assert.equal(o.sent.event_name, 'Purchase');

  const stats = await act(c, 'meta', 'stats');
  assert.equal(stats.counts.Purchase, 2);
  assert.equal(stats.counts.AddToCart, 1);
  assert.deepEqual(stats.log.map(l => l.source).slice(0, 3), ['shopify', 'relay', 'relay']);
  server.close();
});

test('mutating API calls need the x-coldstart header (CSRF)', async () => {
  const { server, base } = await start();
  const c = client(base);
  await connectSandbox(c, 'meta');
  const r = await c.post('/api/plugins/meta/actions/createPixel', { ad_account_id: 'act_1000000001', name: 'x y' }, {});
  assert.equal(r.status, 403);
  server.close();
});

test('callback rejects a forged state', async () => {
  const { server, base } = await start();
  const c = client(base);
  await c.get('/api/plugins/meta/connect');
  const r = await c.get('/api/plugins/meta/callback?code=sbx_x&state=forged');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /error=/);
  assert.equal(c.cookies().cs_vault, undefined);
  server.close();
});

test('disconnect drops the connection and its relay site key', async () => {
  const { server, base } = await start();
  const c = client(base);
  await connectSandbox(c, 'meta');
  const acct = (await act(c, 'meta', 'adAccounts')).data[0].id;
  const px = (await act(c, 'meta', 'pixels?ad_account_id=' + acct)).data[0].id;
  const { siteKey } = await act(c, 'meta', 'selectPixel', { pixel_id: px });
  assert.equal((await c.post('/api/plugins/meta/disconnect')).status, 200);
  const list = await (await c.get('/api/plugins')).json();
  assert.equal(list.plugins.find(p => p.id === 'meta').connection, null);
  assert.equal((await fetch(`${base}/api/collect/${siteKey}`, { method: 'POST', body: '{}' })).status, 404);
  server.close();
});

test('live mode: OAuth URL, token exchange and CAPI calls hit graph.facebook.com with appsecret_proof', async () => {
  process.env.META_APP_ID = '111'; process.env.META_APP_SECRET = 'app-secret';
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    const body = u.pathname.endsWith('/oauth/access_token') ? { access_token: 'LONG_TOKEN', expires_in: 5e6 }
      : u.pathname.endsWith('/me') ? { id: '42', name: 'Founder' }
      : u.pathname.endsWith('/me/adaccounts') ? { data: [{ id: 'act_7', name: 'Live', account_status: 1, currency: 'USD' }] }
      : u.pathname.match(/\/\d+$/) ? { id: '555000111', name: 'Live dataset' }
      : u.pathname.endsWith('/events') ? { events_received: 1, messages: [], fbtrace_id: 'Atrace' } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { server, base } = await start({ fetch: fakeFetch });
  const c = client(base);
  const r1 = await c.get('/api/plugins/meta/connect');
  const auth = new URL(r1.headers.get('location'));
  assert.equal(auth.host, 'www.facebook.com');
  assert.match(auth.pathname, /^\/v\d+\.0\/dialog\/oauth$/);
  assert.equal(auth.searchParams.get('client_id'), '111');
  assert.match(auth.searchParams.get('scope'), /ads_management/);
  const r2 = await c.get(`/api/plugins/meta/callback?code=abc&state=${auth.searchParams.get('state')}`);
  assert.match(r2.headers.get('location'), /connected=meta/);
  await act(c, 'meta', 'selectPixel', { pixel_id: '555000111' });
  await act(c, 'meta', 'sendTestEvent', { event_name: 'PageView' });
  const ev = calls.find(x => x.url.endsWith('/555000111/events'));
  const form = new URLSearchParams(ev.init.body);
  assert.equal(form.get('access_token'), 'LONG_TOKEN');
  assert.equal(form.get('appsecret_proof'), crypto.createHmac('sha256', 'app-secret').update('LONG_TOKEN').digest('hex'));
  assert.equal(JSON.parse(form.get('data'))[0].event_name, 'PageView');
  delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
  server.close();
});

test('Shopify webhook only accepts a valid HMAC and relays the paid order', async () => {
  process.env.SHOPIFY_API_SECRET = 'shp-secret';
  const { server, base, store } = await start();
  const c = client(base);
  await connectSandbox(c, 'meta');
  const acct = (await act(c, 'meta', 'adAccounts')).data[0].id;
  const px = (await act(c, 'meta', 'pixels?ad_account_id=' + acct)).data[0].id;
  const { siteKey } = await act(c, 'meta', 'selectPixel', { pixel_id: px });
  await store.set('shop:fern.myshopify.com', { siteKey });
  const order = JSON.stringify({ id: 9001, email: 'a@b.co', currency: 'USD', total_price: '20.00', created_at: new Date().toISOString(), order_status_url: 'https://fern.myshopify.com/s', client_details: { browser_ip: '1.2.3.4', user_agent: 'UA' } });
  const sig = crypto.createHmac('sha256', 'shp-secret').update(order).digest('base64');
  const h = { 'x-shopify-topic': 'orders/paid', 'x-shopify-shop-domain': 'fern.myshopify.com', 'content-type': 'application/json' };
  assert.equal((await fetch(base + '/api/webhooks/shopify', { method: 'POST', headers: { ...h, 'x-shopify-hmac-sha256': 'nope' }, body: order })).status, 401);
  const ok = await fetch(base + '/api/webhooks/shopify', { method: 'POST', headers: { ...h, 'x-shopify-hmac-sha256': sig }, body: order });
  assert.deepEqual(await ok.json(), { delivered: true });
  const stats = await act(c, 'meta', 'stats');
  assert.equal(stats.log[0].event_id, 'order_9001');
  delete process.env.SHOPIFY_API_SECRET;
  server.close();
});
