// Turns verified research rows into the workspace's signal and teardown shapes.
// Tagging runs in batches of 15 through the model chain (lib/ai.js), each answer validated: every post must come
// back with a ref, an allowed intent and a 0-100 match. A batch that still fails is keyword-tagged and every row in
// it says so (`tagged: 'keywords'`); the run-level `ai` says 'partial' or 'keywords' instead of claiming AI.
// Off-topic posts (AI match < 50) are dropped and counted, not shown.
import crypto from 'node:crypto';
import { generateJson, aiProvider } from '../../ai.js';
import { queryTerms, overlap } from './verify.js';

export const INTENTS = ['Customer pain', 'Buying intent', 'Product feedback', 'Competitor gap', 'Content idea'];
export const MIN_MATCH = 50;
const BATCH = 15;
const hid = s => 'live-' + crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const ago = iso => { if (!iso) return 'recent'; const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? 'just now' : h < 48 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
const RULE = { reddit: w => `Read ${w} rules before posting; most communities limit self-promotion.`, x: () => 'Reply or quote-post; keep each post under 280 characters.', instagram: () => 'Comment or create a carousel/Reel on the same theme; no link in captions.', meta_ads: () => 'Paid creative: study it, don’t copy it.' };
const UP = { reddit: (s, c) => `${s ?? '–'} upvotes · ${c ?? '–'} comments`, x: (s, c) => `${s ?? '–'} likes · ${c ?? '–'} replies`, instagram: (s, c) => `${s ?? '–'} likes · ${c ?? '–'} comments`, web: () => 'web result' };
const SYSTEM = 'You are Coldie, a marketing researcher for a small online brand. You read real public posts and tag them honestly. Never invent posts, numbers or quotes. Return only JSON.';

export function keywordTag(it, query) {
  const terms = queryTerms(query), t = (it.title + ' ' + it.text).toLowerCase();
  const intent = /\b(recommend|best|which|worth|buy|looking for|suggest)\b/.test(t) ? 'Buying intent'
    : /\b(hate|struggl|problem|why does|keeps|help|can't|cannot|dying)\b|\?/.test(t) ? 'Customer pain'
    : /\b(vs|instead of|switched|alternative|brand)\b/.test(t) ? 'Competitor gap'
    : /\b(love|wish|would be nice|feature)\b/.test(t) ? 'Product feedback' : 'Content idea';
  const hits = overlap(it, terms);
  return { intent, topic: terms.find(w => t.includes(w)) || terms[0] || 'general', match: Math.min(90, 40 + Math.round(50 * hits / Math.max(1, terms.length))), insight: 'Tagged by keyword rules, not AI: read the post before acting on it.', angle: it.title.slice(0, 80) };
}

const text = s => typeof s === 'string' && s.trim().length > 0;
const fields = (row, keys) => keys.every(k => text(row?.[k]));
function exactRefs(list, refs) {
  return Array.isArray(list) && list.length === refs.length && new Set(list.map(x => x?.ref)).size === refs.length && list.every(x => refs.includes(x?.ref));
}
function checkBatch(rows) {
  const refs = rows.map(r => r.ref);
  return d => {
    if (!exactRefs(d?.signals, refs)) return 'signals must contain every supplied ref exactly once';
    for (const t of d.signals) {
      if (!INTENTS.includes(t.intent) || !Number.isFinite(t.match) || t.match < 0 || t.match > 100 || !fields(t, ['topic', 'insight', 'angle'])) return 'invalid intent, match (number 0–100), topic, insight or angle';
      const row = rows.find(r => r.ref === t.ref);
      if (t.quote != null && !(text(t.quote) && [row.title, row.text].some(s => s.includes(t.quote)))) return 'quote must be verbatim from the referenced post';
    }
    return null;
  };
}


async function tagBatch(batch, offset, { query, brand, fetch: f, deadlineAt }) {
  const rows = batch.map((it, i) => ({ ref: String(offset + i), source: it.source, where: it.where, title: it.title, text: String(it.text || '').slice(0, 500), score: it.score, comments: it.comments }));
  const r = await generateJson({ fetch: f, temperature: 0.2, fast: true, timeout: 20000, deadline: 32000, deadlineAt, maxTokens: 3000, validate: checkBatch(rows),
    system: SYSTEM + ' Include a short verbatim quote from the referenced title or text supporting each tag, or null when unavailable.',
    prompt: `Brand: ${brand.name || 'unnamed'}: ${brand.line || ''}\nResearch question: "${query}"\n\nPosts (JSON):\n${JSON.stringify(rows)}\n\nFor EVERY post return {"ref","intent","topic","match","insight","angle"}:\n- ref: copy it exactly\n- intent: one of ${JSON.stringify(INTENTS)}\n- topic: 1–3 lowercase words\n- match: 0–100, how relevant this post is to the brand AND the question. A post that only shares a word (e.g. a celebrity outfit for "wool sneakers", a stock-market post about the company) is under 30.\n- insight: one sentence: what this tells the brand to do, grounded in the post\n- angle: a short content angle (≤10 words) the brand could publish in response\nReturn {"signals":[...]}.` });
  return { tags: r.data.signals, provider: r.provider, model: r.model, usd: r.usd || 0 };
}

async function summarize(tagged, { query, brand, fetch: f, deadlineAt }) {
  const rows = tagged.map(s => ({ ref: s.ref, intent: s.intent, topic: s.topic, title: s.title.slice(0, 140), excerpt: s.body.slice(0, 500), quote: s.quote }));
  const r = await generateJson({ fetch: f, temperature: 0.3, timeout: 15000, deadline: 20000, deadlineAt, maxTokens: 1500,
    validate: d => text(d?.summary) && d.summary.trim().length > 20 && Array.isArray(d.themes) && d.themes.length <= 4 && d.themes.every(t =>
      fields(t, ['name', 'summary']) && Array.isArray(t.refs) && t.refs.length && new Set(t.refs).size === t.refs.length && t.refs.every(ref => rows.some(row => row.ref === ref))) ? null : 'need a summary and up to four named themes, each citing supplied post refs',
    system: SYSTEM,
    prompt: `Brand: ${brand.name || ''}: ${brand.line || ''}\nQuestion: "${query}"\nTagged posts:\n${JSON.stringify(rows)}\n\nReturn {"summary": two sentences on what these people are saying (only from the posts), "themes": up to 4 {"name","summary","refs":[refs from the list]}}.` });
  return { summary: r.data.summary, themes: r.data.themes, usd: r.usd || 0 };
}

export async function enrichSignals(items, { query, brand = {}, fetch: fetchImpl, deadlineAt = Date.now() + 45000 }) {
  const quality = { tagged: 0, keywordTagged: 0, offTopic: 0 };
  if (!items.length) return { signals: [], themes: [], summary: '', ai: aiProvider().name === 'none' ? 'keywords' : aiProvider().name, usd: 0, quality, notes: [] };
  const hasAi = aiProvider().name !== 'none', notes = [];
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push([items.slice(i, i + BATCH), i]);
  const results = hasAi ? await Promise.allSettled(batches.map(([b, off]) => tagBatch(b, off, { query, brand, fetch: fetchImpl, deadlineAt }))) : batches.map(() => ({ status: 'rejected', reason: new Error('no AI key') }));
  let usd = 0, provider = null;
  const byRef = new Map();
  results.forEach((r, k) => {
    if (r.status === 'fulfilled') { usd += r.value.usd; provider = r.value.provider; for (const t of r.value.tags) if (t && t.ref != null) byRef.set(String(t.ref), { ...t, by: 'ai' }); }
    else if (hasAi) notes.push(`AI tagging failed for posts ${batches[k][1] + 1}–${batches[k][1] + batches[k][0].length}: ${String(r.reason.message).slice(0, 160)}. Those posts use keyword tags.`);
  });
  const tagged = items.map((it, i) => {
    const t = byRef.get(String(i)) || { ...keywordTag(it, query), by: 'keywords' };
    const match = Math.max(0, Math.min(100, Math.round(Number(t.match) || 0)));
    return { it, ref: String(i), t, match, by: t.by };
  });
  const kept = tagged.filter(x => x.by === 'ai' ? x.match >= MIN_MATCH : true);
  quality.offTopic = tagged.length - kept.length;
  quality.tagged = kept.filter(x => x.by === 'ai').length;
  quality.keywordTagged = kept.filter(x => x.by === 'keywords').length;
  const signals = kept.map(({ it, t, match, by, ref }) => ({
    id: hid(it.source + (it.url || it.title)), ref, source: it.source, where: `${it.where} · ${ago(it.created)}`,
    up: it.score == null && it.comments == null ? 'Found via web search · no engagement data' : (UP[it.source] || UP.web)(it.score, it.comments), score: match + '% match', match,
    rule: (RULE[it.source] || (() => ''))(it.where), title: it.title, body: it.text || it.title,
    intent: INTENTS.includes(t.intent) ? t.intent : 'Content idea', topic: String(t.topic || 'general').toLowerCase().slice(0, 30),
    quote: t.quote ?? null, insight: t.insight || '', angle: t.angle || '', tagged: by, verified: !!it.verified, verifyNote: it.verifyNote || null,
    evidence: `Live · ${it.provider || it.source}${it.verified ? ' · verified by ' + it.verifiedBy : ' · not verified'}${it.created ? ' · ' + it.created.slice(0, 10) : ''}`, url: it.url, live: true,
  })).sort((a, b) => (b.verified - a.verified) || b.match - a.match);
  let summary = '', themes = [];
  if (hasAi && quality.tagged >= 3) {
    try { const s = await summarize(signals.filter(s => s.tagged === 'ai'), { query, brand, fetch: fetchImpl, deadlineAt }); summary = s.summary; themes = s.themes; usd += s.usd; }
    catch (e) { notes.push('Summary failed: ' + String(e.message).slice(0, 140)); }
  }
  const idOf = new Map(signals.map(s => [s.ref, s.id]));
  const ai = provider ? (quality.keywordTagged ? 'partial' : provider) : 'keywords';
  if (ai === 'keywords' && hasAi && !notes.length) notes.push('AI tagging unavailable: showing keyword tags.');
  return { signals: signals.map(({ ref, ...s }) => s), themes: themes.slice(0, 4).map(t => ({ name: String(t.name || '').slice(0, 60), summary: String(t.summary || '').slice(0, 240), refs: (t.refs || []).map(r => idOf.get(String(r))).filter(Boolean) })),
    summary, ai, usd, quality, notes };
}

export async function teardownAds(ads, { query, brand = {}, fetch: fetchImpl }) {
  if (!ads.length) return { teardowns: [], competitors: [], ai: 'none', usd: 0 };
  const base = ads.map((a, i) => ({ id: hid('ad' + (a.id || a.url || i)), brand: a.author || a.page_name || 'Unknown page', channel: 'paid', sourceLabel: 'Meta Ad Library · Live', format: a.format || (a.platforms || []).join(' + ') || 'Meta ad',
    active: a.started ? `Running since ${String(a.started).slice(0, 10)}` : 'Active', days: a.days ?? null, cta: a.title || a.headline || '', hook: String(a.text || a.body || '').slice(0, 160), observed: String(a.text || a.body || '').slice(0, 300), gap: '', angle: '',
    url: a.snapshot || a.url || a.ad_library_url, image: a.image || a.image_url || null, pick: a.pick_reason || null, variants: a.variant_count || null, live: true }));
  if (aiProvider().name === 'none') return { teardowns: base, competitors: [], ai: 'none', usd: 0 };
  const refs = base.map((_, i) => String(i));
  try {
    const r = await generateJson({ fetch: fetchImpl, temperature: 0.3, timeout: 25000, deadline: 35000, maxTokens: 4000,
      validate: d => {
        if (!exactRefs(d?.teardowns, refs)) return 'need one teardown per supplied ad ref';
        for (const t of d.teardowns) {
          const a = ads[Number(t.ref)], copy = String(a.text || a.body || '').slice(0, 600).trim();
          if (!fields(t, ['observed', 'gap', 'angle', 'format']) || typeof t.hook !== 'string' ||
            !(copy ? text(t.hook) && copy.startsWith(t.hook) : t.hook === '')) return 'need analysis and a verbatim opening from the referenced ad (empty for absent copy)';
        }
        if (!Array.isArray(d.competitors) || d.competitors.length > 4 || !d.competitors.every(c => fields(c, ['name', 'position', 'paid', 'gap']) && c.organic === 'Not checked' && base.some(b => b.brand === c.name))) return 'competitors must use observed page names and mark organic as Not checked';
      },
      system: 'You are Coldie, a paid-social strategist. Analyse real Meta Ad Library ads. Never invent performance data; ad visibility and age are hints, not ROAS. Return only JSON.',
      prompt: `Brand: ${brand.name || ''}: ${brand.line || ''}\nCategory: "${query}"\nAds (JSON):\n${JSON.stringify(base.map((b, i) => ({ ref: String(i), page: b.brand, text: String(ads[i].text || ads[i].body || '').slice(0, 600), headline: b.cta, running: b.active, days: b.days, platforms: b.format })))}\n\nReturn {"teardowns":[{"ref","hook","observed","gap","angle","format"}] for every ad (hook = the opening line as written; observed = what the ad does; gap = what it leaves unanswered that our brand could own; angle ≤10 words), "competitors":[up to 4 {"name","position","paid","organic","gap"}] grouping ads by page (organic = "Not checked")}.` });
    const by = new Map((r.data.teardowns || []).map(t => [String(t.ref), t]));
    return { teardowns: base.map((b, i) => { const t = by.get(String(i)); return t ? { ...b, hook: t.hook || b.hook, observed: t.observed || b.observed, gap: t.gap || '', angle: t.angle || '', format: t.format || b.format } : b; }),
      competitors: (r.data.competitors || []).slice(0, 4), ai: r.provider, usd: r.usd || 0 };
  } catch (e) { return { teardowns: base, competitors: [], ai: 'failed', aiNote: 'AI teardown failed: ' + String(e.message).slice(0, 200) + '. Showing the ads as written.', usd: 0 }; }
}
