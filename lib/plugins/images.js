// Images plugin: post visuals from the Coldstart image worker (Cloudflare Workers AI, FLUX / SDXL),
// with Gemini turning a draft into an image prompt. Free tier ≈ 170 FLUX images/day; capped below it.
import { generateJson, aiProvider } from '../ai.js';
import { PluginError, need } from './http.js';
import { charge } from '../budget.js';
import { paintImage, hasGeminiImage, generationCost } from '../gemini-image.js';
import { studioPrompt } from '../intel/scene.js';

// Gemini image models (see lib/gemini-image.js) are the default. FLUX on Cloudflare is the fallback when no OpenRouter key is set.
// P0 gate: the Product Lock ad pipeline is off in Production unless enabled. CREATIVE_PIPELINE=on enables it for everyone;
// CREATIVE_PIPELINE_WORKSPACES=<ws id>,<ws id> enables it only for those workspaces (the authorized test workspace).
// CREATIVE_PIPELINE=off disables it everywhere. Outside Production it is on by default.
export const creativePipelineOn = (ctx) => {
  if (process.env.CREATIVE_PIPELINE === 'off') return false;
  if (process.env.CREATIVE_PIPELINE === 'on' || process.env.VERCEL_ENV !== 'production') return true;
  const allow = (process.env.CREATIVE_PIPELINE_WORKSPACES || '').split(',').map(x => x.trim()).filter(Boolean);
  return !!(ctx && ctx.ws && allow.includes(String(ctx.ws)));
};
// Spending bound per workspace: confirmed charges plus a pessimistic estimate for every attempt whose charge is not yet
// confirmed. Generation stops before the next request could cross the budget. Unknown never counts as $0.
const BUDGET = () => Number(process.env.CREATIVE_BUDGET_USD || 3);
const EST = () => Number(process.env.CREATIVE_EST_USD_PER_IMAGE || 0.25);   // above Gemini 3 Pro Image list price, on purpose
async function spend(ctx) {
  const l = await ledger(ctx); const scenes = l.records.filter(r => r.kind === 'scene');
  const usd = scenes.reduce((a, r) => a + (typeof r.usd === 'number' ? r.usd : EST()), 0);
  return { bound_usd: usd, budget_usd: BUDGET(), attempts: scenes.length };
}
const gate = async (ctx, { cost = false } = {}) => {
  if (!creativePipelineOn(ctx)) throw new PluginError('Ad generation is paused while the new product-accurate pipeline is validated. Your drafts and products are unaffected.', 403);
  if (cost) { const s = await spend(ctx); if (s.bound_usd + EST() > s.budget_usd) throw new PluginError(`Ad generation stopped: this workspace's test budget ($${s.budget_usd.toFixed(2)}) would be exceeded (spent or reserved $${s.bound_usd.toFixed(2)}).`, 402); }
};

// Generation ledger: one record per provider attempt, per workspace. Kept 90 days.
const LEDGER_TTL = 90 * 86400;
const wsOf = ctx => String(ctx.ws || 'anon');
async function ledgerAdd(ctx, rec) {
  const k = 'gen:' + wsOf(ctx) + ':' + rec.at + ':' + Math.random().toString(36).slice(2, 8);
  await ctx.store.set(k, rec, LEDGER_TTL);
  const idx = (await ctx.store.get('genidx:' + wsOf(ctx))) || [];
  idx.push(k); await ctx.store.set('genidx:' + wsOf(ctx), idx.slice(-500), LEDGER_TTL);
}
export async function ledger(ctx, { refresh = false } = {}) {
  const idx = (await ctx.store.get('genidx:' + wsOf(ctx))) || [];
  const recs = [];
  for (const k of idx) {
    const r = await ctx.store.get(k); if (!r) continue;
    if (refresh && r.usd == null && r.generation_id) { const c = await generationCost(r.generation_id, { fetchImpl: ctx.fetch }); if (c) { r.usd = c.usd; r.cost_source = 'openrouter_generation_api'; await ctx.store.set(k, r, LEDGER_TTL); } }
    recs.push(r);
  }
  const known = recs.filter(r => typeof r.usd === 'number');
  const byJob = {};
  for (const r of recs) { const j = r.job || 'unassigned'; (byJob[j] = byJob[j] || { attempts: 0, failed: 0, empty: 0, usd: 0, unknown: 0 }); const b = byJob[j]; b.attempts++; if (!r.ok) b.failed++; if (r.empty) b.empty++; if (typeof r.usd === 'number') b.usd += r.usd; else b.unknown++; }
  return { records: recs, total: { attempts: recs.length, failed: recs.filter(r => !r.ok).length, empty: recs.filter(r => r.empty).length, usd_known: known.reduce((a, r) => a + r.usd, 0), unknown_cost: recs.length - known.length }, by_job: byJob };
}

