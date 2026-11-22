/* Coldstart v3 — Marketing Site Behaviour
   - Preloader & poster-first Coldie clips (prefers-reduced-motion safe)
   - Live "One Order Counted 3×" vs "Coldstart 1× Deduplicated" simulator
   - Filterable Capability Map (LIVE / SANDBOX / SAMPLE / NOT IMPLEMENTED)
   - Live /api/health server probe for honest status reporting
   - Early-access signup form -> /api/plugins/onboard/actions/signup -> onboarding-v3.html */
(() => {
  'use strict';
  const html = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NO_ALPHA_WEBM = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

  /* ---------------------------------------------------------------- 1. Clips (poster-first + reduced-motion) */
  function setupClips() {
    $$('video.clip, video.preloader__coldie').forEach((v) => {
      if (REDUCE) {
        v.removeAttribute('autoplay');
        v.pause();
      }
      if (NO_ALPHA_WEBM && v.dataset.fallback) {
        const img = new Image();
        img.className = v.className;
        img.alt = v.getAttribute('aria-label') || '';
        if (v.hasAttribute('aria-hidden')) img.setAttribute('aria-hidden', 'true');
        img.decoding = 'async';
        img.src = REDUCE ? v.poster : v.dataset.fallback;
        v.replaceWith(img);
      }
    });
    if (REDUCE) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.play().catch(() => {});
        else e.target.pause();
      });
    }, { rootMargin: '80px' });
    $$('video.clip[data-autoplay]').forEach((v) => io.observe(v));

    $$('video[data-once]').forEach((v) => { v.loop = false; });
    $$('details.row').forEach((d) => d.addEventListener('toggle', () => {
      const v = $('video', d);
      if (!v || !d.open || REDUCE) return;
      v.currentTime = 0;
      v.play().catch(() => {});
    }));
  }

  /* ---------------------------------------------------------------- 2. Preloader */
  function preloader() {
    const pre = $('#preloader');
    const ready = () => {
      html.classList.remove('is-loading');
      html.classList.add('is-ready');
    };
    if (!pre) return ready();
    const count = $('#preCount'), status = $('#preStatus'), bar = $('.preloader__bar', pre);
    const cells = Array.from({ length: 20 }, () => bar.appendChild(document.createElement('i')));
    const lines = ['booting coldie_', 'checking meta pixel_', 'deduping event_id_', 'scanning rivals_', 'ready for approval_'];
    const MIN = REDUCE ? 250 : 900, MAX = 3500, t0 = performance.now();
    let shown = 0, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pre.classList.add('is-leaving');
      setTimeout(() => {
        ready();
        if (REDUCE || !window.Dither) return pre.remove();
        pre.classList.add('is-wiping');
        window.Dither.wipe($('.preloader__wipe', pre)).then(() => pre.remove());
      }, 150);
    };
    const tick = (now) => {
      const el = now - t0;
      const target = el > MAX ? 1 : Math.min(1, el / MIN);
      shown += (target - shown) * 0.22;
      if (target === 1 && shown > 0.985) shown = 1;
      const pct = Math.round(shown * 100);
      if (count) count.textContent = String(pct).padStart(3, '0');
      cells.forEach((c, i) => c.classList.toggle('on', i < Math.round(shown * 20)));
      if (status) status.textContent = lines[Math.min(lines.length - 1, Math.floor(shown * lines.length))];
      if (shown < 1) requestAnimationFrame(tick);
      else finish();
    };
    requestAnimationFrame(tick);
    setTimeout(finish, MAX + 500);
  }

  /* ---------------------------------------------------------------- 3. Sticky Bar + Scroll Reveals + Hero Log */
  function chrome() {
    const bar = $('#bar'), pBar = $('#progressBar');
    const themed = $$('main [data-theme]');
    const updateScroll = () => {
      if (bar) {
        bar.classList.toggle('is-on', scrollY > 240);
        const line = bar.offsetHeight / 2 + 4;
        let theme = 'blue';
        for (const s of themed) {
          const r = s.getBoundingClientRect();
          if (r.top <= line && r.bottom > line) theme = s.dataset.theme || 'paper';
        }
        if (bar.dataset.theme !== theme) bar.dataset.theme = theme;
      }
      if (pBar) {
        const max = html.scrollHeight - innerHeight;
        pBar.style.width = (max > 0 ? Math.round((scrollY / max) * 100) : 0) + '%';
      }
    };
    addEventListener('scroll', updateScroll, { passive: true });
    addEventListener('resize', updateScroll);
    updateScroll();

    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -10% 0px' });
    $$('[data-reveal]').forEach((n) => io.observe(n));

    const items = $$('#log li');
    if (items.length) {
      const paint = (n) => items.forEach((li, i) => {
        li.classList.toggle('is-done', i < n);
        li.classList.toggle('is-now', i === n);
        li.firstElementChild.textContent = i < n ? '[x]' : i === n ? '[>]' : '[ ]';
      });
      if (REDUCE) paint(items.length);
      else {
        let n = 0;
        paint(0);
        setInterval(() => { n = (n + 1) % (items.length + 2); paint(Math.min(n, items.length)); }, 1500);
      }
    }
  }

  /* ---------------------------------------------------------------- 4. Interactive "One Sale Counted 3×" Simulator */
  function setupProblemSimulator() {
    const root = $('#problemSim');
    if (!root) return;
    let mode = 'broken'; // 'broken' | 'verified'
    let orderNum = 9042;

    const renderSim = () => {
      const isBroken = mode === 'broken';
      $$('[data-sim-mode]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.simMode === mode)));

      const lanes = $('#simLanes', root);
      const metaBox = $('#simMeta', root);
      const footText = $('#simFootText', root);
      const payloadPre = $('#simPayload', root);

      if (isBroken) {
        lanes.innerHTML = `
          <div class="sim-lane is-bad">
            <div class="sim-lane__top">
              <span class="sim-lane__title">1. Hardcoded Theme Snippet (theme.liquid)</span>
              <span class="status-pill status-pill--unimpl">Counted #1</span>
            </div>
            <div class="sim-lane__code">fbq('track', 'Purchase', { value: 1499, currency: 'INR' }) /* NO eventID */</div>
            <div class="sim-packet" aria-hidden="true"><i></i></div>
          </div>
          <div class="sim-lane is-bad">
            <div class="sim-lane__top">
              <span class="sim-lane__title">2. Shopify Channel Pixel (Customer Events)</span>
              <span class="status-pill status-pill--unimpl">Counted #2</span>
            </div>
            <div class="sim-lane__code">fbq('track', 'Purchase', { value: 1499 }, { eventID: 'sh_881a_random' })</div>
            <div class="sim-packet" aria-hidden="true"><i></i></div>
          </div>
          <div class="sim-lane is-bad">
            <div class="sim-lane__top">
              <span class="sim-lane__title">3. Server CAPI Webhook (Mismatched ID)</span>
              <span class="status-pill status-pill--unimpl">Counted #3</span>
            </div>
            <div class="sim-lane__code">POST /events { "event_name": "Purchase", "event_id": null, "value": 1499 }</div>
            <div class="sim-packet" aria-hidden="true"><i></i></div>
          </div>
        `;
        metaBox.classList.add('is-overcount');
        metaBox.innerHTML = `
          <div>
            <span class="label" style="color:#FF8FB0">Meta Events Manager sees</span>
            <div class="sim-meta__count" style="margin-top:6px">3 Purchases</div>
            <p class="mono" style="font-size:.82rem;margin-top:4px;color:#FF8FB0">Reported: ₹4,497 (3× inflated)</p>
          </div>
          <div style="font-size:.85rem;border-top:1px solid rgba(242,242,242,.2);padding-top:10px">
            <p><strong>Deduplication rate: 0%</strong></p>
            <p style="opacity:.85;margin-top:4px">Meta’s algorithm thinks this ad made 3 sales and bids aggressively on phantom conversions.</p>
          </div>
        `;
        footText.innerHTML = `<strong>Diagnostic:</strong> Without a shared <code>event_id</code> across browser and server, Meta treats all 3 signals as separate orders.`;
        if (payloadPre) {
          payloadPre.textContent = JSON.stringify({
            problem: '3 uncoordinated Purchase events for Shopify order #' + orderNum,
            browser_theme_pixel: { event_name: 'Purchase', event_id: undefined, value: 1499, currency: 'INR' },
            shopify_channel_pixel: { event_name: 'Purchase', event_id: 'sh_881a_random', value: 1499, currency: 'INR' },
            server_capi: { event_name: 'Purchase', event_id: null, value: 1499, currency: 'INR' },
            meta_events_manager_result: { purchases_counted: 3, revenue_recorded_inr: 4497, deduplicated: false }
          }, null, 2);
        }
      } else {
        lanes.innerHTML = `
          <div class="sim-lane is-removed">
            <div class="sim-lane__top">
              <span class="sim-lane__title">1. Legacy Theme Snippet (theme.liquid)</span>
              <span class="status-pill status-pill--sample">Removed after scan</span>
            </div>
            <div class="sim-lane__code">Hardcoded duplicate fbq() detected &amp; removed before launch</div>
          </div>
          <div class="sim-lane is-good">
            <div class="sim-lane__top">
              <span class="sim-lane__title">2. Browser Custom Pixel (Shopify Customer Events)</span>
              <span class="status-pill status-pill--live">event_id: order_${orderNum}</span>
            </div>
            <div class="sim-lane__code">fbq('track', 'Purchase', { value: 1499, currency: 'INR' }, { eventID: 'order_${orderNum}' })</div>
            <div class="sim-packet" aria-hidden="true"><i></i></div>
          </div>
          <div class="sim-lane is-good">
            <div class="sim-lane__top">
              <span class="sim-lane__title">3. Coldstart CAPI Relay + orders/paid Webhook</span>
              <span class="status-pill status-pill--live">event_id: order_${orderNum}</span>
            </div>
            <div class="sim-lane__code">POST /events { "event_name": "Purchase", "event_id": "order_${orderNum}", "em": ["sha256..."] }</div>
            <div class="sim-packet" aria-hidden="true"><i></i></div>
          </div>
        `;
        metaBox.classList.remove('is-overcount');
        metaBox.innerHTML = `
          <div>
            <span class="label" style="color:var(--accent)">Meta Events Manager sees</span>
            <div class="sim-meta__count" style="margin-top:6px">1 Purchase ✓</div>
            <p class="mono" style="font-size:.82rem;margin-top:4px;color:var(--paper)">Reported: ₹1,499 (100% accurate)</p>
          </div>
          <div style="font-size:.85rem;border-top:1px solid rgba(242,242,242,.2);padding-top:10px">
            <p><strong>Deduplicated on: <code>order_${orderNum}</code></strong></p>
            <p style="opacity:.85;margin-top:4px">Meta merges Browser + Server copies into 1 event and keeps hashed email, phone, IP &amp; UA.</p>
          </div>
        `;
        footText.innerHTML = `<strong>Verified:</strong> Browser pixel and Shopify <code>orders/paid</code> CAPI share <code>event_id = "order_${orderNum}"</code>. Counted once.`;
        if (payloadPre) {
          payloadPre.textContent = JSON.stringify({
            event_name: 'Purchase',
            event_time: Math.floor(Date.now() / 1000),
            event_id: 'order_' + orderNum,
            action_source: 'website',
            event_source_url: 'https://your-store.myshopify.com/orders/' + orderNum,
            user_data: {
              em: ['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
              client_ip_address: '49.36.128.14',
              client_user_agent: 'Mozilla/5.0',
              fbp: 'fb.1.1794790800.112'
            },
            custom_data: { value: 1499, currency: 'INR', order_id: String(orderNum) },
            meta_deduplication: 'Matched browser + server on event_name=Purchase + event_id=order_' + orderNum
          }, null, 2);
        }
      }
      const orderLabel = $('#simOrderId', root);
      if (orderLabel) orderLabel.textContent = '#' + orderNum;
    };

    root.addEventListener('click', (e) => {
      const mBtn = e.target.closest('[data-sim-mode]');
      if (mBtn) {
        mode = mBtn.dataset.simMode;
        renderSim();
        return;
      }
      const fireBtn = e.target.closest('#simFireOrder');
      if (fireBtn) {
        orderNum++;
        renderSim();
      }
    });

    renderSim();
  }

  /* ---------------------------------------------------------------- 5. Capability Map Filter */
  function setupCapabilityFilter() {
    const wrap = $('#capMap');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cap-filter]');
      if (!b) return;
      const f = b.dataset.capFilter;
      $$('[data-cap-filter]', wrap).forEach((el) => el.setAttribute('aria-pressed', String(el === b)));
      $$('[data-cap-status]', wrap).forEach((card) => {
        card.hidden = !(f === 'all' || card.dataset.capStatus === f);
      });
    });
  }

  /* ---------------------------------------------------------------- 6. Live /api/health Probe */
  function probeHealth() {
    const el = $('#liveHealthBadge');
    if (!el) return;
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !j.ok) throw new Error('offline');
        const p = j.plugins || {};
        const liveList = Object.entries(p).filter(([, m]) => m === 'live').map(([k]) => k);
        el.textContent = `API ONLINE · store: ${j.store || 'memory'} · live plugins: ${liveList.length ? liveList.join(', ') : 'none (sandbox mode)'}`;
        el.className = 'status-pill status-pill--live';
      })
      .catch(() => {
        el.textContent = 'STATIC / OFFLINE PREVIEW · start server with npm start for /api';
        el.className = 'status-pill status-pill--sandbox';
      });
  }

  /* ---------------------------------------------------------------- 7. Early-Access Signup Forms */
  function setupSignups() {
    $$('form[data-signup-form]').forEach((form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = form.querySelector('input[type="email"]');
        const msg = form.querySelector('.signup__msg');
        if (!input || !msg) return;
        const email = input.value.trim();
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
        msg.classList.toggle('is-error', !ok);
        if (!ok) {
          msg.textContent = 'Enter a valid email address (e.g. founder@brand.in)_';
          input.focus();
          return;
        }
        const goOnboarding = () => setTimeout(() => { location.href = 'onboarding-v3.html'; }, 900);
        msg.textContent = 'Saving your spot & waking Coldie_';
        fetch('/api/plugins/onboard/actions/signup', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-coldstart': '1' },
          body: JSON.stringify({ email, source: 'v3-landing' })
        })
          .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
          .then((res) => {
            if (!res.ok) {
              msg.classList.add('is-error');
              msg.textContent = (res.j.error || 'Could not save email') + '_';
              return;
            }
            msg.textContent = (res.j.already ? 'Already on the list' : 'Spot saved') + ' — opening onboarding_';
            form.reset();
            goOnboarding();
          })
          .catch(() => {
            msg.textContent = 'Offline preview — taking you straight to onboarding_';
            goOnboarding();
          });
      });
    });
  }

  function boot() {
    setupClips();
    preloader();
    if (window.Dither) {
      window.Dither.fields();
      window.Dither.images();
      window.Dither.videos();
    }
    chrome();
    setupProblemSimulator();
    setupCapabilityFilter();
    probeHealth();
    setupSignups();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
