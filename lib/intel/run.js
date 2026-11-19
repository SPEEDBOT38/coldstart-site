// The insights run: brand → instagram → pull → analyze → synthesize → write → review → done.
// Ported from MetaCroc lib/pipeline.js. The run is plain data that the browser keeps and sends back, and every
// step does one bounded unit of work, so each HTTP call stays inside the serverless time limit. The client calls
// step() until the run is done. Ad images are composed in the browser from the real product photos.
import { generateJson } from '../ai.js';
import * as P from './prompts.js';
import { guardVariant, claimContext, phraseSet } from './claims.js';
import { hasApify, igHandle, startIgPull, normalizePost, startAdPull, pollRun, fetchItems, assignToCompetitors } from './apify.js';
import { str, clip } from './util.js';

export const RUN_TTL = 30 * 24 * 3600;
const IG_GIVE_UP_MS = 150000, PULL_GIVE_UP_MS = 170000;
const ANALYZE_BATCH = 3, ANALYZE_MAX = 30;
const STAGE_RETRIES = 2;
export const STAGES = ['brand', 'instagram', 'pull', 'analyze', 'synthesize', 'write', 'review', 'done'];

// The run is stateless on the server: the browser keeps it and sends it back with each step (Vercel instances do not share /tmp).
function log(run, text, kind = 'info') {
  run.log = [...(run.log || []), { t: new Date().toISOString(), text: str(text, 220), kind }].slice(-60);
}

export function newRun(input) {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const brand = input.brand || {};
  return {
    id, created: new Date().toISOString(), updated: new Date().toISOString(), stage: 'brand',
    input: {
      brand: { name: str(brand.name, 120), site: str(brand.url, 300), ig: igHandle(brand.ig) || '', line: str(brand.line, 400), voice: str(brand.voice, 200), avoid: str(brand.avoid, 300), currency: brand.currency || 'INR' },
      kit: input.kit || {},
      products: (input.products || []).filter(p => p && p.name).slice(0, 12).map(p => ({ name: str(p.name, 140), price: p.price ?? null, image: p.image || null, url: p.url || null })),
      icps: (input.icps || []).slice(0, 3),
      competitors: [...new Set((input.competitors || []).map(c => str(c, 80)).filter(Boolean))].slice(0, 4),
      country: /^[A-Z]{2}$/.test(input.country || '') ? input.country : 'IN',
      category: str(input.category || brand.category || brand.product, 120),
      notes: str(input.notes, 400),
    },
    log: [], brand: null, ig: null, posts: [], icps_ig: [], adPulls: null, ads: {}, analyses: {}, synthesis: null,
    variants: [],
  };
}

function briefOf(run) {
  const b = run.brand || {};
  return { name: b.name || run.input.brand.name, sells: b.sells || run.input.brand.line, tone_of_voice: b.tone_of_voice || run.input.brand.voice, voice_traits: b.voice_traits || [], voice_sample: b.voice_sample || '', target_buyer: b.target_buyer || '' };
}

// The run as the browser sees it: the same object, sent back on the next step.
export function publicView(run) { return run; }

async function siteText(url) {
  if (!url) return '';
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; Coldstart/0.3)' } });
    const html = await r.text();
    return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
  } catch (_) { return ''; }
}

/* ---------------- stages ---------------- */

async function stageBrand(run, ctx) {
  const text = await siteText(run.input.brand.site);
  const known = { name: run.input.brand.name, sells: run.input.brand.line, voice: run.input.brand.voice, avoid: run.input.brand.avoid, products: run.input.products.map(p => p.name).slice(0, 8), currency: run.input.brand.currency };
  const r = await generateJson({ fetch: ctx.fetch, system: P.BRAND_SYSTEM, temperature: 0.3, maxTokens: 1200, deadline: 40000,
    prompt: `SITE TEXT (may be partial):\n${text || '(site could not be read)'}\n\nFACTS THE FOUNDER GAVE: ${JSON.stringify(known)}\nUse only what the source supports.`,
    validate: d => (d && typeof d.name === 'string' && d.name ? null : 'no brand name') });
  run.brand = { ...r.data, read_from: text ? 'website' : 'founder', provider: r.model };
  log(run, 'read ' + (run.brand.name || 'the brand') + (text ? ' from the website' : ' from what you told Coldie'), 'ok');
  run.stage = run.input.brand.ig && hasApify() ? 'instagram' : 'pull';
  if (run.input.brand.ig && !hasApify()) log(run, 'Instagram needs APIFY_TOKEN on the server: skipped, the ICPs come from onboarding', 'warn');
}

