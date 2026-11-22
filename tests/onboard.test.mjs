import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardScan, shopifyProducts } from '../lib/plugins/onboard.js';
import { createStore } from '../lib/store.js';

const KEYS = ['FIRECRAWL_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'TREG_TOKEN', 'ONBOARD_DAILY_SCANS'];
const clear = () => KEYS.forEach(k => delete process.env[k]);
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const SHOP = { products: [
  { id: 1, title: 'Wool Runner', handle: 'wool-runner', product_type: 'Shoes', variants: [{ price: '120.00' }], images: [{ src: 'https://cdn.shop/1.jpg' }] },
  { id: 2, title: 'Gift Card', handle: 'gift-card', product_type: 'Gift Card', variants: [{ price: '25.00' }], images: [] },
  { id: 3, title: 'Tree Dasher', handle: 'tree-dasher', product_type: 'Shoes', variants: [{ price: '135.00' }], images: [{ src: 'https://cdn.shop/3.jpg' }] }] };
const BRANDING = { colors: { primary: '#1990C6', accent: '#136F99', background: '#ECE9E2', textPrimary: '#000000' }, typography: { fontFamilies: { heading: 'Geograph', primary: 'Geograph' } }, personality: { tone: 'friendly' }, brandName: 'Allbirds' };
const AI_OUT = { products: [], icps: [
  { name: 'The Comfort Commuter', who: '28–40, walks to work', pain: 'Shoes that hurt by 5pm', scroll: ['Instagram Reels', 'Reddit'], hook: 'Comfy by 9. Still comfy at 5.', fmt: 'Reels + UGC', evidence: 'Site copy: “the world’s most comfortable shoes”' },
  { name: 'The Eco Switcher', who: '25–35', pain: 'Guilt about synthetic materials', scroll: ['TikTok'], hook: 'Made from wool, not plastic.', fmt: 'Carousel', evidence: 'natural materials like merino wool' },
  { name: 'The Gift Buyer', who: '30–50', pain: 'Sizes', scroll: ['Instagram Stories'], hook: 'Easy returns, easy gift.', fmt: 'Stories', evidence: 'free returns' }],
  brand: { tones: ['Warm', 'Minimal', 'Confident'], say: 'Comfort you can feel, made from nature.', dont: ['revolutionary', 'best ever'], headline: 'Comfy by 9. Still comfy at 5.', line: 'Comfortable wool shoes made from natural materials' } };

function net(log, { shopify = true, firecrawl = true, aiBody = AI_OUT } = {}) {
  return async (url, init = {}) => {
    const u = String(url); log.push({ url: u, init });
    if (/\/products\.json\?limit=\d+$/.test(u)) return shopify ? J(SHOP) : new Response('<html>', { status: 404 });
    if (u.endsWith('/cart.js')) return shopify ? J({ currency: 'USD' }) : new Response('<html>', { status: 404 });
    if (u === 'https://api.firecrawl.dev/v2/scrape') return firecrawl ? J({ success: true, data: { markdown: '# Allbirds\nThe world’s most comfortable shoes, made with natural materials like merino wool. Free returns.', metadata: { title: 'Allbirds', description: 'Comfortable shoes' }, branding: BRANDING } }) : J({ success: false, error: 'blocked' }, 500);
    if (u === 'https://openrouter.ai/api/v1/chat/completions') return J({ choices: [{ message: { content: JSON.stringify(aiBody) } }], usage: { cost: 0.002 } });
    throw new Error('unexpected ' + u);
  };
}
const ctx = f => ({ store: createStore({ STORE: 'memory' }), fetch: f, ip: '3.3.3.3' });
const input = { product: 'wool sneakers', cat: 'fashion', site: 'https://www.allbirds.com/', ig: '@allbirds', icpMode: 'help', rivals: ['Rothy’s'], rev: '50-250' };

test('Shopify store: real products with prices and images, gift cards dropped', async () => {
  const p = await shopifyProducts(net([]), 'allbirds.com');
  assert.deepEqual(p.map(x => x.name), ['Wool Runner', 'Tree Dasher']);
  assert.equal(p[0].price, 120);
  assert.equal(p[0].image, 'https://cdn.shop/1.jpg');
  assert.equal(p[0].url, 'https://allbirds.com/products/wool-runner');
  assert.equal(p[0].src, 'site');
});

test('full scan: real products, real site colours/fonts, Gemini ICPs grounded in site copy', async () => {
  clear(); process.env.FIRECRAWL_API_KEY = 'fc'; process.env.OPENROUTER_API_KEY = 'or';
  const log = [];
  const r = await onboardScan(ctx(net(log)), input);
  assert.equal(r.mode, 'live');
  assert.equal(r.sources.site.status, 'ok');
  assert.equal(r.sources.shopify.count, 2);
  assert.equal(r.products.length, 2);
  assert.equal(r.brand.colors[0], '#1990C6');
  assert.ok(r.brand.colors.every(c => /^#[0-9A-F]{6}$/.test(c)), 'no holes in the palette: ' + r.brand.colors);
  assert.deepEqual(r.brand.fonts.slice(0, 2), ['Geograph', 'Geograph']);
  assert.equal(r.brand.name, 'Allbirds');
  assert.equal(r.icps.length, 3);
  assert.match(r.icps[0].evidence, /comfortable/);
  assert.ok(r.icps.every(i => i.id && i.level));
  const prompt = JSON.parse(log.find(l => l.url.includes('openrouter')).init.body).messages[1].content;
  assert.match(prompt, /natural materials like merino wool/, 'site copy reaches the model');
  assert.match(prompt, /Rothy’s/, 'competitors reach the model');
  assert.match(prompt, /Wool Runner/, 'real products reach the model');
  assert.ok(r.log.some(l => /products\.json/.test(l)));
  clear();
});

test('Instagram is reported honestly as not read without a data provider', async () => {
  clear(); process.env.FIRECRAWL_API_KEY = 'fc'; process.env.OPENROUTER_API_KEY = 'or';
  const r = await onboardScan(ctx(net([])), input);
  assert.equal(r.instagram?.status, 'unavailable');
  assert.deepEqual(r.sources.instagram, r.instagram);
  assert.deepEqual(r.instagram.evidence, []);
  assert.equal(r.info.posts, 0);
  clear();
});

test('non-Shopify site: products come from the page via Gemini, labelled as extracted', async () => {
  clear(); process.env.FIRECRAWL_API_KEY = 'fc'; process.env.OPENROUTER_API_KEY = 'or';
  const ai = { ...AI_OUT, products: [{ name: 'Lavender Candle', price: 28 }, { name: 'Linen Throw', price: 0 }] };
  const r = await onboardScan(ctx(net([], { shopify: false, aiBody: ai })), { ...input, site: 'candles.example' });
  assert.equal(r.sources.shopify.status, 'not_shopify');
  assert.deepEqual(r.products.map(p => p.name), ['Lavender Candle', 'Linen Throw']);
  assert.equal(r.products[0].src, 'site');
  assert.equal(r.products[0].extracted, true);
  clear();
});

test('no website: works from the brief, products marked as from the brief', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'or';
  const ai = { ...AI_OUT, products: [{ name: 'Starter Kit', price: 40 }] };
  const r = await onboardScan(ctx(net([], { aiBody: ai })), { ...input, site: '', noSite: true });
  assert.equal(r.sources.site.status, 'skipped');
  assert.equal(r.products[0].src, 'brief');
  clear();
});

test('without an AI key the scan refuses (client falls back to the labelled sample)', async () => {
  clear(); process.env.FIRECRAWL_API_KEY = 'fc';
  await assert.rejects(() => onboardScan(ctx(net([])), input), e => e.status === 503);
  clear();
});

test('validates the brief and caps scans per day', async () => {
  clear(); process.env.OPENROUTER_API_KEY = 'or'; process.env.ONBOARD_DAILY_SCANS = '1';
  const c = ctx(net([]));
  await assert.rejects(() => onboardScan(c, { ...input, product: 'x' }), e => e.status === 400);
  await assert.rejects(() => onboardScan(c, { ...input, site: 'not a url!!' }), e => e.status === 400);
  await onboardScan(c, { ...input, noSite: true, site: '' });
  await assert.rejects(() => onboardScan(c, { ...input, noSite: true, site: '' }), e => e.status === 429);
  clear();
});

test('catalogue: duplicates, bundle items, freebies and gift cards are dropped; in-stock first; names clip on a word', async () => {
  const prods = [
    { id: 1, title: 'Treat Yourself Bundle Item', handle: 'b', variants: [{ price: '100' }], images: [{ src: 'https://c/1.png' }] },
    { id: 2, title: 'Coffee Face Scrub - 15 gm', handle: 's', variants: [{ price: '129', available: false }], images: [{ src: 'https://c/2.png' }, { src: 'https://c/2b.png' }] },
    { id: 3, title: 'Coffee Face Scrub - 15 gm', handle: 's2', variants: [{ price: '129' }], images: [] },
    { id: 4, title: 'Free Mini Lotion', handle: 'f', variants: [{ price: '0' }], images: [] },
    { id: 5, title: 'Caramel Body Wash with Coffee and Shea Butter for Very Dry Skin - 250 ml Value Pack', handle: 'c', variants: [{ price: '349', available: true }], images: [{ src: 'https://c/5.png' }] }];
  const f = async (u) => /products\.json/.test(String(u)) ? J({ products: prods }) : J({ currency: 'INR' });
  const p = await shopifyProducts(f, 'mcaffeine.com');
  assert.equal(p.length, 2);
  assert.equal(p[0].price, 349, 'in-stock product first');
  assert.ok(p[0].name.endsWith('…') && p[0].name.length <= 80 && !/\s…$/.test(p[0].name));
  assert.deepEqual(p[1].images, ['https://c/2.png', 'https://c/2b.png']);
});
