/* Coldstart v4 app: goal-first Home with an Action Inbox, Discover (opportunity explorer), Campaigns,
   Calendar, Results, Settings. Everything here is either real (scan, research) or labelled as not yet available.
   Nothing publishes, schedules or spends: P0/P1 stop at approval and "needs connection". */
(function () {
  const C = window.CS, esc = C.esc;
  let S = C.S;
  const view = document.getElementById('view'), crumb = document.getElementById('crumb');
  const $ = (s, r) => (r || document).querySelector(s);
  const cur = () => C.currency();
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
    const b = S.brand || {}, n = next(), c = camp(), inbox = (S.inbox || []).filter((i) => !(i.snoozeUntil && i.snoozeUntil > Date.now()));
    const first = inbox.find((i) => i.kind === 'approval') || inbox[0];
    const hour = new Date().getHours(), hi = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const fl = flagshipWithPhoto();
    const lead = !fl.name ? { eyebrow: 'Setup', title: 'Choose the product to lead with', sub: 'Nothing can be created or planned until one product or offer is confirmed.', href: 'onboarding-v4.html', cta: 'Choose a product' }
      : !(fl.image || (S.studio && (S.studio.assets || []).length) || (S.studio && S.studio.skus && S.studio.skus.length)) ? { eyebrow: 'Setup', title: 'Add a real photo of ' + fl.name, sub: (!fl.url ? 'The product link and photo are missing.' : 'The product photo is missing.') + ' Creatives are built from your own product photo, so this comes first.', href: '#/campaigns/library', cta: 'Complete product setup' }
      : first ? { eyebrow: 'Needs your decision', title: first.title, sub: first.sub, href: '#/inbox', cta: 'Review next action' }
      : n ? { eyebrow: 'Suggested next step · not yet validated', title: n.title, sub: n.summary, href: '#/campaigns/c1', cta: 'Review this plan', why: n.id }
      : { eyebrow: 'All clear', title: 'Nothing needs you right now.', sub: 'Create something, or research a market in Discover.', href: '#/discover', cta: 'Open Discover' };
    const campRows = (S.campaigns || []).map((x) => `<a class="list-row" href="#/campaigns/${esc(x.id)}"><span class="st st-${esc(x.status)}">${esc(x.status === 'live' ? 'Active' : x.status === 'approved' ? 'Approved' : 'Draft')}</span><span class="lr-t">${esc(x.name)}</span><small>${(x.steps || []).length} channel${(x.steps || []).length === 1 ? '' : 's'}</small></a>`).join('');
    view.innerHTML = `
    <div class="pagehead"><div><span class="eyebrow">${esc(b.name || 'Workspace')}</span><h1 class="disp">${hi}. Here’s what’s <b>next.</b></h1></div></div>
    <section class="next-card" aria-label="Most important next action"><div><span class="eyebrow">${esc(lead.eyebrow)}</span><h2>${esc(lead.title)}</h2>${lead.sub ? `<p>${esc(lead.sub)}</p>` : ''}
      <div class="row"><a class="btn" href="${lead.href}">${esc(lead.cta)} →</a>${lead.why ? `<button class="btn ghost" data-why="${esc(lead.why)}" type="button">Why this?</button>` : ''}</div></div></section>
    <section class="panel" aria-labelledby="h-cr" style="margin-bottom:18px"><div class="panel-h"><h2 id="h-cr">Your first three creative directions</h2><a class="link" href="#/campaigns/studio">Open Studio</a></div><div class="panel-b" id="home-cr"><div class="empty sm">Loading drafts…</div></div></section>
    <section class="panel" aria-labelledby="h-mi" style="margin-bottom:18px"><div class="panel-h"><h2 id="h-mi">Market intelligence</h2><a class="link" href="#/discover">Open Discover</a></div><div class="panel-b" id="home-mi"><div class="empty sm">Loading…</div></div></section>
    <div class="grid-main"><div class="stack">
      <section class="panel" aria-labelledby="h-ap"><div class="panel-h"><h2 id="h-ap">Pending approvals</h2><a class="link" href="#/inbox">Open Inbox</a></div>
        ${inbox.length ? inbox.slice(0, 6).map((i) => `<a class="list-row" href="#/inbox"><i class="dot ${i.kind === 'approval' ? 'y' : ''}" aria-hidden="true"></i><span class="lr-t">${esc(i.title)}</span><small>${esc(i.sub || '')}</small></a>`).join('') : '<div class="empty sm">Nothing is waiting for you.</div>'}</section>
      <section class="panel" aria-labelledby="h-cp"><div class="panel-h"><h2 id="h-cp">Campaigns</h2><a class="link" href="#/campaigns">All campaigns</a></div>${campRows || '<div class="empty sm">No campaigns yet. Use Create → Campaign.</div>'}</section>
      <section class="panel" aria-labelledby="h-jb"><div class="panel-h"><h2 id="h-jb">Creative jobs</h2><a class="link" href="#/campaigns/studio">Open Studio</a></div><div id="home-jobs"><div class="empty sm">Loading jobs from the server…</div></div></section>
    </div><div class="stack">
      <section class="panel" aria-labelledby="h-cx"><div class="panel-h"><h2 id="h-cx">Connections</h2><a class="link" href="#/settings/connections">Manage</a></div><div id="home-conn"><div class="empty sm">Checking…</div></div></section>
      <section class="panel" aria-labelledby="h-us"><div class="panel-h"><h2 id="h-us">Limits and costs</h2></div><div id="home-usage" class="panel-b"><small class="muted">Loading…</small></div>
        <div class="panel-b"><div class="fact-row"><span>Goal</span><span>${esc((C.GOALS.find((g) => g.k === S.goal.k) || {}).t || 'Not set')}${S.goal.target ? ' · ' + esc(S.goal.target) : ''}</span></div><div class="fact-row"><span>Market</span><span>${esc(S.bounds.region || ({ IN: 'India', US: 'United States', GB: 'United Kingdom', AE: 'United Arab Emirates' })[S.bounds.country] || 'Not chosen')}</span></div><div class="fact-row"><span>Ad cap</span><span>${S.bounds.budgetMode === 'amount' ? m(S.bounds.budget) + '/mo' : 'Organic only'}</span></div></div></section>
      <section class="panel" aria-labelledby="h-ac"><div class="panel-h"><h2 id="h-ac">Recent activity</h2><a class="link" href="#/settings/audit">Log</a></div>
        ${(S.activity || []).slice(0, 5).map((a) => `<div class="work-row"><i class="dot" aria-hidden="true"></i><div>${esc(a.text)}<small>${ago(a.t)}</small></div></div>`).join('') || '<div class="empty sm">Nothing yet.</div>'}</section>
    </div></div>`;
    view.querySelectorAll('[data-why]').forEach((x) => x.addEventListener('click', () => drawer(x.dataset.why)));
    homeLive();
  }
  /* The confirmed flagship, with the photo the scan found for that product if none was picked explicitly. */
  function flagshipWithPhoto() {
    const fl = Object.assign({}, S.flagship || {}); if (fl.image || !fl.name) return fl;
    const n = fl.name.toLowerCase(), p = (S.products || []).find((x) => (x.name || '').toLowerCase() === n) || (S.products || []).find((x) => (x.name || '').toLowerCase().includes(n) || n.includes((x.name || '').toLowerCase()));
    const img = p && (p.image || (p.images || [])[0] || (p.enrich && p.enrich.candidates && p.enrich.candidates[0] && p.enrich.candidates[0].url));
    if (img) { fl.image = img; if (S.flagship) { S.flagship.image = img; C.save(); } }
    return fl;
  }
  const obContext = () => ({ brand: { name: (S.brand && S.brand.name) || 'Your brand', line: (S.brand && S.brand.line) || '', site: S.input.site || '' }, product: S.flagship && S.flagship.name ? { name: S.flagship.name, price: S.flagship.price || null, currency: S.flagship.currency || null } : undefined, audience: ((S.icps || []).find((i) => i.on !== false) || {}).who || '', country: (S.bounds && S.bounds.country) || '' });
  const SCENES = {
    spotlight: 'Premium studio product photograph. The exact product from the reference image as the hero, centred, on a seamless backdrop in the brand colours, soft key light, subtle reflection, generous empty space in the top third for a headline.',
    lifestyle: 'Authentic lifestyle photograph showing the exact product from the reference image in a natural real-world use, gifting or consumption moment that fits it, warm natural light, shallow depth of field, empty space at the bottom for text.',
    contrast: 'Bold editorial still life of the exact product from the reference image, dramatic directional light, strong graphic shadows, high-contrast colour blocking in the brand colours, magazine-cover composition with space on one side for text.',
  };
  let crIdx = 0, rendering = false;
  function qaList(x) {   // separate technical checks from the visual review; neither is an approval
    const q = x.design && x.design.qa; if (!q) { const p = x.design && x.design.prototype_qa; return p && p.length ? `<ul class="qa small">${p.map((i) => `<li class="warn">${esc(i)}</li>`).join('')}</ul>` : ''; }
    const row = (ok, label, detail) => `<li class="${ok ? 'ok' : 'warn'}">${ok ? '✓' : '!'} ${esc(label)}${detail ? ': ' + esc(detail) : ''}</li>`;
    const m = q.mask || {}, c = q.critique || {}, low = (c.low_checks || []).join(', ');
    return `<details class="qa small"><summary>${q.review_required && q.review_required.length || q.text !== 'pass' || (c.verdict && c.verdict !== 'looks_shippable_needs_human_approval') ? 'Checks: needs attention' : 'Checks passed; your approval is still needed'}</summary><ul>
      ${row(q.mask_completeness === 'pass', 'Product cutout complete', m.enclosed_transparent_fraction ? Math.round(m.enclosed_transparent_fraction * 100) + '% filled' + (m.status !== 'ok' ? ' — confirm there is no clear window' : '') : '')}
      ${row(q.protected_pixels === 'pass', 'Product pixels unchanged', q.protected_pixels_changed + ' changed')}
      ${row(q.grounding === 'shadow_drawn', 'Contact shadow', q.placement_source === 'vision_located' ? 'placed on the surface found in the scene' : 'brief default placement')}
      ${row(q.text === 'pass', 'Text layout', (q.text_issues || []).join('; '))}
      ${c.checks ? row(!low, 'Visual review (AI, opinion)', low ? 'weak: ' + low : 'no weak checks') : row(false, 'Visual review', c.error || 'not run')}
      ${(c.blocking_issues || []).map((i) => row(false, 'Reviewer', i)).join('')}</ul></details>`;
  }
  async function homeIntel() {
    const cr = $('#home-cr'), mi = $('#home-mi'), ctx = obContext(); let snap = {};
    try { snap = await C.ops.get('obIntel', { site: ctx.brand.site, brand: ctx.brand.name, country: ctx.country }); } catch (e) { if (cr) cr.innerHTML = `<div class="empty sm">Couldn’t load drafts: ${esc(e.message)}</div>`; return; }
    const col = (S.brand && S.brand.colors) || [], fl = flagshipWithPhoto();
    const vars = `--b1:${esc(col[4] || '#F5F5F2')};--b2:${esc(col[3] || col[0] || '#111')};--b3:${esc(col[1] || col[0] || '#ddd')}`;
    const items = (snap.creatives && snap.creatives.items) || [], done = items.filter((x) => x.imageState === 'rendered').length;
    if (cr) {
      cr.innerHTML = items.length ? `<div class="cr-head"><p class="small" style="margin:0">${done === 3 ? 'Three generated ads, ready for review.' : done ? done + ' of 3 generated.' : fl.image ? 'Concepts. Render them into real ad images from your product photo.' : 'Concepts. Add a product photo to render real ad images.'}</p>
        ${fl.image ? (() => { const protos = items.filter((x) => x.assets && x.assets.prototype).length, appr = items.filter((x) => x.design && x.design.layout_approved).length;
          return `<button class="btn sm ghost" id="cr-copy" type="button" ${rendering ? 'disabled' : ''}>Rewrite copy with AI</button> <button class="btn sm" id="cr-proto" type="button" ${rendering ? 'disabled' : ''}>${protos ? 'Rebuild' : 'Generate'} layout prototypes (free)</button>
          ${protos === 3 && appr < 3 ? '<button class="btn sm" id="cr-approve-dirs" type="button">Approve these 3 layouts</button>' : ''}
          ${items.filter((x) => x.assets && x.assets.scene).length ? `<button class="btn sm ghost" id="cr-replace" type="button" ${rendering ? 'disabled' : ''} title="Re-run placement, shadow, typography and review on the saved scenes. No new images are generated.">Re-place products (no new images)</button>` : ''}
          <button class="btn yellow sm" id="cr-render" type="button" ${rendering || appr < 3 ? 'disabled' : ''} title="${appr < 3 ? 'Approve the layout prototypes first' : ''}">${rendering ? 'Working…' : 'Generate 3 final ads'}</button>`; })() : ''}</div><div id="cr-msg"></div><div id="cr-ledger" class="small muted"></div>
        <div class="cr-grid" id="cr-track" role="list">${items.map((x, n) => `<article class="cr ${esc(x.layout)}" role="listitem" aria-label="${n + 1} of 3: ${esc(x.kind)}">
          ${x.imageState === 'rendered' ? `<div class="cr-art img" data-cr-img="${esc(x.id)}"><span class="muted small">Loading image…</span></div>` : x.assets && x.assets.prototype ? `<div class="cr-art img" data-cr-proto="${esc(x.id)}"><span class="muted small">Loading prototype…</span></div>` : `<div class="cr-art" style="${vars}"><span class="concept-tag">Concept</span><div class="hl">${esc(x.headline)}</div>${fl.image ? `<img src="${esc(fl.image)}" alt="${esc(fl.name || '')}" referrerpolicy="no-referrer">` : '<div class="ph">Add a product photo</div>'}<div><p class="small" style="margin:0 0 8px">${esc(x.body)}</p><span class="cta">${esc(x.cta)}</span></div></div>`}
          <div class="cr-meta"><div class="row"><strong>${esc(x.kind)}</strong><span class="chip dash">${esc(x.channel)}</span></div>
          <div class="row">${x.imageState === 'rendered' ? `<span class="chip ${x.status === 'approved' ? 'b' : 'warn'}">${x.status === 'approved' ? 'Approved by you' : 'Needs your review'}</span><small class="muted">${esc((x.imageMeta && x.imageMeta.model || '').split('/').pop())}${x.imageMeta && x.imageMeta.ms ? ' · ' + Math.round(x.imageMeta.ms / 1000) + 's' : ''} · ${x.imageMeta && x.imageMeta.usd != null ? '$' + Number(x.imageMeta.usd).toFixed(3) : 'cost unknown'}</small>` : x.assets && x.assets.prototype ? `<span class="chip ${x.design && x.design.layout_approved ? 'b' : 'dash'}">${x.design && x.design.layout_approved ? 'Layout approved' : 'Prototype'}</span>` : '<span class="chip warn">Concept, not rendered</span>'}</div>
          ${qaList(x)}
          <div class="row"><button class="btn sm ghost" data-cr-edit="${esc(x.id)}" type="button">Edit</button>${x.imageState === 'rendered' ? `<button class="btn sm ghost" data-cr-open="${esc(x.id)}" type="button">Export PNG</button><button class="btn sm ${x.status === 'approved' ? 'ghost' : ''}" data-cr-approve="${esc(x.id)}" type="button">${x.status === 'approved' ? 'Unapprove' : 'Approve'}</button>` : ''}</div></div></article>`).join('')}</div>
        <div class="cr-nav" aria-label="Creative navigation"><button class="btn sm ghost" data-cr-step="-1" type="button" aria-label="Previous creative">←</button><span id="cr-pos" aria-live="polite">1 of 3</span><span class="dots">${items.map((_, n) => `<i data-dot="${n}"></i>`).join('')}</span><button class="btn sm ghost" data-cr-step="1" type="button" aria-label="Next creative">→</button></div>`
        : `<div class="empty sm">No drafts for ${esc(ctx.brand.name)} yet. <button class="btn sm" id="cr-make" type="button">Prepare three directions</button></div>`;
      const rendered = {};
      cr.querySelectorAll('[data-cr-img]').forEach(async (el) => { const x = items.find((y) => y.id === el.dataset.crImg); try { const r = await window.AdPipe.render({ C, S, ctx, x }); if (!r) { el.innerHTML = '<span class="small">Image missing. Generate again.</span>'; return; } rendered[x.id] = r; el.innerHTML = `<img src="${r.canvas.toDataURL('image/jpeg', 0.85)}" alt="${esc(x.kind)} ad">`; } catch (e) { el.innerHTML = '<span class="small">Couldn’t load the image.</span>'; } });
      cr.querySelectorAll('[data-cr-proto]').forEach(async (el) => { try { const r = await C.ops.get('obImage', { id: el.dataset.crProto, kind: 'prototype', site: ctx.brand.site, brand: ctx.brand.name }); el.innerHTML = r.image ? `<img src="${r.image}" alt="Layout prototype">` : '<span class="small">Prototype missing.</span>'; } catch (e) { el.innerHTML = '<span class="small">Couldn’t load the prototype.</span>'; } });
      (async () => { const el = $('#cr-ledger'); if (!el) return; try { const l = await fetch('/api/plugins/images/actions/ledger', { credentials: 'same-origin' }).then((r) => r.ok ? r.json() : Promise.reject(new Error(r.status))); const ap = items.filter((x) => x.status === 'approved').length;
        el.innerHTML = l.total.attempts ? `Image provider: ${l.total.attempts} request${l.total.attempts > 1 ? 's' : ''} (${l.total.failed} failed, ${l.total.empty} empty) · confirmed cost $${l.total.usd_known.toFixed(3)}${l.total.unknown_cost ? ' + ' + l.total.unknown_cost + ' not yet confirmed' : ''}${ap ? ' · per approved ad ' + (l.total.unknown_cost ? '≥ ' : '') + '$' + (l.total.usd_known / ap).toFixed(3) : ''}` : ''; } catch (e) { /* ledger is informational */ } })();
      const track = $('#cr-track'), pos = $('#cr-pos'), sync = () => { if (!track) return; const w = track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width + 14 : 1; crIdx = Math.max(0, Math.min(2, Math.round(track.scrollLeft / w))); if (pos) pos.textContent = (crIdx + 1) + ' of 3'; cr.querySelectorAll('[data-dot]').forEach((d) => d.classList.toggle('on', +d.dataset.dot === crIdx)); };
      if (track) { track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true }); sync(); }
      cr.querySelectorAll('[data-cr-step]').forEach((b) => b.onclick = () => { const w = track.firstElementChild.getBoundingClientRect().width + 14; track.scrollTo({ left: Math.max(0, Math.min(2, crIdx + +b.dataset.crStep)) * w, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); });
      cr.querySelectorAll('[data-cr-edit]').forEach((b) => b.onclick = async () => { const x = items.find((y) => y.id === b.dataset.crEdit);
        if (x.imageState !== 'rendered') { editCr(x); return; }
        const r = rendered[x.id] || await window.AdPipe.render({ C, S, ctx, x });
        window.CreativeEditor.open({ title: x.kind, baseSrc: r.base, aspect: '4:5', font: r.font, fileName: ((S.brand && S.brand.name) || 'ad') + '-' + x.id, layout: r.layout,
          onSave: async (L) => { const keep = window.AdPipe.strip(L); await C.ops.post('obEditCreative', { context: ctx, id: x.id, layout: keep, design: { layout: keep, editedAt: Date.now() }, headline: L.headline.text.slice(0, 60), body: L.body.text.slice(0, 160), cta: L.cta.text.slice(0, 24), approve: false }); toast('Saved. Review and approve it again.'); homeIntel(); } }); });
      cr.querySelectorAll('[data-cr-open]').forEach((b) => b.onclick = async () => { const x = items.find((y) => y.id === b.dataset.crOpen); const r = rendered[x.id] || await window.AdPipe.render({ C, S, ctx, x });
        r.canvas.toBlob((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = ((S.brand && S.brand.name) || 'ad') + '-' + x.id + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png'); });
      cr.querySelectorAll('[data-cr-approve]').forEach((b) => b.onclick = async () => { const x = items.find((y) => y.id === b.dataset.crApprove), m = $('#cr-msg');
        try { await C.ops.post('obEditCreative', { context: ctx, id: x.id, approve: x.status !== 'approved' }); homeIntel(); }
        catch (e) { if (!m) return; const blocking = /visual review blocking/.test(e.message) && !/pixels changed|cutout|text layout|did not run/.test(e.message);
          m.innerHTML = `<div class="err">${esc(e.message)}</div>` + (blocking ? `<div class="row" style="margin-top:8px"><input id="cr-ovr" class="input" maxlength="300" placeholder="Why approve despite the reviewer's blocking issues?" style="flex:1"><button class="btn sm" id="cr-ovr-go" type="button">Approve with this reason</button></div>` : '');
          const go = $('#cr-ovr-go'); if (go) go.onclick = async () => { const r = ($('#cr-ovr').value || '').trim(); if (r.length < 8) { $('#cr-ovr').focus(); return; } try { await C.ops.post('obEditCreative', { context: ctx, id: x.id, approve: true, override: r }); m.innerHTML = ''; homeIntel(); } catch (e2) { m.innerHTML = `<div class="err">${esc(e2.message)}</div>`; } }; } });
      const cb = $('#cr-copy'); if (cb) cb.onclick = async () => { cb.disabled = true; const m = $('#cr-msg'); if (m) m.innerHTML = '<p class="small">Writing copy from your confirmed product facts…</p>'; try { await C.ops.post('obRewriteCopy', { context: ctx }); if (m) m.innerHTML = '<p class="small">New copy saved. Rebuild the prototypes to see it.</p>'; await homeIntel(); } catch (e) { if (m) m.innerHTML = `<div class="err">${esc(e.message)}</div>`; cb.disabled = false; } };
      const ad = $('#cr-approve-dirs'); if (ad) ad.onclick = async () => { ad.disabled = true; for (const x of items) await C.ops.post('obEditCreative', { context: ctx, id: x.id, design: { layout_approved: true, layout_approved_at: Date.now() } }); homeIntel(); };
      const mk = $('#cr-make'); if (mk) mk.onclick = async () => { mk.disabled = true; try { await C.ops.post('obCreatives', ctx); homeIntel(); } catch (e) { toast(e.message); mk.disabled = false; } };
      const rb = $('#cr-render'); if (rb) rb.onclick = () => renderAds(items, ctx); const rp = $('#cr-replace'); if (rp) rp.onclick = () => renderAds(items.filter((x) => x.assets && x.assets.scene && x.status !== 'approved'), ctx, { reuseScene: true }); const pb = $('#cr-proto'); if (pb) pb.onclick = () => renderAds(items, ctx, { prototype: true });
    }
    const cs = ((snap.competitors && snap.competitors.items) || []), ap = cs.filter((x) => x.decision === 'approved' || x.origin === 'user_added'), sug = cs.filter((x) => x.decision === 'pending');
    const coms = ((snap.communities && snap.communities.items) || []).filter((x) => x.decision !== 'not_relevant'), saved = coms.filter((x) => x.decision === 'saved'), ads = (snap.ads && snap.ads.items) || [];
    if (mi) mi.innerHTML = `<div class="intel-grid">
      <a class="intel-card" href="#/discover"><span class="eyebrow">Competitors</span><strong>${ap.length ? ap.length + ' approved' : 'None approved'}</strong><span class="pills">${ap.slice(0, 4).map((x) => `<i>${esc(x.name)}</i>`).join('')}</span><small>${sug.length ? sug.length + ' suggestion' + (sug.length > 1 ? 's' : '') + ' waiting for your decision' : cs.length ? 'All reviewed' : 'No suggestions yet'}</small></a>
      <a class="intel-card" href="#/discover"><span class="eyebrow">Communities</span><strong>${saved.length ? saved.length + ' saved' : coms.length ? coms.length + ' suggested' : 'None found yet'}</strong><span class="pills">${(saved.length ? saved : coms).slice(0, 4).map((x) => `<i>${esc(x.name)}</i>`).join('')}</span><small>From web search results, not demand data</small></a>
      <div class="intel-card"><span class="eyebrow">Competitor ads</span><strong>${ads.length ? ads.length + ' Ad Library search' + (ads.length > 1 ? 'es' : '') : 'Waiting on approvals'}</strong><span class="pills">${ads.slice(0, 3).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.competitor)} ↗</a>`).join('')}</span><small>${ads.length ? 'Manual review: nothing fetched automatically' : 'Approve competitors to prepare searches'}</small></div></div>`;
  }
  /* Product Lock pipeline (js/adpipe-v4.js): prototypes → a person approves the directions → scenes → compositor → typography → QA.
     Nothing here approves an ad; the Approve button on each card is the only approval. */
  async function renderAds(list, ctx, opts) {
    if (rendering || !list.length) return;
    if (!opts || !opts.prototype) { try { const st = await fetch('/api/plugins/images/actions/status').then((r) => r.json()); if (st.creative_pipeline === false) { const m = $('#cr-msg'); if (m) m.innerHTML = '<div class="err">Ad generation is paused while the new product-accurate pipeline is validated.</div>'; return; } } catch (e) { /* server enforces it too */ } }
    rendering = true; homeIntel();
    const msg = (t) => { const m = $('#cr-msg'); if (m) m.innerHTML = t ? `<p class="small" aria-live="polite">${esc(t)}</p>` : ''; };
    const errs = [];
    try {
      const A = await window.AdPipe.assets({ C, S, flagship: flagshipWithPhoto() });
      for (const x of list) {
        try { if (opts && opts.prototype) await window.AdPipe.prototype({ C, S, ctx, x, A, msg }); else { const r = await window.AdPipe.final({ C, S, ctx, x, A, msg, opts }); if (r.usd && !(opts && opts.reuseScene)) C.cost('Ad scene', r.usd, x.kind); } }
        catch (e) { errs.push(x.kind + ': ' + e.message); }
      }
    } catch (e) { errs.push(e.message); }
    rendering = false; await homeIntel();
    const m = $('#cr-msg'); if (m) m.innerHTML = errs.length ? `<div class="err">${errs.map(esc).join('<br>')}</div>` : '';
  }
  async function shrink(src, max) { const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Product photo did not load.')); i.src = src; }); const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.9); }
  /* Typography is drawn on top of the generated photo, so headline and CTA stay exact and editable. */
  async function overlay(src, x, aspect) {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Generated image did not load.')); i.src = src; });
    const W = 1080, H = { '4:5': 1350, '9:16': 1920, '1:1': 1080 }[aspect], c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const s = Math.max(W / im.width, H / im.height); g.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s);
    const col = (S.brand && S.brand.colors) || [], ink = col[3] || '#111111', paper = col[4] || '#FFFFFF', accent = col[0] || ink;
    const top = x.layout !== 'lifestyle', y0 = top ? 0 : H * 0.62, h = H * 0.38, gr = g.createLinearGradient(0, top ? 0 : y0, 0, top ? h : H);
    gr.addColorStop(top ? 0 : 1, 'rgba(0,0,0,.55)'); gr.addColorStop(top ? 1 : 0, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, top ? 0 : y0, W, h);
    g.fillStyle = '#fff'; g.font = '800 78px system-ui, sans-serif'; g.textBaseline = 'top';
    const wrap = (t, yy, size, max) => { g.font = (size > 40 ? '800 ' : '500 ') + size + 'px system-ui, sans-serif'; const w = String(t || '').split(/\s+/); let line = '', n = 0; for (const word of w) { const tt = line ? line + ' ' + word : word; if (g.measureText(tt).width > W - 140 && line) { g.fillText(line, 70, yy + n * size * 1.12); line = word; if (++n >= max) return n; } else line = tt; } if (line) { g.fillText(line, 70, yy + n * size * 1.12); n++; } return n; };
    const hy = top ? 70 : H - 420, n = wrap(x.headline, hy, 76, 3); wrap(x.body, hy + n * 86 + 14, 34, 2);
    g.font = '700 32px system-ui, sans-serif'; const cw = g.measureText(x.cta).width + 64, cy = top ? H - 140 : H - 130; g.fillStyle = accent; g.fillRect(70, cy, cw, 72); g.fillStyle = paper; g.fillText(x.cta, 102, cy + 20);
    return c.toDataURL('image/jpeg', 0.88);
  }
  function editCr(x) {
    const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Edit draft');
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">${esc(x.kind)}</h2><button class="btn sm ghost" id="ex" type="button">Close</button></div><div class="dlg-b" style="display:grid;gap:10px"><label class="field"><span>Headline</span><input id="e-h" maxlength="60" value="${esc(x.headline)}"></label><label class="field"><span>Supporting copy</span><textarea id="e-b" maxlength="160" rows="3">${esc(x.body)}</textarea></label><label class="field"><span>Call to action</span><input id="e-c" maxlength="24" value="${esc(x.cta)}"></label>${x.imageState === 'rendered' ? '<small class="muted">Text changes apply to the concept; render again to update the image.</small>' : ''}<div id="e-e"></div></div><div class="dlg-f"><button class="btn ghost" id="ec" type="button">Cancel</button><button class="btn yellow" id="es" type="button">Save</button></div>`;
    d.showModal(); $('#ex').onclick = $('#ec').onclick = () => d.close();
    $('#es').onclick = async () => { try { await C.ops.post('obEditCreative', { context: obContext(), id: x.id, headline: $('#e-h').value, body: $('#e-b').value, cta: $('#e-c').value }); d.close(); toast('Saved.'); homeIntel(); } catch (e) { $('#e-e').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
  }
  async function homeLive() {
    homeIntel();
    const jb = $('#home-jobs'), cx = $('#home-conn'), us = $('#home-usage');
    try { const jobs = ((await C.ops.get('jobs')).jobs || []).slice(0, 5); if (jb) jb.innerHTML = jobs.length ? jobs.map((j) => `<a class="list-row" href="#/campaigns/studio"><span class="st">${esc(j.state)}</span><span class="lr-t">${esc(j.kind || 'Render')}</span><small>${ago(j.updatedAt || j.createdAt)}</small></a>`).join('') : '<div class="empty sm">No creative jobs yet. Create → Ad creative.</div>'; } catch (e) { if (jb) jb.innerHTML = `<div class="empty sm">Couldn’t load jobs: ${esc(e.message)}</div>`; }
    try { const u = await C.ops.get('usage'); if (us) us.innerHTML = `<div class="fact-row"><span>Renders this month</span><span>${u.used.creativeMonth} of ${u.caps.credits || '∞'}</span></div><div class="fact-row"><span>Research today</span><span>${u.used.researchToday ?? 0} of ${u.caps.research ?? '∞'}</span></div><div class="fact-row"><span>AI/API cost reported</span><span>${u.aiApiCost && u.aiApiCost.reportedFor ? '$' + Number(u.aiApiCost.usd).toFixed(2) : 'Not reported by providers'}</span></div>`; } catch (e) { if (us) us.innerHTML = `<small class="muted">Usage unavailable: ${esc(e.message)}</small>`; }
    try { const r = await C.ops.get('integrations'); const list = Object.entries(r.integrations || r || {}).filter(([, v]) => v && typeof v === 'object'); if (cx) cx.innerHTML = list.length ? list.map(([k, v]) => `<div class="list-row"><span class="st ${v.state === 'ready' ? 'st-live' : ''}">${esc(String(v.state || 'unknown').replace(/_/g, ' '))}</span><span class="lr-t">${esc(k)}</span><small>${esc(v.reason || '')}</small></div>`).join('') : '<div class="empty sm">No connections reported.</div>'; } catch (e) { if (cx) cx.innerHTML = `<div class="empty sm">Couldn’t check connections: ${esc(e.message)}</div>`; }
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
    <div class="pagehead"><div><span class="eyebrow">Discover</span><h1 class="disp">Find where your next customers <b>might be.</b></h1><p class="muted">Markets, audience hypotheses and community threads, each with where it came from. Nothing is ranked without evidence.</p></div>
      <div class="seg" role="group" aria-label="View"><button data-v="market" aria-pressed="${dView === 'market'}" type="button">Market view</button><button data-v="community" aria-pressed="${dView === 'community'}" type="button">Community view</button></div></div>
    <div class="filters"><span class="chip dash">${esc(S.bounds.region || 'Any region')}</span><span class="chip dash">${esc(({ IN: 'India', US: 'United States', GB: 'United Kingdom', AE: 'UAE' })[S.bounds.country] || 'Country not chosen')}</span><span class="chip dash">${S.bounds.channels === 'organic' ? 'Organic' : S.bounds.channels === 'paid' ? 'Paid' : 'All channels'}</span></div>
    ${dView === 'market' ? marketView(regs) : communityView(comms)}
    <section aria-labelledby="po"><div class="pagehead" style="margin-bottom:14px"><h2 class="disp s" id="po">Suggested starting points</h2><span class="muted small">Hypotheses built from your website and your goal. Not validated by market data yet: treat them as tests, not findings.</span></div>
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
      <form id="set-region" style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><input id="rg" type="text" placeholder="Bengaluru, Mumbai" style="max-width:340px" aria-label="Regions to compare"><button class="btn yellow" type="submit">Compare these</button></form></section>${audienceHyp()}`;
    return `<section class="focus-card"><h2>Where should we focus?</h2><p>These regions are unranked. Automated market research from permitted sources (search results, competitor sites and your own analytics) isn’t connected in this build, so I won’t invent a score.</p></section>
      <div class="regions">${regs.map((r) => `<div class="region"><strong>${esc(r)}</strong><div class="meter" aria-hidden="true"></div><span class="small muted">Evidence: none yet. Audience fit, competition and cost are unmeasured.</span><span class="chip dash" style="justify-self:start">Unranked</span></div>`).join('')}</div>
      ${audienceHyp()}`;
  }
  function researchMeta() { return S.research ? 'Last updated ' + ago(S.research.at) + ' · ' + (S.research.signals || []).length + ' posts · showing saved results first, refresh costs a small scan' : 'One scan across Reddit and X. Takes up to a minute.'; }
  function audienceHyp() {
    const ic = (S.icps || []).filter((i) => i.on !== false);
    if (!ic.length) return '';
    return `<section class="panel" aria-labelledby="ah"><div class="panel-h"><h2 id="ah">Audience hypotheses</h2><span class="muted small">From your website copy. Not verified audience data.</span></div>${ic.map((i) => `<div class="list-row"><span class="st">${i.evidence ? 'Site evidence' : 'Inference'}</span><span class="lr-t"><strong>${esc(i.name)}</strong> · ${esc(i.who || '')}</span><small>${esc(i.pain || '')}</small></div>`).join('')}</section>`;
  }
  function communityView() {
    return `<section class="focus-card"><h2>Where can we meaningfully participate?</h2><p>Communities are topics, not places. Paste threads you found; I check each community’s rules before drafting anything. Relevant is not the same as allowed.</p></section>`;
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
      budget: c.cap ? { mode: 'amount', amount: c.cap, currency: C.currency() || 'INR', period: 'month' } : { mode: 'none', amount: 0, currency: C.currency() || 'INR', period: 'day' },
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
    const BLK = { budget_not_allowed: ['warn', 'Blocked · budget not allowed', 'Allow budget spending in Settings → Automations, then create the draft. Nothing was sent.'], over_budget_cap: ['warn', 'Blocked · over the budget cap', 'The daily budget is above the limit set on the server. Lower it or ask the account owner to raise META_MAX_DAILY_BUDGET.'] };
    const e = c.execution, x = e && (e.state === 'blocked' && BLK[e.reason] ? BLK[e.reason] : EXEC[e.state]);
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
  /* Calendar: items sit on their real stored date (server publish jobs). Suggestions without a date are never shown as scheduled. */
  const cal = { view: innerWidth < 720 ? 'agenda' : 'week', at: new Date(), ch: '', st: '' };
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  const CALST = { requested: ['Awaiting approval', 'y'], authorized: ['Approved', 'b'], queued: ['Queued', 'b'], executing: ['Publishing', 'b'], blocked: ['Held', 'warn'], failed: ['Failed', 'warn'], unknown_external_state: ['Unknown external state', 'warn'], cancelled: ['Cancelled', 'dash'] };
  const calLabel = (j) => j.state === 'completed' ? (j.verification === 'user_attested' ? ['Published manually', 'b'] : ['Provider verified', 'b']) : j.state === 'authorized' && j.payload.scheduledAt && new Date(j.payload.scheduledAt) > new Date() ? ['Scheduled', 'b'] : (CALST[j.state] || [j.state, 'dash']);
  const dayKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const startOfWeek = (d) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0); return x; };
  const PLAT = { x: 'X', facebook: 'Facebook', instagram: 'Instagram', reddit: 'Reddit' };
  async function calendar(sub) {
    view.innerHTML = `<div class="pagehead"><div><span class="eyebrow">Calendar</span><h1 class="disp">What’s going out, and <b>when?</b></h1><p class="muted">Every item sits on the date it is stored with. Times in ${esc(TZ)}.</p></div><button class="btn" id="cal-new" type="button">+ New post</button></div><div id="cal-body"><p class="muted">Loading…</p></div>`;
    $('#cal-new').onclick = () => composePost();
    let jobs = []; try { jobs = (await C.ops.get('publishJobs')).jobs || []; } catch (e) { $('#cal-body').innerHTML = `<div class="err">Couldn’t load posts from the server: ${esc(e.message)}</div>`; return; }
    const draw = () => {
      if (innerWidth < 720) cal.view = 'agenda';   // mobile: agenda, not a shrunken grid
      const items = jobs.filter((j) => (!cal.ch || j.provider === cal.ch) && (!cal.st || calLabel(j)[0] === cal.st));
      const dated = items.filter((j) => j.payload && j.payload.scheduledAt), undated = items.filter((j) => !(j.payload && j.payload.scheduledAt));
      const byDay = {}; dated.forEach((j) => { const k = dayKey(new Date(j.payload.scheduledAt)); (byDay[k] = byDay[k] || []).push(j); });
      const card = (j) => { const L = calLabel(j); return `<button class="cal-item" data-job="${esc(j.id)}" type="button"><span class="ci-p">${esc(PLAT[j.provider] || j.provider)}${j.payload.scheduledAt ? ' · ' + new Date(j.payload.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span><span class="ci-t">${esc(j.payload.text.slice(0, 70))}</span><span class="chip ${L[1]}">${esc(L[0])}</span></button>`; };
      const t0 = cal.view === 'month' ? new Date(cal.at.getFullYear(), cal.at.getMonth(), 1) : startOfWeek(cal.at);
      let grid = '';
      if (cal.view === 'agenda') {
        const days = Object.keys(byDay).sort();
        grid = days.length ? days.map((k) => `<div class="agenda-day"><h3>${new Date(k + 'T00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</h3>${byDay[k].sort((a, b) => a.payload.scheduledAt.localeCompare(b.payload.scheduledAt)).map(card).join('')}</div>`).join('') : '<div class="empty sm">Nothing has a date yet.</div>';
      } else {
        const start = cal.view === 'month' ? startOfWeek(t0) : t0, n = cal.view === 'month' ? 42 : 7, today = dayKey(new Date());
        grid = `<div class="cal-grid ${cal.view}">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}${Array.from({ length: n }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const k = dayKey(d), out = cal.view === 'month' && d.getMonth() !== cal.at.getMonth();
          return `<div class="cal-day ${k === today ? 'today' : ''} ${out ? 'out' : ''}"><button class="cal-date" data-day="${k}" type="button" aria-label="New post on ${d.toDateString()}">${d.getDate()}</button>${(byDay[k] || []).map(card).join('')}</div>`; }).join('')}</div>`;
      }
      const title = cal.view === 'month' ? cal.at.toLocaleDateString([], { month: 'long', year: 'numeric' }) : cal.view === 'week' ? 'Week of ' + t0.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : 'Upcoming and past';
      const c = camp(), sugg = c ? (c.steps || []).filter((x) => !x.dismissed) : [];
      $('#cal-body').innerHTML = `<div class="cal-bar"><div class="seg ${innerWidth < 720 ? 'hide-sm' : ''}" role="group" aria-label="Calendar view">${['week', 'month', 'agenda'].map((v) => `<button type="button" data-cv="${v}" aria-pressed="${cal.view === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
        ${cal.view !== 'agenda' ? `<div class="row"><button class="btn sm ghost" data-nav-d="-1" type="button" aria-label="Previous">←</button><button class="btn sm ghost" data-nav-d="0" type="button">Today</button><button class="btn sm ghost" data-nav-d="1" type="button" aria-label="Next">→</button><strong class="cal-title">${esc(title)}</strong></div>` : ''}
        <div class="row"><label class="sr-only" for="cal-ch">Platform</label><select id="cal-ch"><option value="">All platforms</option>${Object.entries(PLAT).map(([k, v]) => `<option value="${k}" ${cal.ch === k ? 'selected' : ''}>${v}</option>`).join('')}</select><label class="sr-only" for="cal-st">Status</label><select id="cal-st"><option value="">All statuses</option>${['Awaiting approval', 'Approved', 'Scheduled', 'Publishing', 'Provider verified', 'Published manually', 'Failed', 'Unknown external state', 'Held', 'Cancelled'].map((v) => `<option ${cal.st === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
        ${grid}
        <section class="panel"><div class="panel-h"><h2>Not scheduled</h2><span class="muted small">Drafts without a date. They are not scheduled.</span></div>${undated.length ? undated.map((j) => `<div class="list-row">${card(j)}</div>`).join('') : '<div class="empty sm">No undated drafts.</div>'}</section>
        ${sugg.length ? `<section class="panel"><div class="panel-h"><h2>Campaign suggestions</h2><a class="link" href="#/campaigns/c1">Open campaign</a></div>${sugg.map((x) => `<div class="list-row"><span class="st">Suggestion</span><span class="lr-t">${esc(CH[x.ch] || x.ch)} · ${esc(x.text)}</span><small>No date · not scheduled</small></div>`).join('')}</section>` : ''}`;
      view.querySelectorAll('[data-cv]').forEach((b) => b.onclick = () => { cal.view = b.dataset.cv; draw(); });
      view.querySelectorAll('[data-nav-d]').forEach((b) => b.onclick = () => { const d = +b.dataset.navD; if (!d) cal.at = new Date(); else if (cal.view === 'month') cal.at = new Date(cal.at.getFullYear(), cal.at.getMonth() + d, 1); else { cal.at = new Date(cal.at); cal.at.setDate(cal.at.getDate() + 7 * d); } draw(); });
      $('#cal-ch').onchange = (e) => { cal.ch = e.target.value; draw(); }; $('#cal-st').onchange = (e) => { cal.st = e.target.value; draw(); };
      view.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => composePost(b.dataset.day));
      view.querySelectorAll('[data-job]').forEach((b) => b.onclick = () => jobDialog(jobs.find((j) => j.id === b.dataset.job)));
    };
    draw();
    if (window.Social) window.Social.calendarSection(view);
    if (sub === 'new') { history.replaceState(null, '', '#/calendar'); composePost(); }
  }
  function jobDialog(j) {
    const d = document.getElementById('dlg'), L = calLabel(j); d.setAttribute('aria-label', 'Post details');
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">${esc(PLAT[j.provider] || j.provider)} post</h2><button class="btn sm ghost" id="jx" type="button">Close</button></div><div class="dlg-b" style="display:grid;gap:10px">
      <div class="tags"><span class="chip ${L[1]}">${esc(L[0])}</span>${j.url ? `<a class="chip dash" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">Open post</a>` : ''}</div>
      <div class="post-preview ${esc(j.provider)}"><b>${esc((S.brand && S.brand.name) || 'You')}</b><p>${esc(j.payload.text)}</p></div>
      <div class="fact-row"><span>When</span><span>${j.payload.scheduledAt ? esc(new Date(j.payload.scheduledAt).toLocaleString()) + ' (' + esc(TZ) + ')' : 'Not scheduled'}</span></div>
      ${j.state === 'requested' ? `<label class="field"><span>Reschedule</span><input id="jw" type="datetime-local"></label><p class="small muted">Changing the text or time creates a new version; any earlier approval no longer applies.</p>` : ''}
      <p class="small muted">Approve it in the Action Inbox. Copy for manual posting appears below the calendar once it is approved.</p></div>
      <div class="dlg-f"><a class="btn ghost" href="#/inbox">Review in Inbox</a><button class="btn ghost" id="jcp" type="button">Copy text</button>${j.state === 'requested' ? '<button class="btn yellow" id="jrs" type="button">Save new time</button>' : ''}</div>`;
    d.showModal(); $('#jx').onclick = () => d.close(); $('#jcp').onclick = async () => { try { await navigator.clipboard.writeText(j.payload.text); toast('Copied.'); } catch (e) { toast('Copy failed.'); } };
    const rs = $('#jrs'); if (rs) rs.onclick = async () => { const v = $('#jw').value; if (!v) return toast('Pick a date and time.'); try { const r = await C.ops.post('editPublish', { id: j.id, payload: Object.assign({}, j.payload, { scheduledAt: new Date(v).toISOString() }) }); S.inbox = (S.inbox || []).map((i) => i.jobId === j.id ? Object.assign(i, { hash: r.job.payloadHash, sub: 'Rescheduled. Needs approval of this exact version.' }) : i); C.save(); d.close(); toast('Rescheduled. It needs your approval again.'); route(); } catch (e) { toast(e.message); } };
  }
  /* New post: platform-aware editor beside a simple preview. Sends to the Inbox; nothing is published from here. */
  function composePost(day) {
    const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'New post');
    const LIM = { x: 280, facebook: 2000, instagram: 2200, reddit: 3000 };
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">New post</h2><button class="btn sm ghost" id="np-x" type="button">Close</button></div><div class="dlg-b compose-grid">
      <div style="display:grid;gap:10px"><label class="field"><span>Platform</span><select id="np-ch">${Object.entries(PLAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field"><span>Text</span><textarea id="np-t" rows="7" maxlength="3000"></textarea><small id="np-n">0 characters</small></label>
        <label class="field"><span>Publish at (${esc(TZ)}, optional)</span><input id="np-w" type="datetime-local" value="${day ? day + 'T10:00' : ''}"></label><div id="np-e"></div></div>
      <div><span class="eyebrow">Preview</span><div class="post-preview" id="np-p"><b>${esc((S.brand && S.brand.name) || 'You')}</b><p class="muted">Your text appears here.</p></div><p class="small muted" id="np-h"></p></div></div>
      <div class="dlg-f"><button class="btn ghost" id="np-c" type="button">Cancel</button><button class="btn yellow" id="np-s" type="button">Send for approval</button></div>`;
    d.showModal();
    const upd = () => { const ch = $('#np-ch').value, t = $('#np-t').value; $('#np-n').textContent = t.length + ' / ' + LIM[ch] + ' characters'; $('#np-p').className = 'post-preview ' + ch; $('#np-p').innerHTML = `<b>${esc((S.brand && S.brand.name) || 'You')}</b><p>${esc(t) || '<span class="muted">Your text appears here.</span>'}</p>`; $('#np-h').textContent = ch === 'reddit' ? 'Reddit: you post it yourself after a rules check. Nothing is posted by Cold Start.' : ch === 'x' ? 'X: manual posting (Open X to post) unless an X account is connected.' : 'Needs the account connected in Settings to publish automatically; otherwise you post it yourself.'; };
    $('#np-ch').onchange = upd; $('#np-t').oninput = upd; upd();
    $('#np-x').onclick = $('#np-c').onclick = () => d.close();
    $('#np-s').onclick = async () => { const ch = $('#np-ch').value, t = $('#np-t').value.trim(), w = $('#np-w').value; if (t.length < 2) { $('#np-e').innerHTML = '<div class="err">Write the post first.</div>'; return; } if (t.length > LIM[ch]) { $('#np-e').innerHTML = `<div class="err">Too long for ${PLAT[ch]}.</div>`; return; }
      const when = w ? new Date(w).toISOString() : undefined; if (when && new Date(when) < new Date()) { $('#np-e').innerHTML = '<div class="err">Pick a time in the future.</div>'; return; }
      try { const { job } = await C.ops.post('createPublish', { payload: { channel: ch, text: t, ...(when ? { scheduledAt: when } : {}) }, idempotencyKey: 'pub-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now()) });
        S.social = S.social || { posts: [] }; S.social.posts = S.social.posts || []; S.social.posts.unshift({ id: job.id, hash: job.payloadHash, platform: ch, text: t, scheduledAt: when || null, sourceUrl: '' });
        S.inbox = S.inbox || []; S.inbox.unshift({ id: 'sp-' + job.id, kind: 'post', title: PLAT[ch] + ' post: ' + t.slice(0, 60), sub: (when ? 'For ' + new Date(when).toLocaleString() + '. ' : 'No time set. ') + 'Nothing is sent until you approve it.', to: '#/calendar', jobId: job.id, hash: job.payloadHash, at: new Date().toISOString() });
        C.log('social', 'Post sent for approval', { job: job.id, channel: ch }); C.save(); d.close(); toast('Sent to your Inbox for approval.'); if (location.hash === '#/calendar') route(); else location.hash = '#/calendar'; }
      catch (e) { $('#np-e').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
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
    <section class="panel" id="res-live"><div class="panel-h"><h2>What we can actually see</h2><span class="muted small">Observed, unavailable and estimated data are kept apart.</span></div><div class="panel-b"><p class="muted">Loading…</p></div></section>
    ${conv ? `<section class="panel"><div class="panel-h"><h2>Measurement checklist</h2><a class="btn sm" href="#/settings/connections">Open tracking</a></div><div class="check-list">${steps.map((s) => `<div class="check-row"><span class="box ${s[1] ? 'ok' : ''}">${s[1] ? '✓' : ''}</span><span>${s[0]}</span><span class="chip ${s[1] ? 'b' : 'dash'}">${s[1] ? 'Done' : 'Pending'}</span></div>`).join('')}</div></section>` : `<div class="panel"><div class="panel-b">Traffic and awareness goals don’t need a pixel. Tag your links and I’ll track visits once a campaign runs.</div></div>`}`;
    liveResults();
  }
  async function liveResults() {
    const box = document.querySelector('#res-live .panel-b'); if (!box) return;
    let r; try { r = await window.CS.ops.get('results'); } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    if (!box.isConnected) return; const age = (n) => n == null ? '' : n < 90 ? 'just now' : n < 5400 ? Math.round(n / 60) + ' min ago' : n < 172800 ? Math.round(n / 3600) + ' h ago' : Math.round(n / 86400) + ' d ago';
    const t = r.tracking;
    box.innerHTML = `<h3 class="small">Posts</h3>${r.posts.length ? r.posts.map((p) => `<div class="inbox-row" style="grid-template-columns:1fr auto"><div><strong>${esc(p.channel)} · ${esc(p.text)}</strong><small>${p.provider_post_id ? 'Post id ' + esc(p.provider_post_id) + ' · read back from the platform' : 'Posted by you · not verified by the platform'}</small><div class="tags" style="margin-top:6px">${p.engagement.provenance === 'observed' ? `<span class="chip b">Observed ${esc(age(p.engagement.age_seconds))}</span>${['likes', 'comments', 'shares', 'reposts', 'impressions'].filter((k) => p.engagement[k] != null).map((k) => `<span class="chip dash">${esc(k)} ${p.engagement[k]}</span>`).join('')}` : `<span class="chip dash">Unavailable</span><span class="small muted">${esc(p.engagement.reason)}</span>`}</div></div></div>`).join('') : '<p class="muted">No published posts yet.</p>'}
    <h3 class="small" style="margin-top:14px">Tracking</h3>${t.provenance === 'observed' ? `<p><span class="chip ${t.verified ? 'b' : 'warn'}">${esc(t.state.replace(/_/g, ' '))}</span> ${t.last_accepted_event_at ? 'Last accepted event ' + esc(age(t.freshness_seconds)) + (t.stale ? ' (stale)' : '') : 'No accepted event yet'}. Browser/server deduplication: ${esc(t.dedupe)}. ${esc(t.next || '')}</p>` : `<p class="muted">Unavailable: ${esc(t.reason)}</p>`}
    <h3 class="small" style="margin-top:14px">Ads</h3>${r.ads.length ? r.ads.map((a) => `<p>${esc(a.state)}${a.status ? ' · ' + esc(a.status) : ''}: <span class="muted">${esc(a.performance.reason)}</span></p>`).join('') : '<p class="muted">No ad drafts.</p>'}
    <h3 class="small" style="margin-top:14px">Conversions and estimates</h3><p class="muted">${esc(r.conversions.reason)} ${esc(r.estimates.note)}</p>`;
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
