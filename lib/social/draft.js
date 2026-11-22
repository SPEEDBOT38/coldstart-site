// Platform-appropriate drafts from an opportunity. Uses the configured AI router when present; otherwise a plainly labelled template.
// Hard rules enforced in code (validate), not trusted to the model: length, Reddit disclosure, no invented facts, no link in replies unless asked.
import { generateJson } from '../ai.js';

export const LIMITS = { x: 280, reddit: 4000, facebook: 2000, instagram: 2200 };
export function validateDraft({ platform, text, brand, kind }) {
  const issues = [];
  if (!text.trim()) issues.push('Empty draft.');
  if (text.length > (LIMITS[platform] || 2000)) issues.push(`Too long for ${platform} (${text.length}/${LIMITS[platform]}).`);
  if (platform === 'reddit' && !/\b(i (work|run|founded|make|built)|disclosure|affiliat|my (company|brand|shop|store))\b/i.test(text)) issues.push('Reddit contributions must disclose your connection to the brand.');
  if (kind === 'reply' && /https?:\/\//i.test(text)) issues.push('Do not put links in a reply unless the thread asks for one.');
  if (/\b(guarantee[sd]?|cures?|#1|best in the world|100% safe)\b/i.test(text)) issues.push('Contains an unsupported claim.');
  return issues;
}
export async function draftFor({ opportunity: o, brand, fetch }) {
  const platform = o.platform, kind = o.opportunity_type === 'participate' ? 'reply' : 'post', limit = LIMITS[platform] || 2000;
  let text, mode = 'template', model = null, usd = null;
  try {
    const r = await generateJson({ fast: true, fetch, temperature: 0.4, maxTokens: 600, deadline: 25000, system: 'You write short, honest, useful social contributions for a small brand. Never invent product facts, prices, results or claims. No hashtags spam, no emojis unless the brand uses them.',
      prompt: JSON.stringify({ task: kind === 'reply' ? 'Write a helpful reply to this discussion.' : 'Write an original post on this topic.', platform, max_chars: limit, brand: { name: brand.name, what: brand.line, tone: brand.tones, facts_you_may_use: brand.facts || [] }, discussion: { title: o.title, excerpt: o.excerpt }, rules: [platform === 'reddit' ? 'Disclose that you work on the brand in the first sentence.' : 'Be clear who is speaking.', kind === 'reply' ? 'Answer the question first. No link.' : 'One idea, one call to action at most.'], output: '{"text":"..."}' }),
      validate: j => typeof j?.text === 'string' && j.text.length > 5 });
    text = String(r.text || r.json?.text || '').trim(); mode = 'ai'; model = r.model || null;
  } catch (e) {
    const who = platform === 'reddit' ? `Disclosure: I work on ${brand.name}. ` : '';
    text = kind === 'reply' ? `${who}Happy to help with this. [Write your honest answer here, based on what ${brand.name} actually makes.]` : `${who}[Write one useful idea about "${o.cluster?.label || 'this topic'}" from ${brand.name}'s real experience.]`; mode = 'template';
  }
  text = text.slice(0, limit);
  return { platform, kind, text, mode, model, usd, needsEdit: mode === 'template', note: mode === 'template' ? 'No AI is connected, so this is a template with placeholders. Edit it before approving.' : 'AI draft. Review every claim before approving.', issues: validateDraft({ platform, text, brand, kind }), opportunityId: o.id, sourceUrl: o.source_url };
}
