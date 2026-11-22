// One bounded, cached, ledger-metered social scan. Used by the on-demand action and by the scheduled (Cloudflare cron) path.
import { sha256 } from '../ops/kv.js';
import { reserve, settle, release } from '../ops/ledger.js';
import { getPolicy } from '../ops/policy.js';
import { PluginError } from '../plugins/http.js';
import { runPipeline } from './pipeline.js';
import { SOURCES } from './sources.js';

const MAX_QUERIES = 4, PER_QUERY = 20, PAGES = 2;
export const xReadCap = () => Number(process.env.X_MAX_POSTS_READ_PER_DAY || 500);

export async function runScan(kv, ctx, inp, { scheduled = false } = {}) {
  const policy = await getPolicy(kv);
  if (policy.paused) throw new PluginError('All automation is paused. No scan was run.', 423, { code: 'paused' });
  // Cache: the same brand+market+window within the TTL reuses the stored result instead of re-reading (and re-paying for) posts.
  const sig = sha256({ b: inp.brand, m: inp.market, w: inp.windowDays }).slice(0, 24), ttl = Number(process.env.SCAN_CACHE_SECONDS || 3600);
  const cached = await kv.get('scancache:' + sig);
  if (cached) return { ...cached, cached: true, cache_age_seconds: Math.round((Date.now() - Date.parse(cached.at)) / 1000) };
  // Consumption limit: posts read per day per workspace (the account's X plan has its own limit too; this one is ours).
  const day = new Date().toISOString().slice(0, 10), worst = MAX_QUERIES * PER_QUERY * PAGES;
  const used = await kv.incrby('xread:' + day, worst);
  if (used > xReadCap()) { await kv.incrby('xread:' + day, -worst); throw new PluginError(`Daily X read limit reached (${xReadCap()} posts). Raise X_MAX_POSTS_READ_PER_DAY or try tomorrow.`, 429, { code: 'x_read_cap' }); }
  const rk = 'social:' + inp.idempotencyKey; const rv = await reserve(kv, { kind: 'social', idem: rk, units: 1 }).catch(async e => { await kv.incrby('xread:' + day, -worst); throw e; });
  if (rv.duplicate) { await kv.incrby('xread:' + day, -worst); const prev = await kv.get('scan:' + sha256(rk).slice(0, 16)); if (prev) return { ...prev, duplicate: true }; throw new PluginError('This scan is already running.', 409, { code: 'duplicate_request' }); }
  let out; try { out = await runPipeline({ brand: inp.brand, market: inp.market, sources: SOURCES, windowDays: inp.windowDays, maxQueries: MAX_QUERIES, fetch: ctx.fetch, known: new Set(await kv.list('opps')) }); }
  catch (e) { await release(kv, rk); await kv.incrby('xread:' + day, -worst); throw e; }
  const read = out.cost && out.cost.postsRead; if (typeof read === 'number') await kv.incrby('xread:' + day, read - worst);   // refund the unused part of the reservation
  await settle(kv, rk, { actualUsd: out.cost.usd || null });
  for (const o of out.opportunities) { o.cost_units = { usd: out.cost.usd, queries: out.cost.calls, shared_across: out.opportunities.length }; if (!(await kv.get('opp:' + o.id))) { await kv.set('opp:' + o.id, o); await kv.push('opps', o.id, 500); } }
  const rec = { ...out, at: new Date().toISOString(), scheduled, sources: SOURCES.map(s => ({ id: s.id, ...s.status() })) };
  await kv.set('scan:' + sha256(rk).slice(0, 16), rec, 7 * 86400); if (out.opportunities.length || !out.blocked.length) await kv.set('scancache:' + sig, rec, ttl);
  await kv.audit('social', `${scheduled ? 'Scheduled' : 'Social'} scan: ${out.opportunities.length} opportunities, ${out.blocked.length} blocked source(s)`, { cost: out.cost }); return rec;
}