// Gemini image models (see lib/gemini-image.js) are the default. FLUX on Cloudflare is the fallback when no OpenRouter key is set.
// requestId makes a call idempotent: a client retry with the same id gets the stored result and is not billed again.
async function geminiImage(ctx, input) {
  if (input.job || input.raw) await gate(ctx, { cost: true });
  const rid = typeof input.requestId === 'string' && /^[\w-]{8,64}$/.test(input.requestId) ? input.requestId : null;
  const rkey = rid && 'genreq:' + wsOf(ctx) + ':' + rid;
  if (rkey) { const prev = await ctx.store.get(rkey); if (prev && prev.image) return { ...prev, idempotent_replay: true }; if (prev && prev.pending) throw new PluginError('This generation is still running; try again in a few seconds.', 409); }
  await charge(ctx.store, 'image', ctx.ip, { daily: Number(process.env.IMAGE_DAILY_LIMIT) || 300, hourlyPerIp: 40 });
  if (rkey && !(await ctx.store.setnx(rkey, { pending: true }, 300))) throw new PluginError('This generation is already running.', 409);
  const ref = typeof input.reference === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(input.reference) && input.reference.length < 6000000 ? input.reference : null;
  const idea = String(input.prompt || '').trim();
  need(idea.length >= 3 && idea.length <= 2000, 'Describe the image in 3 to 2000 characters.');
  const aspect = Object.hasOwn(RATIOS, input.aspect) ? input.aspect : '1:1';
  const prompt = input.raw === true ? idea : studioPrompt({ idea, reference: !!ref, palette: input.palette || {}, aspect });
  const job = typeof input.job === 'string' ? input.job.slice(0, 80) : null;
  const t = Date.now();
  try {
    const out = await paintImage({ prompt, reference: ref, aspect, prefer: input.model === 'flash' ? 'flash' : 'pro', fetchImpl: ctx.fetch,
      onAttempt: a => ledgerAdd(ctx, { ...a, job, request_id: rid, at: Date.now(), kind: 'scene' }) });
    let usd = out.usd;
    if (usd == null && out.generation_id) { await new Promise(r => setTimeout(r, 1200)); const c = await generationCost(out.generation_id, { fetchImpl: ctx.fetch }); if (c) usd = c.usd; }
    const res = { image: out.image, prompt, model: out.model, usd, cost_known: usd != null, generation_id: out.generation_id, attempts: out.attempts.map(({ image, ...a }) => a), ms: Date.now() - t, style: input.style || 'photo', product_photo: !!ref };
    if (rkey) await ctx.store.set(rkey, res, 86400);
    return res;
  } catch (e) { if (rkey) await ctx.store.del(rkey); throw e; }
}

const ASPECT = { instagram: [816, 1024], facebook: [1024, 816], shopify: [1024, 576], reddit: [1024, 1024], x: [1024, 576] };
// Aspect ratios the AI studio offers. FLUX schnell ignores size, so only sdxl/dreamshaper use these.
export const RATIOS = { '1:1': [1024, 1024], '4:5': [816, 1024], '9:16': [576, 1024], '16:9': [1024, 576] };
export const STYLES = {
  photo: 'natural-light lifestyle product photography, shallow depth of field, real textures',
  sticker: 'flat 2D Y2K sticker illustration, electric blue and white with a white die-cut border, airbrushed highlights, light halftone dither texture',
  minimal: 'minimal studio still life, single object, soft shadow, generous negative space',
  flatlay: 'overhead flat lay on a neutral surface with a few props, even soft light, clean composition',
  closeup: 'macro close-up of the product texture, shallow depth of field, crisp specular highlights',
  lifestyle: 'candid lifestyle scene at home, soft window light, natural skin and fabric texture, no face in sharp focus',
};
const ready = () => !!(process.env.IMAGE_API_URL && process.env.IMAGE_API_KEY);

