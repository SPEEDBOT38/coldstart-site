// Onboarding plugin: the real "scan" behind onboarding.html.
// Website → Shopify products.json (real catalogue) + Firecrawl scrape (copy, real colours/fonts via `branding`).
// Gemini → ICPs grounded in the site copy and competitors, a brand book, and products when the site isn't Shopify.
// Instagram needs a data provider (treg) and is reported as not read rather than guessed.
import { generateJson, aiProvider } from '../ai.js';
import { requestJson, need, PluginError } from './http.js';
import { charge } from '../budget.js';

const TONES = ['Confident', 'Relaxed', 'Precise', 'Playful', 'Warm', 'Minimal'];
const REV = { pre: 'pre-revenue', lt10: 'under $10K/month', '10-50': '$10–50K/month', '50-250': '$50–250K/month', '250+': '$250K+/month' };
export const parseSite = v => { v = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]; return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : ''; };
const parseIG = v => { v = String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0]; return /^[a-zA-Z0-9._]{1,30}$/.test(v) ? v : ''; };
const hex = v => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toUpperCase() : null;
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Cut at a word boundary so names never end mid-word ("Matcha Te").
const clipWords = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const c = s.slice(0, n - 1); return c.slice(0, Math.max(c.lastIndexOf(' '), n * 0.6)).replace(/[\s,.;:–—|-]+$/, '') + '…'; };
// Freebies, bundle components and gift cards are not things a founder markets.
const NOT_FOR_SALE = /gift ?card|bundle item|free ?gift|freebie|mystery|sample|tester|\bfree\b|do not (buy|delete)|test product|e-?gift|insurance|shipping protection|route protection/i;
// Store currency: Shopify's /cart.js reports it; products.json does not.
export async function shopifyCurrency(fetchImpl, domain) {
  try { const r = await fetchImpl(`https://${domain}/cart.js`, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; Coldstart/0.3)' }, signal: AbortSignal.timeout(6000) }); const j = r.ok ? await r.json() : null; return /^[A-Z]{3}$/.test(j?.currency || '') ? j.currency : null; }
  catch { return null; }
}
// Shopify's CDN resizes on request: ~900px is plenty for cards and 1080px creatives, and far lighter on phones.
const sized = u => typeof u === 'string' && /(^https:\/\/cdn\.shopify\.com\/|\/cdn\/shop\/)/.test(u) && !/[?&]width=/.test(u) ? u + (u.includes('?') ? '&' : '?') + 'width=900' : u;
export async function shopifyProducts(fetchImpl, domain) {
  let r;
  try { r = await fetchImpl(`https://${domain}/products.json?limit=250`, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; Coldstart/0.3)' }, signal: AbortSignal.timeout(12000) }); }
  catch { return null; }
  if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.products)) return null;
  const seen = new Set(), list = j.products.filter(p => p && p.title && !NOT_FOR_SALE.test(p.product_type + ' ' + p.title + ' ' + (p.tags || []).join(' ')) && (p.variants || []).some(v => Number(v.price) > 0))
    .filter(p => { const k = p.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true; });
  // In-stock items with photos first, the catalogue's own order otherwise.
  const rank = p => ((p.variants || []).some(v => v.available !== false) ? 0 : 2) + ((p.images || []).length ? 0 : 1);
  return list.map((p, i) => [p, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]).slice(0, 24).map((p, i) => ({
    id: 's' + (p.id || i), name: clipWords(p.title, 80), price: Math.round(Number(p.variants?.[0]?.price) || 0), image: sized(p.images?.[0]?.src) || null, images: (p.images || []).map(x => x && sized(x.src)).filter(Boolean).slice(0, 4),
    url: `https://${domain}/products/${p.handle}`, type: p.product_type || '', src: 'site', posts: 0, on: true, real: true,
  }));
}

async function scrape(fetchImpl, domain) {
  const j = await requestJson(fetchImpl, 'https://api.firecrawl.dev/v2/scrape', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.FIRECRAWL_API_KEY },
    json: { url: 'https://' + domain, formats: ['markdown', 'branding'], onlyMainContent: false, timeout: 30000 }, timeout: 35000 });
  need(j.success !== false && j.data, 'Could not read the website.');
  return { markdown: String(j.data.markdown || '').slice(0, 14000), meta: j.data.metadata || {}, branding: j.data.branding || null };
}

const mix = (a, b, t) => '#' + [0, 2, 4].map(i => Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - t) + parseInt(b.slice(1 + i, 3 + i), 16) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
function palette(b) {
  const c = (b && b.colors) || {};
  const p = [c.primary, c.secondary, c.accent, c.textPrimary || c.text, c.background].map(hex);
  if (p.filter(Boolean).length < 3 || !p[0]) return null;
  const paper = p[4] || '#F7F7F5', ink = p[3] || '#111111';
  return [p[0], p[1] || mix(p[0], paper, .45), p[2] || mix(p[0], ink, .35), ink, paper];
}

