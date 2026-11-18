// Delivery path shared by the public browser relay, the Shopify order webhook and test sends.
// A site key (random, public) maps to a sealed {pixelId, token, mode, acct} in the store.
import { buildEvent } from './capi.js';
import { liveGraph, sandboxGraph } from './graph.js';
import { seal, unseal, randomId } from '../../vault.js';

export async function createSite(store, { pixelId, pixelName, token, mode, acct, consent = 'grant' }, existingKey) {
  const key = existingKey || 'cs_' + randomId(12);
  await store.set('route:' + key, { sealed: seal({ pixelId, token, mode, acct }, undefined, { ttl: 365 * 86400 }), pixelName, consent, created: new Date().toISOString() });
  return key;
}
export async function loadSite(store, key) {
  if (!/^cs_[A-Za-z0-9_-]{8,40}$/.test(String(key))) return null;
  const r = await store.get('route:' + key);
  const s = r && unseal(r.sealed);
  return s ? { ...s, pixelName: r.pixelName, consent: r.consent } : null;
}
export async function updateSite(store, key, patch) {
  const r = await store.get('route:' + key);
  if (r) await store.set('route:' + key, { ...r, ...patch });
}
export async function dropSite(store, key) { if (key) { await store.del('route:' + key); await store.del('log:' + key); } }

export async function getLog(store, key) { return (await store.get('log:' + key)) || []; }
async function log(store, key, row) {
  const l = await getLog(store, key);
  l.unshift(row); l.length = Math.min(l.length, 60);
  await store.set('log:' + key, l, 30 * 86400);
}

export function graphFor(site, store, fetchImpl) {
  return site.mode === 'live' ? liveGraph(site.token, fetchImpl) : sandboxGraph(store, site.acct);
}

/** Build, validate, send one event. Never throws for event problems: returns {ok, ...} and logs the attempt. */
export async function deliver({ store, fetch: fetchImpl = fetch }, key, input, { source = 'relay', test_event_code } = {}) {
  const site = await loadSite(store, key);
  if (!site) return { ok: false, status: 404, error: 'Unknown site key.' };
  const built = buildEvent(input);
  const row = { at: new Date().toISOString(), source, event_name: input.event_name || '?', event_id: input.event_id || '', test: !!test_event_code };
  if (!built.ok) { await log(store, key, { ...row, ok: false, error: built.errors[0] }); return { ok: false, status: 400, errors: built.errors }; }
  try {
    const params = { data: JSON.stringify([built.event]) };
    if (test_event_code) params.test_event_code = test_event_code;
    const response = await graphFor(site, store, fetchImpl).post(`${site.pixelId}/events`, params);
    await log(store, key, { ...row, ok: true, fbtrace_id: response.fbtrace_id, mode: site.mode });
    return { ok: true, event: built.event, response, mode: site.mode };
  } catch (e) {
    await log(store, key, { ...row, ok: false, error: e.message });
    return { ok: false, status: e.status || 502, error: e.message, event: built.event };
  }
}
