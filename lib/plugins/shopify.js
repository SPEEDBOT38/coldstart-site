// Shopify plugin: store OAuth, orders/paid webhook → server-side Purchase via the Meta relay,
// and the Customer Events custom pixel for browser events. Sandbox until SHOPIFY_API_KEY/SECRET exist.
import crypto from 'node:crypto';
import { requestJson, qs, need, PluginError } from './http.js';
import { deliver } from './meta/relay.js';

const API = () => process.env.SHOPIFY_API_VERSION || '2025-10';
const SCOPES = ['read_orders', 'read_customers'];
export const validShop = s => /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(String(s || ''));
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** OAuth callback check: HMAC-SHA256 (hex) over the sorted query without `hmac`. */
export function verifyCallback(query, secret = process.env.SHOPIFY_API_SECRET) {
  const { hmac, signature, ...rest } = query;
  const msg = Object.keys(rest).sort().map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`).join('&');
  return !!hmac && safeEq(crypto.createHmac('sha256', secret).update(msg).digest('hex'), hmac);
}
/** Webhook check: base64 HMAC-SHA256 of the raw body in X-Shopify-Hmac-Sha256. */
export function verifyWebhook(raw, header, secret = process.env.SHOPIFY_API_SECRET) {
  return !!secret && !!header && safeEq(crypto.createHmac('sha256', secret).update(raw).digest('base64'), header);
}

/** Shopify order → CAPI input. event_id order_<id> matches the custom pixel's browser Purchase. */
export function orderToEvent(o) {
  const a = o.billing_address || o.shipping_address || {};
  const c = o.customer || {};
  return {
    event_name: 'Purchase', event_id: 'order_' + o.id, action_source: 'website',
    event_time: Math.floor(Date.parse(o.processed_at || o.created_at || Date.now()) / 1000),
    event_source_url: o.order_status_url || (o.landing_site ? 'https://' + (o.domain || 'shop') + o.landing_site : 'https://shopify.com/checkout'),
    ip: o.client_details?.browser_ip, user_agent: o.client_details?.user_agent || 'Shopify webhook',
    user: { email: o.email || c.email, phone: o.phone || a.phone || c.phone, first_name: a.first_name || c.first_name, last_name: a.last_name || c.last_name,
      city: a.city, state: a.province_code, zip: a.zip, country: a.country_code, external_id: c.id ? String(c.id) : undefined },
    custom_data: { value: Number(o.current_total_price || o.total_price), currency: o.currency, order_id: String(o.id), content_type: 'product',
      content_ids: (o.line_items || []).map(l => String(l.product_id)).filter(Boolean), num_items: (o.line_items || []).reduce((n, l) => n + (l.quantity || 0), 0) },
  };
}

const admin = (ctx, path, opts = {}) => requestJson(ctx.fetch, `https://${ctx.conn.account.id}/admin/api/${API()}/${path}`,
  { ...opts, headers: { 'x-shopify-access-token': ctx.conn.secrets.token } });

export async function handleWebhook({ store, fetch: f }, { raw, headers }) {
  if (!verifyWebhook(raw, headers['x-shopify-hmac-sha256'])) return { status: 401, body: { error: 'bad hmac' } };
  const topic = headers['x-shopify-topic'], shop = headers['x-shopify-shop-domain'];
  if (topic !== 'orders/paid') return { status: 200, body: { ignored: topic } };
  const route = validShop(shop) && await store.get('shop:' + shop);
  if (!route?.siteKey) return { status: 200, body: { ignored: 'shop not linked' } };
  let order; try { order = JSON.parse(raw); } catch { return { status: 400, body: { error: 'bad json' } }; }
  const r = await deliver({ store, fetch: f }, route.siteKey, orderToEvent(order), { source: 'shopify' });
  return { status: 200, body: { delivered: r.ok } };   // 200 either way so Shopify doesn't retry validation failures
}

