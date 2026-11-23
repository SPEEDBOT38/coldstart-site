// Onboarding intelligence, persisted per workspace (Neon via the scoped kv). Every record says where it came from:
//   discovered (AI or search suggested)  ≠  approved (the person chose it)  ≠  verified (an external source confirmed it).
// Competitors: AI-suggested from the confirmed brand + flagship, then each website is checked to exist. Only the person
//   approves; rejected ones are never re-added. Communities: subreddit NAMES and links taken from a web search index
//   (Firecrawl search) and the public search snippet only; no Reddit content is fetched. Meta ads: official Ad Library
//   search links for approved competitors ("needs manual review"); nothing is scraped and no ads are invented.
// Creatives: three distinct drafts derived from the confirmed brand and product. No images are generated here.
import crypto from 'node:crypto';
import { z } from 'zod';
import { PluginError } from '../plugins/http.js';
import { generateJson } from '../ai.js';
import { requestJson } from '../plugins/http.js';

const now = () => new Date().toISOString();
const id = (p) => p + crypto.randomBytes(5).toString('hex');
const host = (u) => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch { return null; } };
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const c = t.slice(0, n + 1); const i = c.lastIndexOf(' '); return (i > n * 0.5 ? c.slice(0, i) : t.slice(0, n)).replace(/[,;:–—-]\s*$/, ''); };   // never cut mid-word
const COUNTRY = { IN: 'IN', US: 'US', GB: 'GB', AE: 'AE' };
/* Business-context isolation. Every onboarding record lives under ob:<contextId>:<kind>, where the context id is derived
   on the server from the canonical domain (or brand name when there is no site) and the market. A new website in the same
   workspace is a new context: nothing from an earlier business is reused, carried over or shown. Records carry their
   context and are checked again on read (fail closed). */
export function contextOf(c) {
  const domain = host(c.brand.site) || null, name = clip(c.brand.name, 80).toLowerCase();
  const basis = domain || 'name:' + name;   // the business, not the market: choosing a country later must not orphan its research
  return { contextId: 'ctx_' + crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16), domain, brand: c.brand.name, market: COUNTRY[String(c.country || '').toUpperCase()] || null, contextVersion: 1 };
}
const K = (cx, kind) => `ob:${cx.contextId}:${kind}`;
const own = (cx, rec) => rec && rec.contextId === cx.contextId ? rec : null;   // fail closed on mismatch

export const Context = z.object({
  brand: z.object({ name: z.string().max(80), line: z.string().max(400).optional().default(''), site: z.string().max(200).optional().default('') }),
  product: z.object({ name: z.string().max(120), price: z.number().nullable().optional(), currency: z.string().max(3).nullable().optional() }).optional(),
  audience: z.string().max(300).optional().default(''), country: z.string().max(2).optional().default(''),
});

async function siteCheck(f, url) {
  const t = Date.now();
  try {
    const r = await f(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Coldstart/0.4)', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(7000) });
    if (!r.ok) return { ok: false, status: r.status, ms: Date.now() - t };
    const html = (await r.text()).slice(0, 200000);
    const title = clip((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1], 120);
    const desc = clip((html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)/i) || [])[1], 220);
    return { ok: true, status: r.status, title, desc, finalUrl: r.url || url, ms: Date.now() - t };
  } catch (e) { return { ok: false, status: 0, error: clip(e.message, 80), ms: Date.now() - t }; }
}

