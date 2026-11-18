// AI: Gemini first (GEMINI_API_KEY, Google AI Studio), else Gemini via OpenRouter (OPENROUTER_API_KEY).
// generateJson always asks for JSON and returns {data, provider, model, usd}.
import { PluginError } from './plugins/http.js';

/** fast: bulk tagging (Flash-Lite); default: writing (Flash). */
export function aiProvider({ fast = false } = {}) {
  if (process.env.GEMINI_API_KEY) return { name: 'gemini', model: fast ? (process.env.GEMINI_FAST_MODEL || 'gemini-flash-lite-latest') : (process.env.GEMINI_MODEL || 'gemini-flash-latest') };
  if (process.env.OPENROUTER_API_KEY) return { name: 'openrouter', model: fast ? (process.env.OPENROUTER_FAST_MODEL || 'google/gemini-3.5-flash-lite') : (process.env.OPENROUTER_MODEL || 'google/gemini-3.7-flash') };
  return { name: 'none', model: null };
}

export function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  const c = t.indexOf('['), d = t.lastIndexOf(']');
  for (const [s, e] of [[a, b], [c, d]]) if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
  throw new PluginError('The model did not return valid JSON.', 502);
}

async function post(fetchImpl, url, headers, body, timeout) {
  let r;
  try { r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw new PluginError('AI request failed: ' + (e.message || e), 502); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new PluginError('AI error: ' + (j.error?.message || 'HTTP ' + r.status), r.status === 429 ? 429 : 502);
  return j;
}

export async function generateJson({ system = '', prompt, temperature = 0.5, maxTokens = 4000, timeout = 45000, fast = false, fetch: fetchImpl = fetch } = {}) {
  const p = aiProvider({ fast });
  if (p.name === 'none') throw Object.assign(new PluginError('No AI key on the server (GEMINI_API_KEY or OPENROUTER_API_KEY).', 503), { code: 'NO_AI' });
  if (p.name === 'gemini') {
    const j = await post(fetchImpl, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`, { 'x-goog-api-key': process.env.GEMINI_API_KEY }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens: maxTokens },
    }, timeout);
    const text = (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
    if (!text) throw new PluginError('Gemini returned no text (' + (j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || 'empty') + ').', 502);
    return { data: parseJson(text), provider: 'gemini', model: p.model, usd: null };
  }
  const j = await post(fetchImpl, 'https://openrouter.ai/api/v1/chat/completions', { authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY, 'x-title': 'Coldstart' }, {
    model: p.model, temperature, max_tokens: maxTokens, response_format: { type: 'json_object' }, usage: { include: true },
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
  }, timeout);
  const text = j.choices?.[0]?.message?.content;
  if (!text) throw new PluginError('The model returned no text.', 502);
  return { data: parseJson(text), provider: 'openrouter', model: p.model, usd: j.usage?.cost ?? null };
}
