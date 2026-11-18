// Conversions API event builder. Follows Meta's customer-information parameter rules:
// normalize, then SHA-256 the identifying fields; leave IP, user agent, fbp, fbc unhashed.
// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
import crypto from 'node:crypto';

const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const isHash = v => /^[a-f0-9]{64}$/.test(v);
const STD = ['PageView', 'ViewContent', 'Search', 'AddToCart', 'AddToWishlist', 'InitiateCheckout',
  'AddPaymentInfo', 'Purchase', 'Lead', 'CompleteRegistration', 'Contact', 'Subscribe', 'StartTrial'];
const VALUE_EVENTS = ['Purchase', 'StartTrial', 'Subscribe'];
const SOURCES = ['website', 'app', 'email', 'phone_call', 'chat', 'physical_store', 'system_generated', 'business_messaging', 'other'];

const norm = {
  em: v => v.trim().toLowerCase(),
  ph: v => v.replace(/\D/g, '').replace(/^0+/, ''),
  fn: v => v.trim().toLowerCase().replace(/[\s.,'"-]/g, ''),
  ln: v => v.trim().toLowerCase().replace(/[\s.,'"-]/g, ''),
  ct: v => v.trim().toLowerCase().replace(/[^\p{L}]/gu, ''),
  st: v => v.trim().toLowerCase().replace(/[^a-z]/g, ''),
  zp: v => v.trim().toLowerCase().replace(/\s/g, '').split('-')[0],
  country: v => v.trim().toLowerCase().slice(0, 2),
  ge: v => v.trim().toLowerCase().slice(0, 1),
  db: v => v.replace(/\D/g, ''),
  external_id: v => v.trim(),
};
const FIELD = { email: 'em', phone: 'ph', first_name: 'fn', last_name: 'ln', city: 'ct', state: 'st',
  zip: 'zp', country: 'country', gender: 'ge', dob: 'db', external_id: 'external_id' };

export const STANDARD_EVENTS = STD;

export function hashUser(user = {}) {
  const out = {};
  for (const [k, raw] of Object.entries(user)) {
    const key = FIELD[k] || (norm[k] ? k : null);
    if (!key || raw == null || raw === '') continue;
    const vals = (Array.isArray(raw) ? raw : [raw]).map(String).map(v => isHash(v) ? v : sha(norm[key](v))).filter(Boolean);
    if (vals.length) out[key] = vals;
  }
  return out;
}

/** input: {event_name, event_id, event_time?, event_source_url?, action_source?, ip?, user_agent?, user?, custom_data?}
 *  returns {ok, event?, errors[]} with the event shaped exactly as POST /{pixel}/events expects. */
export function buildEvent(input, { now = Math.floor(Date.now() / 1000) } = {}) {
  const errors = [];
  const name = String(input.event_name || '').trim();
  if (!/^[A-Za-z0-9_ ]{1,50}$/.test(name)) errors.push('event_name is required (standard or custom, ≤50 chars).');
  const id = String(input.event_id || '').trim();
  if (!id || id.length > 100) errors.push('event_id is required (≤100 chars) so the browser pixel and CAPI copies deduplicate.');
  const time = Number.isFinite(+input.event_time) && input.event_time !== '' && input.event_time != null ? Math.floor(+input.event_time) : now;
  if (time > now + 60) errors.push('event_time cannot be in the future.');
  if (time < now - 7 * 86400) errors.push('event_time must be within the last 7 days.');
  const source = input.action_source || 'website';
  if (!SOURCES.includes(source)) errors.push('action_source is not a Meta action source.');

  const user_data = hashUser(input.user || {});
  const { fbp, fbc } = input.user || {};
  if (fbp) user_data.fbp = String(fbp);
  if (fbc) user_data.fbc = String(fbc);
  if (input.ip) user_data.client_ip_address = String(input.ip);
  if (input.user_agent) user_data.client_user_agent = String(input.user_agent);

  if (source === 'website') {
    if (!/^https?:\/\//.test(input.event_source_url || '')) errors.push('event_source_url is required for website events.');
    if (!user_data.client_user_agent) errors.push('client_user_agent is required for website events.');
  }
  if (!Object.keys(user_data).length) errors.push('user_data needs at least one customer parameter.');

  let custom_data;
  if (input.custom_data && typeof input.custom_data === 'object') {
    custom_data = { ...input.custom_data };
    if (custom_data.currency) custom_data.currency = String(custom_data.currency).toUpperCase();
    if (custom_data.value != null) custom_data.value = Number(custom_data.value);
  }
  if (VALUE_EVENTS.includes(name)) {
    if (!custom_data || !Number.isFinite(custom_data.value)) errors.push(name + ' needs custom_data.value.');
    if (!custom_data || !/^[A-Z]{3}$/.test(custom_data.currency || '')) errors.push(name + ' needs a 3-letter custom_data.currency.');
  }
  if (errors.length) return { ok: false, errors };

  const event = { event_name: name, event_time: time, event_id: id, action_source: source, user_data };
  if (input.event_source_url) event.event_source_url = input.event_source_url;
  if (custom_data && Object.keys(custom_data).length) event.custom_data = custom_data;
  if (input.opt_out) event.opt_out = true;
  return { ok: true, event, errors: [] };
}
