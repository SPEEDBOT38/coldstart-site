/* Version 2 extras, loaded after main.js: eased wheel scrolling, the compact themed header,
   the footer reveal, the hero run log, live dithered clips. */
(() => {
  'use strict';
  const html = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------------------------------------------------------- eased scrolling */
  // Wheel input is eased toward a target instead of jumping. Touch, keyboard and the scrollbar stay native.
  function smoothScroll() {
    const headerOffset = () => ($('#bar') ? $('#bar').offsetHeight + 12 : 0);
    const maxY = () => html.scrollHeight - innerHeight;
    let target = scrollY, cur = scrollY, running = false, ease = .12;
    const step = () => {
      cur += (target - cur) * ease;
      if (Math.abs(target - cur) < .5) { cur = target; running = false; }
      scrollTo(0, cur);
      if (running) requestAnimationFrame(step);
    };
    const go = (y, e = .12) => { target = clamp(y, 0, maxY()); ease = e; if (!running) { running = true; cur = scrollY; requestAnimationFrame(step); } };

    if (!REDUCE && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      addEventListener('wheel', (e) => {
        if (e.ctrlKey || html.classList.contains('is-loading')) return;
        for (let n = e.target; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
          if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return;   // nested scroller
        }
        e.preventDefault();
        const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
        go((running ? target : scrollY) + d);
      }, { passive: false });
      addEventListener('scroll', () => { if (!running) target = cur = scrollY; }, { passive: true });
    }

    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      const el = a.getAttribute('href').length > 1 ? $(a.getAttribute('href')) : null;
      if (!el) return;
      e.preventDefault();
      const y = el.id === 'top' ? 0 : el.getBoundingClientRect().top + scrollY - headerOffset();
      if (REDUCE) scrollTo(0, y); else go(y, .09);
      history.replaceState(null, '', a.getAttribute('href'));
    });
  }

  /* ---------------------------------------------------------------- compact header */
  function bar() {
    const el = $('#bar');
    if (!el) return;
    const themed = $$('main [data-theme], main .foot');
    let queued = false;
    const update = () => {
      queued = false;
      el.classList.toggle('is-on', scrollY > 260);
      const line = el.offsetHeight / 2 + 4;
      let theme = 'blue';
      for (const s of themed) { const r = s.getBoundingClientRect(); if (r.top <= line && r.bottom > line) theme = s.dataset.theme || 'paper'; }
      if (el.dataset.theme !== theme) el.dataset.theme = theme;
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
  }

  /* ---------------------------------------------------------------- footer reveal */
  function curtain() {
    const el = $('#curtain'), main = $('main');
    if (!el || !main) return;
    let queued = false;
    const update = () => {
      queued = false;
      const shown = clamp((innerHeight - main.getBoundingClientRect().bottom) / el.offsetHeight, 0, 1);
      el.style.setProperty('--v', shown.toFixed(3));
    };
    addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
  }

  /* ---------------------------------------------------------------- hero run log */
  function log() {
    const items = $$('#log li');
    if (!items.length) return;
    const paint = (n) => items.forEach((li, i) => {
      li.classList.toggle('is-done', i < n);
      li.classList.toggle('is-now', i === n);
      li.firstElementChild.textContent = i < n ? '[x]' : i === n ? '[>]' : '[ ]';
    });
    if (REDUCE) return paint(items.length);
    let n = 0;
    paint(0);
    setInterval(() => { n = (n + 1) % (items.length + 2); paint(Math.min(n, items.length)); }, 1500);
  }

  /* ---------------------------------------------------------------- one-shot clips */
  // Clips marked data-once play through and hold their last frame; they restart when they come back into view.
  function oneShots() {
    $$('video[data-once]').forEach((v) => { v.loop = false; });
    $$('details.row').forEach((d) => d.addEventListener('toggle', () => {
      const v = $('video', d);
      if (!v || !d.open || REDUCE) return;
      v.currentTime = 0;
      v.play().catch(() => {});
    }));
  }

  function boot() {
    smoothScroll();
    bar();
    curtain();
    log();
    oneShots();
    if (window.Dither) Dither.videos();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
