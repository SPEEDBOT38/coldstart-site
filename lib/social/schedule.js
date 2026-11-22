// Scheduled scans. A Cloudflare Cron Trigger (workers/pipeline/worker.js `scheduled`) calls POST /api/cron/social with CRON_SECRET.
// Per-workspace schedule lives in that workspace's scope; the index of scheduled workspaces is a global key list.
import { scoped, sha256 } from '../ops/kv.js';
import { runScan } from './scan.js';

export async function setSchedule(kv, store, s) {
  const rec = { enabled: s.enabled, everyHours: s.everyHours, brand: s.brand, market: s.market, updatedAt: new Date().toISOString(), lastRunAt: (await kv.get('sched'))?.lastRunAt || null };
  await kv.set('sched', rec);
  const idx = new Set((await store.get('sched:index')) || []); s.enabled ? idx.add(kv.ws) : idx.delete(kv.ws); await store.set('sched:index', [...idx].slice(0, 5000));
  await kv.audit('social', s.enabled ? `Scheduled scans every ${s.everyHours}h` : 'Scheduled scans off', null); return rec;
}
/** Runs every due workspace. One workspace failing never stops the others; each result is recorded. */
export async function runDueScans({ store, fetch, now = Date.now(), max = 20 }) {
  const out = []; for (const ws of ((await store.get('sched:index')) || []).slice(0, max)) {
    const kv = scoped(store, ws), s = await kv.get('sched');
    if (!s || !s.enabled) { out.push({ ws, skipped: 'disabled' }); continue; }
    if (s.lastRunAt && now - Date.parse(s.lastRunAt) < s.everyHours * 36e5 - 6e4) { out.push({ ws, skipped: 'not_due' }); continue; }
    try { const slot = new Date(now).toISOString().slice(0, 13); const r = await runScan(kv, { fetch }, { brand: s.brand, market: s.market, windowDays: 7, idempotencyKey: 'sched-' + sha256(ws + slot).slice(0, 24) }, { scheduled: true });
      await kv.set('sched', { ...s, lastRunAt: new Date(now).toISOString(), lastResult: { opportunities: r.opportunities.length, blocked: r.blocked.length, cached: !!r.cached } }); out.push({ ws, ok: true, opportunities: r.opportunities.length }); }
    catch (e) { await kv.set('sched', { ...s, lastError: { at: new Date(now).toISOString(), message: String(e.message).slice(0, 200), code: e.detail?.code || null } }); out.push({ ws, ok: false, error: e.detail?.code || 'error' }); }
  } return out;
}