/* ---------------- competitors ---------------- */
export async function discoverCompetitors(kv, ctx, input) {
  const c = Context.parse(input), f = ctx.fetch || fetch, t0 = Date.now();
  const cx = contextOf(c), prev = own(cx, await kv.get(K(cx, 'competitors'))) || { items: [], rejected: [] };
  const ownDomain = host(c.brand.site);
  const ai = await generateJson({ fetch: f, temperature: 0.2, timeout: 25000, system: 'You are a careful market analyst. Return only JSON. Name only real companies you are confident exist, with their real website domain. If unsure, return fewer.',
    prompt: `Business: ${c.brand.name} (${c.brand.site || 'no site'}). What it sells: ${c.brand.line}. Lead product: ${c.product ? c.product.name : 'not chosen'}${c.product && c.product.price ? ' at ' + c.product.price + ' ' + (c.product.currency || '') : ''}. Audience: ${c.audience || 'unknown'}. Market: ${c.country || 'not chosen'}.
List 3 to 5 competitors a customer would compare against. JSON: {"competitors":[{"name","domain","kind":"direct|indirect|adjacent","overlap":"which products overlap, one short phrase","why":"one sentence"}]}. Exclude ${c.brand.name}${ownDomain ? ' and ' + ownDomain : ''}. Competitors must sell the same kind of product (same category) as the lead product, in or for this market; never list companies from another category.` });
  const raw = (ai.data && Array.isArray(ai.data.competitors) ? ai.data.competitors : []).slice(0, 6);
  const rejected = new Set(prev.rejected.map((d) => d.toLowerCase()));
  const keep = new Map(prev.items.filter((x) => x.decision === 'approved' || x.decision === 'added').map((x) => [x.domain, x]));
  const items = [...keep.values()];
  const checks = await Promise.all(raw.map(async (r) => { const d = host(r.domain); if (!d || d === ownDomain || rejected.has(d) || keep.has(d)) return null; return { r, d, chk: await siteCheck(f, 'https://' + d) }; }));
  for (const x of checks.filter(Boolean)) {
    items.push({ id: id('cmp_'), name: clip(x.r.name, 60), domain: x.d, url: 'https://' + x.d, kind: ['direct', 'indirect', 'adjacent'].includes(x.r.kind) ? x.r.kind : 'adjacent',
      overlap: clip(x.r.overlap, 120), why: clip(x.r.why, 220), origin: 'ai_suggested', model: ai.model,
      evidence: x.chk.ok ? { type: 'website_reachable', url: x.chk.finalUrl, title: x.chk.title, description: x.chk.desc, at: now() } : { type: 'website_unreachable', status: x.chk.status, at: now() },
      confidence: x.chk.ok ? (x.r.kind === 'direct' ? 'medium' : 'low') : 'low', decision: 'pending', at: now() });
  }
  const rec = { ...cx, items, rejected: prev.rejected, approvedVersion: prev.approvedVersion || 0, at: now(), ms: Date.now() - t0, usd: ai.usd ?? null, model: ai.model };
  await kv.set(K(cx, 'competitors'), rec); await kv.audit('onboarding', `Competitor suggestions: ${checks.filter(Boolean).length} new`, { model: ai.model });
  return rec;
}
export async function decideCompetitor(kv, input) {
  const cx = contextOf(Context.parse(input.context || {}));
  const i = z.object({ context: z.any(), id: z.string().max(40).optional(), decision: z.enum(['approved', 'rejected', 'pending']).optional(), add: z.object({ name: z.string().min(2).max(60), url: z.string().max(200) }).optional() }).parse(input);
  const rec = own(cx, await kv.get(K(cx, 'competitors'))) || { ...cx, items: [], rejected: [] };
  if (i.add) {
    const d = host(i.add.url); if (!d) throw new PluginError('Enter the competitor’s website, e.g. example.com', 400);
    rec.rejected = rec.rejected.filter((x) => x !== d); rec.items = rec.items.filter((x) => x.domain !== d);
    rec.items.push({ id: id('cmp_'), name: clip(i.add.name, 60), domain: d, url: 'https://' + d, kind: 'direct', overlap: '', why: 'Added by you.', origin: 'user_added', evidence: null, confidence: 'user', decision: 'approved', decidedAt: now(), at: now() });
  } else {
    const x = rec.items.find((y) => y.id === i.id); if (!x) throw new PluginError('Unknown competitor.', 404);
    x.decision = i.decision; x.decidedAt = now();
    if (i.decision === 'rejected') { if (!rec.rejected.includes(x.domain)) rec.rejected.push(x.domain); } else rec.rejected = rec.rejected.filter((d) => d !== x.domain);
  }
  rec.approvedVersion = (rec.approvedVersion || 0) + 1; rec.approvedHash = crypto.createHash('sha256').update(rec.items.filter((x) => x.decision === 'approved').map((x) => x.domain).sort().join(',')).digest('hex').slice(0, 16);
  await kv.set(K(cx, 'competitors'), rec); await kv.del(K(cx, 'ads'));   // approved set changed: ad research is stale
  return rec;
}

