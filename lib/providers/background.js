// Provider-agnostic background generation. Backgrounds are generated WITHOUT the product; the pixel-locked compositor
// then places the untouched product pixels on top, so a generator can never alter the product.
// Status: cloudflare-flux = requires_credentials (endpoint/payload from the official model page; never called live here).
import { PluginError } from './../plugins/http.js';

const MAX_PROMPT = 2048;
export function backgroundPrompt({ scene, mood, palette = [], ratio }) {
  const p = ['Empty photographic backdrop for a product photo, no product, no text, no logos, no people', scene, mood, palette.length ? 'colour palette ' + palette.slice(0, 3).join(', ') : '', ratio === '9:16' ? 'vertical composition' : '', 'clear empty surface in the lower centre']
    .filter(Boolean).join(', ');
  return p.slice(0, MAX_PROMPT);
}

export const providers = {
  cloudflare: {
    id: 'cloudflare-flux', model: '@cf/black-forest-labs/flux-1-schnell',
    status: env => env.CF_ACCOUNT_ID && env.CF_AI_TOKEN ? 'configured_unverified' : 'requires_credentials',
    async generate({ prompt, steps = 4, fetch: f = globalThis.fetch, env = process.env }) {
      if (!env.CF_ACCOUNT_ID || !env.CF_AI_TOKEN) throw new PluginError('Background generation needs CF_ACCOUNT_ID and CF_AI_TOKEN.', 503, { code: 'requires_credentials' });
      const r = await f(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`, { method: 'POST', headers: { authorization: 'Bearer ' + env.CF_AI_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt.slice(0, MAX_PROMPT), steps: Math.min(8, Math.max(1, steps)) }), signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new PluginError('Background provider returned ' + r.status + '.', 502, { code: 'provider_error' });
      const j = await r.json(); const b64 = (j.result && j.result.image) || j.image;   // REST envelope is {result:{image}}; the Workers binding returns {image}
      if (typeof b64 !== 'string' || b64.length < 100) throw new PluginError('Background provider returned no image.', 502, { code: 'no_image' });
      return { dataUrl: 'data:image/jpeg;base64,' + b64, model: '@cf/black-forest-labs/flux-1-schnell', costUsd: null };
    },
  },
};
// Reuses the project's own image worker (workers/image: Cloudflare Workers AI FLUX-1-schnell) via IMAGE_API_URL / IMAGE_API_KEY. It returns image bytes with x-model / x-ms headers.
providers.imageworker = {
  id: 'image-worker-flux', model: '@cf/black-forest-labs/flux-1-schnell',
  status: env => env.IMAGE_API_URL && env.IMAGE_API_KEY ? 'configured_unverified' : 'requires_credentials',
  async generate({ prompt, steps = 4, fetch: f = globalThis.fetch, env = process.env }) {
    if (!env.IMAGE_API_URL || !env.IMAGE_API_KEY) throw new PluginError('Background generation needs IMAGE_API_URL and IMAGE_API_KEY.', 503, { code: 'requires_credentials' });
    const t = Date.now(), r = await f(env.IMAGE_API_URL.replace(/\/$/, '') + '/', { method: 'POST', headers: { authorization: 'Bearer ' + env.IMAGE_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt.slice(0, MAX_PROMPT), model: 'fast', steps: Math.min(8, Math.max(1, steps)) }), signal: AbortSignal.timeout(50000) });
    if (!r.ok) throw new PluginError('Background provider returned ' + r.status + '.', 502, { code: 'provider_error' });
    const type = r.headers.get('content-type') || ''; if (!type.startsWith('image/')) throw new PluginError('Background provider returned ' + (type || 'no image') + '.', 502, { code: 'no_image' });
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 1000) throw new PluginError('Background provider returned no image.', 502, { code: 'no_image' });
    return { dataUrl: 'data:' + type + ';base64,' + buf.toString('base64'), model: r.headers.get('x-model') || providers.imageworker.model, providerMs: Number(r.headers.get('x-ms')) || Date.now() - t, costUsd: null };
  },
};
export const pick = (env = process.env) => { const k = env.BACKGROUND_PROVIDER || 'none'; return k === 'cloudflare' ? providers.cloudflare : k === 'imageworker' ? providers.imageworker : null; };
export const backgroundStatus = (env = process.env) => { const p = pick(env); return p ? { provider: p.id, state: p.status(env) } : { provider: 'procedural', state: 'default (no generation; plain studio backdrop)' }; };