async function writePrompt(ctx, { post = {}, brand = {}, style }) {
  if (aiProvider().name === 'none') return [post.title, post.body].filter(Boolean).join('. ').slice(0, 400) + '. ' + STYLES[style];
  const r = await generateJson({ fetch: ctx.fetch, fast: true, temperature: 0.6, timeout: 20000,
    system: 'You write prompts for a text-to-image model (FLUX). Concrete nouns, composition, light, materials. Never ask for text, letters, logos or real people’s faces. Return only JSON.',
    prompt: `Brand: ${brand.name || ''}: ${brand.line || ''}\nAvoid: ${brand.avoid || 'none'}\nPost (${post.platform || 'social'}): "${post.title || ''}"\n${String(post.body || '').slice(0, 700)}\n\nVisual style: ${STYLES[style]}\nWrite ONE image prompt (40–80 words) for the image that should accompany this post. It must show the idea, not decorate it. End with "no text, no watermark". Return {"prompt": "..."}.` });
  return String(r.data.prompt || '').slice(0, 2000);
}

export async function generateImage(ctx, input) {
  if (process.env.IMAGE_ENGINE !== 'flux' && hasGeminiImage()) return geminiImage(ctx, input || {});
  if (!ready()) throw new PluginError('Image generation needs IMAGE_API_URL and IMAGE_API_KEY on the server (deploy workers/image).', 503);
  const style = Object.hasOwn(STYLES, input.style) ? input.style : 'photo';
  const model = ['fast', 'sdxl', 'dreamshaper'].includes(input.model) ? input.model : 'fast';
  let prompt = String(input.prompt || '').trim();
  need(prompt.length <= 2000, 'Keep the prompt under 2000 characters.');
  need(prompt || input.post?.title || input.post?.body, 'Give a prompt or a draft to illustrate.');
  await charge(ctx.store, 'image', ctx.ip, { daily: Number(process.env.IMAGE_DAILY_LIMIT) || 120, hourlyPerIp: 30 });
  if (!prompt) prompt = await writePrompt(ctx, { post: input.post, brand: input.brand, style });
  const [width, height] = RATIOS[input.aspect] || ASPECT[input.post?.platform] || [1024, 1024];
  const body = { prompt, model, ...(model === 'fast' ? {} : { width, height, negative_prompt: 'text, letters, watermark, logo, blurry, deformed hands' }) };
  if (Number.isInteger(input.seed)) body.seed = input.seed;
  let r;
  try { r = await (ctx.fetch || fetch)(process.env.IMAGE_API_URL.replace(/\/$/, '') + '/', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.IMAGE_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) }); }
  catch (e) { throw new PluginError('Image worker unreachable: ' + (e.message || e), 502); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new PluginError(j.error || 'Image worker HTTP ' + r.status, r.status === 401 ? 500 : 502); }
  const type = r.headers.get('content-type') || 'image/jpeg';
  need(type.startsWith('image/'), 'Image worker returned ' + type);
  const buf = Buffer.from(await r.arrayBuffer());
  return { image: `data:${type};base64,${buf.toString('base64')}`, prompt, model: r.headers.get('x-model') || model, ms: Number(r.headers.get('x-ms')) || null, bytes: buf.length, style };
}

