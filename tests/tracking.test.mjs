import test from 'node:test'; import assert from 'node:assert/strict';
import { inspectHtml, safeUrl, assessTracking, inspectSite } from '../lib/tracking/inspect.js';
test('detects pixel, platform, duplicates', () => {
  const h = '<script src="https://cdn.shopify.com/x.js"></script><script>fbq("init","123456789012345");fbq("init", "123456789012345")</script>';
  const r = inspectHtml(h); assert.equal(r.platform, 'shopify'); assert.deepEqual(r.pixelIds, ['123456789012345']); assert.ok(r.issues.some(i => i.code === 'duplicate_pixel')); assert.equal(r.confidence, 'markup_only');
});
test('GTM-only page is flagged as possibly via GTM, not as verified', () => { const r = inspectHtml('<script>GTM-ABC123</script>'); assert.ok(r.issues.some(i => i.code === 'maybe_via_gtm')); assert.equal(r.pixelIds.length, 0); });
test('no tracking found', () => assert.ok(inspectHtml('<p>hi</p>').issues.some(i => i.code === 'no_pixel')));
test('SSRF guard', () => { for (const u of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://169.254.169.254', 'https://10.0.0.5', 'https://intranet']) assert.throws(() => safeUrl(u), /public https|valid/); assert.ok(safeUrl('shop.example.com')); });
test('redirects are not followed', async () => { await assert.rejects(inspectSite('https://shop.example.com', async () => ({ status: 302, ok: false, headers: new Map([['location', 'http://169.254.169.254']]) })), /redirected/); });
test('verification states: sandbox and test events never verify', () => {
  assert.equal(assessTracking({}).state, 'not_configured');
  assert.equal(assessTracking({ site: { mode: 'sandbox' }, log: [{ ok: true, mode: 'sandbox' }] }).verified, false);
  assert.equal(assessTracking({ site: { mode: 'live' }, log: [{ ok: true, mode: 'live', test: true }] }).state, 'test_events_received');
  assert.equal(assessTracking({ site: { mode: 'live' }, log: [] }).state, 'installed_unverified');
  const v = assessTracking({ site: { mode: 'live' }, log: [{ ok: true, mode: 'live', event_id: 'a', at: 't' }] }); assert.equal(v.state, 'verified'); assert.equal(v.dedupe, 'unconfirmed');
  assert.equal(assessTracking({ site: { mode: 'live' }, log: [{ ok: false, error: 'bad token' }] }).state, 'failing');
});
