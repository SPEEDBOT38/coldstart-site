// Queue consumer + producer API for generation jobs. NOT DEPLOYED / NOT TESTED against Cloudflare (no account in this build).
// Contract with the Vercel app (lib/ops/jobs.js): POST /jobs enqueues {ws, jobId}; the consumer moves the D1 row
// queued → processing, calls the hosted GPU service, stores the output in R2 (key ws/jobId), then → validating.
// Every query filters by ws (tenant isolation). Idempotency is the UNIQUE(ws, idempotency_key) constraint.
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const ok = (req, env) => req.headers.get('authorization') === 'Bearer ' + env.API_KEY;

export default {
  async fetch(req, env) {
    if (!ok(req, env)) return json({ error: 'unauthorized' }, 401);
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/jobs') {
      const { ws, job } = await req.json();
      if (!/^[\w-]{8,40}$/.test(ws || '') || !job?.id || !job?.idempotencyKey) return json({ error: 'bad request' }, 400);
      try {
        await env.DB.prepare('INSERT INTO jobs (id, ws, kind, state, workflow, idempotency_key, input_refs, cost_estimate_usd, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .bind(job.id, ws, job.kind, 'queued', job.workflow, job.idempotencyKey, JSON.stringify(job.inputRefs), job.cost?.estimateUsd ?? null, job.createdAt, job.createdAt).run();
      } catch (e) {
        if (/UNIQUE/.test(String(e))) { const row = await env.DB.prepare('SELECT id, state FROM jobs WHERE ws = ? AND idempotency_key = ?').bind(ws, job.idempotencyKey).first(); return json({ duplicate: true, ...row }); }
        throw e;
      }
      await env.JOBS.send({ ws, jobId: job.id });
      return json({ queued: true, id: job.id }, 202);
    }
    const m = url.pathname.match(/^\/jobs\/([\w-]+)$/);
    if (req.method === 'GET' && m) { const ws = url.searchParams.get('ws'); const row = await env.DB.prepare('SELECT * FROM jobs WHERE id = ? AND ws = ?').bind(m[1], ws).first(); return row ? json(row) : json({ error: 'not found' }, 404); }
    return json({ error: 'not found' }, 404);
  },
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const { ws, jobId } = msg.body, at = () => new Date().toISOString();
      const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ? AND ws = ?').bind(jobId, ws).first();
      if (!job || job.state === 'cancelled') { msg.ack(); continue; }
      await env.DB.prepare("UPDATE jobs SET state='processing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND ws = ?").bind(at(), jobId, ws).run();
      try {
        if (!env.GPU_API_URL) throw Object.assign(new Error('GPU service not configured'), { retryable: false });
        const r = await fetch(env.GPU_API_URL.replace(/\/$/, '') + '/v1/generate', { method: 'POST', headers: { authorization: 'Bearer ' + env.GPU_API_KEY, 'content-type': 'application/json' }, body: job.input_refs });
        if (r.status === 429 || r.status >= 500) throw Object.assign(new Error('GPU ' + r.status), { retryable: true });
        if (!r.ok) throw Object.assign(new Error('GPU ' + r.status), { retryable: false });
        const key = `${ws}/${jobId}`; await env.ASSETS.put(key, await r.arrayBuffer(), { httpMetadata: { contentType: r.headers.get('content-type') || 'image/png' } });
        await env.DB.prepare("UPDATE jobs SET state='validating', output_ref=?, model=?, updated_at=? WHERE id=? AND ws=?").bind(key, r.headers.get('x-model'), at(), jobId, ws).run();
        msg.ack();
      } catch (e) {
        if (e.retryable) { await env.DB.prepare("UPDATE jobs SET state='queued', updated_at=? WHERE id=? AND ws=?").bind(at(), jobId, ws).run(); msg.retry({ delaySeconds: 30 }); }
        else { await env.DB.prepare("UPDATE jobs SET state='failed', error=?, updated_at=? WHERE id=? AND ws=?").bind(JSON.stringify({ message: String(e.message), retryable: false }), at(), jobId, ws).run(); msg.ack(); }
      }
    }
  },
};
