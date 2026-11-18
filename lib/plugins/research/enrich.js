// Turns raw research rows into the workspace's signal and teardown shapes, using Gemini when a key
// exists and a transparent keyword heuristic otherwise (labelled `ai: 'heuristic'`).
import crypto from 'node:crypto';
import { generateJson, aiProvider } from '../../ai.js';

const INTENTS = ['Customer pain', 'Buying intent', 'Product feedback', 'Competitor gap', 'Content idea'];
const hid = s => 'live-' + crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const ago = iso => { if (!iso) return 'recent'; const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? 'just now' : h < 48 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
const RULE = { reddit: w => `Read ${w} rules before posting; most communities limit self-promotion.`, x: () => 'Reply or quote-post; keep each post under 280 characters.', instagram: () => 'Comment or create a carousel/Reel on the same theme; no link in captions.', meta_ads: () => 'Paid creative: study it, don’t copy it.' };
const UP = { reddit: (s, c) => `${s ?? '–'} upvotes · ${c ?? '–'} comments`, x: (s, c) => `${s ?? '–'} likes · ${c ?? '–'} replies`, instagram: (s, c) => `${s ?? '–'} likes · ${c ?? '–'} comments`, web: () => 'web result' };

function heuristic(items, query) {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  return items.map((it, i) => {
    const t = (it.title + ' ' + it.text).toLowerCase();
    const intent = /\b(recommend|best|which|worth|buy|looking for|suggest)\b/.test(t) ? 'Buying intent'
      : /\b(hate|struggl|problem|why does|keeps|help|can't|cannot|dying)\b|\?/.test(t) ? 'Customer pain'
      : /\b(vs|instead of|switched|alternative|brand)\b/.test(t) ? 'Competitor gap'
      : /\b(love|wish|would be nice|feature)\b/.test(t) ? 'Product feedback' : 'Content idea';
    const hits = words.filter(w => t.includes(w)).length;
    return { ref: String(i), intent, topic: words.find(w => t.includes(w)) || words[0] || 'general', match: Math.min(95, 55 + hits * 12), insight: 'Read the thread before replying: tagged by keyword rules, not AI.', angle: it.title.slice(0, 80) };
  });
}

export async function enrichSignals(items, { query, brand = {}, fetch: fetchImpl }) {
  if (!items.length) return { signals: [], themes: [], summary: '', ai: aiProvider().name === 'none' ? 'heuristic' : aiProvider().name, usd: 0 };
  let tags, themes = [], summary = '', ai = 'heuristic', usd = 0;
  if (aiProvider().name !== 'none') {
    const rows = items.map((it, i) => ({ ref: String(i), source: it.source, where: it.where, title: it.title, text: it.text.slice(0, 500), score: it.score, comments: it.comments }));
    try {
      const r = await generateJson({ fetch: fetchImpl, temperature: 0.3, fast: true, timeout: 25000,
        system: 'You are Coldie, a marketing researcher for a small online brand. You read real public posts and tag them honestly. Never invent posts, numbers or quotes. Return only JSON.',
        prompt: `Brand: ${brand.name || 'unnamed'}: ${brand.line || ''}\nResearch question: "${query}"\n\nPosts (JSON):\n${JSON.stringify(rows)}\n\nFor EVERY post return {"ref","intent","topic","match","insight","angle"}:\n- intent: one of ${JSON.stringify(INTENTS)}\n- topic: 1–3 lowercase words\n- match: 0–100, how relevant this post is to the brand and question\n- insight: one sentence: what this tells the brand to do (grounded in the post)\n- angle: a short content angle (≤10 words) the brand could publish in response\nAlso return "themes": up to 4 {"name","summary","refs":[...]} and "summary": two sentences on what people are saying.\nReturn {"signals":[...],"themes":[...],"summary":"..."}.` });
      tags = r.data.signals; themes = r.data.themes || []; summary = r.data.summary || ''; ai = r.provider; usd = r.usd || 0;
    } catch (e) { tags = null; summary = 'AI tagging failed (' + e.message + '). Showing keyword tags.'; }
  }
  if (!Array.isArray(tags)) tags = heuristic(items, query);
  const byRef = new Map(tags.map(t => [String(t.ref), t]));
  const signals = items.map((it, i) => {
    const t = byRef.get(String(i)) || heuristic([it], query)[0];
    const match = Math.max(0, Math.min(100, Math.round(Number(t.match) || 0)));
    return {
      id: hid(it.source + (it.url || it.title)), source: it.source, where: `${it.where} · ${ago(it.created)}`,
      up: it.score == null && it.comments == null ? 'Found via web search · no engagement data' : (UP[it.source] || UP.web)(it.score, it.comments), score: match + '% match', match,
      rule: (RULE[it.source] || (() => ''))(it.where), title: it.title, body: it.text || it.title,
      intent: INTENTS.includes(t.intent) ? t.intent : 'Content idea', topic: String(t.topic || 'general').toLowerCase().slice(0, 30),
      insight: t.insight || '', angle: t.angle || '', evidence: `Live · ${it.provider || it.source}${it.created ? ' · ' + it.created.slice(0, 10) : ''}`, url: it.url, live: true,
    };
  }).filter(s => s.match >= 35).sort((a, b) => b.match - a.match);
  const idOf = new Map(items.map((it, i) => [String(i), hid(it.source + (it.url || it.title))]));
  return { signals, themes: themes.map(t => ({ ...t, refs: (t.refs || []).map(r => idOf.get(String(r))).filter(Boolean) })), summary, ai, usd };
}

export async function teardownAds(ads, { query, brand = {}, fetch: fetchImpl }) {
  if (!ads.length) return { teardowns: [], competitors: [], ai: 'none', usd: 0 };
  const base = ads.map((a, i) => ({ id: hid('ad' + (a.id || a.url || i)), brand: a.author || 'Unknown page', channel: 'paid', sourceLabel: 'Meta Ad Library · Live', format: (a.platforms || []).join(' + ') || 'Meta ad',
    active: a.started ? `Running since ${String(a.started).slice(0, 10)}` : 'Active', cta: a.title || '', hook: a.text.slice(0, 160), observed: a.text.slice(0, 300), gap: '', angle: '', url: a.snapshot || a.url, live: true }));
  if (aiProvider().name === 'none') return { teardowns: base, competitors: [], ai: 'none', usd: 0 };
  try {
    const r = await generateJson({ fetch: fetchImpl, temperature: 0.4, fast: true, timeout: 25000,
      system: 'You are Coldie, a paid-social strategist. Analyse real Meta Ad Library ads. Never invent performance data; ad visibility is not ROAS. Return only JSON.',
      prompt: `Brand: ${brand.name || ''}: ${brand.line || ''}\nCategory search: "${query}"\nAds (JSON):\n${JSON.stringify(base.map((b, i) => ({ ref: String(i), page: b.brand, text: ads[i].text.slice(0, 600), headline: b.cta, running: b.active, platforms: b.format })))}\n\nReturn {"teardowns":[{"ref","hook","observed","gap","angle","format"}] for every ad (hook = the opening line as written; observed = what the ad does; gap = what it leaves unanswered that our brand could own; angle ≤10 words), "competitors":[up to 4 {"name","position","paid","organic","gap"}] grouping ads by page (organic = "Not checked" unless known)}.` });
    const by = new Map((r.data.teardowns || []).map(t => [String(t.ref), t]));
    return { teardowns: base.map((b, i) => ({ ...b, ...(by.get(String(i)) ? { hook: by.get(String(i)).hook || b.hook, observed: by.get(String(i)).observed || b.observed, gap: by.get(String(i)).gap || '', angle: by.get(String(i)).angle || '', format: by.get(String(i)).format || b.format } : {}) })),
      competitors: r.data.competitors || [], ai: r.provider, usd: r.usd || 0 };
  } catch (e) { return { teardowns: base, competitors: [], ai: 'failed: ' + e.message, usd: 0 }; }
}
