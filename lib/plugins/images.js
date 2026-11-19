// Images plugin: post visuals from the Coldstart image worker (Cloudflare Workers AI, FLUX / SDXL),
// with Gemini turning a draft into an image prompt. Free tier ≈ 170 FLUX images/day; capped below it.
import { generateJson, aiProvider } from '../ai.js';
import { PluginError, need } from './http.js';
import { charge } from '../budget.js';
import { paintImage, hasGeminiImage } from '../gemini-image.js';
import { studioPrompt } from '../intel/scene.js';

// Gemini image models (see lib/gemini-image.js) are the default. FLUX on Cloudflare is the fallback when no OpenRouter key is set.
async function geminiImage(ctx, input) {
  await charge(ctx.store, 'image', ctx.ip, { daily: Number(process.env.IMAGE_DAILY_LIMIT) || 300, hourlyPerIp: 40 });
  const ref = typeof input.reference === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(input.reference) && input.reference.length < 6000000 ? input.reference : null;
  const idea = String(input.prompt || '').trim();
  need(idea.length >= 3 && idea.length <= 2000, 'Describe the image in 3 to 2000 characters.');
  const prompt = studioPrompt({ idea, reference: !!ref, palette: input.palette || {} });
  const aspect = Object.hasOwn(RATIOS, input.aspect) ? input.aspect : '1:1';
  const t = Date.now();
  const out = await paintImage({ prompt, reference: ref, aspect, prefer: input.model === 'flash' ? 'flash' : 'pro', fetchImpl: ctx.fetch });
  return { image: out.image, prompt, model: out.model, ms: Date.now() - t, style: input.style || 'photo', product_photo: !!ref };
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
  need(/^image\/(png|jpe?g|webp|gif|avif)$/.test(type), 'That URL is not a photo (' + (type || 'unknown type') + ').');
  const buf = Buffer.from(await r.arrayBuffer());
  need(buf.length <= 6 * 1024 * 1024, 'That photo is larger than 6 MB.');
  return { image: `data:${type};base64,${buf.toString('base64')}`, bytes: buf.length };
}

export default {
  id: 'images', name: 'Images', vendor: 'Cloudflare Workers AI', category: 'AI',
  description: 'Post visuals from FLUX and SDXL on your own Cloudflare worker (free tier), with prompts written by Gemini from the draft.',
  capabilities: ['image.gemini_pro', 'image.gemini_flash', 'image.flux_schnell', 'image.sdxl_lightning', 'prompt.from_draft'],
  env: ['IMAGE_API_URL', 'IMAGE_API_KEY'], optionalEnv: ['IMAGE_DAILY_LIMIT'],
  docs: 'https://developers.cloudflare.com/workers-ai/', auth: { type: 'server', scopes: [] },
  liveReady: ready,
  actions: {
    status: { method: 'GET', run: async () => ({ ready: ready() || hasGeminiImage(), engine: process.env.IMAGE_ENGINE !== 'flux' && hasGeminiImage() ? 'gemini' : ready() ? 'flux' : null, styles: Object.keys(STYLES), models: ['fast', 'sdxl', 'dreamshaper'] }) },
    generate: { method: 'POST', run: (ctx, input) => generateImage({ ...ctx, ip: ctx.req.ip }, input) },
    photo: { method: 'POST', run: (ctx, input) => productPhoto({ ...ctx, ip: ctx.req.ip }, input) },
  },
};
