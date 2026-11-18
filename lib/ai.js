// AI: one door for every model call (ported from MetaCroc lib/claude.js and fitted to Vercel's 60 s limit).
//   - a chain of models, cheapest that can do the job first: Gemini direct (GEMINI_API_KEY) and/or Google models
//     on OpenRouter (OPENROUTER_API_KEY), pinned to Google's own infrastructure
//   - 429 / 5xx: retry with backoff while the deadline allows; timeout, network error, empty reply, unreadable JSON
//     or a reply that fails `validate` -> the next model, with a correction note added to the prompt
//   - a bad key / no credits is a setup error at once, never a silent fallback
// generateJson resolves to {data, provider, model, usd, attempts}; total failure throws with every attempt listed.
import { PluginError } from './plugins/http.js';

const OR = 'https://openrouter.ai/api/v1/chat/completions';
const GOOGLE_HOSTS = { only: ['google-vertex', 'google-ai-studio'], allow_fallbacks: false };
const THINKS = /gemini-3\.[6-9]|gemini-3\.1-pro|gemini-4/;     // mandatory reasoning: budget room or the reply is empty
const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

export function modelChain({ fast = false } = {}) {
  const chain = [];
  if (process.env.GEMINI_API_KEY) {
    const strong = process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const quick = process.env.GEMINI_FAST_MODEL || 'gemini-flash-lite-latest';
    const g = fast ? [quick, strong] : [strong, quick];
    for (const m of [...new Set(g)]) chain.push({ provider: 'gemini', model: m });
  }
  if (process.env.OPENROUTER_API_KEY) {
    const env = list(fast ? process.env.OPENROUTER_FAST_MODELS || process.env.OPENROUTER_FAST_MODEL : process.env.OPENROUTER_MODELS || process.env.OPENROUTER_MODEL);
    const dflt = env.length ? [] : fast ? ['google/gemini-3.5-flash-lite', 'google/gemini-3.7-flash', 'google/gemma-4-31b-it:free']
      : ['google/gemini-3.7-flash', 'google/gemini-3.5-flash-lite', 'google/gemma-4-31b-it:free'];
    for (const m of [...new Set([...env, ...dflt])]) chain.push({ provider: 'openrouter', model: m });
  }
  return chain;
}

/** The first model that would answer: for status screens and "is AI configured" checks. */
export function aiProvider({ fast = false } = {}) {
  const c = modelChain({ fast })[0];
  return c ? { name: c.provider, model: c.model } : { name: 'none', model: null };
}

/** The first JSON object/array in a reply, even with prose or fences around it (MetaCroc extractJson). */
export function extractJson(text) {
  if (!text) return null;
  const t = String(text).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch {}
  const starts = [t.indexOf('{'), t.indexOf('[')].filter(i => i >= 0).sort((a, b) => a - b);
  for (const s of starts) {
    const open = t[s], close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let i = s; i < t.length; i++) {
      const ch = t[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) { try { return JSON.parse(t.slice(s, i + 1)); } catch { break; } }
    }
  }
  return null;
}
export function parseJson(text) {
  const j = extractJson(text);
  if (j == null) throw new PluginError('The model did not return valid JSON.', 502);
  return j;
}

