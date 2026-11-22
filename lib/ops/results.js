// Results snapshot. Every number carries one of three provenance labels:
//   observed    : read from a provider or accepted by one, with the time it was observed
//   unavailable : we cannot see it, with the reason
//   estimate    : none are produced by this build (we never invent them)
import { listPublish } from './outbox.js';
import { listApprovals, getExecution } from './approvals.js';
import { assessTracking } from '../tracking/inspect.js';
import { loadSite } from '../plugins/meta/relay.js'; import { getLog } from '../plugins/meta/relay.js';

const ageSec = iso => iso ? Math.round((Date.now() - Date.parse(iso)) / 1000) : null;
export async function resultsSnapshot(kv, ctx) {
  const jobs = await listPublish(kv), posts = jobs.filter(j => j.state === 'completed').map(j => {
    const m = (j.metrics || []).slice(-1)[0] || null, manual = j.verification === 'user_attested';
    return { id: j.id, channel: j.provider, text: String(j.payload.text).slice(0, 80), provider_post_id: manual ? null : j.externalId, url: j.url, verified_by: manual ? 'user_attested' : 'platform_read_back',
      engagement: m ? { provenance: 'observed', observed_at: m.at, age_seconds: ageSec(m.at), source: m.source, likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null, reposts: m.reposts ?? null, impressions: m.impressions ?? null } : { provenance: 'unavailable', reason: manual ? 'Posted manually: the platform was never read.' : 'No metrics snapshot has been taken yet. Use Refresh metrics.' } };
  });
  const pending = jobs.filter(j => j.state !== 'completed' && j.state !== 'cancelled').map(j => ({ id: j.id, channel: j.provider, state: j.state }));
  const conn = ctx.getConn && ctx.getConn('meta'); let tracking = { provenance: 'unavailable', reason: 'Meta is not connected.' };
  if (conn && conn.siteKey) { const site = await loadSite(ctx.store, conn.siteKey), log = await getLog(ctx.store, conn.siteKey), a = assessTracking({ site: site ? { mode: conn.mode } : null, log });
    const lastOk = log.find(r => r.ok && !r.test); tracking = { provenance: 'observed', state: a.state, verified: a.verified, dedupe: a.dedupe || 'unconfirmed', last_accepted_event_at: lastOk ? lastOk.at : null, freshness_seconds: lastOk ? ageSec(lastOk.at) : null, stale: lastOk ? ageSec(lastOk.at) > 86400 : true, next: a.next }; }
  const ads = []; for (const a of await listApprovals(kv)) { const e = await getExecution(kv, a.id); if (e) ads.push({ approval: a.id, state: e.state, campaign_id: e.campaignId || null, status: e.status || null, performance: { provenance: 'unavailable', reason: e.state === 'created' ? 'The draft is PAUSED. Nothing is delivering, so there is no spend or performance to report.' : 'No Meta campaign exists (' + e.state + ').' } }); }
  return { generated_at: new Date().toISOString(), posts, pending, tracking, ads, estimates: { provenance: 'estimate', items: [], note: 'This build produces no estimates. Anything labelled as a forecast elsewhere is a plan, not a result.' }, conversions: { provenance: 'unavailable', reason: 'Conversions are not read back from Meta in this build; only accepted-event status is shown.' } };
}
