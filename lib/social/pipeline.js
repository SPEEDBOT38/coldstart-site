// Shared Social Intelligence pipeline:
// Brand profile → keywords → platform searches → evidence → dedupe → topic clusters → trend detection → regional relevance → scoring → opportunities.
// Pure stages (no I/O) are exported for testing; `runPipeline` wires them to source adapters. Reused: `stopword` (MIT) for tokenising. Everything else is domain glue.
import { removeStopwords, eng } from 'stopword';
import { sha256 } from '../ops/kv.js';

const tok = s => removeStopwords(String(s).toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length > 2), eng);
const uniq = a => [...new Set(a)];

/** 1. Brand profile → a bounded set of search queries (never user-written Boolean strings). */
export function buildKeywords(brand, { maxQueries = 4 } = {}) {
  const terms = uniq([...(brand.products || []).map(String), brand.category, ...(brand.keywords || [])].filter(Boolean).map(s => s.toLowerCase().trim())).slice(0, 12);
  const intents = ['recommend', 'looking for', 'best'];
  const qs = []; for (const t of terms) { qs.push({ q: t, kind: 'topic' }); if (qs.length >= maxQueries) break; }
  if (terms[0] && qs.length < maxQueries) qs.push({ q: `${intents[0]} ${terms[0]}`, kind: 'intent' });
  return { terms, queries: qs.slice(0, maxQueries), brandTerms: uniq(terms.flatMap(tok)) };
}
const canon = u => { try { const x = new URL(u); x.hash = ''; ['utm_source', 'utm_medium', 'utm_campaign', 's', 't', 'ref'].forEach(k => x.searchParams.delete(k)); return (x.hostname.replace(/^www\.|^mobile\./, '') + x.pathname.replace(/\/$/, '') + x.search).toLowerCase(); } catch { return String(u).toLowerCase(); } };
/** 4. Dedupe by canonical URL, then by near-identical text (Jaccard ≥ .85 over token sets). */
export function dedupe(items) {
  const seen = new Map(), out = [], sets = [];
  for (const it of items) {
    const key = canon(it.url); if (seen.has(key)) { seen.get(key).seenIn.push(it.query); continue; }
    const ts = new Set(tok(it.text)); let dup = false;
    for (const s of sets) { const i = [...ts].filter(x => s.has(x)).length, u = new Set([...ts, ...s]).size; if (u && i / u >= 0.85) { dup = true; break; } }
    if (dup) continue; seen.set(key, it); sets.push(ts); it.seenIn = [it.query]; out.push(it);
  }
  return out;
}
/** 5. Greedy topic clustering on token overlap; labels are the cluster's most frequent terms. */
export function cluster(items, { threshold = 0.2 } = {}) {
  const cs = [];
  for (const it of items) {
    const t = new Set(tok(it.text + ' ' + (it.title || ''))); let best = null, bs = 0;
    for (const c of cs) { const i = [...t].filter(x => c.terms.has(x)).length, u = new Set([...t, ...c.terms]).size, j = u ? i / u : 0; if (j > bs) { bs = j; best = c; } }
    if (best && bs >= threshold) { best.items.push(it); t.forEach(x => best.terms.add(x)); best.freq = best.freq; t.forEach(x => best.freq[x] = (best.freq[x] || 0) + 1); }
    else { const freq = {}; t.forEach(x => freq[x] = 1); cs.push({ terms: new Set(t), items: [it], freq }); }
  }
  return cs.map((c, i) => ({ id: 'cl' + i, label: Object.entries(c.freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]).join(' '), items: c.items, authors: uniq(c.items.map(x => x.author).filter(Boolean)).length }));
}
/** 6. Trend = comparison of a recent window with prior baseline windows of equal length. A single popular post is never a trend. */
export function detectTrend({ current, baseline, minCurrent = 20, minBaselineWindows = 3, risingRatio = 1.5, decliningRatio = 0.67, distinctAuthors = null }) {
  const b = (baseline || []).filter(n => Number.isFinite(n));
  if (!Number.isFinite(current) || b.length < minBaselineWindows) return { label: 'insufficient_data', reason: `Needs ${minBaselineWindows} comparable baseline windows (got ${b.length}).`, ratio: null };
  if (distinctAuthors !== null && distinctAuthors < 3) return { label: 'insufficient_data', reason: 'Fewer than 3 distinct authors: this is one conversation, not a trend.', ratio: null };
  const mean = b.reduce((a, x) => a + x, 0) / b.length;
  if (current < minCurrent && mean < minCurrent) return { label: 'insufficient_data', reason: `Volume too low to judge (current ${current}, baseline mean ${mean.toFixed(1)}; minimum ${minCurrent}).`, ratio: null };
  const ratio = mean === 0 ? Infinity : current / mean;
  return { label: ratio >= risingRatio ? 'rising' : ratio <= decliningRatio ? 'declining' : 'steady', ratio: Number.isFinite(ratio) ? +ratio.toFixed(2) : null, current, baselineMean: +mean.toFixed(1), reason: `${current} in the latest window vs ${mean.toFixed(1)} average over ${b.length} prior windows.` };
}
/** 7. Region: 'confirmed' only when the platform returned a geo field; 'inferred' when text names the market; otherwise 'unknown' (never treated as local). */
export function regionOf(item, market = {}) {
  const want = (market.places || []).map(s => s.toLowerCase()), cc = (market.countryCodes || []).map(s => s.toUpperCase());
  if (item.geo && item.geo.country && cc.includes(String(item.geo.country).toUpperCase())) return { basis: 'confirmed', match: true, evidence: 'Platform geo field: ' + item.geo.country };
  const text = (item.text + ' ' + (item.title || '')).toLowerCase(), hit = want.find(p => text.includes(p));
  if (hit) return { basis: 'inferred', match: true, evidence: `Text mentions "${hit}". Not a confirmed location.` };
  return { basis: 'unknown', match: false, evidence: 'No location evidence.' };
}
const INTENT = [/\b(looking for|any recommendations?|recommend(ations)?|which (one|brand)|anyone (know|tried|use)|best\b.*\bfor\b|where (can|do) i (buy|find|get)|how (do|can) i|suggest)/i, /\?\s*$/m];
/** 8. Opportunity scoring. Eligibility is a HARD GATE, not a weight. Weights (handoff): fit .30, intent .25, freshness .15, geo .10, novelty .05 over the non-gate remainder. */
export function scoreItem(item, { brandTerms, trend, region, eligibility, now = Date.now(), seenBefore = false }) {
  const t = new Set(tok(item.text + ' ' + (item.title || ''))), fit = brandTerms.length ? Math.min(1, [...t].filter(x => brandTerms.includes(x)).length / Math.max(2, Math.min(brandTerms.length, 4))) : 0;
  const intent = INTENT.some(r => r.test(item.text + ' ' + (item.title || ''))) ? 1 : 0;
  const ageDays = Math.max(0, (now - Date.parse(item.createdAt)) / 864e5), freshness = Number.isFinite(ageDays) ? Math.max(0, 1 - ageDays / 14) : 0;
  const geo = region.basis === 'confirmed' ? 1 : region.basis === 'inferred' ? 0.5 : 0, novelty = seenBefore ? 0 : 1;
  const parts = { audience_fit: fit, intent, freshness, geo_evidence: geo, novelty };
  const raw = (0.30 * fit + 0.25 * intent + 0.15 * freshness + 0.10 * geo + 0.05 * novelty) / 0.85;
  if (!eligibility.allowed) return { score: null, gated: true, gate_reason: eligibility.reason, parts };
  const type = intent && fit >= 0.5 ? 'participate' : trend && trend.label === 'rising' && fit >= 0.5 ? 'create_content' : fit >= 0.5 ? 'monitor' : 'discussion_only';
  return { score: +raw.toFixed(3), gated: false, parts, opportunity_type: type };
}
/** Why this was surfaced, in plain words, from the actual signals. */
export const explain = (item, s, trend, region) => [s.parts.audience_fit >= 0.5 ? 'It uses your product terms.' : 'Only loosely related to your product terms.', s.parts.intent ? 'The author is asking for help or a recommendation.' : 'It is a discussion, not a request.',
  trend && trend.label !== 'insufficient_data' ? `Topic volume is ${trend.label} (${trend.reason})` : 'Not enough history to call this a trend.', region.basis === 'confirmed' ? 'Location confirmed by the platform.' : region.basis === 'inferred' ? 'Location inferred from the text.' : 'Location unknown.'].join(' ');