async function deriveIcps(run, ctx, posts) {
  const captions = posts.filter(p => p.caption).slice(0, 12).map(p => str(p.caption, 280));
  const r = await generateJson({ fetch: ctx.fetch, system: P.ICP_SYSTEM, temperature: 0.4, maxTokens: 1800, deadline: 30000,
    prompt: `BRAND: ${JSON.stringify(briefOf(run))}\nINSTAGRAM CAPTIONS (the founder's own posts, newest first):\n${JSON.stringify(captions)}`,
    validate: d => (Array.isArray(d) && d.length >= 1 ? null : 'expected an array of ICPs') });
  return r.data.slice(0, 3).map((x, i) => ({ role: i ? 'backup' : 'main', name: str(x.name, 60), who: str(x.who, 200), pain: str(x.pain, 200), scroll: (x.scroll || []).slice(0, 3).map(s => str(s, 40)), hook: str(x.hook, 160), fmt: str(x.fmt, 40), evidence: str(x.evidence, 240), source: 'instagram' }));
}

async function stageInstagram(run, ctx) {
  if (!run.ig) {
    const handle = run.input.brand.ig;
    run.ig = { handle, ...(await startIgPull(handle)) };
    log(run, 'reading @' + handle + ' on Instagram (about a minute)');
    return;
  }
  const st = await pollRun(run.ig.runId);
  if (['READY', 'RUNNING', 'TIMING-OUT'].includes(st.status)) {
    if (Date.now() - run.ig.startedAt > IG_GIVE_UP_MS) { log(run, 'Instagram is slow: continuing without it', 'warn'); run.stage = 'pull'; }
    return;
  }
  if (st.status !== 'SUCCEEDED') { log(run, 'Instagram read did not finish (' + st.status + '): continuing without it', 'warn'); run.stage = 'pull'; return; }
  const items = await fetchItems(st.datasetId, 40);
  run.posts = items.map(it => normalizePost(it, run.ig.handle)).filter(Boolean);
  log(run, 'read ' + run.posts.length + ' Instagram posts from @' + run.ig.handle, run.posts.length ? 'ok' : 'warn');
  if (run.posts.length) {
    run.icps_ig = await deriveIcps(run, ctx, run.posts);
    log(run, 'found ' + run.icps_ig.length + ' ICPs in those posts', 'ok');
  }
  run.stage = 'pull';
}

async function stagePull(run) {
  const names = run.input.competitors;
  if (!names.length) { log(run, 'no competitors given: skipping the Meta Ad Library read', 'warn'); run.stage = 'synthesize'; return; }
  if (!hasApify()) { log(run, 'competitor ads need APIFY_TOKEN on the server', 'warn'); run.stage = 'synthesize'; return; }
  if (!run.adPulls) {
    run.adPulls = {};
    for (const name of names) run.adPulls[name] = { ...(await startAdPull(name, run.input.country)), status: null };
    log(run, 'pulling live Meta ads for ' + names.join(', ') + ' (about a minute)');
    return;
  }
  const waiting = [];
  for (const [name, job] of Object.entries(run.adPulls)) {
    if (job.status) continue;
    const st = await pollRun(job.runId);
    if (['READY', 'RUNNING', 'TIMING-OUT'].includes(st.status)) {
      if (Date.now() - job.startedAt > PULL_GIVE_UP_MS) { job.status = 'SLOW'; log(run, name + ': the ad pull is slow, continuing without it', 'warn'); }
      else waiting.push(name);
      continue;
    }
    job.status = st.status; job.datasetId = st.datasetId;
  }
  if (waiting.length) return;
  run.ads = {};
  for (const [name, job] of Object.entries(run.adPulls)) {
    const list = job.status === 'SUCCEEDED' ? (assignToCompetitors(await fetchItems(job.datasetId, 300), [{ name }]).get(name) || []) : [];
    run.ads[name] = list;
    log(run, list.length ? name + ': ' + list.length + ' live ads' : name + ': no ads matched this name (not found, not guessed)', list.length ? 'ok' : 'warn');
  }
  run.stage = 'analyze';
}

