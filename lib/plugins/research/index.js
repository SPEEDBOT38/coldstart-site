// Research plugin (server-side keys): live conversations from Reddit, X and Instagram, competitor
// ads from the Meta Ad Library, tagged into signals and teardowns by Gemini.
import { need } from '../http.js';
import { deadlineFetch } from './deadline.js';
import { charge, limits } from '../../budget.js';
import { hasTreg } from '../../treg.js';
import { aiProvider } from '../../ai.js';
import { fetchSource, SOURCES } from './sources.js';
import { enrichSignals, teardownAds, MIN_MATCH } from './enrich.js';
import { verifyRows, queryTerms, overlap } from './verify.js';

const CONVO = ['reddit', 'x', 'instagram'];
const cleanQuery = q => { const s = String(q || '').trim(); need(s.length >= 2 && s.length <= 200, 'Enter a research question (2–200 characters).'); return s; };

// MetaCroc's broadening rule: a long question that finds nothing is retried on its two strongest words.
export const broaden = q => { const t = queryTerms(q); return t.length >= 3 ? String(q).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && t.includes(w.replace(/(ies)$/, 'y').replace(/(ing|es|s)$/, ''))).slice(0, 2).join(' ') : null; };

export async function scan(ctx, input) {
  const query = cleanQuery(input.query);
  const sources = [...new Set((Array.isArray(input.sources) ? input.sources : CONVO).filter(s => CONVO.includes(s)))];
  need(sources.length, 'Pick at least one source.');
  await charge(ctx.store, 'scan', ctx.ip, limits.scan());
  const f = ctx.fetch || fetch, t0 = Date.now(), log = [];
  const terms = queryTerms(query);
  const deadlineAt = t0 + 54500; let pull = deadlineFetch(f, t0 + 30000);
  const q = { found: 0, notPost: 0, duplicate: 0, deleted: 0, unverified: 0, verified: 0, unrelated: 0 };
  async function gather(qs) {
    const res = await Promise.all(sources.map(s => fetchSource(pull, s, qs, { max: 12 })));
    const ver = await Promise.all(sources.map((s, i) => verifyRows(pull, s, res[i].items)));
    return { res, ver };
  }
  let usedQuery = query, { res, ver } = await gather(query);
  let items = ver.flatMap(v => v.items);
  const related = it => overlap(it, terms) > 0;
  if (items.filter(related).length < 4 && broaden(query) && broaden(query) !== query.toLowerCase()) {
    const bq = broaden(query);
    if (Date.now() > t0 + 38000) { log.push(`no time left to also search “${bq}”`); } else {
    pull = deadlineFetch(f, Math.min(Date.now() + 14000, t0 + 44000));
    log.push(`only ${items.filter(related).length} posts for “${query}”, also searched “${bq}”`);
    const more = await gather(bq);
    res = res.map((r, i) => ({ ...r, items: [...r.items, ...more.res[i].items], usd: r.usd + more.res[i].usd, tried: [...r.tried, ...more.res[i].tried.map(t => ({ ...t, query: bq }))], provider: r.provider || more.res[i].provider, status: r.items.length || more.res[i].items.length ? 'ok' : more.res[i].status, error: r.items.length || more.res[i].items.length ? null : more.res[i].error,
      dropped: { notPost: r.dropped.notPost + more.res[i].dropped.notPost, duplicate: r.dropped.duplicate + more.res[i].dropped.duplicate } }));
    const seen = new Set(items.map(i => i.source + i.postId));
    ver = ver.map((v, i) => ({ ...v, items: [...v.items, ...more.ver[i].items.filter(x => !seen.has(x.source + x.postId))], deleted: v.deleted + more.ver[i].deleted, unverified: v.unverified + more.ver[i].unverified }));
    items = ver.flatMap(v => v.items); usedQuery = query + ' / ' + bq;
    }
  }
  for (const r of res) { q.found += r.items.length + r.dropped.notPost + r.dropped.duplicate; q.notPost += r.dropped.notPost; q.duplicate += r.dropped.duplicate; }
  for (const v of ver) { q.deleted += v.deleted; }
  const relevant = items.filter(related);
  q.unrelated = items.length - relevant.length;
  q.verified = relevant.filter(i => i.verified).length; q.unverified = relevant.length - q.verified;
  if (q.notPost) log.push(`dropped ${q.notPost} results that were profiles, communities or search pages, not posts`);
  if (q.duplicate) log.push(`merged ${q.duplicate} duplicates`);
  if (q.deleted) log.push(`dropped ${q.deleted} deleted or removed posts`);
  if (q.unrelated) log.push(`dropped ${q.unrelated} posts that never mention the question`);
  const en = await enrichSignals(relevant, { query, brand: input.brand, fetch: deadlineFetch(f, deadlineAt), deadlineAt });
  if (en.quality.offTopic) log.push(`dropped ${en.quality.offTopic} posts the AI rated off-topic (< ${MIN_MATCH}% match)`);
  log.push(...en.notes);
  const status = Object.fromEntries(sources.map((s, i) => [s, { status: res[i].status, provider: res[i].provider || null, count: en.signals.filter(x => x.source === s).length, found: res[i].items.length, error: res[i].error || null, tried: res[i].tried,
    verified: en.signals.filter(x => x.source === s && x.verified).length }]));
  const usd = res.reduce((a, r) => a + r.usd, 0) + (en.usd || 0);
  return { query, searched: usedQuery, at: new Date().toISOString(), ms: Date.now() - t0, sources: status, signals: en.signals, themes: en.themes, summary: en.summary, ai: en.ai,
    quality: { ...q, ...en.quality, shown: en.signals.length }, log, cost: { usd: Math.round(usd * 1e6) / 1e6 } };
}

