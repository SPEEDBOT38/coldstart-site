// Source correctness for research rows. Every row must be a real, single post on the platform it claims:
//   1. shape: Reddit /r/<sub>/comments/<id>, X /<user>/status/<id>, Instagram /p|reel|tv/<code>; profiles,
//      communities, hashtag and search pages are dropped (the "@EGGellerShoes profile as a post" bug)
//   2. canonical URL: one form per post, so the same post found twice (or with /photo/2, ?hl=ar) counts once
//   3. existence: Reddit posts are checked against Arctic Shift (real score, comments, date, author; removed or
//      deleted posts are dropped), X posts against X's public oEmbed (404 = deleted or private → dropped).
//      Instagram has no free checker: those rows stay labelled "search snippet, not verified".
//   4. relevance pre-filter: a row must share at least one meaningful word with the question.
const RESERVED_X = new Set(['i', 'home', 'search', 'explore', 'hashtag', 'intent', 'share', 'settings', 'notifications', 'messages']);
const STOP = new Set(['the', 'and', 'for', 'with', 'you', 'your', 'are', 'how', 'what', 'why', 'best', 'from', 'that', 'this', 'about', 'into', 'any', 'can', 'get', 'not', 'all', 'our', 'out']);

export function postShape(source, url) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, reason: 'not a link' }; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return { ok: false, reason: 'not a public post link' };
  const host = u.hostname.toLowerCase().replace(/^(www|old|new|m|np|mobile)\./, '');
  const p = u.pathname.replace(/\/+$/, '');
  if (source === 'reddit') {
    const m = host === 'reddit.com' && p.match(/^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{4,10})(?:\/[^/]+)?$/i);
    return m ? { ok: true, id: m[2].toLowerCase(), community: m[1], url: `https://www.reddit.com/r/${m[1]}/comments/${m[2].toLowerCase()}/` } : { ok: false, reason: 'not a Reddit post (community, profile or search page)' };
  }
  if (source === 'x') {
    const m = (host === 'x.com' || host === 'twitter.com') && p.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:\/(?:photo|video)\/[1-4])?$/);
    if (!m || RESERVED_X.has(m[1].toLowerCase())) return { ok: false, reason: 'not an X post (profile, search or hashtag page)' };
    return { ok: true, id: m[2], author: m[1], url: `https://x.com/${m[1]}/status/${m[2]}` };
  }
  if (source === 'instagram') {
    const m = host === 'instagram.com' && p.match(/^(?:\/(?!explore\/|stories\/|accounts\/)[A-Za-z0-9_.]{1,30})?\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})$/i);
    return m ? { ok: true, id: m[2], url: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/` } : { ok: false, reason: 'not an Instagram post (profile, hashtag or explore page)' };
  }
  return { ok: true, id: String(url), url: String(url) };
}

const stem = w => w.replace(/(ies)$/, 'y').replace(/(ing|es|s)$/, '');
const wordsOf = s => String(s || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
for (const w of 'a an as at be by do does did he if in is it me my of on or so to us we who which when where should could would try people they their have has looking want'.split(' ')) STOP.add(w);
export const queryTerms = q => [...new Set(wordsOf(q).filter(w => w.length >= 2 && !STOP.has(w)).map(stem))];
export function overlap(item, terms) {
  const words = new Set(wordsOf((item.title || '') + ' ' + (item.text || '')).map(stem));
  return terms.filter(t => words.has(t)).length;
}

/** Shape + canonical URL + dedupe. Returns {items, dropped:{notPost, duplicate}}. */
export function cleanRows(source, items, seen = new Set()) {
  const out = [], dropped = { notPost: 0, duplicate: 0 };
  for (const it of items) {
    const s = postShape(source, it.url);
    if (!s.ok) { dropped.notPost++; continue; }
    const key = source + ':' + s.id;
    if (seen.has(key)) { dropped.duplicate++; continue; }
    seen.add(key);
    out.push({ ...it, url: s.url, postId: s.id, ...(s.author && !it.author ? { author: s.author, where: '@' + s.author } : {}), ...(s.community ? { where: 'r/' + s.community } : {}) });
  }
  return { items: out, dropped };
}

const plain = html => String(html || '').replace(/<a [^>]*>(pic\.twitter\.com|https?:\/\/t\.co)[^<]*<\/a>/g, '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&mdash;.*$/s, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

async function verifyReddit(f, items) {
  if (!items.length) return { items, deleted: 0, unverified: 0, ok: true };
  const ids = items.map(i => i.postId).slice(0, 100);
  let byId;
  try {
    const r = await f(`https://arctic-shift.photon-reddit.com/api/posts/ids?ids=${ids.join(',')}&fields=id,title,score,num_comments,created_utc,subreddit,selftext,author`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    byId = new Map((await r.json()).data.map(p => [String(p.id).toLowerCase(), p]));
  } catch (e) {   // the checker is down: keep the rows, say they were not checked
    return { items: items.map(i => ({ ...i, verified: false, verifyNote: 'Reddit check unavailable (' + e.message + ')' })), deleted: 0, unverified: items.length, ok: false };
  }
  let deleted = 0, unverified = 0;
  const out = [];
  for (const it of items) {
    const p = byId.get(it.postId);
    if (!p) { unverified++; out.push({ ...it, verified: false, verifyNote: 'not in the Reddit archive yet (very new or removed)' }); continue; }
    const gone = /^\[(removed|deleted)\]$/.test(String(p.selftext || '').trim());   // removed by mods or deleted: not visible any more
    if (gone) { deleted++; continue; }
    if (typeof p.title !== 'string' || !p.title.trim()) { unverified++; out.push({ ...it, verified: false, verifyNote: 'Reddit archive missing title' }); continue; }
    const canonical = postShape('reddit', `https://www.reddit.com/r/${p.subreddit}/comments/${p.id}/`);
    const date = new Date(p.created_utc * 1000);
    out.push({ ...it, verified: true, verifiedBy: 'Arctic Shift', score: p.score ?? it.score, comments: p.num_comments ?? it.comments,
      ...(p.subreddit && canonical.ok ? { where: 'r/' + canonical.community, url: canonical.url } : {}),
      created: p.created_utc && Number.isFinite(+date) ? date.toISOString() : it.created, author: p.author || it.author, title: p.title,
      text: String(p.selftext || '').replace(/\s+/g, ' ').trim().slice(0, 900) });
  }
  return { items: out, deleted, unverified, ok: true };
}

