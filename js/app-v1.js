/* Coldstart app prototype. Everything here is client-side sample data: no account, no network calls.
   State lives in one object (S), saved to localStorage, and each view is re-rendered from it. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KEY = 'coldstart-app';
  const clip = (name) => `assets/mascot/${name}`;

  /* ---------------------------------------------------------------- sample workspace */
  const SEED = {
    v: 3,
    mode: 'running',
    ui: { sel: 'q1', open: false, chan: 'all', show: 'needs', range: 7 },
    brand: {
      name: 'Fernbook', url: 'fernbook.app', line: 'Plant care reminders that learn your flat.',
      loud: 35, playful: 60, use: 'plain words, specific plants', avoid: 'hustle, game-changer, revolutionary',
    },
    channels: [
      { id: 'pixel', name: 'Meta Pixel', kind: 'tracking', does: 'Counts visits and sign-ups so every other channel can be measured.', connected: true, on: true },
      { id: 'ig', name: 'Instagram ads', kind: 'paid', does: 'Runs small campaigns to people who have never seen the brand.', connected: true, on: true, cap: 5 },
      { id: 'reddit', name: 'Reddit', kind: 'organic', does: 'Posts in communities where your users already are.', connected: false, on: false, per: 2 },
      { id: 'x', name: 'X', kind: 'organic', does: 'Keeps a steady voice going while you ship.', connected: true, on: true, per: 5 },
      { id: 'web', name: 'Web posts', kind: 'content', does: 'Writes posts for your own site so search has something to find.', connected: true, on: true, per: 1 },
    ],
    queue: [
      { id: 'q0', ch: 'ig', type: 'ad', status: 'bounced', when: 'was live 09:40', title: 'Dead fern, zero guilt',
        body: 'Killed another one? Fernbook works out how fast your flat dries and tells you before the leaves do.',
        alt: 'Your fern is not dramatic. Your radiator is. Fernbook reminds you to water before it shows.',
        meta: { audience: 'People who follow plant-care accounts', budget: '$5 a day, 4 days' }, note: 'Rejected in review: the landing page did not load. Fix the link, then send it again.' },
      { id: 'q1', ch: 'ig', type: 'ad', status: 'draft', when: 'today 18:00', title: 'Your monstera is thirsty. You just can\'t tell yet.',
        body: 'Fernbook learns how fast your flat dries out and reminds you before the leaves droop. Free while we\'re small.',
        alt: 'Most watering apps use a fixed schedule. Fernbook watches your flat instead, and reminds you when the plant actually needs it.',
        meta: { audience: 'People who follow plant-care accounts', budget: '$5 a day, 4 days' } },
      { id: 'q2', ch: 'reddit', type: 'post', status: 'draft', when: 'tomorrow 10:00', title: 'I kept killing calatheas, so I built a reminder that learns your flat',
        body: 'Fixed schedules never worked for me because my flat dries out twice as fast in winter. So I made a small app that adjusts.\n\nHappy to answer questions about how it guesses. Mostly I want to know what would make you trust a reminder like this.',
        alt: 'Question for people with fussy plants: would you trust an app that changes your watering days on its own?\n\nI built one because fixed schedules kept failing me in winter. Curious what would make it feel safe to follow.',
        meta: { community: 'r/houseplants', rule: 'Self-promotion allowed on Sundays only' } },
      { id: 'q3', ch: 'x', type: 'post', status: 'draft', when: 'today 14:30', title: 'Day 4 of building Fernbook',
        body: 'Day 4 of building Fernbook: taught it the difference between a north window and a south one. Your snake plant does not care. Your fern does.',
        alt: 'Day 4: Fernbook now knows which way your window faces. It turns out this matters more than the plant.', meta: {} },
      { id: 'q4', ch: 'x', type: 'post', status: 'draft', when: 'tomorrow 09:00', title: 'What plant have you killed most often?',
        body: 'What\'s the plant you\'ve killed most often? Asking for a feature.',
        alt: 'Be honest: which plant have you replaced more than twice? We are building for that one first.', meta: {} },
      { id: 'q5', ch: 'web', type: 'article', status: 'draft', when: 'thursday 08:00', title: 'How often should you water a monstera? It depends on your flat',
        body: 'Outline\n1. Why "once a week" fails\n2. Three things that change how fast soil dries: light, heat, pot\n3. A two-minute test with your finger\n4. What to change in winter\n5. Where a reminder helps and where it does not\n\nAbout 900 words.',
        alt: 'Outline\n1. The schedule myth\n2. Light, heat and pot size, with examples\n3. The finger test\n4. Winter\n5. When to stop worrying\n\nAbout 700 words, shorter intro.',
        meta: { where: 'fernbook.app/notes' } },
      { id: 'q6', ch: 'x', type: 'post', status: 'approved', when: 'tomorrow 17:00', title: 'Winter watering',
        body: 'Radiators on? Your plants are drying out faster than they did in October. Check the top two centimetres of soil before you water.', alt: '', meta: {} },
      { id: 'q7', ch: 'web', type: 'article', status: 'sent', when: 'yesterday', title: 'Why watering schedules don\'t work',
        body: 'Published. 780 words.', alt: '', meta: { where: 'fernbook.app/notes' } },
    ],
    log: [
      ['09:02', 'pixel installed on fernbook.app'], ['09:03', 'pageview event seen'], ['09:10', 'scanned 3 competitors'],
      ['09:31', 'drafted 2 instagram ads'], ['09:34', 'drafted 1 reddit post'], ['09:40', 'drafted 3 x posts'],
      ['09:52', 'drafted 1 web post'], ['11:15', 'instagram ad rejected in review'],
    ],
    pixel: { site: 'fernbook.app', events: [['PageView', true], ['ViewContent', true], ['Lead', true], ['Purchase', false]] },
    competitors: [
      { name: 'Leafline', what: 'Plant delivery subscription with care tips.', on: ['instagram ads: heavy', 'reddit: none', 'x: quiet', 'blog: weekly'], gap: 'Sells plants first. Care advice is an afterthought.' },
      { name: 'Potted', what: 'Identifies a plant from a photo.', on: ['instagram ads: some', 'reddit: active', 'x: active', 'blog: none'], gap: 'Tells you what the plant is, not when to water it.' },
      { name: 'Greenhour', what: 'Watering reminders on fixed schedules.', on: ['instagram ads: none', 'reddit: some', 'x: quiet', 'blog: monthly'], gap: 'Fixed schedules only. Your angle: reminders that adapt to the room.' },
    ],
    results: [
      { src: 'Instagram ads', days: [18, 26, 31, 40, 35, 29, 33], leads: 9, cost: '$20' },
      { src: 'Direct', days: [4, 7, 9, 12, 10, 11, 11], leads: 3, cost: '' },
      { src: 'X', days: [2, 3, 8, 6, 5, 7, 6], leads: 1, cost: '' },
      { src: 'Web posts', days: [0, 0, 1, 3, 5, 6, 6], leads: 0, cost: '' },
      { src: 'Reddit', days: [0, 0, 0, 0, 0, 0, 0], leads: 0, cost: '', off: true },
    ],
  };
  const STAGES = ['Installing', 'Scanning competitors', 'Generating campaigns', 'Analyzing results'];
  const CH = { pixel: 'pixel', ig: 'instagram', reddit: 'reddit', x: 'x', web: 'web' };
  const VIEWS = [['run', 'Run'], ['queue', 'Queue'], ['channels', 'Channels'], ['pixel', 'Pixel'], ['competitors', 'Competitors'], ['results', 'Results'], ['brand', 'Brand']];

  let S;
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.v === SEED.v) return v; } catch (e) { /* private mode */ } return structuredClone(SEED); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode */ } };
  S = load();

  const empty = () => S.mode === 'empty';
  const setup = () => S.setup ||= {
    brand: { name: '', url: '', line: '', loud: 35, playful: 60, use: '', avoid: '' },
    pixel: { site: '', events: SEED.pixel.events.map(([name]) => [name, false]) },
    channels: SEED.channels.map((c) => ({ ...c, connected: false, on: false })),
  };
  const brand = () => empty() ? setup().brand : S.brand;
  const channels = () => empty() ? setup().channels : S.channels;
  const pixel = () => empty() ? setup().pixel : S.pixel;
  const drafts = () => S.queue.filter((q) => q.status === 'draft');
  const bounced = () => S.queue.filter((q) => q.status === 'bounced');
  const needsYou = () => S.queue.filter((q) => q.status === 'draft' || q.status === 'bounced');
  const chan = (id) => channels().find((c) => c.id === id);
  const holdReason = (q) => {
    const c = chan(q.ch);
    return !c || !c.connected ? `${c ? c.name : 'Channel'} not connected` : !c.on ? `${c.name} paused` : '';
  };
  const reconcileQueue = () => !empty() && S.queue.forEach((q) => {
    if (q.status === 'approved' || q.status === 'held') q.status = holdReason(q) ? 'held' : 'approved';
  });
  const stageNow = () => (needsYou().length ? 2 : 3);
  const route = () => { const r = location.hash.replace(/^#\/?/, ''); return VIEWS.some((v) => v[0] === r) ? r : 'run'; };

  /* ---------------------------------------------------------------- small templates */
  const statusTag = (q) => ({
    draft: '<span class="tag tag--warn label">needs you</span>', bounced: '<span class="tag tag--bad label">rejected</span>',
    approved: '<span class="tag label">approved</span>', held: '<span class="tag label">held</span>',
    sent: '<span class="tag tag--solid label">sent</span>', rejected: '<span class="tag label muted">dropped</span>',
  }[q.status] || '');
  const emptyState = (clipName, title, text, action = '') => `
    <div class="empty">
      <div class="duo" data-dither-video data-cell="2" data-dark="#00006A" data-fit="1.25">
        <video muted loop playsinline preload="auto" ${REDUCE ? '' : 'autoplay'} poster="${clip(clipName)}.poster.webp" aria-hidden="true"><source src="${clip(clipName)}.webm" type="video/webm"></video>
        <canvas aria-hidden="true"></canvas>
      </div>
      <div><h2 class="display">${title}</h2><p>${text}</p>${action}</div>
    </div>`;

  /* ---------------------------------------------------------------- views */
  const view = {};

  view.run = () => {
    if (empty()) {
      const b = brand();
      const steps = [
        ['Add your app', 'Save your site address locally. No site is contacted.', '#/pixel', 'add site', !!pixel().site],
        ['Describe the vibe', 'Save a name and one line about what you built.', '#/brand', 'set brand', !!(b.name.trim() && b.line.trim())],
        ['Choose a channel', 'Try a simulated connection. No account access is requested.', '#/channels', 'choose', channels().some((c) => c.id !== 'pixel' && c.connected && c.on)],
      ];
      const completed = steps.filter((s) => s[4]).length;
      return `
        <p class="run-line">${completed === 3 ? 'Local setup saved. You can explore the separate Fernbook sample next.' : 'Set up your workspace locally. Nothing is published, tracked or charged.'}</p>
        <section class="block"><div class="head"><h2 class="display">Set up</h2><span class="label">${completed} of 3</span></div>
          <ol class="rows onboard">${steps.map((s, i) => `<li class="${s[4] ? 'is-done' : ''}"><span class="n label">${s[4] ? '✓' : i + 1}</span><div><b>${s[0]}</b><br><span class="muted">${s[1]}</span></div><a class="btn btn--ghost" href="${s[2]}">${s[4] ? 'edit' : s[3]}</a></li>`).join('')}</ol>
        </section>
        ${emptyState('idle_stand', completed === 3 ? 'Ready to explore' : 'Start cold', 'Load the supplied Fernbook sample to explore drafts and results. It is not generated from your site. Your local setup stays saved separately.', '<button class="btn" type="button" data-act="mode" data-mode="running">Load sample run</button>')}`;
    }
    const now = stageNow(), n = needsYou().length, d = drafts().length;
    const reddit = chan('reddit'), purchase = S.pixel.events.find((e) => e[0] === 'Purchase');
    const needs = [];
    if (bounced().length) needs.push(['An Instagram ad was rejected', 'The landing page did not load during review.', '#/queue', 'fix it', 'q0']);
    if (d) needs.push([`${d} draft${d > 1 ? 's' : ''} to approve`, 'Nothing goes out until you say so.', '#/queue', 'open queue', drafts()[0].id]);
    S.channels.filter((c) => c.id !== 'pixel' && (!c.connected || !c.on)).forEach((c) => {
      const held = S.queue.filter((q) => q.ch === c.id && q.status === 'held').length;
      needs.push([`${c.name} ${c.connected ? 'is paused' : 'is not connected'}`, held ? `${held} approved item${held === 1 ? ' is' : 's are'} held.` : 'New approvals will be held for this channel.', '#/channels', 'review', '']);
    });
    if (purchase && !purchase[1]) needs.push(['Purchase event not seen yet', 'Check the pixel on your checkout page.', '#/pixel', 'check pixel', '']);
    const line = n ? `Coldie has drafted the first campaigns and is waiting on you for ${n} of them.` : 'Everything is approved. Coldie is watching what comes in.';
    const upcoming = S.queue.filter((q) => q.status === 'approved' || q.status === 'held');
    return `
      <section class="block" aria-label="Run stages">
        <ol class="stages">${STAGES.map((s, i) => {
          const st = i < now ? 'done' : i === now ? 'now' : 'wait';
          return `<li class="stg is-${st}"><i class="stg__fill ${st === 'done' ? 'dz-100' : st === 'now' ? 'dz-50' : ''}" aria-hidden="true"></i>
            <span class="label">stage 0${i + 1}</span><div><h3 class="display">${s}</h3><span class="label">${st === 'done' ? 'done' : st === 'now' ? (n ? 'waiting on you' : 'running') + '<span class="blink">_</span>' : 'not started'}</span></div></li>`;
        }).join('')}</ol>
      </section>
      <p class="run-line">${line}</p>
      <div class="two">
        <section class="block"><div class="head"><h2 class="display">Needs you</h2><span class="label">${needs.length}</span></div>
          ${needs.length ? `<ul class="rows needs">${needs.map((x) => `<li><div><b>${x[0]}</b><span class="muted">${x[1]}</span></div><a class="btn ${x[3] === 'fix it' || x[3] === 'open queue' ? '' : 'btn--ghost'}" href="${x[2]}" ${x[4] ? `data-act="pick" data-id="${x[4]}"` : ''}>${x[3]}</a></li>`).join('')}</ul>` : '<p class="muted" style="padding:16px 2px">Nothing. Go build.</p>'}
        </section>
        <section class="block"><div class="head"><h2 class="display">Run log</h2><span class="label">today</span></div>
          <ol class="log">${S.log.map((l) => `<li><span>${l[0]}</span><span>${esc(l[1])}</span></li>`).join('')}<li class="is-now"><span>now</span><span>${n ? `waiting on you: ${n} item${n > 1 ? 's' : ''}` : 'analyzing results'}<span class="blink">_</span></span></li></ol>
        </section>
      </div>
      <section class="block"><div class="head"><h2 class="display">Going out next</h2><span class="label">${upcoming.length}</span></div>
        ${upcoming.length ? `<ul class="rows next">${upcoming.map((q) => `<li><span class="label">${CH[q.ch]}</span><span>${esc(q.title)}</span><span class="label muted">${esc(q.when)}</span>${q.status === 'held' ? `<span class="tag label held-reason">held: ${esc(holdReason(q))}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted" style="padding:16px 2px">Nothing approved yet.</p>'}
      </section>`;
  };

  view.queue = () => {
    if (empty()) return emptyState('idle_stand', 'Nothing drafted', 'Coldie starts writing once a run begins. Drafts land here and wait for your yes.', '<a class="btn btn--ghost" href="#/run">go to run</a>');
    const u = S.ui;
    const list = S.queue.filter((q) => (u.chan === 'all' || q.ch === u.chan) && (u.show === 'all' || (u.show === 'needs' ? (q.status === 'draft' || q.status === 'bounced') : (q.status !== 'draft' && q.status !== 'bounced'))));
    let sel = list.find((q) => q.id === u.sel) || list[0];
    if (sel) u.sel = sel.id;
    else u.open = false;
    const fbtn = (key, val, text) => `<button type="button" data-act="filter" data-key="${key}" data-val="${val}" aria-pressed="${String(u[key] === val)}">${text}</button>`;
    const insp = !sel ? '' : (() => {
      const q = sel, open = q.status === 'draft' || q.status === 'bounced';
      const meta = Object.entries(q.meta || {}).map(([k, v]) => `<dt class="label">${k}</dt><dd>${esc(v)}</dd>`).join('');
      const held = holdReason(q);
      return `
        <div class="insp__top"><button class="btn btn--ghost back" type="button" data-act="back">← list</button>
          <span class="tag tag--solid label">${CH[q.ch]}</span><span class="tag label">${q.type}</span>${statusTag(q)}<span class="label muted" style="margin-left:auto">${esc(q.when)}</span></div>
        <h2>${esc(q.title)}</h2>
        ${q.note && q.status === 'bounced' ? `<p class="note">${esc(q.note)}</p>` : ''}
        ${held && (open || q.status === 'held') ? `<p class="note note--hold">${esc(held)}. This item is held until the channel is connected and on.</p>` : ''}
        <div class="field"><label class="label" for="draft">${q.type === 'article' ? 'outline' : 'text'}</label>
          <textarea id="draft" data-id="${q.id}" ${open ? '' : 'readonly'}>${esc(q.body)}</textarea></div>
        ${meta ? `<dl class="meta">${meta}</dl>` : ''}
        ${open ? `<div class="acts">
            <button class="btn" type="button" data-act="approve" data-id="${q.id}">${q.status === 'bounced' ? 'Send again' : 'Approve'} <kbd>a</kbd></button>
            <button class="btn btn--ghost" type="button" data-act="rewrite" data-id="${q.id}" ${q.alt ? '' : 'disabled'}>Rewrite <kbd>r</kbd></button>
            <button class="btn btn--danger" type="button" data-act="drop" data-id="${q.id}">Drop <kbd>x</kbd></button>
          </div><p class="label hint">j / k to move · edits save as you type</p>`
        : `<div class="acts"><button class="btn btn--ghost" type="button" data-act="undo" data-id="${q.id}" ${q.status === 'sent' ? 'disabled' : ''}>Back to drafts</button></div>`}`;
    })();
    return `
      <div class="queue ${u.open ? 'is-open' : ''}">
        <div class="queue__list">
          <div class="filters">
            <div class="seg label" role="group" aria-label="Show">${fbtn('show', 'needs', `needs you ${needsYou().length}`)}${fbtn('show', 'done', 'decided')}${fbtn('show', 'all', 'all')}</div>
            <div class="seg label" role="group" aria-label="Channel">${fbtn('chan', 'all', 'all')}${['ig', 'reddit', 'x', 'web'].map((c) => fbtn('chan', c, CH[c])).join('')}</div>
          </div>
          ${list.length ? `<ul class="q" id="qlist">${list.map((q) => `<li><button type="button" data-act="select" data-id="${q.id}" aria-selected="${String(sel && q.id === sel.id)}">
              <span class="label">${CH[q.ch]}</span><span class="t">${esc(q.title)}</span><span class="s">${statusTag(q)}</span><span class="w label">${esc(q.when)}</span></button></li>`).join('')}</ul>`
          : `<div style="padding-top:22px">${u.show === 'needs' ? emptyState('idle_stand', 'No matching drafts', 'Nothing needs review in this filter. Try another channel or view decided items. This prototype never publishes.') : '<p class="muted">Nothing matches these filters.</p>'}</div>`}
        </div>
        ${sel ? `<aside class="insp" aria-label="Selected draft">${insp}</aside>` : ''}
      </div>`;
  };

  view.channels = () => {
    const E = empty();
    return `
      <p class="run-line">Each channel is one of Coldie's jobs. Turn a channel off and nothing goes out there, even if it is approved.</p>
      <section class="block"><div class="head"><h2 class="display">Channels</h2><span class="label">${channels().filter((c) => c.connected).length} of ${channels().length} simulated</span></div>
        <ul class="rows chan">${channels().map((c) => {
          const con = c.connected;
          const ctl = c.id === 'ig' ? `<label class="label" for="cap">daily cap $</label><input class="inp mono" id="cap" type="number" min="1" max="500" value="${c.cap}" data-act-change="cap" style="width:74px" ${con ? '' : 'disabled'}>`
            : c.per ? `<label class="label" for="per-${c.id}">per week</label><select id="per-${c.id}" class="mono" data-act-change="per" data-id="${c.id}" ${con ? '' : 'disabled'}>${[1, 2, 3, 5, 7].map((n) => `<option ${n === c.per ? 'selected' : ''}>${n}</option>`).join('')}</select>` : '';
          return `<li><div><b>${c.name}</b><br><span class="label muted">${c.kind}</span></div><p class="muted">${c.does}</p>
            <div>${con ? '<span class="tag tag--solid label">connected</span>' : '<span class="tag label">not connected</span>'}</div>
            <div class="ctl">${ctl}${con ? `<button class="switch" type="button" role="switch" aria-checked="${String(c.on)}" aria-label="${c.name} on" data-act="toggle" data-id="${c.id}"></button>` : `<button class="btn" type="button" data-act="connect" data-id="${c.id}">Connect</button>`}</div></li>`;
        }).join('')}</ul>
      </section>
      <p class="label muted">Connecting is simulated here. In the real app each button opens that platform's sign-in.</p>`;
  };

  view.pixel = () => {
    const E = empty(), p = pixel(), seen = p.events.filter((e) => e[1]).length;
    return `
      <p class="run-line">The pixel goes in first. Without it Coldie cannot tell which channel brought anyone.</p>
      <ol class="steps3">
        <li class="pstep ${p.site ? 'is-done' : ''}"><span class="n label">1</span><div><h2 class="display">Your site</h2>
          <div class="pstep__body"><div class="inline"><input class="inp mono" id="site" aria-label="Site address" placeholder="yourapp.com" value="${esc(p.site)}"><button class="btn btn--ghost" type="button" data-act="savesite">Save</button></div></div></div></li>
        <li class="pstep ${E ? '' : 'is-done'}"><span class="n label">2</span><div><h2 class="display">Install</h2>
          <div class="pstep__body"><p>Illustrative snippet only — not a working installation. No pixel is installed or verified by this prototype.</p>
            <pre class="code" id="snippet">&lt;!-- Meta Pixel --&gt;
&lt;script&gt;
  /* Meta's loader goes here; Coldstart fills in your ID */
  fbq('init', 'YOUR_PIXEL_ID');
  fbq('track', 'PageView');
&lt;/script&gt;</pre>
            <div class="inline"><button class="btn btn--ghost" type="button" data-act="copy">Copy snippet</button></div></div></div></li>
        <li class="pstep ${seen === p.events.length && !E ? 'is-done' : ''}"><span class="n label">3</span><div><h2 class="display">Check it fires</h2>
          <div class="pstep__body">
            <ul class="rows events">${p.events.map((e) => `<li><span class="mono">${e[0]}</span>${!E && e[1] ? '<span class="tag tag--solid label">seen</span>' : '<span class="tag label">not seen yet</span>'}</li>`).join('')}</ul>
            <div class="inline"><button class="btn" type="button" data-act="verify" ${p.site ? '' : 'disabled'}>Preview check</button><span class="label muted" id="verifyMsg" style="align-self:center">${E ? p.site ? 'site saved · no live tracking' : 'add your site first' : `${seen} of ${p.events.length} sample events seen`}</span></div>
          </div></div></li>
      </ol>`;
  };

  view.competitors = () => {
    if (empty()) return emptyState('idle_stand', 'No scan yet', 'Once your site and brand line are in, Coldie looks at who is already in your space and where they are active.', '<a class="btn btn--ghost" href="#/brand">set brand</a>');
    return `
      <p class="run-line">Who is already here, where they show up, and the gap Coldie writes into.</p>
      <section class="block"><div class="head"><h2 class="display">Scan</h2><button class="btn btn--ghost" type="button" data-act="rescan">Scan again</button></div>
        <ul class="rows comp">${S.competitors.map((c) => `<li><div><b>${esc(c.name)}</b><br><span class="muted">${esc(c.what)}</span></div>
          <div><span class="label muted">active on</span><div class="tags">${c.on.map((o) => `<span class="tag label">${esc(o)}</span>`).join('')}</div></div>
          <div><span class="label muted">gap</span><p>${esc(c.gap)}</p></div></li>`).join('')}</ul>
      </section>`;
  };

  view.results = () => {
    if (empty()) return emptyState('idle_stand', 'No traffic yet', 'This local workspace does not collect traffic. Load the sample run to explore example results.', '<a class="btn btn--ghost" href="#/run">go to run</a>');
    const rows = S.results.map((r) => ({ ...r, total: r.days.reduce((a, b) => a + b, 0) }));
    const max = Math.max(...rows.map((r) => r.total), 1), dmax = Math.max(...rows.flatMap((r) => r.days), 1);
    const dz = (v) => { const f = v / dmax; return f === 0 ? '' : f < .3 ? 'dz-25' : f < .55 ? 'dz-50' : f < .8 ? 'dz-75' : 'dz-100'; };
    const sugg = [
      ['The monstera ad brings most of the visits.', 'Make two variations and split the budget.', 'add', 'Add drafts'],
      ['Reddit shows zero because it is not connected.', 'One post is written and waiting.', '#/channels', 'Connect'],
      ['No Purchase event has fired.', 'Sign-ups are counted, sales are not.', '#/pixel', 'Check pixel'],
    ];
    return `
      <p class="run-line">${rows.reduce((a, r) => a + r.total, 0)} example visits and ${rows.reduce((a, r) => a + r.leads, 0)} example sign-ups. Fixed sample data, not live pixel results.</p>
      <section class="block"><div class="head"><h2 class="display">Visits by source</h2><span class="label">last 7 days</span></div>
        <ul class="rows res">
          <li class="th label"><span>source</span><span class="num">visits</span><span class="c-chart"></span><span class="c-chart">by day</span><span class="num">sign-ups</span><span class="num c-cost">spend</span></li>
          ${rows.map((r) => `<li><span>${r.src}${r.off ? ' <span class="tag label">not connected</span>' : ''}</span><span class="num">${r.total}</span>
            <span class="bar" aria-hidden="true"><i style="--w:${Math.round(r.total / max * 88)}%"></i></span>
            <span class="heat" aria-hidden="true">${r.days.map((d) => `<i class="${dz(d)}"></i>`).join('')}</span>
            <span class="num">${r.leads}</span><span class="num c-cost">${r.cost || '—'}</span></li>`).join('')}
        </ul>
      </section>
      <section class="block"><div class="head"><h2 class="display">What to run next</h2><span class="label">${sugg.length}</span></div>
        <ul class="rows sugg">${sugg.map((s) => `<li><div><b>${s[0]}</b><br><span class="muted">${s[1]}</span></div>${s[2] === 'add' ? `<button class="btn" type="button" data-act="variations">${s[3]}</button>` : `<a class="btn btn--ghost" href="${s[2]}">${s[3]}</a>`}</li>`).join('')}</ul>
      </section>`;
  };

  const SAMPLE = [
    ['Fernbook reminds you to water your plants. It adjusts to how dry your flat is.', 'Your fern has opinions about your radiator. Fernbook listens so you don\'t have to.'],
    ['Stop guessing when to water. Fernbook tells you, plant by plant.', 'YOUR CALATHEA IS BEING DRAMATIC AGAIN. Fernbook saw it coming.'],
  ];
  const samplePost = () => SAMPLE[brand().loud > 50 ? 1 : 0][brand().playful > 50 ? 1 : 0];
  view.brand = () => {
    const b = brand(), E = empty();
    const val = (k) => esc(b[k]);
    return `
      <div class="brand">
        <form id="brandForm">
          <div class="field"><label class="label" for="b-name">name</label><input id="b-name" name="name" value="${val('name')}" placeholder="Your app"></div>
          <div class="field"><label class="label" for="b-url">site</label><input id="b-url" name="url" class="mono" value="${val('url')}" placeholder="yourapp.com"></div>
          <div class="field"><label class="label" for="b-line">one line: what is it?</label><input id="b-line" name="line" value="${val('line')}" placeholder="What it does, for whom"></div>
          <div class="field"><label class="label" for="b-loud">volume</label><input id="b-loud" name="loud" type="range" min="0" max="100" value="${b.loud}"><div class="ends label"><span>quiet</span><span>loud</span></div></div>
          <div class="field"><label class="label" for="b-playful">register</label><input id="b-playful" name="playful" type="range" min="0" max="100" value="${b.playful}"><div class="ends label"><span>plain</span><span>playful</span></div></div>
          <div class="field"><label class="label" for="b-use">lean on</label><input id="b-use" name="use" value="${val('use')}" placeholder="comma separated"></div>
          <div class="field"><label class="label" for="b-avoid">never say</label><input id="b-avoid" name="avoid" value="${val('avoid')}" placeholder="comma separated"></div>
          <div><button class="btn" type="submit">Save brand</button></div>
        </form>
        <aside class="preview" aria-live="polite"><span class="label muted">how coldie would say it</span>
          <blockquote id="samplePost">${esc(samplePost())}</blockquote>
          <span class="label muted">Fernbook example only: four fixed variants, picked by the sliders. Not generated from your brand.</span></aside>
      </div>`;
  };

  /* ---------------------------------------------------------------- shell */
  let coldieClip = '';
  function shell() {
    const r = route(), E = empty(), n = E ? 0 : needsYou().length;
    const links = VIEWS.map(([id, name]) => `<a href="#/${id}" ${id === r ? 'aria-current="page"' : ''}>${name}${id === 'queue' ? `<span class="count">${n || ''}</span>` : ''}</a>`).join('');
    $('#nav').innerHTML = links;
    $('#tabs').innerHTML = links;
    $('#ws').innerHTML = `<b>${esc(brand().name || 'New workspace')}</b><span class="label">${E ? 'local setup only' : esc(S.brand.url)}</span>`;
    $('#dataLabel').textContent = E ? 'local setup' : 'sample data';
    $('#crumb').textContent = `${E ? 'new workspace' : S.brand.name} / ${r}`;
    $('#title').textContent = VIEWS.find((v) => v[0] === r)[1];
    const chip = $('#runChip');
    chip.className = 'chip label' + (n ? ' is-wait' : '');
    chip.innerHTML = E ? '<i></i>not started' : `<i></i>stage 0${stageNow() + 1} · ${n ? 'waiting on you' : 'running'}`;
    $$('[data-act="mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));

    const mood = E ? ['idle_stand', 'waiting', 'Give me an app to shout about.']
      : bounced().length ? ['', 'needs attention', 'A sample ad needs a review. Open the queue to edit it.']
      : n ? ['loading_screen', 'waiting on you', `${n} draft${n > 1 ? 's' : ''} ready when you are.`]
      : ['cool_shades', 'all clear', 'Everything approved. Watching the numbers.'];
    $('#coldieState').textContent = mood[1];
    $('#coldieLine').textContent = mood[2];
    $('#coldieDuo').hidden = !mood[0];
    if (!mood[0]) { $('#coldieDuo video').pause(); coldieClip = ''; return; }
    if (mood[0] !== coldieClip) {
      coldieClip = mood[0];
      const v = $('#coldieDuo video');
      v.poster = clip(mood[0]) + '.poster.webp';
      v.src = clip(mood[0]) + '.webm';
      if (!REDUCE) v.play().catch(() => {});
    }
  }

  function render(focus) {
    reconcileQueue();
    const r = route();
    shell();
    const el = $('#view');
    el.innerHTML = view[r]();
    if (window.Dither) { Dither.videos(el); Dither.videos($('.rail')); }
    if (!REDUCE) $$('video', el).forEach((v) => v.play().catch(() => {}));
    if (focus === 'row') { const b = $('.q button[aria-selected="true"]'); if (b) b.focus(); }
    save();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200);
  }

  /* ---------------------------------------------------------------- actions */
  const item = (id) => S.queue.find((q) => q.id === id);
  const nextOpen = (after) => { const open = needsYou(); return (open.find((q) => q.id > after) || open[0] || {}).id; };
  const act = {
    mode(el) { S.mode = el.dataset.mode; render(); },
    reset() { S = structuredClone(SEED); coldieClip = ''; render(); toast('demo reset'); },
    pick(el) { S.ui.sel = el.dataset.id; S.ui.show = 'needs'; S.ui.chan = 'all'; S.ui.open = true; save(); },
    select(el) { S.ui.sel = el.dataset.id; S.ui.open = true; render('row'); },
    back() { S.ui.open = false; render(); },
    filter(el) { S.ui[el.dataset.key] = el.dataset.val; S.ui.open = false; render(); },
    approve(el, kb) {
      const q = item(el.dataset.id); if (!q) return;
      q.status = holdReason(q) ? 'held' : 'approved';
      S.log.push(['now', `you approved: ${q.title.toLowerCase().slice(0, 40)}`]);
      toast(q.status === 'held' ? `held · ${holdReason(q)}` : `approved in sample · ${q.when.replace('was live 09:40', 'after review')}`);
      S.ui.sel = nextOpen(q.id) || q.id; render(kb && 'row');
    },
    drop(el, kb) { const q = item(el.dataset.id); if (!q) return; q.status = 'rejected'; toast('dropped'); S.ui.sel = nextOpen(q.id) || q.id; render(kb && 'row'); },
    undo(el) { const q = item(el.dataset.id); if (!q) return; q.status = 'draft'; S.ui.show = 'needs'; render(); },
    rewrite(el) {
      const q = item(el.dataset.id); if (!q || !q.alt) return;
      el.disabled = true; el.textContent = 'Rewriting…';
      setTimeout(() => { [q.body, q.alt] = [q.alt, q.body]; render(); toast('rewritten · sample has two versions'); }, REDUCE ? 0 : 700);
    },
    toggle(el) { const c = chan(el.dataset.id); c.on = !c.on; render(); toast(`${c.name} ${c.on ? 'on' : 'off'}`); },
    connect(el) {
      const c = chan(el.dataset.id); c.connected = true; c.on = true;
      if (empty()) { render(); return toast(`${c.name} selected locally · simulated`); }
      S.queue.forEach((q) => { if (q.ch === c.id && q.status === 'held') q.status = 'approved'; });
      const row = S.results.find((r) => r.src === c.name); if (row) row.off = false;
      S.log.push(['now', `${c.name.toLowerCase()} connected`]); render(); toast(`${c.name} connected (simulated)`);
    },
    savesite() { const v = $('#site').value.trim(); if (!v) return toast('add an address first'); pixel().site = v; brand().url = v; render(); toast('site saved locally'); },
    copy() {
      const text = $('#snippet').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('snippet copied'), () => toast('copy failed · select it by hand'));
    },
    verify(el) {
      el.disabled = true; $('#verifyMsg').innerHTML = 'checking<span class="blink">_</span>';
      setTimeout(() => { render(); toast('sample only · no live tracking check performed'); }, REDUCE ? 0 : 1200);
    },
    rescan(el) { el.disabled = true; el.innerHTML = 'scanning<span class="blink">_</span>'; setTimeout(() => { render(); toast('scan done · nothing new'); }, REDUCE ? 0 : 1400); },
    variations() {
      if (item('q8')) return toast('already in the queue');
      S.queue.splice(2, 0,
        { id: 'q8', ch: 'ig', type: 'ad', status: 'draft', when: 'tomorrow 18:00', title: 'Your monstera is thirsty (variation: winter)', body: 'Heating on? Your monstera is drying out faster than you think. Fernbook notices and tells you.', alt: '', meta: { audience: 'People who follow plant-care accounts', budget: '$2.50 a day, 4 days' } },
        { id: 'q9', ch: 'ig', type: 'ad', status: 'draft', when: 'tomorrow 18:00', title: 'Your monstera is thirsty (variation: question)', body: 'When did you last water it? If you had to think, Fernbook is for you.', alt: '', meta: { audience: 'People who follow plant-care accounts', budget: '$2.50 a day, 4 days' } });
      S.log.push(['now', 'drafted 2 ad variations']); render(); toast('2 drafts added to the queue');
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = act[el.dataset.act];
    if (fn) fn(el);
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'draft') { const q = item(t.dataset.id); if (q) { q.body = t.value; save(); } }
    if (t.form && t.form.id === 'brandForm') {
      brand()[t.name] = t.type === 'range' ? +t.value : t.value;
      if (t.name === 'url') pixel().site = t.value.trim();
      if (t.type === 'range') $('#samplePost').textContent = samplePost();
      save();
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target, k = t.dataset.actChange;
    if (k === 'cap') { chan('ig').cap = Math.max(1, +t.value || 1); save(); toast(`instagram capped at $${chan('ig').cap} a day`); }
    if (k === 'per') { chan(t.dataset.id).per = +t.value; save(); toast(`${chan(t.dataset.id).name}: ${t.value} a week`); }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'brandForm') return;
    e.preventDefault();
    shell(); save(); toast('brand saved locally');
  });
  // queue keys: j/k move, a approve, r rewrite, x drop
  document.addEventListener('keydown', (e) => {
    if (route() !== 'queue' || empty() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const rows = $$('.q button'), i = rows.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const k = e.key.toLowerCase();
    if ((k === 'j' || k === 'arrowdown') && rows[i + 1]) { e.preventDefault(); S.ui.sel = rows[i + 1].dataset.id; render('row'); }
    else if ((k === 'k' || k === 'arrowup') && rows[i - 1]) { e.preventDefault(); S.ui.sel = rows[i - 1].dataset.id; render('row'); }
    else if (k === 'a' || k === 'x' || k === 'r') {
      const b = $(`.insp [data-act="${{ a: 'approve', x: 'drop', r: 'rewrite' }[k]}"]`);
      if (b && !b.disabled) { e.preventDefault(); act[b.dataset.act](b, true); }
    }
  });
  addEventListener('hashchange', () => { if (route() !== 'queue') S.ui.open = false; render(); $('#view').focus({ preventScroll: true }); scrollTo(0, 0); });

  render();
})();
