import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildEvent } from '../lib/plugins/meta/capi.js';

const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const NOW = 1_800_000_000;
const base = { event_name: 'Purchase', event_id: 'ord_1', event_source_url: 'https://shop.example/thanks',
  user_agent: 'Mozilla/5.0', ip: '203.0.113.9', custom_data: { value: 49.5, currency: 'usd' } };

test('normalizes then SHA-256 hashes email, phone and names', () => {
  const { event } = buildEvent({ ...base, user: { email: '  Ana@Example.COM ', phone: '+1 (415) 555-0100', first_name: ' Ána ' } }, { now: NOW });
  assert.deepEqual(event.user_data.em, [sha('ana@example.com')]);
  assert.deepEqual(event.user_data.ph, [sha('14155550100')]);
  assert.deepEqual(event.user_data.fn, [sha('ána')]);
});

test('leaves ip, user agent, fbp and fbc unhashed', () => {
  const { event } = buildEvent({ ...base, user: { fbp: 'fb.1.1.2', fbc: 'fb.1.1.abc' } }, { now: NOW });
  assert.equal(event.user_data.client_ip_address, '203.0.113.9');
  assert.equal(event.user_data.client_user_agent, 'Mozilla/5.0');
  assert.equal(event.user_data.fbp, 'fb.1.1.2');
  assert.equal(event.user_data.fbc, 'fb.1.1.abc');
});

test('does not double-hash values that are already sha256 hex', () => {
  const h = sha('ana@example.com');
  const { event } = buildEvent({ ...base, user: { email: h } }, { now: NOW });
  assert.deepEqual(event.user_data.em, [h]);
});

test('website events need event_source_url and a user agent', () => {
  const r = buildEvent({ event_name: 'PageView', event_id: 'x', ip: '1.1.1.1' }, { now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /event_source_url/);
  assert.match(r.errors.join(' '), /client_user_agent/);
});

test('rejects events older than 7 days and in the future', () => {
  assert.equal(buildEvent({ ...base, event_time: NOW - 8 * 86400 }, { now: NOW }).ok, false);
  assert.equal(buildEvent({ ...base, event_time: NOW + 3600 }, { now: NOW }).ok, false);
  assert.equal(buildEvent({ ...base, event_time: NOW - 3600 }, { now: NOW }).ok, true);
});

test('purchase needs value and a 3-letter currency, uppercased', () => {
  assert.equal(buildEvent({ ...base, custom_data: {} }, { now: NOW }).ok, false);
  const { event } = buildEvent(base, { now: NOW });
  assert.equal(event.custom_data.currency, 'USD');
  assert.equal(event.action_source, 'website');
  assert.equal(event.event_id, 'ord_1');
});

test('requires an event_id so browser and server copies deduplicate', () => {
  const { event_id, ...noId } = base;
  const r = buildEvent(noId, { now: NOW });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /event_id/);
});
