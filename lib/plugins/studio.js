// Studio plugin: Gemini writes platform-native drafts grounded in a research signal or teardown.
// Drafts land in the workspace for human approval; nothing here publishes.
import { generateJson, aiProvider } from '../ai.js';
import { need, PluginError } from './http.js';
import { charge, limits } from '../budget.js';

export const PLATFORM_RULES = {
  reddit: { max: 4000, rules: 'A Reddit self-post. Helpful first, written like a community member. No links, no hashtags, no sales language. Disclose that you make a product only if you mention it, once, at the end. Title ≤ 120 chars, a real question or a useful statement.' },
  x: { max: 280, rules: 'One X post, 280 characters maximum including spaces. Plain, specific, no hashtags unless essential, at most one emoji. No links (a link goes in a reply).' },
  instagram: { max: 2200, rules: 'An Instagram caption for a carousel or Reel: a strong first line (it shows before "more"), short paragraphs, a clear save/share prompt, 3–6 relevant hashtags at the end. Also write "altText" (≤ 120 chars) describing the image to make.' },
  facebook: { max: 2000, rules: 'A Facebook Page post: conversational, 60–150 words, one question to invite comments. No hashtag walls.' },
  shopify: { max: 12000, rules: 'A Shopify blog article in Markdown: a helpful how-to of 450–700 words with H2 sections and a short product mention near the end. Also write "seoTitle" (≤ 60 chars) and "metaDescription" (≤ 155 chars).' },
};
const clipWords = (s, n) => { s = String(s || '').trim(); if (s.length <= n) return s; const cut = s.slice(0, n); const i = cut.lastIndexOf(' '); return (i > n * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,;:.-]+$/, ''); };

export async function draftPost(ctx, input) {
  const platform = String(input.platform || '');
  const rule = PLATFORM_RULES[platform];
  need(rule, 'Unknown platform.');
  if (aiProvider().name === 'none') throw new PluginError('Drafting needs GEMINI_API_KEY (or OPENROUTER_API_KEY) on the server.', 503);
  await charge(ctx.store, 'ai', ctx.ip, limits.ai());
  const b = input.brand || {}, s = input.signal || {};
  const source = s.title ? `Source (${s.source || 'research'} · ${s.where || ''}): "${s.title}"\n${String(s.body || '').slice(0, 800)}\nInsight: ${s.insight || ''}\nAngle to use: ${s.angle || ''}` : `Angle: ${input.angle || 'introduce the brand'}`;
  const r = await generateJson({ fetch: ctx.fetch, temperature: 0.7,
    system: 'You are Coldie, a careful social copywriter for a small brand. Write like a person, never like an ad agency. Do not invent facts, prices, reviews or statistics. Return only JSON.',
    prompt: `Brand: ${b.name || 'the brand'}: ${b.line || ''}\nVoice: ${b.voice || 'clear, warm'}\n${b.icp ? 'Main audience (ICP): ' + String(b.icp).slice(0, 300) + '\n' : ''}Never use these words or claims: ${b.avoid || 'none'}\n\n${source}\n\nPlatform: ${platform}. ${rule.rules}\nHard limit: body ≤ ${rule.max} characters.\n${input.notes ? 'Extra direction: ' + String(input.notes).slice(0, 300) + '\n' : ''}\nReturn {"title","body"${platform === 'instagram' ? ',"altText"' : ''}${platform === 'shopify' ? ',"seoTitle","metaDescription"' : ''}${platform === 'reddit' ? ',"community"' : ''},"why"} where "why" is one sentence on how the draft answers the source.` });
  const d = r.data || {};
  let body = String(d.body || '').trim();
  if (platform === 'reddit') body = body.replace(/\(?https?:\/\/\S+\)?/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  body = clipWords(body, rule.max);
  need(body, 'The model returned an empty draft. Try again.');
  return {
    platform, title: clipWords(d.title || s.angle || s.title || 'Draft', 120), body,
    ...(platform === 'instagram' ? { altText: clipWords(d.altText || '', 120) } : {}),
    ...(platform === 'shopify' ? { seoTitle: clipWords(d.seoTitle || d.title || '', 60), metaDescription: clipWords(d.metaDescription || '', 155) } : {}),
    ...(platform === 'reddit' && d.community ? { community: String(d.community).replace(/^\/?r\//, '').slice(0, 21) } : {}),
    why: d.why || '', model: r.model, provider: r.provider, cost: { usd: r.usd },
  };
}

export default {
  id: 'studio', name: 'Gemini', vendor: 'Google', category: 'AI',
  description: 'Gemini writes platform-native drafts from your research, in your brand voice. Every draft waits for your approval.',
  capabilities: ['draft.reddit', 'draft.x', 'draft.instagram', 'draft.facebook', 'draft.shopify_blog'],
  env: ['GEMINI_API_KEY'], optionalEnv: ['OPENROUTER_API_KEY', 'GEMINI_MODEL', 'OPENROUTER_MODEL', 'AI_DAILY_CALLS'],
  docs: 'https://aistudio.google.com/apikey', auth: { type: 'server', scopes: [] },
  liveReady: () => aiProvider().name !== 'none',
  actions: {
    status: { method: 'GET', run: async () => ({ ai: aiProvider() }) },
    draft: { method: 'POST', run: (ctx, input) => draftPost({ ...ctx, ip: ctx.req.ip }, input) },
  },
};
