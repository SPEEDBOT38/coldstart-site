// Typography regression tests for the canvas ad editor, run in headless Chromium (the same code path as Studio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
let chromium; try { ({ chromium } = await import('playwright')); } catch { try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* skipped below */ } }
const src = readFileSync(new URL('../js/creative-editor-v4.js', import.meta.url), 'utf8');

test('editor typography', { skip: !chromium && 'playwright not installed' }, async (t) => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<html><body><dialog id="dlg"></dialog></body></html>'); await p.addScriptTag({ content: src });
  const run = (layout) => p.evaluate(async (L) => { const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const g = c.getContext('2d'); g.fillStyle = '#333'; g.fillRect(0, 0, 1080, 1350);
    const cv = await window.CreativeEditor.compose(c.toDataURL('image/png'), L, '4:5'); const a = cv.toDataURL('image/png'); const cv2 = await window.CreativeEditor.compose(c.toDataURL('image/png'), L, '4:5');
    return { qa: cv.qa, w: cv.width, h: cv.height, same: a === cv2.toDataURL('image/png') }; }, layout);
  const base = (o) => ({ headline: { text: 'Crunch first. Think later.', position: 'bottom-left', size: 'huge', color: '#fff', align: 'left' }, body: { text: 'Mello Almond Dragees', position: 'bottom-left', size: 'small', color: '#fff', align: 'left' }, cta: { text: 'Try Mello', position: 'bottom-left', size: 'medium', color: '#000', bg: '#fff', align: 'left' }, productBox: { x: 600, y: 300, w: 400, h: 600 }, ...o });

  await t.test('every word is kept when the headline must fit beside the product', async () => {
    const r = await run(base());
    assert.equal(r.qa.rects.find((x) => x.k === 'headline').drawn, 'Crunch first. Think later.');
    assert.equal(r.w, 1080); assert.equal(r.h, 1350);
  });
  await t.test('render is deterministic (preview == export)', async () => { assert.equal((await run(base())).same, true); });
  await t.test('a stranded supporting line is flagged', async () => {
    const r = await run(base({ body: { text: 'Mello Almond Dragees', position: 'top-left', size: 'small', color: '#fff' } }));
    assert.ok(r.qa.issues.some((i) => /stranded/.test(i)), r.qa.issues.join('|'));
  });
  await t.test('text over the product is flagged', async () => {
    const r = await run(base({ headline: { text: 'Crunch first', position: 'middle-right', size: 'huge', color: '#fff' } }));
    assert.ok(r.qa.issues.some((i) => /overlaps the product/.test(i)), r.qa.issues.join('|'));
  });
  await t.test('weak hierarchy is flagged', async () => {
    const r = await run(base({ headline: { text: 'Tiny', position: 'bottom-left', size: 'small', color: '#fff' }, body: { text: 'Big supporting line', position: 'bottom-left', size: 'medium', color: '#fff' } }));
    assert.ok(r.qa.issues.some((i) => /hierarchy/.test(i)), r.qa.issues.join('|'));
  });
  await t.test('eyebrow order: product name above the headline', async () => {
    const r = await run(base({ order: ['body', 'headline', 'cta'], body: { text: 'Mello Almond Dragees', position: 'bottom-left', size: 'eyebrow', color: '#fff' } }));
    const R = Object.fromEntries(r.qa.rects.map((x) => [x.k, x])); assert.ok(R.body.y < R.headline.y && R.headline.y < R.cta.y);
  });
  await b.close();
});

test('compositor mask regression (python)', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('python3', ['workers/composite/test_maskfix.py'], { encoding: 'utf8' });
  if (r.error && r.error.code === 'ENOENT') return;   // no python on this machine
  assert.equal(r.status, 0, r.stderr.slice(-2000));
});
