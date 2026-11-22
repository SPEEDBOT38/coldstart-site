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
export const pick = (env = process.env) => (env.BACKGROUND_PROVIDER || 'none') === 'cloudflare' ? providers.cloudflare : null;
export const backgroundStatus = (env = process.env) => { const p = pick(env); return p ? { provider: p.id, state: p.status(env) } : { provider: 'procedural', state: 'default (no generation; plain studio backdrop)' }; };
