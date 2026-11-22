/* Coldstart landing page behaviour: preloader, custom cursor, clips, scroll states. */
(() => {
  'use strict';
  const html = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Safari plays VP9 WebM without its alpha channel, so it gets the animated WebP instead.
  const NO_ALPHA_WEBM = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

  /* ---------------------------------------------------------------- clips */
  function setupClips() {
    $$('video.clip, video.preloader__coldie').forEach((v) => {
      if (!NO_ALPHA_WEBM || !v.dataset.fallback) return;
      const img = new Image();
      img.className = v.className;
      img.alt = v.getAttribute('aria-label') || '';
      if (v.hasAttribute('aria-hidden')) img.setAttribute('aria-hidden', 'true');
      img.decoding = 'async';
      img.src = REDUCE ? v.poster : v.dataset.fallback;
      v.replaceWith(img);
    });
    if (REDUCE) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) e.target.play().catch(() => {}); else e.target.pause();
    }), { rootMargin: '80px' });
    $$('video.clip[data-autoplay]').forEach((v) => io.observe(v));
  }

  /* ---------------------------------------------------------------- preloader */
  function preloader() {
    const pre = $('#preloader');
    const ready = () => { html.classList.remove('is-loading'); html.classList.add('is-ready'); scrambleAll(); };
    if (!pre) return ready();
    const count = $('#preCount'), status = $('#preStatus'), bar = $('.preloader__bar', pre);
    const cells = Array.from({ length: 20 }, () => bar.appendChild(document.createElement('i')));
    const lines = ['booting coldie_', 'installing pixel_', 'scanning competitors_', 'generating campaigns_', 'warming up traffic_'];

    let loaded = 0;
    const hero = $('.hero__stage video');
    const tasks = [
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', r, { once: true }))),
      new Promise((r) => {
        if (!hero || hero.readyState >= 3) return r();
        hero.addEventListener('canplay', r, { once: true });
        hero.addEventListener('error', r, { once: true });
      }),
    ];
    tasks.forEach((t) => t.then(() => loaded++, () => loaded++));

    const MIN = 1700, MAX = 7000, t0 = performance.now();
    let shown = 0, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pre.classList.add('is-leaving');
      setTimeout(() => {
        ready();
        if (REDUCE || !window.Dither) return pre.remove();
        pre.classList.add('is-wiping');
        Dither.wipe($('.preloader__wipe', pre)).then(() => pre.remove());
      }, 200);
    };
    const tick = (now) => {
      const el = now - t0;
      const target = el > MAX ? 1 : Math.min(loaded / tasks.length, el / MIN);
      shown += (target - shown) * .14;
      if (target === 1 && shown > .992) shown = 1;
      const pct = Math.round(shown * 100);
      count.textContent = String(pct).padStart(3, '0');
      cells.forEach((c, i) => c.classList.toggle('on', i < Math.round(shown * 20)));
      status.textContent = lines[Math.min(lines.length - 1, Math.floor(shown * lines.length))];
      if (shown < 1) requestAnimationFrame(tick); else finish();
    };
    requestAnimationFrame(tick);
    setTimeout(finish, MAX + 1500);   // rAF is paused in background tabs; never leave the page locked
  }

  /* ---------------------------------------------------------------- headline decode */
  function scramble(el) {
    const final = el.dataset.text || (el.dataset.text = el.textContent);
    if (REDUCE) return;
    const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    const t0 = performance.now(), dur = 850 + final.length * 22;
    const frame = (t) => {
      const p = (t - t0) / dur;
      if (p >= 1) { el.textContent = final; return; }
      const settled = Math.floor(p * final.length);
      let out = '';
      for (let i = 0; i < final.length; i++) out += i < settled || final[i] === ' ' ? final[i] : pool[(Math.random() * pool.length) | 0];
      el.textContent = out;
      setTimeout(() => requestAnimationFrame(frame), 38);
    };
    requestAnimationFrame(frame);
  }
  const scrambleAll = () => $$('[data-scramble]').forEach(scramble);

  /* ---------------------------------------------------------------- custom cursor */
  function cursor() {
    const el = $('.cursor');
    if (!el || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const dot = $('.cursor__dot', el), box = $('.cursor__box', el), label = $('.cursor__label', el);
    html.classList.add('has-cursor');
    let x = innerWidth / 2, y = innerHeight / 2, bx = x, by = y, seen = false;
    const snap = (v) => Math.round(v / 2) * 2;   // the box lands on a 2px grid, like the dither
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      x = e.clientX; y = e.clientY;
      if (!seen) { seen = true; bx = x; by = y; }
      el.classList.add('is-on');
    }, { passive: true });
    html.addEventListener('mouseleave', () => el.classList.remove('is-on'));
    addEventListener('pointerdown', () => el.classList.add('is-down'));
    addEventListener('pointerup', () => el.classList.remove('is-down'));
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest ? e.target : null;
      if (!t) return;
      const text = t.closest('input, textarea');
      const link = t.closest('a, button, [data-cursor]');
      el.classList.toggle('is-text', !!text);
      el.classList.toggle('is-link', !text && !!link);
      const tag = link && link.closest('[data-cursor]');
      label.textContent = !text && tag ? tag.dataset.cursor : '';
    });
    const loop = () => {
      bx += (x - bx) * .22; by += (y - by) * .22;
      dot.style.transform = `translate3d(${x}px,${y}px,0)`;
      box.style.transform = `translate3d(${snap(bx)}px,${snap(by)}px,0)`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------------- scroll states */
  function progress() {
    const bar = $('#progressBar');
    if (!bar) return;
    let queued = false;
    const update = () => {
      queued = false;
      const max = html.scrollHeight - innerHeight;
      bar.style.width = (max > 0 ? Math.round((scrollY / max) * 50) * 2 : 0) + '%';   // 2% steps
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  function reveals() {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -12% 0px' });
    $$('[data-reveal]').forEach((n) => io.observe(n));
  }

  function jobs() {
    const items = $$('.job'), clips = $$('.stage .clip'), index = $('#stageIndex'), status = $('#stageStatus'), stage = $('#stage');
    if (!items.length || !stage) return;
    let active = -1, stageVisible = false;
    const play = () => clips.forEach((c, i) => {
      if (!c.play) return;
      if (i === active && stageVisible && !REDUCE) c.play().catch(() => {}); else c.pause();
    });
    const set = (i) => {
      if (i === active) return;
      active = i;
      items.forEach((n, k) => n.classList.toggle('is-active', k === i));
      clips.forEach((c, k) => c.classList.toggle('is-active', k === i));
      index.textContent = `${String(i + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
      status.textContent = items[i].dataset.status || '';
      play();
    };
    // whichever row crosses the reading line becomes the active job. On small screens the sticky
    // stage covers the top of the viewport, so the line sits lower.
    const small = matchMedia('(max-width: 900px)').matches;
    const rows = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) set(items.indexOf(e.target)); }),
      { rootMargin: small ? '-68% 0px -30% 0px' : '-46% 0px -46% 0px' });
    items.forEach((n) => rows.observe(n));
    new IntersectionObserver((es) => { stageVisible = es[0].isIntersecting; play(); }).observe(stage);
    set(0);
  }

  function marquee() {
    const track = $('.band__track');
    if (!track) return;
    const set = [...track.children];
    let guard = 0;
    while (track.scrollWidth < innerWidth * 1.2 && guard++ < 8) set.forEach((n) => track.appendChild(n.cloneNode(true)));
    [...track.children].forEach((n) => track.appendChild(n.cloneNode(true)));   // second half makes the -50% loop seamless
  }

  function dragStrip() {
    const strip = $('#strip');
    if (!strip) return;
    let down = false, startX = 0, startLeft = 0, moved = 0;
    strip.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      down = true; moved = 0; startX = e.clientX; startLeft = strip.scrollLeft;
    });
    addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (moved > 4) strip.classList.add('is-dragging');
      strip.scrollLeft = startLeft - dx;
    });
    addEventListener('pointerup', () => { down = false; strip.classList.remove('is-dragging'); });
  }

  function signup() {
    const form = $('#signup'), msg = $('#signupMsg');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.elements.email;
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
      msg.classList.toggle('is-error', !ok);
      if (!ok) { msg.textContent = 'that email does not look right_'; input.focus(); return; }
      const email = input.value.trim();
      const next = () => setTimeout(() => { location.href = 'onboarding.html'; }, 1400);
      msg.textContent = 'saving_';
      fetch('/api/plugins/onboard/actions/signup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-coldstart': '1' }, body: JSON.stringify({ email: email, source: 'landing' }) })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j: j })))
        .then((res) => {
          if (!res.ok) { msg.classList.add('is-error'); msg.textContent = (res.j.error || 'could not save that') + '_'; return; }
          msg.textContent = (res.j.already ? 'you were already on the list' : 'you are on the list') + ' — waking coldie_';
          form.reset(); next();
        })
        .catch(() => { msg.textContent = 'offline preview — taking you to coldie_'; next(); });
    });
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    setupClips();
    cursor();
    preloader();
    if (window.Dither) { Dither.fields(); Dither.images(); }
    marquee();
    progress();
    reveals();
    jobs();
    dragStrip();
    signup();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
