// Turns any provider's JSON into research rows. Providers (treg's routed children, Firecrawl, Apify,
// Graph ads_archive) all shape rows differently, so this finds the row array and reads fields by alias.
const pick = (o, paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    if (v != null && v !== '') return v;
  }
  return null;
};
const asText = v => Array.isArray(v) ? v.filter(Boolean).map(asText).join(' ') : v && typeof v === 'object' ? (v.text || v.body || '') : v == null ? '' : String(v);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return isNaN(d) ? null : d.toISOString();
};
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const ROWISH = o => o && typeof o === 'object' && !Array.isArray(o) &&
  ['title', 'text', 'full_text', 'selftext', 'body', 'caption', 'description', 'url', 'permalink', 'ad_creative_bodies', 'page_name', 'snippet', 'content', 'markdown'].some(k => k in o || (o.legacy && k in o.legacy));

/** Depth-first search for the largest array of row-like objects. */
export function findRows(body, depth = 0) {
  if (!body || typeof body !== 'object' || depth > 6) return [];
  if (Array.isArray(body)) {
    if (body.some(ROWISH)) return body;
    let best = [];
    for (const x of body.slice(0, 5)) { const r = findRows(x, depth + 1); if (r.length > best.length) best = r; }
    return best;
  }
  let best = [];
  for (const v of Object.values(body)) { const r = findRows(v, depth + 1); if (r.length > best.length) best = r; }
  return best;
}

function mapRow(source, o) {
  const L = o.legacy || {};
  const rawUrl = String(pick(o, ['url', 'link', 'post_url', 'tweet_url', 'permalink', 'postUrl', 'sourceURL']) || '');
  const fromUrl = source === 'x' ? (rawUrl.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status/) || [])[1]
    : source === 'instagram' ? [(rawUrl.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})\//) || [])[1]].filter(n => n && !/^(p|reel|reels|tv|explore|stories|popular)$/i.test(n))[0] : null;
  const author = asText(pick(o, ['author', 'username', 'screen_name', 'user.screen_name', 'user.username', 'owner.username', 'core.user_results.result.legacy.screen_name', 'author.username', 'page_name', 'ownerUsername', 'user_name']) || fromUrl || '');
  const id = String(pick(o, ['id_str', 'rest_id', 'id', 'code', 'shortcode', 'post_id', 'tweet_id']) || L.id_str || '');
  let url = pick(o, [...(source === 'reddit' ? ['permalink'] : []), 'url', 'link', 'post_url', 'tweet_url', 'permalink', 'ad_snapshot_url', 'postUrl', 'sourceURL', 'metadata.sourceURL']);
  if (typeof url !== 'string') url = null;
  if (url && url.startsWith('/r/')) url = 'https://www.reddit.com' + url;
  if (!url && source === 'x' && author && id) url = `https://x.com/${author.replace(/^@/, '')}/status/${id}`;
  if (!url && source === 'instagram' && pick(o, ['code', 'shortcode'])) url = `https://www.instagram.com/p/${pick(o, ['code', 'shortcode'])}/`;
  if (!url && source === 'reddit' && id && o.subreddit) url = `https://www.reddit.com/r/${o.subreddit}/comments/${id}/`;
  const title = asText(pick(o, ['title', 'ad_creative_link_titles', 'headline', 'name']));
  const text = asText(pick(o, ['selftext', 'full_text', 'text', 'ad_creative_bodies', 'caption', 'body', 'content', 'description', 'snippet', 'markdown']) || L.full_text);
  const sub = pick(o, ['subreddit', 'subreddit_name_prefixed']) || (source === 'reddit' ? (rawUrl.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/) || [])[1] : null);
  const where = source === 'reddit' && sub ? 'r/' + String(sub).replace(/^r\//, '')
    : source === 'meta_ads' ? author
    : author ? '@' + author.replace(/^@/, '')
    : url && URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, '') : source;
  return {
    source, id: id || url || title, url: url || null, author: author || null, where,
    title: clip(title || text, 160), text: clip(text && text !== title ? text : '', 900),
    score: num(pick(o, ['score', 'ups', 'like_count', 'favorite_count', 'likes', 'likesCount', 'likeCount', 'edge_liked_by.count']) ?? L.favorite_count),
    comments: num(pick(o, ['num_comments', 'reply_count', 'comment_count', 'commentsCount', 'comments', 'replyCount', 'edge_media_to_comment.count']) ?? L.reply_count),
    created: iso(pick(o, ['created_utc', 'created_at', 'taken_at', 'timestamp', 'date', 'ad_delivery_start_time', 'createdAt', 'publishedAt']) ?? L.created_at),
    ...(source === 'meta_ads' ? { started: pick(o, ['ad_delivery_start_time', 'startDate', 'start_date']) || null, platforms: pick(o, ['publisher_platforms', 'publisherPlatform']) || [], snapshot: pick(o, ['ad_snapshot_url', 'snapshotUrl']) || null, pageId: pick(o, ['page_id', 'pageId']) || null } : {}),
  };
}

export function normalizeItems(source, body, { max = 25 } = {}) {
  const rows = findRows(body);
  const out = [], seen = new Set();
  for (const o of rows) {
    if (!ROWISH(o)) continue;
    const r = mapRow(source, o);
    if (!r.title && !r.text) continue;
    const key = r.url || r.title;
    if (seen.has(key)) continue;
    seen.add(key); out.push(r);
    if (out.length >= max) break;
  }
  return out;
}