export async function onboardScan(ctx, input) {
  const product = clip(input.product, 80), cat = clip(input.cat, 20);
  need(product.length >= 3, 'Tell Coldie what you sell (3+ characters).');
  const domain = input.noSite ? '' : parseSite(input.site);
  need(input.noSite || domain, 'That website address does not look right.');
  const handle = input.noIG ? '' : parseIG(input.ig);
  if (aiProvider().name === 'none') throw new PluginError('The scan needs GEMINI_API_KEY (or OPENROUTER_API_KEY) on the server.', 503);
  await charge(ctx.store, 'onboard', ctx.ip, { daily: Number(process.env.ONBOARD_DAILY_SCANS) || 40, hourlyPerIp: 8 });
  const f = ctx.fetch || fetch, log = [], sources = {};
  const t0 = Date.now();

  let shop = null, site = null;
  if (domain) {
    log.push(`fetching ${domain}/`);
    const [sp, sc] = await Promise.allSettled([
      Promise.all([shopifyProducts(f, domain), shopifyCurrency(f, domain)]).then(([list, cur]) => list && list.map(p => ({ ...p, currency: cur }))),
      process.env.FIRECRAWL_API_KEY ? scrape(f, domain) : Promise.reject(new PluginError('FIRECRAWL_API_KEY not set', 503)),
    ]);
    shop = sp.status === 'fulfilled' ? sp.value : null;
    sources.shopify = shop ? { status: 'ok', count: shop.length } : { status: 'not_shopify', count: 0 };
    log.push(shop ? `/products.json: ${shop.length} products (Shopify)` : 'not a Shopify catalogue, reading pages instead');
    if (sc.status === 'fulfilled') { site = sc.value; sources.site = { status: 'ok', title: site.meta.title || domain }; log.push(`read ${domain}: ${Math.round(site.markdown.length / 1000)}k characters of copy`); if (site.branding) log.push('pulled brand colours and type from the live site'); }
    else { sources.site = { status: 'error', error: sc.reason?.message || 'unreadable' }; log.push(`could not read ${domain}: ${sources.site.error}`); }
  } else { sources.site = { status: 'skipped' }; sources.shopify = { status: 'skipped', count: 0 }; log.push('no website: working from your description'); }
  const instagram = handle ? { status: 'unavailable', handle, error: 'Reading Instagram needs a data provider (TREG_TOKEN). Coldie did not guess your posts.', evidence: [] } : { status: 'skipped', evidence: [] };
  sources.instagram = instagram;
  log.push(handle ? `@${handle}: not read (no Instagram provider on this server)` : 'no Instagram: skipping');

  const rivals = (Array.isArray(input.rivals) ? input.rivals : []).map(r => clip(r, 40)).filter(Boolean).slice(0, 5);
  const pageImgs = site && !(shop && shop.length) ? [...new Set([...site.markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]))].filter(u => !/\.svg(\?|$)|logo|icon|sprite|favicon|pixel|badge|payment|flag/i.test(u)).slice(0, 40) : [];
  const known = (shop || []).map(p => `${p.name}${p.price ? ' ($' + p.price + ')' : ''}${p.type ? ' · ' + p.type : ''}`).slice(0, 24);
  const prompt = `You are onboarding a small online brand.
Brief: sells "${product}" (category: ${cat || 'unknown'}), revenue ${REV[input.rev] || 'unknown'}.
${input.icpMode === 'know' && input.icpText ? 'Founder’s own description of the best customer: "' + clip(input.icpText, 240) + '"' : 'Founder named these competitors: ' + (rivals.join(', ') || 'none, find the archetypes yourself')}.
Website: ${domain || 'none'}${site ? ` — title "${clip(site.meta.title, 120)}", description "${clip(site.meta.description, 240)}"` : ''}.
${known.length ? 'Real products from the store catalogue:\n- ' + known.join('\n- ') : ''}
${site ? 'Website copy (markdown, truncated):\n"""\n' + site.markdown.slice(0, 9000) + '\n"""' : ''}
${site && site.branding && site.branding.personality ? 'Detected brand personality: ' + JSON.stringify(site.branding.personality).slice(0, 300) : ''}

Return JSON:
{"products": ${known.length ? '[] (leave empty: the catalogue above is authoritative)' : '[up to 12 {"name","price","image"} actually sold on the site or, with no site, the most likely starter range for the brief; price 0 if unknown; image = the exact URL of that product\'s photo from the image list below, or "" if none clearly matches]'},
 "icps": [exactly 3 {"name" (e.g. "The Comfort Commuter"),"who" (age range + situation, ≤90 chars),"pain" (≤90 chars),"scroll" (2–3 of Instagram Reels, Instagram Stories, TikTok, Reddit, Pinterest, YouTube, X),"hook" (ad hook ≤60 chars, in the brand’s voice),"fmt" (Meta format),"evidence" (a short quote or fact from the site copy/catalogue/brief that supports this ICP — never invented)}],
 "brand": {"tones": 3 of ${JSON.stringify(TONES)}, "line": one sentence on what they sell and for whom, "say": one on-voice example sentence, "dont": 3–5 words or claims to avoid, "headline": first Meta ad headline for the main ICP (≤60 chars)}}
${pageImgs.length ? 'Image URLs found on the site (choose product photos only from these, copied exactly):\n- ' + pageImgs.join('\n- ') + '\n' : ''}Ground everything in the copy and catalogue. Do not invent reviews, awards, statistics or customers.`;
  log.push('working out who buys, with Gemini');
  const ai = await generateJson({ fetch: f, temperature: 0.4, timeout: 30000, system: 'You are Coldie, a careful brand strategist. Return only JSON.', prompt });
  const d = ai.data || {};

  const products = shop && shop.length ? shop : (Array.isArray(d.products) ? d.products : []).slice(0, 12).map((p, i) => ({
    id: 'g' + i, name: clipWords(p.name, 80), price: Math.round(Number(p.price) || 0), image: pageImgs.includes(p.image) ? p.image : null, url: null, src: domain && site ? 'site' : 'brief', posts: 0, on: true, extracted: true,
  })).filter(p => p.name);
  const icps = (Array.isArray(d.icps) ? d.icps : []).slice(0, 3).map((x, i) => ({
    id: 'i' + i, name: clip(x.name, 40) || 'Customer ' + (i + 1), who: clip(x.who, 120), pain: clip(x.pain, 120),
    scroll: (Array.isArray(x.scroll) ? x.scroll : []).map(s => clip(s, 24)).slice(0, 3), hook: clip(x.hook, 80), fmt: clip(x.fmt, 40),
    evidence: clip(x.evidence, 200), signals: 0, level: ['Strong', 'Medium', 'Testing'][i], mine: false, real: true,
  }));
  need(icps.length, 'Gemini returned no ICPs. Try again.');
  const b = d.brand || {}, br = site && site.branding;
  const fonts = br ? [br.typography?.fontFamilies?.heading || br.typography?.fontFamilies?.primary, br.typography?.fontFamilies?.primary || br.fonts?.[0]?.family].map(x => clip(x, 40)).filter(Boolean) : [];
  const brand = {
    currency: (shop && shop[0] && shop[0].currency) || (/\.in$/i.test(domain || '') ? 'INR' : null),
    name: clip((br && br.brandName) || (site && site.meta.ogSiteName) || (domain ? domain.split('.')[0] : '') || product, 40).replace(/\b\w/g, c => c.toUpperCase()),
    colors: palette(br), names: ['Primary', 'Support', 'Accent', 'Ink', 'Paper'],
    fonts: fonts.length ? [fonts[0], fonts[1] || fonts[0], 'sans', 'sans'] : null, logo: (s => s && s.length < 30000 ? s : null)(br && typeof br.logo === 'string' ? br.logo : (br && br.logo && br.logo.url) || null),
    tones: (Array.isArray(b.tones) ? b.tones : []).filter(t => TONES.includes(t)).slice(0, 3), line: clip(b.line, 160), say: clip(b.say, 140),
    hero: (u => typeof u === 'string' && /^https?:\/\//.test(u) ? u.slice(0, 500) : null)(site && (site.meta.ogImage || site.meta['og:image'])),
    dont: (Array.isArray(b.dont) ? b.dont : []).map(w => clip(w, 30)).slice(0, 5), headline: clip(b.headline, 90), fromSite: !!(br && palette(br)),
  };
  log.push(`drafted ${icps.length} ICP cards and a brand book`);
  return {
    mode: 'live', products, icps, brand, sources, instagram, log,
    info: { pages: site ? 1 + (shop ? 1 : 0) : 0, posts: 0, products: products.length, signals: icps.length },
    model: ai.model, ms: Date.now() - t0, cost: { usd: ai.usd },
  };
}