/* ---------------- Meta Ad Library (official links, assisted review) ---------------- */
export async function adResearch(kv, input) {
  const c = Context.parse(input.context || input), cx = contextOf(c);
  const country = cx.market || 'ALL';
  const rec = own(cx, await kv.get(K(cx, 'competitors'))) || { items: [] };
  const approved = rec.items.filter((x) => x.decision === 'approved');
  const out = { ...cx, basedOnVersion: rec.approvedVersion || 0, basedOn: rec.approvedHash || null, at: now(), access: process.env.META_AD_LIBRARY_TOKEN ? 'api_configured' : 'search_links_only',
    items: approved.map((x) => ({ competitor: x.name, domain: x.domain, status: 'needs_manual_review', note: 'Opens Meta’s public Ad Library search. No ads were fetched or analysed automatically.',
      url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(x.name)}&search_type=keyword_unordered` })) };
  await kv.set(K(cx, 'ads'), out); return out;
}

/* ---------------- Reddit communities (names from a search index only) ---------------- */
export async function suggestCommunities(kv, ctx, input) {
  const c = Context.parse(input), f = ctx.fetch || fetch, t0 = Date.now();
  const cx = contextOf(c);
  if (!process.env.FIRECRAWL_API_KEY) { const r = { ...cx, items: [], status: 'unavailable', reason: 'Community search isn’t configured on this server.', at: now() }; await kv.set(K(cx, 'communities'), r); return r; }
  const prev = own(cx, await kv.get(K(cx, 'communities'))) || { items: [] };
  const saved = prev.items.filter((x) => x.decision === 'saved' || x.decision === 'not_relevant');
  const topic = clip([c.product && c.product.name, c.brand.line].filter(Boolean).join(' '), 120);
  let j; try { j = await requestJson(f, 'https://api.firecrawl.dev/v2/search', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.FIRECRAWL_API_KEY }, json: { query: `site:reddit.com/r ${topic} community`, limit: 15 }, timeout: 20000 }); }
  catch (e) { const r = { ...cx, items: saved, status: 'failed', reason: 'Search is unavailable right now.', at: now() }; await kv.set(K(cx, 'communities'), r); return r; }
  const rows = (j && j.data && (j.data.web || j.data)) || [];
  const seen = new Map(saved.map((x) => [x.name.replace(/^r\//i, '').toLowerCase(), x]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const m = String(row.url || '').match(/reddit\.com\/r\/([A-Za-z0-9_]{2,21})(?:\/|$)/); if (!m) continue;
    const name = m[1], k = name.toLowerCase(); if (seen.has(k) || ['all', 'popular', 'askreddit'].includes(k)) continue;
    seen.set(k, { id: id('com_'), name: 'r/' + name, url: 'https://www.reddit.com/r/' + name + '/', snippet: clip(row.description || row.title, 220), source: 'web search index (Firecrawl)', sourceUrl: row.url,
      relevance: 'Appeared in a web search for “' + topic.slice(0, 60) + '”. Not a measure of demand.', confidence: 'low', research: 'Reddit content is not fetched. Paste threads you find to get help drafting a reply.', decision: 'suggested', at: now() });
    if (seen.size >= saved.length + 6) break;
  }
  const r = { ...cx, items: [...seen.values()], status: seen.size ? 'completed' : 'partial', reason: seen.size ? null : 'No communities found in search results.', at: now(), ms: Date.now() - t0, usd: 0.0032 };
  await kv.set(K(cx, 'communities'), r); return r;
}
export async function decideCommunity(kv, input) {
  const cx = contextOf(Context.parse(input.context || {}));
  const i = z.object({ context: z.any(), id: z.string().max(40).optional(), decision: z.enum(['saved', 'not_relevant', 'suggested']).optional(), add: z.string().max(40).optional() }).parse(input);
  const rec = own(cx, await kv.get(K(cx, 'communities'))) || { ...cx, items: [] };
  if (i.add) { const n = i.add.replace(/^\/?r\//i, '').trim(); if (!/^[A-Za-z0-9_]{2,21}$/.test(n)) throw new PluginError('Enter a subreddit name like r/houseplants.', 400);
    rec.items = rec.items.filter((x) => x.name.toLowerCase() !== 'r/' + n.toLowerCase()); rec.items.push({ id: id('com_'), name: 'r/' + n, url: 'https://www.reddit.com/r/' + n + '/', snippet: '', source: 'added by you', relevance: 'Added by you.', confidence: 'user', decision: 'saved', at: now() }); }
  else { const x = rec.items.find((y) => y.id === i.id); if (!x) throw new PluginError('Unknown community.', 404); x.decision = i.decision; x.decidedAt = now(); }
  await kv.set(K(cx, 'communities'), rec); return rec;
}


/** Shorten to whole clauses: never cuts a word or ends on a dangling clause; returns '' when even one clause is too long. */
export function summary(text, n) {
  const t = String(text || '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t;
  const first = t.split(/(?<=[.!?])\s/)[0]; if (first.length <= n) return first;
  const parts = first.replace(/[.!?]$/, '').split(/,\s+/); let out = '';
  for (const part of parts) { const next = out ? out + ', ' + part : part; if (next.length > n - 1) break; out = next; }
  return out && out.length >= n * 0.4 ? out + '.' : '';
}
const PLACEHOLDER = /\b(edit with|state your|approve competitors|your real advantage|lorem|placeholder|tbd|xxx)\b/i;
/** AI copywriter. Facts only; checked for length, placeholders and invented numbers; falls back per ad, never silently. */
export async function writeCopy(items, f, { gen = generateJson } = {}) {
  const facts = `Brand: ${f.brand}\nWhat they sell (from their site): ${f.line}\nProduct: ${f.product}${f.price ? ' — price ' + f.price : ''}\nAudience (confirmed): ${f.audience || 'not confirmed'}`;
  const limits = { headline: 40, body: 80, cta: 16 };
  const allowedNums = new Set(String(f.line + ' ' + f.price + ' ' + f.product).match(/\d+/g) || []);
  const check = (j) => {
    for (const k of ['spotlight', 'lifestyle', 'contrast']) {
      const a = j && j[k]; if (!a) return 'missing ' + k;
      for (const [fld, n] of Object.entries(limits)) { const v = a[fld]; if (typeof v !== 'string' || v.trim().length < 2) return k + '.' + fld + ' missing'; if (v.length > n) return `${k}.${fld} is ${v.length} chars, max ${n}`; if (PLACEHOLDER.test(v)) return k + '.' + fld + ' is placeholder text'; if (/\.\.\.|…/.test(v)) return k + '.' + fld + ' is truncated'; const nums = v.match(/\d+/g) || []; if (nums.some((x) => !allowedNums.has(x))) return k + '.' + fld + ' invents a number'; }
    }
    const hs = ['spotlight', 'lifestyle', 'contrast'].map((k) => j[k].headline.toLowerCase()); if (new Set(hs).size < 3) return 'headlines must be different';
    return null;   // generateJson: a returned string means "rejected because …"
  };
  try {
    const r = await gen({ fast: true, temperature: 0.7, timeout: 15000, deadline: 25000,
      system: 'You are a senior copywriter for paid social. Use ONLY the facts given: never invent claims, awards, ingredients, numbers, origins or prices. Every line is complete (no ellipses). No hashtags, no emojis, no quotes around lines. Return only JSON.',
      prompt: `${facts}\n\nWrite three distinct ads for this product:\n- spotlight: product-first and premium; body names the product and its price if known.\n- lifestyle: sensory, the moment of enjoying it, aimed at the audience.\n- contrast: one bold editorial headline; body = the product name only.\nLimits: headline ≤ 40 characters, body ≤ 80, cta ≤ 16 (2–3 words).\nJSON {"spotlight":{"headline":"","body":"","cta":""},"lifestyle":{"headline":"","body":"","cta":""},"contrast":{"headline":"","body":"","cta":""}}`,
      validate: check });
    const d = r.data, map = { cr_spotlight: 'spotlight', cr_audience: 'lifestyle', cr_diff: 'contrast' };
    for (const x of items) { const a = d[map[x.id]]; x.headline = a.headline.trim(); x.body = a.body.trim(); x.cta = a.cta.trim(); x.origin = 'ai_copy_from_confirmed_facts'; x.copyModel = r.model; }
    return { ok: true, model: r.model };
  } catch (e) {
    for (const x of items) { x.copyNote = 'AI copy unavailable (' + String(e.message || e).slice(0, 120) + '); fact-only fallback used'; }
    return { ok: false, error: String(e.message || e) };
  }
}
/** Rewrite the copy of the existing drafts in place (keeps prototypes, masks, layouts and approvals). */
export async function rewriteCopy(kv, input) {
  const c = Context.parse(input.context || {}), cx = contextOf(c); const rec = own(cx, await kv.get(K(cx, 'creatives'))); if (!rec) throw new PluginError('No drafts yet.', 404);
  const p = (c.product && c.product.name) || c.brand.name, price = c.product && c.product.price && c.product.currency ? c.product.price + ' ' + c.product.currency : '';
  const comp = own(cx, await kv.get(K(cx, 'competitors'))) || { items: [] };
  const res = await writeCopy(rec.items, { brand: c.brand.name, line: c.brand.line || '', product: p, price, audience: c.audience, competitors: comp.items.filter((x) => x.decision === 'approved').map((x) => x.name) });
  if (!res.ok) throw new PluginError('The copywriter could not produce valid copy: ' + res.error, 502);
  for (const x of rec.items) { if (x.design && x.design.layout) { const L = x.design.layout; if (L.headline) L.headline.text = x.headline; if (L.body) L.body.text = x.body; if (L.cta) L.cta.text = x.cta; x.design.layout_approved = false; } x.editedAt = now(); }
  await kv.set(K(cx, 'creatives'), rec); return rec;
}

/* ---------------- three creative directions (drafts, no images generated) ---------------- */
export async function initCreatives(kv, input) {
  const c = Context.parse(input), cx = contextOf(c), ex = own(cx, await kv.get(K(cx, 'creatives')));
  if (ex && ex.items && ex.items.length === 3 && !input.regenerate) return ex;   // idempotent: refresh never duplicates
  const p = (c.product && c.product.name) || c.brand.name, line = c.brand.line || '';
  const rec = own(cx, await kv.get(K(cx, 'competitors'))) || { items: [] }, appr = rec.items.filter((x) => x.decision === 'approved');
  const price = c.product && c.product.price && c.product.currency ? c.product.price + ' ' + c.product.currency : '';
  const items = [
    { id: 'cr_spotlight', kind: 'Product spotlight', layout: 'spotlight', channel: 'Instagram feed 4:5', headline: clip(p, 40), body: [p, price].filter(Boolean).join(' · '), price, cta: 'Shop now', rationale: 'Leads with the product itself, the clearest message for people already looking.' },
    { id: 'cr_audience', kind: 'Audience / lifestyle', layout: 'lifestyle', channel: 'Instagram story 9:16', headline: clip(p, 40), body: summary(c.audience || line, 90), price: '', cta: 'See how', rationale: c.audience ? 'Speaks to the audience you confirmed.' : 'Audience not confirmed yet: edit the headline once you choose one.' },
    { id: 'cr_diff', kind: 'Differentiation', layout: 'contrast', channel: 'Facebook feed 1:1', headline: clip(c.brand.name + ' ' + p, 40), body: [p, price].filter(Boolean).join(' · '), price: '', cta: 'Learn more', rationale: appr.length ? 'Uses the competitors you approved; the claim itself needs your words.' : 'Waiting on competitor approval.' },
  ].map((x) => ({ ...x, channel: 'Instagram feed 4:5', status: 'draft', imageState: 'needs_product_photo', editable: true, origin: 'template_from_confirmed_brand', at: now() }));
  if (input.aiCopy !== false) await writeCopy(items, { brand: c.brand.name, line, product: p, price, audience: c.audience, competitors: appr.map((x) => x.name) });
  const out = { ...cx, items, basedOn: { brand: c.brand.name, product: p, competitors: rec.approvedHash || null }, at: now() };
  await kv.set(K(cx, 'creatives'), out); return out;
}
export async function editCreative(kv, input) {
  const cx = contextOf(Context.parse(input.context || {}));
  const i = z.object({ context: z.any(), id: z.string().max(40), image: z.string().startsWith('data:image/').max(8e6).optional(), imageMeta: z.any().optional(), layout: z.any().optional(), design: z.any().optional(), asset: z.enum(['scene', 'mask', 'composite', 'prototype']).optional(), data: z.string().startsWith('data:image/').max(8e6).optional(), approve: z.boolean().optional(), override: z.string().max(300).optional(), headline: z.string().max(60).optional(), body: z.string().max(160).optional(), cta: z.string().max(24).optional(), price: z.string().max(30).optional() }).parse(input);
  const rec = own(cx, await kv.get(K(cx, 'creatives'))); const x = rec && rec.items.find((y) => y.id === i.id); if (!x) throw new PluginError('Unknown draft.', 404);
  const { image, imageMeta, layout, design, asset, data, approve, override, ...txt } = i; if (layout && JSON.stringify(layout).length < 6000) x.textLayout = layout;
  // Design document: everything needed to rebuild the ad without calling the image provider again (brief, placement,
  // mask revision, shadow, layout, QA, costs). Pixel assets are stored separately, losslessly, one per key.
  if (design && JSON.stringify(design).length < 40000) { x.design = { ...(x.design || {}), ...design, savedAt: now() }; }
  if (asset && data) { await kv.set(K(cx, asset + ':' + x.id), data); x.assets = { ...(x.assets || {}), [asset]: { at: now(), bytes: Math.round(data.length * 0.75) } }; if (asset === 'mask') x.design = { ...(x.design || {}), mask_rev: ((x.design && x.design.mask_rev) || 0) + 1 }; }
  if (approve === true) {
    // Failed checks block approval: technical failures always; the visual review's blocking issues unless the person
    // explicitly overrides with a reason (recorded).
    const q = x.design && x.design.qa; const why = [];
    if (!q) why.push('no quality checks on record');
    else { if (q.protected_pixels !== 'pass') why.push('product pixels changed'); if (q.mask_completeness !== 'pass') why.push('cutout needs review'); if ((q.text_issues || []).length) why.push('text layout issues: ' + q.text_issues.join('; ')); const c = q.critique || {}; if (c.error) why.push('visual review did not run'); else if ((c.blocking_issues || []).length && !override) why.push('visual review blocking issues: ' + c.blocking_issues.join(' | ')); }
    if (why.length) throw new PluginError('Not approved: ' + why.join('; '), 409);
    x.status = 'approved'; x.approvedAt = now(); if (override) x.approvalOverride = String(input.override).slice(0, 300);
  } else if (approve === false) { x.status = 'review'; delete x.approvedAt; } Object.assign(x, Object.fromEntries(Object.entries(txt).filter(([k, v]) => !['id', 'context'].includes(k) && v !== undefined)), { editedAt: now() });
  if (Object.keys(txt).some((k) => !['id', 'context'].includes(k) && txt[k] !== undefined)) x.origin = 'edited_by_user';
  if (image) { await kv.set(K(cx, 'img:' + x.id), image); x.imageState = 'rendered'; x.imageMeta = { ...(imageMeta || {}), at: now() }; x.status = 'review'; }
  await kv.set(K(cx, 'creatives'), rec); return rec;
}
export async function intelSnapshot(kv, input) {
  if (!input || !input.site && !input.brand) return { contextId: null, competitors: null, communities: null, ads: null, creatives: null };
  const cx = contextOf(Context.parse({ brand: { name: String(input.brand || ''), site: String(input.site || '') }, country: String(input.country || '') }));
  const [competitors, communities, ads, creatives, timings] = await Promise.all(['competitors', 'communities', 'ads', 'creatives', 'timings'].map((k) => kv.get(K(cx, k))));
  const chk = (r) => r && r.contextId !== cx.contextId ? (kv.audit('isolation', 'Quarantined a record from another business context', { want: cx.contextId, got: r.contextId }), null) : r || null;
  return { ...cx, competitors: chk(competitors), communities: chk(communities), ads: chk(ads), creatives: chk(creatives), timings };
}
export async function creativeImage(kv, input) {
  const cx = contextOf(Context.parse(input.context || {})); const idv = z.string().regex(/^cr_[a-z]+$/).parse(input.id);
  const kind = ['scene', 'mask', 'composite', 'prototype'].includes(input.kind) ? input.kind : 'img';
  return { image: (await kv.get(K(cx, kind + ':' + idv))) || null, kind };
}
export async function recordTiming(kv, input) {
  const cx = contextOf(Context.parse(input.context || {}));
  const i = z.object({ context: z.any(), mark: z.enum(['scan_started', 'brand_shown', 'competitors_shown', 'product_confirmed', 'dashboard_ready']), at: z.number() }).parse(input);
  const t = (await kv.get(K(cx, 'timings'))) || {}; if (!t[i.mark]) t[i.mark] = i.at; await kv.set(K(cx, 'timings'), t); return t;
}