/** Full pipeline. `sources` are adapters: { id, platform, status(), search(q,{since}), counts?(q,{windows}), eligibility(item) }. Cost is the sum of adapter-reported USD. */
export async function runPipeline({ brand, market = {}, sources, windowDays = 7, maxQueries = 4, maxPerQuery = 20, now = Date.now(), known = new Set(), fetch }) {
  const kw = buildKeywords(brand, { maxQueries }), evidence = [], blocked = [], trends = {}; let usd = 0, calls = 0;
  const since = new Date(now - windowDays * 864e5).toISOString();
  for (const src of sources) {
    const st = src.status(); if (st.state !== 'ready') { blocked.push({ source: src.id, platform: src.platform, ...st }); continue; }
    for (const q of kw.queries) {
      try {
        const r = await src.search(q.q, { since, limit: maxPerQuery, fetch }); calls++; usd += r.usd || 0;
        for (const it of r.items) evidence.push({ ...it, platform: src.platform, source: src.id, query: q.q, queryKind: q.kind, retrievedAt: new Date(now).toISOString() });
        if (src.counts) { const c = await src.counts(q.q, { windows: 4, windowDays, now, fetch }); calls++; usd += c.usd || 0; trends[src.platform + '|' + q.q] = detectTrend({ current: c.windows[c.windows.length - 1], baseline: c.windows.slice(0, -1) }); trends[src.platform + '|' + q.q].basis = 'platform_counts'; }
      } catch (e) { blocked.push({ source: src.id, platform: src.platform, state: 'error', reason: String(e.message).slice(0, 160), query: q.q }); }
    }
  }
  const unique = dedupe(evidence), clusters = cluster(unique), opps = [];
  for (const c of clusters) for (const it of c.items) {
    const src = sources.find(s => s.id === it.source), trend = trends[it.platform + '|' + it.query] || { label: 'insufficient_data', reason: 'No baseline counts for this source.' }, region = regionOf(it, market);
    const elig = src.eligibility(it), id = 'op_' + sha256(canon(it.url)).slice(0, 16), s = scoreItem(it, { brandTerms: kw.brandTerms, trend, region, eligibility: elig, now, seenBefore: known.has(id) });
    opps.push({ id, platform: it.platform, source_id: it.source, source_item_id: it.id, source_url: it.url, posted_at: it.createdAt, fetched_at: it.retrievedAt, author: it.author || null, title: it.title || null, excerpt: it.text.slice(0, 280),
      cluster: { id: c.id, label: c.label, size: c.items.length, distinct_authors: c.authors }, query: it.query, trend: { label: trend.label, ratio: trend.ratio ?? null, reason: trend.reason, basis: trend.basis || null },
      geo: { basis: region.basis, evidence: region.evidence, language: it.lang || null }, eligibility: elig, intent_score: s.parts.intent, relevance_score: +s.parts.audience_fit.toFixed(2), freshness_score: +s.parts.freshness.toFixed(2), score: s.score, gated: s.gated,
      opportunity_type: s.opportunity_type || 'blocked', explanation: explain(it, s, trend, region), confidence: region.basis === 'confirmed' && trend.label !== 'insufficient_data' ? 'high' : s.parts.audience_fit >= 0.5 ? 'medium' : 'low',
      engagement: it.engagement || null, channel_mode: 'organic', recommended_action: s.gated ? 'Use assisted mode: draft here, post it yourself if the community allows.' : s.opportunity_type === 'participate' ? 'Reply helpfully; disclose who you are.' : s.opportunity_type === 'create_content' ? 'Create an original post about this topic.' : 'Keep monitoring.', status: 'new', cost_units: { usd: 0, queries: 0 } });
  }
  opps.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { opportunities: opps, blocked, cost: { usd: +usd.toFixed(5), calls }, queries: kw.queries, counts: { evidence: evidence.length, unique: unique.length, clusters: clusters.length } };
}
