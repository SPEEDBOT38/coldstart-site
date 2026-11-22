// Source adapters for the Social Intelligence pipeline.
// X: official API v2 — GET /2/tweets/search/recent and GET /2/tweets/counts/recent (Bearer app token, X_BEARER_TOKEN; paid access). Coded from the official docs; NOT live-verified.
// Reddit: no automated retrieval. Reddit's Developer Terms require approval for commercial use, so the only paths are (a) user-supplied threads (assisted mode) and
//         (b) the official API after written approval (REDDIT_COMMERCIAL_APPROVED=1 plus credentials, not implemented here).
import { requestJson } from '../plugins/http.js';

const X_COST = { perPostRead: Number(process.env.X_COST_PER_POST_USD) || null };      // price must come from the account's current X plan; never guessed
export const xSource = {
  id: 'x.recent_search', platform: 'x', integration: 'mock_only',
  status: () => process.env.X_API_ENABLED !== '1' ? { state: 'requires_approval', integration: 'not_implemented', reason: 'Automated X research is switched off (the paid X API is out of scope). Use the manual X post workflow.' } : process.env.X_BEARER_TOKEN ? { state: 'ready', integration: 'mock_only', reason: 'Coded against the official API; no live call has been verified.' } : { state: 'requires_credentials', integration: 'requires_credentials', reason: 'Set X_BEARER_TOKEN (paid X API access).' },
  eligibility: () => ({ allowed: true, reason: 'Posting needs a connected X account and per-post approval.', rules: 'X Rules and Automation Rules apply' }),
  async search(q, { since, limit = 20, pages = 2, fetch: f = globalThis.fetch }) {
    const per = Math.min(100, Math.max(10, limit)), items = []; let next, usd = 0;
    for (let page = 0; page < Math.max(1, Math.min(pages, 3)); page++) {   // bounded paging via next_token (official pagination)
      const p = new URLSearchParams({ query: `${q} -is:retweet -is:reply lang:en`, max_results: String(per), start_time: since, 'tweet.fields': 'created_at,public_metrics,lang,author_id,geo', expansions: 'author_id,geo.place_id', 'place.fields': 'full_name,country_code,country' });
      if (next) p.set('next_token', next);
      const j = await requestJson(f, 'https://api.x.com/2/tweets/search/recent?' + p, { headers: { authorization: 'Bearer ' + process.env.X_BEARER_TOKEN }, timeout: 20000 });
      const places = Object.fromEntries((j.includes?.places || []).map(pl => [pl.id, pl]));
      for (const t of j.data || []) items.push({ id: t.id, url: 'https://x.com/i/web/status/' + t.id, text: t.text, createdAt: t.created_at, author: t.author_id, lang: t.lang, engagement: t.public_metrics || null, geo: t.geo?.place_id && places[t.geo.place_id] ? { country: places[t.geo.place_id].country_code, name: places[t.geo.place_id].full_name } : null });
      next = j.meta?.next_token; if (!next) break;
    }
    return { items: items.slice(0, per * pages), usd: X_COST.perPostRead === null ? 0 : items.length * X_COST.perPostRead, usdReported: X_COST.perPostRead !== null };
  },
  /** Counts per equal window ending now, oldest first: the baseline for trend detection (official counts endpoint, day granularity summed into windows). */
  async counts(q, { windows = 4, windowDays = 7, now = Date.now(), fetch: f = globalThis.fetch }) {
    const start = new Date(now - windows * windowDays * 864e5).toISOString();
    const p = new URLSearchParams({ query: `${q} -is:retweet lang:en`, granularity: 'day', start_time: start, end_time: new Date(now - 15e3).toISOString() });
    const j = await requestJson(f, 'https://api.x.com/2/tweets/counts/recent?' + p, { headers: { authorization: 'Bearer ' + process.env.X_BEARER_TOKEN }, timeout: 20000 });
    const days = (j.data || []).map(d => d.tweet_count), out = []; for (let i = 0; i < windows; i++) out.push(days.slice(i * windowDays, (i + 1) * windowDays).reduce((a, n) => a + n, 0));
    return { windows: out, usd: 0 };
  },
};
export const redditSource = {
  id: 'reddit.assisted', platform: 'reddit', integration: 'requires_approval',
  status: () => ({ state: 'requires_approval', integration: 'requires_approval', reason: 'Reddit commercial data access needs Reddit’s written approval. Paste threads you found yourself to use Assisted mode.' }),
  eligibility: () => ({ allowed: false, reason: 'Automated posting is not approved. Draft here and post manually, only where the subreddit’s rules allow.', rules: 'Check each subreddit’s rules and self-promotion limits' }),
  async search() { throw new Error('Reddit retrieval is not enabled.'); },
};
export const SOURCES = [xSource, redditSource];

/** Assisted Reddit: the user supplies a thread (URL + the text they read). Nothing is fetched. Returned as evidence the pipeline can score. */
export function manualItem({ url, title, text, subreddit, createdAt }) {
  const u = new URL(url); if (!/(^|\.)reddit\.com$/.test(u.hostname) && !/^redd\.it$/.test(u.hostname)) throw Object.assign(new Error('Only reddit.com links.'), { status: 400 });
  return { id: 'manual:' + u.pathname, url: u.origin + u.pathname, title: String(title || '').slice(0, 300), text: String(text || '').slice(0, 3000), createdAt: createdAt || new Date().toISOString(), author: null, lang: null, subreddit: subreddit || null, manual: true };
}