async function verifyX(f, items) {
  let deleted = 0, unverified = 0;
  const out = await Promise.all(items.slice(0, 15).map(async it => {
    try {
      const r = await f('https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=' + encodeURIComponent(it.url), { redirect: 'follow', signal: AbortSignal.timeout(7000) });
      if (r.status === 404) { deleted++; return null; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const paragraph = String(j.html || '').match(/<blockquote\b[^>]*\btwitter-tweet\b[^>]*>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i);
      if (!paragraph) throw new Error('invalid embed');
      const text = plain(paragraph[1]);
      const author = String(j.author_url || '').replace(/\/+$/, '').split('/').pop() || it.author;
      return { ...it, verified: true, verifiedBy: 'X oEmbed', author, where: author ? '@' + author : it.where,
        authorName: j.author_name || null, title: text.slice(0, 160), text: text.length > 160 ? text.slice(0, 900) : '' };
    } catch (e) { unverified++; return { ...it, verified: false, verifyNote: 'X check unavailable (' + e.message + ')' }; }
  }));
  return { items: out.filter(Boolean), deleted, unverified, ok: true };
}

/** Existence check per source. Returns {items, deleted, unverified}. */
export async function verifyRows(f, source, items) {
  if (source === 'reddit') return verifyReddit(f, items);
  if (source === 'x') return verifyX(f, items);
  if (source === 'instagram') return { items: items.map(i => ({ ...i, verified: false, verifyNote: 'Instagram search snippet: open the post to confirm' })), deleted: 0, unverified: items.length };
  return { items, deleted: 0, unverified: 0 };
}
