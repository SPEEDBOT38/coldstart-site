// Meta tracking: site inspection + verification state. Thin glue over lib/plugins/meta (snippets, CAPI relay, event builder).
// Nothing here is "verified" from page markup alone: VERIFIED needs real accepted events from a live-mode (non-sandbox) site.
import { PluginError } from '../plugins/http.js';

const PRIVATE = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/i;
export function safeUrl(input) {
  let u; try { u = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input); } catch { throw new PluginError('That is not a valid website address.', 400); }
  if (u.protocol !== 'https:' || PRIVATE.test(u.hostname) || !u.hostname.includes('.')) throw new PluginError('Only public https websites can be inspected.', 400, { code: 'blocked_host' });
  return u;
}

/** Pure: what the page markup says. Markup can be wrong (tags can be loaded conditionally, behind consent, or by GTM). */
export function inspectHtml(html = '') {
  const h = String(html).slice(0, 1.5e6), uniq = a => [...new Set(a)];
  const pixelIds = uniq([...h.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g)].map(m => m[1]));
  const noscript = uniq([...h.matchAll(/facebook\.com\/tr\?id=(\d{8,20})/g)].map(m => m[1]));
  const gtm = uniq([...h.matchAll(/GTM-[A-Z0-9]{4,10}/g)].map(m => m[0]));
  const initCount = (h.match(/fbq\(\s*['"]init['"]/g) || []).length, loaders = (h.match(/connect\.facebook\.net\/[^"']*fbevents\.js/g) || []).length;
  const platform = /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(h) ? 'shopify' : /wp-content|woocommerce/i.test(h) ? 'woocommerce' : /wixstatic|wix\.com/i.test(h) ? 'wix' : /squarespace/i.test(h) ? 'squarespace' : 'unknown';
  const issues = [];
  if (initCount > pixelIds.length || pixelIds.length > 1) issues.push({ code: 'duplicate_pixel', text: pixelIds.length > 1 ? 'More than one Pixel ID is initialised on this page.' : 'The same Pixel is initialised more than once, which double-counts browser events.' });
  if (loaders > 1) issues.push({ code: 'duplicate_loader', text: 'The Meta Pixel script is loaded more than once.' });
  if (gtm.length && !pixelIds.length) issues.push({ code: 'maybe_via_gtm', text: 'A Google Tag Manager container is present and no Pixel appears in the page. The Pixel may be loaded through GTM; open Meta Pixel Helper to confirm.' });
  if (!pixelIds.length && !gtm.length) issues.push({ code: 'no_pixel', text: 'No Meta Pixel was found in the page markup.' });
  if (/consent|cookiebot|onetrust|cookieyes/i.test(h)) issues.push({ code: 'consent_manager', text: 'A consent manager is present. Events may legitimately be withheld until visitors accept.' });
  return { platform, pixelIds, noscriptPixelIds: noscript, gtmContainers: gtm, issues, confidence: 'markup_only' };
}
export function installGuidance(platform) {
  return ({ shopify: ['Shopify: Settings → Customer events → Add custom pixel, then paste the snippet generated for this site. Purchase uses the order id as event_id so the paid-order webhook can dedupe.'],
    woocommerce: ['WooCommerce: use the official Meta plugin or paste the storefront snippet in the theme header. Do not enable both.'],
    unknown: ['Paste the storefront snippet in the page head, or add it through GTM. Use only one of these.'] })[platform] || ['Paste the storefront snippet in the page head, or add it through GTM. Use only one of these.'];
}
export async function inspectSite(url, fetch = globalThis.fetch) {
  const u = safeUrl(url); const r = await fetch(u.href, { redirect: 'manual', headers: { 'user-agent': 'ColdStartTrackingCheck/1.0' }, signal: AbortSignal.timeout(10000) });
  if (r.status >= 300 && r.status < 400) throw new PluginError('The site redirected. Enter the final address.', 422, { location: r.headers && r.headers.get && r.headers.get('location') });
  if (!r.ok) throw new PluginError('The site returned ' + r.status + '.', 502);
  return { url: u.href, fetched_at: new Date().toISOString(), ...inspectHtml(await r.text()) };
}

/** State machine from the relay log. Sandbox and test-event traffic can never reach 'verified'. */
export function assessTracking({ site, log = [] } = {}) {
  if (!site) return { state: 'not_configured', next: 'Choose a Pixel/dataset and install the snippet.' };
  const ok = log.filter(r => r.ok), live = ok.filter(r => r.mode === 'live' && !r.test), tests = ok.filter(r => r.test);
  const fails = log.filter(r => !r.ok);
  const ids = new Set(live.map(r => r.event_id).filter(Boolean));
  if (site.mode !== 'live') return { state: 'sandbox_only', verified: false, next: 'Connect a real Meta account. Sandbox events are not sent to Meta.', observed: ok.length };
  if (live.length) return { state: 'verified', verified: true, observed: live.length, distinct_event_ids: ids.size, dedupe: 'unconfirmed', next: 'Server events are accepted by Meta. Confirm browser/server deduplication in Events Manager → Diagnostics; this app cannot read that without Graph access.', last: live[0].at };
  if (tests.length) return { state: 'test_events_received', verified: false, observed: tests.length, next: 'Test events reached Meta. Send a real (non-test) event from the live site to finish.' };
  if (fails.length) return { state: 'failing', verified: false, errors: [...new Set(fails.map(r => r.error))].slice(0, 3), next: 'Fix the errors shown, then retry.' };
  return { state: 'installed_unverified', verified: false, next: 'No events seen yet. Open the site and perform a page view.' };
}
