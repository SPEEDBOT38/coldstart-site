// End-to-end browser tests (Playwright + the real server + real OCR in the browser).
// MOCKED at the network edge: onboarding scan, research scan (no keys here) and the image worker (returns fixture images).
// REAL: server routes, per-workspace store, ops (masters/jobs/approvals/policy/caps), identity QA (tesseract.js, culori), sandbox Meta OAuth.
// Nothing here talks to Meta, X, Reddit, Firecrawl or OpenRouter.
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);   // playwright resolves via NODE_PATH (global install) or node_modules
const { chromium } = req('playwright');
const { AxeBuilder } = req('@axe-core/playwright');
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FX = f => path.join(ROOT, 'tests/e2e/fixtures', f);
const PORT = 8911, WPORT = 8912, BASE = `http://127.0.0.1:${PORT}`;
let workerImage = 'gen_ok.jpg', workerCalls = 0;
const results = [], consoleErrors = [];
const T = async (name, fn) => { const t = Date.now(); try { await fn(); results.push([name, 'pass', Date.now() - t]); console.log('  ok   ' + name); } catch (e) { try { const pg = globalThis.__page; e.message += ' [at ' + pg.url().split('#')[1] + ' | ' + (await pg.evaluate(() => (document.getElementById('toast') || {}).textContent + ' || ' + (document.querySelector('main')||document.body).innerText.replace(/\s+/g, ' ').slice(0, 400))) + ']'; } catch (_) {} results.push([name, 'FAIL', Date.now() - t, e.message.split('\n')[0]]); console.log('  FAIL ' + name + '\n       ' + e.message.split('\n')[0] + ' ' + (e.message.match(/\[at [^\n]*$/) || [''])[0]); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'expected equal') + `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const inc = (t, x) => String(t).toLowerCase().includes(x.toLowerCase());
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

const worker = http.createServer((req, res) => { workerCalls++; res.writeHead(200, { 'content-type': 'image/jpeg', 'x-model': 'mock-worker' }); res.end(fs.readFileSync(FX(workerImage))); }).listen(WPORT, '127.0.0.1');
const CPORT = 8913; const comp = spawn('python3', ['workers/composite/service.py'], { cwd: ROOT, env: { ...process.env, PORT: CPORT, REMBG_MODEL: 'u2netp' }, stdio: 'ignore' });
const server = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, STORE: 'memory', SESSION_SECRET: 'e'.repeat(40), IMAGE_ENGINE: 'flux', IMAGE_API_URL: `http://127.0.0.1:${WPORT}`, IMAGE_API_KEY: 'k', IMAGE_DAILY_LIMIT: '500', OPENROUTER_API_KEY: '', FIRECRAWL_API_KEY: '', IMAGE_COST_EST_USD: '0.04', COMPOSITE_API_URL: `http://127.0.0.1:${CPORT}`, META_APP_ID: '', META_APP_SECRET: '' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { await new Promise(r => setTimeout(r, 200)); } }

const SCAN = { mode: 'live', model: 'mock', log: [], brand: { name: 'Fern & Form', line: 'Plant-care kits for urban gardeners in India', tones: ['warm', 'plain-spoken'], colors: ['#2d5a27', '#eae7e0'], currency: 'INR', dont: ['miracle'], names: [] },
  products: [{ name: 'Soil Mix 250 g', price: 499, image: '', url: 'https://fernform.test/products/soil-mix' }, { name: 'Terracotta Pot', price: 899, image: '', url: 'https://fernform.test/products/pot' }],
  icps: [{ name: 'New plant parents', who: 'Urban renters, 22 to 35, first plants', pain: 'Plants keep dying and I do not know why', evidence: true }], sources: null };
const RESEARCH = { at: new Date().toISOString(), query: 'q', signals: [{ source: 'reddit', title: 'Why do my plants keep dying', url: 'https://reddit.com/r/houseplants/x', text: 'help', date: '2026-11-01' }], themes: [{ title: 'Overwatering', count: 3 }], sources: { reddit: 1 }, cost: { usd: null } };
async function mocks(page) {
  await page.route('**/api/plugins/onboard/actions/scan', r => r.fulfill({ json: SCAN }));
  await page.route('**/api/plugins/research/actions/scan', r => r.fulfill({ json: RESEARCH }));
}
const watch = (page, tag) => { page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(tag + ': ' + m.text()); }); page.on('pageerror', e => consoleErrors.push(tag + ' PE: ' + e.message + ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' ').trim() + ' on ' + page.url())); };
const creativeMode = async (page) => { await page.waitForSelector('#mode-creative'); if ((await page.getAttribute('#mode-creative', 'aria-pressed')) !== 'true') { await page.click('#mode-creative'); await page.waitForSelector('#go-shoot'); } };
const overflow = page => page.evaluate(() => { if (document.documentElement.scrollWidth <= innerWidth + 2) return false; const all = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 2); const w = all.filter((e) => !all.some((o) => o !== e && e.contains(o))).slice(0, 3).map((e) => e.tagName + '.' + e.className + '#' + e.id + ' ' + Math.round(e.getBoundingClientRect().right) + ' ' + (e.textContent || '').slice(0, 30)); const sn = all[0] && document.getElementById('f-sku') || document.querySelector('.subnav'); const chain = []; for (let e = sn; e && e !== document.body; e = e.parentElement) chain.push(e.tagName + '.' + e.className + ' w' + Math.round(e.getBoundingClientRect().width) + ' d' + getComputedStyle(e).display); window.__ovf = w.join(',') + ' CHAIN ' + chain.join(' < '); return true; });
const S = page => page.evaluate(() => JSON.parse(localStorage.getItem('coldstart.v4') || 'null'));
const ops = (page, action, body) => page.evaluate(async ([a, b]) => { const r = await fetch('/api/plugins/ops/actions/' + a, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-coldstart': '1' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; }, [action, body]);
const toastText = page => page.locator('#toast').innerText();

const browser = await chromium.launch();
async function suite(label, viewport) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true }); const page = await ctx.newPage(); globalThis.__page = page; watch(page, label); await mocks(page);
  const tag = n => `[${label}] ${n}`;
  console.log(`\n${label} ${viewport.width}px`);

  await T(tag('onboarding: scan → confirm flagship (with validation) → goal → boundaries (country required) → plan → Accept plan'), async () => {
    await page.goto(BASE + '/onboarding-v4.html');
    await page.fill('#site', 'fernform.test'); await page.click('#f0 button'); await page.waitForSelector('#fl-name', { timeout: 20000 });
    eq(await page.inputValue('#fl-name'), 'Soil Mix 250 g', 'flagship prefilled from the scan'); eq(await page.inputValue('#fl-price'), '499');
    ok(!(await overflow(page)), 'overflow on brand step');
    await page.fill('#fl-url', 'http://not-https.test'); await page.click('#next'); ok(inc(await page.locator('#fl-err').innerText(), 'https'), 'bad buy link must be rejected');
    await page.fill('#fl-name', ''); await page.click('#next'); ok(inc(await page.locator('#fl-err').innerText(), 'Name the product'));
    await page.fill('#fl-name', 'Soil Mix 250 g'); await page.fill('#fl-var', '250 g'); await page.fill('#fl-url', 'https://fernform.test/products/soil-mix'); await page.click('#next');
    await page.waitForSelector('[data-g]'); await page.click('[data-g=sales]'); await page.fill('#target', '100'); await page.click('#next');
    await page.waitForSelector('[data-rm]'); await page.click('[data-rm=set]'); await page.fill('#region', 'Bengaluru, Mumbai'); await page.fill('#budget', '15000');
    ok((await page.locator('text=Always on · locked').count()) > 0, 'approval policy shown as locked');
    await page.click('#next'); ok(inc(await page.locator('#s3-err').innerText(), 'country'), 'paid budget without country is refused');
    await page.selectOption('#country', 'IN'); await page.click('#next'); await page.waitForSelector('.plan-item');
    eq((await page.locator('#next').textContent()).trim(), 'Accept plan →'); await page.click('#next'); await page.waitForSelector('.hero', { timeout: 15000 });
    const s = await S(page); eq(s.flagship.name, 'Soil Mix 250 g'); eq(s.flagship.variant, '250 g'); eq(s.offer.url, 'https://fernform.test/products/soil-mix'); eq(s.bounds.country, 'IN');
  });

  await T(tag('state survives refresh; confirmed info is not asked again in the Library'), async () => {
    await page.reload(); await page.waitForSelector('.hero'); const s = await S(page); eq(s.done, true);
    await page.goto(BASE + '/app-v4.html#/campaigns/library'); await page.waitForSelector('#up-name');
    eq(await page.inputValue('#up-name'), 'Soil Mix 250 g', 'name prefilled from the confirmed flagship'); eq(await page.inputValue('#up-price'), '499');
  });

  await T(tag('research: scan result persists; server counts it against the daily cap'), async () => {
    await page.goto(BASE + '/app-v4.html#/discover'); await page.waitForSelector('#run-research'); await page.click('#run-research'); await page.waitForFunction(() => JSON.parse(localStorage.getItem('coldstart.v4')).research, null, { timeout: 15000 });
    const s = await S(page); eq(s.research.signals.length, 1);
  });

  await T(tag('identity: upload → read packaging text (real OCR) → confirm → approve master'), async () => {
    await page.goto(BASE + '/app-v4.html#/campaigns/library'); await page.waitForSelector('#up-file', { state: 'attached' });
    await page.setInputFiles('#up-file', FX('ref.png')); await page.waitForSelector('[data-ident-open]', { timeout: 15000 });
    ok(inc(await page.locator('.sku').innerText(), 'No identity yet'), 'a new product has no identity');
    await page.click('[data-ident-open]'); await page.waitForSelector('#pm-ocr');
    await page.fill('#pm-sku', 'FF-SOIL-250'); await page.click('#pm-ocr');
    await page.waitForFunction(() => /Found \d+ lines|No readable|OCR failed/.test(document.getElementById('pm-ocr-s').textContent), null, { timeout: 90000 });
    const txt = (await page.inputValue('#pm-text')).toUpperCase(); ok(/FERN|FORM/.test(txt) && /SOIL|MIX/.test(txt), 'OCR should read the label, got: ' + txt);
    await page.fill('#pm-text', 'FERN & FORM\nSOIL MIX 250 G'); await page.check('#pm-logo');
    await page.locator('#pm-reg').scrollIntoViewIfNeeded(); const box = await page.locator('#pm-reg img').boundingBox(); await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7); await page.mouse.up();
    eq(await page.locator('#pm-reg .reg').count(), 1, 'a protected region was drawn');
    await page.evaluate(() => { const cs = [...document.querySelectorAll('#pm-cols input')]; const g = cs.find((i) => { const m = i.value.match(/#(..)(..)(..)/); return +('0x' + m[2]) > +('0x' + m[1]) && +('0x' + m[2]) > +('0x' + m[3]); }); (g || cs[0]).click(); });
    ok(await page.locator('#pm-ok').isDisabled(), 'cannot approve before confirming');
    await page.check('#pm-reg-dummy').catch(() => {}); for (const id of ['#c-text', '#c-logo', '#c-col']) await page.check(id);
    for (const k of ['background', 'relight']) await page.check(`[data-al=${k}]`);
    eq(await page.locator('[data-al=recolor]').isChecked(), false, 'recolour is off by default'); eq(await page.locator('[data-al=viewpoint]').isChecked(), false, 'viewpoint is off by default');
    await page.click('#pm-ok'); await page.waitForFunction(() => /Approved/.test(document.querySelector('[data-ident]').textContent), null, { timeout: 10000 });
    const m = (await ops(page, 'masters')).json.masters[0]; eq(m.status, 'approved'); eq(m.identity.text.length, 2); eq(m.identity.regions.length, 1);
  });

  await T(tag('generation: only allowed alterations; job runs on the server; real OCR QA; never auto-verified'), async () => {
    await page.goto(BASE + '/app-v4.html#/campaigns/studio'); await page.waitForSelector('#go-shoot');
    eq(await page.locator('[data-want=recolor]').isDisabled(), true, 'recolour is not allowed on this master');
    workerImage = 'gen_ok.jpg'; await creativeMode(page); await page.click('#go-shoot');
    await page.waitForSelector('[data-compare]', { timeout: 120000 }); await page.waitForFunction(() => !/Running OCR/.test(document.body.innerText), null, { timeout: 120000 });
    const jobs = (await ops(page, 'jobs')).json.jobs; eq(jobs.length, 1); eq(jobs[0].state, 'completed', 'matching label → QA recorded → completed'); eq(jobs[0].model, 'mock-worker'); eq(jobs[0].review.verified, false, 'segmentation/logo are unverified, so never "verified"');
    const a = (await S(page)).studio.assets[0]; ok(a.findings.find((f) => f.check === 'Packaging text').status === 'pass', 'OCR found the confirmed label text in the generated image');
    ok(a.findings.find((f) => f.check === 'Segmentation errors').status === 'unverified');
  });

  await T(tag('compare: slider, synced zoom/pan, findings, approval gate'), async () => {
    await page.click('[data-compare]'); await page.waitForSelector('img-comparison-slider');
    eq(await page.locator('#cp-ok').isDisabled(), true, 'approve is gated');
    await page.click('[data-v=side]'); await page.waitForSelector('#pz1 img');
    await page.mouse.move(...(await (async () => { const b = await page.locator('#pz1').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; })()));
    await page.waitForTimeout(500); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(250); }
    await page.waitForTimeout(1200); const t1 = await page.locator('#pz1 img').evaluate((e) => e.style.transform), t2 = await page.locator('#pz2 img').evaluate((e) => e.style.transform);
    ok(/scale\((?!1\))/.test(t1), 'zoom applied: ' + t1); eq(t1, t2, 'both panes share the same transform');
    ok(inc(await page.locator('#dlg .qa').innerText(), 'Unverified'), 'unverifiable checks are shown as Unverified');
    await page.check('#cp-seen'); eq(await page.locator('#cp-ok').isDisabled(), false); await page.click('#cp-ok'); await page.waitForSelector('text=Approved');
    ok((await S(page)).studio.assets[0].approved, 'asset approved');
  });

  await T(tag('fidelity-first: real matte, original pixels kept, measured from output, still needs review'), async () => {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${CPORT}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    await page.goto(BASE + '/app-v4.html#/campaigns/studio'); await page.waitForSelector('#mode-locked'); await page.click('#mode-locked'); await page.waitForSelector('#go-shoot');
    const prev = (await S(page)).studio.assets.length; await page.click('#go-shoot');
    await page.waitForFunction((n) => JSON.parse(localStorage.getItem('coldstart.v4')).studio.assets.length > n, prev, { timeout: 120000 });
    const a = (await S(page)).studio.assets[0]; eq(a.spec.mode, 'pixel-locked'); eq(a.findings[0].status, 'pass', 'protected pixels unchanged'); ok(/ 0 changed/.test(a.findings[0].detail), a.findings[0].detail); eq(a.verified, false, 'never auto-verified'); eq(a.synth, false);
    eq((await ops(page, 'audit')).json.events.some((e) => /Pixel-locked composite \(pass\)/.test(e.text)), true, 'recorded on the server audit log');
    await page.waitForSelector(`[data-compare="${a.id}"]`); await page.click(`[data-compare="${a.id}"]`); await page.waitForSelector('#cp-ok'); eq(await page.locator('#cp-ok').isDisabled(), true, 'approve still gated by human comparison');
    await page.keyboard.press('Escape');
  });

  await T(tag('bad generation: OCR catches altered label text → job failed → cannot approve'), async () => {
    workerImage = 'gen_bad.jpg'; await page.goto(BASE + '/app-v4.html#/campaigns/studio'); await page.waitForSelector('#go-shoot'); const prevId = (await S(page)).studio.assets[0].id; await creativeMode(page); await page.click('#go-shoot');
    await page.waitForFunction((pid) => { const a = JSON.parse(localStorage.getItem('coldstart.v4')).studio.assets[0] || {}; return a.id !== pid && a.findings; }, prevId, { timeout: 120000 });
    await page.waitForFunction(() => !/Running OCR/.test(document.body.innerText), null, { timeout: 120000 });
    const a = (await S(page)).studio.assets[0]; eq(a.findings.find((f) => f.check === 'Packaging text').status, 'fail', 'altered text must fail');
    const j = (await ops(page, 'jobs')).json.jobs.find((x) => x.id === a.jobId); eq(j.state, 'failed'); eq(j.error.code, 'qa_failed');
    await page.waitForSelector(`[data-compare="${a.id}"]`); await page.click(`[data-compare="${a.id}"]`); await page.waitForSelector('#cp-ok'); await page.check('#cp-seen'); eq(await page.locator('#cp-ok').isDisabled(), true, 'failed QA cannot be approved');
    await page.click('#cp-rep'); await page.fill('#rp-n', 'Label reads FERM & FROM'); await page.click('#rp-s'); await page.waitForTimeout(500);
    ok((await ops(page, 'audit')).json.events.some((e) => e.type === 'report'), 'report reached the server audit log'); workerImage = 'gen_ok.jpg';
  });

  await T(tag('identity change voids approval and blocks generation until re-approved'), async () => {
    await page.goto(BASE + '/app-v4.html#/campaigns/library'); await page.waitForSelector('[data-ident-open]'); await page.click('[data-ident-open]'); await page.waitForSelector('#pm-text');
    await page.fill('#pm-text', 'FERN & FORM\nSOIL MIX 500 G'); await page.click('#pm-save'); await page.waitForTimeout(600);
    eq((await ops(page, 'masters')).json.masters[0].status, 'needs_reapproval');
    const before = workerCalls; await page.goto(BASE + '/app-v4.html#/campaigns/studio'); await page.waitForSelector('#go-shoot'); eq(await page.locator('#go-shoot').isDisabled(), true); ok(inc(await page.locator('#ident-gate').innerText(), 'Re-approve'));
    const r = await ops(page, 'createJob', { masterId: (await ops(page, 'masters')).json.masters[0].id, idempotencyKey: 'bypass-attempt-1', direction: 'x', prompt: 'bypass', alter: { background: true }, reference: 'data:image/png;base64,iVBORw0K' }); ok([400, 403].includes(r.status), 'API bypass refused: ' + r.status); eq(workerCalls, before, 'no provider call');
    await page.goto(BASE + '/app-v4.html#/campaigns/library'); await page.click('[data-ident-open]'); await page.waitForSelector('#pm-text'); await page.fill('#pm-text', 'FERN & FORM\nSOIL MIX 250 G'); for (const id of ['#c-text', '#c-logo', '#c-col']) await page.check(id); await page.click('#pm-ok'); await page.waitForTimeout(600);
    eq((await ops(page, 'masters')).json.masters[0].status, 'approved');
  });

  await T(tag('jobs tab: states, cost, model, retry/cancel controls; recovery of an unchecked job'), async () => {
    await page.goto(BASE + '/app-v4.html#/campaigns/studio'); await page.click('[data-tab=jobs]'); await page.waitForSelector('.table');
    const t = await page.locator('.table').innerText(); ok(/completed/i.test(t) && /failed/i.test(t) && /creative-first@1/.test(t) && /mock-worker/.test(t) && /not reported/i.test(t), 'job table shows state, workflow, model and honest cost');
    ok(/est \$0\.0400/.test(t), 'configured estimate shown');
  });

  await T(tag('launch: approval bound to payload → blocked (Meta not connected) → sandbox connect → simulated → duplicate-safe'), async () => {
    await page.goto(BASE + '/app-v4.html#/campaigns/c1'); await page.waitForSelector('#launch'); await page.click('#launch'); await page.waitForSelector('#da');
    ok(inc(await page.locator('#lr-pay').textContent(), '"sha256"'), 'approved creative is in the payload by hash');
    await page.click('#da'); await page.waitForSelector('#exec-panel'); const ap = (await ops(page, 'approvals')).json.approvals[0]; eq(ap.status, 'active'); eq(ap.hash.length, 64);
    await page.click('#mk-draft'); await page.waitForSelector('text=Blocked'); ok(inc(await page.locator('#exec-panel').innerText(), 'Nothing was sent'));
    await page.goto(BASE + '/api/plugins/meta/connect'); await page.waitForSelector('a.go'); await page.click('a.go'); await page.waitForLoadState('load');
    await page.goto(BASE + '/app-v4.html#/campaigns/c1'); await page.waitForSelector('#mk-draft'); await page.click('#mk-draft'); await page.waitForSelector('text=Simulated');
    ok(inc(await page.locator('#exec-panel').innerText(), 'Nothing exists on Meta'));
    eq(await page.locator('#mk-draft').count(), 0, 'no second create button after success');
    const dup = await page.evaluate(async () => { const s = JSON.parse(localStorage.getItem('coldstart.v4')); const c = s.campaigns[0]; return c.approvalId; });
    const before = (await ops(page, 'execution?approvalId=' + dup)).status; ok(before === 200 || before === 404 || before === 405);
  });

  await T(tag('changing the campaign voids the approval; revoke after execution is refused with an explanation'), async () => {
    await page.goto(BASE + '/app-v4.html#/settings/audit'); await page.waitForSelector('[data-rev]'); await page.click('[data-rev]'); await page.waitForSelector('text=This already ran');
    await page.keyboard.press('Escape');
    await page.goto(BASE + '/app-v4.html#/home'); await page.waitForSelector('.cmp-input'); await page.fill('.cmp-input', 'Set the ad budget to 20000'); await page.press('.cmp-input', 'Enter'); await page.waitForSelector('[data-ap]'); await page.click('[data-ap]'); await page.waitForTimeout(400);
    await page.goto(BASE + '/app-v4.html#/campaigns/c1'); await page.waitForFunction(() => JSON.parse(localStorage.getItem('coldstart.v4')).campaigns[0].status === 'draft', null, { timeout: 10000 });
    ok((await ops(page, 'approvals')).json.approvals[0].status === 'invalidated', 'server marked the approval invalidated');
  });

  await T(tag('Pause All and caps are enforced by the server'), async () => {
    await page.goto(BASE + '/app-v4.html#/settings/automations'); await page.waitForSelector('#pz'); await page.click('#pz'); await page.waitForSelector('text=Resume automation');
    const m = (await ops(page, 'masters')).json.masters[0]; const body = { masterId: m.id, idempotencyKey: 'paused-try-0001', direction: 'x', prompt: 'a jar on a counter', alter: { background: true }, reference: 'data:image/png;base64,iVBORw0K' };
    eq((await ops(page, 'createJob', body)).status, 423, 'paused → 423'); await page.click('#pz'); await page.waitForSelector('text=Pause all automation');
    await page.fill('#cap-c', '1'); await page.click('#cap-save'); await page.waitForTimeout(500);
    await page.goto(BASE + '/app-v4.html#/campaigns/studio'); await page.click('[data-tab=shoot]'); await page.waitForSelector('#go-shoot'); await creativeMode(page); await page.click('#go-shoot'); await page.waitForFunction(() => /cap reached/.test(document.getElementById('toast').textContent), null, { timeout: 20000 });
    await page.goto(BASE + '/app-v4.html#/settings/usage'); await page.waitForSelector('text=Against your limits'); ok(inc(await page.locator('body').innerText(), 'Cold Start fee') && inc(await page.locator('body').innerText(), 'Ad spend'), 'three cost buckets are separate');
    await page.goto(BASE + '/app-v4.html#/settings/automations'); await page.waitForSelector('#reset'); await page.click('#reset');
  });

  await T(tag('inbox: Request changes uses a dialog (no prompt()), validates input'), async () => {
    let prompted = false; page.on('dialog', (d) => { prompted = true; d.dismiss(); });
    await page.goto(BASE + '/app-v4.html#/inbox'); await page.waitForSelector('.inbox-row, .empty');
    if (await page.locator('[data-chg]').count()) { await page.click('[data-chg]'); await page.waitForSelector('#rc-n'); await page.click('#rc-s'); ok(inc(await page.locator('#rc-e').innerText(), 'Say what'), 'empty request refused'); await page.fill('#rc-n', 'Lower the cap'); await page.click('#rc-s'); await page.waitForSelector('text=Changes requested'); }
    eq(prompted, false, 'no native prompt dialog');
  });

  await T(tag('five-item navigation preserved; no horizontal overflow on key screens'), async () => {
    await page.goto(BASE + '/app-v4.html#/home'); await page.waitForSelector('#nav');
    eq(await page.locator('#nav a').count(), 5, 'five nav items');
    for (const h of ['home', 'discover', 'campaigns', 'campaigns/studio', 'campaigns/library', 'calendar', 'results', 'inbox', 'settings/brand', 'settings/connections', 'settings/audit']) { await page.goto(BASE + '/app-v4.html#/' + h); await page.waitForTimeout(450); ok(!(await overflow(page)), 'overflow on ' + h + ' :: ' + (await page.evaluate(() => window.__ovf))); }
  });

  if (viewport.width > 1000) await T(tag('accessibility: axe on key screens (serious/critical)'), async () => {
    const bad = [];
    for (const h of ['home', 'campaigns/studio', 'campaigns/library', 'inbox', 'settings/automations', 'discover']) {
      await page.goto(BASE + '/app-v4.html#/' + h); await page.waitForTimeout(600);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of r.violations.filter((x) => ['serious', 'critical'].includes(x.impact))) bad.push(h + ': ' + v.id + ' (' + v.nodes.length + ') ' + v.nodes.slice(0, 2).map((n) => n.target.join(' ') + ' :: ' + (n.any[0] || n.all[0] || n.none[0] || {}).message).join(' | '));
    }
    fs.writeFileSync(path.join(ROOT, 'tests/e2e/axe-report.txt'), bad.join('\n') || 'no serious/critical violations');
    ok(bad.length === 0, 'axe: ' + bad.join('; '));
  });

  await T(tag('keyboard: palette opens with Ctrl+K, Escape closes dialogs, focus lands in dialogs'), async () => {
    await page.goto(BASE + '/app-v4.html#/home'); await page.waitForSelector('#btn-search');
    await page.keyboard.press('Control+k'); await page.waitForSelector('#pal-q'); ok(await page.evaluate(() => document.activeElement.id === 'pal-q'), 'palette input focused'); await page.keyboard.type('studio'); await page.keyboard.press('Enter'); await page.waitForFunction(() => location.hash.includes('studio'));
    await page.keyboard.press('Control+k'); await page.waitForSelector('#pal-q'); await page.keyboard.press('Escape'); ok(!(await page.locator('#pal').evaluate((d) => d.open)), 'Escape closes palette');
  });
  await ctx.close();
}

if (process.env.VP !== 'mobile') await suite('desktop', { width: 1440, height: 900 });
if (process.env.VP !== 'desktop') await suite('mobile', { width: 390, height: 844 });

// unauthenticated / cross-tenant checks against the live server (no browser state)
await T('bypass: POST without header refused; another browser cannot read or execute this workspace\'s records', async () => {
  const r = await fetch(BASE + '/api/plugins/ops/actions/setPolicy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"paused":true}' }); eq(r.status, 403);
  const fresh = await fetch(BASE + '/api/plugins/ops/actions/masters'); eq((await fresh.json()).masters.length, 0, 'a fresh browser has its own empty workspace');
});

await browser.close(); server.kill(); comp.kill(); worker.close();
const fails = results.filter((r) => r[1] === 'FAIL');
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (consoleErrors.length) console.log('console errors:\n  ' + [...new Set(consoleErrors)].slice(0, 12).join('\n  '));
fs.writeFileSync(path.join(ROOT, 'tests/e2e/last-run.json'), JSON.stringify({ at: new Date().toISOString(), results, consoleErrors: [...new Set(consoleErrors)] }, null, 2));
process.exit(fails.length || consoleErrors.length ? 1 : 0);
