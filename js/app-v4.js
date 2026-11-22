/* Coldstart v4 app: goal-first Home with an Action Inbox, Discover (opportunity explorer), Campaigns,
   Calendar, Results, Settings. Everything here is either real (scan, research) or labelled as not yet available.
   Nothing publishes, schedules or spends: P0/P1 stop at approval and "needs connection". */
(function () {
  const C = window.CS, esc = C.esc;
  let S = C.S;
  const view = document.getElementById('view'), crumb = document.getElementById('crumb');
  const $ = (s, r) => (r || document).querySelector(s);
  const cur = () => (S.brand && S.brand.currency) || 'INR';
  const m = (n) => C.money(n, cur());
  const ago = (iso) => { if (!iso) return 'never'; const d = (Date.now() - new Date(iso)) / 60000; return d < 1 ? 'just now' : d < 60 ? Math.round(d) + ' min ago' : d < 1440 ? Math.round(d / 60) + ' h ago' : Math.round(d / 1440) + ' d ago'; };
  const toastEl = document.getElementById('toast'); let tt;
  const toast = (t) => { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('on'), 3200); };
  const CH = { instagram: 'Instagram', meta: 'Meta ads', reddit: 'Reddit', x: 'X' };
  const ICON = {
    home: '<path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/>', discover: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    campaigns: '<path d="M4 6h16M4 12h16M4 18h10"/>', calendar: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    results: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'
  };
  const NAV = [['home', 'Home', 'What matters right now?'], ['discover', 'Discover', 'Where should I market?'], ['campaigns', 'Campaigns', 'What are we creating and running?'], ['calendar', 'Calendar', 'What’s going out, and when?'], ['results', 'Results', 'What’s working?']];

  const camp = () => (S.campaigns || [])[0];
  const approvals = () => (S.inbox || []).filter((i) => i.kind === 'approval');
  const statesLabel = { review: 'Review drafts', needs_account: 'Needs account', approved_wait: 'Approved · waiting for connection', manual: 'Awaiting manual posting' };

  /* ---------------- shell ---------------- */
  function shell() {
    document.getElementById('nav').innerHTML = NAV.map(([k, t]) => {
      const ct = k === 'home' ? approvals().length : 0;
      return `<a class="nl" href="#/${k}" data-nav="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${ICON[k]}</svg>${t}${ct ? `<span class="ct">${ct}</span>` : ''}</a>`;
    }).join('');
    const b = S.brand || {};
    $('#ws-name').textContent = b.name || 'Your business';
    $('#ws-av').textContent = (b.name || 'C').charAt(0).toUpperCase();
  }
  function route() {
    S = C.S;
    if (!S.done) { view.innerHTML = `<div class="hero"><span class="checker"></span><div><h2>Let’s start with your website.</h2><p>Coldstart needs one minute to study your business before it can plan anything.</p><div class="row"><a class="btn paper lg" href="onboarding-v4.html">Start onboarding →</a></div></div></div>`; crumb.textContent = 'Welcome'; shell(); return; }
    const parts = (location.hash.replace(/^#\//, '') || 'home').split('/');
    const k = NAV.some((n) => n[0] === parts[0]) || ['inbox', 'settings'].includes(parts[0]) ? parts[0] : 'home';
    shell();
    document.querySelectorAll('[data-nav]').forEach((a) => { if (a.dataset.nav === k) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    crumb.textContent = (NAV.find((n) => n[0] === k) || [0, k === 'inbox' ? 'Action Inbox' : 'Settings'])[1];
    document.body.classList.remove('menu-open');
    ({ home, discover, campaigns, calendar, results, inbox: (t) => window.Ops.inbox(view, t), settings: (t) => window.Ops.settings(view, t) })[k](parts[1]);
    if (k === 'home') view.insertAdjacentHTML('beforeend', composer());
    bindComposer(document);
    window.Ops.refresh();
    revalidate();
  }
  window.addEventListener('hashchange', route);
  $('#menu').addEventListener('click', () => document.body.classList.toggle('menu-open'));

  /* ---------------- HOME ---------------- */
  function next() { return (S.plan || []).find((p) => !p.dismissed); }
  function home() {
    const b = S.brand || {}, n = next(), c = camp();
    const sched = c ? c.steps.filter((s) => s.state === 'scheduled').length : 0;
    const needApproval = approvals().length + (c ? c.steps.filter((s) => !s.approved && (c.status === 'approved')).length : 0);
    const active = (S.campaigns || []).filter((x) => x.status === 'live').length;
    const mode = c && c.status === 'approved' ? 1 : S.research ? 1 : 0;
    const summary = needApproval ? `Your marketing is prepared. ${needApproval} decision${needApproval > 1 ? 's' : ''} need${needApproval > 1 ? '' : 's'} you.` : 'Nothing needs you right now.';
    view.innerHTML = `
    <div class="pagehead"><div><span class="eyebrow">${esc(b.name || 'Workspace')} / Workspace</span><h1 class="disp">Here’s where we <b>stand.</b></h1><p class="muted">${esc(summary)}</p></div>
      <span class="status-pill"><i></i>${['Researching', 'Preparing', 'Monitoring'][mode]}</span></div>
    ${n ? `<section class="hero" aria-label="Your next best move"><span class="checker" aria-hidden="true"></span><div>
      <span class="eyebrow" style="color:#c5c5ff">Your next best move · Suggested</span>
      <h2>${esc(n.title)}</h2><p>${esc(n.summary)} ${esc(n.cost)}</p>
      <div class="row"><a class="btn paper" href="#/campaigns/c1">Review test plan →</a><button class="btn ghost" data-why="${n.id}" type="button" style="color:var(--paper)">Why this?</button></div></div>
      <img src="assets/mascot/idle_stand.poster.webp" alt="" width="200" height="200"></section>` : `<section class="hero"><span class="checker"></span><div><h2>No open moves.</h2><p>You dismissed every suggestion. Open Discover to explore more places.</p><a class="btn paper" href="#/discover">Open Discover</a></div></section>`}
    <div class="stats"><div class="stat"><strong>${sched}</strong><span>Scheduled</span></div><div class="stat"><strong>${needApproval}</strong><span>Need approval</span></div><div class="stat"><strong>${active}</strong><span>Active test</span></div></div>
    <div class="grid-main"><div class="stack">
      <section class="panel" aria-labelledby="inb"><div class="panel-h"><h2 id="inb">Action Inbox</h2><span class="chip y">${(S.inbox || []).length} open</span></div>
        ${(S.inbox || []).length ? S.inbox.map((i) => `<div class="inbox-row"><i class="dot ${i.kind === 'approval' ? 'y' : ''}"></i><div><strong>${esc(i.title)}</strong><small>${esc(i.sub)}</small></div><div style="display:flex;gap:8px"><a class="btn sm" href="${esc(i.to)}">${i.kind === 'approval' ? 'Review' : 'Check'}</a><button class="btn sm ghost" data-clear="${esc(i.id)}" type="button">Done</button></div></div>`).join('') : '<div class="empty"><strong>Inbox is clear.</strong><p>Anything that needs your approval will appear here, so you don’t have to keep checking.</p></div>'}
      </section>
      <section class="panel" aria-labelledby="wk"><div class="panel-h"><h2 id="wk">What I’ve been working on</h2></div>
        ${(S.activity || []).slice(0, 6).map((a) => `<div class="work-row"><i class="dot"></i><div>${esc(a.text)}<small>${ago(a.t)}</small></div></div>`).join('') || '<div class="empty">Nothing yet.</div>'}</section>
    </div><div class="stack">
      <section class="panel"><div class="panel-h"><h2>Agent mode</h2></div><div class="modes">${[['Researching', 'Compares audiences and communities.'], ['Preparing', 'Drafts plans, budgets and schedules.'], ['Monitoring', 'Checks delivery and data quality.']].map((x, i) => `<div class="${i === mode ? 'on' : ''}"><b>${x[0]}</b>${x[1]}</div>`).join('')}</div></section>
      <section class="panel"><div class="panel-b"><span class="eyebrow">Your boundaries</span>
        <div class="fact-row"><span>Goal</span><span>${esc((C.GOALS.find((g) => g.k === S.goal.k) || {}).t || '')}${S.goal.target ? ' · ' + esc(S.goal.target) : ''}</span></div>
        <div class="fact-row"><span>Region</span><span>${esc(S.bounds.region || 'Open')}</span></div>
        <div class="fact-row"><span>Ad cap</span><span>${S.bounds.budgetMode === 'amount' ? m(S.bounds.budget) + '/mo' : 'Organic only'}</span></div>
        <div style="margin-top:12px"><a class="link" href="#/settings">Change in Settings</a></div></div></section>
    </div></div>`;
    view.querySelectorAll('[data-why]').forEach((b) => b.addEventListener('click', () => drawer(b.dataset.why)));
    view.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => { S.inbox = S.inbox.filter((i) => i.id !== b.dataset.clear); C.save(); route(); }));
  }

  /* ---------------- DISCOVER ---------------- */
  let dView = 'market', dBusy = false, dErr = '';
  function regions() { return (S.bounds.region || '').split(/[,/]| and /).map((x) => x.trim()).filter(Boolean).slice(0, 6); }
  function communities() {
    const R = S.research; if (!R || !R.signals) return [];
    const map = {};
    R.signals.forEach((s) => {
      const u = s.url || '', mm = u.match(/reddit\.com\/r\/([^/]+)/i);
      const key = s.source === 'reddit' && mm ? 'r/' + mm[1] : s.source === 'x' ? 'X conversations' : (s.source || 'other');
      const g = map[key] || (map[key] = { name: key, src: s.source, n: 0, verified: 0, sample: [] });
      g.n++; if (s.verified) g.verified++; if (g.sample.length < 3) g.sample.push(s);
    });
    return Object.values(map).sort((a, b) => b.verified - a.verified || b.n - a.n);
  }
  function discover() {
    const regs = regions(), comms = communities();
    view.innerHTML = `
    <div class="pagehead"><div><span class="eyebrow">Discover</span><h1 class="disp">Find where your next customers <b>might be.</b></h1><p class="muted">Rank regions and communities by audience fit, channel feasibility and evidence. I only rank when there’s enough evidence.</p></div>
      <div class="seg" role="group" aria-label="View"><button data-v="market" aria-pressed="${dView === 'market'}" type="button">Market view</button><button data-v="community" aria-pressed="${dView === 'community'}" type="button">Community view</button></div></div>
    <div class="filters"><span class="chip dash">${esc(S.bounds.region || 'Any region')}</span><span class="chip dash">English${(S.brand && S.brand.currency === 'INR') || !S.brand ? ' + Hindi' : ''}</span><span class="chip dash">${S.bounds.channels === 'organic' ? 'Organic' : S.bounds.channels === 'paid' ? 'Paid' : 'All channels'}</span></div>
    ${dView === 'market' ? marketView(regs) : communityView(comms)}
    <section aria-labelledby="po"><div class="pagehead" style="margin-bottom:14px"><h2 class="disp s" id="po">Potential opportunities</h2><span class="muted small">Illustrative structure comes from your own site read. Real ranking needs source evidence, dates and eligibility checks.</span></div>
      <div class="opp-grid">${(S.plan || []).map(oppCard).join('') || '<div class="empty">No opportunities yet. Add a channel preference in Settings.</div>'}</div></section>`;
    view.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { dView = b.dataset.v; discover(); bindAfter(); }));
    view.querySelectorAll('[data-why]').forEach((b) => b.addEventListener('click', () => drawer(b.dataset.why)));
    view.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => { const p = S.plan.find((x) => x.id === b.dataset.save); p.saved = !p.saved; C.save(); discover(); bindAfter(); }));
    view.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', () => { const p = S.plan.find((x) => x.id === b.dataset.dismiss); p.dismissed = true; syncCampaign(); C.save(); toast('Dismissed. It’s out of the campaign too.'); discover(); bindAfter(); }));
    if (window.Social) window.Social.section(view);
    const rr = $('#run-research'); if (rr) rr.addEventListener('click', runResearch);
    const sr = $('#set-region'); if (sr) sr.addEventListener('submit', (e) => { e.preventDefault(); S.bounds.region = $('#rg').value.trim(); S.bounds.regionMode = 'set'; C.save(); discover(); bindAfter(); });
  }
  const bindAfter = () => {};
  function oppCard(p) {
    return `<article class="opp ${p.dismissed ? 'blocked' : ''}"><div class="tags"><span class="chip b">${esc(p.kind)}</span><span class="chip ${p.conf.l === 'Low' ? 'warn' : 'y'}">${p.conf.l} confidence</span>${p.assisted ? '<span class="chip dash">Assisted</span>' : ''}${p.saved ? '<span class="chip">Saved</span>' : ''}</div>
      <h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p>
      <div class="row">${p.dismissed ? '<span class="muted small">Dismissed</span>' : `<button class="btn sm" data-why="${p.id}" type="button">Why here?</button><button class="btn sm ghost" data-save="${p.id}" type="button">${p.saved ? 'Unsave' : 'Save'}</button><button class="btn sm ghost" data-dismiss="${p.id}" type="button">Dismiss</button>`}</div></article>`;
  }
  function marketView(regs) {
    if (!regs.length) return `<section class="focus-card"><h2>Where should we focus?</h2><p>You asked me to help decide. Name one or two places you’d like to compare, and I’ll show the evidence for each. Until then I won’t rank anything.</p>
      <form id="set-region" style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><input id="rg" type="text" placeholder="Bengaluru, Mumbai" style="max-width:340px" aria-label="Regions to compare"><button class="btn yellow" type="submit">Compare these</button></form></section>`;
    return `<section class="focus-card"><h2>Where should we focus?</h2><p>Not enough evidence to rank these regions yet. Run research to see what people actually say. I won’t invent a score.</p></section>
      <div class="regions">${regs.map((r) => `<div class="region"><strong>${esc(r)}</strong><div class="meter" aria-hidden="true"></div><span class="small muted">Evidence: none yet. Audience fit, competition and cost are unmeasured.</span><span class="chip dash" style="justify-self:start">Unranked</span></div>`).join('')}</div>
      <div><button class="btn" id="run-research" type="button" ${dBusy ? 'disabled' : ''}>${dBusy ? 'Reading Reddit and X…' : S.research ? 'Refresh research' : 'Run research'}</button> <span class="muted small">${researchMeta()}</span></div>${dErr ? `<div class="err" style="margin-top:8px;color:var(--ink)">${esc(dErr)}</div>` : ''}`;
  }
  function researchMeta() { return S.research ? 'Last updated ' + ago(S.research.at) + ' · ' + (S.research.signals || []).length + ' posts · showing saved results first, refresh costs a small scan' : 'One scan across Reddit and X. Takes up to a minute.'; }
  function communityView(comms) {
    const head = `<section class="focus-card"><h2>Where can we meaningfully participate?</h2><p>Communities are topics, not places, so there’s no map here. Relevant is not the same as allowed: check each community’s rules before posting.</p></section>`;
    if (!comms.length) return head + `<div class="empty" style="margin:0"><strong>No research yet.</strong><p>Run one scan to see which communities talk about your buyer’s problem.</p><button class="btn" id="run-research" type="button" ${dBusy ? 'disabled' : ''} style="margin-top:12px">${dBusy ? 'Reading Reddit and X…' : 'Run research'}</button>${dErr ? `<div class="err" style="margin-top:10px">${esc(dErr)}</div>` : ''}</div>`;
    return head + `<div class="panel"><div class="panel-h"><h2>Ranked by verified posts</h2><span class="muted small">${researchMeta()}</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Community</th><th>Posts</th><th>Verified</th><th>Rules</th></tr></thead><tbody>
      ${comms.map((c) => `<tr><td><strong>${esc(c.name)}</strong><br><small class="muted">${esc((c.sample[0] && (c.sample[0].title || c.sample[0].text) || '').slice(0, 90))}</small></td><td>${c.n}</td><td>${c.verified}</td><td><span class="chip warn">Not checked</span></td></tr>`).join('')}</tbody></table></div></div>
      <div><button class="btn" id="run-research" type="button" ${dBusy ? 'disabled' : ''}>${dBusy ? 'Reading Reddit and X…' : 'Refresh research'}</button></div>${dErr ? `<div class="err">${esc(dErr)}</div>` : ''}`;
  }
  async function runResearch() {
    if (dBusy) return;
    const blocked = window.Ops.guard('research'); if (blocked) { dErr = blocked; discover(); return; }
    dBusy = true; dErr = ''; discover(); bindAfter();
    const i = (S.icps || []).find((x) => x.on !== false) || {};
    const q = ((i.pain || (S.brand && S.brand.line) || '') + '').replace(/\s+/g, ' ').slice(0, 120);
    try {
      const r = await C.api('plugins/research/actions/scan', { query: q, sources: ['reddit', 'x'], brand: (S.brand && S.brand.name) || '' });
      S.research = { at: r.at || new Date().toISOString(), query: r.query, signals: r.signals || [], themes: r.themes || [], sources: r.sources || {} };
      S.usage.researchRuns = (S.usage.researchRuns || 0) + 1;
      S.activity.unshift({ t: new Date().toISOString(), text: 'Ran research on Reddit and X: ' + (r.signals || []).length + ' posts found for “' + q.slice(0, 60) + '”' });
      C.log('research', 'Research scan on Reddit and X', { query: q, sources: ['reddit', 'x'], found: (r.signals || []).length }); C.cost('Research scan', r.cost && r.cost.usd != null ? r.cost.usd : null, 'Reddit + X, ' + (r.signals || []).length + ' posts');
      if (!(r.signals || []).length) dErr = 'The scan finished but found no posts that matched. Try again later or change the audience description.';
    } catch (e) { dErr = 'Research isn’t available right now: ' + e.message; }
    dBusy = false; C.save(); if (location.hash.indexOf('discover') > -1) { discover(); bindAfter(); }
  }

  /* drawer: "Why here?" */
  function drawer(id) {
    const p = (S.plan || []).find((x) => x.id === id); if (!p) return;
    const sig = (S.research && S.research.signals || []).filter((s) => (p.ch === 'reddit' && s.source === 'reddit') || (p.ch === 'x' && s.source === 'x')).slice(0, 3);
    const evid = [].concat((p.evidence || []).map((t) => `<div>“${esc(t)}” <small class="muted">from your site</small></div>`), sig.map((s) => `<div><a href="${esc(s.url || '#')}" target="_blank" rel="noopener noreferrer">${esc((s.title || s.text || 'Post').slice(0, 90))}</a> <small class="muted">${esc(s.source)}${s.verified ? ' · verified' : ''}</small></div>`));
    const rules = p.ch === 'reddit' ? '<dt>Rules</dt><dd>Relevance is not permission. Each community’s rules must be checked before a post is proposed. Promotional posts are excluded where rules prohibit them.</dd>' : '';
    const el = document.createElement('div');
    el.innerHTML = `<div class="drawer-back" data-x></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Why here?"><div class="drawer-h"><div><span class="eyebrow">Why here?</span><h2 class="disp s">${esc(p.title)}</h2></div><button class="btn sm ghost" data-x type="button">Close</button></div>
      <dl class="drawer-b">
        <div class="why"><dt>Audience match</dt><dd>${esc(p.audience)}</dd></div>
        <div class="why"><dt>Evidence</dt><dd>${evid.length ? evid.join('') : 'No source evidence yet. Run research in Discover to attach real posts with dates.'}</dd></div>
        <div class="why"><dt>Geography</dt><dd>${esc(p.geo)}</dd></div>
        <div class="why"><dt>Competition</dt><dd>${esc(p.competition)}</dd></div>
        <div class="why"><dt>Channel</dt><dd>${esc(p.kind)}${p.assisted ? '. Assisted: you post, I draft.' : ''}<br><small class="muted">${esc(p.needs)}</small></dd></div>
        ${rules ? `<div class="why">${rules}</div>` : ''}
        <div class="why"><dt>Cost</dt><dd>${esc(p.cost)}</dd></div>
        <div class="why"><dt>Confidence</dt><dd><span class="chip ${p.conf.l === 'Low' ? 'warn' : 'y'}">${p.conf.l}</span> ${esc(p.conf.why)}</dd></div>
      </dl>
      <div class="drawer-f"><a class="btn" href="#/campaigns/c1" data-x>${esc(p.next)} →</a><button class="btn ghost" data-sv type="button">${p.saved ? 'Unsave' : 'Save'}</button><button class="btn ghost" data-dm type="button">Dismiss</button></div></aside>`;
    document.body.appendChild(el);
    const close = () => { el.remove(); document.removeEventListener('keydown', esc_); };
    const esc_ = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc_);
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
    $('[data-sv]', el).onclick = () => { p.saved = !p.saved; C.save(); close(); toast(p.saved ? 'Saved' : 'Unsaved'); };
    $('[data-dm]', el).onclick = () => { p.dismissed = true; syncCampaign(); C.save(); close(); route(); };
    const f = $('.drawer .btn', el); f && f.focus();
  }

  /* ---------------- CAMPAIGNS ---------------- */
  function syncCampaign() {
    const c = camp(); if (!c) return;
    const live = (S.plan || []).filter((p) => !p.dismissed);
    c.steps = live.map((p) => c.steps.find((s) => s.id === p.id) || { id: p.id, ch: p.ch, text: p.title, state: p.assisted ? 'review' : (p.ch === 'meta' ? 'needs_account' : 'review'), approved: false });
  }
  function campaigns(id) {
    if (id === 'studio' || id === 'library') { crumb.textContent = id === 'studio' ? 'Creative Studio' : 'Product Library'; window.Studio[id](view).then(bindAfter).catch((e) => { view.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }); return; }
    const c = camp();
    if (!c) { view.innerHTML = '<div class="empty">No campaigns yet.</div>'; return; }
    if (!id) {
      view.innerHTML = `<div class="pagehead"><div><span class="eyebrow">Campaigns</span><h1 class="disp">What we’re creating and <b>running.</b></h1><p class="muted">A campaign is a goal-led project across channels, not a single Meta campaign.</p></div></div>
      <div class="camp-list"><a class="camp" href="#/campaigns/${c.id}" style="text-decoration:none"><div><strong>${esc(c.name)}</strong><span class="muted small">${c.steps.length} channel${c.steps.length === 1 ? '' : 's'} · ${esc(c.status === 'approved' ? 'Approved, waiting for connections' : 'Draft')}</span></div><span class="chip ${c.status === 'approved' ? 'b' : 'y'}">${c.status === 'approved' ? 'Approved' : 'Draft'}</span></a></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn ghost" href="#/campaigns/studio">Creative Studio</a><a class="btn ghost" href="#/campaigns/library">Product Library</a></div>`;
      return;
    }
    const g = C.GOALS.find((x) => x.k === c.goal) || {};
    view.innerHTML = `${window.Studio ? '' : ''}<div><a class="link" href="#/campaigns">← Campaigns</a></div>
    <div class="pagehead"><div><span class="eyebrow">Campaigns / ${esc(c.name)}</span><h1 class="disp">${esc(c.name)}</h1></div><span class="chip ${c.status === 'approved' ? 'b' : 'y'}">${c.status === 'approved' ? 'Approved' : 'Draft'}</span></div>
    <div class="kpis"><div class="kpi"><span class="eyebrow">Target</span><strong>${c.target || '–'}</strong><span class="small muted">${esc(g.unit || '')}</span></div><div class="kpi"><span class="eyebrow">Max ad spend</span><strong>${c.cap ? m(c.cap) : '–'}</strong><span class="small muted">${c.cap ? 'per month, your cap' : 'organic only'}</span></div><div class="kpi"><span class="eyebrow">Markets</span><strong>${regions().length || '–'}</strong><span class="small muted">${esc(S.bounds.region || 'not chosen')}</span></div></div>
    <section class="panel"><div class="panel-h"><h2>Execution plan</h2><span class="muted small">Draft · not a performance forecast</span></div>
      ${c.steps.length ? c.steps.map((s) => `<div class="exec"><span class="plat">${CH[s.ch] || s.ch}</span><div>${esc(s.text)}<br><small class="muted">${s.ch === 'reddit' ? 'Assisted: I draft, you post' : s.ch === 'meta' ? 'Needs Meta ad account + verified conversion event' : 'Drafts ready to write in Studio'}</small></div><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="chip ${s.approved ? 'b' : 'dash'}">${esc(s.approved ? (s.ch === 'reddit' ? statesLabel.manual : statesLabel.approved_wait) : statesLabel[s.state])}</span><a class="btn sm ghost" href="#/campaigns/studio">Open Studio</a></span></div>`).join('') : '<div class="empty">Every channel was removed. Add one from Discover.</div>'}
    </section>
    ${execPanel(c)}
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn lg" id="launch" type="button" ${c.steps.length ? '' : 'disabled'}>${c.status === 'approved' ? 'View launch review' : 'Review & launch'} →</button><button class="btn lg ghost" id="adjust" type="button">Adjust plan</button><a class="btn lg ghost" href="#/campaigns/studio">Creative Studio</a></div>`;
    $('#launch').onclick = launchReview;
    wireExec(c); revalidate();
    $('#adjust').onclick = () => window.Ops.openAssist();
  }
  /* The exact object a person approves. The server hashes it (canonical JSON, SHA-256) and re-checks it before anything runs. */
  async function launchPayload(c) {
    const chs = [...new Set(c.steps.flatMap((x) => (x.ch === 'meta' ? ['instagram', 'facebook'] : [x.ch])))].filter((x) => ['instagram', 'facebook', 'x', 'reddit'].includes(x));
    const st = (S.studio && S.studio.assets) || [];
    const creatives = [];
    for (const a of st.filter((x) => x.approved && (x.kind === 'shoot' || x.kind === 'ad'))) { const v = await window.Studio.media.get(a.mediaId); if (v) creatives.push({ assetId: a.id, sha256: await window.Studio.sha(v), ...(a.jobId ? { jobId: a.jobId } : {}) }); }
    const url = S.offer && S.offer.url ? S.offer.url : (C.parseSite(S.input.site) ? 'https://' + C.parseSite(S.input.site) : undefined);
    return { campaignId: c.id, name: c.name, objective: ['sales', 'signups'].includes(c.goal) ? 'sales' : c.goal === 'traffic' ? 'traffic' : 'awareness', channels: chs,
      budget: c.cap ? { mode: 'amount', amount: c.cap, currency: 'INR', period: 'month' } : { mode: 'none', amount: 0, currency: 'INR', period: 'day' },
      audience: { countries: S.bounds.country ? [S.bounds.country] : [], regions: String(c.region || '').split(',').map((x) => x.trim()).filter(Boolean) },
      destination: { ...(url ? { url } : {}), ...(S.bounds.adAccount ? { adAccountId: S.bounds.adAccount } : {}) }, creatives, copy: c.steps.map((x) => x.text).slice(0, 30) };
  }
  /* Ask the server whether the approval still matches what is on screen. If not, the approval is void. */
  let verifying = false;
  async function revalidate() {
    const c = camp(); if (!c || c.status !== 'approved' || !c.approvalId || verifying) return;
    verifying = true;
    try {
      const r = await C.ops.post('verify', { approvalId: c.approvalId, payload: await launchPayload(c) });
      if (!r.valid) { c.status = 'draft'; c.steps.forEach((x) => { x.approved = false; }); const ap = (S.approvals || []).find((x) => x.serverId === c.approvalId); if (ap) ap.status = 'invalidated'; C.log('approval', 'Approval voided: ' + (r.reason || 'campaign changed'), { approval: c.approvalId }); C.save(); toast('Your approval was voided because the campaign changed. Review and approve again.'); route(); }
    } catch (e) { /* offline: keep local state, the server still re-checks before any execution */ }
    verifying = false;
  }
  const EXEC = { blocked: ['warn', 'Blocked · Meta not connected', 'Nothing was sent. Connect Meta in Settings → Connections, then create the draft.'], simulated: ['y', 'Simulated · sandbox connection', 'Nothing exists on Meta. This only exercised the flow.'], created: ['b', 'Draft created · paused', 'A paused campaign and ad set exist in your ad account. Creatives are not uploaded and nothing is delivering.'], failed: ['warn', 'Failed', 'Meta rejected or could not complete the request.'] };
  function execPanel(c) {
    if (c.status !== 'approved' || !c.approvalId) return '';
    const e = c.execution, x = e && EXEC[e.state];
    return `<section class="panel" id="exec-panel"><div class="panel-h"><h2>Execution status</h2>${x ? `<span class="chip ${x[0]}">${x[1]}</span>` : '<span class="chip dash">Not started</span>'}</div><div class="panel-b" style="display:grid;gap:10px">
      ${e ? `<p class="small">${esc(e.note || x[2])}</p><small class="mono muted">${esc(e.id || '')} ${e.campaignId ? '· campaign ' + esc(e.campaignId) : ''} · ${new Date(e.at).toLocaleString()}</small>` : '<p class="small muted">Approval recorded. Creating the Meta draft is a separate step and still creates a paused draft only: nothing is published and no money is spent.</p>'}
      <div style="display:flex;gap:8px;flex-wrap:wrap">${!e || ['blocked', 'failed'].includes(e.state) ? '<button class="btn" id="mk-draft" type="button">Create Meta draft (paused)</button>' : ''}<a class="btn ghost" href="#/settings/connections">Connections</a></div>
      <small class="muted">Revoking an approval only works before this step. Once a draft exists, pause or delete it in Meta.</small></div></section>`;
  }
  async function wireExec(c) {
    const b = document.getElementById('mk-draft'); if (!b) return;
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Creating…';
      try { const r = await C.ops.post('execute', { approvalId: c.approvalId, payload: await launchPayload(c) }); c.execution = r.execution; C.log('execution', 'Meta draft: ' + r.execution.state, { id: r.execution.id, state: r.execution.state, reason: r.execution.reason }); C.save(); toast(r.duplicate ? 'Already created. Nothing was repeated.' : (EXEC[r.execution.state] || [])[1] || r.execution.state); }
      catch (e) { toast(e.message); if (e.code === 'payload_changed') await revalidate(); }
      route();
    };
    if (c.execution === undefined) { try { const r = await C.ops.get('execution', { approvalId: c.approvalId }); c.execution = r.execution || null; C.save(); if (r.execution) route(); } catch (e) { /* ignore */ } }
  }
  async function launchReview() {
    const c = camp(), conv = ['sales', 'signups'].includes(c.goal), payload = await launchPayload(c);
    const rows = [
      ['Destination', c.steps.map((s) => CH[s.ch]).join(' · ')],
      ['Content', payload.creatives.length ? payload.creatives.length + ' approved creative' + (payload.creatives.length > 1 ? 's' : '') + ' (by SHA-256)' : 'No creative is approved yet. Approve one in Creative Studio first.'],
      ['Audience', esc(S.bounds.audience || 'Not set') + (S.bounds.region ? ' · ' + esc(S.bounds.region) : '')],
      ['Budget', c.cap ? m(c.cap) + ' monthly cap · nothing is spent without your approval' : 'No ad budget. Organic only.'],
      ['Timing', 'Not scheduled. Dates are set after accounts are connected.'],
      ['Measurement', conv ? '<span class="chip warn">Not connected</span> No conversion event is verified. I won’t forecast conversions.' : 'Traffic goal: measurable without a pixel once the link is tagged.'],
      ['Permissions', '<span class="chip warn">Needs authorization</span> ' + c.steps.map((s) => CH[s.ch]).join(', ')],
      ['Platform charge', c.steps.some((s) => s.ch === 'x') ? 'X: about $0.015 per post, $0.20 with a link.' : 'None known for these channels.']
    ];
    const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Launch review');
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Launch review</h2><button class="btn sm ghost" id="dx" type="button">Close</button></div><div class="dlg-b">
      <table class="table"><tbody>${rows.map((r) => `<tr><th style="width:130px">${r[0]}</th><td>${r[1]}</td></tr>`).join('')}</tbody></table>
      <div class="cols2" style="margin-top:10px"><label class="field"><span>Target country</span><select id="lr-country"><option value="">Choose…</option><option value="IN" ${S.bounds.country === 'IN' ? 'selected' : ''}>India</option><option value="US" ${S.bounds.country === 'US' ? 'selected' : ''}>United States</option><option value="GB" ${S.bounds.country === 'GB' ? 'selected' : ''}>United Kingdom</option><option value="AE" ${S.bounds.country === 'AE' ? 'selected' : ''}>United Arab Emirates</option></select></label>
      <label class="field"><span>Meta ad account (optional now)</span><input id="lr-act" type="text" placeholder="act_1234567890" value="${esc(S.bounds.adAccount || '')}"></label></div>
      ${conv ? '<div class="diff"><strong>Heads up</strong><span>Without a verified conversion event, a paid test can run as a traffic test instead. Set up measurement in Results.</span></div>' : ''}
      <details><summary class="link" style="cursor:pointer">View exact payload</summary><pre id="lr-pay" class="mono small" style="white-space:pre-wrap;background:#fff;border:1px solid var(--rule);padding:10px;margin-top:8px">${esc(JSON.stringify(payload, null, 2))}</pre></details>
      <small class="muted">Your approval is tied to this exact payload. If anything in it changes, the approval is voided. Approving does not publish or spend.</small><div id="lr-err"></div></div>
      <div class="dlg-f"><button class="btn ghost" id="dc" type="button">Not yet</button><button class="btn yellow" id="da" type="button" ${c.status === 'approved' ? 'disabled' : ''}>${c.status === 'approved' ? 'Already approved' : 'Approve this plan (nothing goes live)'}</button></div>`;
    d.showModal();
    $('#dx').onclick = $('#dc').onclick = () => d.close();
    const refresh = async () => { S.bounds.country = $('#lr-country').value; S.bounds.adAccount = $('#lr-act').value.trim(); C.save(); $('#lr-pay').textContent = JSON.stringify(await launchPayload(c), null, 2); };
    $('#lr-country').onchange = refresh; $('#lr-act').onchange = refresh;
    $('#da').onclick = async () => {
      await refresh(); const p = await launchPayload(c); $('#lr-err').innerHTML = '';
      try {
        const r = await C.ops.post('approve', { payload: p }), ap = r.approval;
        S.approvals = S.approvals || []; S.approvals.unshift({ id: ap.id, serverId: ap.id, at: ap.at, actor: ap.actor, action: 'Approve campaign plan', scope: ap.scope, hash: ap.hash, status: 'active', revoked: false, campaign: c.id });
        C.log('approval', 'Approved “' + c.name + '” (decision recorded: nothing published or spent)', { approval: ap.id, hash: ap.hash, payload: p });
        c.status = 'approved'; c.approvalId = ap.id; c.approvedHash = ap.hash; c.execution = undefined; c.steps.forEach((x) => { x.approved = true; });
        S.inbox = S.inbox.filter((i) => i.kind !== 'approval');
        S.activity.unshift({ t: new Date().toISOString(), text: 'You approved “' + c.name + '”. Next: create the Meta draft.' });
        C.save(); d.close(); toast('Approved. Nothing was published or spent.'); route();
      } catch (e) { $('#lr-err').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
  }

  /* ---------------- CALENDAR ---------------- */
  const stLabel = (s) => (s.state === 'published_manual' ? 'Published · manual' : s.ch === 'reddit' ? statesLabel.manual : 'Held · needs connection');
  function calendar() {
    const c = camp(), appr = c && c.status === 'approved' ? c.steps : [];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const manual = appr.filter((s) => s.ch === 'reddit' && s.state !== 'published_manual').length, pubM = appr.filter((s) => s.state === 'published_manual').length;
    view.innerHTML = `<div class="pagehead"><div><span class="eyebrow">Calendar</span><h1 class="disp">What’s going out, and <b>when?</b></h1><p class="muted">Scheduled, published, failed and awaiting-manual-posting stay distinct. “Published” appears only when the platform confirms it or you say you posted it yourself.</p></div></div>
    ${appr.length ? `<div class="week">${days.map((d, i) => `<div class="wday"><h3>${d}</h3>${appr.map((s, n) => [s, n]).filter(([, n]) => n % 5 === i).map(([s, n]) => `<button class="slot" data-slot="${n}" type="button" style="text-align:left;width:calc(100% - 20px)"><strong>${CH[s.ch]}</strong>${esc(s.text)}<span class="chip ${s.state === 'published_manual' ? 'b' : s.ch === 'reddit' ? 'y' : 'dash'}">${stLabel(s)}</span></button>`).join('')}</div>`).join('')}</div>
      <p class="muted small">Proposed slots only. Connect accounts in Settings to schedule. Nothing is scheduled by the app right now.</p>` : `<div class="empty" style="margin:0"><strong>Nothing to schedule yet.</strong><p>Approve a campaign plan first. Approved work appears here with its real status.</p><a class="btn" href="#/campaigns/c1" style="margin-top:12px">Open campaign</a></div>`}
    <div class="panel"><div class="panel-b" style="display:flex;gap:14px;flex-wrap:wrap"><span class="chip dash">Scheduled · 0</span><span class="chip ${pubM ? 'b' : 'dash'}">Published · ${pubM}</span><span class="chip dash">Failed · 0</span><span class="chip y">Awaiting manual posting · ${manual}</span></div></div>`;
    view.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => slotDialog(appr[+b.dataset.slot])));
    if (window.Social) window.Social.calendarSection(view);
  }
  function slotDialog(s) {
    const d = document.getElementById('dlg'), manualOk = s.ch === 'reddit';
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">${esc(CH[s.ch])} · scheduled item</h2><button class="btn sm ghost" id="dx" type="button">Close</button></div><div class="dlg-b">
      <table class="table"><tbody><tr><th style="width:130px">Item</th><td>${esc(s.text)}</td></tr><tr><th>Status</th><td><span class="chip ${manualOk ? 'y' : 'dash'}">${esc(stLabel(s))}</span></td></tr><tr><th>Account</th><td><span class="chip warn">${manualOk ? 'Manual posting' : 'Not connected'}</span></td></tr><tr><th>Approval</th><td>${s.approved ? 'Approved by you' : 'Not approved'}</td></tr><tr><th>Cost</th><td>${s.ch === 'x' ? 'About $0.015 per post, $0.20 with a link (X pay-per-use).' : 'No platform fee known.'}</td></tr></tbody></table>
      ${manualOk ? '<p class="small muted">Reddit is assisted: copy your approved text, post it yourself in an allowed community, then mark it posted. I will not claim it is live until you do.</p>' : '<p class="small muted">Publishing needs this account connected. Until then the item is held, not failed.</p>'}</div>
      <div class="dlg-f"><button class="btn ghost" id="dc" type="button">Close</button>${manualOk ? '<button class="btn ghost" id="cp" type="button">Copy for manual posting</button><button class="btn yellow" id="mp" type="button" ' + (s.state === 'published_manual' ? 'disabled' : '') + '>Mark as posted</button>' : '<button class="btn" type="button" disabled title="Needs connection and approval">Publish now</button>'}</div>`;
    d.showModal(); $('#dx').onclick = $('#dc').onclick = () => d.close();
    const cp = $('#cp'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(s.text); toast('Copied.'); } catch (e) { toast('Copy failed. Select the text manually.'); } };
    const mp = $('#mp'); if (mp) mp.onclick = () => { s.state = 'published_manual'; C.log('manual-publish', 'You marked “' + s.text + '” as posted manually', { item: s.id, channel: s.ch }); S.activity.unshift({ t: new Date().toISOString(), text: 'You marked a Reddit item as posted manually.' }); C.save(); d.close(); route(); };
  }

  /* ---------------- RESULTS ---------------- */
  function results() {
    const g = C.GOALS.find((x) => x.k === S.goal.k) || C.GOALS[0];
    const conv = ['sales', 'signups'].includes(g.k);
    const steps = [['Choose the conversion goal', true], ['Connect your site or analytics source', false], ['Verify the event', false], ['Confirm the signal is being received', false]];
    view.innerHTML = `<div class="pagehead"><div><span class="eyebrow">Results</span><h1 class="disp">Here’s what <b>changed.</b></h1><p class="muted">Built around your goal: ${esc(g.t.toLowerCase())}${S.goal.target ? ', target ' + esc(S.goal.target) + ' ' + g.unit : ''}. Activity (impressions, likes) never outranks outcomes.</p></div></div>
    <div class="empty" style="margin:0"><strong>No results yet.</strong><p>No campaign has run, so there are no numbers. I show nothing rather than zeros dressed up as data. When results exist they will state the attribution window, data completeness and conversion source. Reddit and X traffic will be shown as tracked traffic and assisted conversions, separate from directly attributed ${esc(g.unit)}.</p></div>
    ${conv ? `<section class="panel"><div class="panel-h"><h2>Measurement checklist</h2><a class="btn sm" href="app-v3.html#/tracking">Open tracking</a></div><div class="check-list">${steps.map((s) => `<div class="check-row"><span class="box ${s[1] ? 'ok' : ''}">${s[1] ? '✓' : ''}</span><span>${s[0]}</span><span class="chip ${s[1] ? 'b' : 'dash'}">${s[1] ? 'Done' : 'Pending'}</span></div>`).join('')}</div></section>` : `<div class="panel"><div class="panel-b">Traffic and awareness goals don’t need a pixel. Tag your links and I’ll track visits once a campaign runs.</div></div>`}`;
  }

  /* ---------------- global composer: natural-language edits with a change summary ---------------- */
  const CHIPS = ['Only target Bengaluru', 'Remove Reddit', 'Don’t spend more than ₹5,000', 'Make posts less promotional'];
  function composer() {
    return `<form class="composer" aria-label="Tell Coldstart what to do next"><div style="display:flex;gap:8px"><input class="cmp-input" type="text" placeholder="Tell Coldstart what you want to do next…" aria-label="Instruction" autocomplete="off"><button class="btn yellow" type="submit">Send</button></div>
      <div class="chips">${CHIPS.map((c) => `<button type="button" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div><div class="reply cmp-reply" aria-live="polite"></div></form>`;
  }
  function parse(t) {
    const x = t.trim(), l = x.toLowerCase();
    let mm;
    if ((mm = l.match(/(?:remove|drop|no more|without)\s+(reddit|x|twitter|instagram|meta)/))) return { type: 'remove', value: mm[1] === 'twitter' ? 'x' : mm[1] };
    if ((mm = x.match(/(?:only target|target only|only in|focus on|find me customers in|customers in)\s+(.+)$/i))) return { type: 'region', value: mm[1].replace(/[.!]+$/, '').trim(), go: /customers in/i.test(x) };
    if ((mm = l.match(/(?:don'?t|do not|never)\s+spend\s+more\s+than\s*[₹$]?\s*([\d,]+)/)) || (mm = l.match(/(?:budget|cap)\s*(?:of|to|is)?\s*[₹$]?\s*([\d,]+)/))) return { type: 'cap', value: Number(mm[1].replace(/,/g, '')) };
    if (/less (promotional|salesy)|more (playful|casual|helpful)|(?:tone|voice)/.test(l)) return { type: 'tone', value: x };
    return null;
  }
  let pending = null;
  function bindComposer(root) {
    (root || document).querySelectorAll('form.composer').forEach((f) => {
      if (f.dataset.bound) return; f.dataset.bound = '1';
      const reply = f.querySelector('.cmp-reply'), inp = f.querySelector('.cmp-input');
      f.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => { inp.value = b.dataset.chip; f.requestSubmit(); }));
      f.addEventListener('submit', (e) => {
        e.preventDefault(); const t = inp.value; if (!t.trim()) return;
        const p = parse(t);
        if (!p) { reply.textContent = 'I can change the region, channels, ad cap or tone. Try: “Only target Bengaluru”, “Remove Reddit”, or “Don’t spend more than ₹5,000”.'; return; }
        pending = p; const d = diffOf(p);
        reply.innerHTML = `<div class="diff" style="color:var(--ink)"><strong>Here’s exactly what would change</strong>${d}<div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm" data-ap type="button">Apply</button><button class="btn sm ghost" data-ca type="button">Cancel</button></div></div>`;
        reply.querySelector('[data-ap]').onclick = () => { window.Ops.closeAssist(); applyEdit(pending, false); };
        reply.querySelector('[data-ca]').onclick = () => { pending = null; reply.textContent = 'Cancelled. Nothing changed.'; };
      });
    });
  }
  function diffOf(p) {
    if (p.type === 'region') return `<div>Region: <del>${esc(S.bounds.region || 'open')}</del> → <ins>${esc(p.value)}</ins></div>`;
    if (p.type === 'cap') return `<div>Monthly ad cap: <del>${S.bounds.budgetMode === 'amount' ? m(S.bounds.budget) : 'none (organic only)'}</del> → <ins>${p.value ? m(p.value) : 'none (organic only)'}</ins></div>${p.value && S.bounds.channels === 'organic' ? '<div>Channels: <del>Organic only</del> → <ins>Both</ins></div>' : ''}`;
    if (p.type === 'remove') { const gone = (S.plan || []).filter((x) => !x.dismissed && (x.ch === p.value || (p.value === 'meta' && x.ch === 'meta'))); return gone.length ? gone.map((x) => `<div>Remove: <del>${esc(x.title)}</del></div>`).join('') : `<div>No ${esc(CH[p.value] || p.value)} items are in the plan. Nothing to remove.</div>`; }
    if (p.type === 'tone') return `<div>Tone note: <ins>${esc(p.value)}</ins></div><div class="small">Applies to future drafts. Existing approved posts are not rewritten.</div>`;
    return '';
  }
  function applyEdit(p, quiet) {
    if (!p) return;
    const B = S.bounds;
    if (p.type === 'region') { B.region = p.value; B.regionMode = 'set'; }
    if (p.type === 'cap') { B.budget = p.value; B.budgetMode = p.value ? 'amount' : 'tbd'; if (p.value && B.channels === 'organic') B.channels = 'both'; if (!p.value) B.channels = 'organic'; }
    if (p.type === 'tone') { S.brand.toneNote = p.value; }
    if (p.type === 'remove') (S.plan || []).forEach((x) => { if (x.ch === p.value) x.dismissed = true; });
    if (p.type === 'region' || p.type === 'cap') {
      const keep = {}; (S.plan || []).forEach((x) => { keep[x.id] = x; });
      S.plan = C.buildPlan().map((x) => Object.assign(x, keep[x.id] ? { dismissed: keep[x.id].dismissed, saved: keep[x.id].saved } : {}));
      const c = camp(); if (c) { c.cap = B.budgetMode === 'amount' ? Number(B.budget) : 0; c.region = B.region; }
    }
    syncCampaign();
    S.activity.unshift({ t: new Date().toISOString(), text: 'Plan updated: ' + diffOf(p).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    C.log('plan-edit', 'Plan updated by you', { edit: p }); C.save(); pending = null; C.writeHandoff();
    toast('Applied. Nothing live was affected.');
    if (p.go) location.hash = '#/discover'; else route();
  }

  window.Studio.init({ toast, rerender: () => route() });
  window.AppV4 = { route, composer, bindComposer, toast };
  route();
})();