export async function competitors(ctx, input) {
  if (input.job !== undefined || input.rival) {
    const { startRival, pollRival } = await import('./ads-job.js');
    return input.job !== undefined ? pollRival(ctx, input.job) : startRival(ctx, input, cleanQuery(input.query));
  }
  const query = cleanQuery(input.query);
  // ponytail: Apify keyword search is the default when its token is set; TREG/Meta chain is the fallback.
  if (process.env.APIFY_TOKEN) { const { startRival } = await import('./ads-job.js'); return startRival(ctx, input, query, true); }
  const country = /^[A-Z]{2}$/.test(input.country || '') ? input.country : 'US';
  await charge(ctx.store, 'scan', ctx.ip, limits.scan());
  const f = ctx.fetch || fetch;
  const r = await fetchSource(f, 'meta_ads', query, { country, max: 20 });
  const td = await teardownAds(r.items, { query, brand: input.brand, fetch: f });
  return { query, country, at: new Date().toISOString(), source: { status: r.status, provider: r.provider || null, count: r.items.length, error: r.error || null }, ...td, cost: { usd: Math.round((r.usd + (td.usd || 0)) * 1e6) / 1e6 } };
}

export default {
  id: 'research', name: 'Research', vendor: 'treg · Firecrawl · Gemini', category: 'Research',
  description: 'Live conversations from Reddit, X and Instagram plus Meta Ad Library competitor ads, tagged by intent with Gemini.',
  capabilities: ['research.reddit', 'research.x', 'research.instagram', 'research.meta_ads', 'ai.tagging'],
  env: ['TREG_TOKEN'], optionalEnv: ['FIRECRAWL_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'RESEARCH_DAILY_SCANS'],
  docs: 'https://treg.to', auth: { type: 'server', scopes: [] },
  liveReady: () => Object.values(SOURCES).some(chain => chain.some(p => p.ready())),
  actions: {
    status: { method: 'GET', async run() {
      return { sources: Object.fromEntries(Object.entries(SOURCES).map(([k, chain]) => [k, chain.filter(p => p.ready()).map(p => p.id)])), ai: aiProvider(), treg: hasTreg() };
    } },
    scan: { method: 'POST', run: (ctx, input) => scan({ ...ctx, ip: ctx.req.ip }, input) },
    competitors: { method: 'POST', run: (ctx, input) => competitors({ ...ctx, ip: ctx.req.ip }, input) },
  },
};
