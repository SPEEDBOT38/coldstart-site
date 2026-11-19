// Image generation with Google's Gemini image models through OpenRouter.
// Gemini 3 Pro Image ("Nano Banana Pro") is the default: given the real product photo as a reference it keeps the packaging,
// label and lettering exact, which text-only models cannot do. Gemini 3.1 Flash Image is the fallback (faster, a little less exact).
// Tested 2026-11-18 on a real McCaffeine catalogue photo: the label came back identical with the Pro model.
const BASE = 'https://openrouter.ai/api/v1/chat/completions';
const GOOGLE = { only: ['google-vertex', 'google-ai-studio'], allow_fallbacks: false };
export const IMAGE_MODELS = ['google/gemini-3-pro-image-preview', 'google/gemini-3.1-flash-image-preview'];

export const hasGeminiImage = () => !!(process.env.OPENROUTER_API_KEY || '').trim();
const models = () => { const l = (process.env.GEMINI_IMAGE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean); return l.length ? l : IMAGE_MODELS; };

export class ImageError extends Error { constructor(m, status = 502) { super(m); this.status = status; } }

// prompt: the full instruction. reference: a data URL or https URL of the real product photo (optional).
export async function paintImage({ prompt, reference = null, aspect = '1:1', prefer = 'pro', deadline = Date.now() + 55000, fetchImpl = fetch } = {}) {
  const key = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!key) throw new ImageError('Image generation needs OPENROUTER_API_KEY on the server.', 503);
  const content = [{ type: 'text', text: prompt }];
  if (reference) content.push({ type: 'image_url', image_url: { url: reference } });
  let lastErr = null;
  const order = prefer === 'flash' ? [...models()].reverse() : models();
  for (const model of order) {
    if (deadline - Date.now() < 8000) break;
    const body = { model, provider: GOOGLE, modalities: ['image', 'text'], image_config: { aspect_ratio: aspect }, messages: [{ role: 'user', content }] };
    let j = null, status = 0, raw = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetchImpl(BASE, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'x-title': 'Coldstart' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(5000, deadline - Date.now())) });
        status = r.status; raw = await r.text();
        try { j = JSON.parse(raw); } catch (_) { j = null; }
      } catch (e) { lastErr = e; status = 0; }
      if (status !== 429 && status < 500 && status !== 0) break;
      if (attempt < 2 && deadline - Date.now() > 10000) await new Promise(res => setTimeout(res, 1500 * 2 ** attempt)); else break;
    }
    if (status === 401) throw new ImageError('OpenRouter rejected the API key (OPENROUTER_API_KEY).', 503);
    if (status === 402) throw new ImageError('OpenRouter is out of credits. Top up at openrouter.ai/credits.', 503);
    const msg = j && j.choices && j.choices[0] && j.choices[0].message;
    const img = msg && msg.images && msg.images[0] && ((msg.images[0].image_url && msg.images[0].image_url.url) || msg.images[0].url);
    if (status === 200 && typeof img === 'string' && /^data:image\//.test(img)) {
      const u = (j.usage) || {};
      return { image: img, model, usd: Number(u.cost) || 0 };
    }
    lastErr = new ImageError(model + ' returned no image (' + (status || 'no answer') + '): ' + String((j && j.error && j.error.message) || (msg && msg.content) || raw).slice(0, 160));
  }
  throw lastErr || new ImageError('No image model answered.');
}

// The real product photo, as a data URL the model can take as a reference (public https images only, under 4 MB).
export async function toDataUrl(url, { fetchImpl = fetch } = {}) {
  let u; try { u = new URL(String(url || '')); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const r = await fetchImpl(u.href, { headers: { accept: 'image/*', 'user-agent': 'Mozilla/5.0 (compatible; Coldstart/0.3)' }, redirect: 'follow', signal: AbortSignal.timeout(9000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\/(png|jpe?g|webp)$/.test(type)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length <= 4 * 1024 * 1024 ? `data:${type};base64,${buf.toString('base64')}` : null;
}