async function stageAnalyze(run, ctx) {
  const all = Object.values(run.ads).flat();
  const todo = all.filter(a => !run.analyses[a.id]).slice(0, Math.min(ANALYZE_BATCH, ANALYZE_MAX - Object.keys(run.analyses).length));
  if (!todo.length || Object.keys(run.analyses).length >= ANALYZE_MAX) { run.stage = 'synthesize'; return; }
  const images = await Promise.all(todo.map(a => (a.image_url ? toDataUrl(a.image_url, { fetchImpl: ctx.fetch }) : null)));
  const text = todo.map((a, i) => [
    'AD #' + (i + 1) + ' — competitor: ' + a.competitor, '  running ' + (a.days_running ?? '?') + ' days · ' + a.collation_count + ' variant(s) · format ' + a.display_format,
    '  primary text: ' + str(a.body, 700), '  headline: ' + str(a.headline, 120), '  cta: ' + (a.cta || 'none'),
    images[i] ? '  (the creative image is attached, in order)' : '  (no image available: read the copy only)',
  ].join('\n')).join('\n\n');
  const r = await generateJson({ fetch: ctx.fetch, system: P.ANALYZE_SYSTEM, temperature: 0.2, maxTokens: 3000, timeout: 45000, deadline: 55000,
    images: images.filter(Boolean), prompt: text + '\n\nReturn the JSON array with one object per AD #, in order.',
    validate: d => (Array.isArray(d) && d.length ? null : 'expected an array with one read per ad') });
  todo.forEach((a, i) => {
    const read = r.data.find(x => Number(x.i) === i + 1) || r.data[i];
    if (read) run.analyses[a.id] = read;
  });
  log(run, 'read ' + Object.keys(run.analyses).length + ' competitor ads so far');
  if (Object.keys(run.analyses).length >= ANALYZE_MAX || Object.values(run.ads).flat().every(a => run.analyses[a.id])) run.stage = 'synthesize';
}

async function stageSynthesize(run, ctx) {
  const compact = Object.entries(run.ads).map(([name, list]) => ({ competitor: name, ads: list.filter(a => run.analyses[a.id]).map(a => ({
    id: a.id, days_running: a.days_running, variants: a.collation_count, headline: str(a.headline, 100), copy: str(a.body, 240), read: run.analyses[a.id] })) }));
  const audiences = run.input.icps.length ? run.input.icps.map(i => ({ name: i.name, who: i.who, need: i.pain })) : null;
  const r = await generateJson({ fetch: ctx.fetch, strong: true, system: P.SYNTH_SYSTEM, temperature: 0.3, maxTokens: 4000, timeout: 50000, deadline: 55000,
    prompt: `RIVALS: ${JSON.stringify(run.input.competitors)}\nFOUNDER BRAND: ${JSON.stringify(briefOf(run))}\n` +
      (audiences ? `FOUNDER-DEFINED AUDIENCES (use these names exactly): ${JSON.stringify(audiences)}\n` : '') +
      `FOUNDER'S OWN INSTAGRAM CAPTIONS: ${JSON.stringify(run.posts.slice(0, 8).map(p => str(p.caption, 200)))}\n` +
      `COMPETITOR ADS: ${JSON.stringify(compact)}`,
    validate: d => (d && Array.isArray(d.competitors) && d.niche ? null : 'missing competitors or niche') });
  run.synthesis = r.data;
  log(run, 'wrote the competitor analysis and the open space', 'ok');
  run.stage = 'write';
}