// Product photos for ad creatives. Browsers can only draw a cross-origin photo onto a canvas (and export it)
// when the image host allows CORS, so the workspace falls back to this same-origin copy. Public https images only.
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|metadata\..*|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/i;
export async function productPhoto(ctx, input) {
  let u; try { u = new URL(String(input.url || '')); } catch { u = null; }
  need(u && u.protocol === 'https:' && !PRIVATE_HOST.test(u.hostname), 'Give a public https image URL.');
  await charge(ctx.store, 'photo', ctx.ip, { daily: Number(process.env.PHOTO_DAILY_LIMIT) || 3000, hourlyPerIp: 240 });
  let r; try { r = await (ctx.fetch || fetch)(u.href, { headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', 'user-agent': 'Mozilla/5.0 (compatible; Coldstart/0.3)' }, redirect: 'follow', signal: AbortSignal.timeout(9000) }); }
  catch (e) { throw new PluginError('Could not fetch that photo: ' + (e.message || e), 502); }
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  need(r.ok, 'The photo host answered ' + r.status + '.');
  need(/^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/.test(type), 'That URL is not a photo (' + (type || 'unknown type') + ').');
  const buf = Buffer.from(await r.arrayBuffer());
  need(buf.length <= 6 * 1024 * 1024, 'That photo is larger than 6 MB.');
  return { image: `data:${type};base64,${buf.toString('base64')}`, bytes: buf.length };
}

// Vision review of a finished ad. Subjective checks only (perspective, lighting, edges, hierarchy, brand, overall quality);
// the deterministic checks (mask completeness, protected pixels, clipping/overlap) come from the compositor and editor.
// Limitations are returned with the result: a vision model sees a downscaled JPEG, can miss small edge defects, cannot verify
// that a logo is the brand's real logo, and its scores are opinions. It never approves an ad: a person does.
export const CRITIQUE_CHECKS = ['cutout_edges', 'contact_shadow', 'perspective', 'lighting', 'typography_hierarchy', 'brand_logo', 'creative_quality'];
async function critique(ctx, input) {
  await gate(ctx);
  const img = typeof input.image === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(input.image) && input.image.length < 5000000 ? input.image : null;
  need(img, 'Send the rendered ad as a PNG or JPEG data URL under 5 MB.');
  await charge(ctx.store, 'image', ctx.ip, { daily: Number(process.env.IMAGE_DAILY_LIMIT) || 300, hourlyPerIp: 40 });
  const brief = String(input.brief || '').slice(0, 600);
  const t = Date.now();
  const r = await generateJson({ fetch: ctx.fetch, temperature: 0.1, timeout: 40000, images: [img],
    system: 'You are a strict senior art director reviewing a paid social ad before it ships. Judge only what you can see. Be specific and harsh; do not praise by default. Return only JSON.',
    prompt: `Brief: ${brief || 'product ad'}\nThe product pixels were composited from the real product photo onto a generated scene; text was drawn on top.\nScore each check 1-5 (5 = would ship) with one concrete sentence of evidence and a fix:\n${CRITIQUE_CHECKS.join(', ')}.\nAlso list blocking_issues (things that make the ad unshippable, e.g. the product floats, light direction on the product contradicts the scene, the product looks pasted, text is stranded or hard to read).\nJSON: {"checks":{"<check>":{"score":1-5,"evidence":"...","fix":"..."}},"blocking_issues":["..."],"overall":1-5}`,
    validate: j => j && j.checks && typeof j.overall === 'number' });
  const checks = r.checks || {};
  const low = CRITIQUE_CHECKS.filter(c => !checks[c] || Number(checks[c].score) < 3);
  await ledgerAdd(ctx, { kind: 'critique', model: r._model || 'openrouter', ok: true, status: 200, ms: Date.now() - t, usd: null, generation_id: null, job: input.job || null, at: Date.now() });
  return { checks, blocking_issues: r.blocking_issues || [], overall: r.overall, verdict: low.length || (r.blocking_issues || []).length ? 'needs_changes' : 'looks_shippable_needs_human_approval', low_checks: low, approved: false,
    limitations: ['Opinion of a vision model on a downscaled image; small edge halos can be missed.', 'Cannot verify that the logo is the brand’s official artwork.', 'Never approves: a person must approve the ad.'] };
}

// Art direction for compositing: where in the generated scene the product should stand. The scene model does not obey
// pixel positions, so a vision model reads the actual image: the surface line the base should touch, the horizontal centre
// of the empty spot, its usable width, and where the key light comes from (for the shadow). Clamped by the caller.
async function locate(ctx, input) {
  await gate(ctx);
  const img = typeof input.image === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(input.image) && input.image.length < 5000000 ? input.image : null;
  need(img, 'Send the scene as a data URL under 5 MB.');
  await charge(ctx.store, 'image', ctx.ip, { daily: Number(process.env.IMAGE_DAILY_LIMIT) || 300, hourlyPerIp: 40 });
  const t = Date.now();
  const r = await generateJson({ fetch: ctx.fetch, temperature: 0, timeout: 30000, images: [img],
    system: 'You measure positions in photographs precisely. Coordinates are fractions of the image width (x) and height (y), origin top-left. Return only JSON.',
    prompt: `This is an empty product-photography scene. ${String(input.hint || '').slice(0, 300)}\nFind the empty surface where a standing product should be placed (top of a plinth, a clear patch of table, or the floor).\nReturn {"surface_y": y of the line where the product's base should touch that surface, "cx": x of the centre of the empty spot, "width": usable width of the spot as a fraction of image width, "light_from": "left"|"right"|"front"|"top", "light_hardness": 0-1 (0 very soft, 1 hard sun), "camera": "eye_level"|"high_angle"|"overhead", "confidence": 0-1}`,
    validate: j => j && typeof j.surface_y === 'number' && typeof j.cx === 'number' });
  await ledgerAdd(ctx, { kind: 'locate', model: 'openrouter-vision', ok: true, status: 200, ms: Date.now() - t, usd: null, generation_id: null, job: input.job || null, at: Date.now() });
  const f = v => Math.min(Math.max(Number(v) || 0, 0), 1);
  return { surface_y: f(r.surface_y), cx: f(r.cx), width: f(r.width || 0.3), light_from: ['left', 'right', 'front', 'top'].includes(r.light_from) ? r.light_from : 'front', light_hardness: f(r.light_hardness ?? 0.4), camera: r.camera || null, confidence: f(r.confidence ?? 0.5) };
}

export default {
  id: 'images', name: 'Images', vendor: 'Cloudflare Workers AI', category: 'AI',
  description: 'Post visuals from FLUX and SDXL on your own Cloudflare worker (free tier), with prompts written by Gemini from the draft.',
  capabilities: ['image.gemini_pro', 'image.gemini_flash', 'image.flux_schnell', 'image.sdxl_lightning', 'prompt.from_draft'],
  env: ['IMAGE_API_URL', 'IMAGE_API_KEY'], optionalEnv: ['IMAGE_DAILY_LIMIT'],
  docs: 'https://developers.cloudflare.com/workers-ai/', auth: { type: 'server', scopes: [] },
  liveReady: ready,
  actions: {
    status: { method: 'GET', run: async (ctx) => ({ creative_pipeline: creativePipelineOn(ctx), budget: creativePipelineOn(ctx) ? await spend(ctx) : null, ready: ready() || hasGeminiImage(), engine: process.env.IMAGE_ENGINE !== 'flux' && hasGeminiImage() ? 'gemini' : ready() ? 'flux' : null, styles: Object.keys(STYLES), models: process.env.IMAGE_ENGINE !== 'flux' && hasGeminiImage() ? ['pro', 'flash'] : ['fast', 'sdxl', 'dreamshaper'] }) },
    generate: { method: 'POST', run: (ctx, input) => generateImage({ ...ctx, ip: ctx.req.ip }, input) },
    photo: { method: 'POST', run: (ctx, input) => productPhoto({ ...ctx, ip: ctx.req.ip }, input) },
    ledger: { method: 'GET', run: async (ctx) => ({ ...(await ledger(ctx, { refresh: true })), budget: await spend(ctx), workspace: ctx.ws }) },
    locate: { method: 'POST', run: (ctx, input) => locate({ ...ctx, ip: ctx.req.ip }, input) },
    critique: { method: 'POST', run: (ctx, input) => critique({ ...ctx, ip: ctx.req.ip }, input) },
  },
};
