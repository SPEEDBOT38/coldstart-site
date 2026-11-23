/* Coldstart v4 core: shared state, server calls, plan generation, handoff.
   Honesty rules (from the v3 contract): no invented scores, no simulated results shown as live,
   nothing spends or publishes without an explicit approval, unavailable data says "not available". */
(function () {
  const KEY = 'coldstart.v4';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fresh = () => ({
    v: 4, step: 0, input: { site: '', desc: '', noSite: false },
    scan: null, brand: null, products: [], icps: [], sources: null,
    goal: { k: '', target: '' },
    bounds: { region: '', regionMode: 'decide', channels: 'both', budget: '', budgetMode: 'tbd', audience: '', audienceMode: 'find' },
    plan: [], campaigns: [], inbox: [], activity: [], research: null, usage: { researchRuns: 0 }, done: false,
    audit: [], ledger: [], approvals: [], offer: { name: '', price: '', url: '' },
    policy: { approval: 'each', allow: { draft: true, organic: false, paid: false, budget: false }, caps: { research: 20, credits: 40 }, paused: false }
  });
  let S;
  try { S = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || 'null') || {}); } catch (e) { S = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); return true; } catch (e) { return false; } };

  async function api(path, body) {
    const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coldstart': '1' }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) { /* non-json */ }
    if (!r.ok) throw Object.assign(new Error(j.error || ('Request failed (' + r.status + ')')), { status: r.status, code: j.code });
    return j;
  }
  // Server-authoritative operations (policy, masters, jobs, approvals, execution). Workspace identity is a sealed cookie.
  const ops = {
    post: (a, body) => api('plugins/ops/actions/' + a, body || {}),
    async get(a, q) { const r = await fetch('/api/plugins/ops/actions/' + a + (q ? '?' + new URLSearchParams(q) : '')); let j = {}; try { j = await r.json(); } catch (e) { /* ignore */ } if (!r.ok) throw Object.assign(new Error(j.error || ('Request failed (' + r.status + ')')), { status: r.status, code: j.code }); return j; }
  };


  /* Immutable-style audit trail and cost ledger. Hash = SHA-256 of the exact action payload. */
  async function hash(obj) { try { const b = new TextEncoder().encode(JSON.stringify(obj)); const h = await crypto.subtle.digest('SHA-256', b); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return ''; } }
  async function log(type, text, payload) {
    S.audit = S.audit || []; const e = { id: 'ev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), actor: 'You', type, text, payload: payload || null, hash: payload ? await hash(payload) : '' };
    S.audit.unshift(e); S.audit = S.audit.slice(0, 300); save(); return e;
  }
  function cost(kind, usd, note) { S.ledger = S.ledger || []; S.ledger.unshift({ id: 'c-' + Date.now().toString(36), at: new Date().toISOString(), kind, usd: usd == null ? null : usd, note }); S.ledger = S.ledger.slice(0, 300); save(); }
  const parseSite = (v) => {
    v = String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : '';
  };
  /* Currency is never assumed. It comes from the confirmed product, the site scan, or the target country, in that order. */
  const COUNTRY_CUR = { IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED' };
  const currency = () => (S.flagship && S.flagship.currency) || (S.brand && S.brand.currency) || COUNTRY_CUR[(S.bounds || {}).country] || null;
  const money = (n, cur) => {
    if (n == null || n === '' || !isFinite(Number(n))) return 'Unknown';
    const c = cur === undefined ? currency() : cur;
    if (!c) return Number(n).toLocaleString('en') + ' (currency not set)';
    try { return new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(n)); } catch (e) { return c + ' ' + Number(n).toLocaleString('en'); }
  };
  const curSymbol = (c) => { c = c === undefined ? currency() : c; if (!c) return ''; try { return new Intl.NumberFormat('en', { style: 'currency', currency: c }).formatToParts(0).find((x) => x.type === 'currency').value; } catch (e) { return c; } };

  /* Goal suggestion: based on what was read, never asked up front. */
  function suggestGoal() {
    const hasProducts = (S.products || []).length > 0;
    return hasProducts ? 'sales' : 'signups';
  }
  const GOALS = [
    { k: 'sales', t: 'Sales', d: 'Orders on your store. Needs a verified purchase event to measure.', unit: 'orders' },
    { k: 'signups', t: 'Signups', d: 'Trials, waitlist or accounts. Needs a signup event.', unit: 'signups' },
    { k: 'traffic', t: 'Traffic', d: 'Visits to your site. Measurable without a pixel.', unit: 'visits' },
    { k: 'awareness', t: 'Awareness', d: 'Reach and attention. Hardest to tie to revenue.', unit: 'people reached' }
  ];

  /* ---- Plan: built only from what the scan returned plus the founder's boundaries ---- */
  function icpMentions(platform) {
    return (S.icps || []).filter((i) => i.on !== false && (i.scroll || []).some((s) => new RegExp(platform, 'i').test(s)));
  }
  function confidence(hits) {
    // Honest: "High" needs engagement data we do not have at plan time, so the ceiling is Medium.
    if (!S.scan || S.scan.mode !== 'live') return { l: 'Low', why: 'Built from your description only. The website was not read.' };
    return hits ? { l: 'Medium', why: 'Your site copy and ICP evidence point here. No engagement data yet.' } : { l: 'Low', why: 'Nothing in your site read points to this channel yet.' };
  }
  function buildPlan() {
    const B = S.bounds, g = S.goal.k, out = [];
    const paidOk = B.channels !== 'organic' && B.budgetMode === 'amount' && Number(B.budget) > 0;
    const orgOk = B.channels !== 'paid';
    const region = B.region || 'your first market';
    const ev = (hits) => hits.map((i) => i.evidence).filter(Boolean).slice(0, 2);
    const ig = icpMentions('Instagram'), rd = icpMentions('Reddit'), xx = icpMentions('^X$|Twitter');
    if (orgOk || paidOk) {
      out.push({
        id: 'o-ig', ch: 'instagram', title: 'Instagram discovery posts for ' + (ig[0] ? ig[0].name : 'your main customer'),
        kind: 'Organic · Regional', summary: 'Reels and posts aimed at the buyer your site describes, starting in ' + region + '.',
        audience: ig[0] ? ig[0].who + '. Pain: ' + ig[0].pain : 'To be confirmed.', evidence: ev(ig), conf: confidence(ig.length),
        cost: 'No platform fee. You supply or approve every creative.', geo: B.region ? 'You chose ' + B.region + '. This is your stated focus, not measured demand.' : 'No region chosen yet.',
        competition: 'Not measured yet. Use Pull Meta Ad Library for rival ads.', next: 'Prepare drafts', needs: 'Instagram professional account to publish. Drafts work without it.'
      });
    }
    if (paidOk) {
      out.push({
        id: 'p-meta', ch: 'meta', title: 'Meta paid test, ' + region,
        kind: 'Paid · Regional', summary: 'One small test of two creatives against one audience, capped at ' + money(B.budget) + ' a month.',
        audience: (ig[0] || S.icps[0] || {}).who || 'To be confirmed.', evidence: ev(ig.length ? ig : S.icps.slice(0, 1)), conf: confidence(ig.length),
        cost: 'Your cap: ' + money(B.budget) + '/month. Nothing runs without your approval.',
        geo: B.region ? 'Targeting follows the region you chose.' : 'No region chosen yet.', competition: 'Not measured yet.', next: 'Prepare test plan',
        needs: g === 'sales' || g === 'signups' ? 'A verified conversion event. Without it the launch review warns you and offers a traffic test instead.' : 'Meta ad account connection.'
      });
    }
    if (orgOk) {
      out.push({
        id: 'o-rd', ch: 'reddit', title: 'Useful answers in eligible Reddit communities',
        kind: 'Organic · Community', summary: 'Find threads where your buyer asks for help, check each community’s rules, then draft a helpful reply you approve.',
        audience: rd[0] ? rd[0].who : 'Shoppers and founders asking the question your product answers.', evidence: ev(rd), conf: confidence(rd.length),
        cost: 'Research uses a small scan. Posting is manual: Reddit access for commercial tools needs Reddit’s approval.',
        geo: 'Communities are topics, not places. Region is inferred only when a post says so.', competition: 'Not measured yet.', next: 'Find threads',
        needs: 'Community rules must allow it. A drafted reply is never auto-posted.', assisted: true
      });
      out.push({
        id: 'o-x', ch: 'x', title: 'A short educational post series on X',
        kind: 'Organic · Conversation', summary: 'Three to five concise posts around the problem your product solves.',
        audience: xx[0] ? xx[0].who : 'People talking about the problem in your category.', evidence: ev(xx), conf: confidence(xx.length),
        cost: 'X charges per use: about $0.015 per post, $0.20 for a post with a link. Counted in the launch review.',
        geo: 'X cannot target a city precisely. Regional fit is inferred, not guaranteed.', competition: 'Not measured yet.', next: 'Draft the series',
        needs: 'X developer access to publish. Drafts work without it.'
      });
    }
    return out;
  }

  /* Campaign made from the plan. One goal-led project, many channels. */
  function makeCampaign() {
    const g = GOALS.find((x) => x.k === S.goal.k) || GOALS[0];
    const t = Number(S.goal.target) || 0;
    const items = S.plan.filter((p) => !p.dismissed);
    return {
      id: 'c1', name: t ? 'Get our first ' + t + ' ' + g.unit : 'First ' + g.unit + ' campaign', status: 'draft', goal: g.k, target: t,
      cap: S.bounds.budgetMode === 'amount' ? Number(S.bounds.budget) || 0 : 0, region: S.bounds.region || '',
      steps: items.map((p) => ({ id: p.id, ch: p.ch, text: p.title, state: p.assisted ? 'review' : (p.ch === 'meta' ? 'needs_account' : 'review'), approved: false }))
    };
  }

  function seedInbox() {
    const inbox = [];
    (S.campaigns || []).forEach((c) => inbox.push({ id: 'i-launch-' + c.id, kind: 'approval', title: 'Review the first campaign: ' + c.name, sub: 'Nothing goes live until you approve it.', to: '#/campaigns/' + c.id }));
    (S.products || []).length && inbox.push({ id: 'i-brand', kind: 'confirm', title: 'Check your Brand DNA once more', sub: 'Colours, voice and “avoid” words steer every draft.', to: '#/settings' });
    return inbox;
  }

  function finish() {
    S.plan = buildPlan(); S.campaigns = [makeCampaign()]; S.inbox = seedInbox(); S.done = true;
    S.activity.unshift({ t: new Date().toISOString(), text: 'Studied ' + ((S.brand && S.brand.name) || 'your business') + (S.scan && S.scan.mode === 'live' ? ' (website read)' : ' (from your description)') });
    S.activity.unshift({ t: new Date().toISOString(), text: 'Prepared ' + S.plan.length + ' opportunities and one campaign draft' });
    save(); writeHandoff();
  }

  /* v3 workspace compatibility: same contract the existing workspace imports. */
  function writeHandoff() {
    const b = S.brand || {};
    const data = {
      v: 1, at: new Date().toISOString(), real: !!(S.scan && S.scan.mode === 'live'),
      brand: { name: b.name, url: parseSite(S.input.site) ? 'https://' + parseSite(S.input.site) : '', ig: '', line: b.line || S.input.desc, category: '', revenue: '', voice: (b.tones || []).join(', '), avoid: (b.dont || []).join(', ') },
      book: { colors: b.colors || [], names: b.names || [], fonts: b.fonts || [], tones: b.tones || [], headline: b.headline || '', say: b.say || '', fromSite: !!b.fromSite, logo: b.logo || null },
      products: (S.products || []).slice(0, 40).map((p) => ({ name: p.name, price: p.price, image: p.image || null, url: p.url || null, src: p.src })),
      icps: (S.icps || []).filter((i) => i.on !== false).slice(0, 2).map((p, i) => ({ role: i ? 'backup' : 'main', name: p.name, who: p.who, pain: p.pain, scroll: p.scroll, hook: p.hook, fmt: p.fmt, evidence: p.evidence || '' })),
      competitors: [], sources: S.sources || null
    };
    try { localStorage.setItem('coldstart.handoff.v1', JSON.stringify(data)); } catch (e) { /* storage blocked */ }
  }

  window.CS = { currency, curSymbol, COUNTRY_CUR, ops, hash, log, cost, get S() { return S; }, set S(v) { S = v; }, save, fresh, api, esc, parseSite, money, GOALS, suggestGoal, buildPlan, makeCampaign, seedInbox, finish, writeHandoff, reset() { try { localStorage.removeItem(KEY); } catch (e) {} S = fresh(); } };
})();