export async function signup(ctx, input) {
  const email = String(input.email || '').trim().toLowerCase();
  need(/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email), 'That email doesn’t look right.');
  await charge(ctx.store, 'signup', ctx.ip, { daily: 2000, hourlyPerIp: 10 });
  const key = 'signup:' + email;
  const prev = await ctx.store.get(key);
  await ctx.store.set(key, { email, source: clip(input.source, 30) || 'unknown', brand: clip(input.brand, 60), site: parseSite(input.site), at: prev?.at || new Date().toISOString(), seen: new Date().toISOString() });
  return { ok: true, already: !!prev };
}

export default {
  id: 'onboard', name: 'Onboarding scan', vendor: 'Shopify · Firecrawl · Gemini', category: 'Onboarding',
  description: 'Reads the brand’s website (Shopify catalogue, copy, colours and type) and drafts ICPs and a brand book with Gemini.',
  capabilities: ['site.shopify_products', 'site.branding', 'ai.icps', 'ai.brand_book', 'signup'],
  env: ['FIRECRAWL_API_KEY'], optionalEnv: ['GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'TREG_TOKEN', 'ONBOARD_DAILY_SCANS'],
  docs: 'https://docs.firecrawl.dev', auth: { type: 'server', scopes: [] },
  liveReady: () => aiProvider().name !== 'none',
  actions: {
    scan: { method: 'POST', run: (ctx, input) => onboardScan({ ...ctx, ip: ctx.req.ip }, input) },
    signup: { method: 'POST', run: (ctx, input) => signup({ ...ctx, ip: ctx.req.ip }, input) },
  },
};