// The product whose name the ad words name; each ad gets a product no earlier ad used, while there are any left.
function pickProduct(products, v, idx, used = []) {
  if (!products.length) return null;
  const free = products.filter(p => !used.includes(p.name));
  const pool = free.length ? free : products;
  const hay = [v.primary_text, v.headline, v.creative_direction, v.overlay_text].join(' ').toLowerCase();
  let best = null, bs = 0;
  for (const p of pool) {
    const words = String(p.name).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    const s = words.filter(w => hay.includes(w)).length + (hay.includes(String(p.name).toLowerCase()) ? 3 : 0);
    if (s > bs) { best = p; bs = s; }
  }
  return best || pool[idx % pool.length];
}

const CTAS = ['Shop now', 'Learn more', 'Sign up', 'Get offer', 'Order now', 'Subscribe', 'Book now', 'Get quote'];
function normalizeVariant(raw, ctx) {
  const { variant: v, flagged } = guardVariant(raw, ctx);
  const cta = CTAS.find(c => c.toLowerCase() === String(v.cta || '').trim().toLowerCase()) || 'Shop now';
  return {
    angle: String(v.angle || 'aspiration').toLowerCase(), hook_type: str(v.hook_type, 40), format: str(v.format || 'static image', 30),
    placement: str(v.placement || 'IG feed', 20), overlay_text: clip(str(v.overlay_text, 80), 60),
    primary_text: clip(str(v.primary_text, 320), 300), headline: clip(str(v.headline, 50), 40), description: clip(str(v.description, 40), 30), cta,
    creative_direction: str(v.creative_direction, 400), inspired_by: v.inspired_by && typeof v.inspired_by === 'object' ? { competitor: str(v.inspired_by.competitor, 60), ad_id: str(v.inspired_by.ad_id, 60), what_we_borrowed: str(v.inspired_by.what_we_borrowed, 140) } : null,
    why_this_angle: str(v.why_this_angle, 220), audience: str(v.audience, 80),
    pos: v.position && Number.isFinite(Number(v.position.x)) ? { x: Math.max(-1, Math.min(1, Number(v.position.x))), y: Math.max(-1, Math.min(1, Number(v.position.y) || 0)) } : null,
    claims_flagged: flagged,
  };
}

// Rival spacing: a new ad must not sit on top of a rival ad (ported from MetaCroc lib/util.js clearOfRivals).
function clearOfRivals(vars, rivals, min = 0.3) {
  const placed = [];
  const near = (q, others) => others.length ? Math.min(...others.map(o => Math.hypot(q.x - o.x, q.y - o.y))) : 9;
  return vars.map(v => {
    const p = v.pos || { x: 0, y: 0 };
    const others = [...rivals, ...placed];
    if (near(p, others) >= min) { placed.push(p); return v; }
    let best = null, roomiest = null;
    for (let gx = -1; gx <= 1.0001; gx += 0.05) for (let gy = -1; gy <= 1.0001; gy += 0.05) {
      const q = { x: Math.round(gx * 100) / 100, y: Math.round(gy * 100) / 100 };
      const room = near(q, others), move = Math.hypot(q.x - p.x, q.y - p.y);
      if (!roomiest || room > roomiest.room) roomiest = { q, room };
      if (room >= min && (!best || move < best.move)) best = { q, move };
    }
    const q = (best || roomiest).q;
    placed.push(q);
    return { ...v, pos: { x: q.x, y: q.y }, moved: true };
  });
}

