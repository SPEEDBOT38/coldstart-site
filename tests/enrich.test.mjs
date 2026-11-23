import test from 'node:test'; import assert from 'node:assert/strict';
import { resolveProductUrl, parseProductPage, enrichProducts } from '../lib/onboard/enrich.js';
const links = [{ url: 'https://www.apple.com/macbook-air/', text: 'MacBook Air' }, { url: 'https://www.apple.com/macbook-pro/', text: 'MacBook Pro' }, { url: 'https://www.apple.com/support/macbook-air/', text: 'Support' }, { url: 'https://evil.com/macbook-air', text: 'x' }];
test('resolves the product page from the site’s own links, never another domain or support pages', () => {
  assert.equal(resolveProductUrl('MacBook Air', links, 'apple.com'), 'https://www.apple.com/macbook-air/');
  assert.equal(resolveProductUrl('MacBook Pro', links, 'apple.com'), 'https://www.apple.com/macbook-pro/');
  assert.equal(resolveProductUrl('Vision Pro', links, 'apple.com'), null);
});
test('reads JSON-LD Product images and price, Open Graph, srcset; drops logos', () => {
  const html = `<script type="application/ld+json">{"@type":"Product","name":"Soil Mix","image":["/img/soil-1.jpg"],"offers":{"price":"499","priceCurrency":"INR"}}</script>
  <meta property="og:image" content="https://shop.test/og-soil.jpg"><img src="/logo.png" alt="logo"><img srcset="/a-400.jpg 400w, /a-1200.jpg 1200w" alt="Soil Mix bag">`;
  const d = parseProductPage(html, 'https://shop.test/p/soil');
  assert.equal(d.price, 499); assert.equal(d.currency, 'INR');
  assert.deepEqual(d.images.map(i => i.url), ['https://shop.test/img/soil-1.jpg', 'https://shop.test/og-soil.jpg', 'https://shop.test/a-1200.jpg']);
});
const img = (n = 20000) => new Response(new Uint8Array(10), { headers: { 'content-type': 'image/jpeg', 'content-length': String(n) } });
test('specific statuses: ok, no page, blocked, robots, no images, unreachable, irrelevant', async () => {
  const pages = {
    'https://www.apple.com/robots.txt': 'User-agent: *\nDisallow: /private/',
    'https://www.apple.com/macbook-air/': '<meta property="og:image" content="https://www.apple.com/i/mba.jpg">',
    'https://www.apple.com/ipad/': '<p>no images</p>',
    'https://www.apple.com/watch/': '<img src="/i/unrelated-hero.jpg" alt="holiday">',
    'https://www.apple.com/airpods/': '<meta property="og:image" content="https://www.apple.com/i/missing.jpg">',
  };
  const f = async (u) => { u = String(u); if (u.endsWith('mba.jpg')) return img(); if (u.endsWith('missing.jpg')) return new Response('x', { status: 404 }); if (u.includes('/private/')) return new Response('x'); if (u in pages) return new Response(pages[u]); return new Response('nope', { status: 403 }); };
  const ps = ['MacBook Air', 'iPad', 'Watch', 'AirPods', 'Vision Pro', 'Mac Mini', 'Secret'].map(name => ({ name, price: null, image: null, url: null }));
  const L = [...links, { url: 'https://www.apple.com/ipad/', text: 'iPad' }, { url: 'https://www.apple.com/watch/', text: 'Watch' }, { url: 'https://www.apple.com/airpods/', text: 'AirPods' }, { url: 'https://www.apple.com/mac-mini/', text: 'Mac mini' }, { url: 'https://www.apple.com/private/secret/', text: 'Secret' }];
  await enrichProducts(ps, { links: L, domain: 'apple.com', fetch: f });
  const st = Object.fromEntries(ps.map(p => [p.name, p.enrich.status]));
  assert.deepEqual(st, { 'MacBook Air': 'ok', iPad: 'no_images', Watch: 'images_irrelevant', AirPods: 'images_unreachable', 'Vision Pro': 'no_page', 'Mac Mini': 'page_blocked', Secret: 'robots' });
  assert.equal(ps[0].image, 'https://www.apple.com/i/mba.jpg'); assert.equal(ps[0].enrich.rights, 'unconfirmed'); assert.ok(ps[0].enrich.message);
});
