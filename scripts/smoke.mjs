// Live smoke test: real providers + real AI with the keys in .env. Usage: node scripts/smoke.mjs "query"
import fs from 'node:fs';
for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { scan, competitors } = await import('../lib/plugins/research/index.js');
const { draftPost } = await import('../lib/plugins/studio.js');
const { createStore } = await import('../lib/store.js');
const ctx = { store: createStore({ STORE: 'memory' }), ip: 'smoke' };
const brand = { name: 'Fern & Form', line: 'plant care kits for small flats', voice: 'warm, practical', avoid: 'miracle' };
const q = process.argv[2] || 'houseplant watering routine';
let t = Date.now();
const r = await scan(ctx, { query: q, sources: ['reddit', 'x', 'instagram'], brand });
console.log(`scan ${Date.now() - t}ms ai=${r.ai} cost=$${r.cost.usd}`);
for (const [k, v] of Object.entries(r.sources)) console.log(' ', k, v.status, v.provider, v.count, v.error || '');
console.log('summary:', r.summary);
for (const s of r.signals.slice(0, 5)) console.log(' -', s.source, s.score, s.intent, '|', s.title.slice(0, 70), '|', s.url);
if (r.signals[0]) for (const platform of ['x', 'reddit']) {
  t = Date.now();
  const d = await draftPost(ctx, { platform, signal: r.signals[0], brand });
  console.log(`\ndraft ${platform} (${d.body.length} chars, ${d.model}, ${Date.now() - t}ms): ${d.title}\n${d.body.slice(0, 600)}`);
}
if (process.argv.includes('--ads')) { const c = await competitors(ctx, { query: q, brand }); console.log('\nads', c.source, c.teardowns.length); }