async function stageWrite(run, ctx) {
  const syn = run.synthesis || {};
  const target = (syn.audiences || []).find(a => a.name === syn.recommended_audience) || null;
  const winners = Object.values(run.ads).flat().filter(a => run.analyses[a.id]).sort((a, b) => (b.days_running || 0) - (a.days_running || 0)).slice(0, 6)
    .map(a => ({ id: a.id, competitor: a.competitor, days_running: a.days_running, hook: run.analyses[a.id].hook, angle: run.analyses[a.id].angle, headline: a.headline, copy: str(a.body, 200) }));
  const products = run.input.products.map(p => ({ name: p.name, price: p.price }));
  const src = { ...claimContext({ brand: run.brand, input: { brand: run.input.brand, notes: run.input.notes, competitors: run.input.competitors.map(name => ({ name })) } }), grams: phraseSet(Object.values(run.ads).flat().flatMap(a => [a.body, a.headline])) };
  // The founder supplied these products and prices, so they are evidence, not claims to strip.
  src.source += ' ' + run.input.products.map(p => [p.name, p.price != null ? '₹' + p.price + ' ' + p.price : ''].join(' ')).join(' ').toLowerCase();
  const ask = (fix) => generateJson({ fetch: ctx.fetch, strong: true, system: P.GENERATE_SYSTEM, temperature: 0.7, maxTokens: 3500, timeout: 50000, deadline: 55000,
    prompt: `FOUNDER BRAND PROFILE: ${JSON.stringify(briefOf(run))}\nFOUNDER SAYS (say / avoid): ${run.input.notes || 'nothing specific'}; avoid: ${run.input.brand.avoid || 'none'}\n` +
      `PRODUCTS TO ADVERTISE (real, with prices): ${JSON.stringify(products)}\nAD GOAL: store visits and first purchase. PRICES: quote the exact price of a product from the list above; never write [price] when one is given there\n` +
      `COMPETITOR READ: ${JSON.stringify({ competitors: syn.competitors, niche: syn.niche })}\n` +
      (target ? `TARGET AUDIENCE: ${JSON.stringify({ name: target.name, who: target.who, need: target.need })}\n` : '') +
      (run.posts.length ? `FOUNDER'S OWN CAPTIONS (their voice): ${JSON.stringify(run.posts.slice(0, 6).map(p => str(p.caption, 200)))}\n` : '') +
      `WINNING COMPETITOR ADS: ${JSON.stringify(winners)}` + (fix || ''),
    validate: d => (Array.isArray(d) && d.length >= 3 ? null : 'expected exactly 3 variants in an array') });
  let raw = (await ask('')).data.slice(0, 3);
  if (new Set(raw.map(v => v.angle)).size < 3) raw = (await ask('\n\nIMPORTANT: the three variants must use three DIFFERENT angles.')).data.slice(0, 3);
  let vars = raw.map(v => normalizeVariant(v, src));
  vars = clearOfRivals(vars, Object.values(run.ads).flat().map(a => run.analyses[a.id]?.position).filter(Boolean).map(p => ({ x: p.x, y: p.y })));
  const used = [];
  run.variants = vars.map((v, i) => {
    const p = pickProduct(run.input.products, v, i, used);
    if (p) used.push(p.name);
    // A known price is filled in for any [price] the model left behind; the founder supplied it, so it is not a claim.
    const fill = s => (p && p.price != null ? String(s || '').replace(/[price]/gi, '₹' + p.price) : s);
    const out = { ...v, primary_text: fill(v.primary_text), headline: fill(v.headline), description: fill(v.description), overlay_text: fill(v.overlay_text) };
    if (p && p.price != null) out.claims_flagged = (v.claims_flagged || []).filter(c => c !== 'price');
    return { ...out, idx: i, product: p?.name || null, product_image: p?.image || null, image: null, paint_error: null };
  });
  log(run, 'wrote 3 ads: ' + run.variants.map(v => v.angle).join(' / '), 'ok');
  run.stage = 'review';
}

