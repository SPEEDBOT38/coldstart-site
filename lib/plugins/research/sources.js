// Where each research source comes from, best first. A provider is tried only when its key exists;
// the first one that returns rows wins. Nothing is ever invented when all of them are missing.
import { tregCall, hasTreg } from '../../treg.js';
import { requestJson } from '../http.js';
import { normalizeItems } from './normalize.js';

const hasFirecrawl = () => !!process.env.FIRECRAWL_API_KEY;

async function firecrawl(fetchImpl, site, query) {
  const j = await requestJson(fetchImpl, 'https://api.firecrawl.dev/v2/search', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.FIRECRAWL_API_KEY },
    json: { query: `site:${site} ${query}`, limit: 12, tbs: 'qdr:y' }, timeout: 25000 });
  return { data: j, usd: 0.0016 };   // Firecrawl search: ~2 credits per 10 results on the standard plan
}
const hashtagOf = q => q.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 3).join('');

export const SOURCES = {
  reddit: [
    { id: 'treg:anyapi.reddit.search', ready: hasTreg, run: (f, q) => tregCall(f, 'anyapi.reddit.search', { body: { query: q, sort: 'relevance', timeframe: 'year' } }) },
    { id: 'firecrawl', ready: hasFirecrawl, run: (f, q) => firecrawl(f, 'reddit.com', q) },
  ],
  x: [
    { id: 'treg:treg.x.search.posts', ready: hasTreg, run: (f, q) => tregCall(f, 'treg.x.search.posts', { body: { q } }) },
    { id: 'firecrawl', ready: hasFirecrawl, run: (f, q) => firecrawl(f, 'x.com', q) },
  ],
  instagram: [
    { id: 'treg:treg.instagram.hashtag.posts', ready: hasTreg, run: (f, q) => tregCall(f, 'treg.instagram.hashtag.posts', { body: { hashtag: hashtagOf(q) } }) },
    { id: 'firecrawl', ready: hasFirecrawl, run: (f, q) => firecrawl(f, 'instagram.com', q) },
  ],
  meta_ads: [
    { id: 'treg:meta-ad-library', ready: hasTreg, run: (f, q, o) => tregCall(f, 'meta-ad-library.meta-ads.library.search', { method: 'GET', query: {
      search_terms: q.slice(0, 100), ad_reached_countries: JSON.stringify([o.country || 'US']), ad_active_status: 'ACTIVE', limit: '40',
      fields: 'id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_snapshot_url,ad_delivery_start_time,publisher_platforms' } }) },
  ],
};
export const SETUP_HINT = { reddit: 'TREG_TOKEN or FIRECRAWL_API_KEY', x: 'TREG_TOKEN or FIRECRAWL_API_KEY', instagram: 'TREG_TOKEN or FIRECRAWL_API_KEY', meta_ads: 'TREG_TOKEN (or APIFY_TOKEN for the async pull)' };

export async function fetchSource(fetchImpl, source, query, opts = {}) {
  const chain = (SOURCES[source] || []).filter(p => p.ready());
  if (!chain.length) return { status: 'needs_setup', error: 'Set ' + SETUP_HINT[source] + ' on the server.', items: [], usd: 0, tried: [] };
  const tried = []; let usd = 0;
  for (const p of chain) {
    try {
      const r = await p.run(fetchImpl, query, opts);
      usd += r.usd || 0;
      const items = normalizeItems(source, r.data, { max: opts.max || 15 });
      tried.push({ provider: p.id, rows: items.length });
      if (items.length) return { status: 'ok', provider: p.id + (r.servedBy ? ' → ' + r.servedBy : ''), items, usd, tried };
    } catch (e) { tried.push({ provider: p.id, error: e.message }); if (e.status === 402) break; }
  }
  const last = tried.at(-1);
  return { status: last?.error ? 'error' : 'empty', error: last?.error || 'No results for this query.', items: [], usd, tried };
}
