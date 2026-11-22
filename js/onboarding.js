/* Coldstart onboarding.
   Eight quests: what you sell, who buys, link up, the scan (with the MetaCroc runner), product shelf,
   ICPs, brand book, level up. When the Coldstart API is reachable the scan is real: /api/plugins/onboard
   reads the website (Shopify catalogue, copy, colours, type) and Gemini drafts ICPs and a brand book.
   Without the API, or if the scan fails, the original in-browser generator runs and every result says
   "Simulated preview". The level-up step hands everything to the workspace (app.html). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

  /* ============================================================ seeded randomness */
  const hash = (str) => { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const shuffle = (arr, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const hsl = (h, s, l) => { h = ((h % 360) + 360) % 360; s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase(); };

  /* ============================================================ content */
  const CATS = {
    fashion: { label: 'Fashion', hue: [14, 44], price: [24, 168], fonts: ['Fraunces', 'Inter', 'serif', 'sans'], tones: ['Confident', 'Relaxed', 'Precise'],
      products: ['Everyday Tee', 'Heavyweight Hoodie', 'Linen Overshirt', 'Straight-Leg Trouser', 'Relaxed Denim', 'Weekend Tote', 'Merino Beanie', 'Crew Sock 3-Pack', 'Utility Jacket', 'Ribbed Tank', 'Sunday Shorts', 'Canvas Belt', 'Quilted Vest', 'Poplin Shirt'],
      rivals: ['A capsule-wardrobe label', 'A streetwear drop brand', 'A basics-subscription brand'],
      icps: [
        { n: 'The Capsule Builder', who: '25–34, city, buys fewer and better pieces', pain: 'Fast fashion falls apart and never fits twice', scroll: ['Instagram Reels', 'Pinterest', 'Reddit'], hook: 'Ten pieces. One wardrobe. No regrets.', fmt: 'Reels + carousel' },
        { n: 'The Gift Giver', who: '28–45, shops for a partner and friends', pain: 'Guessing sizes and dealing with returns', scroll: ['Instagram Stories', 'TikTok'], hook: 'The gift they’ll actually wear.', fmt: 'Stories + catalog ad' },
        { n: 'The Drop Chaser', who: '18–24, follows creators, buys on release day', pain: 'Wants the look without the luxury price', scroll: ['TikTok', 'Instagram Reels'], hook: 'The drop everyone’s asking about.', fmt: 'Reels + creator ad' }] },
    beauty: { label: 'Beauty & skincare', hue: [320, 365], price: [14, 72], fonts: ['DM Serif Display', 'DM Sans', 'serif', 'sans'], tones: ['Warm', 'Precise', 'Playful'],
      products: ['Barrier Repair Cream', 'Vitamin C Serum', 'Gentle Gel Cleanser', 'Daily Mineral SPF', 'Overnight Lip Mask', 'Clay Mask', 'Niacinamide Toner', 'Eye Balm', 'Body Oil', 'Scalp Scrub', 'Hand Cream Duo', 'Cleansing Balm', 'Glow Drops'],
      rivals: ['A clean-skincare brand', 'A derm-founded label', 'A K-beauty importer'],
      icps: [
        { n: 'The Ingredient Reader', who: '24–38, checks the label before the price', pain: 'Hype products that don’t say what’s inside', scroll: ['Instagram Reels', 'TikTok', 'Reddit'], hook: 'Six ingredients. Nothing to hide.', fmt: 'Reels + UGC' },
        { n: 'The Routine Minimalist', who: '28–42, three steps and done', pain: 'Shelves full of products she never finishes', scroll: ['Instagram Stories', 'YouTube'], hook: 'Three steps. Done by 8am.', fmt: 'Carousel + Stories' },
        { n: 'The Sensitive-Skin Skeptic', who: '20–35, burned by past launches', pain: 'Every new product starts a breakout', scroll: ['Reddit', 'TikTok'], hook: 'Patch-tested before it ever reached you.', fmt: 'UGC + reviews' }] },
    food: { label: 'Food & drink', hue: [6, 40], price: [8, 54], fonts: ['Bricolage Grotesque', 'Inter', 'sans', 'sans'], tones: ['Warm', 'Playful', 'Confident'],
      products: ['Starter Box', 'Small-Batch Hot Sauce', 'Single-Origin Beans', 'Sparkling Tonic 12-Pack', 'Granola Trio', 'Olive Oil 500ml', 'Snack Variety Pack', 'Cold Brew Concentrate', 'Spice Set', 'Honey Duo', 'Chili Crisp', 'Sourdough Kit'],
      rivals: ['A small-batch pantry brand', 'A better-for-you snack label', 'A subscription food box'],
      icps: [
        { n: 'The Weekend Host', who: '27–40, cooks for friends on Saturdays', pain: 'Wants a table that looks effortless', scroll: ['Instagram Reels', 'Pinterest'], hook: 'Looks like you tried. Took ten minutes.', fmt: 'Reels + carousel' },
        { n: 'The Label Checker', who: '25–45, reads every ingredient list', pain: 'Snacks that hide sugar behind clever names', scroll: ['TikTok', 'Reddit'], hook: 'Five ingredients you can pronounce.', fmt: 'UGC + Stories' },
        { n: 'The Desk Lunch Fixer', who: '23–35, eats at a laptop', pain: 'Boring, expensive and always the same', scroll: ['TikTok', 'Instagram Stories'], hook: 'The 3pm snack that ends the vending machine.', fmt: 'Reels + collection ad' }] },
    home: { label: 'Home & living', hue: [24, 62], price: [18, 220], fonts: ['Playfair Display', 'Work Sans', 'serif', 'sans'], tones: ['Warm', 'Minimal', 'Precise'],
      products: ['Soy Candle', 'Linen Throw', 'Ceramic Vase', 'Stoneware Mug Set', 'Wool Rug', 'Wall Hook Rail', 'Table Lamp', 'Waffle Towels', 'Planter Duo', 'Serving Board', 'Diffuser', 'Cushion Cover Pair'],
      rivals: ['A slow-living home brand', 'A candle and fragrance label', 'A design-led homeware studio'],
      icps: [
        { n: 'The First-Home Nester', who: '24–34, just moved, building from zero', pain: 'Everything looks the same and costs a fortune', scroll: ['Pinterest', 'Instagram Reels', 'TikTok'], hook: 'Make the rental feel like yours.', fmt: 'Reels + carousel' },
        { n: 'The Gift Planner', who: '30–50, always buying for someone', pain: 'Gifts that feel generic or arrive late', scroll: ['Instagram Stories', 'Pinterest'], hook: 'A gift they’ll keep on display.', fmt: 'Stories + catalog ad' },
        { n: 'The Calm Corner Seeker', who: '28–45, works from home', pain: 'A cluttered space and a noisy mind', scroll: ['Instagram Reels', 'Reddit'], hook: 'One small corner. A calmer day.', fmt: 'Reels + UGC' }] },
    fitness: { label: 'Fitness & wellness', hue: [150, 200], price: [16, 140], fonts: ['Space Grotesk', 'Inter', 'sans', 'sans'], tones: ['Confident', 'Precise', 'Playful'],
      products: ['Daily Greens Powder', 'Resistance Band Set', 'Recovery Roller', 'Training Shorts', 'Electrolyte Sticks', 'Yoga Mat', 'Protein Cookies', 'Sleep Gummies', 'Shaker Bottle', 'Grip Straps', 'Magnesium Spray'],
      rivals: ['A supplement subscription', 'A home-gym brand', 'A recovery-gear label'],
      icps: [
        { n: 'The Consistent Beginner', who: '22–34, restarting for the fifth time', pain: 'Plans that fall apart by week three', scroll: ['TikTok', 'Instagram Reels'], hook: 'Start small. Show up. Repeat.', fmt: 'Reels + UGC' },
        { n: 'The Time-Poor Lifter', who: '28–42, trains before work', pain: 'Gear and supplements that don’t earn their place', scroll: ['Reddit', 'YouTube', 'Instagram Reels'], hook: 'Everything you need. Nothing you don’t.', fmt: 'Reels + carousel' },
        { n: 'The Recovery Nerd', who: '30–50, tracks sleep and soreness', pain: 'Aches that linger after hard sessions', scroll: ['Reddit', 'Instagram Stories'], hook: 'Wake up less sore than you went to bed.', fmt: 'Stories + reviews' }] },
    pets: { label: 'Pets', hue: [188, 222], price: [9, 86], fonts: ['Fredoka', 'Nunito', 'rounded', 'sans'], tones: ['Playful', 'Warm', 'Relaxed'],
      products: ['Tough Chew Toy', 'Freeze-Dried Treats', 'Orthopedic Bed', 'Slow-Feeder Bowl', 'Walk Harness', 'Calming Chews', 'Grooming Mitt', 'Travel Water Bottle', 'Cat Tunnel', 'Training Pouch'],
      rivals: ['A premium treat brand', 'A pet-supply subscription', 'A design-led pet label'],
      icps: [
        { n: 'The Pet Parent', who: '26–40, the dog is family', pain: 'Treats and toys that get ignored or destroyed', scroll: ['Instagram Reels', 'TikTok'], hook: 'Tested by a very picky dog.', fmt: 'Reels + UGC' },
        { n: 'The Ingredient-Wary Owner', who: '30–50, reads the back of the bag', pain: 'Vague labels and fillers', scroll: ['Reddit', 'Instagram Stories'], hook: 'Real food. Real short ingredient list.', fmt: 'Carousel + reviews' },
        { n: 'The New Puppy Person', who: '22–35, first pet, a bit overwhelmed', pain: 'Not sure what they actually need', scroll: ['TikTok', 'YouTube'], hook: 'Everything for week one, in one box.', fmt: 'Reels + collection ad' }] },
    tech: { label: 'Tech & accessories', hue: [214, 262], price: [12, 180], fonts: ['Space Grotesk', 'IBM Plex Sans', 'sans', 'sans'], tones: ['Precise', 'Minimal', 'Confident'],
      products: ['Magnetic Phone Case', 'Braided Charging Cable', 'Desk Mat', 'Laptop Sleeve', 'GaN Charger', 'Cable Organizer', 'Stand', 'Wireless Pad', 'Travel Pouch', 'Earbud Case'],
      rivals: ['A design-led accessory brand', 'A charging-gear label', 'A desk-setup brand'],
      icps: [
        { n: 'The Desk Setup Tinkerer', who: '22–36, posts their setup online', pain: 'Cables, clutter and gear that clashes', scroll: ['Reddit', 'YouTube', 'Instagram Reels'], hook: 'The last desk upgrade you’ll need.', fmt: 'Reels + UGC' },
        { n: 'The Frequent Flyer', who: '28–45, on the road every month', pain: 'Gear that breaks or gets left behind', scroll: ['Instagram Stories', 'YouTube'], hook: 'Fits in one pocket. Survives the trip.', fmt: 'Stories + carousel' },
        { n: 'The Spec Checker', who: '24–40, reads reviews first', pain: 'Cheap accessories that fail in a month', scroll: ['Reddit', 'YouTube'], hook: 'Rated for 10,000 plugs. Tested to prove it.', fmt: 'Carousel + reviews' }] },
    other: { label: 'Something else', hue: [0, 360], price: [15, 120], fonts: ['Space Grotesk', 'Inter', 'sans', 'sans'], tones: ['Confident', 'Warm', 'Precise'],
      products: ['Signature Item', 'Starter Bundle', 'Gift Set', 'Refill Pack', 'Limited Edition', 'Travel Size', 'Duo Pack', 'Everyday Essential', 'Premium Edition'],
      rivals: ['A direct competitor', 'A category leader', 'A fast-growing newcomer'],
      icps: [
        { n: 'The Early Adopter', who: '24–38, tries new brands first', pain: 'Too many look-alike options', scroll: ['Instagram Reels', 'Reddit', 'TikTok'], hook: 'Be the first to find it.', fmt: 'Reels + UGC' },
        { n: 'The Careful Buyer', who: '30–48, compares before buying', pain: 'Not sure who to trust', scroll: ['Instagram Stories', 'Reddit'], hook: 'Read the reviews. Then read ours.', fmt: 'Carousel + reviews' },
        { n: 'The Gift Hunter', who: '25–45, shops for others', pain: 'Gifts that feel generic', scroll: ['Instagram Stories', 'Pinterest'], hook: 'The gift that gets remembered.', fmt: 'Stories + catalog ad' }] }
  };
  const CAT_KEYS = Object.keys(CATS);
  const REV = [
    { k: 'pre', t: 'Pre-revenue', s: 'Not selling yet' },
    { k: 'lt10', t: 'Under $10K', s: 'per month' },
    { k: '10-50', t: '$10–50K', s: 'per month' },
    { k: '50-250', t: '$50–250K', s: 'per month' },
    { k: '250+', t: '$250K+', s: 'per month' }
  ];
  const TONES = { Confident: 'Made right. Priced fairly.', Relaxed: 'No rush. No pressure.', Precise: 'Every detail, accounted for.', Playful: 'Yes, it’s really that good.', Warm: 'Made with care, shipped with love.', Minimal: 'Simple. Good.' };
  const LEVELS = [{ at: 0, n: 'Cold Start' }, { at: 120, n: 'Warming Up' }, { at: 320, n: 'Getting Traffic' }, { at: 520, n: 'Pixel Perfect' }];
  const QUESTS = [['what', 'What you sell'], ['who', 'Who buys'], ['link', 'Link up'], ['scan', 'The scan'], ['shelf', 'Product shelf'], ['icp', 'Your ICPs'], ['brand', 'Brand book'], ['level', 'Level up']];
  const STEPS = ['intro', ...QUESTS.map((q) => q[0])];
  const CLIPS = { intro: 'wave', what: 'idle_stand', who: 'idle_stand', link: 'web_post', scan: 'run_loop', shelf: 'ig_ad', icp: 'competitor_scan', brand: 'ig_ad', level: 'celebrate' };

  /* ============================================================ state */
  const KEY = 'coldstart.onboarding.v1';
  const fresh = () => ({ step: 0, max: 0, xp: 0, got: {}, product: '', cat: '', icpMode: 'help', icpText: '', rivals: [], noRivals: false, rev: '', site: '', ig: '', noSite: false, noIG: false, scanDone: false, scanScore: 0, scanInfo: null, products: [], icps: [], picks: [], brand: null, brandLocked: false, email: '', emailDone: false, real: false, realBrand: null, scanError: '', sources: null, handedOff: false });
  let S;
  try { S = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || 'null') || {}); } catch (e) { S = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage can be blocked; the flow still works */ } };

  /* ============================================================ Coldstart API (real scan, signup) */
  let apiOk = null;   // null = unknown, true/false after /api/health
  const apiReady = fetch('/api/health', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((j) => { apiOk = !!(j && j.plugins && j.plugins.onboard === 'live'); }).catch(() => { apiOk = false; }).finally(() => { if (STEPS[S.step] === 'link' || STEPS[S.step] === 'intro') rerender(); });
  async function api(path, body) {
    const r = await fetch('/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coldstart': '1' }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) { /* non-JSON error page */ }
    if (!r.ok) throw new Error(j.error || 'Request failed (' + r.status + ')');
    return j;
  }

  /* ============================================================ helpers on inputs */
  const parseSite = (v) => { v = (v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]; return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : ''; };
  const parseIG = (v) => { v = (v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0]; return /^[a-zA-Z0-9._]{1,30}$/.test(v) ? v : ''; };
  const brandName = () => {
    if (S.real && S.realBrand && S.realBrand.name) return S.realBrand.name;
    const d = parseSite(S.site); if (d) return title(d.split('.')[0].replace(/-/g, ' '));
    const h = parseIG(S.ig); if (h) return title(h.replace(/[._]+/g, ' ').trim());
    return 'Your brand';
  };
  const cat = () => CATS[S.cat] || CATS.other;
  const revLabel = () => { const r = REV.find((x) => x.k === S.rev); return r ? (r.k === 'pre' ? 'pre-revenue' : r.t + ' a month') : ''; };
  const seedBase = () => parseSite(S.site) + '|' + parseIG(S.ig) + '|' + S.cat + '|' + S.product.trim().toLowerCase();

  /* ============================================================ generators (sample data, deterministic) */
  function genProducts() {
    const c = cat(), r = rng(hash(seedBase() + 'p'));
    const n = 9 + Math.floor(r() * 6);
    const names = shuffle(c.products, r).slice(0, n - 1);
    const hero = S.product.trim() ? title(S.product.trim().replace(/\s+/g, ' ').slice(0, 38)) : names.shift();
    names.unshift(hero);
    const hasSite = !S.noSite && parseSite(S.site), hasIG = !S.noIG && parseIG(S.ig);
    return names.slice(0, n).map((name, i) => {
      const src = !hasSite && !hasIG ? 'brief' : !hasIG ? 'site' : !hasSite ? 'ig' : (r() < .5 ? 'both' : r() < .6 ? 'site' : 'ig');
      const price = Math.max(5, Math.round((c.price[0] + r() * (c.price[1] - c.price[0])) / 5) * 5 - 1);
      return { id: 'p' + i, name, price, src, posts: hasIG ? Math.floor(r() * 7) : 0, on: true, hue: Math.floor(r() * 360) };
    });
  }
  function genIcps() {
    const c = cat(), r = rng(hash(seedBase() + 'i'));
    let list = c.icps.map((x, i) => ({ id: 'i' + i, name: x.n, who: x.who, pain: x.pain, scroll: x.scroll.slice(), hook: x.hook, fmt: x.fmt, signals: 6 + Math.floor(r() * 18), level: ['Strong', 'Medium', 'Testing'][i], mine: false }));
    if (S.icpMode === 'know' && S.icpText.trim()) {
      list[0] = Object.assign({}, list[0], { id: 'i0', name: 'Your customer', who: S.icpText.trim().slice(0, 120), pain: 'Coldie tests this against signals from your site and Instagram', mine: true, level: 'You told us' });
    }
    if (S.icpMode === 'help' && S.rivals.length) {
      list = list.map((x, i) => Object.assign(x, { overlap: S.rivals[i % S.rivals.length] }));
    }
    return list;
  }
  function genBrand() {
    const c = cat(), rb = S.real && S.realBrand, b = S.brand || (S.brand = { variant: 0, tones: (rb && rb.tones && rb.tones.length ? rb.tones : c.tones).slice(), headline: (rb && rb.headline) || '' });
    if (rb && rb.colors && b.variant === 0) return { colors: rb.colors, names: rb.names, fonts: rb.fonts || c.fonts, fromSite: true };
    const r = rng(hash(seedBase() + 'b' + b.variant));
    const h = c.hue[0] + r() * (c.hue[1] - c.hue[0]);
    const colors = [hsl(h, 66, 38), hsl(h + 34, 52, 60), hsl(h + 178, 84, 58), hsl(h, 46, 12), hsl(h, 32, 96)];
    return { colors, names: ['Primary', 'Support', 'Accent', 'Ink', 'Paper'], fonts: (rb && rb.fonts) || c.fonts, fromSite: false };
  }

  /* ============================================================ XP, level, toasts */
  const levelFor = (xp) => { let l = 0; LEVELS.forEach((x, i) => { if (xp >= x.at) l = i; }); return l; };
  function toast(msg, cls = '') { const el = document.createElement('p'); el.className = 'toast ' + cls; el.textContent = msg; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 2500); }
  function confetti() {
    if (REDUCE) return;
    const box = $('#confetti'), cols = ['#ECEA36', '#F2F2F2', '#9C9CFF', '#2A2AFF'];
    for (let i = 0; i < 46; i++) { const p = document.createElement('i'); p.style.left = Math.random() * 100 + '%'; p.style.background = cols[i % cols.length]; p.style.animationDelay = Math.random() * .5 + 's'; p.style.width = p.style.height = 6 + Math.floor(Math.random() * 3) * 4 + 'px'; box.appendChild(p); setTimeout(() => p.remove(), 3000); }
  }
  function addXP(key, n) {
    if (S.got[key] != null || n <= 0) return;
    const before = levelFor(S.xp);
    S.got[key] = n; S.xp += n; save(); hud();
    toast('+' + n + ' XP');
    const pill = $('#pillXp'); pill.classList.remove('is-bump'); void pill.offsetWidth; pill.classList.add('is-bump');
    const after = levelFor(S.xp);
    if (after > before) { setTimeout(() => { toast('Level ' + (after + 1) + ' · ' + LEVELS[after].n, 'toast--lvl'); confetti(); }, 500); }
  }

  /* ============================================================ HUD, rail, dock */
  function hud() {
    const l = levelFor(S.xp);
    $('#xpNum').textContent = S.xp; $('#lvlNum').textContent = l + 1; $('#lvlName').textContent = LEVELS[l].n;
    const q = S.step; const done = Math.max(0, q - 1) + (S.step === 8 ? 1 : 0);
    $('#hudLabel').textContent = q === 0 ? 'Press start' : 'Quest ' + q + ' of 8 · ' + QUESTS[q - 1][1];
    $('#hudBar i').style.width = (done / 8 * 100) + '%';
    $('#hudBar').setAttribute('aria-valuenow', done);
  }
  function rail() {
    const el = $('#rail');
    el.innerHTML = '<ol>' + QUESTS.map((q, i) => {
      const idx = i + 1, cls = idx < S.step ? 'is-done' : idx === S.step ? 'is-now' : '';
      const locked = idx > S.max;
      return `<li><button type="button" class="node ${cls}" aria-label="Quest ${idx}: ${q[1]}${idx < S.step ? ', done' : idx === S.step ? ', current' : ''}" data-goto="${idx}" ${locked ? 'disabled' : ''} ${idx === S.step ? 'aria-current="step"' : ''}><span class="node__dot">${idx < S.step ? '✓' : idx}</span><span class="node__txt"><b>${q[1]}</b><span>Quest ${idx}</span></span></button></li>`;
    }).join('') + '</ol>';
  }
  let typeTimer = 0;
  function say(text) {
    const p = $('#bubbleText'); clearInterval(typeTimer);
    if (REDUCE || text.length < 2) { p.textContent = text; return; }
    p.textContent = ''; let i = 0;
    typeTimer = setInterval(() => { p.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typeTimer); }, 14);
  }
  function setClip(name) { const img = $('#coldieImg'); const src = 'assets/mascot/' + name + '.anim.webp'; if (!img.src.endsWith(src)) img.src = src; }
  const LINES = {
    intro: () => 'Hi, I’m Coldie. Give me a few minutes and I’ll read your brand, find your people and get your first Meta ads ready.',
    what: () => 'First things first: what do you sell? Short and honest is perfect.',
    who: () => S.icpMode === 'know' ? 'Tell me who your best customer is, in your own words.' : 'No ICP yet? No problem. Name the brands you think you’re up against and I’ll work the rest out.',
    link: () => 'Point me at your website and Instagram. I’ll do the reading.',
    scan: () => S.scanDone ? 'All done. Here’s what I found.' : 'I’m off! Press space to jump over broken tracking. Grab the yellow events.',
    shelf: () => 'I found ' + S.products.length + ' products. Untick anything that isn’t really yours.',
    icp: () => 'Here’s who I think buys from you. Pick your main ICP, and a backup if you like.',
    brand: () => S.brandLocked ? 'Locked in. That’s your brand book.' : 'Brand book drafted. Tweak the voice, then lock it in.',
    level: () => 'Level up! Next job: your Meta Pixel.'
  };

  /* ============================================================ render scaffolding */
  const stage = $('#stage');
  let cleanup = null, focusKey = '';
  const head = (n, h, sub, extra = '') => `<header class="panel__head"><p class="label"><span>Quest ${n} of 8</span>${extra}</p><h1 class="display" id="h1" tabindex="-1">${h}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</header>`;
  const actions = ({ back = true, next = 'Continue', reward = 0, cls = '' } = {}) => `<div class="actions">${back ? '<button class="btn btn--ghost" type="button" id="back">Back</button>' : '<span></span>'}<div class="actions__right">${reward ? `<span class="reward">+${reward} XP</span>` : ''}<button class="btn ${cls}" type="button" id="next" disabled>${next}</button></div></div>`;
  const SIMTAG = '<span class="tag tag--sim">Simulated preview</span>';
  const LIVETAG = '<span class="tag tag--live">Live scan</span>';
  const tagNow = () => S.real ? LIVETAG : SIMTAG;

  const VALID = {
    intro: () => true,
    what: () => S.product.trim().length >= 3 && !!S.cat,
    who: () => (S.icpMode === 'know' ? S.icpText.trim().length >= 10 : S.rivals.length >= 1 || S.noRivals) && !!S.rev,
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
    if (!keep) { const h1 = $('#h1'); if (h1) { h1.focus({ preventScroll: true }); scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' }); } }
    if (focusKey) { const f = $('[data-key="' + focusKey + '"]'); if (f) f.focus({ preventScroll: true }); focusKey = ''; }
  }
  const rerender = (key) => { focusKey = key || ''; go(S.step, true); };
  const AWARD = { what: 50, who: 50, link: 50, shelf: 50, icp: 100, brand: 100 };
  function advance() {
    const id = STEPS[S.step];
    if (!VALID[id]()) return;
    if (AWARD[id]) addXP(id, AWARD[id]);
    if (id === 'link') { S.products = genProducts(); S.icps = genIcps(); S.scanDone = false; S.scanScore = 0; S.real = false; S.realBrand = null; S.scanError = ''; S.sources = null; S.picks = []; S.brand = null; S.brandLocked = false; }
    go(S.step + 1);
  }

  /* ============================================================ R: step markup */
  const R = {};

  R.intro = () => `<div class="panel intro">
    <header class="panel__head"><p class="label"><span>Coldstart · early access</span></p><h1 class="display" id="h1" tabindex="-1">Wake up Coldie<span class="blink">_</span></h1>
    <p class="sub">Eight quick quests. Tell Coldie what you sell, send it to read your website and catalogue, and walk away with a product list, your ICPs and a brand book.</p></header>
    <div class="teasers">
      <div class="teaser"><p class="label">Read</p><p>Your website and store catalogue, scanned for every product you sell, with photos and prices.</p></div>
      <div class="teaser"><p class="label">Know</p><p>Who actually buys from you, written up as ICP cards you can edit.</p></div>
      <div class="teaser"><p class="label">Launch</p><p>A brand book and a first Meta ad preview, ready for your Pixel.</p></div>
    </div>
    <div class="actions"><span class="hint">${apiOk ? 'About four minutes. Coldie really reads your website.' : 'About four minutes. Preview mode: results are simulated.'}</span><div class="actions__right"><span class="reward">Earn XP as you go</span><button class="btn btn--on-blue" type="button" id="next">Start quest</button></div></div></div>`;

  R.what = () => `<div class="panel">${head(1, 'What do you sell?', 'One line is plenty. Coldie uses it to guess your category and what to look for.')}
    <div class="field"><label for="product">Your product</label><input class="input" id="product" type="text" maxlength="80" autocomplete="off" placeholder="e.g. hand-poured soy candles" value="${esc(S.product)}"><p class="err" id="e-product"></p></div>
    <div class="field"><span class="lbl" id="catlbl">Closest category</span><div class="chips" role="radiogroup" aria-labelledby="catlbl">${CAT_KEYS.map((k) => `<button type="button" class="chip" role="radio" aria-checked="${S.cat === k}" data-cat="${k}" data-key="cat-${k}">${CATS[k].label}</button>`).join('')}</div></div>
    ${actions({ back: true, reward: 50 })}</div>`;

  R.who = () => {
    const know = S.icpMode === 'know';
    return `<div class="panel">${head(2, 'Who buys it?', 'If you already know your ICP, tell Coldie. If not, name the brands you think you compete with and Coldie works backwards.')}
    <div class="seg" role="radiogroup" aria-label="Do you know your ICP?"><button type="button" role="radio" aria-checked="${know}" data-mode="know" data-key="m-know">I know my ICP</button><button type="button" role="radio" aria-checked="${!know}" data-mode="help" data-key="m-help">Help me find it</button></div>
    ${know ? `<div class="field"><label for="icptext">Describe your best customer</label><textarea class="textarea" id="icptext" maxlength="240" placeholder="e.g. Women 28–40 who care about clean ingredients and buy gifts for friends">${esc(S.icpText)}</textarea><p class="hint">Who they are, what they care about, where they shop.</p></div>`
      : `<div class="field"><label for="rivalin">Brands you think you compete with</label><div class="tagbox" id="tagbox">${S.rivals.map((r, i) => `<span class="t">${esc(r)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(r)}">×</button></span>`).join('')}<input id="rivalin" data-key="rivalin" type="text" maxlength="40" placeholder="${S.rivals.length ? 'Add another' : 'Type a brand and press Enter'}" ${S.rivals.length >= 5 ? 'disabled' : ''}></div>
      <label class="check"><input type="checkbox" id="norivals" ${S.noRivals ? 'checked' : ''}> I’m not sure yet, let Coldie find them</label></div>`}
    <div class="field"><span class="lbl" id="revlbl">Current revenue range</span><div class="ladder" role="radiogroup" aria-labelledby="revlbl">${REV.map((r) => `<button type="button" role="radio" aria-checked="${S.rev === r.k}" data-rev="${r.k}" data-key="rev-${r.k}"><b>${r.t}</b><span>${r.s}</span></button>`).join('')}</div></div>
    ${S.rev ? `<div class="note range-note" id="rangenote"><span><b>Got it.</b> Coldie will look for ${esc(cat().label.toLowerCase())} brands at ${esc(revLabel())} so you can see where you stand.</span><span class="skel" aria-hidden="true"><i></i><i></i><i></i></span></div>` : ''}
    ${actions({ reward: 50 })}</div>`;
  };

  R.link = () => `<div class="panel">${head(3, 'Link up', 'Coldie reads your website and Instagram to build the full product list. Skip either one if you don’t have it yet.')}
    <div class="cols2">
      <div class="field"><label for="site">Website</label><input class="input" id="site" type="text" inputmode="url" autocomplete="off" placeholder="yourbrand.com" value="${esc(S.site)}" ${S.noSite ? 'disabled' : ''}><label class="check"><input type="checkbox" id="nosite" ${S.noSite ? 'checked' : ''}> I don’t have a website yet</label><p class="err" id="e-site"></p></div>
      <div class="field"><label for="ig">Instagram</label><div class="input-pre"><span>@</span><input class="input" id="ig" type="text" autocomplete="off" placeholder="yourbrand" value="${esc(S.ig.replace(/^@/, ''))}" ${S.noIG ? 'disabled' : ''}></div><label class="check"><input type="checkbox" id="noig" ${S.noIG ? 'checked' : ''}> I’m not on Instagram yet</label><p class="err" id="e-ig"></p></div>
    </div>
    ${apiOk ? `<div class="note"><b>Coldie reads your site for real.</b> Your public product catalogue, copy, colours and fonts. Instagram reading needs a data provider on this server; until then Coldie says so instead of guessing.</div>` : `<div class="note note--warn"><b>This is a preview.</b> Coldie’s scan below is a simulation: it builds sample results from what you type and does not visit your site or Instagram.</div>`}
    ${actions({ next: 'Send Coldie in', reward: 50, cls: 'btn--yellow' })}</div>`;

  const STAGE_NAMES = () => [(!S.noSite && parseSite(S.site)) ? 'Crawl your website' : 'Read your description', (!S.noIG && parseIG(S.ig)) ? 'Read your Instagram' : 'Skip Instagram', 'Build the product list', 'Work out your ICP', 'Draft your brand book'];
  R.scan = () => {
    const names = STAGE_NAMES(), done = S.scanDone, info = S.scanInfo || { pages: 0, posts: 0, products: 0, signals: 0 };
    return `<div class="panel">${head(4, done ? 'Scan complete' : 'Coldie is on the case', done ? (S.real ? 'Here’s what Coldie read from your site.' : 'Here’s what the simulated scan came back with.' + (S.scanError ? ' (Live scan failed: ' + esc(S.scanError) + ')' : '')) : 'Jump the broken tracking and grab the yellow events while Coldie reads. Your score turns into XP.', tagNow())}
    ${done ? '' : `<div class="arena" id="arena"><canvas id="cv" aria-label="MetaCroc: Coldie runs along a track. Press space, up arrow or tap to jump over duplicate pixels and rejected ads, and collect yellow events." role="img"></canvas>
      <div class="arena__hud"><span>MetaCroc</span><span>Shields <span class="pips" id="pips"><i></i><i></i><i></i></span></span><span>Score <b id="score">0</b></span></div>
      <div class="arena__msg" id="armsg"><p>Space · ↑ · tap to jump</p></div></div>
    <div class="arena__ctl"><p class="hint">Space or ↑ to jump. On touch, tap the game.</p><div class="actions__right"><button class="btn btn--ghost btn--small" type="button" id="auto" aria-pressed="false">Watch instead</button><button class="btn btn--ghost btn--small" type="button" id="ff">Fast-forward</button></div></div>`}
    <div class="stages" id="stages">${names.map((n, i) => { const igNo = done && i === 1 && S.real && S.sources && S.sources.instagram && S.sources.instagram.status !== 'ok' && S.sources.instagram.status !== 'skipped'; return `<div class="stg ${done && !igNo ? 'is-done' : ''} ${igNo ? 'is-skip' : ''}" data-i="${i}"><span class="stg__ic">${igNo ? '–' : done ? '✓' : i + 1}</span><div class="stg__main"><b>${esc(igNo ? 'Instagram not read yet (needs a data provider)' : n)}</b><div class="stg__bar"><i style="width:${done && !igNo ? 100 : 0}%"></i></div></div><span class="stg__pct">${igNo ? 'skipped' : done ? '100%' : '0%'}</span></div>`; }).join('')}</div>
    <div class="bag" id="bag"><div><b data-c="pages">${done ? info.pages : 0}</b><span>pages read</span></div><div><b data-c="posts">${done ? info.posts : 0}</b><span>posts read</span></div><div><b data-c="products">${done ? info.products : 0}</b><span>products</span></div><div><b data-c="signals">${done ? info.signals : 0}</b><span>audience signals</span></div></div>
    ${done ? '' : '<div class="log" id="log" aria-hidden="true"></div>'}
    ${done && S.products.some((p) => p.image) ? `<div class="found"><p class="label">Found on your site</p><div class="found__row">${S.products.filter((p) => p.image).slice(0, 12).map((p) => `<span class="found__item" title="${esc(p.name)}"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer"></span>`).join('')}</div></div>` : ''}
    <div class="result" id="result" ${done ? '' : 'hidden'}><b id="rscore">${S.scanScore}</b><p>MetaCroc score. Coldie banked <b style="font-size:inherit;display:inline;color:var(--accent)">${clamp(Math.round(S.scanScore / 2), 30, 150)} XP</b> from it.</p></div>
    ${actions({ next: 'See what Coldie found', cls: 'btn--yellow' })}</div>`;
  };

  // Prices in the store's own currency (Shopify /cart.js), never a hard-coded dollar sign.
  const money = (v, cur) => { if (!v) return ''; const c = cur || (S.realBrand && S.realBrand.currency) || 'USD'; try { return new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(v); } catch (e) { return c + ' ' + v; } };
  const grow = (t) => { if (!t) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  document.addEventListener('error', (e) => { const im = e.target; if (!im || im.tagName !== 'IMG') return; const box = im.closest('.prod__img, .ad__media, .shot, .found__item, .icp__shelf i, .ad__car figure'); if (box) { box.classList.remove('has-photo'); box.classList.add('no-photo'); im.remove(); } }, true);
  const initials = (s) => s.split(/\s+/).slice(0, 2).map((w) => (w[0] || '').toUpperCase()).join('') || '?';
  const srcTag = { site: '<span class="src">site</span>', ig: '<span class="src src--ig">instagram</span>', both: '<span class="src">site</span><span class="src src--ig">instagram</span>', brief: '<span class="src">your brief</span>', you: '<span class="src">added by you</span>' };
  let shelfFilter = 'all';
  R.shelf = () => {
    const list = S.products.filter((p) => shelfFilter === 'all' || p.src === shelfFilter || (p.src === 'both' && shelfFilter !== 'brief'));
    const nSite = S.products.filter((p) => p.src === 'site' || p.src === 'both').length, nIG = S.products.filter((p) => p.src === 'ig' || p.src === 'both').length;
    return `<div class="panel">${head(5, 'Your product shelf', S.real ? (S.sources && S.sources.shopify && S.sources.shopify.status === 'ok' ? 'Straight from your store’s catalogue. Untick anything you don’t want Coldie to market.' : 'What Coldie could read from your site. Rename, untick or add anything so the list matches what you really sell.') : 'Coldie’s sample list from your site and Instagram. Rename, untick or add anything so the list matches what you really sell.', tagNow())}
    <div class="shelf-top"><p class="hint"><b>${S.products.length}</b> products · <b>${nSite}</b> from site · <b>${nIG}</b> from Instagram · <b>${S.products.filter((p) => p.on).length}</b> included</p>
      <div class="seg" role="radiogroup" aria-label="Filter by source">${[['all', 'All'], ['site', 'Site'], ['ig', 'Instagram']].map((f) => `<button type="button" role="radio" aria-checked="${shelfFilter === f[0]}" data-filter="${f[0]}" data-key="f-${f[0]}">${f[1]}</button>`).join('')}</div></div>
    <div class="grid-p" id="grid">${list.map((p) => `<div class="prod ${p.on ? '' : 'is-off'} ${p.isNew ? 'is-new' : ''}" data-id="${p.id}"><div class="prod__img ${p.image ? 'has-photo' : ''}" style="background:${hsl(p.hue || 220, 55, 42)}">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer" data-main="${p.id}">` : ''}<span class="prod__ini">${esc(initials(p.name))}</span></div>${(p.images || []).length > 1 ? `<div class="prod__thumbs" role="group" aria-label="More photos of ${esc(p.name)}">${p.images.slice(0, 4).map((u, k) => `<button type="button" class="prod__thumb ${u === p.image ? 'is-on' : ''}" data-thumb="${p.id}" data-src="${esc(u)}" aria-label="Photo ${k + 1}" aria-pressed="${u === p.image}"><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>` : ''}<div class="prod__body"><textarea class="prod__name" rows="2" aria-label="Product name" maxlength="48" data-name="${p.id}" placeholder="Product name">${esc(p.name)}</textarea><div class="prod__meta">${p.price ? `<span>${money(p.price, p.currency)}</span>` : ''}${srcTag[p.src] || ''}${p.posts ? `<span>${p.posts} posts</span>` : ''}</div><label class="check prod__inc"><input type="checkbox" data-on="${p.id}" ${p.on ? 'checked' : ''}> Include</label></div></div>`).join('')}</div>
    <div><button class="btn btn--ghost btn--small" type="button" id="addprod">+ Add a product</button></div>
    ${actions({ reward: 50 })}</div>`;
  };

  const avatar = (seed, size = 56) => {
    const r = rng(hash(seed)), h = Math.floor(r() * 360), cols = [hsl(h, 70, 55), hsl(h + 40, 70, 75), '#F2F2F2', '#000091'];
    let cells = ''; const N = 7;
    for (let y = 0; y < N; y++) for (let x = 0; x < 4; x++) { if (r() > .48) { const c = cols[Math.floor(r() * 2)]; cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; if (x < 3) cells += `<rect x="${N - 1 - x}" y="${y}" width="1" height="1" fill="${c}"/>`; } }
    return `<svg class="icp__av" viewBox="0 0 ${N} ${N}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="Pixel portrait"><rect width="${N}" height="${N}" fill="${cols[2]}"/>${cells}</svg>`;
  };
  let adding = false, editing = '';
  R.icp = () => `<div class="panel">${head(6, 'Your ICPs', S.real ? 'Coldie read your site and drafted these. Each one shows the evidence it came from. Pick your main ICP, plus a backup.' : 'Coldie turned the scan into ICP cards. Pick your main one, plus a backup if you like. Edit the hook so it sounds like you.', tagNow())}
    <div class="bench"><span class="label">${S.real ? 'Brands you named' : 'Brands in your range'}</span>${(S.real ? (S.rivals.length ? S.rivals : ['none named']) : cat().rivals).map((x) => `<span class="src">${esc(x)}</span>`).join('')}<span class="hint">${S.real ? 'ICPs drafted from your site copy and catalogue.' : 'Sample archetypes at ' + esc(revLabel() || 'your range') + '.'}</span></div>
    <div class="grid-i" id="icps">${S.icps.map((p) => {
      const idx = S.picks.indexOf(p.id);
      return `<article class="icp ${idx > -1 ? 'is-picked' : ''}" data-card="${p.id}">${idx > -1 ? `<span class="badge">${idx === 0 ? '★ Main ICP' : 'Backup'}</span>` : ''}
      <div class="icp__top">${avatar(p.id + p.name + seedBase())}<div><h3>${esc(p.name)}</h3><p class="who">${esc(p.who)}</p></div></div>
      ${(() => { const ph = S.products.filter((x) => x.on && x.image); if (!ph.length) return ''; const k = S.icps.indexOf(p), pick = [0, 1, 2].map((j) => ph[(k * 3 + j) % ph.length]).filter((x, j, a) => a.indexOf(x) === j); return `<div class="icp__shelf" aria-label="Products Coldie would feature for ${esc(p.name)}">${pick.map((x) => `<i><img src="${esc(x.image)}" alt="${esc(x.name)}" loading="lazy" referrerpolicy="no-referrer"></i>`).join('')}<span class="label">Lead products</span></div>`; })()}
      <dl><div><dt>Pain</dt><dd>${esc(p.pain)}</dd></div><div><dt>Scrolls</dt><dd>${p.scroll.map(esc).join(' · ')}</dd></div>${p.overlap ? `<div><dt>Overlaps with</dt><dd>${esc(p.overlap)} followers</dd></div>` : ''}<div><dt>Meta format</dt><dd>${esc(p.fmt)}</dd></div><div><dt>Hook</dt><dd>${editing === p.id ? `<input class="icp__hook" data-key="hook-${p.id}" data-hook="${p.id}" value="${esc(p.hook)}" maxlength="80" aria-label="Ad hook">` : `“${esc(p.hook)}”`}</dd></div>${p.evidence ? `<div><dt>Evidence</dt><dd class="evidence">${esc(p.evidence)}</dd></div>` : ''}<div><dt>Signal</dt><dd>${esc(p.level)}${p.mine || p.real ? '' : ' · ' + p.signals + ' sample signals'}</dd></div></dl>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn--small ${idx > -1 ? '' : 'btn--ghost'}" data-pick="${p.id}" data-key="pick-${p.id}" aria-pressed="${idx > -1}">${idx === 0 ? 'Main ICP ✓' : idx === 1 ? 'Backup ✓' : 'Pick this ICP'}</button><button type="button" class="btn btn--ghost btn--small" data-edit="${p.id}" data-key="edit-${p.id}">${editing === p.id ? 'Done' : 'Edit hook'}</button></div></article>`;
    }).join('')}
      ${adding ? `<div class="add-form"><div class="cols2"><div class="field"><label for="cn">Name</label><input class="input" id="cn" maxlength="40" placeholder="e.g. The Gift Planner"></div><div class="field"><label for="cw">Who they are</label><input class="input" id="cw" maxlength="100" placeholder="e.g. 30–45, buys for friends"></div></div><div style="display:flex;gap:10px"><button class="btn btn--small" type="button" id="cadd">Add ICP</button><button class="btn btn--ghost btn--small" type="button" id="ccancel">Cancel</button></div></div>` : `<button type="button" class="card-add" id="addicp">+ Add my own ICP</button>`}
    </div>
    ${actions({ reward: 100 })}</div>`;

  const bookAd = (b, brand, colors, icp, prod) => {
    const closers = b.tones.slice(0, 2).map((t) => TONES[t]).join(' ');
    const photos = S.products.filter((p) => p.on && p.image), car = icp && /carousel/i.test(icp.fmt || '') && photos.length > 1;
    const media = car ? `<div class="ad__car">${photos.slice(0, 4).map((p) => `<figure><img src="${esc(p.image)}" alt="${esc(p.name)}" referrerpolicy="no-referrer"><figcaption>${esc(p.name)}</figcaption></figure>`).join('')}</div>`
      : photos.length ? `<div class="ad__media has-photo"><img src="${esc(photos[0].image)}" alt="${esc(photos[0].name)}" referrerpolicy="no-referrer"></div><p class="ad__prod">${esc(photos[0].name)}</p>`
      : `<div class="ad__media" style="background:${colors[0]}"><b>${esc(prod)}</b></div>`;
    return `<div class="ad"><div class="ad__head"><span class="ad__av" style="background:${colors[0]}">${esc(initials(brand))}</span><div><b>${esc(brand)}</b><small>Sponsored · preview${car ? ' · carousel' : ''}</small></div></div>
      ${media}
      <p class="ad__text">${(() => { const h = String(b.headline || (icp ? icp.hook : '')).trim(); return esc(h + (h && !/[.!?…”"']$/.test(h) ? '.' : '')); })()} ${esc(closers)}</p>
      <div class="ad__cta"><span>${esc(parseSite(S.site) || 'yourbrand.com')}</span><b style="background:${colors[2]};color:#111">Shop now</b></div></div>`;
  };
  R.brand = () => {
    const g = genBrand(), b = S.brand, brand = brandName(), main = S.icps.find((x) => x.id === S.picks[0]) || S.icps[0];
    const prod = (S.products.find((p) => p.on) || { name: S.product || 'Your product' }).name;
    if (!b.headline && main) b.headline = main.hook;
    const f = g.fonts, style = (s) => ({ serif: 'serif', sans: 'sans', rounded: 'rounded', mono: 'mono' }[s]);
    return `<div class="panel">${head(7, 'Your brand book', g.fromSite ? 'Colours and type come from your live site. Reroll for alternatives, pick three voice words, then lock it in.' : 'Coldie drafted this from your brief. Reroll the colors, pick three voice words, then lock it in.', tagNow())}
    <div class="book"><div class="book__col">
      <div class="sect"><p class="label"><span>Mark</span></p><div class="mark"><span class="mark__logo" style="background:${g.colors[0]}">${esc(initials(brand)[0] || '?')}</span><div><b>${esc(brand)}</b><p class="hint">${esc(parseSite(S.site) || '@' + (parseIG(S.ig) || 'yourbrand'))}</p></div></div></div>
      <div class="sect"><p class="label"><span>Palette</span><button class="btn btn--ghost btn--small" type="button" id="reroll">Reroll</button></p><div class="swatches">${g.colors.map((c, i) => `<button type="button" class="sw" data-copy="${c}" aria-label="${g.names[i]} ${c}, copy"><i style="background:${c}"></i><span>${g.names[i]}<br>${c}</span></button>`).join('')}</div></div>
      <div class="sect"><p class="label"><span>Type</span></p><div class="type-spec"><p class="big ${style(f[2])}">${esc(f[0])}</p><small>Headings · ${g.fromSite ? 'from your site' : 'suggested pairing'}, shown here in a stand-in face</small><p class="big ${style(f[3])}" style="font-size:1.2rem">${esc(f[1])}</p><small>Body</small></div></div>
      <div class="sect"><p class="label"><span>Voice · pick three</span></p><div class="chips">${Object.keys(TONES).map((t) => `<button type="button" class="chip" aria-pressed="${b.tones.includes(t)}" data-tone="${t}" data-key="tone-${t}">${t}</button>`).join('')}</div>
        <div class="say"><p class="yes"><span class="label">Say</span>${esc((S.real && S.realBrand && S.realBrand.say) || TONES[b.tones[0]] || '')}</p><p class="no"><span class="label">Don’t say</span>${S.real && S.realBrand && S.realBrand.dont && S.realBrand.dont.length ? S.realBrand.dont.map((w) => '“' + esc(w) + '”').join(', ') : '“Revolutionary”, “game-changing”, “best ever”.'}</p></div></div>
    </div><div class="book__col"><div class="field"><label for="headline">Ad headline</label><textarea class="input input--area" id="headline" rows="2" maxlength="90">${esc(b.headline)}</textarea></div>
      <div id="adprev">${bookAd(b, brand, g.colors, main, prod)}</div><p class="hint">First Meta ad preview, written from your main ICP and voice. Sample copy, not live.</p></div></div>
    ${S.brandLocked ? '<p class="ok">Brand book locked. You can still go back and edit.</p>' : ''}
    ${actions({ next: S.brandLocked ? 'Continue' : 'Lock brand book', reward: 100, cls: 'btn--yellow' })}</div>`;
  };

  R.level = () => {
    const l = levelFor(S.xp), main = S.icps.find((x) => x.id === S.picks[0]);
    return `<div class="panel final">${head(8, 'Level ' + (l + 1) + ': ' + LEVELS[l].n, 'Coldie knows your brand. Here’s what you built.')}
    <div class="final__top"><ul class="sum"><li>${S.products.filter((p) => p.on).length} products on your shelf</li><li>${S.picks.length} ICP${S.picks.length > 1 ? 's' : ''} picked${main ? ': ' + esc(main.name) : ''}</li><li>Brand book locked</li><li>${S.xp} XP earned</li></ul><img src="assets/mascot/celebrate.anim.webp" alt="Coldie celebrating" width="220" height="220"></div>
    ${S.products.some((p) => p.on && p.image) ? `<div class="wall"><p class="label">Your shelf, ready for ads</p><div class="wall__grid">${S.products.filter((p) => p.on && p.image).slice(0, 8).map((p) => `<span class="shot"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer"></span>`).join('')}</div></div>` : ''}
    <div class="next"><img src="assets/mascot/pixel_setup.anim.webp" alt="Coldie setting up a tracking pixel" width="120" height="120"><div><p class="label">Next quest</p><h2 class="display">Install your Meta Pixel</h2><p class="hint" style="color:var(--paper)">Coldie’s first real job: set up the Pixel and Conversions API, then check them before any ad runs.</p></div></div>
    <form class="signup" id="signup" novalidate><div class="field"><label for="email">Save your progress and get early access</label><input class="input" id="email" type="email" autocomplete="email" placeholder="you@brand.com" value="${esc(S.email)}"></div><button class="btn btn--yellow" type="submit" style="align-self:end">Get early access</button><p class="err" id="e-email" role="alert"></p><p class="ok" id="ok-email" role="status">${S.emailDone ? 'You’re on the list.' : ''}</p></form>
    <div class="actions"><button class="btn btn--ghost" type="button" id="back">Back</button><div class="actions__right"><a class="btn btn--ghost" href="v2.html">Back to the site</a><button class="btn btn--yellow" type="button" id="toapp">Open my workspace →</button></div></div></div>`;
  };

  /* ============================================================ B: step behaviour */
  const B = {};

  B.intro = () => { $('#next').disabled = false; };

  B.what = () => {
    const inp = $('#product');
    inp.addEventListener('input', () => { S.product = inp.value; save(); refreshNext(); });
    stage.addEventListener('click', onWhat);
    return () => stage.removeEventListener('click', onWhat);
  };
  function onWhat(e) { const c = e.target.closest('[data-cat]'); if (!c) return; S.cat = c.dataset.cat; save(); rerender(c.dataset.key); }

  B.who = () => {
    stage.addEventListener('click', onWho);
    const ta = $('#icptext'); if (ta) ta.addEventListener('input', () => { S.icpText = ta.value; save(); refreshNext(); });
    const ri = $('#rivalin');
    if (ri) {
      const add = () => { const v = ri.value.replace(/,/g, '').trim(); if (v && S.rivals.length < 5 && !S.rivals.some((x) => x.toLowerCase() === v.toLowerCase())) { S.rivals.push(v); S.noRivals = false; save(); rerender('rivalin'); } };
      ri.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !ri.value && S.rivals.length) { S.rivals.pop(); save(); rerender('rivalin'); } });
      ri.addEventListener('blur', () => { if (ri.value.trim()) add(); });
    }
    const nr = $('#norivals'); if (nr) nr.addEventListener('change', () => { S.noRivals = nr.checked; if (nr.checked) S.rivals = []; save(); rerender(); });
    return () => stage.removeEventListener('click', onWho);
  };
  function onWho(e) {
    const m = e.target.closest('[data-mode]'); if (m) { S.icpMode = m.dataset.mode; save(); say(LINES.who()); return rerender(m.dataset.key); }
    const r = e.target.closest('[data-rev]'); if (r) { S.rev = r.dataset.rev; save(); return rerender(r.dataset.key); }
    const x = e.target.closest('[data-rm]'); if (x) { S.rivals.splice(+x.dataset.rm, 1); save(); rerender('rivalin'); }
  }

  B.link = () => {
    const site = $('#site'), ig = $('#ig');
    const val = () => {
      $('#e-site').textContent = !S.noSite && S.site && !parseSite(S.site) ? 'That doesn’t look like a web address. Try yourbrand.com' : '';
      $('#e-ig').textContent = !S.noIG && S.ig && !parseIG(S.ig) ? 'Instagram handles use letters, numbers, dots and underscores.' : '';
      site.setAttribute('aria-invalid', !!$('#e-site').textContent); ig.setAttribute('aria-invalid', !!$('#e-ig').textContent);
      refreshNext();
    };
    site.addEventListener('input', () => { S.site = site.value; save(); val(); });
    ig.addEventListener('input', () => { S.ig = ig.value; save(); val(); });
    site.addEventListener('blur', val); ig.addEventListener('blur', val);
    $('#nosite').addEventListener('change', (e) => { S.noSite = e.target.checked; save(); rerender(); });
    $('#noig').addEventListener('change', (e) => { S.noIG = e.target.checked; save(); rerender(); });
  };

  /* ---- scan + MetaCroc ---- */
  const SPR = [
    ['....hhhh....', '..hhHHhhhh..', '.hhhhhhhhhh.', 'hhhhhhhhhhhh', '.vvvvvvvvvv.', '.vvevvvvevv.', '.vvvvvvvvvv.', '..wwwwwwww..', '.wwwwbbwwww.', '.wwwwbbwwww.', '..wwwwwwww..', '...wwwwww...', '...ww..ww...', '..ww....ww..'],
    ['....hhhh....', '..hhHHhhhh..', '.hhhhhhhhhh.', 'hhhhhhhhhhhh', '.vvvvvvvvvv.', '.vvevvvvevv.', '.vvvvvvvvvv.', '..wwwwwwww..', '.wwwwbbwwww.', '.wwwwbbwwww.', '..wwwwwwww..', '...wwwwww...', '...wwwwww...', '....wwww....']
  ];
  const PAL = { h: '#3B5BFF', H: '#9FB0FF', v: '#050533', e: '#ECEA36', w: '#F2F2F2', b: '#0000C2' };
  const EVENTS = ['PageView', 'AddToCart', 'Lead', 'Purchase'];

  function createGame(canvas, opt) {
    const W = 220, H = 64, G = 52, PH = 14;
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false;
    const g = { score: 0, shields: 3, pickups: 0, hits: 0, auto: !!opt.auto, running: false };
    let y = G - PH, vy = 0, f = 0, speed = 1.3, obs = [], pk = [], fl = [], nextIn = 50, scroll = 0, inv = 0, stun = 0, dist = 0, evi = 0, raf = 0, last = 0, acc = 0;
    const stars = Array.from({ length: 28 }, (_, i) => [(i * 37 + 11) % W, 4 + ((i * 53) % 34)]);
    const onGround = () => y >= G - PH - 0.01;
    g.jump = () => { if (onGround() && stun <= 0) vy = -5.2; };
    const px = (x, yy, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(yy), w, h); };
    function spawn() {
      const r = Math.random();
      if (r < .5) obs.push({ x: W + 4, w: 8, h: 8, k: 'ad' });
      else obs.push({ x: W + 4, w: 6, h: 11, k: 'dup' });
      if (Math.random() < .65) pk.push({ x: W + 4 + (obs[obs.length - 1].w - 5) / 2, y: G - 30, ev: EVENTS[evi++ % 4] });
      if (Math.random() < .4) pk.push({ x: W + 60, y: G - 9, ev: EVENTS[evi++ % 4] });
      nextIn = 80 + Math.random() * 70;
    }
    function step() {
      speed = 1.3 + Math.min(.5, dist / 9000);
      if (--nextIn <= 0) spawn();
      if (g.auto && onGround()) { const o = obs.find((q) => q.x > 34); if (o) { const d = o.x - 34; if (d > 7 && d < 13) g.jump(); } }
      vy += .38; y += vy; if (y > G - PH) { y = G - PH; vy = 0; }
      obs.forEach((o) => { o.x -= speed; }); pk.forEach((p) => { p.x -= speed; });
      obs = obs.filter((o) => o.x > -12); pk = pk.filter((p) => p.x > -8);
      dist += speed; scroll += speed; f++;
      if (stun > 0) stun--; if (inv > 0) inv--;
      const px0 = 26, px1 = 34, py0 = y + 2, py1 = y + PH;
      if (!inv && stun <= 0) for (const o of obs) {
        const oy = G - o.h;
        if (px1 > o.x + 1 && px0 < o.x + o.w - 1 && py1 > oy + 1 && py0 < G) {
          g.hits++; g.shields--; inv = 70; fl.push({ t: '-1', x: 28, y: y - 2, life: 36, col: '#FF8FB0' });
          if (g.shields <= 0) { stun = 50; g.shields = 3; g.score = Math.max(0, g.score - 20); opt.onFaceplant && opt.onFaceplant(); }
          opt.onHit && opt.onHit(g);
          break;
        }
      }
      pk = pk.filter((p) => { if (px1 + 2 > p.x && px0 - 2 < p.x + 5 && py1 > p.y && py0 < p.y + 5) { g.score += 10; g.pickups++; fl.push({ t: p.ev, x: p.x - 10, y: p.y - 4, life: 40, col: '#ECEA36' }); opt.onPickup && opt.onPickup(g); return false; } return true; });
      if (f % 20 === 0) g.score += 1;
      fl.forEach((q) => { q.y -= .35; q.life--; }); fl = fl.filter((q) => q.life > 0);
    }
    function draw() {
      px(0, 0, W, H, '#00006A');
      stars.forEach((s, i) => px((s[0] - scroll * (.1 + (i % 3) * .05) + W * 4) % W, s[1], 1, 1, i % 4 ? '#2A2AFF' : '#9C9CFF'));
      px(0, G, W, H - G, '#0000F2'); px(0, G, W, 1, '#9C9CFF');
      for (let x = -12; x < W + 12; x += 12) px(x - (scroll % 12), G + 5, 4, 1, '#2A2AFF');
      pk.forEach((p) => { const col = (f >> 3) % 2 ? '#ECEA36' : '#FFF47A'; px(p.x + 2, p.y, 1, 5, col); px(p.x, p.y + 2, 5, 1, col); px(p.x + 1, p.y + 1, 3, 3, col); });
      obs.forEach((o) => {
        const oy = G - o.h;
        if (o.k === 'ad') { px(o.x, oy, o.w, o.h, '#FF5C8A'); for (let i = 1; i < 7; i++) { px(o.x + i, oy + i, 1, 1, '#00006A'); px(o.x + 7 - i, oy + i, 1, 1, '#00006A'); } }
        else { px(o.x, oy, o.w, 5, '#FF5C8A'); px(o.x, oy + 6, o.w, 5, '#FF5C8A'); px(o.x + 1, oy + 1, 1, 1, '#FFC2D4'); px(o.x + 1, oy + 7, 1, 1, '#FFC2D4'); }
      });
      if (!(inv > 0 && (f >> 2) % 2)) {
        const fr = !onGround() ? 0 : ((f >> 3) % 2);
        const rows = SPR[fr], ox = stun > 0 ? 0 : 0, oy = Math.round(y) + (stun > 0 ? 4 : 0);
        rows.forEach((row, ry) => { for (let rx = 0; rx < 12; rx++) { const ch = row[rx]; if (ch !== '.') px(24 + rx + ox, oy + ry, 1, 1, PAL[ch]); } });
      }
      c.font = '6px monospace'; c.textBaseline = 'top';
      fl.forEach((q) => { c.fillStyle = q.col; c.fillText(q.t, Math.round(q.x), Math.round(q.y)); });
    }
    g.start = () => { g.running = true; last = performance.now(); const loop = (t) => { if (!g.running) return; acc += Math.min(100, t - last); last = t; while (acc >= 1000 / 60) { step(); acc -= 1000 / 60; } draw(); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); };
    g.stop = () => { g.running = false; cancelAnimationFrame(raf); };
    draw();
    return g;
  }

  B.scan = () => {
    if (S.scanDone) return null;
    const hasSite = !S.noSite && parseSite(S.site), hasIG = !S.noIG && parseIG(S.ig);
    const d = parseSite(S.site) || 'your-site', h = parseIG(S.ig) || 'yourbrand', r = rng(hash(seedBase() + 's'));
    const nProd = S.products.length, pages = nProd + 5 + Math.floor(r() * 8), posts = 24 + Math.floor(r() * 13), tagged = Math.max(3, Math.floor(posts * (.3 + r() * .3))), signals = S.icps.reduce((a, x) => a + x.signals, 0);
    const info = { pages: hasSite ? pages : 0, posts: hasIG ? posts : 0, products: nProd, signals };
    const nSite = S.products.filter((p) => p.src === 'site').length, nBoth = S.products.filter((p) => p.src === 'both').length, nIG = S.products.filter((p) => p.src === 'ig').length;
    const L = [
      hasSite ? [['fetching ' + d + '/', .05], ['reading sitemap.xml', .25], ['/collections/all: ' + pages + ' pages', .5], ['found shipping, returns and about pages', .75], ['pulled logo and brand colors', .92]]
        : [['no website: reading your description', .1], ['"' + S.product.trim().slice(0, 36) + '" → ' + cat().label.toLowerCase(), .6]],
      hasIG ? [['opening @' + h, .05], ['reading last ' + posts + ' posts', .3], [tagged + ' posts tag products', .6], ['top themes: behind the scenes, product close-ups', .85]]
        : [['no Instagram: skipping', .3]],
      [['matching posts to product pages', .1], ['merged ' + nProd + ' products', .5], [nSite + ' site · ' + nIG + ' instagram · ' + nBoth + ' both', .85]],
      [['reading captions, comments and reviews', .1], [signals + ' audience signals', .45], ['comparing with ' + cat().label.toLowerCase() + ' brands at ' + (revLabel() || 'your range'), .75], ['drafted ' + S.icps.length + ' ICP cards', .95]],
      [['choosing a palette', .15], ['pairing typefaces', .45], ['writing a voice guide', .75]]
    ];
    const D = 30000, MIN = 14000;
    let live = null, liveDone = !apiOk, liveFail = '';
    if (apiOk) {
      api('plugins/onboard/actions/scan', { product: S.product, cat: S.cat, site: S.site, ig: S.ig, noSite: S.noSite, noIG: S.noIG, icpMode: S.icpMode, icpText: S.icpText, rivals: S.rivals, rev: S.rev })
        .then((r) => { live = r; }).catch((er) => { liveFail = er.message; }).finally(() => { liveDone = true; });
    }
    const canvas = $('#cv'), arena = $('#arena');
    const game = createGame(canvas, {
      auto: REDUCE,
      onHit: (g) => { $$('#pips i').forEach((el, i) => el.classList.toggle('off', i >= g.shields)); },
      onFaceplant: () => { setClip('faceplant'); say('Ouch. Shields back up, keep going!'); setTimeout(() => { if (STEPS[S.step] === 'scan' && !S.scanDone) setClip('run_loop'); }, 1600); },
      onPickup: (g) => { $('#score').textContent = g.score; }
    });
    const autoBtn = $('#auto');
    const setAuto = (on) => { game.auto = on; autoBtn.setAttribute('aria-pressed', on); autoBtn.textContent = on ? 'Take over' : 'Watch instead'; };
    if (REDUCE) setAuto(true);
    autoBtn.addEventListener('click', () => setAuto(!game.auto));
    let ff = false; $('#ff').addEventListener('click', () => { ff = true; setAuto(true); $('#ff').disabled = true; });
    const onKey = (e) => { if ((e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); game.jump(); $('#armsg').hidden = true; } };
    const onTap = (e) => { game.jump(); $('#armsg').hidden = true; };
    document.addEventListener('keydown', onKey); arena.addEventListener('pointerdown', onTap);
    game.start();
    setTimeout(() => { const m = $('#armsg'); if (m) m.hidden = true; }, 2600);
    $$('#stages .stg')[0].classList.add('is-now');
    let elapsed = 0, pp = 0, prev = performance.now(); const fired = new Set();
    const log = $('#log');
    const pushLog = (t) => { const p = document.createElement('p'); p.textContent = t; log.appendChild(p); while (log.children.length > 8) log.firstChild.remove(); };
    const setC = (k, v) => { const el = $('[data-c="' + k + '"]'); if (el) el.textContent = v; };
    const timer = setInterval(() => {
      const now = performance.now(); elapsed += Math.min(500, now - prev) * (ff ? 8 : 1); prev = now;
      // Simulated: 30 s of play. Live: the bar creeps to 94% while the API works, then runs out once it has
      // answered and the player has had MIN ms of game.
      if (!apiOk) pp = Math.min(1, elapsed / D);
      else if (!liveDone || elapsed < MIN) pp = Math.min(0.94, Math.max(pp, elapsed / D));
      else pp = Math.min(1, pp + 0.04);
      const p = pp, si = Math.min(4, Math.floor(p * 5)), local = (p * 5) - si;
      $$('#stages .stg').forEach((el, i) => {
        const pct = i < si ? 100 : i === si ? Math.round(clamp(local, 0, 1) * 100) : 0;
        el.classList.toggle('is-done', i < si || p >= 1); el.classList.toggle('is-now', i === si && p < 1);
        $('.stg__bar i', el).style.width = (p >= 1 ? 100 : pct) + '%'; $('.stg__pct', el).textContent = (p >= 1 ? 100 : pct) + '%';
        if (i < si || p >= 1) $('.stg__ic', el).textContent = '✓';
      });
      if (!apiOk) L.forEach((lines, i) => lines.forEach((ln, j) => { const key = i + '-' + j; if (!fired.has(key) && (p * 5 >= i + ln[1])) { fired.add(key); pushLog(ln[0]); } }));
      else if (!fired.has('live') ) { fired.add('live'); pushLog(hasSite ? 'fetching ' + d + '/ (live)' : 'reading your description (live)'); if (hasIG) pushLog('@' + h + ': Instagram reading needs a data provider'); }
      const stP = (i) => clamp(p * 5 - i, 0, 1);
      if (!apiOk) { setC('pages', Math.round(info.pages * stP(0))); setC('posts', Math.round(info.posts * stP(1))); setC('products', Math.round(info.products * stP(2))); setC('signals', Math.round(info.signals * stP(3))); }
      if (p >= 1 && liveDone) finish();
    }, 100);
    function finish() {
      clearInterval(timer); game.stop(); cleanup && cleanupInner();
      if (live) {
        S.real = true; S.realBrand = live.brand; S.sources = live.sources; S.scanError = '';
        if (live.products.length) S.products = live.products.map((x, i) => Object.assign({ hue: (i * 47) % 360 }, x));
        S.icps = live.icps; S.picks = [];
        if (S.icpMode === 'know' && S.icpText.trim()) S.icps.unshift({ id: 'iu', name: 'Your customer', who: S.icpText.trim().slice(0, 120), pain: 'Coldie will test this against what it reads', scroll: live.icps[0] ? live.icps[0].scroll : [], hook: live.icps[0] ? live.icps[0].hook : '', fmt: live.icps[0] ? live.icps[0].fmt : '', level: 'You told us', mine: true, real: true });
        Object.assign(info, live.info);
        live.log.forEach(pushLog);
      } else if (liveFail) { S.real = false; S.scanError = liveFail; toast('Live scan failed. Showing a simulated preview.'); }
      S.scanDone = true; S.scanScore = game.score; S.scanInfo = info; save();
      addXP('scan', clamp(Math.round(game.score / 2), 30, 150));
      cleanup = null; go(S.step); say(S.real ? 'Scan done! I read ' + (parseSite(S.site) || 'your brief') + '. Here’s what I found.' : 'Scan done! Here’s what I found.');
    }
    function cleanupInner() { document.removeEventListener('keydown', onKey); arena.removeEventListener('pointerdown', onTap); }
    return () => { clearInterval(timer); game.stop(); cleanupInner(); };
  };

  /* ---- shelf ---- */
  B.shelf = () => {
    const onClick = (e) => {
      const f = e.target.closest('[data-filter]'); if (f) { shelfFilter = f.dataset.filter; return rerender(f.dataset.key); }
      const th = e.target.closest('[data-thumb]');
      if (th) { const p = S.products.find((x) => x.id === th.dataset.thumb); if (p) { p.image = th.dataset.src; save(); const card = th.closest('.prod'), im = $('img[data-main]', card); if (im) { im.src = p.image; } else { const box = $('.prod__img', card); box.classList.add('has-photo'); box.insertAdjacentHTML('afterbegin', `<img src="${esc(p.image)}" alt="${esc(p.name)}" referrerpolicy="no-referrer" data-main="${p.id}">`); } $$('[data-thumb]', card).forEach((b) => { const on = b === th; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); }); } return; }
      if (e.target.closest('#addprod')) { S.products.unshift({ id: 'u' + Date.now(), name: '', price: 0, src: 'you', posts: 0, on: true, hue: 220, isNew: true }); shelfFilter = 'all'; save(); rerender(); const ni = $('.prod__name'); if (ni) ni.focus(); }
    };
    const onInput = (e) => {
      const n = e.target.closest('[data-name]'); if (n) { if (/\n/.test(n.value)) n.value = n.value.replace(/\n/g, ' '); grow(n); const p = S.products.find((x) => x.id === n.dataset.name); if (p) { p.name = n.value; save(); } }
    };
    const onChange = (e) => {
      const o = e.target.closest('[data-on]'); if (!o) return;
      const p = S.products.find((x) => x.id === o.dataset.on); if (p) { p.on = o.checked; save(); o.closest('.prod').classList.toggle('is-off', !p.on); $('.shelf-top .hint').innerHTML = $('.shelf-top .hint').innerHTML.replace(/<b>\d+<\/b> included/, '<b>' + S.products.filter((x) => x.on).length + '</b> included'); refreshNext(); }
    };
    const onKey = (e) => { if (e.key === 'Enter' && e.target.closest('[data-name]')) e.preventDefault(); };
    stage.addEventListener('click', onClick); stage.addEventListener('input', onInput); stage.addEventListener('change', onChange); stage.addEventListener('keydown', onKey);
    $$('.prod__name').forEach(grow); requestAnimationFrame(() => $$('.prod__name').forEach(grow));
    return () => { stage.removeEventListener('keydown', onKey); stage.removeEventListener('click', onClick); stage.removeEventListener('input', onInput); stage.removeEventListener('change', onChange); };
  };

  /* ---- ICP ---- */
  B.icp = () => {
    const pick = (id) => { const i = S.picks.indexOf(id); if (i > -1) S.picks.splice(i, 1); else if (S.picks.length < 2) S.picks.push(id); else S.picks[1] = id; save(); };
    const onClick = (e) => {
      const ed = e.target.closest('[data-edit]'); if (ed) { editing = editing === ed.dataset.edit ? '' : ed.dataset.edit; return rerender(editing ? 'hook-' + ed.dataset.edit : ed.dataset.key); }
      if (e.target.closest('[data-hook]')) return;
      const card = e.target.closest('[data-card]');
      const p = e.target.closest('[data-pick]') || (card && !e.target.closest('button, input') ? card.querySelector('[data-pick]') : null);
      if (p) { pick(p.dataset.pick); const main = S.icps.find((x) => x.id === S.picks[0]); if (main) say('Good pick. “' + main.name + '” it is. I’ll write your first ads for them.'); return rerender(p.dataset.key); }
      if (e.target.closest('#addicp')) { adding = true; return rerender(); }
      if (e.target.closest('#ccancel')) { adding = false; return rerender(); }
      if (e.target.closest('#cadd')) {
        const n = $('#cn').value.trim(), w = $('#cw').value.trim(); if (!n) { $('#cn').focus(); return; }
        const base = cat().icps[0], id = 'c' + Date.now();
        S.icps.push({ id, name: n.slice(0, 40), who: w || 'Added by you', pain: 'You’ll tell Coldie what they struggle with', scroll: base.scroll.slice(), hook: base.hook, fmt: base.fmt, signals: 0, level: 'You told us', mine: true });
        adding = false; pick(id); rerender();
      }
    };
    const onInput = (e) => { const h = e.target.closest('[data-hook]'); if (h) { const p = S.icps.find((x) => x.id === h.dataset.hook); if (p) { p.hook = h.value; save(); } } };
    stage.addEventListener('click', onClick); stage.addEventListener('input', onInput);
    return () => { stage.removeEventListener('click', onClick); stage.removeEventListener('input', onInput); adding = false; editing = ''; };
  };

  /* ---- brand book ---- */
  B.brand = () => {
    const refreshAd = () => { const g = genBrand(), main = S.icps.find((x) => x.id === S.picks[0]) || S.icps[0], prod = (S.products.find((p) => p.on) || { name: S.product || 'Your product' }).name; $('#adprev').innerHTML = bookAd(S.brand, brandName(), g.colors, main, prod); };
    const onClick = (e) => {
      if (e.target.closest('#reroll')) { S.brand.variant++; save(); return rerender(); }
      const t = e.target.closest('[data-tone]');
      if (t) { const b = S.brand, k = t.dataset.tone, i = b.tones.indexOf(k); if (i > -1) { if (b.tones.length > 1) b.tones.splice(i, 1); } else { b.tones.push(k); if (b.tones.length > 3) b.tones.shift(); } save(); return rerender(t.dataset.key); }
      const s = e.target.closest('[data-copy]'); if (s) { try { navigator.clipboard.writeText(s.dataset.copy); } catch (er) { /* clipboard may be blocked */ } toast('Copied ' + s.dataset.copy); }
    };
    const onInput = (e) => { if (e.target.id === 'headline') { if (/\n/.test(e.target.value)) e.target.value = e.target.value.replace(/\n/g, ' '); grow(e.target); S.brand.headline = e.target.value; save(); refreshAd(); } };
    grow($('#headline'));
    stage.addEventListener('click', onClick); stage.addEventListener('input', onInput);
    const nx = $('#next'); const lock = (e) => { if (!S.brandLocked) { e.stopImmediatePropagation(); S.brandLocked = true; save(); addXP('brand', 100); say(LINES.brand()); setTimeout(() => go(S.step + 1), 900); } };
    nx.disabled = false; nx.addEventListener('click', lock, true);
    return () => { stage.removeEventListener('click', onClick); stage.removeEventListener('input', onInput); };
  };

  /* ---- level up ---- */
  B.level = () => {
    setTimeout(confetti, 200);
    const f = $('#signup');
    f.addEventListener('submit', (e) => {
      e.preventDefault(); const v = $('#email').value.trim(), err = $('#e-email');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { err.textContent = 'That email doesn’t look right.'; $('#email').setAttribute('aria-invalid', 'true'); return; }
      err.textContent = ''; $('#email').removeAttribute('aria-invalid'); S.email = v; save();
      const done = (msg) => { S.emailDone = true; save(); $('#ok-email').textContent = msg; addXP('email', 25); say('You’re in! See you on the other side of the Pixel.'); };
      if (!apiOk) return done('Saved in this browser. (Preview mode: nothing was sent.)');
      api('plugins/onboard/actions/signup', { email: v, source: 'onboarding', brand: brandName(), site: S.site }).then((r) => done(r.already ? 'You were already on the list. Progress saved.' : 'You’re on the list.')).catch((er) => { err.textContent = er.message; });
    });
    $('#toapp').addEventListener('click', () => startInBackground());
  };

  /* ============================================================ insights: the analysis runs here, during onboarding */
  // Brand, Instagram, competitor ads, analysis and three ads. One bounded step per call; progress is shown on this page.
  const STAGE_LABEL = [['brand', 'Reading your brand'], ['instagram', 'Reading your Instagram'], ['pull', 'Pulling competitor ads'], ['analyze', 'Reading each ad'], ['synthesize', 'Writing the competitor analysis'], ['write', 'Writing 3 ads'], ['review', 'Reviewing the copy'], ['done', 'Done']];
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  // The kit the ads are drawn with, read from the brand book by colour name (Primary, Paper, Ink).
  function kitFrom(g) {
    const pick = (name) => { const i = (g.names || []).indexOf(name); return i >= 0 ? g.colors[i] : null; };
    return { colors: { primary: pick('Primary') || g.colors[0], background: pick('Paper') || '#F2F2F2', text: pick('Ink') || '#0B0B0B' }, fonts: { heading: (g.fonts || [])[0] || 'Poppins' } };
  }
  function insightsInput() {
    const g = genBrand(), b = S.brand || {}, main = S.icps.find((x) => x.id === S.picks[0]) || S.icps[0], backup = S.icps.find((x) => x.id === S.picks[1]);
    const cur = (S.realBrand && S.realBrand.currency) || 'INR';
    return {
      brand: { name: brandName(), url: parseSite(S.site) ? 'https://' + parseSite(S.site) : '', ig: parseIG(S.ig), line: (S.real && S.realBrand && S.realBrand.line) || S.product.trim(), voice: (b.tones || []).join(', '), avoid: (S.real && S.realBrand && S.realBrand.dont ? S.realBrand.dont : ['revolutionary', 'game-changing', 'best ever']).join(', '), currency: cur, category: cat().label, product: S.product.trim() },
      kit: kitFrom(g),
      products: S.products.filter((p) => p.on).map((p) => ({ name: p.name, price: p.price, image: p.image || null, url: p.url || null })),
      icps: [main, backup].filter(Boolean).map((p, i) => ({ role: i ? 'backup' : 'main', name: p.name, who: p.who, pain: p.pain, hook: p.hook, fmt: p.fmt, scroll: p.scroll, evidence: p.evidence || '' })),
      competitors: S.rivals.slice(),
      country: cur === 'INR' ? 'IN' : 'US',
    };
  }
  // The analysis runs in the background: the workspace picks it up, so nothing is shown here.
  function startInBackground() {
    S.insightsInput = insightsInput(); S.insightsAt = new Date().toISOString(); save();
    handoff(); location.href = 'app.html#/ads?from=onboarding';
  }

  /* ============================================================ hand-off to the workspace */
  // app.html reads this once (js/workspace.js → importOnboarding) and fills brand, products, ICPs, brand book.
  function handoff() {
    const g = genBrand(), b = S.brand || {}, main = S.icps.find((x) => x.id === S.picks[0]) || S.icps[0], backup = S.icps.find((x) => x.id === S.picks[1]);
    const data = {
      v: 1, at: new Date().toISOString(), real: !!S.real,
      brand: { product: S.product.trim(), currency: (S.realBrand && S.realBrand.currency) || null, name: brandName(), url: parseSite(S.site) ? 'https://' + parseSite(S.site) : '', ig: parseIG(S.ig), line: (S.real && S.realBrand && S.realBrand.line) || S.product.trim(), category: cat().label, revenue: revLabel(),
        voice: (b.tones || []).join(', '), avoid: (S.real && S.realBrand && S.realBrand.dont ? S.realBrand.dont : ['revolutionary', 'game-changing', 'best ever']).join(', ') },
      book: { colors: g.colors, names: g.names, fonts: g.fonts, tones: b.tones || [], headline: b.headline || '', say: (S.real && S.realBrand && S.realBrand.say) || '', fromSite: !!g.fromSite, logo: (S.real && S.realBrand && S.realBrand.logo) || null, hero: (S.real && S.realBrand && S.realBrand.hero) || null },
      products: S.products.filter((p) => p.on).map((p) => ({ name: p.name, price: p.price, image: p.image || null, images: (p.images || []).slice(0, 4), url: p.url || null, src: p.src })),
      icps: [main, backup].filter(Boolean).map((p, i) => ({ role: i ? 'backup' : 'main', name: p.name, who: p.who, pain: p.pain, scroll: p.scroll, hook: p.hook, fmt: p.fmt, evidence: p.evidence || '' })),
      competitors: S.rivals.slice(), sources: S.sources || null,
      insights: S.insightsInput ? { at: S.insightsAt, input: S.insightsInput } : null
    };
    try { localStorage.setItem('coldstart.handoff.v1', JSON.stringify(data)); } catch (e) { /* storage blocked */ }
    S.handedOff = true; save();
  }

  /* ============================================================ global wiring */
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-goto]');
    if (n && !n.disabled) go(+n.dataset.goto);
  });
  let sure = 0;
  $('#restart').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!sure) { sure = 1; b.textContent = 'sure?'; setTimeout(() => { sure = 0; b.textContent = 'start over'; }, 3000); return; }
    sure = 0; b.textContent = 'start over'; try { localStorage.removeItem(KEY); } catch (er) { /* ignore */ }
    S = fresh(); shelfFilter = 'all'; go(0);
  });
  // Resume: a scan that was interrupted restarts; everything else comes back as left.
  if (S.step === 4 && !S.scanDone && !S.products.length) { S.products = genProducts(); S.icps = genIcps(); }
  go(S.step);
})();