// Review pass: a strong model checks the three ads against the rules before they are saved.
async function stageReview(run, ctx) {
  const ads = run.variants.map(v => ({ angle: v.angle, product: v.product, headline: v.headline, overlay_text: v.overlay_text, primary_text: v.primary_text, description: v.description, cta: v.cta, why_this_angle: v.why_this_angle, audience: v.audience }));
  const known = run.input.products.map(p => ({ name: p.name, price: p.price }));
  try {
    const r = await generateJson({ fetch: ctx.fetch, strong: true, system: P.REVIEW_SYSTEM, temperature: 0.2, maxTokens: 3000, timeout: 50000, deadline: 55000,
      prompt: `PRODUCTS (real names and prices): ${JSON.stringify(known)}
FOUNDER BRAND: ${JSON.stringify(briefOf(run))}
ADS TO REVIEW: ${JSON.stringify(ads)}`,
      validate: d => (Array.isArray(d) && d.length === 3 ? null : 'expected exactly 3 reviewed ads') });
    const fixed = r.data.map((x, i) => ({ ...run.variants[i], ...Object.fromEntries(['overlay_text', 'headline', 'primary_text', 'description', 'cta'].map(k => [k, x[k] != null ? str(x[k], k === 'primary_text' ? 300 : 60) : run.variants[i][k]])), review_note: str(x.review_note, 160) }));
    run.variants = fixed;
    log(run, 'reviewed the three ads: ' + fixed.map(v => v.review_note || 'ok').join(' / '), 'ok');
  } catch (e) {
    log(run, 'review pass skipped: ' + str(e.message, 120), 'warn');
  }
  run.stage = 'done';
  log(run, 'done: ' + run.variants.length + ' ads ready', 'ok');
}

/* ---------------- driver ---------------- */

// Advance one bounded step on the run the browser sent. Returns the run.
export async function step(run, ctx = {}) {
  if (!run || typeof run !== 'object' || !run.stage || !run.id) throw Object.assign(new Error('Missing or unreadable insights run.'), { status: 400 });
  if (run.stage === 'done' || run.stage === 'failed') return { run, image: null, done: true };
  try {
    if (run.stage === 'brand') await stageBrand(run, ctx);
    else if (run.stage === 'instagram') await stageInstagram(run, ctx);
    else if (run.stage === 'pull') await stagePull(run, ctx);
    else if (run.stage === 'analyze') await stageAnalyze(run, ctx);
    else if (run.stage === 'synthesize') await stageSynthesize(run, ctx);
    else if (run.stage === 'write') await stageWrite(run, ctx);
    else if (run.stage === 'review') await stageReview(run, ctx);
  } catch (e) {
    // A slow or flaky model call is retried; if it keeps failing, reading and analysis are optional, so the run moves on
    // without them. Copy cannot be skipped, so those stop the run with the reason.
    const failed = run.stage;
    run.retries = { ...(run.retries || {}), [failed]: (run.retries?.[failed] || 0) + 1 };
    if (run.retries[failed] <= STAGE_RETRIES) log(run, failed + ' is slow or unavailable, trying again (' + run.retries[failed] + '/' + STAGE_RETRIES + '): ' + str(e.message, 120), 'warn');
    else if (failed === 'analyze') { log(run, 'competitor reads skipped after ' + STAGE_RETRIES + ' retries: ' + str(e.message, 120), 'warn'); run.stage = 'synthesize'; }
    else if (failed === 'synthesize') { log(run, 'competitor summary skipped after ' + STAGE_RETRIES + ' retries: ' + str(e.message, 120), 'warn'); run.stage = 'write'; }
    else { log(run, 'stopped at ' + failed + ': ' + str(e.message, 180), 'error'); run.error = { stage: failed, message: str(e.message, 240) }; run.stage = 'failed'; }
  }
  return { run, done: run.stage === 'done' || run.stage === 'failed' };
}

export function create(input) {
  const run = newRun(input);
  log(run, 'starting: reading ' + (run.input.brand.name || 'the brand') + ' and its competitors', 'ok');
  return run;
}

