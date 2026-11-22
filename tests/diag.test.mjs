// /api/diag/store: staging-only, own secret, rate limited, self-cleaning. Runs on the in-memory store here (the deployed run uses Neon).
import test from 'node:test'; import assert from 'node:assert/strict'; import http from 'node:http';
import { createHandler } from '../lib/app.js'; import { createStore } from '../lib/store.js';
Object.assign(process.env, { SESSION_SECRET: 's'.repeat(40) }); const DIAG = 'd'.repeat(32);
async function call(auth, env) {
  Object.assign(process.env, { VERCEL_ENV: 'preview', DIAG_SECRET: DIAG, CRON_SECRET: 'c'.repeat(32) }, env || {});
  return fetch(base + '/api/diag/store', { method: 'POST', headers: auth ? { authorization: 'Bearer ' + auth } : {} });
}
const store = createStore({ STORE: 'memory' }); const srv = http.createServer(createHandler({ store })); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
test('diag: 401 without the diagnostic secret, and CRON_SECRET does not work', async () => { assert.equal((await call()).status, 401); assert.equal((await call('c'.repeat(32))).status, 401); });
test('diag: disabled (404) in production even with the right secret', async () => { assert.equal((await call(DIAG, { VERCEL_ENV: 'production' })).status, 404); });
test('diag: passes, cleans up its records, and is rate limited', async () => {
  const r = await call(DIAG); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.failed, 0, JSON.stringify(j.checks.filter(c => !c.pass)));
  assert.ok(j.checks.some(c => c.name.startsWith('cleanup') && c.pass));
  await call(DIAG); await call(DIAG); assert.equal((await call(DIAG)).status, 429); srv.closeAllConnections(); srv.close();
});
