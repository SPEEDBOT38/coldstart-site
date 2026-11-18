// Coldstart image API: a Cloudflare Worker over Workers AI text-to-image models.
// Based on github.com/saurav-z/free-image-generation-api, hardened:
//   - constant-time Bearer check, and refusal when API_KEY is unset
//   - model allowlist (fixes the repo's "ux-1-schnell" typo); FLUX answers base64 JSON, SDXL a byte stream
//   - prompt/size/step validation, JSON errors, GET /health
// Free tier: 10,000 neurons/day. FLUX-1-schnell 1024² at 4 steps is about 58 neurons, roughly 170 images/day.

export const MODELS = {
  fast: { id: '@cf/black-forest-labs/flux-1-schnell', steps: [1, 8, 4], sized: false },
  sdxl: { id: '@cf/bytedance/stable-diffusion-xl-lightning', steps: [1, 8, 4], sized: true },
  dreamshaper: { id: '@cf/lykon/dreamshaper-8-lcm', steps: [1, 8, 6], sized: true },
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const clampSize = v => Math.min(1024, Math.max(256, Math.round((Number(v) || 1024) / 8) * 8));
const typeOf = b => b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : 'application/octet-stream';

async function toBytes(result) {
  if (result instanceof ReadableStream) return new Uint8Array(await new Response(result).arrayBuffer());
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result && typeof result.image === 'string') { const s = atob(result.image); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  throw new Error('Unexpected model output');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health')
      return json({ ok: true, models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, m.id])) });
    if (!env.API_KEY) return json({ error: 'API_KEY secret is not set on this worker.' }, 500);
    const auth = request.headers.get('authorization') || '';
    if (!sameKey(auth, 'Bearer ' + env.API_KEY)) return json({ error: 'Unauthorized' }, 401);
    if (request.method !== 'POST' || !['/', '/generate'].includes(url.pathname)) return json({ error: 'POST / only' }, 405);

    let body; try { body = await request.json(); } catch { return json({ error: 'JSON body expected.' }, 400); }
    const prompt = String(body.prompt || '').trim();
    if (!prompt || prompt.length > 2048) return json({ error: 'prompt is required (1–2048 characters).' }, 400);
    const key = body.model || 'fast';
    const m = Object.hasOwn(MODELS, key) ? MODELS[key] : null;
    if (!m) return json({ error: 'model must be one of ' + Object.keys(MODELS).join(', ') }, 400);

    const [lo, hi, def] = m.steps;
    const input = { prompt, steps: Math.min(hi, Math.max(lo, Math.round(Number(body.steps) || def))) };
    if (Number.isInteger(body.seed)) input.seed = body.seed;
    if (m.sized) {
      input.width = clampSize(body.width); input.height = clampSize(body.height);
      if (body.negative_prompt) input.negative_prompt = String(body.negative_prompt).slice(0, 1000);
      input.num_steps = input.steps; delete input.steps;
    }
    const t = Date.now();
    try {
      const bytes = await toBytes(await env.AI.run(m.id, input));
      return new Response(bytes, { headers: { 'content-type': typeOf(bytes), 'x-model': m.id, 'x-ms': String(Date.now() - t), 'cache-control': 'no-store' } });
    } catch (e) {
      return json({ error: 'Generation failed: ' + String(e && e.message || e).slice(0, 300), model: m.id }, 502);
    }
  },
};
