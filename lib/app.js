// Coldstart API: one handler for local (server.js) and Vercel (api/index.js).
//   GET  /api/health                         GET  /api/plugins
//   GET  /api/plugins/:id/connect[?shop=]    GET  /api/plugins/:id/callback
//   POST /api/plugins/:id/token              POST /api/plugins/:id/disconnect
//   GET|POST /api/plugins/:id/actions/:name  GET  /api/sandbox/authorize
//   POST /api/collect/:siteKey  (public, CORS, sendBeacon-friendly)
//   POST /api/webhooks/shopify  (HMAC-verified)
// Connections live in a sealed httpOnly cookie (cs_vault); nothing secret reaches the browser.
import crypto from 'node:crypto';
import { listPlugins, getPlugin, describe } from './plugins/index.js';
import { seal, unseal, randomId, secret } from './vault.js';
import { deliver } from './plugins/meta/relay.js';
import { handleWebhook } from './plugins/shopify.js';
import { reserve, settle, release } from './ops/ledger.js';
import { scoped } from './ops/kv.js';
import { enforce, counter } from './ops/policy.js';

const MAX_BODY = 1_000_000;
const VAULT = 'cs_vault', OAUTH = 'cs_oauth', WS = 'cs_ws';

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; }));
}
function setCookie(res, name, value, { maxAge, path = '/', secure }) {
  const c = `${name}=${value ? encodeURIComponent(value) : ''}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${value ? maxAge : 0}${secure ? '; Secure' : ''}`;
  const prev = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [].concat(prev || [], c));
}
async function readRaw(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw Object.assign(new Error('Body too large.'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ 'cache-control': 'no-store', ...headers })) res.setHeader(k, v);
  if (body === undefined) return res.end();
  if (typeof body === 'string') { if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(body); }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body));
};
const redirect = (res, to) => send(res, 302, undefined, { location: to });
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const landing = id => ['meta', 'shopify'].includes(id) ? 'tracking' : 'connections';

