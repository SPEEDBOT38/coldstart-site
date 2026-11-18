/* Coldstart dither engine: ordered (Bayer 8x8) dithering on low-res canvases scaled up with
   image-rendering: pixelated. Three primitives:
     Dither.fields()  <canvas data-dither="rise|sink|left|right|flat|vignette|blobs|cursor ...">
     Dither.images()  <figure data-dither-img> with an <img> and a <canvas>; resolves to the photo on scroll
     Dither.videos()  <div data-dither-video> with a <video>/<img> and a <canvas>; live two-colour dither
     Dither.wipe(cv)  full-screen dissolve (used by the preloader)
   Canvas colour comes from the CSS `color` of the canvas. */
(() => {
  'use strict';

  const M = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  const B = new Float32Array(64);
  M.forEach((v, i) => { B[i] = (v + .5) / 64; });

  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const rgbOf = (str) => { const m = String(str).match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [0, 0, 0]; };
  const hexOf = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  const pointer = { x: -1e4, y: -1e4, on: false };
  addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = e.pointerType !== 'touch'; }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { pointer.on = false; });

  /* ---------------------------------------------------------------- fields */
  const animated = [];
  const duos = [];

  class Field {
    constructor(cv) {
      this.cv = cv;
      this.ctx = cv.getContext('2d');
      const d = cv.dataset;
      this.modes = new Set((d.dither || 'rise').trim().split(/\s+/));
      this.cell = +d.cell || 4;
      this.amount = d.amount ? +d.amount : 1;
      this.gamma = d.gamma ? +d.gamma : 1.5;
      this.speed = d.speed ? +d.speed : 1;
      this.nBlobs = d.blobs ? +d.blobs : 3;
      this.blobAmp = d.blobAmp ? +d.blobAmp : .5;
      this.blobR = d.blobRadius ? +d.blobRadius : .5;
      this.curR = (d.cursorRadius ? +d.cursorRadius : 150) / this.cell;
      this.curAmp = d.cursorAmp ? +d.cursorAmp : .62;
      this.seed = d.seed ? +d.seed : 1;
      this.cur = 0;
      this.last = 0;
      this.dirty = true;
      this.visible = true;
      this.live = !REDUCE && (this.modes.has('blobs') || this.modes.has('cursor'));
      this.host = cv.parentElement;
      this.resize();
      this.draw(0);
      new ResizeObserver(() => { if (this.resize()) this.draw(performance.now()); }).observe(this.host);
      if (this.live) {
        new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; }, { rootMargin: '120px' }).observe(this.host);
        animated.push(this);
      }
    }

    resize() {
      const c = this.cell;
      const w = Math.max(1, Math.ceil(this.host.clientWidth / c));
      const h = Math.max(1, Math.ceil(this.host.clientHeight / c));
      if (w === this.w && h === this.h) return false;
      this.w = w; this.h = h;
      this.cv.width = w; this.cv.height = h;
      this.cv.style.width = w * c + 'px';
      this.cv.style.height = h * c + 'px';
      this.img = this.ctx.createImageData(w, h);
      this.color = rgbOf(getComputedStyle(this.cv).color);
      const base = this.base = new Float32Array(w * h);
      const m = this.modes, g = this.gamma, a = this.amount;
      const ramp = (u) => Math.pow(clamp(u * 1.14), g) * a;
      for (let y = 0; y < h; y++) {
        const uy = h > 1 ? y / (h - 1) : 1;
        for (let x = 0; x < w; x++) {
          const ux = w > 1 ? x / (w - 1) : 1;
          let v = 0;
          if (m.has('flat')) v = a;
          if (m.has('rise')) v = Math.max(v, ramp(uy));
          if (m.has('sink')) v = Math.max(v, ramp(1 - uy));
          if (m.has('right')) v = Math.max(v, ramp(ux));
          if (m.has('left')) v = Math.max(v, ramp(1 - ux));
          if (m.has('vignette')) {
            const dx = ux - .5, dy = uy - .5;
            v = Math.max(v, Math.pow(clamp((Math.sqrt(dx * dx + dy * dy) - .38) / .42), g) * a);
          }
          base[y * w + x] = v;
        }
      }
      this.dirty = true;
      return true;
    }

    draw(t) {
      const { w, h, base, img, color } = this;
      const px = img.data;
      const blobs = [];
      if (this.modes.has('blobs')) {
        const s = t * .00012 * this.speed, R = this.blobR * Math.max(w, h);
        for (let i = 0; i < this.nBlobs; i++) {
          const k = this.seed * 1.7 + i * 2.39;
          blobs.push([(.5 + .46 * Math.sin(s * (1 + i * .31) + k)) * w, (.5 + .46 * Math.cos(s * (1.3 - i * .17) + k * 1.9)) * h,
            1 / (R * R * (.55 + .45 * Math.sin(k * 3.1) ** 2)), this.blobAmp]);
        }
      }
      if (this.modes.has('cursor')) {
        const r = this.cv.getBoundingClientRect();
        const inside = pointer.on && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
        this.cur += ((inside ? 1 : 0) - this.cur) * .16;
        if (this.cur > .01) blobs.push([(pointer.x - r.left) / this.cell, (pointer.y - r.top) / this.cell, 1 / (this.curR * this.curR), this.curAmp * this.cur]);
        else if (!this.modes.has('blobs') && !this.dirty) return;
      }
      const nb = blobs.length;
      const [cr, cg, cb] = color;
      let i = 0, p = 0;
      for (let y = 0; y < h; y++) {
        const row = (y & 7) << 3;
        for (let x = 0; x < w; x++, i++, p += 4) {
          let v = base[i];
          for (let b = 0; b < nb; b++) {
            const bl = blobs[b], dx = x - bl[0], dy = y - bl[1];
            const q = 1 - (dx * dx + dy * dy) * bl[2];
            if (q > 0) v += bl[3] * q * q;
          }
          if (v > B[row | (x & 7)]) { px[p] = cr; px[p + 1] = cg; px[p + 2] = cb; px[p + 3] = 255; } else px[p + 3] = 0;
        }
      }
      this.ctx.putImageData(img, 0, 0);
      this.dirty = false;
    }
  }

  function loop(t) {
    for (const f of animated) {
      if (!f.visible || t - f.last < 45) continue;   // ~22 fps: reads as digital, costs little
      f.last = t;
      f.draw(t);
    }
    for (const d of duos) {
      if (!d.visible || t - d.last < 45) continue;
      const m = d.media();
      if (!m || m.tagName !== 'VIDEO' || m.paused) continue;
      d.last = t;
      d.draw();
    }
    requestAnimationFrame(loop);
  }
  const startLoop = () => { if (!loop.on && (animated.length || duos.length)) { loop.on = true; requestAnimationFrame(loop); } };

  function fields(root = document) {
    root.querySelectorAll('canvas[data-dither]').forEach((cv) => { if (!cv._field) cv._field = new Field(cv); });
    startLoop();
  }

  /* ---------------------------------------------------------------- image reveal */
  class ImageReveal {
    constructor(fig) {
      this.fig = fig;
      this.img = fig.querySelector('img');
      this.cv = fig.querySelector('canvas');
      this.ctx = this.cv.getContext('2d');
      this.cell = +fig.dataset.cell || 5;
      this.dark = hexOf(fig.dataset.dark || '#12125E');
      this.light = hexOf(fig.dataset.light || '#ECEA36');
      this.q = -1;
      if (REDUCE) { this.cv.hidden = true; return; }
      const go = () => { if (this.build()) { this.update(); addEventListener('scroll', () => this.update(), { passive: true }); new ResizeObserver(() => { if (this.build()) { this.q = -1; this.update(); } }).observe(fig); } };
      if (this.img.complete && this.img.naturalWidth) go(); else this.img.addEventListener('load', go, { once: true });
    }

    build() {
      const c = this.cell;
      const w = Math.max(1, Math.ceil(this.fig.clientWidth / c)), h = Math.max(1, Math.ceil(this.fig.clientHeight / c));
      if (w === this.w && h === this.h) return true;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ox = off.getContext('2d', { willReadFrequently: true });
      // cover-fit, so the frame can have any aspect ratio (data-pos = vertical focus, 0..1)
      const iw = this.img.naturalWidth, ih = this.img.naturalHeight, k = Math.max(w / iw, h / ih);
      const sw = w / k, sh = h / k, pos = this.fig.dataset.pos ? +this.fig.dataset.pos : .5;
      ox.drawImage(this.img, (iw - sw) / 2, (ih - sh) * pos, sw, sh, 0, 0, w, h);
      let src;
      try { src = ox.getImageData(0, 0, w, h).data; } catch (e) { this.cv.hidden = true; return false; }   // file:// taints the canvas
      this.w = w; this.h = h;
      const L = this.L = new Float32Array(w * h);
      let lo = 1, hi = 0;
      for (let i = 0, p = 0; i < L.length; i++, p += 4) {
        const l = (.299 * src[p] + .587 * src[p + 1] + .114 * src[p + 2]) / 255;
        L[i] = l; if (l < lo) lo = l; if (l > hi) hi = l;
      }
      const span = Math.max(.001, hi - lo);
      for (let i = 0; i < L.length; i++) L[i] = Math.pow((L[i] - lo) / span, .8);   // stretch + lift mids
      this.cv.width = w; this.cv.height = h;
      this.cv.style.width = w * c + 'px'; this.cv.style.height = h * c + 'px';
      this.out = this.ctx.createImageData(w, h);
      return true;
    }

    update() {
      const r = this.fig.getBoundingClientRect(), vh = innerHeight;
      const p = clamp((vh * .92 - r.top) / (vh * .62));
      const q = Math.round(p * 32);
      if (q === this.q) return;
      this.q = q;
      (this.fig.closest('figure') || this.fig).style.setProperty('--resolve', (q / 32).toFixed(3));
      this.render(q / 32);
    }

    render(p) {
      const { w, h, L, out, dark, light } = this;
      const px = out.data;
      let i = 0, o = 0;
      for (let y = 0; y < h; y++) {
        const row = (y & 7) << 3, row2 = ((y + 3) & 7) << 3;
        for (let x = 0; x < w; x++, i++, o += 4) {
          if (B[row2 | ((x + 5) & 7)] < p) { px[o + 3] = 0; continue; }   // this cell has resolved to the photo
          const c = L[i] > B[row | (x & 7)] ? light : dark;
          px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
        }
      }
      this.ctx.putImageData(out, 0, 0);
    }
  }

  function images(root = document) {
    root.querySelectorAll('[data-dither-img]').forEach((f) => { if (!f._reveal) f._reveal = new ImageReveal(f); });
  }

  /* ---------------------------------------------------------------- live duotone */
  // Redraws a clip (or still) as two colours. Transparent pixels stay transparent, so the panel shows through.
  class Duotone {
    constructor(host) {
      this.host = host;
      this.cv = host.querySelector('canvas:not([data-dither])');
      this.ctx = this.cv.getContext('2d');
      this.cell = +host.dataset.cell || 3;
      this.ax = host.dataset.x ? +host.dataset.x : .5;   // horizontal placement of the clip, 0..1
      this.light = hexOf(host.dataset.light || '#F2F2F2');
      this.dark = hexOf(host.dataset.dark || '#000091');
      this.fit = host.dataset.fit ? +host.dataset.fit : .94;
      this.off = document.createElement('canvas');
      this.ox = this.off.getContext('2d', { willReadFrequently: true });
      this.visible = false; this.last = 0; this.ok = true;
      const m = this.media();
      if (m && m.tagName === 'VIDEO') {
        if (m.poster) { this.poster = new Image(); this.poster.onload = () => this.draw(); this.poster.src = m.poster; }
        ['loadeddata', 'seeked', 'pause', 'ended'].forEach((ev) => m.addEventListener(ev, () => this.draw()));
      } else if (m && !m.complete) m.addEventListener('load', () => this.draw(), { once: true });
      this.resize();
      this.ro = new ResizeObserver(() => { if (this.resize()) this.draw(); });
      this.ro.observe(host);
      this.io = new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; if (this.visible) this.draw(); }, { rootMargin: '120px' });
      this.io.observe(host);
      duos.push(this);
    }

    dispose() {
      this.ok = false;
      this.visible = false;
      this.ro.disconnect();
      this.io.disconnect();
      const m = this.media();
      if (m && m.tagName === 'VIDEO') m.pause();
      if (this.poster) this.poster.onload = null;
      delete this.host._duo;
    }

    media() { return this.host.querySelector('video, img'); }

    resize() {
      const c = this.cell;
      const w = Math.max(1, Math.ceil(this.host.clientWidth / c)), h = Math.max(1, Math.ceil(this.host.clientHeight / c));
      if (w === this.w && h === this.h) return false;
      this.w = w; this.h = h;
      this.off.width = w; this.off.height = h;
      this.cv.width = w; this.cv.height = h;
      this.cv.style.width = w * c + 'px'; this.cv.style.height = h * c + 'px';
      this.out = this.ctx.createImageData(w, h);
      return true;
    }

    draw() {
      if (!this.ok || !this.w) return;
      let m = this.media();
      if (!m) return;
      if (m.tagName === 'VIDEO' && m.readyState < 2) m = this.poster;
      const sw = m && (m.videoWidth || m.naturalWidth), sh = m && (m.videoHeight || m.naturalHeight);
      if (!sw || !sh) return;
      const { w, h, ox, out, light, dark } = this;
      const k = Math.min(w / sw, h / sh) * this.fit, dw = sw * k, dh = sh * k;
      ox.clearRect(0, 0, w, h);
      ox.drawImage(m, (w - dw) * this.ax, (h - dh) / 2, dw, dh);
      let src;
      try { src = ox.getImageData(0, 0, w, h).data; } catch (e) { this.ok = false; this.host.classList.add('no-dither'); return; }   // file://
      const px = out.data;
      for (let y = 0, p = 0; y < h; y++) {
        const row = (y & 7) << 3;
        for (let x = 0; x < w; x++, p += 4) {
          if (src[p + 3] < 120) { px[p + 3] = 0; continue; }
          const l = clamp(((.299 * src[p] + .587 * src[p + 1] + .114 * src[p + 2]) / 255 - .05) * 1.12);
          const c = l > B[row | (x & 7)] ? light : dark;
          px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2]; px[p + 3] = 255;
        }
      }
      this.ctx.putImageData(out, 0, 0);
    }
  }

  function videos(root = document) {
    // App views replace DOM nodes; release their renderers before initializing the new view.
    for (let i = duos.length - 1; i >= 0; i--) {
      if (!duos[i].host.isConnected) { duos[i].dispose(); duos.splice(i, 1); }
    }
    root.querySelectorAll('[data-dither-video]').forEach((h) => { if (!h._duo) h._duo = new Duotone(h); });
    startLoop();
  }

  /* ---------------------------------------------------------------- full-screen wipe */
  function wipe(cv, { cell = 8, duration = 950 } = {}) {
    return new Promise((done) => {
      const w = Math.ceil(innerWidth / cell), h = Math.ceil(innerHeight / cell);
      cv.width = w; cv.height = h;
      cv.style.width = w * cell + 'px'; cv.style.height = h * cell + 'px';
      const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), px = img.data;
      const [r, g, b] = rgbOf(getComputedStyle(cv).color);
      const t0 = performance.now();
      const frame = (t) => {
        const p = clamp((t - t0) / duration) * 1.06;
        let o = 0;
        for (let y = 0; y < h; y++) {
          const row = (y & 7) << 3, uy = y / h;
          for (let x = 0; x < w; x++, o += 4) {
            if (B[row | (x & 7)] * .45 + uy * .55 > p) { px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255; } else px[o + 3] = 0;
          }
        }
        ctx.putImageData(img, 0, 0);
        if (p < 1.05) requestAnimationFrame(frame); else done();
      };
      requestAnimationFrame(frame);
    });
  }

  window.Dither = { fields, images, videos, wipe, REDUCE };
})();