class Next extends Error {}          // this model can't help: try the next one
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function once(fetchImpl, m, { system, prompt, temperature, maxTokens, timeout }) {
  let url, headers, body;
  if (m.provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m.model)}:generateContent`;
    headers = { 'x-goog-api-key': process.env.GEMINI_API_KEY };
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens: maxTokens } };
  } else {
    url = OR;
    headers = { authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY, 'x-title': 'Coldstart' };
    body = { model: m.model, temperature, max_tokens: maxTokens + (THINKS.test(m.model) ? 1500 : 0), usage: { include: true },
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] };
    if (!/gemma/.test(m.model)) body.response_format = { type: 'json_object' };
    if (THINKS.test(m.model)) body.reasoning = { effort: 'low' };
    if (m.model.startsWith('google/') && !m.model.endsWith(':free')) body.provider = GOOGLE_HOSTS;
  }
  const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(1000, timeout)) });
  const raw = await r.text();
  let j = null; try { j = JSON.parse(raw); } catch {}
  return { status: r.status, j, em: String(j?.error?.message || raw.slice(0, 160)) };
}

export async function generateJson({ system = '', prompt, temperature = 0.5, maxTokens = 4000, timeout = 30000, deadline = 50000, deadlineAt = Infinity,
  fast = false, validate, fetch: fetchImpl = fetch } = {}) {
  const chain = modelChain({ fast });
  if (!chain.length) throw Object.assign(new PluginError('No AI key on the server (GEMINI_API_KEY or OPENROUTER_API_KEY).', 503), { code: 'NO_AI' });
  const end = Math.min(Date.now() + deadline, deadlineAt), attempts = [];
  let note = '';
  for (const m of chain) {
    if (end - Date.now() < 4000) { attempts.push({ model: m.model, error: 'skipped: out of time' }); continue; }
    try {
      let res;
      for (let a = 0; ; a++) {                              // 429 / 5xx: up to 2 retries with backoff
        try { res = await once(fetchImpl, m, { system, prompt: prompt + note, temperature, maxTokens, timeout: Math.min(timeout, end - Date.now() - 500) }); }
        catch (e) { throw new Next(/abort|timeout/i.test(e.name + e.message) ? 'timed out' : 'network: ' + e.message); }
        if (res.status !== 429 && res.status < 500) break;
        const wait = 400 * 2 ** a;
        if (a === 2 || end - Date.now() < wait + 5000) throw new Next(`HTTP ${res.status}: ${res.em.slice(0, 100)}`);
        await sleep(wait);
      }
      const { status, j, em } = res;
      if (m.provider === 'openrouter' && status === 401) throw new PluginError('OpenRouter rejected the API key (OPENROUTER_API_KEY).', 503);
      if (m.provider === 'openrouter' && status === 402) throw new PluginError('OpenRouter is out of credits.', 503);
      if (status !== 200) throw new Next(`HTTP ${status}: ${em.slice(0, 100)}`);
      const parts = j?.candidates?.[0]?.content?.parts;
      const text = m.provider === 'gemini'
        ? (Array.isArray(parts) ? parts.filter(x => !x?.thought && typeof x?.text === 'string').map(x => x.text).join('') : '')
        : (typeof j?.choices?.[0]?.message?.content === 'string' ? j.choices[0].message.content : '');
      if (!text.trim()) throw new Next('empty reply (' + (j?.choices?.[0]?.finish_reason || j?.candidates?.[0]?.finishReason || j?.error?.message || 'no text') + ')');
      const data = extractJson(text);
      if (data == null) { note = '\n\nIMPORTANT: your last answer could not be read as JSON. Return ONLY the JSON, no other text.'; throw new Next('unreadable JSON: ' + text.slice(0, 60).replace(/\s+/g, ' ')); }
      let bad;
      try { bad = validate?.(data); } catch { bad = 'unexpected response shape'; }
      if (bad) { note = '\n\nIMPORTANT: your last answer was rejected: ' + bad + '. Fix that and return ONLY the JSON.'; throw new Next('rejected: ' + bad); }
      const u = j?.usage || {};
      const usd = m.provider === 'gemini' ? null : (Number(u.cost) || (u.is_byok ? Number(u.cost_details?.upstream_inference_cost) || 0 : 0));
      attempts.push({ model: m.model, ok: true });
      return { data, provider: m.provider, model: m.model, usd: usd == null ? null : Math.round(usd * 1e6) / 1e6, attempts };
    } catch (e) {
      if (!(e instanceof Next)) throw e;
      attempts.push({ model: m.model, error: e.message });
    }
  }
  const err = new PluginError('Every AI model failed: ' + attempts.map(a => `${a.model} (${a.error})`).join('; '), 502);
  err.attempts = attempts;
  throw err;
}
