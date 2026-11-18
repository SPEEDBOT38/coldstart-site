// Images plugin: post visuals from the Coldstart image worker (Cloudflare Workers AI, FLUX / SDXL),
// with Gemini turning a draft into an image prompt. Free tier ≈ 170 FLUX images/day; capped below it.
import { generateJson, aiProvider } from '../ai.js';
import { PluginError, need } from './http.js';
import { charge } from '../budget.js';

const ASPECT = { instagram: [816, 1024], facebook: [1024, 816], shopify: [1024, 576], reddit: [1024, 1024], x: [1024, 576] };
export const STYLES = {
  photo: 'natural-light lifestyle product photography, shallow depth of field, real textures',
  sticker: 'flat 2D Y2K sticker illustration, electric blue and white with a white die-cut border, airbrushed highlights, light halftone dither texture',
  minimal: 'minimal studio still life, single object, soft shadow, generous negative space',
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
  if (!ready()) throw new PluginError('Image generation needs IMAGE_API_URL and IMAGE_API_KEY on the server (deploy workers/image).', 503);
  const style = Object.hasOwn(STYLES, input.style) ? input.style : 'photo';
  const model = ['fast', 'sdxl', 'dreamshaper'].includes(input.model) ? input.model : 'fast';
  let prompt = String(input.prompt || '').trim();
  need(prompt.length <= 2000, 'Keep the prompt under 2000 characters.');
  need(prompt || input.post?.title || input.post?.body, 'Give a prompt or a draft to illustrate.');
  await charge(ctx.store, 'image', ctx.ip, { daily: Number(process.env.IMAGE_DAILY_LIMIT) || 120, hourlyPerIp: 30 });
  if (!prompt) prompt = await writePrompt(ctx, { post: input.post, brand: input.brand, style });
  const [width, height] = ASPECT[input.post?.platform] || [1024, 1024];
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

export default {
  id: 'images', name: 'Images', vendor: 'Cloudflare Workers AI', category: 'AI',
  description: 'Post visuals from FLUX and SDXL on your own Cloudflare worker (free tier), with prompts written by Gemini from the draft.',
  capabilities: ['image.flux_schnell', 'image.sdxl_lightning', 'image.dreamshaper', 'prompt.from_draft'],
  env: ['IMAGE_API_URL', 'IMAGE_API_KEY'], optionalEnv: ['IMAGE_DAILY_LIMIT'],
  docs: 'https://developers.cloudflare.com/workers-ai/', auth: { type: 'server', scopes: [] },
  liveReady: ready,
  actions: {
    status: { method: 'GET', run: async () => ({ ready: ready(), styles: Object.keys(STYLES), models: ['fast', 'sdxl', 'dreamshaper'] }) },
    generate: { method: 'POST', run: (ctx, input) => generateImage({ ...ctx, ip: ctx.req.ip }, input) },
  },
};
