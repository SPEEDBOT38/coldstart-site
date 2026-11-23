// Product-page enrichment for non-Shopify sites. Family discovery (the scan) is separate from this step.
// For each discovered product: resolve its page from the site's own links (same domain only), read that page
// (one plain GET, no login, no CAPTCHA, robots-disallowed paths skipped), then take images and prices only from
// structured data on that page: JSON-LD Product, then Open Graph, then <img srcset>/data-src. Each image is
// verified (reachable, real image MIME, plausible size, not a logo/sprite/placeholder). Nothing is invented and
// every product carries a specific status. Found images are candidates for recognition only: reuse rights are unconfirmed.

const UA = 'Mozilla/5.0 (compatible; Coldstart/0.4; +https://coldstart-swart-chi.vercel.app)';
const BAD_IMG = /(logo|sprite|icon|favicon|placeholder|blank|spacer|badge|banner_global|globalnav|1x1|pixel)/i;
const STATUS = {
  ok: 'Matched product page and image',
  no_page: 'No product page found on the site',
  page_blocked: 'Product page could not be opened (blocked or unavailable)',
  robots: 'Product page is disallowed by the site’s robots.txt',
  no_images: 'Product page has no product images in its markup',
  images_unreachable: 'Image links were found but could not be loaded',
  images_irrelevant: 'Images on the page did not match this product',
};
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 1);
const slug = (s) => words(s).join('-');

/** Score a site link against a product name: path slug match beats anchor-text match. */
function linkScore(name, link) {
  const w = words(name); if (!w.length) return 0;
  let u; try { u = new URL(link.url); } catch { return 0; }
  const path = u.pathname.toLowerCase().replace(/\/+$/, ''), last = path.split('/').pop() || '';
  if (/(support|search|store\/?$|compare|legal|privacy|careers|newsroom|shop\/bag|account|signin|login)/.test(path)) return 0;
  const s = slug(name);
  if (last === s) return 100 - path.split('/').length;              // /macbook-air
  if (path.includes(s)) return 80 - path.split('/').length;         // /in/macbook-air/specs
  const hits = w.filter((x) => path.includes(x)).length, text = words(link.text).join(' ');
  if (hits === w.length) return 60 - path.split('/').length;
  if (w.every((x) => text.includes(x))) return 50 - path.split('/').length;
  return 0;
}
export function resolveProductUrl(name, links, domain) {
  const own = (links || []).filter((l) => { try { const h = new URL(l.url).hostname.replace(/^www\./, ''); return h === domain.replace(/^www\./, ''); } catch { return false; } });
  let best = null, bs = 0; for (const l of own) { const s = linkScore(name, l); if (s > bs) { bs = s; best = l.url; } }
  return bs > 0 ? best.split('#')[0] : null;
}

const abs = (u, base) => { try { return new URL(String(u).trim().split(/\s+/)[0], base).href; } catch { return null; } };
const meta = (html, prop) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')); return m ? m[1].replace(/&amp;/g, '&') : null; };

/** Structured data on one product page. Pure: exported for tests. */
export function parseProductPage(html, pageUrl) {
  const out = { name: null, images: [], price: null, currency: null, source: [] };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = [].concat(j, j && j['@graph'] || []).flat();
    for (const n of nodes) {
      if (!n || !/Product/.test([].concat(n['@type'] || []).join(' '))) continue;
      out.name = out.name || n.name || null;
      [].concat(n.image || []).forEach((im) => { const u = abs(typeof im === 'string' ? im : im && (im.url || im.contentUrl), pageUrl); if (u) out.images.push({ url: u, from: 'json-ld' }); });
      const off = [].concat(n.offers || [])[0] || {}; const p = Number(off.price || off.lowPrice);
      if (p > 0) { out.price = p; out.currency = off.priceCurrency || null; }
      out.source.push('json-ld');
    }
  }
  const og = meta(html, 'og:image'); if (og) { const u = abs(og, pageUrl); if (u) out.images.push({ url: u, from: 'og:image' }); out.source.push('open-graph'); }
  out.name = out.name || meta(html, 'og:title');
  if (out.price == null) { const p = Number(meta(html, 'product:price:amount')); if (p > 0) { out.price = p; out.currency = meta(html, 'product:price:currency'); } }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0], alt = (tag.match(/alt=["']([^"']*)["']/i) || [])[1] || '';
    const src = (tag.match(/(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i) || [])[1];
    const set = (tag.match(/(?:data-srcset|srcset)=["']([^"']+)["']/i) || [])[1];
    const pick = set ? set.split(',').map((x) => x.trim().split(/\s+/)).sort((a, b) => parseInt(b[1]) - parseInt(a[1]))[0][0] : src;
    const u = pick && !pick.startsWith('data:') ? abs(pick, pageUrl) : null;
    if (u) out.images.push({ url: u, from: 'img', alt });
  }
  const seen = new Set(), key = (u) => u.split('?')[0]; out.images = out.images.filter((i) => !BAD_IMG.test(i.url) && !seen.has(key(i.url)) && seen.add(key(i.url)));
  return out;
}

