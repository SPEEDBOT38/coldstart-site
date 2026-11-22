#!/usr/bin/env node
// Generates product-free background images with the configured provider (Cloudflare Workers AI FLUX) and records latency, model and failures.
// Usage: BACKGROUND_PROVIDER=cloudflare CF_ACCOUNT_ID=... CF_AI_TOKEN=... node scripts/gen-backgrounds.mjs --out DIR "sunlit shelf" "dark studio" ...
// Exit 2 = BLOCKED (no credentials). Cost: the provider does not report a price per image; read it from the Cloudflare account billing page and record it by hand.
import fs from 'node:fs'; import path from 'node:path';
import { pick, backgroundPrompt } from '../lib/providers/background.js';
const args = process.argv.slice(2), oi = args.indexOf('--out'), out = oi >= 0 ? args[oi + 1] : 'backgrounds', scenes = args.filter((a, i) => a !== '--out' && i !== oi + 1);
const gen = pick();
if (!gen || gen.status(process.env) === 'requires_credentials') { console.log(JSON.stringify({ blocked: true, action: 'Set BACKGROUND_PROVIDER=cloudflare, CF_ACCOUNT_ID and CF_AI_TOKEN (Workers AI) in this shell.' })); process.exit(2); }
fs.mkdirSync(out, { recursive: true }); const rows = [];
for (const [i, scene] of (scenes.length ? scenes : ['sunlit wooden shelf, soft window light']).entries()) {
  const t = Date.now(), prompt = backgroundPrompt({ scene, ratio: '4:5' });
  try { const g = await gen.generate({ prompt }); const f = path.join(out, 'bg' + (i + 1) + '.jpg'); fs.writeFileSync(f, Buffer.from(g.dataUrl.split(',')[1], 'base64')); rows.push({ scene, file: f, ms: Date.now() - t, model: g.model, bytes: fs.statSync(f).size, cost_usd: g.costUsd, ok: true }); }
  catch (e) { rows.push({ scene, ms: Date.now() - t, ok: false, error: String(e.message).slice(0, 200) }); }
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), provider: gen.id, rows }, null, 1)); console.log(JSON.stringify({ ok: rows.filter(r => r.ok).length, failed: rows.filter(r => !r.ok).length }));