function sandboxPage(plugin, approve, cancel, shop) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sandbox · ${escHtml(plugin.name)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0000F2;color:#F2F2F2;font:14px/1.5 ui-monospace,Menlo,monospace}main{max-width:460px;padding:28px;border:1px solid #f2f2f266;background:#00006A}h1{font:italic 700 26px/1.1 system-ui;text-transform:uppercase;margin:0 0 6px}h1 b{color:#E6FF00}p{opacity:.85}ul{padding-left:18px;opacity:.85}.row{display:flex;gap:10px;margin-top:20px}a{display:inline-block;padding:10px 14px;text-decoration:none;text-transform:uppercase;letter-spacing:.06em;font-size:12px;border-radius:3px}.go{background:#F2F2F2;color:#0000F2}.no{color:#F2F2F2;border:1px solid #f2f2f266}small{display:block;margin-top:18px;opacity:.6}</style></head>
<body><main><span>COLDSTART / SANDBOX AUTHORIZATION</span><h1>${escHtml(plugin.name)}<b>_</b></h1>
<p>This stands in for ${escHtml(plugin.vendor)}’s consent screen because the app credentials (${escHtml(plugin.env.join(', '))}) are not configured on this server.${shop ? ` Store: <strong>${escHtml(shop)}</strong>.` : ''}</p>
<p>Permissions the live app would request:</p><ul>${plugin.auth.scopes.map(s => `<li>${escHtml(s)}</li>`).join('')}</ul>
<div class="row"><a class="go" href="${escHtml(approve)}">Approve sandbox access</a><a class="no" href="${escHtml(cancel)}">Cancel</a></div>
<small>Sandbox data is fake. No request reaches ${escHtml(plugin.vendor)}.</small></main></body></html>`;
}

export function createHandler(opts = {}) {
  const { store, fetch: fetchImpl = globalThis.fetch } = opts;
  const hits = new Map();
  const limited = (key, max = 120) => {
    const now = Date.now(), w = hits.get(key) || { t: now, n: 0 };
    if (now - w.t > 60e3) { w.t = now; w.n = 0; }
    w.n++; hits.set(key, w);
    if (hits.size > 5000) hits.clear();
    return w.n > max;
  };

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.searchParams.has('__p') ? '/api/' + url.searchParams.get('__p') : url.pathname;
    url.searchParams.delete('__p');
    const query = Object.fromEntries(url.searchParams);
    const proto = (req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0];
    const origin = (process.env.APP_URL || `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');
    const secure = origin.startsWith('https://');
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/, '');
    const ua = req.headers['user-agent'] || '';
    const parts = path.split('/').filter(Boolean);   // ['api', ...]

    try {
      /* ---------- public relay + webhooks ---------- */
      if (parts[1] === 'collect' && parts.length === 3) {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
        if (req.method === 'OPTIONS') return send(res, 204, undefined, cors);
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, cors);
        if (limited(ip + parts[2])) return send(res, 429, { error: 'Slow down.' }, cors);
        let b; try { b = JSON.parse(await readRaw(req) || '{}'); } catch { return send(res, 400, { error: 'JSON body expected.' }, cors); }
        const u = b.user && typeof b.user === 'object' ? b.user : {};
        const r = await deliver({ store, fetch: fetchImpl }, parts[2], {
          event_name: b.event_name, event_id: b.event_id, event_source_url: b.event_source_url,
          custom_data: b.custom_data && typeof b.custom_data === 'object' ? b.custom_data : undefined,
          ip, user_agent: ua, user: { fbp: u.fbp, fbc: u.fbc, external_id: u.external_id },
        }, { source: 'relay' });
        return r.ok ? send(res, 204, undefined, cors) : send(res, r.status || 400, { error: r.error, errors: r.errors }, cors);
      }
      if (path === '/api/webhooks/shopify' && req.method === 'POST') {
        const r = await handleWebhook({ store, fetch: fetchImpl }, { raw: await readRaw(req), headers: req.headers });
        return send(res, r.status, r.body);
      }

      /* ---------- session ---------- */
      const jar = cookies(req);
      const vault = (jar[VAULT] && unseal(jar[VAULT])) || { conns: {} };
      // Workspace identity: a sealed, httpOnly id. Every server-side record is scoped to it (tenant isolation).
      let ws = jar[WS] && unseal(jar[WS])?.id;
      if (!ws) { ws = randomId(12); setCookie(res, WS, seal({ id: ws }, undefined, { ttl: 365 * 86400 }), { maxAge: 365 * 86400, secure }); }
      const saveVault = () => setCookie(res, VAULT, Object.keys(vault.conns).length ? seal(vault, undefined, { ttl: 60 * 86400 }) : '', { maxAge: 60 * 86400, secure });

      if (path === '/api/cron/social' && req.method === 'POST') {
        const sec = process.env.CRON_SECRET || ''; const got = String(req.headers.authorization || '');
        const okAuth = sec.length >= 24 && got.length === sec.length + 7 && crypto.timingSafeEqual(Buffer.from(got), Buffer.from('Bearer ' + sec));
        if (!okAuth) return send(res, 401, { error: 'unauthorized' });
        const { runDueScans } = await import('./social/schedule.js'); return send(res, 200, { results: await runDueScans({ store, fetch: fetchImpl }) });
      }
      if (path === '/api/health') {
        let secretOk = true; try { secret(); } catch { secretOk = false; }
        return send(res, 200, { ok: true, service: 'coldstart', time: new Date().toISOString(), store: store.kind,
          sessionSecret: !!process.env.SESSION_SECRET && secretOk, plugins: Object.fromEntries(listPlugins().map(p => [p.id, p.liveReady() ? 'live' : 'sandbox'])) });
      }
      if (path === '/api/plugins' && req.method === 'GET')
        return send(res, 200, { origin, plugins: listPlugins().map(p => describe(p, vault.conns[p.id])) });

      if (path === '/api/sandbox/authorize') {
        const p = getPlugin(query.plugin);
        if (!p || p.liveReady()) return send(res, 404, { error: 'No sandbox for this plugin.' });
        const back = `/api/plugins/${p.id}/callback?`;
        const extra = query.shop ? { shop: query.shop } : {};
        return send(res, 200, sandboxPage(p, back + new URLSearchParams({ code: 'sbx_' + randomId(9), state: query.state || '', ...extra }), back + new URLSearchParams({ error: 'access_denied', state: query.state || '' }), query.shop));
      }

      if (parts[1] !== 'plugins' || !parts[2]) return send(res, 404, { error: 'Not found.' });
      const plugin = getPlugin(parts[2]);
      if (!plugin) return send(res, 404, { error: 'Unknown plugin.' });
      if (req.method === 'POST' && req.headers['x-coldstart'] !== '1') return send(res, 403, { error: 'Missing x-coldstart header.' });
      const redirectUri = `${origin}/api/plugins/${plugin.id}/callback`;

      if (plugin.auth.type === 'server' && ['connect', 'callback', 'token', 'disconnect'].includes(parts[3])) return send(res, 400, { error: `${plugin.name} uses server keys (${plugin.env.join(', ')}); there is nothing to connect.` });
      if (parts[3] === 'connect' && req.method === 'GET') {
        const state = randomId(), verifier = randomId(48);
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        setCookie(res, OAUTH, seal({ plugin: plugin.id, state, verifier, shop: query.shop || null }, undefined, { ttl: 600 }), { maxAge: 600, path: '/api', secure });
        if (!plugin.liveReady()) return redirect(res, `/api/sandbox/authorize?${new URLSearchParams({ plugin: plugin.id, state, ...(query.shop ? { shop: query.shop } : {}) })}`);
        try { return redirect(res, plugin.authorizeUrl({ state, redirectUri, challenge, shop: query.shop })); }
        catch (e) { return redirect(res, `/app.html#/${landing(plugin.id)}?error=${encodeURIComponent(e.message)}`); }
      }

      if (parts[3] === 'callback' && req.method === 'GET') {
        const o = jar[OAUTH] && unseal(jar[OAUTH]);
        setCookie(res, OAUTH, '', { path: '/api', secure });
        const fail = msg => redirect(res, `/app.html#/${landing(plugin.id)}?error=${encodeURIComponent(msg)}`);
        if (!o || o.plugin !== plugin.id || !query.state || o.state !== query.state) return fail('Authorization expired or did not match. Try connecting again.');
        if (query.error) return fail(query.error_description || query.error);
        if (!query.code) return fail('No authorization code returned.');
        let conn;
        if (plugin.liveReady()) {
          try { conn = await plugin.exchange({ code: query.code, redirectUri, query, verifier: o.verifier, fetch: fetchImpl }); }
          catch (e) { return fail(e.message); }
        } else {
          if (!query.code.startsWith('sbx_')) return fail('Sandbox codes only.');
          conn = plugin.sandboxAccount({ ...query, shop: query.shop || o.shop });
        }
        if (vault.conns[plugin.id] && plugin.onDisconnect) await plugin.onDisconnect({ conn: vault.conns[plugin.id], store });
        vault.conns[plugin.id] = { ...conn, connectedAt: new Date().toISOString() };
        saveVault();
        return redirect(res, `/app.html#/${landing(plugin.id)}?connected=${plugin.id}`);
      }

      const body = req.method === 'POST' ? (() => { const raw = readRaw(req); return raw.then(t => { try { return t ? JSON.parse(t) : {}; } catch { throw Object.assign(new Error('JSON body expected.'), { status: 400 }); } }); })() : Promise.resolve({});
      const ctxFor = conn => ({
        conn, store, origin, fetch: fetchImpl, req: { ip, ua }, mode: conn?.mode, ws, metaApi: opts.metaApi,
        setConn(patch) { Object.assign(conn, patch); vault.conns[plugin.id] = conn; vault.dirty = true; },
        getConn: id => vault.conns[id] || null,
        setConnFor(id, patch) { const c = vault.conns[id]; if (!c) return; vault.conns[id] = { ...c, ...patch }; vault.dirty = true; },
      });

      if (parts[3] === 'token' && req.method === 'POST') {
        if (!plugin.connectToken) return send(res, 404, { error: 'This plugin connects with OAuth only.' });
        const conn = await plugin.connectToken(await body, ctxFor(null));
        if (vault.conns[plugin.id] && plugin.onDisconnect) await plugin.onDisconnect({ conn: vault.conns[plugin.id], store });
        vault.conns[plugin.id] = { ...conn, connectedAt: new Date().toISOString() };
        saveVault();
        return send(res, 200, { connection: describe(plugin, vault.conns[plugin.id]).connection });
      }

      if (parts[3] === 'disconnect' && req.method === 'POST') {
        const conn = vault.conns[plugin.id];
        if (conn && plugin.onDisconnect) await plugin.onDisconnect({ conn, store });
        delete vault.conns[plugin.id];
        saveVault();
        return send(res, 200, { ok: true });
      }

      if (parts[3] === 'actions' && parts[4]) {
        const a = Object.hasOwn(plugin.actions, parts[4]) ? plugin.actions[parts[4]] : null;
        if (!a) return send(res, 404, { error: 'Unknown action.' });
        if (a.method !== req.method) return send(res, 405, { error: a.method + ' only.' });
        const conn = plugin.auth.type === 'server' ? { mode: plugin.liveReady() ? 'live' : 'sandbox', via: 'server', account: { id: 'server' }, secrets: {} } : vault.conns[plugin.id];
        if (!conn) return send(res, 401, { error: `Connect ${plugin.name} first.` });
        const input = req.method === 'GET' ? query : await body;
        const ctx = ctxFor(conn);
        // Server-side limits for paid actions, enforced per workspace regardless of what the browser says.
        const gate = { research: ['scan'], images: ['generate'] }[plugin.id]?.includes(parts[4]) ? (plugin.id === 'research' ? 'research' : 'creative') : null;
        if (plugin.id === 'images' && parts[4] === 'generate' && input && input.reference) return send(res, 403, { error: 'Reference-based generation must go through an approved product master (ops/createJob).', code: 'use_jobs' });
        let rsv = null;
        if (gate) { const kv = scoped(store, ws); rsv = { kv, idem: 'api:' + (req.headers['idempotency-key'] || input?.idempotencyKey || crypto.randomUUID()) }; const r = await reserve(kv, { kind: gate, idem: rsv.idem }); if (r.duplicate) return send(res, 409, { error: 'This request was already submitted. Nothing was charged twice.', code: 'duplicate_request' }); }
        let out; try { out = await a.run(ctx, input || {}); } catch (e) { if (rsv) await release(rsv.kv, rsv.idem); throw e; }
        if (rsv) await settle(rsv.kv, rsv.idem, { actualUsd: typeof out?.usd === 'number' ? out.usd : null });
        if (vault.dirty && plugin.auth.type !== 'server') { delete vault.dirty; saveVault(); }
        return send(res, 200, out);
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status === 500) console.error(req.method, path, e);
      return send(res, status, { error: status === 500 ? 'Server error.' : e.message, code: status === 500 ? undefined : e.detail?.code, detail: e.detail?.error?.fbtrace_id ? { fbtrace_id: e.detail.error.fbtrace_id, code: e.detail.error.code } : undefined });
    }
  };
}
