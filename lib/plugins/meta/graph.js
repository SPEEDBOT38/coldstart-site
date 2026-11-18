// Graph API clients with one interface: get(path, params) / post(path, params).
// live: real graph.facebook.com calls with appsecret_proof when the app secret is known.
// sandbox: a deterministic stand-in that enforces the same CAPI rules and keeps state in the store.
import crypto from 'node:crypto';
import { requestJson, qs, PluginError } from '../http.js';
import { buildEvent } from './capi.js';

export const version = () => process.env.META_GRAPH_VERSION || 'v23.0';
const BASE = () => `https://graph.facebook.com/${version()}`;

export function liveGraph(token, fetchImpl = fetch) {
  const proof = process.env.META_APP_SECRET ? crypto.createHmac('sha256', process.env.META_APP_SECRET).update(token).digest('hex') : null;
  const auth = { access_token: token, appsecret_proof: proof };
  return {
    mode: 'live',
    get: (p, params = {}) => requestJson(fetchImpl, `${BASE()}/${p}?${qs({ ...params, ...auth })}`),
    post: (p, params = {}) => requestJson(fetchImpl, `${BASE()}/${p}`, { method: 'POST', form: { ...params, ...auth } }),
  };
}

/* ------------------------------ sandbox ------------------------------ */
const sbxKey = acct => 'sbx:meta:' + acct;
async function sbxState(store, acct) {
  return (await store.get(sbxKey(acct))) || {
    adaccounts: [{ id: 'act_1000000001', account_id: '1000000001', name: 'Sandbox Store Ads', account_status: 1, currency: 'USD' },
                 { id: 'act_1000000002', account_id: '1000000002', name: 'Sandbox Agency Account', account_status: 1, currency: 'EUR' }],
    pixels: { act_1000000001: [{ id: '900000000000001', name: 'Sandbox Store Dataset', creation_time: '2026-10-01T09:00:00+0000', last_fired_time: null }] },
    events: {},
  };
}
const fbtrace = () => 'Sbx' + crypto.randomBytes(8).toString('base64url');

export function sandboxGraph(store, acct) {
  const load = () => sbxState(store, acct);
  const save = s => store.set(sbxKey(acct), s, 30 * 86400);
  const err = (message, code = 100) => { throw new PluginError(message, 400, { error: { message, type: 'OAuthException', code, fbtrace_id: fbtrace() } }); };
  return {
    mode: 'sandbox',
    async get(p, params = {}) {
      const s = await load();
      if (p === 'me') return { id: acct, name: 'Sandbox Business User' };
      if (p === 'me/adaccounts') return { data: s.adaccounts };
      let m;
      if ((m = p.match(/^(act_\d+)\/adspixels$/))) {
        if (!s.adaccounts.some(a => a.id === m[1])) err('Unsupported get request. Object does not exist.', 100);
        return { data: s.pixels[m[1]] || [] };
      }
      if ((m = p.match(/^(\d+)\/stats$/))) {
        const evs = s.events[m[1]] || [];
        const counts = {};
        for (const e of evs) counts[e.event_name] = (counts[e.event_name] || 0) + 1;
        return { data: [{ start_time: new Date(Date.now() - 864e5).toISOString(), aggregation: 'event', data: Object.entries(counts).map(([value, count]) => ({ value, count })) }] };
      }
      if ((m = p.match(/^(\d+)$/))) {
        const px = Object.values(s.pixels).flat().find(x => x.id === m[1]);
        if (!px) err(`Unsupported get request. Object with ID '${m[1]}' does not exist.`, 100);
        return px;
      }
      err('Unknown path components: /' + p, 2500);
    },
    async post(p, params = {}) {
      const s = await load();
      let m;
      if ((m = p.match(/^(act_\d+)\/adspixels$/))) {
        if (!s.adaccounts.some(a => a.id === m[1])) err('Unsupported post request.', 100);
        if (!params.name) err('(#100) The parameter name is required', 100);
        const px = { id: '9' + String(Date.now()).slice(-8) + crypto.randomInt(100000, 999999), name: String(params.name).slice(0, 100), creation_time: new Date().toISOString(), last_fired_time: null };
        (s.pixels[m[1]] ||= []).push(px); await save(s);
        return { id: px.id };
      }
      if ((m = p.match(/^(\d+)\/events$/))) {
        const px = Object.values(s.pixels).flat().find(x => x.id === m[1]);
        if (!px) err(`Unsupported post request. Object with ID '${m[1]}' does not exist.`, 100);
        let data; try { data = typeof params.data === 'string' ? JSON.parse(params.data) : params.data; } catch { err('(#100) param data must be an array.'); }
        if (!Array.isArray(data) || !data.length || data.length > 1000) err('(#100) param data must be an array of 1-1000 events.');
        for (const ev of data) {
          if (!ev.user_data || !Object.keys(ev.user_data).length) err('(#100) The parameter user_data is required');
          for (const k of ['em', 'ph', 'fn', 'ln']) if (ev.user_data[k] && ![].concat(ev.user_data[k]).every(v => /^[a-f0-9]{64}$/.test(v))) err(`(#100) user_data.${k} must be SHA-256 hashed`);
          const check = buildEvent({ ...ev, ip: ev.user_data.client_ip_address, user_agent: ev.user_data.client_user_agent, user: { external_id: 'x' } });
          if (!check.ok) err('(#100) ' + check.errors[0]);
        }
        const evs = (s.events[m[1]] ||= []);
        for (const ev of data) {
          const dup = evs.find(e => e.event_id === ev.event_id && e.event_name === ev.event_name);
          evs.push({ event_name: ev.event_name, event_id: ev.event_id, event_time: ev.event_time, received: new Date().toISOString(), test_event_code: params.test_event_code || null, deduplicated: !!dup });
        }
        if (evs.length > 500) evs.splice(0, evs.length - 500);
        px.last_fired_time = new Date().toISOString();
        await save(s);
        return { events_received: data.length, messages: [], fbtrace_id: fbtrace() };
      }
      err('Unknown path components: /' + p, 2500);
    },
  };
}