/** Relevance of a candidate to the product: structured-data images on the matched page count; loose <img> needs name words in alt or URL. */
function relevant(name, img) {
  if (img.from === 'json-ld' || img.from === 'og:image') return true;
  const w = words(name), hay = (img.alt + ' ' + img.url).toLowerCase();
  return w.length > 0 && w.every((x) => hay.includes(x));
}

async function verifyImage(f, url) {
  try {
    const r = await f(url, { headers: { 'user-agent': UA, range: 'bytes=0-65535' }, signal: AbortSignal.timeout(6000) });
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !/^image\/(jpeg|png|webp|avif|gif)$/.test(type)) return null;
    const len = Number((r.headers.get('content-range') || '').split('/')[1]) || Number(r.headers.get('content-length')) || 0;
    if (len && len < 6000) return null;   // tiny: icon or placeholder
    return { url, type, bytes: len || null };
  } catch { return null; }
}

async function robotsDisallows(f, origin, cache) {
  if (!cache.has(origin)) cache.set(origin, f(origin + '/robots.txt', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(5000) }).then((r) => r.ok ? r.text() : '').catch(() => ''));
  const txt = await cache.get(origin); const rules = []; let on = false;
  for (const line of txt.split('\n')) { const [k, ...v] = line.split(':'); const key = k.trim().toLowerCase(), val = v.join(':').trim();
    if (key === 'user-agent') on = val === '*' || /coldstart/i.test(val); else if (on && key === 'disallow' && val) rules.push(val); }
  return (path) => rules.some((r) => path.startsWith(r));
}

/** Enrich products in place. Bounded: ≤12 products, 4 at a time, overall deadline. */
export async function enrichProducts(products, { links, domain, fetch: f = fetch, deadline = Date.now() + 18000 }) {
  const robots = new Map(), queue = products.slice(0, 12).filter((p) => !p.url || !p.image);
  const at = new Date().toISOString();
  async function one(p) {
    const url = p.url || resolveProductUrl(p.name, links, domain);
    const e = { at, productUrl: url, candidates: [], status: 'no_page', source: null, rights: 'unconfirmed' };
    p.enrich = e;
    if (!url) return;
    p.url = url; e.source = 'site navigation link';
    if (Date.now() > deadline) { e.status = 'page_blocked'; e.reason = 'Time limit reached before this page was read'; return; }
    const u = new URL(url); const dis = await robotsDisallows(f, u.origin, robots); if (dis(u.pathname)) { e.status = 'robots'; return; }
    let html = ''; try { const r = await f(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(8000) }); if (!r.ok) { e.status = 'page_blocked'; e.reason = 'HTTP ' + r.status; return; } html = (await r.text()).slice(0, 1_500_000); } catch (err) { e.status = 'page_blocked'; e.reason = String(err.message || err).slice(0, 80); return; }
    const d = parseProductPage(html, url);
    if (d.price && !(Number(p.price) > 0)) { p.price = d.price; p.currency = d.currency || null; e.priceSource = d.source.includes('json-ld') ? 'json-ld' : 'meta'; }
    if (!d.images.length) { e.status = 'no_images'; return; }
    const rel = d.images.filter((i) => relevant(p.name, i));
    if (!rel.length) { e.status = 'images_irrelevant'; return; }
    const ok = []; for (const im of rel.slice(0, 6)) { if (ok.length >= 3 || Date.now() > deadline) break; const v = await verifyImage(f, im.url); if (v) ok.push({ ...v, from: im.from, confidence: im.from === 'json-ld' ? 'high' : im.from === 'og:image' ? 'medium' : 'low' }); }
    if (!ok.length) { e.status = 'images_unreachable'; return; }
    e.candidates = ok; e.status = 'ok'; p.image = ok[0].url; p.images = ok.map((x) => x.url);
  }
  for (let i = 0; i < queue.length; i += 4) await Promise.all(queue.slice(i, i + 4).map(one));
  products.forEach((p) => { if (p.enrich) p.enrich.message = STATUS[p.enrich.status]; });
  return products;
}
export { STATUS as ENRICH_STATUS };
