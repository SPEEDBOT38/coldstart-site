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
// Every HTTP attempt is recorded in `attempts` (status, latency, OpenRouter generation id, reported cost or null), including
// failures and 200 responses without an image: those can still be billed, so they are never hidden. Cost is null (unknown)
// unless OpenRouter reported it; it is never assumed to be 0. onAttempt lets the caller persist each attempt as it happens.
export async function paintImage({ prompt, reference = null, aspect = '1:1', prefer = 'pro', deadline = Date.now() + 55000, fetchImpl = fetch, maxEmptyRetries = 1, onAttempt = null, maxTotalAttempts = Infinity, onlyPreferred = false } = {}) {
  const key = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!key) throw new ImageError('Image generation needs OPENROUTER_API_KEY on the server.', 503);
  const content = [{ type: 'text', text: prompt }];
  if (reference) content.push({ type: 'image_url', image_url: { url: reference } });
  let lastErr = null; const attempts = [];
  let order = prefer === 'flash' ? [...models()].reverse() : models(); if (onlyPreferred) order = order.slice(0, 1);
  const record = async (a) => { attempts.push(a); if (onAttempt) { try { await onAttempt(a); } catch (_) { /* ledger write must not break generation */ } } };
  for (const model of order) {
    if (deadline - Date.now() < 8000) break;
    const body = { model, provider: GOOGLE, modalities: ['image', 'text'], image_config: { aspect_ratio: aspect }, usage: { include: true }, messages: [{ role: 'user', content }] };
    let empties = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempts.length >= maxTotalAttempts) break;
      let j = null, status = 0, raw = '', err = null; const t0 = Date.now();
      try {
        const r = await fetchImpl(BASE, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'x-title': 'Coldstart' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(5000, deadline - Date.now())) });
        status = r.status; raw = await r.text();
        try { j = JSON.parse(raw); } catch (_) { j = null; }
      } catch (e) { err = e; lastErr = e; status = 0; }
      const msg = j && j.choices && j.choices[0] && j.choices[0].message;
      const img = msg && msg.images && msg.images[0] && ((msg.images[0].image_url && msg.images[0].image_url.url) || msg.images[0].url);
      const ok = status === 200 && typeof img === 'string' && /^data:image\//.test(img);
      const cost = j && j.usage && typeof j.usage.cost === 'number' ? j.usage.cost : null;
      const a = { model, status, ok, empty: status === 200 && !ok, ms: Date.now() - t0, generation_id: (j && j.id) || null, usd: cost, retry: attempt,
        error: ok ? null : String((err && err.message) || (j && j.error && j.error.message) || (status === 200 ? 'no image in a 200 response' : raw)).slice(0, 200) };
      await record(a);
      if (ok) return { image: img, model, usd: cost, generation_id: a.generation_id, attempts };
      if (status === 401) throw Object.assign(new ImageError('OpenRouter rejected the API key (OPENROUTER_API_KEY).', 503), { attempts });
      if (status === 402) throw Object.assign(new ImageError('OpenRouter is out of credits. Top up at openrouter.ai/credits.', 503), { attempts });
      lastErr = new ImageError(model + ' returned no image (' + (status || 'no answer') + '): ' + a.error, 502);
      const transient = status === 429 || status >= 500 || status === 0;
      const emptyRetry = a.empty && empties++ < maxEmptyRetries;                 // bounded: an empty 200 may already be billed
      if (!(transient || emptyRetry) || attempt >= 2 || deadline - Date.now() < 12000) break;
      await new Promise(res => setTimeout(res, 1500 * 2 ** attempt));
    }
  }
  throw Object.assign(lastErr || new ImageError('No image model answered.'), { attempts });
}

// Actual charge for one generation, from OpenRouter's generation metadata API. Null when not (yet) available.
export async function generationCost(id, { fetchImpl = fetch } = {}) {
  const key = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!key || !id) return null;
  try {
    const r = await fetchImpl('https://openrouter.ai/api/v1/generation?id=' + encodeURIComponent(id), { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json(); const d = j && j.data;
    return d && typeof d.total_cost === 'number' ? { usd: d.total_cost, native_tokens: d.native_tokens_completion ?? null, provider: d.provider_name ?? null } : null;
  } catch (_) { return null; }
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
