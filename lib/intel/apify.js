// Apify pulls for the insights pipeline. Both are start-then-poll so no single request waits for a run:
//   - Instagram posts (apify/instagram-post-scraper): the founder's own captions and profile, which voice the ICPs and ads
//   - Meta Ad Library (curious_coder/facebook-ads-library-scraper): each competitor's live ads, matched strictly by page name
// Ported from MetaCroc lib/instagram.js and lib/apify.js. Keys: APIFY_TOKEN (server only, never sent to the browser).
import { str, normName, daysSince } from './util.js';

const API = 'https://api.apify.com/v2';
const IG_ACTOR = 'apify~instagram-post-scraper';
const AD_ACTOR = 'curious_coder~facebook-ads-library-scraper';
export const IG_POSTS = 12;
export const ADS_PER_COMPETITOR = 15;
const PULL_PER_SOURCE = 30;

export const hasApify = () => !!(process.env.APIFY_TOKEN || '').trim();

async function apify(path, { method = 'GET', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const r = await fetch(API + path + qs, {
    method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { authorization: 'Bearer ' + process.env.APIFY_TOKEN, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (_) { j = null; }
  if (!r.ok) throw new Error('Apify ' + r.status + ': ' + str((j && j.error && j.error.message) || text, 140));
  return j;
}

// "@glow.co", "glow.co", "instagram.com/glow.co/" -> "glow.co"
export function igHandle(s) {
  const t = String(s || '').trim();
  const url = t.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  if (url) return url[1].toLowerCase();
  const at = t.match(/^@?([A-Za-z0-9._]{1,30})$/);
  return at ? at[1].toLowerCase() : null;
}

export async function startIgPull(handle) {
  const j = await apify('/acts/' + IG_ACTOR + '/runs', { method: 'POST', query: { timeout: '140' },
    body: { username: [handle], resultsLimit: IG_POSTS, skipPinnedPosts: true, dataDetailLevel: 'basicData' } });
  return { runId: j.data.id, datasetId: j.data.defaultDatasetId, startedAt: Date.now() };
}

// The brand's own posts, normalised. A failed handle comes back as an {error} row and is dropped.
export function normalizePost(it, handle) {
  if (!it || it.error || !(it.shortCode || it.id)) return null;
  return {
    id: String(it.shortCode || it.id),
    handle: String(it.ownerUsername || handle || '').toLowerCase(),
    caption: str(it.caption, 1200),
    image_url: it.displayUrl || null,
    url: it.url || null,
    likes: Number.isFinite(Number(it.likesCount)) ? Number(it.likesCount) : null,
    comments: Number.isFinite(Number(it.commentsCount)) ? Number(it.commentsCount) : null,
    posted_at: it.timestamp || null,
  };
}

// One Ad Library job per competitor (a shared run would let the first brand use up the result cap). Two sources each:
// its likely Facebook page (slug guessed from the name) and a keyword search. Matching in assignToCompetitors accepts the
// page name or a slug that extends the name ("Plum" -> "Plum Goodness").
export async function startAdPull(name, country) {
  const slug = normName(name);
  const urls = [
    ...(slug.length >= 2 && slug.length <= 80 ? [{ url: 'https://www.facebook.com/' + slug }] : []),
    { url: 'https://www.facebook.com/ads/library/?' + new URLSearchParams({ active_status: 'active', ad_type: 'all', country, q: name, search_type: 'keyword_unordered' }) },
  ];
  const j = await apify('/acts/' + AD_ACTOR + '/runs', { method: 'POST', query: { timeout: '170', memory: '512', maxTotalChargeUsd: '0.3' },
    body: { urls, count: PULL_PER_SOURCE * urls.length, limitPerSource: PULL_PER_SOURCE, scrapeAdDetails: false,
      'scrapePageAds.activeStatus': 'active', 'scrapePageAds.countryCode': country, 'scrapePageAds.sortBy': 'impressions_desc' } });
  return { runId: j.data.id, datasetId: j.data.defaultDatasetId, startedAt: Date.now() };
}

// Start/poll for either actor: status is RUNNING, SUCCEEDED or a failure state.
export async function pollRun(runId) {
  const j = await apify('/actor-runs/' + runId);
  const d = (j && j.data) || {};
  return { status: d.status || 'UNKNOWN', usd: d.usageTotalUsd != null ? Number(d.usageTotalUsd) : null, datasetId: d.defaultDatasetId };
}

export async function fetchItems(datasetId, limit = 600) {
  const j = await apify('/datasets/' + datasetId + '/items', { query: { clean: 'true', format: 'json', limit: String(limit) } });
  return Array.isArray(j) ? j : [];
}

function firstImage(s) {
  const img = (s.images || [])[0];
  if (img) return img.resized_image_url || img.original_image_url || img.url;
  const card = (s.cards || []).find(c => c.resized_image_url || c.original_image_url || c.video_preview_image_url);
  if (card) return card.resized_image_url || card.original_image_url || card.video_preview_image_url;
  const vid = (s.videos || [])[0];
  return vid ? vid.video_preview_image_url : null;
}

const cleanTemplate = t => str(t, 1500).replace(/\{\{[^}]+\}\}/g, '').trim();

function toDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const n = Number(v);
  if (isFinite(n) && String(v).length >= 9) return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  const t = new Date(v);
  return isFinite(t.getTime()) ? t.toISOString() : null;
}

export function normalizeAd(it) {
  const s = it.snapshot || {};
  const card0 = (s.cards || [])[0] || {};
  const archive = String(it.ad_archive_id || it.adArchiveID || it.adArchiveId || it.id || '');
  const fmt = String(s.display_format || it.display_format || (s.videos && s.videos.length ? 'VIDEO' : (s.cards && s.cards.length > 1 ? 'CAROUSEL' : 'IMAGE'))).toUpperCase();
  const start = toDate(it.start_date != null ? it.start_date : (it.startDate || it.start_date_formatted));
  return {
    id: archive ? 'fb-' + archive : null,
    archive_id: archive,
    page_id: String(it.page_id || s.page_id || ''),
    page_name: str(it.page_name || s.page_name || '', 120),
    body: cleanTemplate((s.body && (s.body.text || (s.body.markup && s.body.markup.__html))) || card0.body || it.ad_creative_body || ''),
    headline: cleanTemplate(s.title || card0.title || it.ad_creative_link_title || ''),
    description: cleanTemplate(s.link_description || card0.link_description || it.ad_creative_link_description || ''),
    cta: str(s.cta_text || card0.cta_text || '', 40),
    link_url: str(s.link_url || card0.link_url || '', 500),
    image_url: firstImage(s),
    display_format: fmt,
    platforms: it.publisher_platform || it.publisher_platforms || [],
    start_date: start,
    days_running: daysSince(start),
    collation_count: Number(it.collation_count || 1) || 1,
    ad_library_url: it.ad_library_url || (archive ? 'https://www.facebook.com/ads/library/?id=' + archive : null),
  };
}

// Strict matching: an ad counts for a competitor only if its advertiser page name is that competitor. Search results
// hold ads from every page that mentions a word; a wrong brand under the right name is worse than "not found".
export function assignToCompetitors(items, competitors) {
  const out = new Map(competitors.map(c => [c.name, []]));
  const seen = new Set();
  for (const it of items) {
    const a = normalizeAd(it);
    if (!a.id || seen.has(a.id) || !a.body && !a.headline && !a.image_url) continue;
    seen.add(a.id);
    const key = normName(a.page_name), slug = normName(a.page_uri);
    const comp = competitors.find(c => {
      const n = normName(c.name);
      const same = key === n || (slug && slug === n);
      const extends_ = key.startsWith(n) && key.length - n.length <= 12;
      return same || extends_;
    });
    if (comp) out.get(comp.name).push(a);
  }
  for (const [name, ads] of out) out.set(name, ads.sort((x, y) => (y.days_running || 0) - (x.days_running || 0)).slice(0, ADS_PER_COMPETITOR));
  return out;
}