export default {
  id: 'shopify',
  name: 'Shopify',
  vendor: 'Shopify',
  category: 'Store',
  description: 'Connect the store, send paid orders to Meta server-side, and install browser events through Customer Events.',
  capabilities: ['store.connect', 'webhook.orders_paid', 'capi.purchase', 'pixel.customer_events'],
  env: ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET'],
  optionalEnv: ['SHOPIFY_API_VERSION'],
  docs: 'https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant',
  auth: { type: 'oauth2', scopes: SCOPES, needsShop: true },
  liveReady: () => !!(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET),

  authorizeUrl({ state, redirectUri, shop }) {
    need(validShop(shop), 'Use the store’s your-store.myshopify.com address.');
    return `https://${shop}/admin/oauth/authorize?${qs({ client_id: process.env.SHOPIFY_API_KEY, scope: SCOPES.join(','), redirect_uri: redirectUri, state })}`;
  },
  async exchange({ code, query, fetch: f = fetch }) {
    need(validShop(query.shop), 'Invalid shop.');
    if (!verifyCallback(query)) throw new PluginError('Shopify callback signature did not verify.', 400);
    const t = await requestJson(f, `https://${query.shop}/admin/oauth/access_token`, { method: 'POST', json: { client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, code } });
    return { mode: 'live', via: 'oauth', account: { id: query.shop, name: query.shop }, secrets: { token: t.access_token, scope: t.scope } };
  },
  sandboxAccount: query => ({ mode: 'sandbox', via: 'oauth', account: { id: validShop(query.shop) ? query.shop : 'sandbox-store.myshopify.com', name: (validShop(query.shop) ? query.shop : 'sandbox-store.myshopify.com') + ' (sandbox)' }, secrets: {} }),
  async onDisconnect(ctx) { await ctx.store.del('shop:' + ctx.conn.account.id); },

  actions: {
    shop: { method: 'GET', async run(ctx) {
      const link = await ctx.store.get('shop:' + ctx.conn.account.id);
      if (ctx.conn.mode === 'sandbox') return { name: 'Sandbox Store', domain: ctx.conn.account.id, currency: 'USD', linkedSiteKey: link?.siteKey || null, webhooks: ctx.conn.webhooks || [] };
      const { shop } = await admin(ctx, 'shop.json');
      return { name: shop.name, domain: shop.myshopify_domain, currency: shop.currency, linkedSiteKey: link?.siteKey || null, webhooks: ctx.conn.webhooks || [] };
    } },
    linkMeta: { method: 'POST', async run(ctx) {
      const meta = ctx.getConn('meta');
      need(meta?.siteKey, 'Connect Meta and choose a dataset first.');
      await ctx.store.set('shop:' + ctx.conn.account.id, { siteKey: meta.siteKey });
      const address = `${ctx.origin}/api/webhooks/shopify`;
      let webhooks = ['orders/paid'];
      if (ctx.conn.mode === 'live') {
        const existing = (await admin(ctx, 'webhooks.json')).webhooks || [];
        if (!existing.some(w => w.topic === 'orders/paid' && w.address === address))
          await admin(ctx, 'webhooks.json', { method: 'POST', json: { webhook: { topic: 'orders/paid', address, format: 'json' } } });
      }
      ctx.setConn({ webhooks });
      return { linked: meta.siteKey, webhooks, address };
    } },
    simulateOrder: { method: 'POST', async run(ctx, input) {
      need(ctx.conn.mode === 'sandbox', 'Order simulation is sandbox-only. Place a real test order on the live store.');
      const link = await ctx.store.get('shop:' + ctx.conn.account.id);
      need(link?.siteKey, 'Link this store to a Meta dataset first.');
      const order = { id: Date.now(), email: input.email || 'buyer@example.com', currency: 'USD', total_price: String(input.value || '58.00'), created_at: new Date().toISOString(),
        order_status_url: `https://${ctx.conn.account.id}/orders/status`, client_details: { browser_ip: ctx.req.ip, user_agent: ctx.req.ua || 'Sandbox buyer' },
        billing_address: { first_name: 'Sam', last_name: 'Rivera', city: 'Austin', province_code: 'TX', zip: '78701', country_code: 'US' }, line_items: [{ product_id: 111, quantity: 2 }] };
      const r = await deliver(ctx, link.siteKey, orderToEvent(order), { source: 'shopify' });
      if (!r.ok) throw new PluginError(r.error || r.errors?.join(' '), 400);
      return { order: { id: order.id, total: order.total_price }, sent: r.event, response: r.response };
    } },
  },
};
