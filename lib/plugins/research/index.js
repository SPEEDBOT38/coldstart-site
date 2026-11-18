// Research plugin (server-side keys): live conversations from Reddit, X and Instagram, competitor
// ads from the Meta Ad Library, tagged into signals and teardowns by Gemini.
import { need } from '../http.js';
import { charge, limits } from '../../budget.js';
import { hasTreg } from '../../treg.js';
import { aiProvider } from '../../ai.js';
import { fetchSource, SOURCES } from './sources.js';
import { enrichSignals, teardownAds } from './enrich.js';

const CONVO = ['reddit', 'x', 'instagram'];
const cleanQuery = q => { const s = String(q || '').trim(); need(s.length >= 2 && s.length <= 200, 'Enter a research question (2–200 characters).'); return s; };

export async function scan(ctx, input) {
  const query = cleanQuery(input.query);
  const sources = (Array.isArray(input.sources) ? input.sources : CONVO).filter(s => CONVO.includes(s));
  need(sources.length, 'Pick at least one source.');
  await charge(ctx.store, 'scan', ctx.ip, limits.scan());
  const f = ctx.fetch || fetch;
  const results = await Promise.all(sources.map(s => fetchSource(f, s, query, { max: 12 })));
  const items = results.flatMap((r, i) => r.items.map(it => ({ ...it, provider: r.provider })));
  const en = await enrichSignals(items, { query, brand: input.brand, fetch: f });
  const status = Object.fromEntries(sources.map((s, i) => [s, { status: results[i].status, provider: results[i].provider || null, count: results[i].items.length, error: results[i].error || null, tried: results[i].tried }]));
  const usd = results.reduce((a, r) => a + r.usd, 0) + (en.usd || 0);
  return { query, at: new Date().toISOString(), sources: status, signals: en.signals, themes: en.themes, summary: en.summary, ai: en.ai, cost: { usd: Math.round(usd * 1e6) / 1e6 } };
}

export async function competitors(ctx, input) {
  const query = cleanQuery(input.query);
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
