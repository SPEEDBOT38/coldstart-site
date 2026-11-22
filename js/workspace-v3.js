/* Coldstart Workspace v3 Application Engine
   Integrates all 8 views (Overview, Tracking Hero, Research, Studio, Calendar, Ads, Results, Connections) + Brand settings.
   Preserves compatibility with workspace-state.js, connectors.js, tests/workspace-browser.js, and tests/workspace-flows.js. */

(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = window.ColdState, KEY = 'coldstart-workspace-v1';

  if (!E) {
    $('#workspace').innerHTML = '<p class="notice error">Workspace engine could not load. Refresh to retry.</p>';
    return;
  }

  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!S || S.version !== 1) S = E.seed();

  S.ui ||= {};
  S.saved ||= [];
  S.ads ||= [
    { id: 'ad-1', title: 'Barrier care before morning rush', goal: 'Store visits', budget: 10, status: 'draft' },
    { id: 'ad-2', title: 'The 3-piece routine starter kit', goal: 'Product discovery', budget: 15, status: 'in_review' }
  ];

  /* Onboarding handoff import (runs once per handoff timestamp) */
  (function importOnboarding() {
    let h;
    try { h = JSON.parse(localStorage.getItem('coldstart.handoff.v1') || 'null'); } catch { h = null; }
    if (!h || h.v !== 1 || (S.onboarding && S.onboarding.at === h.at)) return;
    const b = h.brand || {}, main = (h.icps || []).find((i) => i.role === 'main');
    S.brand = {
      ...S.brand,
      name: b.name || S.brand.name,
      url: b.url || S.brand.url,
      line: b.line || S.brand.line,
      voice: b.voice || S.brand.voice,
      avoid: b.avoid || S.brand.avoid,
      icp: main ? `${main.name}: ${main.who}. Pain: ${main.pain}` : ''
    };
    // Pre-fill tracking store domain if it matches myshopify.com
    if (b.url && b.url.includes('.myshopify.com')) {
      const match = b.url.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
      if (match) S.tracking.store = match;
    }
    S.onboarding = {
      at: h.at,
      real: !!h.real,
      book: h.book || {},
      products: (h.products || []).slice(0, 40),
      icps: h.icps || [],
      competitors: h.competitors || [],
      category: b.category || '',
      revenue: b.revenue || '',
      ig: b.ig || '',
      sources: h.sources || null
    };
    (S.activity || (S.activity = [])).unshift({
      text: `Onboarding imported: ${b.name || 'brand'} · ${(h.products || []).length} products · ${(h.icps || []).length} ICPs${h.real ? ' (live scan)' : ' (simulated)'}`,
      time: new Date().toISOString()
    });
  })();

  S.tracking.sharing ||= 'Standard';
  S.tracking.themeChecked ||= false;
  S.tracking.themeClean ||= false;

  const U = Object.assign({
    research: 'signals',
    signal: 's1',
    sources: ['reddit', 'x', 'instagram'],
    intent: 'all',
    topic: 'all',
    compChannel: 'all',
    compBrand: 'all',
    query: '',
    selected: S.posts.find((p) => p.status === 'needs_approval')?.id || S.posts[0]?.id,
    campaign: 'launch',
    calendar: 'week',
    calStatus: 'all',
    offset: 0,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    platform: 'all',
    studioFilter: 'all',
    eventInspect: 'Purchase'
  }, S.ui);
  S.ui = U;

  const names = { reddit: 'Reddit', x: 'X', instagram: 'Instagram', facebook: 'Facebook', shopify: 'Shopify blog' };
  const routes = [
    ['overview', 'Overview', 'home'],
    ['tracking', 'Tracking', 'pulse'], // Prioritized as Job #1
    ['research', 'Research', 'search'],
    ['studio', 'Studio', 'edit'],
    ['calendar', 'Calendar', 'calendar'],
    ['ads', 'Ads', 'flag'],
    ['results', 'Results', 'chart'],
    ['connections', 'Connections', 'link']
  ];
  const titles = {
    overview: 'Command Center',
    tracking: 'Meta Pixel + CAPI (Hero)',
    research: 'Research & Signals',
    studio: 'Content Studio',
    calendar: 'Publishing Calendar',
    ads: 'Paid Campaigns',
    results: 'Results & Attribution',
    connections: 'Connected Channels',
    brand: 'Brand Context'
  };
  const aliases = { run: 'overview', queue: 'studio', competitors: 'research', pixel: 'tracking', channels: 'connections' };

  const iconPaths = {
    home: 'M3 10 12 3l9 7v10H6V10 M9 20v-7h6v7',
    search: 'M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16m6-2 6 7',
    edit: 'm4 16 12-12 4 4L8 20H4v-4M14 6l4 4',
    calendar: 'M4 5h16v16H4zM8 2v6m8-6v6M4 10h16M8 14h2m4 0h2m-8 4h2',
    flag: 'M5 22V3m0 0c5-4 9 4 15 0v10c-6 4-10-4-15 0',
    chart: 'M4 3v18h18M8 17v-5m5 5V7m5 10v-9',
    pulse: 'M2 12h5l3-8 4 16 3-8h5',
    link: 'm9 15 6-6m-8 5-2 2a4 4 0 0 0 6 6l4-4a4 4 0 0 0 0-6m2-2 2-2a4 4 0 0 0-6-6L9 6a4 4 0 0 0 0 6',
    close: 'm5 5 14 14M19 5 5 19',
    plus: 'M12 4v16M4 12h16'
  };
  const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[name] || iconPaths.flag}"/></svg>`;
  const platform = (id, short = false) => `<span class="platform"><span class="platform-symbol">${id === 'instagram' ? '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="4"/><circle cx="10" cy="10" r="4"/><circle cx="15" cy="5" r=".6"/></svg>' : { reddit: 'r', x: '𝕏', facebook: 'f', shopify: 's' }[id] || '·'}</span>${short ? '' : names[id] || esc(id)}</span>`;
  const label = (status) => ({ needs_approval: 'Needs approval', in_review: 'In review', published: 'Published · sample', held: 'Held', failed: 'Failed', scheduled: 'Scheduled', approved: 'Approved', draft: 'Draft', cancelled: 'Cancelled', active: 'Active · sample' }[status] || status);
  const badge = (status) => `<span class="badge ${esc(status)}">${esc(label(status))}</span>`;
  const btn = (text, action, cls = '', extra = '') => `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${text}</button>`;
  const link = (text, route, cls = 'secondary') => `<a class="btn ${cls}" href="#/${route}">${text}</a>`;

  const C = {
    row: (o) => `<div class="list-row">${o.lead || ''}<div class="grow"><strong>${o.title}</strong>${o.sub ? `<small>${o.sub}</small>` : ''}</div>${o.tail || ''}${o.action || ''}</div>`,
    stat: (label, value) => `<div class="mini-stat"><span class="small">${label}</span><strong>${value}</strong></div>`,
    insight: (k, text) => `<div class="insight"><strong>${k}</strong>${text}</div>`,
    empty: (title, text, action = '') => `<div class="empty"><h3>${title}</h3><p>${text}</p>${action}</div>`,
    seg: (attr, opts, cur) => `<div class="segmented">${opts.map(([v, n]) => `<button ${attr}="${v}" aria-pressed="${cur === v}">${n}</button>`).join('')}</div>`,
    panel: (title, body, head = '') => `<section class="panel"><div class="panel-head"><h2>${title}</h2>${head}</div>${body}</section>`
  };

  const route = () => {
    const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
    return aliases[raw] || (titles[raw] ? raw : 'overview');
  };
  const pending = () => S.posts.filter((p) => ['draft', 'needs_approval'].includes(p.status));
  const selected = () => S.posts.find((p) => p.id === U.selected) || S.posts[0];
  const campaign = () => S.campaigns.find((c) => c.id === U.campaign) || S.campaigns[0];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { $('#storage-warning').hidden = false; } };
  const stamp = () => new Date().toISOString();
  const log = (text) => { S.activity.unshift({ text, time: stamp() }); S.activity = S.activity.slice(0, 30); save(); };
  const statusCounts = () => S.posts.reduce((o, p) => (o[p.status] = (o[p.status] || 0) + 1, o), {});

  const dateParts = (iso, zone = U.zone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const dateKey = (iso, zone = U.zone) => { const p = dateParts(iso, zone); return `${p.year}-${p.month}-${p.day}`; };
  const timeLabel = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: U.zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : 'Unscheduled');
  const dateLabel = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: U.zone, day: 'numeric', month: 'short' }).format(new Date(iso)) : 'No date');
  const inputDate = (iso) => { const p = dateParts(iso); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };

  function toISO(wall) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) throw Error('Choose a date and time.');
    const target = Date.parse(wall + 'Z');
    let candidate = target;
    for (let i = 0; i < 4; i++) {
      const p = dateParts(new Date(candidate).toISOString());
      const actual = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}Z`);
      candidate += target - actual;
    }
    const iso = new Date(candidate).toISOString();
    if (inputDate(iso) !== wall) throw Error('That local time does not exist in this timezone.');
    return iso;
  }
  function weekDays() {
    const now = new Date(dateKey(stamp()) + 'T12:00:00Z');
    now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7) + U.offset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }
  const nextTime = () => new Date(Date.now() + 86400000).toISOString();
  const sampleNote = '<span class="badge sample-badge">Fictional Sample</span>';

  /* Signal and Teardown fixtures */
  const signals = [
    { id: 's1', source: 'reddit', where: 'r/IndianSkincareAddicts · 5h ago', up: '94 upvotes · 38 comments', score: '96% match', rule: 'Educational advice allowed; no direct self-promo without verification.', title: 'How do you repair a damaged skin barrier in humid coastal weather?', body: 'Every thick cream clogs my pores, but gel moisturizers do not hydrate enough. What active actually works without stinging?', intent: 'Customer pain', topic: 'barrier repair', insight: 'Explain lightweight ceramide + panthenol pairing before introducing the cream. Lead with the 2-minute diagnostic.', angle: 'A lightweight barrier repair routine for humid weather', evidence: 'Illustrative community discussion' },
    { id: 's2', source: 'x', where: '@d2c_founder_in · 8h ago', up: '22 replies · 140 bookmarks', score: '91% match', rule: 'Quote-post with useful value; keep link in second reply.', title: 'Most brands fail at the first repeat purchase.', body: 'Founders spend ₹500 on Meta acquisition, but the second box never gets ordered because onboarding copy is missing.', intent: 'Product feedback', topic: 'repeat rate', insight: 'Showcase the routine guide card included in the unboxing.', angle: 'Why day-zero unboxing decides repeat orders', evidence: 'Illustrative founder discussion' },
    { id: 's3', source: 'reddit', where: 'r/TwoXIndia · 12h ago', up: '115 upvotes · 47 comments', score: '93% match', rule: 'No brand astroturfing; disclose founder relationship.', title: 'Finding skincare gifts that do not break someone out', body: 'Gift sets are full of useless minis. What is an actual thoughtful routine kit people keep?', intent: 'Buying intent', topic: 'gifting', insight: 'Position the 3-piece routine starter kit with clear return policy.', angle: 'The 3-piece starter set they will actually finish', evidence: 'Illustrative conversation' }
  ];

  const teardowns = [
    { id: 'td-1', brand: 'Minimalist', channel: 'paid', sourceLabel: 'Meta Ad Library · Paid', format: '9:16 Reel Ad · 26s', active: 'Observed 42d · 4 variants', cta: 'Shop Now → /ceramides', hook: '“Why thick barrier creams break out Indian skin in summer”', observed: 'Close-up texture swatch + split-screen ingredient breakdown with concentration badges.', gap: 'Leaves out how to layer with morning sunscreen. Counter with complete 3-step morning order.', angle: 'The zero-clog summer barrier routine' },
    { id: 'td-2', brand: 'Foxtale', channel: 'paid', sourceLabel: 'Meta Ad Library · Paid', format: '1:1 Video Testimonial', active: 'Observed 18d · 2 variants', cta: 'Order Today', hook: '“I stopped using 5 products and fixed my skin with this”', observed: 'UGC creator unboxing and apply-to-cheeks demo.', gap: 'High hype, zero explanation of actives. Counter with grounded ingredient proof.', angle: 'Real ingredient concentrations. Zero hype.' }
  ];

  const competitorData = [
    { name: 'Minimalist', position: 'Transparent active skincare', organic: 'Routine guides + ingredient cards', paid: 'Problem/solution reels + SKU demos', gap: 'Show complete morning-to-night layering routines.' },
    { name: 'Foxtale', position: 'Lifestyle skincare essentials', organic: 'Creator trials + beauty memes', paid: 'UGC testimonial clips', gap: 'Ground benefits in clinical ceramide ratios.' }
  ];

  const dedupEvents = [
    { name: 'PageView', browser: 'Sample received', capi: 'Sample received', dedup: 'Matched · ev_pv_101', quality: 'fbp + fbc + IP/UA', payload: '{\n  "event_name": "PageView",\n  "event_id": "ev_pv_101",\n  "action_source": "website",\n  "event_source_url": "https://your-store.myshopify.com/"\n}', note: 'Browser Pixel and Server CAPI share ev_pv_101 so Meta counts 1 visit.' },
    { name: 'ViewContent', browser: 'Sample received', capi: 'Sample received', dedup: 'Matched · ev_vc_202', quality: 'content_ids + value', payload: '{\n  "event_name": "ViewContent",\n  "event_id": "ev_vc_202",\n  "custom_data": { "content_ids": ["prod_1"], "value": 1499, "currency": "INR" }\n}', note: 'Product template fires ViewContent with matching catalog SKU.' },
    { name: 'AddToCart', browser: 'Sample received', capi: 'Sample received', dedup: 'Matched · ev_atc_303', quality: 'fbp + fbc + value', payload: '{\n  "event_name": "AddToCart",\n  "event_id": "ev_atc_303",\n  "custom_data": { "content_ids": ["prod_1"], "value": 1499, "currency": "INR" }\n}', note: 'Customer Events sandbox forwards cart token to match server CAPI.' },
    { name: 'InitiateCheckout', browser: 'Sample received', capi: 'Sample received', dedup: 'Matched · ev_ic_404', quality: 'fbp + em (hashed)', payload: '{\n  "event_name": "InitiateCheckout",\n  "event_id": "ev_ic_404",\n  "user_data": { "em": ["sha256_hex..."], "fbp": "fb.1.1794790800.112" }\n}', note: 'Checkout start observed in both browser pixel and server CAPI.' },
    { name: 'Purchase', browser: 'Not observed', capi: 'Not observed', dedup: 'Missing pair · investigate', quality: 'Needs test order', payload: '{\n  "event_name": "Purchase",\n  "status": "NOT_OBSERVED_IN_SAMPLE",\n  "required_fields": ["event_time", "event_id", "user_data.em", "custom_data.value", "custom_data.currency"],\n  "diagnostic": "Complete a test order in Shopify or send a test server event in Tracking."\n}', note: 'Deliberately unverified until you fire a real test event: never assume Purchase works until verified.' }
  ];

  let scanBusy = false, adsBusy = false;
  let scanLines = [];

  function toast(text) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 4000);
  }
  function apply(result, message) {
    if (!result?.ok) { toast(result?.reason || 'Could not complete action.'); return false; }
    save(); render();
    if (message) toast(message);
    return true;
  }
  function head(kicker, description, actions = '') {
    return `<header class="page-head">
      <div>
        <span class="eyebrow">${kicker}</span>
        <h1>${titles[route()]}<span aria-hidden="true">_</span></h1>
        <p>${description}</p>
      </div>
      <div class="actions">${actions}</div>
    </header>`;
  }
  function miniArt(name) {
    return `<div class="mini-art" data-dither-video data-cell="2" data-dark="#00006A" data-fit="1.04">
      <video muted loop playsinline preload="metadata" poster="assets/mascot/${name}.poster.webp" src="assets/mascot/${name}.webm" aria-hidden="true"></video>
      <canvas aria-hidden="true"></canvas>
    </div>`;
  }
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const art = (name, o = {}) => `<div class="art ${o.cls || ''}" data-dither-video data-cell="${o.cell || 2}" data-dark="${o.dark || '#00006A'}" data-light="${o.light || '#F2F2F2'}" data-fit="${o.fit || 1}">
    <video muted loop playsinline ${REDUCED ? '' : 'autoplay'} preload="metadata" poster="assets/mascot/${name}.poster.webp" src="assets/mascot/${name}.webm" aria-hidden="true"></video>
    <canvas aria-hidden="true"></canvas>
  </div>`;

  const pixelSteps = () => {
    const t = S.tracking;
    return [
      ['Meta connected', !!t.metaConnected],
      ['Dataset chosen', !!t.pixel],
      ['Installed on store', !!t.installed],
      ['Events received', !!t.tested]
    ];
  };

  function shell() {
    const r = route();
    $('#nav').innerHTML = routes.map(([id, name, ico]) => `
      <a class="nav-link" href="#/${id}" ${r === id ? 'aria-current="page"' : ''}>
        ${icon(ico)}
        <span>${name}</span>
        ${id === 'studio' && pending().length ? `<span class="nav-count">${pending().length}</span>` : ''}
        ${id === 'tracking' && pixelSteps().filter((x) => x[1]).length < 4 ? `<span class="nav-count" style="background:var(--accent);color:#00006A">!</span>` : ''}
      </a>
    `).join('');

    $('#brand-nav').setAttribute('aria-current', r === 'brand' ? 'page' : 'false');
    $('#workspace-name').textContent = S.brand.name;
    const av = $('#workspace-avatar'), sub = $('#workspace-sub');
    if (av) av.textContent = (S.brand.name || '?').trim()[0].toUpperCase();
    if (sub) {
      const o = S.onboarding;
      sub.textContent = o ? [(S.brand.url || '').replace(/^https?:\/\//, ''), o.category].filter(Boolean).join(' / ').toUpperCase() || 'YOUR BRAND' : 'SAMPLE WORKSPACE';
    }
    $('#crumb').textContent = titles[r] || 'Command Center';
    $('#queue-status').textContent = S.paused ? 'Queue paused' : 'Workspace ready';
    document.title = `${titles[r]} — Coldstart`;

    const sp = $('#side-promo');
    if (sp) {
      const d = pixelSteps().filter((x) => x[1]).length;
      const hide = r === 'tracking';
      sp.innerHTML = hide ? '' : `
        <a class="side-promo" href="#/tracking">
          ${art('pixel_setup', { fit: 1.15, dark: '#0000F2', light: '#F2F2F2' })}
          <strong>${d < 4 ? 'Pixel ' + d + '/4 done' : 'Signal verified'}<b>_</b></strong>
          <small>${d < 4 ? 'Complete setup before spending on ads.' : 'Browser + CAPI deduplication matched.'}</small>
          <span class="btn">${d < 4 ? 'Verify tracking →' : 'View events →'}</span>
        </a>
      `;
    }
  }

  /* ---------------- VIEW 1: OVERVIEW ---------------- */
  function overview() {
    const counts = statusCounts(), pend = pending();
    const next = S.posts.filter((p) => p.scheduledAt && !['cancelled', 'published'].includes(p.status)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const px = pixelSteps(), pxDone = px.filter((x) => x[1]).length;

    return head(`${esc(S.brand.name)} / Overview`, 'Coldie listens, drafts and verifies. You approve every post and rupee.') + `
      <!-- Hero Signal Callout -->
      <section class="track-hero-banner">
        <div class="track-hero-copy">
          <span class="eyebrow" style="color:var(--accent)">Job #1 · Signal Verification</span>
          <h2>Never spend before you verify<b>_</b></h2>
          <p>Prevent the 3× duplicate order bug. Before running your first Meta ads, install the deduplicated Customer Events snippet and fire a test event.</p>
          <div class="row" style="margin-top:14px">
            <a class="btn paper" href="#/tracking">${pxDone < 4 ? 'Finish pixel setup (' + pxDone + '/4) →' : 'View tracking diagnostics →'}</a>
            <a class="btn ghost" href="#/studio">Review drafts (${pend.length})</a>
          </div>
        </div>
        <div class="track-hero-gates">
          ${px.map(([t, ok], i) => `
            <div class="track-gate-row ${ok ? 'is-done' : ''}">
              <span class="track-gate-num">${ok ? '✓' : i + 1}</span>
              <strong>${t}</strong>
              <span class="mono">${ok ? 'Verified' : 'Pending'}</span>
            </div>
          `).join('')}
        </div>
      </section>

      <div class="ov-grid">
        <div class="ov-main">
          <section class="ov-panel ov-shift">
            <div class="ov-panel-head">
              <h2>Coldie’s shift</h2>
              <span class="ov-live"><i></i>${S.paused ? 'Queue paused' : 'Active · Shift'}</span>
            </div>
            <div class="ov-shift-body">
              ${art('loading_screen', { cls: 'ov-shift-art', fit: 1.15, cell: 2 })}
              <div class="ov-shift-log">
                <ol id="agent-trace" class="ov-trace" aria-label="Coldie trace">
                  ${S.activity.slice(0, 5).map((a, i) => `
                    <li><span>${a.time ? timeLabel(a.time) : '--:--'}</span><b>${i === 0 ? '&gt;' : '·'}</b>${esc(a.text)}</li>
                  `).join('') || '<li><span>--:--</span><b>&gt;</b>Idle. Actions appear here.</li>'}
                </ol>
                <form id="command-form" class="ov-command" autocomplete="off">
                  <label class="sr-only" for="command-input">Tell Coldie what to do</label>
                  <input id="command-input" name="command" type="text" placeholder="Command Coldie: check pixel / scan reddit / schedule…">
                  <button class="btn" type="submit">Run ↵</button>
                </form>
                <div class="ov-chips">
                  ${[['check pixel', 'Check Pixel'], ['scan reddit', 'Scan Reddit'], ['review approvals', 'Review Approvals'], ['schedule', 'Calendar']].map(([c, t]) => `<button type="button" data-action="cmd" data-cmd="${c}">${t}</button>`).join('')}
                </div>
              </div>
            </div>
          </section>

          <section class="ov-panel">
            <div class="ov-panel-head">
              <h2>Market signals</h2>
              ${link('All research →', 'research', 'secondary')}
            </div>
            <div class="ov-signals">
              ${signals.map((s) => `
                <button type="button" class="ov-signal" data-action="open-signal" data-id="${s.id}">
                  ${platform(s.source, true)}
                  <div>
                    <small>${esc(s.where)}</small>
                    <strong>${esc(s.title)}</strong>
                  </div>
                  <span class="badge approved">${esc(s.score)}</span>
                </button>
              `).join('')}
            </div>
          </section>
        </div>

        <aside class="ov-side">
          <section class="ov-panel">
            <div class="ov-panel-head">
              <h2>Needs your approval</h2>
              <span class="ov-count">${pend.length}</span>
            </div>
            <div class="ov-cards">
              ${pend.slice(0, 3).map((p) => `
                <a class="ov-card" href="#/studio" data-action="edit-post" data-id="${p.id}">
                  ${platform(p.platform, true)}
                  <div>
                    <strong>${esc(p.title)}</strong>
                    <small>${names[p.platform]} · ${label(p.status)}</small>
                  </div>
                </a>
              `).join('') || '<p class="small muted" style="padding:12px">All drafts reviewed! Nice.</p>'}
            </div>
            ${pend.length ? `<div class="ov-panel-foot">${link(`Review all ${pend.length} drafts →`, 'studio', '')}</div>` : ''}
          </section>

          <section class="ov-panel">
            <div class="ov-panel-head">
              <h2>Scheduled queue</h2>
              ${link('Calendar →', 'calendar', 'secondary')}
            </div>
            <div class="ov-sched">
              ${next.slice(0, 4).map((p) => `
                <button type="button" class="ov-slot" data-action="open-calendar" data-id="${p.id}">
                  <div>
                    <strong>${esc(p.title)}</strong>
                    <small>${dateLabel(p.scheduledAt)} · ${timeLabel(p.scheduledAt)}</small>
                  </div>
                  ${platform(p.platform, true)}
                </button>
              `).join('') || '<p class="small muted" style="padding:12px">No scheduled items yet.</p>'}
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  /* ---------------- VIEW 2: TRACKING HERO ---------------- */
  function tracking() {
    const connectorsHtml = window.ColdConnectors ? window.ColdConnectors.views.tracking(head) : '<p class="notice error">Connectors module failed to load.</p>';
    const dedupSection = `
      <section class="panel" style="margin-top:24px">
        <div class="panel-head">
          <h2>Browser ↔ Server CAPI Deduplication Inspector</h2>
          <span class="caption">Shared event_id = 1 truth</span>
        </div>
        <div class="panel-body">
          <p class="small">To prevent double-counting, every event sent from Shopify Customer Events must match the <code>event_id</code> sent by Coldstart’s server webhook. Inspect live sample payloads below:</p>
          <div class="dedup-table-wrap">
            <table class="dedup-table">
              <thead>
                <tr>
                  <th>Event Name</th>
                  <th>Browser Custom Pixel</th>
                  <th>Server CAPI Relay</th>
                  <th>Deduplication Match</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${dedupEvents.map((ev) => `
                  <tr>
                    <td><strong>${ev.name}</strong></td>
                    <td><span class="badge ${ev.browser.includes('Not') ? 'failed' : 'approved'}">${ev.browser}</span></td>
                    <td><span class="badge ${ev.capi.includes('Not') ? 'failed' : 'approved'}">${ev.capi}</span></td>
                    <td class="mono">${ev.dedup}</td>
                    <td><button class="btn secondary btn--small" data-action="inspect-event" data-name="${ev.name}">Inspect payload</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
    return connectorsHtml + dedupSection;
  }

  /* ---------------- VIEW 3: RESEARCH ---------------- */
  function crawler() {
    const L = S.live || {};
    const lines = scanBusy ? scanLines : (L.log || []);
    const used = L.sourcesUsed || ['reddit', 'x', 'instagram'];
    return `
      <section class="crawl-panel">
        <div class="crawl-viz wired ${scanBusy ? 'is-running' : ''}">
          <div id="crawl-telemetry" class="crawl-telemetry" aria-label="Scan telemetry log">
            ${lines.map((l) => `<div><b>&gt;</b> ${esc(l)}</div>`).join('') || '<div>idle · run live scan</div>'}
          </div>
          ${art('research_wired', { fit: 1, cell: 2, dark: '#00006A' })}
          <span class="caption">Live Research</span>
        </div>
        <div class="crawl-copy">
          <div class="row">
            <span class="eyebrow" style="margin:0">Market Listening</span>
            ${S.live?.at ? '<span class="badge approved">Live</span>' : sampleNote}
          </div>
          <h3 id="scan-title">${scanBusy ? 'Coldie is scanning…' : S.live?.at ? `${signals.length} conversations found` : 'Run a live market scan'}</h3>
          <p>Search public conversations on Reddit, X and Instagram for real customer pain points.</p>
          <form id="live-scan-form" class="fields">
            <label class="field">
              <span>What should Coldie listen for?</span>
              <input name="query" minlength="2" maxlength="200" required value="${esc(L.query || S.brand.line || 'barrier repair')}">
            </label>
            <div class="src-chips">
              ${['reddit', 'x', 'instagram'].map((id) => `<label class="chip"><input type="checkbox" name="src" value="${id}" ${used.includes(id) ? 'checked' : ''}>${names[id]}</label>`).join('')}
            </div>
            <div class="row" style="flex-wrap:wrap">
              <button class="btn" type="submit" ${scanBusy ? 'disabled' : ''}>${scanBusy ? 'Scanning…' : 'Run live scan'}</button>
              ${S.live?.at && !scanBusy ? btn('Reset to sample data', 'clear-live', 'secondary') : ''}
            </div>
          </form>
        </div>
      </section>
    `;
  }

  function teardownCard(t) {
    return `
      <article class="teardown-card is-${t.channel}">
        <div class="teardown-head">
          <span>${esc(t.brand)}</span>
          <span class="badge ${t.channel === 'paid' ? 'sample-badge' : 'approved'}">${esc(t.sourceLabel)}</span>
        </div>
        <div class="teardown-frame">
          <strong>${esc(t.hook)}</strong>
          <span>${esc(t.format)}</span>
        </div>
        <div class="teardown-body">
          <div class="teardown-meta">
            <span>${esc(t.active)}</span>
            <span>${esc(t.cta)}</span>
          </div>
          <p><b>Observed:</b> ${esc(t.observed)}</p>
          <p><b>Gap:</b> ${esc(t.gap || 'Not analysed')}</p>
          <div class="actions">
            ${btn(S.saved.includes(t.id) ? 'Saved' : 'Save', 'save-teardown', 'secondary', `data-id="${t.id}" aria-pressed="${S.saved.includes(t.id)}"`)}
            ${btn('Draft angle', 'teardown-draft', '', `data-id="${t.id}"`)}
          </div>
        </div>
      </article>
    `;
  }

  function research() {
    let html = head('Research / Market Evidence', 'Find customer conversations, study category gaps, and tear down rival Meta ads.') + `
      <div class="subtabs" aria-label="Research sections">
        ${[['signals', 'Conversations'], ['category', 'Category brief'], ['competitors', 'Rival Meta Ads'], ['saved', `Saved (${S.saved.length})`]].map(([id, n]) => `<button type="button" data-research="${id}" aria-pressed="${U.research === id}">${n}</button>`).join('')}
      </div>
    `;

    if (['signals', 'saved'].includes(U.research)) {
      const filtered = signals.filter((s) => (U.research !== 'saved' || S.saved.includes(s.id)) && (U.intent === 'all' || s.intent === U.intent));
      const s = filtered.find((x) => x.id === U.signal) || filtered[0];
      if (s) U.signal = s.id;

      return html + (U.research === 'signals' ? crawler() : '') + `
        <div class="research-layout">
          <aside class="filter-rail">
            <div class="sources">
              <h3>Sources</h3>
              ${['reddit', 'x', 'instagram'].map((id) => `<label><input type="checkbox" data-source="${id}" ${U.sources.includes(id) ? 'checked' : ''}>${platform(id)}</label>`).join('')}
            </div>
            <div class="intents">
              <h3>Intent</h3>
              <div class="intent-list">
                ${['all', 'Customer pain', 'Buying intent', 'Product feedback'].map((n) => `<button type="button" class="intent-btn" data-intent="${n}" aria-pressed="${U.intent === n}">${n === 'all' ? 'All' : n}</button>`).join('')}
              </div>
            </div>
          </aside>

          <section class="signal-list">
            ${filtered.map((item) => `
              <article class="signal-item" data-signal="${item.id}" aria-selected="${item.id === U.signal}">
                <div class="signal-meta">
                  ${platform(item.source, true)}
                  <span>${esc(item.where)}</span>
                </div>
                <h3>${esc(item.title)}</h3>
                <p>${esc(item.body)}</p>
                <div class="signal-bottom">
                  <span class="badge approved">${esc(item.score)}</span>
                  <span class="caption">${esc(item.intent)}</span>
                </div>
              </article>
            `).join('') || C.empty('No signals match', 'Try resetting intent filters.')}
          </section>

          ${s ? `
            <aside class="inspector">
              <div class="panel-head">
                <h2>Evidence inspector</h2>
                ${btn(S.saved.includes(s.id) ? 'Saved' : 'Save', 'save-signal', 'secondary', `data-id="${s.id}"`)}
              </div>
              <div class="inspector-body">
                <span class="caption">${esc(s.where)}</span>
                <h3>${esc(s.title)}</h3>
                <blockquote>“${esc(s.body)}”</blockquote>
                ${C.insight('OPPORTUNITY ANGLE', esc(s.angle))}
                ${C.insight('RECOMMENDED ANGLE', esc(s.insight))}
                <div class="actions">
                  ${btn('Draft from this signal →', 'signal-draft', '', `data-id="${s.id}"`)}
                </div>
              </div>
            </aside>
          ` : ''}
        </div>
      `;
    }

    if (U.research === 'competitors') {
      return html + `
        <div class="blue-note">
          ${miniArt('competitor_scan')}
          <div class="grow">
            <span class="eyebrow">Meta Ad Library / Teardowns</span>
            <h3>Separate what rivals post from what they advertise.</h3>
            <p>Ad visibility does not equal ROAS. Study hooks, formats and creative gaps before drafting your own angles.</p>
          </div>
        </div>
        <form id="live-ads-form" class="live-ads-bar">
          <label class="field grow">
            <span>Category or product search</span>
            <input name="query" minlength="2" required value="${esc(S.live?.adsQuery || S.onboarding?.category || 'skincare')}" placeholder="e.g. barrier cream">
          </label>
          <label class="field">
            <span>Country</span>
            <select name="country">
              ${['IN', 'US', 'GB', 'CA', 'AU'].map((c) => `<option ${c === 'IN' ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <button class="btn" type="submit" ${adsBusy ? 'disabled' : ''}>${adsBusy ? 'Pulling ads…' : 'Search Meta Ad Library'}</button>
        </form>
        <div class="teardown-grid">
          ${teardowns.map((t) => teardownCard(t)).join('')}
        </div>
      `;
    }

    return html + C.empty('Category Brief', 'Study alternatives and jobs to be done before drafting product claims.');
  }

  /* ---------------- VIEW 4: STUDIO ---------------- */
  function policyRibbon() {
    const c = campaign();
    return `
      <section class="policy-ribbon">
        <div class="policy-ribbon-left">
          <span class="caption">Campaign policy</span>
          <strong>${esc(c.name)}</strong>
          <div class="policy-modes" role="group" aria-label="Approval policy mode">
            ${[['each', 'Each post'], ['batch', 'Batch'], ['auto', 'Guarded auto']].map(([v, n]) => `<label><input type="radio" name="policy" value="${v}" ${c.policy === v ? 'checked' : ''}><span>${n}</span></label>`).join('')}
          </div>
        </div>
        <div class="row">
          ${c.policy === 'batch' ? btn('Review batch', 'review-batch', 'secondary') : c.policy === 'auto' ? btn('Configure guardrails', 'auto-rules', 'secondary') + btn('Apply rules', 'apply-auto') : btn('Pending review', 'pending-list', 'secondary')}
        </div>
      </section>
    `;
  }

  function preflight(p) {
    const checks = [
      ['Destination connected', S.connections[p.platform] === true],
      ['Approved by human', p.approved === true],
      ['Evidence attached', !!p.sourceId]
    ];
    if (p.platform === 'instagram') checks.push(['Creative attached', p.media === true]);
    if (p.platform === 'reddit') checks.push(['Community rules checked', p.ruleChecked === true]);
    return `
      <div class="preflight-list" aria-label="Pre-publish checks">
        <span class="caption">Preflight checks</span>
        ${checks.map(([n, ok]) => `<div class="preflight-item ${ok ? 'is-ok' : 'is-warn'}"><span>${n}</span><b>${ok ? '✓' : '!'}</b></div>`).join('')}
      </div>
    `;
  }

  function studio() {
    const p = selected();
    if (!p) return head('Studio', 'Create drafts.', btn('New draft', 'new-draft')) + '<div class="empty">No drafts in workspace.</div>';
    const list = S.posts.filter((x) => U.studioFilter === 'all' || x.status === U.studioFilter);
    const locked = ['published', 'cancelled'].includes(p.status);

    return head('Studio / Create & Approve', 'Draft variants for 5 destinations. Editing approved content clears approval immediately.', btn('New draft ' + icon('plus'), 'new-draft')) + policyRibbon() + `
      <div class="studio-layout">
        <aside class="draft-list" aria-label="Draft list">
          ${list.map((q) => `
            <button class="draft-row" data-post="${q.id}" aria-selected="${q.id === p.id}">
              ${platform(q.platform)}
              <strong>${esc(q.title)}</strong>
              ${badge(q.status)}
            </button>
          `).join('') || '<p class="muted small" style="padding:10px">No drafts in this view.</p>'}
        </aside>

        <section class="draft-editor">
          <div class="editor-head">
            <span class="caption">${esc(campaign().name)}</span>
            ${badge(p.status)}
          </div>
          <form id="draft-form" class="fields">
            <div class="form-columns">
              <label class="field">
                <span>Destination</span>
                <select id="draft-platform" name="platform" ${locked ? 'disabled' : ''}>
                  ${Object.entries(names).map(([id, n]) => `<option value="${id}" ${p.platform === id ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
              </label>
              <label class="field">
                <span>Campaign</span>
                <select name="campaign" ${locked ? 'disabled' : ''}>
                  ${S.campaigns.map((c) => `<option value="${c.id}" ${c.id === p.campaign ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                </select>
              </label>
            </div>
            <label class="field">
              <span>Post Title / Hook</span>
              <input name="title" value="${esc(p.title)}" required maxlength="180" ${locked ? 'disabled' : ''}>
            </label>
            <label class="field">
              <span>Post Body Copy</span>
              <textarea id="draft-body" name="body" rows="6" required ${locked ? 'disabled' : ''}>${esc(p.body)}</textarea>
            </label>
            ${p.platform === 'reddit' ? `<label class="check"><input name="ruleChecked" type="checkbox" ${p.ruleChecked ? 'checked' : ''} ${locked ? 'disabled' : ''}> I confirmed the community rules on self-promo</label>` : ''}
            <div class="actions" style="margin-top:10px">
              ${!locked ? btn('Rewrite with Gemini', 'ai-rewrite', 'secondary') + '<button class="btn" type="submit">Save draft edits</button>' : ''}
              ${!p.approved && !locked ? btn('Approve post', 'approve', 'secondary', `data-id="${p.id}"`) : ''}
              ${['reddit', 'x'].includes(p.platform) && p.approved && !locked ? btn('Publish now', 'publish-live', '', `data-id="${p.id}"`) : ''}
            </div>
          </form>
        </section>

        <aside class="studio-preview">
          <div class="preview-card">
            <div class="preview-account">
              ${platform(p.platform, true)}
              <div><strong>${esc(S.brand.name)}</strong><div class="muted">Live preview</div></div>
            </div>
            <div class="preview-text" id="post-preview">
              <h3>${esc(p.title)}</h3>
              ${esc(p.body)}
            </div>
            <div class="preview-foot">${names[p.platform]} · Explicit approval required</div>
          </div>
          ${preflight(p)}
        </aside>
      </div>
    `;
  }

  /* ---------------- VIEW 5: CALENDAR ---------------- */
  function calendar() {
    const days = weekDays();
    const all = S.posts.filter((p) => p.scheduledAt && days.includes(dateKey(p.scheduledAt)) && p.status !== 'cancelled');
    const p = selected();

    return head('Calendar / Publishing Queue', 'Organize and schedule approved drafts across the week.', btn(S.paused ? 'Resume queue' : 'Pause queue', 'pause-queue', 'secondary') + btn('New draft ' + icon('plus'), 'new-draft')) + `
      <div class="toolbar">
        <div class="toolbar-group">
          ${btn('←', 'prev-week', 'secondary', 'aria-label="Previous week"')}
          <strong class="small">${days[0]} – ${days[6]}</strong>
          ${btn('→', 'next-week', 'secondary', 'aria-label="Next week"')}
          ${btn('Today', 'this-week', 'secondary')}
        </div>
        <select id="timezone" aria-label="Timezone selector">
          ${[...new Set([U.zone, 'Asia/Kolkata', 'UTC', 'America/New_York'])].map((z) => `<option value="${z}" ${U.zone === z ? 'selected' : ''}>${z}</option>`).join('')}
        </select>
      </div>
      <div class="calendar-layout">
        <div class="week">
          ${days.map((day) => {
            const dayPosts = all.filter((x) => dateKey(x.scheduledAt) === day);
            return `
              <div class="day ${day === dateKey(stamp()) ? 'today' : ''}">
                <div class="day-head">
                  <span>${day.slice(5)}</span>
                  <strong>${new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))}</strong>
                </div>
                <div class="day-posts">
                  ${dayPosts.map((q) => `
                    <button type="button" class="calendar-post" data-post="${q.id}" aria-selected="${q.id === p?.id}">
                      <div class="post-time">${timeLabel(q.scheduledAt)}</div>
                      <strong>${esc(q.title)}</strong>
                      ${badge(q.status)}
                    </button>
                  `).join('') || '<div class="day-empty">No posts</div>'}
                  <button type="button" class="btn btn--ghost btn--small" style="width:100%;margin-top:8px" data-action="quick-slot" data-day="${day}">+ Slot</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        ${p ? `
          <aside class="inspector calendar-inspector">
            <div class="panel-head">
              <h2>Selected post</h2>
              ${badge(p.status)}
            </div>
            <div class="inspector-body">
              ${platform(p.platform)}
              <h3 style="margin:10px 0">${esc(p.title)}</h3>
              <p class="small">${esc(p.body)}</p>
              <form id="schedule-form" class="fields" style="margin-top:14px">
                <label class="field">
                  <span>Publish time (${esc(U.zone)})</span>
                  <input name="when" type="datetime-local" value="${inputDate(p.scheduledAt || nextTime())}" required>
                </label>
                <button class="btn" type="submit">Schedule in workspace</button>
              </form>
              <div class="actions" style="margin-top:10px">
                ${btn('Simulate outcome', 'publish-dialog', 'secondary', `data-id="${p.id}"`)}
                ${btn('Cancel post', 'cancel-post', 'danger', `data-id="${p.id}"`)}
              </div>
            </div>
          </aside>
        ` : ''}
      </div>
    `;
  }

  /* ---------------- VIEW 6: ADS ---------------- */
  function ads() {
    return head('Ads / Separate from Organic', 'Paid campaigns with zero automatic spend. You review every ad set.', btn(S.adsPaused ? 'Resume sample ads' : 'Pause sample ads', 'pause-ads', 'secondary') + btn('New ad draft', 'new-ad')) + `
      <p class="notice" style="margin-bottom:20px">Paid campaigns remain local drafts until connected to a verified ad account. $0 spent.</p>
      <section class="panel">
        <div class="panel-head">
          <h2>Meta Campaign Drafts</h2>
          ${sampleNote}
        </div>
        ${S.ads.map((a) => `
          <div class="ad-row">
            <div>
              <strong>${esc(a.title)}</strong>
              <p>${esc(a.goal)} · Facebook + Instagram</p>
            </div>
            <div class="ad-budget">
              <span class="caption muted">Daily cap</span><br>
              <span class="mono">$${a.budget}</span>
            </div>
            ${badge(a.status)}
            <div class="actions">${btn('Review', 'review-ad', 'secondary', `data-id="${a.id}"`)}</div>
          </div>
        `).join('')}
      </section>
    `;
  }

  /* ---------------- VIEW 7: RESULTS ---------------- */
  function results() {
    return head('Results / Sample Reporting', 'Read reporting alongside data coverage. These numbers are illustrative sample series—not live attribution.') + `
      <div class="metrics">
        <div class="metric"><span class="caption">Store sessions</span><strong>1,842</strong><small>Illustrative</small></div>
        <div class="metric"><span class="caption">Orders</span><strong>48</strong><small>Illustrative</small></div>
        <div class="metric"><span class="caption">Ad spend</span><strong>$140</strong><small>Sample · $0 charge</small></div>
        <div class="metric"><span class="caption">Attributed ROAS</span><strong>—</strong><small>Attribution not connected</small></div>
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>Store sessions trend (sample)</h2>
          ${sampleNote}
        </div>
        <div class="panel-body">
          <p class="small muted">Attributed ROAS remains disconnected until live Meta Insights and CAPI events are matched.</p>
        </div>
      </section>
    `;
  }

  /* ---------------- VIEW 8: CONNECTIONS ---------------- */
  function connections() {
    const simulator = `
      <section class="panel" style="margin-top:24px">
        <div class="panel-head">
          <h2>Local Publishing Simulator</h2>
          <span class="caption">Browser state only</span>
        </div>
        ${Object.keys(names).map((id) => `
          <div class="connection-row">
            ${platform(id)}
            <p>Queue and schedule posts locally for ${names[id]}.</p>
            <span class="badge ${S.connections[id] ? 'approved' : 'held'}">${S.connections[id] ? 'Connected' : 'Disconnected'}</span>
            ${btn(S.connections[id] ? 'Disconnect' : 'Connect preview', 'connection', 'secondary', `data-platform="${id}"`)}
          </div>
        `).join('')}
      </section>
    `;
    return window.ColdConnectors ? window.ColdConnectors.views.connections(head, simulator) : simulator;
  }

  /* ---------------- VIEW 9: BRAND CONTEXT ---------------- */
  function brand() {
    const o = S.onboarding;
    return head('Brand / One Single Context', 'Your brand voice, ICPs, and catalogue extracted during onboarding.') + `
      <div class="grid-aside">
        <form id="brand-form" class="fields panel panel-body">
          <label class="field"><span>Brand Name</span><input name="name" value="${esc(S.brand.name)}" required maxlength="70"></label>
          <label class="field"><span>Store Website</span><input name="url" value="${esc(S.brand.url)}" required></label>
          <label class="field"><span>Product line summary</span><textarea name="line" required>${esc(S.brand.line)}</textarea></label>
          <label class="field"><span>Voice &amp; tone</span><input name="voice" value="${esc(S.brand.voice)}" required></label>
          <label class="field"><span>Words / claims to avoid</span><input name="avoid" value="${esc(S.brand.avoid)}"></label>
          <button class="btn" type="submit" style="justify-self:start">Save brand profile</button>
        </form>

        <aside class="stack">
          ${o ? `
            <section class="panel">
              <div class="panel-head"><h2>Brand Book</h2><span class="caption">${o.real ? 'Live scan' : 'Simulated'}</span></div>
              <div class="panel-body">
                <div class="bb-swatches">
                  ${(o.book?.colors || []).map((c) => `<span class="bb-sw"><i style="background:${c}"></i><small>${c}</small></span>`).join('')}
                </div>
                <p class="small" style="margin-top:10px"><b>Voice:</b> ${esc((o.book?.tones || []).join(', '))}</p>
              </div>
            </section>
          ` : `
            <section class="blue-note">
              ${miniArt('wave')}
              <div>
                <span class="eyebrow">Onboarding missing</span>
                <h3>Run onboarding scan</h3>
                <p>Extract your store catalogue and voice in 4 minutes.</p>
                <a class="btn paper" href="onboarding-v3.html" style="margin-top:8px">Start Onboarding →</a>
              </div>
            </section>
          `}
        </aside>
      </div>
    `;
  }

  const views = { overview, tracking, research, studio, calendar, ads, results, connections, brand };

  function render() {
    shell();
    $('#workspace').innerHTML = views[route()]();
    if (window.Dither) window.Dither.videos(document);
    if (window.ColdConnectors) window.ColdConnectors.media.hydrate(document);
    save();
  }

  function showDialog(title, html) {
    const d = $('#dialog');
    if (!d) return;
    d.innerHTML = `
      <div class="dialog-head">
        <h2>${title}</h2>
        <button class="icon-btn" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button>
      </div>
      <div class="dialog-body">${html}</div>
    `;
    if (!d.open) d.showModal();
  }
  function closeDialog() { const d = $('#dialog'); if (d?.open) d.close(); }
  function openPost(id, r = 'calendar') { U.selected = id; if (route() === r) render(); else location.hash = '/' + r; }

  function newDraftDialog(source) {
    const c = campaign();
    showDialog('Create destination draft', `
      <form id="new-draft-form" class="fields" data-source="${source?.id || ''}">
        <div class="form-columns">
          <label class="field">
            <span>Destination</span>
            <select name="platform">
              ${Object.entries(names).map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Campaign</span>
            <select name="campaign">
              ${S.campaigns.map((q) => `<option value="${q.id}" ${q.id === c.id ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field">
          <span>Title / Angle</span>
          <input name="title" value="${esc(source?.angle || '')}" required maxlength="180">
        </label>
        <label class="field">
          <span>Copy</span>
          <textarea name="body" required rows="5">${esc(source?.insight || 'Start with useful customer value…')}</textarea>
        </label>
        <div class="actions">
          <button class="btn secondary" type="button" data-action="ai-draft">Write with Gemini</button>
          <button class="btn" type="submit">Create draft</button>
        </div>
      </form>
    `);
  }

  function adDialog(ad) {
    showDialog(ad ? 'Review paid campaign' : 'New campaign draft', `
      <form id="ad-form" data-id="${ad?.id || ''}" class="fields">
        <label class="field"><span>Campaign name</span><input name="title" value="${esc(ad?.title || '')}" required></label>
        <label class="field"><span>Objective</span><select name="goal">${['Product discovery', 'Store visits', 'Purchases'].map((x) => `<option ${ad?.goal === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field"><span>Daily budget cap (USD)</span><input name="budget" type="number" min="1" max="500" value="${ad?.budget || 10}" required></label>
        <div class="actions">
          <button class="btn" type="submit">Save ad draft</button>
        </div>
      </form>
    `);
  }

  const actions = {
    'menu': () => document.body.classList.toggle('menu-open'),
    'close-menu': () => document.body.classList.remove('menu-open'),
    'close-dialog': closeDialog,
    'new-draft': () => newDraftDialog(),
    'signal-draft': (el) => newDraftDialog(signals.find((s) => s.id === el.dataset.id)),
    'save-signal': (el) => {
      const id = el.dataset.id;
      S.saved = S.saved.includes(id) ? S.saved.filter((x) => x !== id) : [...S.saved, id];
      render(); toast(S.saved.includes(id) ? 'Saved signal to evidence.' : 'Removed from saved.');
    },
    'teardown-draft': (el) => {
      const t = teardowns.find((x) => x.id === el.dataset.id);
      if (t) newDraftDialog({ id: t.id, angle: t.angle, insight: t.gap });
    },
    'save-teardown': (el) => {
      const id = el.dataset.id;
      S.saved = S.saved.includes(id) ? S.saved.filter((x) => x !== id) : [...S.saved, id];
      save(); render(); toast(S.saved.includes(id) ? 'Teardown bookmarked.' : 'Bookmark removed.');
    },
    'approve': (el) => apply(E.approve(S, el.dataset.id), 'Post approved by human.'),
    'open-calendar': (el) => openPost(el.dataset.id),
    'edit-post': (el) => openPost(el.dataset.id, 'studio'),
    'pause-queue': () => apply(E.setPaused(S, !S.paused), S.paused ? 'Publishing queue resumed.' : 'Queue paused; work is held.'),
    'prev-week': () => { U.offset--; render(); },
    'next-week': () => { U.offset++; render(); },
    'this-week': () => { U.offset = 0; render(); },
    'cancel-post': (el) => apply(E.cancel(S, el.dataset.id), 'Post cancelled.'),
    'publish-dialog': (el) => showDialog('Test local outcome', `
      <p class="small muted">Simulate provider response locally without hitting platform APIs:</p>
      <div class="actions">
        ${btn('Simulate failure', 'publish-fail', 'secondary', `data-id="${el.dataset.id}"`)}
        ${btn('Simulate success', 'publish-ok', '', `data-id="${el.dataset.id}"`)}
      </div>
    `),
    'publish-ok': (el) => { if (apply(E.simulatePublish(S, el.dataset.id, 'success'), 'Outcome: published locally.')) closeDialog(); },
    'publish-fail': (el) => { if (apply(E.simulatePublish(S, el.dataset.id, 'failure'), 'Outcome: provider error recorded.')) closeDialog(); },
    'review-batch': () => {
      const c = campaign(), posts = S.posts.filter((p) => p.campaign === c.id && !['published', 'cancelled'].includes(p.status) && !p.approved);
      showDialog('Review campaign batch', `
        <p class="small muted">${posts.length} unapproved items in ${esc(c.name)}.</p>
        <div class="actions">${btn('Approve all in batch', 'confirm-batch', '', !posts.length ? 'disabled' : '')}</div>
      `);
    },
    'confirm-batch': () => { if (apply(E.approveBatch(S, campaign().id), 'Batch approved.')) closeDialog(); },
    'auto-rules': () => showDialog('Configure guardrails', '<p class="small">Daily cap and platform rules for guarded automation.</p>'),
    'apply-auto': () => apply(E.applyAutomation(S, campaign().id), 'Guardrails evaluated locally.'),
    'connection': (el) => {
      const id = el.dataset.platform;
      if (S.connections[id]) apply(E.setConnection(S, id, false), names[id] + ' disconnected locally.');
      else showDialog(names[id] + ' preview', `<p class="notice">No live OAuth credentials requested. Toggles local simulation.</p><div class="actions">${btn('Simulate connection', 'confirm-connect', '', `data-platform="${id}"`)}</div>`);
    },
    'confirm-connect': (el) => { if (apply(E.setConnection(S, el.dataset.platform, true), 'Simulated connection active.')) closeDialog(); },
    'quick-slot': (el) => {
      const av = S.posts.filter((p) => p.approved && !p.scheduledAt);
      showDialog('Fill slot ' + el.dataset.day, av.length ? `
        <div class="search-results">${av.map((p) => `<button class="sibling-row" data-action="slot-pick" data-id="${p.id}" data-day="${el.dataset.day}" style="width:100%">${platform(p.platform, true)}<span>${esc(p.title)}</span></button>`).join('')}</div>
      ` : '<p class="small muted">Approve a draft in Studio first.</p>');
    },
    'slot-pick': (el) => {
      try {
        const iso = toISO(el.dataset.day + 'T10:00');
        if (apply(E.schedule(S, el.dataset.id, iso), 'Scheduled into slot.')) closeDialog();
      } catch (err) { toast(err.message); }
    },
    'inspect-event': (el) => {
      const ev = dedupEvents.find((x) => x.name === el.dataset.name);
      if (ev) showDialog(ev.name + ' payload', `<pre class="payload-box">${esc(ev.payload)}</pre><p class="small">${ev.note}</p>`);
    },
    'pause-ads': () => { S.adsPaused = !S.adsPaused; log(S.adsPaused ? 'Paused sample ads.' : 'Resumed sample ads.'); render(); },
    'new-ad': () => adDialog(),
    'review-ad': (el) => adDialog(S.ads.find((a) => a.id === el.dataset.id)),
    'reset': () => showDialog('Reset workspace?', `<p class="small">Resets local state back to sample seed.</p><div class="actions">${btn('Cancel', 'close-dialog', 'secondary')}${btn('Confirm reset', 'confirm-reset', 'danger')}</div>`),
    'confirm-reset': () => { localStorage.removeItem(KEY); location.reload(); },
    'search': () => showDialog('Workspace search', `<input id="global-search" type="search" placeholder="Search pages or content…"><div id="global-results" class="search-results"></div>`),
    'cmd': (el) => {
      const c = el.dataset.cmd;
      if (c.includes('pixel') || c.includes('track')) location.hash = '/tracking';
      else if (c.includes('scan') || c.includes('reddit')) location.hash = '/research';
      else if (c.includes('approval') || c.includes('draft')) location.hash = '/studio';
      else if (c.includes('schedule') || c.includes('calendar')) location.hash = '/calendar';
      else toast('Unknown command.');
    }
  };

  /* Event Listeners */
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (action && !action.disabled) {
      e.preventDefault();
      if (window.ColdConnectors && window.ColdConnectors.action(action.dataset.action, action)) return;
      actions[action.dataset.action]?.(action);
      return;
    }
    const tab = e.target.closest('[data-research]');
    if (tab) { U.research = tab.dataset.research; render(); return; }
    const signal = e.target.closest('[data-signal]');
    if (signal) { U.signal = signal.dataset.signal; render(); return; }
    const post = e.target.closest('[data-post]');
    if (post) { U.selected = post.dataset.post; render(); return; }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form.id) return;
    e.preventDefault();
    const fd = new FormData(form), v = (k) => String(fd.get(k) || '');
    try {
      if (window.ColdConnectors && window.ColdConnectors.submit(form.id, fd)) return;
      if (form.id === 'draft-form') {
        const p = selected();
        if (['published', 'cancelled'].includes(p.status)) return;
        const r = E.edit(S, p.id, { title: v('title'), body: v('body') });
        if (!r.ok) return toast(r.reason);
        p.platform = v('platform');
        if (p.platform === 'reddit') p.ruleChecked = fd.has('ruleChecked');
        save(); render();
        toast('Draft saved. Prior approval cleared.');
      }
      if (form.id === 'new-draft-form') {
        const r = E.createPost(S, { platform: v('platform'), title: v('title'), body: v('body'), campaign: v('campaign'), sourceId: form.dataset.source || null });
        if (!r.ok) return toast(r.reason);
        U.selected = r.post?.id || S.posts.at(-1).id;
        save(); closeDialog();
        location.hash = '/studio';
        toast('Draft created.');
      }
      if (form.id === 'schedule-form') {
        const iso = toISO(v('when'));
        apply(E.schedule(S, selected().id, iso), 'Post scheduled in prototype.');
      }
      if (form.id === 'brand-form') {
        S.brand = { name: v('name').trim(), url: v('url').trim(), line: v('line').trim(), voice: v('voice').trim(), avoid: v('avoid').trim() };
        save(); render(); toast('Brand profile saved locally.');
      }
    } catch (err) { toast(err.message || 'Please check inputs.'); }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'policy') apply(E.setPolicy(S, campaign().id, t.value), 'Policy saved. Existing posts untouched.');
    else if (t.id === 'timezone') { U.zone = t.value; render(); }
    else if (window.ColdConnectors) window.ColdConnectors.change(t.dataset.change, t);
  });

  addEventListener('hashchange', () => {
    document.body.classList.remove('menu-open');
    render();
    window.scrollTo(0, 0);
  });

  if (window.ColdConnectors) {
    window.ColdConnectors.mount({
      render: () => render(),
      toast,
      get S() { return S; },
      save,
      showDialog,
      closeDialog,
      miniArt
    });
  }

  render();
})();
