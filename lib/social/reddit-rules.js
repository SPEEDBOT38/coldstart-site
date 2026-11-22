// Reddit assisted mode: understand the pasted thread and check the pasted community rules BEFORE recommending any participation.
// Nothing here fetches Reddit. The person pastes the thread and the subreddit rules they read. Unknown rules never count as permission.

/** What is the person asking, and is a reply from a brand appropriate at all? */
export function assessThread({ title = '', text = '' }) {
  const t = (title + ' ' + text).toLowerCase();
  const question = /\?|\b(any (advice|tips|recommendations?)|looking for|how (do|can|should)|what('s| is) the best|which|help me|need help)\b/.test(t);
  const rant = !question && /\b(rant|so annoyed|furious|worst|hate|scam|never again)\b/.test(t);
  const grief = /\b(passed away|died|funeral|diagnos|suicid|depress)/.test(t);
  const wantsProduct = /\b(recommend|suggest|best|looking for|which brand|worth buying|alternatives?)\b/.test(t);
  const problem = (title || text).replace(/\s+/g, ' ').trim().slice(0, 200);
  let participation, why;
  if (grief) { participation = 'stay_out'; why = 'A personal or sensitive thread. A brand reply would be inappropriate.'; }
  else if (rant) { participation = 'stay_out'; why = 'The author is venting and has not asked for help. A brand reply reads as an intrusion.'; }
  else if (question && wantsProduct) { participation = 'answer_with_disclosure'; why = 'The author asks for recommendations. A helpful answer with a clear disclosure can be welcome if the community allows it.'; }
  else if (question) { participation = 'answer_helpfully'; why = 'The author asks a question. Lead with a useful answer; mention the brand only if it is directly relevant, with disclosure.'; }
  else { participation = 'observe'; why = 'No question or request was found. Read the discussion; there is nothing to answer yet.'; }
  return { audience_problem: problem, participation, why, asks_for_recommendations: wantsProduct };
}

const RULES = [
  [/no\s+(self[- ]?promo(tion)?|promotion|advertis|spam|marketing)|self[- ]?promo(tion)?\s+(is\s+)?(not allowed|prohibited|banned)|no\s+(brand|business)\s+(accounts|posts)/i, 'promotion_banned', 'blocked', 'The rules ban promotion or brand accounts.'],
  [/(9|10):1|ratio of|10%\s+(of|self)|self[- ]?promo\w*\s+(limited|only)\s+(to|once)/i, 'promo_ratio', 'caution', 'Self-promotion is limited to a small share of your activity. A brand account with no other history likely breaks this.'],
  [/no\s+(links?|urls?)|links?\s+(are\s+)?(not allowed|prohibited|removed)/i, 'no_links', 'caution', 'Links are not allowed. Do not include a link.'],
  [/(minimum|min\.?|at least)\s+\d*\s*(account age|karma|days old)|account\s+must\s+be\s+\d+|\d+\s+karma/i, 'account_requirements', 'caution', 'The community requires a minimum account age or karma. Check that the posting account meets it.'],
  [/(must|please)\s+(use|add|include)\s+(a\s+)?flair|flair\s+(is\s+)?required/i, 'flair_required', 'caution', 'A post flair is required.'],
  [/disclos|affiliat|conflict of interest/i, 'disclosure_required', 'info', 'The rules mention disclosure. Keep the brand disclosure at the top.'],
  [/no\s+(question|help)\s+posts?|mods?\s+only|read[- ]only|archived/i, 'restricted_participation', 'blocked', 'Participation appears restricted.'],
];
/** Returns what the pasted rules say about this draft. verdict: blocked | caution | allowed_if_followed | unknown_rules */
export function checkRules({ rulesText = '', draft = '', thread }) {
  const rules = String(rulesText || '').trim(), findings = [];
  const a = thread ? assessThread(thread) : null;
  if (a && a.participation === 'stay_out') return { verdict: 'blocked', participation: a.participation, reasons: [a.why], findings: [], rules_provided: !!rules };
  if (!rules) return { verdict: 'unknown_rules', participation: a ? a.participation : null, reasons: ['No community rules were provided, so posting cannot be recommended. Open the subreddit’s sidebar or About page, copy the rules here, and check again.'], findings: [], rules_provided: false };
  for (const [re, code, level, text] of RULES) if (re.test(rules)) findings.push({ code, level, text });
  if (/https?:\/\/|www\./i.test(draft) && findings.some(f => f.code === 'no_links')) findings.push({ code: 'draft_has_link', level: 'blocked', text: 'Your draft contains a link, which the rules forbid.' });
  if (draft && !/\b(i (work|run|founded|make|built)|disclosure|affiliat|my (company|brand|shop|store))\b/i.test(draft)) findings.push({ code: 'missing_disclosure', level: 'blocked', text: 'The draft does not disclose your connection to the brand.' });
  const verdict = findings.some(f => f.level === 'blocked') ? 'blocked' : findings.some(f => f.level === 'caution') ? 'caution' : 'allowed_if_followed';
  return { verdict, participation: a ? a.participation : null, reasons: findings.map(f => f.text), findings, rules_provided: true,
    note: verdict === 'allowed_if_followed' ? 'No conflict found in the rules you pasted. You still need to read them yourself; this check can miss unwritten norms and moderator discretion.' : undefined };
}
