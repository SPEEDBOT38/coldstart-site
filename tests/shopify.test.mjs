import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyCallback, verifyWebhook, orderToEvent, validShop } from '../lib/plugins/shopify.js';

test('OAuth callback HMAC covers the sorted query without hmac', () => {
  const q = { shop: 'fern.myshopify.com', code: 'abc', timestamp: '1700000000', state: 'xyz' };
  const msg = 'code=abc&shop=fern.myshopify.com&state=xyz&timestamp=1700000000';
  const hmac = crypto.createHmac('sha256', 'sec').update(msg).digest('hex');
  assert.equal(verifyCallback({ ...q, hmac }, 'sec'), true);
  assert.equal(verifyCallback({ ...q, shop: 'evil.myshopify.com', hmac }, 'sec'), false);
  assert.equal(verifyCallback(q, 'sec'), false);
});

test('webhook HMAC is base64 over the raw body', () => {
  const raw = '{"id":1}';
  assert.equal(verifyWebhook(raw, crypto.createHmac('sha256', 'k').update(raw).digest('base64'), 'k'), true);
  assert.equal(verifyWebhook(raw + ' ', crypto.createHmac('sha256', 'k').update(raw).digest('base64'), 'k'), false);
  assert.equal(verifyWebhook(raw, 'x', undefined), false);
});

test('shop domains must be *.myshopify.com', () => {
  assert.equal(validShop('fern-and-form.myshopify.com'), true);
  assert.equal(validShop('fern.com'), false);
  assert.equal(validShop('a.myshopify.com.evil.io'), false);
});

test('paid order maps to a Purchase keyed by order id with customer data', () => {
  const e = orderToEvent({ id: 77, email: 'a@b.co', currency: 'EUR', current_total_price: '12.50', created_at: '2026-11-16T10:00:00Z',
    order_status_url: 'https://s/1', client_details: { browser_ip: '1.1.1.1', user_agent: 'UA' },
    billing_address: { first_name: 'Sam', country_code: 'DE', zip: '10115' }, customer: { id: 5 }, line_items: [{ product_id: 9, quantity: 3 }] });
  assert.equal(e.event_id, 'order_77');
  assert.equal(e.custom_data.value, 12.5);
  assert.equal(e.custom_data.num_items, 3);
  assert.deepEqual(e.custom_data.content_ids, ['9']);
  assert.equal(e.user.country, 'DE');
  assert.equal(e.user.external_id, '5');
  assert.equal(e.ip, '1.1.1.1');
});
