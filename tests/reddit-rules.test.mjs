import test from 'node:test'; import assert from 'node:assert/strict';
import { assessThread, checkRules } from '../lib/social/reddit-rules.js';
const q = { title: 'Best soil mix for balcony herbs in Pune?', text: 'My basil keeps dying. Looking for a potting mix that drains well.' };
test('a question asking for recommendations → answer with disclosure', () => { const a = assessThread(q); assert.equal(a.participation, 'answer_with_disclosure'); assert.match(a.audience_problem, /soil mix/i); });
test('a rant or a grief post → stay out, regardless of rules', () => {
  assert.equal(assessThread({ title: 'Worst customer service ever', text: 'So annoyed. Never again.' }).participation, 'stay_out');
  assert.equal(checkRules({ rulesText: 'Be nice.', draft: 'I work at X', thread: { title: 'My dad passed away', text: 'funeral tomorrow' } }).verdict, 'blocked');
});
test('no rules pasted → unknown_rules, never a recommendation to post', () => { const r = checkRules({ rulesText: '', draft: 'x', thread: q }); assert.equal(r.verdict, 'unknown_rules'); assert.equal(r.rules_provided, false); });
test('promotion ban blocks; link ban + link in draft blocks; missing disclosure blocks', () => {
  assert.equal(checkRules({ rulesText: 'Rule 2: No self-promotion or advertising.', draft: 'I work at Fern & Form. Try X.', thread: q }).verdict, 'blocked');
  const r = checkRules({ rulesText: 'No links allowed.', draft: 'I work at Fern & Form. See https://example.com', thread: q }); assert.equal(r.verdict, 'blocked'); assert.ok(r.findings.some(f => f.code === 'draft_has_link'));
  assert.ok(checkRules({ rulesText: 'Be kind.', draft: 'Try a coir mix.', thread: q }).findings.some(f => f.code === 'missing_disclosure'));
});
test('benign rules + disclosed draft → allowed_if_followed with a caveat that the person must still read the rules', () => {
  const r = checkRules({ rulesText: 'Be kind. Stay on topic.', draft: 'Disclosure: I work at Fern & Form. A coir mix drains well.', thread: q }); assert.equal(r.verdict, 'allowed_if_followed'); assert.match(r.note, /still need to read/);
});
test('karma/age and ratio rules produce cautions', () => { const r = checkRules({ rulesText: 'Accounts need at least 30 days old and 100 karma. Follow the 9:1 ratio.', draft: 'I work at X.', thread: q }); assert.equal(r.verdict, 'caution'); });
