// Where each research source comes from, best first (MetaCroc's "best evidence first" rule).
// Every provider's rows go through cleanRows (post-only URLs, canonical, deduped). Providers are tried in order
// and their rows MERGED until there are enough; a provider that errors or returns nothing is recorded and skipped,
// never fatal. A transient failure (timeout, 429, 5xx) is retried once. Nothing is ever invented.
import { tregCall, hasTreg } from '../../treg.js';
import { requestJson } from '../http.js';
import { normalizeItems } from './normalize.js';
import { cleanRows, queryTerms, overlap } from './verify.js';

const hasFirecrawl = () => !!process.env.FIRECRAWL_API_KEY;

async function firecrawl(fetchImpl, filter, query, limit = 15) {
  const j = await requestJson(fetchImpl, 'https://api.firecrawl.dev/v2/search', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.FIRECRAWL_API_KEY },
    json: { query: `${filter} ${query}`, limit, tbs: 'qdr:y' }, timeout: 25000 });
  return { data: j, usd: 0.0016 * Math.ceil(limit / 10) };   // Firecrawl search ≈ 2 credits per 10 results
}
const hashtagOf = q => q.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 3).join('');

// The filters ask the search engine for single posts only; cleanRows enforces it anyway.
export const SOURCES = {
  reddit: [
    { id: 'treg:anyapi.reddit.search', ready: hasTreg, run: (f, q) => tregCall(f, 'anyapi.reddit.search', { body: { query: q, sort: 'relevance', timeframe: 'year' } }) },
    { id: 'firecrawl', ready: hasFirecrawl, run: (f, q) => firecrawl(f, 'site:reddit.com inurl:comments', q) },
  ],
  x: [
    { id: 'treg:treg.x.search.posts', ready: hasTreg, run: (f, q) => tregCall(f, 'treg.x.search.posts', { body: { q } }) },
    { id: 'firecrawl', ready: hasFirecrawl, run: (f, q) => firecrawl(f, 'site:x.com inurl:status', q) },
  ],
  instagram: [
    { id: 'treg:treg.instagram.hashtag.posts', ready: hasTreg, run: (f, q) => tregCall(f, 'treg.instagram.hashtag.posts', { body: { hashtag: hashtagOf(q) } }) },
    { id: 'firecrawl', ready: hasFirecrawl, run: (f, q) => firecrawl(f, 'site:instagram.com/p', q) },
    { id: 'firecrawl:reels', ready: hasFirecrawl, run: (f, q) => firecrawl(f, 'site:instagram.com/reel', q, 10) },
  ],
  meta_ads: [
    { id: 'treg:meta-ad-library', ready: hasTreg, run: (f, q, o) => tregCall(f, 'meta-ad-library.meta-ads.library.search', { method: 'GET', query: {
      search_terms: q.slice(0, 100), ad_reached_countries: JSON.stringify([o.country || 'US']), ad_active_status: 'ACTIVE', limit: '40',
      fields: 'id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_snapshot_url,ad_delivery_start_time,publisher_platforms' } }) },
  ],
};
export const SETUP_HINT = { reddit: 'TREG_TOKEN or FIRECRAWL_API_KEY', x: 'TREG_TOKEN or FIRECRAWL_API_KEY', instagram: 'TREG_TOKEN or FIRECRAWL_API_KEY', meta_ads: 'APIFY_TOKEN or TREG_TOKEN' };
const transient = e => e.status === 429 || e.status >= 500 || /timed? ?out|abort|ECONN|network/i.test(e.message || '');

/** {status, provider, items, usd, tried, dropped}: rows from every useful provider, merged until `enough`. */
export async function fetchSource(fetchImpl, source, query, { max = 12, enough = 8, country } = {}) {
  const chain = (SOURCES[source] || []).filter(p => p.ready());
  if (!chain.length) return { status: 'needs_setup', error: 'Set ' + SETUP_HINT[source] + ' on the server.', items: [], usd: 0, tried: [], dropped: { notPost: 0, duplicate: 0 } };
  const tried = [], items = [], seen = new Set(), dropped = { notPost: 0, duplicate: 0 }, used = [];
  let usd = 0;
  const terms = queryTerms(query);
  const relevance = it => source === 'meta_ads' ? 1 : overlap(it, terms);
  for (const p of chain) {
    if (items.filter(it => relevance(it) > 0).length >= Math.min(enough, max)) break;
    let r = null, err = null;
    for (let a = 0; a < 2 && !r; a++) {
      try { r = await p.run(fetchImpl, query, { country }); }
      catch (e) { err = e; if (!transient(e) || a) break; }
    }
    if (!r) { tried.push({ provider: p.id, error: err.message }); if (err.status === 402) tried.at(-1).error += ' (out of credits)'; continue; }
    usd += r.usd || 0;
    const raw = normalizeItems(source, r.data, { max: 40 });
    const c = cleanRows(source, raw, seen);
    dropped.notPost += c.dropped.notPost; dropped.duplicate += c.dropped.duplicate;
    tried.push({ provider: p.id, rows: raw.length, kept: c.items.length });
    if (c.items.length) { used.push(p.id + (r.servedBy ? ' → ' + r.servedBy : '')); items.push(...c.items.map(it => ({ ...it, provider: p.id }))); }
  }
  // Rank candidates before truncation, but leave the final relevance check to verified text.
  const out = items.sort((a, b) => relevance(b) - relevance(a)).slice(0, max);
  if (out.length) return { status: 'ok', provider: used.join(' + '), items: out, usd, tried, dropped };
  const errs = tried.filter(t => t.error);
  return { status: errs.length === tried.length ? 'error' : 'empty', error: errs.length === tried.length ? errs.map(t => t.provider + ': ' + t.error).join('; ') : 'No posts for this query.', items: [], usd, tried, dropped };
}
