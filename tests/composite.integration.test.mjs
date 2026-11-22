// REAL integration: starts workers/composite (rembg u2netp + Pillow) and composites the e2e fixture. Skipped when python/rembg is unavailable.
// Nothing is mocked here except that the product photo is a synthetic fixture, not a customer photo.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { composite } from '../lib/providers/composite.js';

const have = spawnSync('python3', ['-c', 'import rembg, PIL, numpy']).status === 0 && fs.existsSync(`${process.env.HOME}/.u2net/u2netp.onnx`);
const PORT = 8931;
test('pixel-locked composite: matte by rembg, protected pixels unchanged, report matches the delivered bytes', { skip: !have && 'python3 + rembg + u2netp weights not installed' }, async () => {
  const p = spawn('python3', ['workers/composite/service.py'], { env: { ...process.env, PORT: String(PORT), REMBG_MODEL: 'u2netp' }, stdio: 'ignore' });
  try {
    process.env.COMPOSITE_API_URL = `http://127.0.0.1:${PORT}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(process.env.COMPOSITE_API_URL + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
    const ref = 'data:image/png;base64,' + fs.readFileSync('tests/e2e/fixtures/ref.png').toString('base64');
    const out = await composite({ reference: ref, width: 1080, height: 1350 });
    const r = out.report; assert.equal(r.matte_model, 'u2netp'); assert.equal(r.protected_pixels_changed, 0); assert.ok(r.protected_pixels > 100000, 'check covers the product, not a sliver'); assert.equal(r.protected_pixel_equality, 'pass');
    assert.equal(crypto.createHash('sha256').update(Buffer.from(out.image.split(',')[1], 'base64')).digest('hex'), r.output_sha256);
    assert.equal(r.reference_sha256, crypto.createHash('sha256').update(fs.readFileSync('tests/e2e/fixtures/ref.png')).digest('hex'));
    fs.mkdirSync('docs/evidence', { recursive: true }); fs.writeFileSync('docs/evidence/composite-4x5.png', Buffer.from(out.image.split(',')[1], 'base64')); fs.writeFileSync('docs/evidence/composite-report.json', JSON.stringify(r, null, 2));
    await assert.rejects(() => composite({ reference: 'data:image/png;base64,AAAA', width: 1080, height: 1350 }), /cannot identify|Compositor/);
  } finally { p.kill(); delete process.env.COMPOSITE_API_URL; }
});
test('compositor not configured → honest requires_credentials error, no fake image', async () => {
  delete process.env.COMPOSITE_API_URL; await assert.rejects(() => composite({ reference: 'data:image/png;base64,AAAA', width: 1080, height: 1350 }), e => e.status === 503 && e.detail.code === 'requires_credentials');
});
