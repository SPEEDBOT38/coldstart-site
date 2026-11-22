/* Coldstart Onboarding v3 Engine
   - 8 Quests: What you sell, Who buys, Link up, The Scan (with MetaCroc runner), Product shelf, ICPs, Brand book, Level up
   - Mobile-first down to 360px, accessible, reduced-motion friendly
   - Real API call to /api/plugins/onboard/actions/scan with 94% progress cap until response
   - Labelled simulation fallback with clear honest disclosure
   - Writes coldstart.handoff.v1 for app-v3.html#/tracking?from=onboarding handoff
   - Explicit honesty: Instagram profile reading is marked as not implemented/unavailable */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

  /* ---------------- seeded randomness ---------------- */
  const hash = (str) => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const shuffle = (arr, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const hsl = (h, s, l) => { h = ((h % 360) + 360) % 360; s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase(); };

  /* ---------------- category fixtures ---------------- */
  const CATS = {
    fashion: { label: 'Fashion & Apparel', hue: [14, 44], price: [499, 3999], fonts: ['Fraunces', 'Inter', 'serif', 'sans'], tones: ['Confident', 'Relaxed', 'Precise'],
      products: ['Everyday Heavyweight Tee', 'Relaxed Linen Overshirt', 'Drop-Shoulder Hoodie', 'Straight-Leg Chino', 'Sunday Lounge Shorts', 'Canvas Utility Tote', 'Merino Beanie', 'Classic Ribbed Tank'],
      rivals: ['Snitch', 'The Souled Store', 'Bombay Shirt Company'],
      icps: [
        { n: 'The Capsule Builder', who: '24–35, city dweller, buys fewer pieces that last', pain: 'Fast fashion fades after three washes and loses its collar shape', scroll: ['Instagram Reels', 'Reddit'], hook: 'Ten pieces. One wardrobe. Zero regret.', fmt: 'Reels + Carousel' },
        { n: 'The Weekend Host', who: '26–42, prioritizes premium natural fabrics', pain: 'Synthetics that trap sweat in tropical humidity', scroll: ['Instagram Stories', 'Pinterest'], hook: '100% breathable cotton. Built for warm evenings.', fmt: 'Stories + Catalog' },
        { n: 'The Minimalist Gifter', who: '22–38, buys quality apparel gifts for friends', pain: 'Guessing sizes and painful return policies', scroll: ['Instagram Reels', 'TikTok'], hook: 'The fit they’ll actually keep.', fmt: 'Reels + UGC' }] },
    beauty: { label: 'Beauty & Skincare', hue: [320, 365], price: [399, 1899], fonts: ['DM Serif Display', 'DM Sans', 'serif', 'sans'], tones: ['Warm', 'Precise', 'Playful'],
      products: ['Ceramide Barrier Cream', '10% Niacinamide Serum', 'Gentle Gel Cleanser', 'Daily Dew Mineral SPF 50', 'Overnight Peptide Lip Mask', 'Centella Soothing Toner'],
      rivals: ['Minimalist', 'Foxtale', 'Dot & Key'],
      icps: [
        { n: 'The Ingredient Reader', who: '22–34, checks actives before the checkout total', pain: 'Over-fragranced brands that break out sensitive skin', scroll: ['Instagram Reels', 'Reddit'], hook: 'Clean actives. Zero hidden fillers.', fmt: 'Reels + UGC' },
        { n: 'The 3-Step Routine Seeker', who: '26–40, working professional', pain: 'Complicated 10-step shelf clutter she never finishes', scroll: ['Instagram Stories', 'YouTube'], hook: 'Cleanse, hydrate, protect. Done by 8:15am.', fmt: 'Stories + Carousel' },
        { n: 'The Barrier First Buyer', who: '20–35, recovering from harsh peels', pain: 'Burning skin that reacts to every new launch', scroll: ['Reddit', 'TikTok'], hook: 'Formulated to calm, not tingle.', fmt: 'Carousel + Reviews' }] },
    food: { label: 'Food & Gourmet Beverages', hue: [6, 40], price: [249, 1499], fonts: ['Bricolage Grotesque', 'Inter', 'sans', 'sans'], tones: ['Warm', 'Playful', 'Confident'],
      products: ['Cold Brew Starter Kit', 'Single-Origin Arabica Beans', 'Small-Batch Hot Honey', 'Zero-Sugar Tonic 6-Pack', 'Stone-Ground Peanut Butter', 'Chili Crunch Oil'],
      rivals: ['Blue Tokai', 'Sleepy Owl', 'Naagin'],
      icps: [
        { n: 'The Morning Ritualist', who: '25–40, brews their own coffee before opening Slack', pain: 'Stale grocery-store beans with no roast date', scroll: ['Instagram Reels', 'YouTube'], hook: 'Roasted this week. Not three months ago.', fmt: 'Reels + Carousel' },
        { n: 'The Desk Snacker', who: '23–35, eats at their laptop', pain: 'Sugar crashes at 3pm from vending-machine junk', scroll: ['TikTok', 'Instagram Stories'], hook: 'Real ingredients you can pronounce. Zero slump.', fmt: 'Stories + Catalog' },
        { n: 'The Dinner Party Host', who: '28–45, loves elevating weeknight tables', pain: 'Bland condiments that taste industrial', scroll: ['Instagram Reels', 'Pinterest'], hook: 'One spoonful changes the whole meal.', fmt: 'Reels + UGC' }] },
    home: { label: 'Home & Living', hue: [24, 62], price: [599, 4999], fonts: ['Playfair Display', 'Work Sans', 'serif', 'sans'], tones: ['Warm', 'Minimal', 'Precise'],
      products: ['Hand-Poured Soy Candle', 'Waffle Cotton Bed Throw', 'Ceramic Pour-Over Mug', 'Ribbed Glass Vase', 'Solid Wood Desk Tray', 'Linen Cushion Cover Pair'],
      rivals: ['Nestera', 'Freedom Tree', 'Ellementry'],
      icps: [
        { n: 'The Rental Space Nester', who: '24–36, making an apartment feel permanent', pain: 'Cookie-cutter furniture that looks cheap in photos', scroll: ['Pinterest', 'Instagram Reels'], hook: 'Make the rental feel like yours.', fmt: 'Reels + Carousel' },
        { n: 'The WFH Desk Builder', who: '26–42, works 8 hours at home', pain: 'Cluttered cable chaos and uncomfortable desk setups', scroll: ['Reddit', 'YouTube'], hook: 'A calmer desk. A clearer workday.', fmt: 'Reels + UGC' },
        { n: 'The Housewarming Planner', who: '28–50, shops memorable gifts', pain: 'Generic gift boxes that end up re-gifted', scroll: ['Instagram Stories', 'Pinterest'], hook: 'The gift that stays on display.', fmt: 'Stories + Catalog' }] },
    fitness: { label: 'Fitness & Wellness', hue: [150, 200], price: [499, 2999], fonts: ['Space Grotesk', 'Inter', 'sans', 'sans'], tones: ['Confident', 'Precise', 'Playful'],
      products: ['Grass-Fed Whey Protein', 'Electrolyte Hydration Sticks', 'High-Density Foam Roller', 'Non-Slip Grip Training Mat', 'Sleep Magnesium Drops', 'Shaker Bottle'],
      rivals: ['The Whole Truth', 'Cosmix', 'Fast&Up'],
      icps: [
        { n: 'The Clean Fuel Seeker', who: '22–38, tracks their nutrition', pain: 'Chalky powders hidden behind artificial sweetener blends', scroll: ['Instagram Reels', 'YouTube'], hook: '100% label honesty. Zero secret gums.', fmt: 'Reels + UGC' },
        { n: 'The Early Morning Runner', who: '25–45, logs miles before sunrise', pain: 'Cramping and fatigue midway through tempo runs', scroll: ['Strava', 'Instagram Stories'], hook: 'Electrolytes that taste like real citrus.', fmt: 'Stories + Carousel' },
        { n: 'The Restarting Athlete', who: '28–42, building back consistency', pain: 'Overwhelming bro-science that burns motivation', scroll: ['Reddit', 'Instagram Reels'], hook: 'Simple routines that stick. Start today.', fmt: 'Reels + Reviews' }] },
    tech: { label: 'Consumer Tech & Gear', hue: [214, 262], price: [699, 4499], fonts: ['Space Grotesk', 'IBM Plex Sans', 'sans', 'sans'], tones: ['Precise', 'Minimal', 'Confident'],
      products: ['Magnetic Vegan Leather Case', 'Braided 100W USB-C Cable', 'Felt Desk Mat (Large)', '65W GaN Fast Charger', 'Waterproof Laptop Sleeve', 'Cable Organizer Duo'],
      rivals: ['DailyObjects', 'Spigen', 'Stuffcool'],
      icps: [
        { n: 'The Desk Aesthetician', who: '22–36, posts setups on Reddit & X', pain: 'Mismatched plasticky gear that ruins a clean desk', scroll: ['Reddit', 'X', 'YouTube'], hook: 'The clean desk upgrade your setup is missing.', fmt: 'Reels + UGC' },
        { n: 'The Frequent Commuter', who: '26–42, works between cafes and client offices', pain: 'Heavy brick chargers that fray in the backpack', scroll: ['X', 'Instagram Stories'], hook: 'Half the size. Charges everything.', fmt: 'Stories + Carousel' },
        { n: 'The Build-Quality Skeptic', who: '24–40, checks teardowns first', pain: 'Cheap accessories that stop charging after 30 days', scroll: ['Reddit', 'YouTube'], hook: 'Reinforced stress joints. Tested for 10,000 bends.', fmt: 'Carousel + Reviews' }] },
    other: { label: 'Something Else', hue: [0, 360], price: [399, 2999], fonts: ['Space Grotesk', 'Inter', 'sans', 'sans'], tones: ['Confident', 'Warm', 'Precise'],
      products: ['Signature Starter Set', 'Essential Daily Pack', 'Deluxe Edition', 'Travel Companion Kit', 'Refill Bundle'],
      rivals: ['A fast-growing direct competitor', 'The established legacy brand', 'The trending newcomer'],
      icps: [
        { n: 'The Early Adopter', who: '24–38, loves discovering new brands', pain: 'Generic options with zero brand identity', scroll: ['Instagram Reels', 'Reddit'], hook: 'Be the first to find it.', fmt: 'Reels + UGC' },
        { n: 'The Careful Shopper', who: '28–48, reads customer feedback first', pain: 'Not knowing if a day-zero brand will actually ship', scroll: ['Instagram Stories', 'Reddit'], hook: 'Made with care. Shipped with tracking.', fmt: 'Stories + Reviews' },
        { n: 'The Curated Gifter', who: '25–45, shops for friends', pain: 'Gifts that feel impersonal or mass-produced', scroll: ['Instagram Stories', 'Pinterest'], hook: 'The gift they remember.', fmt: 'Stories + Catalog' }] }
  };
  const CAT_KEYS = Object.keys(CATS);
  const REV = [
    { k: 'pre', t: 'Pre-revenue', s: 'Not selling yet · Day Zero' },
    { k: 'lt10', t: 'Under ₹5L / $10K', s: 'per month' },
    { k: '10-50', t: '₹5L–25L / $10–50K', s: 'per month' },
    { k: '50-250', t: '₹25L–1Cr / $50–250K', s: 'per month' },
    { k: '250+', t: '₹1Cr+ / $250K+', s: 'per month' }
  ];
  const TONES = {
    Confident: 'Made right. Priced fairly.',
    Relaxed: 'No rush. No pressure.',
    Precise: 'Every detail accounted for.',
    Playful: 'Yes, it is really that good.',
    Warm: 'Made with care, shipped fast.',
    Minimal: 'Simple. Honest. Good.'
  };
  const LEVELS = [
    { at: 0, n: 'Cold Start' },
    { at: 120, n: 'Warming Up' },
    { at: 320, n: 'Getting Traffic' },
    { at: 520, n: 'Pixel Perfect' }
  ];
  const QUESTS = [
    ['what', 'What you sell'],
    ['who', 'Who buys'],
    ['link', 'Link up'],
    ['scan', 'The scan'],
    ['shelf', 'Product shelf'],
    ['icp', 'Your ICPs'],
    ['brand', 'Brand book'],
    ['level', 'Level up']
  ];
  const STEPS = ['intro', ...QUESTS.map((q) => q[0])];
  const CLIPS = {
    intro: 'wave', what: 'idle_stand', who: 'idle_stand', link: 'web_post',
    scan: 'run_loop', shelf: 'ig_ad', icp: 'competitor_scan', brand: 'ig_ad', level: 'celebrate'
  };

  /* ---------------- state engine & persistence ---------------- */
  const KEY = 'coldstart.onboarding.v1';
  const fresh = () => ({
    step: 0, max: 0, xp: 0, got: {},
    product: '', cat: '', icpMode: 'help', icpText: '', rivals: [], noRivals: false,
    rev: '', site: '', ig: '', noSite: false, noIG: false,
    scanDone: false, scanScore: 0, scanInfo: null, products: [], icps: [], picks: [],
    brand: null, brandLocked: false, email: '', emailDone: false,
    real: false, realBrand: null, scanError: '', sources: null, handedOff: false
  });
  let S;
  try { S = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || 'null') || {}); } catch { S = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

  /* ---------------- backend API detection ---------------- */
  let apiOk = null;
  fetch('/api/health', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { apiOk = !!(j && j.ok && j.plugins && j.plugins.onboard === 'live'); })
    .catch(() => { apiOk = false; })
    .finally(() => {
      hud();
      if (STEPS[S.step] === 'link' || STEPS[S.step] === 'intro') rerender();
    });

  async function api(path, body) {
    const r = await fetch('/api/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-coldstart': '1' },
      body: JSON.stringify(body)
    });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
    return j;
  }

  /* ---------------- input normalizers ---------------- */
  const parseSite = (v) => {
    v = (v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : '';
  };
  const parseIG = (v) => {
    v = (v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
    return /^[a-zA-Z0-9._]{1,30}$/.test(v) ? v : '';
  };
  const brandName = () => {
    if (S.real && S.realBrand && S.realBrand.name) return S.realBrand.name;
    const d = parseSite(S.site);
    if (d) return title(d.split('.')[0].replace(/-/g, ' '));
    const h = parseIG(S.ig);
    if (h) return title(h.replace(/[._]+/g, ' ').trim());
    return S.product ? title(S.product.split(' ')[0]) : 'Your brand';
  };
  const cat = () => CATS[S.cat] || CATS.other;
  const revLabel = () => { const r = REV.find((x) => x.k === S.rev); return r ? (r.k === 'pre' ? 'Pre-revenue' : r.t) : ''; };
  const seedBase = () => parseSite(S.site) + '|' + parseIG(S.ig) + '|' + S.cat + '|' + S.product.trim().toLowerCase();

  /* ---------------- deterministic generators (sample fallback) ---------------- */
  function genProducts() {
    const c = cat(), r = rng(hash(seedBase() + 'p'));
    const n = 8 + Math.floor(r() * 5);
    const names = shuffle(c.products, r).slice(0, n - 1);
    const hero = S.product.trim() ? title(S.product.trim().slice(0, 38)) : names.shift();
    names.unshift(hero);
    const hasSite = !S.noSite && parseSite(S.site);
    return names.slice(0, n).map((name, i) => {
      const price = Math.max(299, Math.round((c.price[0] + r() * (c.price[1] - c.price[0])) / 50) * 50 - 1);
      return { id: 'p' + i, name, price, src: hasSite ? 'site' : 'brief', posts: 0, on: true, hue: Math.floor(r() * 360) };
    });
  }
  function genIcps() {
    const c = cat(), r = rng(hash(seedBase() + 'i'));
    let list = c.icps.map((x, i) => ({
      id: 'i' + i, name: x.n, who: x.who, pain: x.pain, scroll: x.scroll.slice(),
      hook: x.hook, fmt: x.fmt, signals: 8 + Math.floor(r() * 16),
      level: ['Strong', 'Medium', 'Testing'][i], mine: false, evidence: ''
    }));
    if (S.icpMode === 'know' && S.icpText.trim()) {
      list[0] = Object.assign({}, list[0], {
        id: 'i0', name: 'Your Customer', who: S.icpText.trim().slice(0, 120),
        pain: 'Customer pain point you specified in onboarding brief',
        mine: true, level: 'You told us', evidence: 'Direct founder brief'
      });
    }
    return list;
  }
  function genBrand() {
    const c = cat(), rb = S.real && S.realBrand;
    const b = S.brand || (S.brand = { variant: 0, tones: (rb && rb.tones && rb.tones.length ? rb.tones : c.tones).slice(), headline: (rb && rb.headline) || '' });
    if (rb && rb.colors && b.variant === 0) return { colors: rb.colors, names: rb.names, fonts: rb.fonts || c.fonts, fromSite: true };
    const r = rng(hash(seedBase() + 'b' + b.variant));
    const h = c.hue[0] + r() * (c.hue[1] - c.hue[0]);
    const colors = [hsl(h, 68, 38), hsl(h + 32, 54, 58), hsl(h + 180, 84, 58), hsl(h, 48, 12), hsl(h, 30, 96)];
    return { colors, names: ['Primary', 'Support', 'Accent', 'Ink', 'Paper'], fonts: (rb && rb.fonts) || c.fonts, fromSite: false };
  }

  /* ---------------- XP, level, toasts & confetti ---------------- */
  const levelFor = (xp) => { let l = 0; LEVELS.forEach((x, i) => { if (xp >= x.at) l = i; }); return l; };
  function toast(msg, cls = '') {
    const el = document.createElement('p');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  function confetti() {
    if (REDUCE) return;
    const box = $('#confetti'), cols = ['#ECEA36', '#F2F2F2', '#9C9CFF', '#0000F2'];
    for (let i = 0; i < 44; i++) {
      const p = document.createElement('i');
      p.style.left = Math.random() * 100 + '%';
      p.style.background = cols[i % cols.length];
      p.style.animationDelay = Math.random() * 0.4 + 's';
      p.style.width = p.style.height = 6 + Math.floor(Math.random() * 3) * 4 + 'px';
      box.appendChild(p);
      setTimeout(() => p.remove(), 2800);
    }
  }
  function addXP(key, n) {
    if (S.got[key] != null || n <= 0) return;
    const before = levelFor(S.xp);
    S.got[key] = n; S.xp += n; save(); hud();
    toast('+' + n + ' XP');
    const pill = $('#pillXp');
    if (pill) { pill.classList.remove('is-bump'); void pill.offsetWidth; pill.classList.add('is-bump'); }
    const after = levelFor(S.xp);
    if (after > before) {
      setTimeout(() => { toast('Level ' + (after + 1) + ' · ' + LEVELS[after].n, 'toast--lvl'); confetti(); }, 500);
    }
  }

  /* ---------------- HUD & Coldie Dock ---------------- */
  function hud() {
    const l = levelFor(S.xp);
    const xpEl = $('#xpNum'), lvlEl = $('#lvlNum'), nameEl = $('#lvlName');
    if (xpEl) xpEl.textContent = S.xp;
    if (lvlEl) lvlEl.textContent = l + 1;
    if (nameEl) nameEl.textContent = LEVELS[l].n;
    const q = S.step;
    const done = Math.max(0, q - 1) + (S.step === 8 ? 1 : 0);
    const qLabel = $('#hudLabel'), bEl = $('#hudBar');
    if (qLabel) qLabel.textContent = q === 0 ? 'Press start' : 'Quest ' + q + ' of 8 · ' + QUESTS[q - 1][1];
    if (bEl) {
      const barInner = bEl.querySelector('i');
      if (barInner) barInner.style.width = (done / 8 * 100) + '%';
      bEl.setAttribute('aria-valuenow', done);
    }
    const modeBadge = $('#pillMode');
    if (modeBadge) {
      if (apiOk === true) {
        modeBadge.className = 'pill pill--mode-live';
        modeBadge.textContent = '● Live API';
      } else if (apiOk === false) {
        modeBadge.className = 'pill pill--mode-sim';
        modeBadge.textContent = '○ Simulated';
      }
    }
  }
  function rail() {
    const el = $('#rail');
    if (!el) return;
    el.innerHTML = '<ol>' + QUESTS.map((q, i) => {
      const idx = i + 1, cls = idx < S.step ? 'is-done' : idx === S.step ? 'is-now' : '';
      const locked = idx > S.max;
      return `<li><button type="button" class="node ${cls}" data-goto="${idx}" ${locked ? 'disabled' : ''} ${idx === S.step ? 'aria-current="step"' : ''}>
        <span class="node__dot">${idx < S.step ? '✓' : idx}</span>
        <span class="node__txt"><b>${esc(q[1])}</b><span>Quest ${idx}</span></span>
      </button></li>`;
    }).join('') + '</ol>';
  }

  let typeTimer = 0;
  function say(text) {
    const p = $('#bubbleText');
    if (!p) return;
    clearInterval(typeTimer);
    if (REDUCE || text.length < 2) { p.textContent = text; return; }
    p.textContent = '';
    let i = 0;
    typeTimer = setInterval(() => {
      p.textContent = text.slice(0, ++i);
      if (i >= text.length) clearInterval(typeTimer);
    }, 12);
  }
  function setClip(name) {
    const img = $('#coldieImg');
    if (!img) return;
    const src = 'assets/mascot/' + name + '.anim.webp';
    if (!img.src.endsWith(src)) img.src = src;
  }

  const LINES = {
    intro: () => 'Hi, I’m Coldie. Give me four minutes: I’ll scan your store, extract your products, and draft your ICPs and brand book before you spend a rupee.',
    what: () => 'First things first: what do you sell? Keep it honest and clear.',
    who: () => S.icpMode === 'know' ? 'Tell me who your best customer is, in your own words.' : 'No ICP yet? Name 1–3 competitors you look up to and I’ll work backwards from their ads.',
    link: () => 'Point me at your Shopify website. I read real products and colours; Instagram reading is not yet implemented so I won’t guess.',
    scan: () => S.scanDone ? 'Scan complete! Here is what I extracted.' : 'I’m reading your catalogue! Press space or tap to jump duplicate pixels in MetaCroc.',
    shelf: () => 'Found ' + S.products.length + ' products. Untick anything you don’t want to run ads for yet.',
    icp: () => 'Here is who I think buys from you. Pick your main ICP and a backup.',
    brand: () => S.brandLocked ? 'Brand book locked in! Ready for level up.' : 'Here’s your brand book draft. Pick three voice words and lock it in.',
    level: () => 'Level up! Your brand context is ready. Next job: install & verify your Meta Pixel.'
  };

  /* ---------------- stage rendering scaffolding ---------------- */
  const stage = $('#stage');
  let cleanup = null, focusKey = '';
  const head = (n, h, sub, extra = '') => `<header class="panel__head">
    <div class="label"><span>Quest ${n} of 8</span>${extra}</div>
    <h1 class="display" id="h1" tabindex="-1">${h}</h1>
    ${sub ? `<p class="sub">${sub}</p>` : ''}
  </header>`;
  const actions = ({ back = true, next = 'Continue', reward = 0, cls = '' } = {}) => `<div class="actions">
    ${back ? '<button class="btn btn--ghost" type="button" id="back">Back</button>' : '<span></span>'}
    <div class="actions__right">
      ${reward ? `<span class="reward">+${reward} XP</span>` : ''}
      <button class="btn ${cls}" type="button" id="next" disabled>${next}</button>
    </div>
  </div>`;
  const SIMTAG = '<span class="tag tag--sim">Simulated Preview</span>';
  const LIVETAG = '<span class="tag tag--live">Live Scan Verified</span>';
  const tagNow = () => S.real ? LIVETAG : SIMTAG;

  const VALID = {
    intro: () => true,
    what: () => S.product.trim().length >= 3 && !!S.cat,
    who: () => (S.icpMode === 'know' ? S.icpText.trim().length >= 8 : S.rivals.length >= 1 || S.noRivals) && !!S.rev,
    link: () => (S.noSite || !!parseSite(S.site)) && (S.noIG || !!parseIG(S.ig)),
    scan: () => S.scanDone,
    shelf: () => S.products.some((p) => p.on),
    icp: () => S.picks.length >= 1,
    brand: () => true,
    level: () => true
  };
  function refreshNext() { const n = $('#next'); if (n) n.disabled = !VALID[STEPS[S.step]](); }

  function go(i, keep) {
    if (cleanup) { cleanup(); cleanup = null; }
    S.step = clamp(i, 0, STEPS.length - 1); S.max = Math.max(S.max, S.step); save();
    const id = STEPS[S.step];
    stage.classList.toggle('no-anim', !!keep);
    stage.innerHTML = R[id]();
    hud(); rail();
    if (!keep) { setClip(id === 'scan' && S.scanDone ? 'cool_shades' : CLIPS[id]); say(LINES[id]()); }
    const b = $('#back'); if (b) b.addEventListener('click', () => go(S.step - 1));
    const n = $('#next'); if (n) n.addEventListener('click', () => advance());
    if (B[id]) cleanup = B[id]() || null;
    refreshNext();
    if (!keep) {
      const h1 = $('#h1');
      if (h1) { h1.focus({ preventScroll: true }); scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' }); }
    }
    if (focusKey) { const f = $('[data-key="' + focusKey + '"]'); if (f) f.focus({ preventScroll: true }); focusKey = ''; }
  }
  const rerender = (key) => { focusKey = key || ''; go(S.step, true); };
  const AWARD = { what: 50, who: 50, link: 50, shelf: 50, icp: 100, brand: 100 };
  function advance() {
    const id = STEPS[S.step];
    if (!VALID[id]()) return;
    if (AWARD[id]) addXP(id, AWARD[id]);
    if (id === 'link') {
      S.products = genProducts(); S.icps = genIcps();
      S.scanDone = false; S.scanScore = 0; S.real = false; S.realBrand = null;
      S.scanError = ''; S.sources = null; S.picks = []; S.brand = null; S.brandLocked = false;
    }
    go(S.step + 1);
  }

  /* ---------------- Markup generators for steps (R) ---------------- */
  const R = {};

  R.intro = () => `<div class="panel intro">
    <header class="panel__head">
      <div class="label"><span>Coldstart · Early Access Onboarding</span></div>
      <h1 class="display" id="h1" tabindex="-1">Wake Coldie<span class="blink">_</span></h1>
      <p class="sub">Eight quick quests. Tell Coldie what you sell, let it scan your public store catalogue and copy, and leave with your products, ICPs, and a brand book ready for your Meta Pixel.</p>
    </header>
    <div class="teasers">
      <div class="teaser">
        <p class="label">1. Read Store</p>
        <p>Scans Shopify catalogue (photos &amp; prices) and site branding live.</p>
      </div>
      <div class="teaser">
        <p class="label">2. Target ICPs</p>
        <p>Evidence-backed customer archetypes you can edit and pick.</p>
      </div>
      <div class="teaser">
        <p class="label">3. Verify Pixel</p>
        <p>Handoff straight into Tracking to verify CAPI before spending.</p>
      </div>
    </div>
    <div class="actions">
      <span class="hint" style="color:var(--paper)">${apiOk ? 'API online: Coldie reads your store for real.' : 'Preview mode: results use labelled simulation fallback.'}</span>
      <div class="actions__right">
        <span class="reward">Earn XP as you go</span>
        <button class="btn btn--yellow" type="button" id="next">Start Quest 1 →</button>
      </div>
    </div>
  </div>`;

  R.what = () => `<div class="panel">
    ${head(1, 'What do you sell?', 'One clear line is plenty. Coldie uses this to select your category benchmarks.')}
    <div class="field">
      <label for="product">Your core product or line</label>
      <input class="input" id="product" type="text" maxlength="80" autocomplete="off" placeholder="e.g. Ceramide barrier repair cream" value="${esc(S.product)}">
      <p class="err" id="e-product"></p>
    </div>
    <div class="field">
      <span class="lbl" id="catlbl">Closest category</span>
      <div class="chips" role="radiogroup" aria-labelledby="catlbl">
        ${CAT_KEYS.map((k) => `<button type="button" class="chip" role="radio" aria-checked="${S.cat === k}" data-cat="${k}" data-key="cat-${k}">${CATS[k].label}</button>`).join('')}
      </div>
    </div>
    ${actions({ back: true, reward: 50 })}
  </div>`;

  R.who = () => {
    const know = S.icpMode === 'know';
    return `<div class="panel">
      ${head(2, 'Who buys it?', 'If you know your customer persona, tell Coldie directly. Otherwise, name competitor brands you admire and Coldie will extract archetypes.')}
      <div class="seg" role="radiogroup" aria-label="ICP Discovery Mode">
        <button type="button" role="radio" aria-checked="${know}" data-mode="know" data-key="m-know">I know my customer</button>
        <button type="button" role="radio" aria-checked="${!know}" data-mode="help" data-key="m-help">Help me find them</button>
      </div>
      ${know ? `
        <div class="field">
          <label for="icptext">Describe your ideal buyer</label>
          <textarea class="textarea" id="icptext" maxlength="240" placeholder="e.g. Women 24–35 in Tier 1 cities with sensitive skin who read ingredients before purchasing">${esc(S.icpText)}</textarea>
          <p class="hint">Age range, lifestyle, primary frustration, and where they hang out online.</p>
        </div>
      ` : `
        <div class="field">
          <label for="rivalin">Competitor or category brands to benchmark (up to 5)</label>
          <div class="tagbox" id="tagbox">
            ${S.rivals.map((r, i) => `<span class="t">${esc(r)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(r)}">×</button></span>`).join('')}
            <input id="rivalin" data-key="rivalin" type="text" maxlength="40" placeholder="${S.rivals.length ? 'Add another' : 'Type brand name and press Enter'}" ${S.rivals.length >= 5 ? 'disabled' : ''}>
          </div>
          <label class="check" style="margin-top:6px">
            <input type="checkbox" id="norivals" ${S.noRivals ? 'checked' : ''}> I am not sure yet, let Coldie suggest benchmarks
          </label>
        </div>
      `}
      <div class="field">
        <span class="lbl" id="revlbl">Current Monthly Revenue</span>
        <div class="ladder" role="radiogroup" aria-labelledby="revlbl">
          ${REV.map((r) => `<button type="button" role="radio" aria-checked="${S.rev === r.k}" data-rev="${r.k}" data-key="rev-${r.k}"><b>${r.t}</b><span>${r.s}</span></button>`).join('')}
        </div>
      </div>
      ${S.rev ? `<div class="note note--honest"><b>Got it.</b> Coldie benchmarks ${esc(cat().label)} brands at <b>${esc(revLabel())}</b>.</div>` : ''}
      ${actions({ reward: 50 })}
    </div>`;
  };

  R.link = () => `<div class="panel">
    ${head(3, 'Link up your store', 'Coldie reads your Shopify store to pull product titles, prices, and branding.')}
    <div class="cols2">
      <div class="field">
        <label for="site">Store Website (Shopify or domain)</label>
        <input class="input" id="site" type="text" inputmode="url" autocomplete="off" placeholder="yourbrand.com or yourbrand.myshopify.com" value="${esc(S.site)}" ${S.noSite ? 'disabled' : ''}>
        <label class="check"><input type="checkbox" id="nosite" ${S.noSite ? 'checked' : ''}> I do not have a live site yet</label>
        <p class="err" id="e-site"></p>
      </div>
      <div class="field">
        <label for="ig">Instagram Handle (optional)</label>
        <div class="input-pre">
          <span>@</span>
          <input class="input" id="ig" type="text" autocomplete="off" placeholder="yourbrand" value="${esc(S.ig.replace(/^@/, ''))}" ${S.noIG ? 'disabled' : ''}>
        </div>
        <label class="check"><input type="checkbox" id="noig" ${S.noIG ? 'checked' : ''}> I do not have Instagram yet</label>
        <p class="err" id="e-ig"></p>
      </div>
    </div>
    <div class="note note--honest">
      <strong>Honesty note:</strong> Coldie scans public store catalogues (<code>/products.json</code>) and site copy for real. <em>Instagram profile scraping is not implemented</em>—Coldie will never invent fake post metrics.
    </div>
    ${apiOk === false ? `<div class="note note--warn"><strong>Backend offline:</strong> Running locally without /api. The scan will show an honest simulated preview.</div>` : ''}
    ${actions({ next: 'Send Coldie in →', reward: 50, cls: 'btn--yellow' })}
  </div>`;

  const STAGE_NAMES = () => [
    (!S.noSite && parseSite(S.site)) ? 'Fetch Shopify /products.json' : 'Parse product description',
    (!S.noSite && parseSite(S.site)) ? 'Extract site copy, colours & type' : 'Synthesize brand baseline',
    'Assemble real product shelf',
    'Draft 3 evidence-grounded ICPs',
    'Generate Brand Book & first ad'
  ];

  R.scan = () => {
    const names = STAGE_NAMES(), done = S.scanDone, info = S.scanInfo || { pages: 0, posts: 0, products: 0, signals: 0 };
    return `<div class="panel">
      ${head(4, done ? 'Scan complete' : 'Coldie is reading your store', done ? (S.real ? 'Here is what Coldie extracted from your live store.' : 'Simulation complete.' + (S.scanError ? ' (Live scan error: ' + esc(S.scanError) + ')' : '')) : 'Jump duplicate pixels and collect yellow conversion events in MetaCroc while Coldie scans.', tagNow())}
      ${done ? '' : `
        <div class="arena" id="arena">
          <canvas id="cv" aria-label="MetaCroc: Coldie runs along a track. Press space, up arrow or tap to jump over duplicate pixels and rejected ads." role="img"></canvas>
          <div class="arena__hud">
            <span>MetaCroc</span>
            <span>Shields <span class="pips" id="pips"><i></i><i></i><i></i></span></span>
            <span>Score <b id="score">0</b></span>
          </div>
          <div class="arena__msg" id="armsg"><p>Space / ↑ / Tap to jump</p></div>
        </div>
        <div class="arena__legend">
          <span><b>Legends:</b></span>
          <span style="color:#FF8FB0">■ Pink box = Duplicate pixel</span>
          <span style="color:#FF8FB0">▲ Pink bar = Rejected ad</span>
          <span style="color:var(--accent)">★ Yellow star = Verified conversion event</span>
        </div>
        <div class="arena__ctl">
          <p class="hint">Jump duplicate pixels! Touch devices: tap anywhere on game.</p>
          <div class="actions__right">
            <button class="btn btn--ghost btn--small" type="button" id="auto" aria-pressed="false">Watch instead</button>
            <button class="btn btn--ghost btn--small" type="button" id="ff">Fast-forward</button>
          </div>
        </div>
      `}
      <div class="stages" id="stages">
        ${names.map((n, i) => `
          <div class="stg ${done ? 'is-done' : ''}" data-i="${i}">
            <span class="stg__ic">${done ? '✓' : i + 1}</span>
            <div class="stg__main">
              <b>${esc(n)}</b>
              <div class="stg__bar"><i style="width:${done ? 100 : 0}%"></i></div>
            </div>
            <span class="stg__pct">${done ? '100%' : '0%'}</span>
          </div>
        `).join('')}
      </div>
      <div class="bag" id="bag">
        <div><b data-c="pages">${done ? info.pages : 0}</b><span>pages read</span></div>
        <div><b data-c="posts">0</b><span>instagram posts</span></div>
        <div><b data-c="products">${done ? info.products : 0}</b><span>products extracted</span></div>
        <div><b data-c="signals">${done ? info.signals : 0}</b><span>icp signals</span></div>
      </div>
      ${done ? '' : '<div class="log" id="log" aria-hidden="true"></div>'}
      <div class="result" id="result" ${done ? '' : 'hidden'}>
        <b id="rscore">${S.scanScore}</b>
        <p>MetaCroc score banked: <strong style="color:var(--accent)">+${clamp(Math.round(S.scanScore / 2), 30, 150)} XP</strong> added to your profile.</p>
      </div>
      ${actions({ next: 'See what Coldie found →', cls: 'btn--yellow' })}
    </div>`;
  };

  const initials = (s) => s.split(/\s+/).slice(0, 2).map((w) => (w[0] || '').toUpperCase()).join('') || '?';
  let shelfFilter = 'all';
  R.shelf = () => {
    const list = S.products.filter((p) => shelfFilter === 'all' || (shelfFilter === 'site' && p.src === 'site') || (shelfFilter === 'you' && p.src === 'you'));
    return `<div class="panel">
      ${head(5, 'Your product shelf', S.real ? (S.sources && S.sources.shopify && S.sources.shopify.status === 'ok' ? 'Extracted directly from your Shopify store catalogue. Untick any products you do not want to market yet.' : 'Extracted from your live site copy. Rename or untick any items.') : 'Coldie’s starter product shelf. Untick or rename items.', tagNow())}
      <div class="shelf-top">
        <p class="hint"><b>${S.products.length}</b> products extracted · <b>${S.products.filter((p) => p.on).length}</b> included for ad drafting</p>
        <div class="seg" role="radiogroup" aria-label="Filter shelf by source">
          ${[['all', 'All'], ['site', 'From Store'], ['you', 'Added by You']].map((f) => `<button type="button" role="radio" aria-checked="${shelfFilter === f[0]}" data-filter="${f[0]}" data-key="f-${f[0]}">${f[1]}</button>`).join('')}
        </div>
      </div>
      <div class="grid-p" id="grid">
        ${list.map((p) => `
          <div class="prod ${p.on ? '' : 'is-off'}" data-id="${p.id}">
            <div class="prod__img ${p.image ? 'has-photo' : ''}" style="background:${hsl(p.hue || 220, 55, 42)}">
              ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">` : `<span>${esc(initials(p.name))}</span>`}
            </div>
            <div class="prod__body">
              <input class="prod__name" value="${esc(p.name)}" aria-label="Product name" maxlength="50" data-name="${p.id}">
              <div class="prod__meta">
                ${p.price ? `<span>₹${p.price}</span>` : ''}
                <span class="src">${p.src === 'site' ? 'shopify' : p.src === 'you' ? 'added by you' : 'brief'}</span>
              </div>
              <label class="check"><input type="checkbox" data-on="${p.id}" ${p.on ? 'checked' : ''}> Include</label>
            </div>
          </div>
        `).join('')}
      </div>
      <div><button class="btn btn--ghost btn--small" type="button" id="addprod">+ Add another product</button></div>
      ${actions({ reward: 50 })}
    </div>`;
  };

  const avatar = (seed, size = 52) => {
    const r = rng(hash(seed)), h = Math.floor(r() * 360), cols = [hsl(h, 70, 55), hsl(h + 40, 70, 75), '#F2F2F2', '#000091'];
    let cells = ''; const N = 7;
    for (let y = 0; y < N; y++) for (let x = 0; x < 4; x++) {
      if (r() > .48) {
        const c = cols[Math.floor(r() * 2)];
        cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
        if (x < 3) cells += `<rect x="${N - 1 - x}" y="${y}" width="1" height="1" fill="${c}"/>`;
      }
    }
    return `<svg class="icp__av" viewBox="0 0 ${N} ${N}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="Pixel avatar"><rect width="${N}" height="${N}" fill="${cols[2]}"/>${cells}</svg>`;
  };
  let adding = false, editing = '';
  R.icp = () => `<div class="panel">
    ${head(6, 'Your ideal customer personas (ICPs)', S.real ? 'Coldie extracted these 3 archetypes grounded in your store copy. Pick your Main ICP and a Backup.' : 'Coldie drafted these 3 ICP cards. Pick your Main ICP and a Backup.', tagNow())}
    <div class="bench">
      <span class="label">Benchmark Brands:</span>
      ${(S.real ? (S.rivals.length ? S.rivals : ['Category baseline']) : cat().rivals).map((x) => `<span class="src">${esc(x)}</span>`).join('')}
    </div>
    <div class="grid-i" id="icps">
      ${S.icps.map((p) => {
        const idx = S.picks.indexOf(p.id);
        return `
          <article class="icp ${idx > -1 ? 'is-picked' : ''}" data-card="${p.id}">
            ${idx > -1 ? `<span class="badge">${idx === 0 ? '★ Main ICP' : 'Backup'}</span>` : ''}
            <div class="icp__top">
              ${avatar(p.id + p.name + seedBase())}
              <div>
                <h3>${esc(p.name)}</h3>
                <p class="who">${esc(p.who)}</p>
              </div>
            </div>
            <dl>
              <div><dt>Pain Point</dt><dd>${esc(p.pain)}</dd></div>
              <div><dt>Scrolls</dt><dd>${(p.scroll || []).map(esc).join(' · ')}</dd></div>
              <div><dt>Recommended Meta Format</dt><dd>${esc(p.fmt || 'Reels + Carousel')}</dd></div>
              <div>
                <dt>Ad Hook</dt>
                <dd>${editing === p.id ? `<input class="icp__hook" data-key="hook-${p.id}" data-hook="${p.id}" value="${esc(p.hook)}" maxlength="80">` : `“${esc(p.hook)}”`}</dd>
              </div>
              ${p.evidence ? `<div><dt>Grounded Evidence</dt><dd class="evidence">${esc(p.evidence)}</dd></div>` : ''}
            </dl>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:auto">
              <button type="button" class="btn btn--small ${idx > -1 ? '' : 'btn--ghost'}" data-pick="${p.id}" data-key="pick-${p.id}">
                ${idx === 0 ? 'Main ICP ✓' : idx === 1 ? 'Backup ✓' : 'Pick as ICP'}
              </button>
              <button type="button" class="btn btn--ghost btn--small" data-edit="${p.id}" data-key="edit-${p.id}">
                ${editing === p.id ? 'Save hook' : 'Edit hook'}
              </button>
            </div>
          </article>
        `;
      }).join('')}
      ${adding ? `
        <div class="add-form">
          <div class="cols2">
            <div class="field"><label for="cn">Archetype Name</label><input class="input" id="cn" maxlength="40" placeholder="e.g. The Clean Ingredient Reader"></div>
            <div class="field"><label for="cw">Who They Are</label><input class="input" id="cw" maxlength="100" placeholder="e.g. 24–35, working professional in Tier 1 cities"></div>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn--small" type="button" id="cadd">Add Archetype</button>
            <button class="btn btn--ghost btn--small" type="button" id="ccancel">Cancel</button>
          </div>
        </div>
      ` : `<button type="button" class="card-add" id="addicp">+ Add your own custom ICP</button>`}
    </div>
    ${actions({ reward: 100 })}
  </div>`;

  const bookAd = (b, brand, colors, icp, prod) => {
    const closers = (b.tones || []).slice(0, 2).map((t) => TONES[t] || '').join(' ');
    return `<div class="ad">
      <div class="ad__head">
        <span class="ad__av" style="background:${colors[0]}">${esc(initials(brand))}</span>
        <div><b>${esc(brand)}</b><small>Sponsored · Preview</small></div>
      </div>
      <div class="ad__media" style="background:${colors[0]}"><b>${esc(prod)}</b></div>
      <p class="ad__text">${esc(b.headline || (icp ? icp.hook : ''))} ${esc(closers)}</p>
      <div class="ad__cta">
        <span>${esc(parseSite(S.site) || 'yourbrand.com')}</span>
        <b style="background:${colors[2]};color:#111">Shop now</b>
      </div>
    </div>`;
  };
  R.brand = () => {
    const g = genBrand(), b = S.brand, brand = brandName(), main = S.icps.find((x) => x.id === S.picks[0]) || S.icps[0];
    const prod = (S.products.find((p) => p.on) || { name: S.product || 'Your product' }).name;
    if (!b.headline && main) b.headline = main.hook;
    const f = g.fonts;
    return `<div class="panel">
      ${head(7, 'Your Brand Book', g.fromSite ? 'Colours and type were read directly from your live website. Pick three voice words, then lock it in.' : 'Coldie drafted this from your brief. Pick three voice words, then lock it in.', tagNow())}
      <div class="book">
        <div class="book__col">
          <div class="sect">
            <div class="label"><span>Brand Mark</span></div>
            <div class="mark">
              <span class="mark__logo" style="background:${g.colors[0]}">${esc(initials(brand)[0] || '?')}</span>
              <div>
                <b>${esc(brand)}</b>
                <p class="hint">${esc(parseSite(S.site) || '@' + (parseIG(S.ig) || 'yourbrand'))}</p>
              </div>
            </div>
          </div>
          <div class="sect">
            <div class="label">
              <span>Brand Palette (click to copy)</span>
              <button class="btn btn--ghost btn--small" type="button" id="reroll">Reroll</button>
            </div>
            <div class="swatches">
              ${g.colors.map((c, i) => `
                <button type="button" class="sw" data-copy="${c}" aria-label="${g.names[i]} ${c}">
                  <i style="background:${c}"></i>
                  <span>${g.names[i]}<br>${c}</span>
                </button>
              `).join('')}
            </div>
          </div>
          <div class="sect">
            <div class="label"><span>Typography Pairing</span></div>
            <div class="type-spec">
              <p class="big">${esc(f[0])}</p>
              <small>Headings · ${g.fromSite ? 'extracted from site' : 'suggested pairing'}</small>
              <p class="big" style="font-size:1.15rem;margin-top:6px">${esc(f[1])}</p>
              <small>Body text</small>
            </div>
          </div>
          <div class="sect">
            <div class="label"><span>Tone of Voice (pick 3)</span></div>
            <div class="chips">
              ${Object.keys(TONES).map((t) => `<button type="button" class="chip" aria-pressed="${(b.tones || []).includes(t)}" data-tone="${t}" data-key="tone-${t}">${t}</button>`).join('')}
            </div>
            <div class="say" style="margin-top:10px">
              <p class="yes"><span class="label">Say</span>${esc((S.real && S.realBrand && S.realBrand.say) || TONES[b.tones[0]] || 'Honest, evidence-backed claims.')}</p>
              <p class="no"><span class="label">Don’t Say</span>${S.real && S.realBrand && S.realBrand.dont && S.realBrand.dont.length ? S.realBrand.dont.map((w) => '“' + esc(w) + '”').join(', ') : '“Revolutionary”, “best in the world”, “guaranteed overnight”.'}</p>
            </div>
          </div>
        </div>
        <div class="book__col">
          <div class="field">
            <label for="headline">First Meta Ad Headline</label>
            <input class="input" id="headline" maxlength="90" value="${esc(b.headline)}">
          </div>
          <div id="adprev">${bookAd(b, brand, g.colors, main, prod)}</div>
          <p class="hint">Preview of your first Meta ad creative built from your brand voice and main ICP.</p>
        </div>
      </div>
      ${S.brandLocked ? '<p class="ok">Brand book locked! Proceed to level up.</p>' : ''}
      ${actions({ next: S.brandLocked ? 'Continue to Level Up →' : 'Lock Brand Book & Continue →', reward: 100, cls: 'btn--yellow' })}
    </div>`;
  };

  R.level = () => {
    const l = levelFor(S.xp), main = S.icps.find((x) => x.id === S.picks[0]);
    return `<div class="panel final">
      ${head(8, 'Level ' + (l + 1) + ': ' + LEVELS[l].n, 'Your day-zero brand context is assembled.')}
      <div class="final__top">
        <ul class="sum">
          <li>${S.products.filter((p) => p.on).length} products on your active shelf</li>
          <li>${S.picks.length} ICPs selected${main ? ' (Main: ' + esc(main.name) + ')' : ''}</li>
          <li>Brand Book locked &amp; voice set</li>
          <li>${S.xp} total XP banked</li>
        </ul>
        <img src="assets/mascot/celebrate.anim.webp" alt="Coldie celebrating" width="200" height="200">
      </div>
      <div class="next">
        <img src="assets/mascot/pixel_setup.anim.webp" alt="Coldie setting up pixel" width="110" height="110">
        <div>
          <span class="label" style="color:var(--accent)">Job #1 in Workspace</span>
          <h2 class="display" style="font-size:1.4rem">Install &amp; Verify Meta Pixel + CAPI</h2>
          <p class="hint" style="color:var(--paper)">Never run ads on an unverified signal. We start by pairing your browser pixel with server CAPI deduplication.</p>
        </div>
      </div>
      <form class="signup" id="signup" novalidate>
        <div class="field">
          <label for="email">Save progress with your founder email</label>
          <input class="input" id="email" type="email" autocomplete="email" placeholder="founder@yourbrand.in" value="${esc(S.email)}">
        </div>
        <button class="btn btn--yellow" type="submit" style="align-self:end">Save Spot</button>
        <p class="err" id="e-email" role="alert"></p>
        <p class="ok" id="ok-email" role="status">${S.emailDone ? 'Founder email saved.' : ''}</p>
      </form>
      <div class="actions">
        <button class="btn btn--ghost" type="button" id="back">Back</button>
        <div class="actions__right">
          <button class="btn btn--yellow" type="button" id="toapp">Open Workspace Tracking →</button>
        </div>
      </div>
    </div>`;
  };

  /* ---------------- Step Behaviours (B) ---------------- */
  const B = {};

  B.intro = () => { $('#next').disabled = false; };

  B.what = () => {
    const inp = $('#product');
    inp.addEventListener('input', () => { S.product = inp.value; save(); refreshNext(); });
    stage.addEventListener('click', onWhat);
    return () => stage.removeEventListener('click', onWhat);
  };
  function onWhat(e) {
    const c = e.target.closest('[data-cat]');
    if (!c) return;
    S.cat = c.dataset.cat; save(); rerender(c.dataset.key);
  }

  B.who = () => {
    stage.addEventListener('click', onWho);
    const ta = $('#icptext'); if (ta) ta.addEventListener('input', () => { S.icpText = ta.value; save(); refreshNext(); });
    const ri = $('#rivalin');
    if (ri) {
      const add = () => {
        const v = ri.value.replace(/,/g, '').trim();
        if (v && S.rivals.length < 5 && !S.rivals.some((x) => x.toLowerCase() === v.toLowerCase())) {
          S.rivals.push(v); S.noRivals = false; save(); rerender('rivalin');
        }
      };
      ri.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
        else if (e.key === 'Backspace' && !ri.value && S.rivals.length) { S.rivals.pop(); save(); rerender('rivalin'); }
      });
      ri.addEventListener('blur', () => { if (ri.value.trim()) add(); });
    }
    const nr = $('#norivals');
    if (nr) nr.addEventListener('change', () => { S.noRivals = nr.checked; if (nr.checked) S.rivals = []; save(); rerender(); });
    return () => stage.removeEventListener('click', onWho);
  };
  function onWho(e) {
    const m = e.target.closest('[data-mode]');
    if (m) { S.icpMode = m.dataset.mode; save(); say(LINES.who()); return rerender(m.dataset.key); }
    const r = e.target.closest('[data-rev]');
    if (r) { S.rev = r.dataset.rev; save(); return rerender(r.dataset.key); }
    const x = e.target.closest('[data-rm]');
    if (x) { S.rivals.splice(+x.dataset.rm, 1); save(); rerender('rivalin'); }
  }

  B.link = () => {
    const site = $('#site'), ig = $('#ig');
    const val = () => {
      $('#e-site').textContent = !S.noSite && S.site && !parseSite(S.site) ? 'Please enter a valid domain (e.g. brand.in or brand.myshopify.com).' : '';
      $('#e-ig').textContent = !S.noIG && S.ig && !parseIG(S.ig) ? 'Instagram handles use letters, numbers, dots and underscores.' : '';
      site.setAttribute('aria-invalid', !!$('#e-site').textContent);
      ig.setAttribute('aria-invalid', !!$('#e-ig').textContent);
      refreshNext();
    };
    site.addEventListener('input', () => { S.site = site.value; save(); val(); });
    ig.addEventListener('input', () => { S.ig = ig.value; save(); val(); });
    site.addEventListener('blur', val); ig.addEventListener('blur', val);
    $('#nosite').addEventListener('change', (e) => { S.noSite = e.target.checked; save(); rerender(); });
    $('#noig').addEventListener('change', (e) => { S.noIG = e.target.checked; save(); rerender(); });
  };

  /* ---- MetaCroc Runner Engine ---- */
  const SPR = [
    ['....hhhh....', '..hhHHhhhh..', '.hhhhhhhhhh.', 'hhhhhhhhhhhh', '.vvvvvvvvvv.', '.vvevvvvevv.', '.vvvvvvvvvv.', '..wwwwwwww..', '.wwwwbbwwww.', '.wwwwbbwwww.', '..wwwwwwww..', '...wwwwww...', '...ww..ww...', '..ww....ww..'],
    ['....hhhh....', '..hhHHhhhh..', '.hhhhhhhhhh.', 'hhhhhhhhhhhh', '.vvvvvvvvvv.', '.vvevvvvevv.', '.vvvvvvvvvv.', '..wwwwwwww..', '.wwwwbbwwww.', '.wwwwbbwwww.', '..wwwwwwww..', '...wwwwww...', '...wwwwww...', '....wwww....']
  ];
  const PAL = { h: '#0000F2', H: '#9C9CFF', v: '#00006A', e: '#ECEA36', w: '#F2F2F2', b: '#000091' };
  const EVENTS = ['PageView', 'AddToCart', 'Lead', 'Purchase'];

  function createGame(canvas, opt) {
    const W = 220, H = 64, G = 52, PH = 14;
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false;
    const g = { score: 0, shields: 3, auto: !!opt.auto, running: false };
    let y = G - PH, vy = 0, f = 0, speed = 1.3, obs = [], pk = [], fl = [], nextIn = 45, scroll = 0, inv = 0, stun = 0, dist = 0, evi = 0, raf = 0, last = 0, acc = 0;
    const stars = Array.from({ length: 26 }, (_, i) => [(i * 37 + 11) % W, 4 + ((i * 53) % 32)]);
    const onGround = () => y >= G - PH - 0.01;
    g.jump = () => { if (onGround() && stun <= 0) vy = -5.1; };
    const px = (x, yy, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(yy), w, h); };

    function spawn() {
      const r = Math.random();
      if (r < .5) obs.push({ x: W + 4, w: 8, h: 8, k: 'ad' });
      else obs.push({ x: W + 4, w: 6, h: 10, k: 'dup' });
      if (Math.random() < .7) pk.push({ x: W + 6 + (obs[obs.length - 1].w - 5) / 2, y: G - 28, ev: EVENTS[evi++ % 4] });
      nextIn = 70 + Math.random() * 65;
    }

    function step() {
      speed = 1.3 + Math.min(0.6, dist / 8000);
      if (--nextIn <= 0) spawn();
      if (g.auto && onGround()) {
        const o = obs.find((q) => q.x > 34);
        if (o) { const d = o.x - 34; if (d > 6 && d < 14) g.jump(); }
      }
      vy += .38; y += vy; if (y > G - PH) { y = G - PH; vy = 0; }
      obs.forEach((o) => { o.x -= speed; }); pk.forEach((p) => { p.x -= speed; });
      obs = obs.filter((o) => o.x > -12); pk = pk.filter((p) => p.x > -8);
      dist += speed; scroll += speed; f++;
      if (stun > 0) stun--; if (inv > 0) inv--;
      const px0 = 26, px1 = 34, py0 = y + 2, py1 = y + PH;
      if (!inv && stun <= 0) {
        for (const o of obs) {
          const oy = G - o.h;
          if (px1 > o.x + 1 && px0 < o.x + o.w - 1 && py1 > oy + 1 && py0 < G) {
            g.shields--; inv = 60; fl.push({ t: '-1', x: 28, y: y - 2, life: 34, col: '#FF8FB0' });
            if (g.shields <= 0) { stun = 45; g.shields = 3; g.score = Math.max(0, g.score - 20); opt.onFaceplant && opt.onFaceplant(); }
            opt.onHit && opt.onHit(g);
            break;
          }
        }
      }
      pk = pk.filter((p) => {
        if (px1 + 2 > p.x && px0 - 2 < p.x + 5 && py1 > p.y && py0 < p.y + 5) {
          g.score += 10; fl.push({ t: p.ev, x: p.x - 10, y: p.y - 4, life: 40, col: '#ECEA36' });
          opt.onPickup && opt.onPickup(g);
          return false;
        }
        return true;
      });
      if (f % 20 === 0) g.score += 1;
      fl.forEach((q) => { q.y -= .35; q.life--; }); fl = fl.filter((q) => q.life > 0);
    }

    function draw() {
      px(0, 0, W, H, '#00006A');
      stars.forEach((s, i) => px((s[0] - scroll * (.1 + (i % 3) * .05) + W * 4) % W, s[1], 1, 1, i % 4 ? '#2A2AFF' : '#9C9CFF'));
      px(0, G, W, H - G, '#0000F2'); px(0, G, W, 1, '#9C9CFF');
      for (let x = -12; x < W + 12; x += 12) px(x - (scroll % 12), G + 5, 4, 1, '#2A2AFF');
      pk.forEach((p) => { const col = (f >> 3) % 2 ? '#ECEA36' : '#FFF788'; px(p.x + 2, p.y, 1, 5, col); px(p.x, p.y + 2, 5, 1, col); px(p.x + 1, p.y + 1, 3, 3, col); });
      obs.forEach((o) => {
        const oy = G - o.h;
        if (o.k === 'ad') { px(o.x, oy, o.w, o.h, '#FF5C8A'); }
        else { px(o.x, oy, o.w, 5, '#FF5C8A'); px(o.x, oy + 6, o.w, 4, '#FF5C8A'); }
      });
      if (!(inv > 0 && (f >> 2) % 2)) {
        const fr = !onGround() ? 0 : ((f >> 3) % 2);
        const rows = SPR[fr], ox = 0, oy = Math.round(y) + (stun > 0 ? 4 : 0);
        rows.forEach((row, ry) => { for (let rx = 0; rx < 12; rx++) { const ch = row[rx]; if (ch !== '.') px(24 + rx + ox, oy + ry, 1, 1, PAL[ch]); } });
      }
      c.font = '6px monospace'; c.textBaseline = 'top';
      fl.forEach((q) => { c.fillStyle = q.col; c.fillText(q.t, Math.round(q.x), Math.round(q.y)); });
    }

    g.start = () => {
      g.running = true; last = performance.now();
      const loop = (t) => {
        if (!g.running) return;
        acc += Math.min(100, t - last); last = t;
        while (acc >= 1000 / 60) { step(); acc -= 1000 / 60; }
        draw(); raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };
    g.stop = () => { g.running = false; cancelAnimationFrame(raf); };
    draw();
    return g;
  }

  B.scan = () => {
    if (S.scanDone) return null;
    const hasSite = !S.noSite && parseSite(S.site), d = parseSite(S.site) || 'your-site';
    const nProd = S.products.length, pages = nProd + 4, signals = S.icps.reduce((a, x) => a + (x.signals || 10), 0);
    const info = { pages: hasSite ? pages : 0, posts: 0, products: nProd, signals };
    const D = 25000, MIN = 14000;
    let live = null, liveDone = !apiOk, liveFail = '';

    if (apiOk) {
      api('plugins/onboard/actions/scan', {
        product: S.product, cat: S.cat, site: S.site, ig: S.ig,
        noSite: S.noSite, noIG: S.noIG, icpMode: S.icpMode, icpText: S.icpText,
        rivals: S.rivals, rev: S.rev
      }).then((r) => { live = r; }).catch((er) => { liveFail = er.message; }).finally(() => { liveDone = true; });
    }

    const canvas = $('#cv'), arena = $('#arena');
    const game = createGame(canvas, {
      auto: REDUCE,
      onHit: (g) => { $$('#pips i').forEach((el, i) => el.classList.toggle('off', i >= g.shields)); },
      onFaceplant: () => { setClip('faceplant'); say('Ouch! Shields back up, keep jumping!'); setTimeout(() => { if (STEPS[S.step] === 'scan' && !S.scanDone) setClip('run_loop'); }, 1400); },
      onPickup: (g) => { $('#score').textContent = g.score; }
    });

    const autoBtn = $('#auto');
    const setAuto = (on) => { game.auto = on; autoBtn.setAttribute('aria-pressed', on); autoBtn.textContent = on ? 'Take over' : 'Watch instead'; };
    if (REDUCE) setAuto(true);
    autoBtn.addEventListener('click', () => setAuto(!game.auto));
    let ff = false;
    $('#ff').addEventListener('click', () => { ff = true; setAuto(true); $('#ff').disabled = true; });

    const onKey = (e) => {
      if ((e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) {
        e.preventDefault(); game.jump(); $('#armsg').hidden = true;
      }
    };
    const onTap = () => { game.jump(); $('#armsg').hidden = true; };
    document.addEventListener('keydown', onKey); arena.addEventListener('pointerdown', onTap);
    game.start();

    let elapsed = 0, pp = 0, prev = performance.now();
    const log = $('#log');
    const pushLog = (t) => {
      if (!log) return;
      const p = document.createElement('p'); p.textContent = t; log.appendChild(p);
      while (log.children.length > 7) log.firstChild.remove();
    };

    const timer = setInterval(() => {
      const now = performance.now();
      elapsed += Math.min(500, now - prev) * (ff ? 6 : 1);
      prev = now;
      if (!apiOk) pp = Math.min(1, elapsed / D);
      else if (!liveDone || elapsed < MIN) pp = Math.min(0.94, Math.max(pp, elapsed / D)); // progress capped at 94%
      else pp = Math.min(1, pp + 0.05);

      const p = pp, si = Math.min(4, Math.floor(p * 5)), local = (p * 5) - si;
      $$('#stages .stg').forEach((el, i) => {
        const pct = i < si ? 100 : i === si ? Math.round(clamp(local, 0, 1) * 100) : 0;
        el.classList.toggle('is-done', i < si || p >= 1);
        el.classList.toggle('is-now', i === si && p < 1);
        const barI = $('.stg__bar i', el), pctSpan = $('.stg__pct', el), icSpan = $('.stg__ic', el);
        if (barI) barI.style.width = (p >= 1 ? 100 : pct) + '%';
        if (pctSpan) pctSpan.textContent = (p >= 1 ? 100 : pct) + '%';
        if (icSpan && (i < si || p >= 1)) icSpan.textContent = '✓';
      });

      if (p >= 1 && liveDone) finish();
    }, 100);

    function finish() {
      clearInterval(timer); game.stop(); cleanup && cleanupInner();
      if (live) {
        S.real = true; S.realBrand = live.brand; S.sources = live.sources; S.scanError = '';
        if (live.products && live.products.length) S.products = live.products.map((x, i) => Object.assign({ hue: (i * 47) % 360 }, x));
        S.icps = live.icps; S.picks = [];
        if (S.icpMode === 'know' && S.icpText.trim()) {
          S.icps.unshift({ id: 'iu', name: 'Your Customer', who: S.icpText.trim().slice(0, 120), pain: 'Founder brief', scroll: ['Instagram Reels', 'Reddit'], hook: (live.icps[0] ? live.icps[0].hook : ''), fmt: 'Reels + UGC', level: 'You told us', mine: true, real: true });
        }
        Object.assign(info, live.info || {});
        (live.log || []).forEach(pushLog);
      } else if (liveFail) {
        S.real = false; S.scanError = liveFail;
        toast('Live scan offline or capped. Showing simulated preview.');
      }
      S.scanDone = true; S.scanScore = game.score; S.scanInfo = info; save();
      addXP('scan', clamp(Math.round(game.score / 2), 30, 150));
      cleanup = null;
      go(S.step);
      say(S.real ? 'Scan verified! Extracted catalogue from ' + d + '.' : 'Scan complete! Here is your starter shelf.');
    }

    function cleanupInner() {
      document.removeEventListener('keydown', onKey);
      arena.removeEventListener('pointerdown', onTap);
    }
    return () => { clearInterval(timer); game.stop(); cleanupInner(); };
  };

  /* ---- Product Shelf ---- */
  B.shelf = () => {
    const onClick = (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) { shelfFilter = f.dataset.filter; return rerender(f.dataset.key); }
      if (e.target.closest('#addprod')) {
        S.products.unshift({ id: 'u' + Date.now(), name: '', price: 999, src: 'you', posts: 0, on: true, hue: 210 });
        shelfFilter = 'all'; save(); rerender();
        const ni = $('.prod__name'); if (ni) ni.focus();
      }
    };
    const onInput = (e) => {
      const n = e.target.closest('[data-name]');
      if (n) { const p = S.products.find((x) => x.id === n.dataset.name); if (p) { p.name = n.value; save(); } }
    };
    const onChange = (e) => {
      const o = e.target.closest('[data-on]');
      if (!o) return;
      const p = S.products.find((x) => x.id === o.dataset.on);
      if (p) { p.on = o.checked; save(); o.closest('.prod')?.classList.toggle('is-off', !p.on); refreshNext(); }
    };
    stage.addEventListener('click', onClick);
    stage.addEventListener('input', onInput);
    stage.addEventListener('change', onChange);
    return () => {
      stage.removeEventListener('click', onClick);
      stage.removeEventListener('input', onInput);
      stage.removeEventListener('change', onChange);
    };
  };

  /* ---- ICP Selection ---- */
  B.icp = () => {
    const pick = (id) => {
      const i = S.picks.indexOf(id);
      if (i > -1) S.picks.splice(i, 1);
      else if (S.picks.length < 2) S.picks.push(id);
      else S.picks[1] = id;
      save();
    };
    const onClick = (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        editing = editing === ed.dataset.edit ? '' : ed.dataset.edit;
        return rerender(editing ? 'hook-' + ed.dataset.edit : ed.dataset.key);
      }
      if (e.target.closest('[data-hook]')) return;
      const card = e.target.closest('[data-card]');
      const p = e.target.closest('[data-pick]') || (card && !e.target.closest('button, input') ? card.querySelector('[data-pick]') : null);
      if (p) {
        pick(p.dataset.pick);
        const main = S.icps.find((x) => x.id === S.picks[0]);
        if (main) say('Main ICP chosen: “' + main.name + '”. I’ll draft ads tailored to them.');
        return rerender(p.dataset.key);
      }
      if (e.target.closest('#addicp')) { adding = true; return rerender(); }
      if (e.target.closest('#ccancel')) { adding = false; return rerender(); }
      if (e.target.closest('#cadd')) {
        const n = $('#cn').value.trim(), w = $('#cw').value.trim();
        if (!n) { $('#cn').focus(); return; }
        const id = 'c' + Date.now();
        S.icps.push({ id, name: n.slice(0, 40), who: w || 'Added by founder', pain: 'Tell Coldie what they struggle with', scroll: ['Instagram Reels', 'Reddit'], hook: 'Quality that speaks for itself.', fmt: 'Reels + Carousel', level: 'Custom', mine: true, evidence: 'Direct founder entry' });
        adding = false; pick(id); rerender();
      }
    };
    const onInput = (e) => {
      const h = e.target.closest('[data-hook]');
      if (h) { const p = S.icps.find((x) => x.id === h.dataset.hook); if (p) { p.hook = h.value; save(); } }
    };
    stage.addEventListener('click', onClick); stage.addEventListener('input', onInput);
    return () => { stage.removeEventListener('click', onClick); stage.removeEventListener('input', onInput); adding = false; editing = ''; };
  };

  /* ---- Brand Book ---- */
  B.brand = () => {
    const refreshAd = () => {
      const g = genBrand(), main = S.icps.find((x) => x.id === S.picks[0]) || S.icps[0];
      const prod = (S.products.find((p) => p.on) || { name: S.product || 'Your product' }).name;
      const adEl = $('#adprev');
      if (adEl) adEl.innerHTML = bookAd(S.brand, brandName(), g.colors, main, prod);
    };
    const onClick = (e) => {
      if (e.target.closest('#reroll')) { S.brand.variant++; save(); return rerender(); }
      const t = e.target.closest('[data-tone]');
      if (t) {
        const b = S.brand, k = t.dataset.tone, i = (b.tones || []).indexOf(k);
        if (i > -1) { if (b.tones.length > 1) b.tones.splice(i, 1); }
        else { (b.tones || (b.tones = [])).push(k); if (b.tones.length > 3) b.tones.shift(); }
        save(); return rerender(t.dataset.key);
      }
      const s = e.target.closest('[data-copy]');
      if (s) {
        try { navigator.clipboard.writeText(s.dataset.copy); } catch {}
        toast('Copied ' + s.dataset.copy);
      }
    };
    const onInput = (e) => {
      if (e.target.id === 'headline') { S.brand.headline = e.target.value; save(); refreshAd(); }
    };
    stage.addEventListener('click', onClick); stage.addEventListener('input', onInput);
    const nx = $('#next');
    const lock = (e) => {
      if (!S.brandLocked) {
        e.stopImmediatePropagation();
        S.brandLocked = true; save();
        addXP('brand', 100);
        say(LINES.brand());
        setTimeout(() => go(S.step + 1), 750);
      }
    };
    if (nx) { nx.disabled = false; nx.addEventListener('click', lock, true); }
    return () => { stage.removeEventListener('click', onClick); stage.removeEventListener('input', onInput); };
  };

  /* ---- Level Up & Handoff ---- */
  B.level = () => {
    setTimeout(confetti, 250);
    const f = $('#signup');
    if (f) {
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = $('#email').value.trim(), err = $('#e-email');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
          err.textContent = 'Please enter a valid founder email.';
          $('#email').setAttribute('aria-invalid', 'true');
          return;
        }
        err.textContent = ''; $('#email').removeAttribute('aria-invalid');
        S.email = v; save();
        const done = (msg) => {
          S.emailDone = true; save();
          $('#ok-email').textContent = msg;
          addXP('email', 25);
          say('Saved! Next: install & verify your Meta Pixel in Tracking.');
        };
        if (!apiOk) return done('Saved in local browser.');
        api('plugins/onboard/actions/signup', { email: v, source: 'onboarding-v3', brand: brandName(), site: S.site })
          .then((r) => done(r.already ? 'Already on list. Progress preserved.' : 'Early access spot saved!'))
          .catch((er) => { err.textContent = er.message; });
      });
    }
    const toAppBtn = $('#toapp');
    if (toAppBtn) {
      toAppBtn.addEventListener('click', () => {
        handoff();
        location.href = 'app-v3.html#/tracking?from=onboarding';
      });
    }
  };

  /* ---------------- Workspace Handoff Contract ---------------- */
  function handoff() {
    const g = genBrand(), b = S.brand || {};
    const main = S.icps.find((x) => x.id === S.picks[0]) || S.icps[0];
    const backup = S.icps.find((x) => x.id === S.picks[1]);
    const data = {
      v: 1, at: new Date().toISOString(), real: !!S.real,
      brand: {
        name: brandName(), url: parseSite(S.site) ? 'https://' + parseSite(S.site) : '',
        ig: parseIG(S.ig), line: (S.real && S.realBrand && S.realBrand.line) || S.product.trim(),
        category: cat().label, revenue: revLabel(),
        voice: (b.tones || []).join(', '),
        avoid: (S.real && S.realBrand && S.realBrand.dont ? S.realBrand.dont : ['revolutionary', 'game-changing', 'best in the world']).join(', ')
      },
      book: {
        colors: g.colors, names: g.names, fonts: g.fonts, tones: b.tones || [],
        headline: b.headline || '', say: (S.real && S.realBrand && S.realBrand.say) || '',
        fromSite: !!g.fromSite, logo: (S.real && S.realBrand && S.realBrand.logo) || null
      },
      products: S.products.filter((p) => p.on).map((p) => ({
        name: p.name, price: p.price, image: p.image || null, url: p.url || null, src: p.src
      })),
      icps: [main, backup].filter(Boolean).map((p, i) => ({
        role: i ? 'backup' : 'main', name: p.name, who: p.who, pain: p.pain,
        scroll: p.scroll, hook: p.hook, fmt: p.fmt, evidence: p.evidence || ''
      })),
      competitors: S.rivals.slice(), sources: S.sources || null
    };
    try { localStorage.setItem('coldstart.handoff.v1', JSON.stringify(data)); } catch {}
    S.handedOff = true; save();
  }

  /* ---------------- Global wiring ---------------- */
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-goto]');
    if (n && !n.disabled) go(+n.dataset.goto);
  });
  let sure = 0;
  const restartBtn = $('#restart');
  if (restartBtn) {
    restartBtn.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (!sure) {
        sure = 1; btn.textContent = 'sure?';
        setTimeout(() => { sure = 0; btn.textContent = 'start over'; }, 3000);
        return;
      }
      sure = 0; btn.textContent = 'start over';
      try { localStorage.removeItem(KEY); } catch {}
      S = fresh(); shelfFilter = 'all'; go(0);
    });
  }

  if (S.step === 4 && !S.scanDone && !S.products.length) {
    S.products = genProducts(); S.icps = genIcps();
  }
  go(S.step);
})();
