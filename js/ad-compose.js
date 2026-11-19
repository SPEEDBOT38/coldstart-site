/* Ad images, composed in the browser from the REAL product photo. Used by onboarding (where the ads are made) and the
   workspace (where they are shown). Nothing is repainted by a model, so packaging, lettering and colour stay exact.
   Exposed as window.AdCompose. Images live in the same IndexedDB store the workspace uses (coldstart-media / images). */
(function () {
  const W = 1080, H = 1350;

  // Same database and object store as js/connectors.js, so both pages read the same images.
  let dbp;
  const db = () => dbp ||= new Promise((res, rej) => { const r = indexedDB.open('coldstart-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('images'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('images', mode); const q = fn(t.objectStore('images')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const putMedia = (key, dataUrl) => tx('readwrite', s => s.put(dataUrl, key));
  const getMedia = key => tx('readonly', s => s.get(key));

  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image did not load')); i.src = src; });
  const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || '');

  function wrap(g, text, x, y, maxW, lineH, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    const shown = lines.slice(0, maxLines);
    shown.forEach((l, i) => g.fillText(l, x, y + i * lineH));
    return shown.length;
  }

  // The ad: headline on the brand background, the product photo on a clean white card, price and product name, CTA.
  async function compose(photoUrl, ad, opts = {}) {
    const kit = opts.kit || {}, colors = kit.colors || {};
    const bg = hexOk(colors.background) ? colors.background : '#F2F2F2';
    const ink = hexOk(colors.text) ? colors.text : '#0B0B0B';
    const brand = hexOk(colors.primary) ? colors.primary : '#0000F2';
    const family = (kit.fonts && kit.fonts.heading) || 'Poppins';
    const font = (w, s) => `${w} ${s}px "${family}", system-ui, sans-serif`;
    try { await document.fonts.load(font(700, 76)); } catch (_) { /* system font fallback */ }

    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, bg); grad.addColorStop(1, bg); g.fillStyle = grad; g.fillRect(0, 0, W, H);
    // a soft brand-coloured glow behind the product, so the photo sits in the scene
    const glow = g.createRadialGradient(W / 2, 760, 60, W / 2, 760, 560); glow.addColorStop(0, brand + '33'); glow.addColorStop(1, brand + '00'); g.fillStyle = glow; g.fillRect(0, 0, W, H);

    g.textBaseline = 'top'; g.fillStyle = ink;
    g.font = font(700, 78);
    wrap(g, ad.overlay_text || ad.headline, 90, 110, W - 180, 88, 2);

    // product card
    const cx = 140, cy = 380, cw = W - 280, ch = 640;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 50; g.shadowOffsetY = 18; g.fillStyle = '#FFFFFF';
    g.beginPath(); g.roundRect(cx, cy, cw, ch, 44); g.fill(); g.restore();
    if (photoUrl) {
      const img = await loadImg(photoUrl);
      const pad = 36, scale = Math.min((cw - pad * 2) / img.width, (ch - pad * 2) / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      g.drawImage(img, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
    }

    // product name and price
    g.fillStyle = ink; g.font = font(500, 40);
    const name = String(ad.product || '').replace(/\s+-\s+\d.*$/, '').slice(0, 60);
    g.fillText(name, 140, 1062, W - 280);
    if (ad.price != null) { g.fillStyle = brand; g.font = font(700, 64); g.fillText('₹' + Number(ad.price).toLocaleString('en-IN'), 140, 1110); }

    // CTA pill and brand name
    const cta = ad.cta || 'Shop now';
    g.font = font(600, 40); const tw = g.measureText(cta).width + 80;
    g.fillStyle = brand; g.beginPath(); g.roundRect(140, 1200, tw, 84, 42); g.fill();
    g.fillStyle = '#FFFFFF'; g.textBaseline = 'middle'; g.fillText(cta, 180, 1242);
    g.textBaseline = 'alphabetic'; g.fillStyle = ink; g.globalAlpha = 0.6; g.font = font(500, 30);
    const brandName = String(opts.brandName || '').slice(0, 40); g.textAlign = 'right'; g.fillText(brandName, W - 140, 1246); g.textAlign = 'left'; g.globalAlpha = 1;

    return c.toDataURL('image/jpeg', 0.93);
  }

  // The generated scene (the product is in it): headline on the backdrop above, the scene in the middle, the price and button
  // on a soft band at the bottom. The scene prompt keeps the top and bottom calm for exactly this.
  async function composeScene(sceneUrl, ad, opts = {}) {
    const kit = opts.kit || {}, colors = kit.colors || {};
    const bg = hexOk(colors.background) ? colors.background : '#F2F2F2';
    const ink = hexOk(colors.text) ? colors.text : '#0B0B0B';
    const brand = hexOk(colors.primary) ? colors.primary : '#0000F2';
    const family = (kit.fonts && kit.fonts.heading) || 'Poppins';
    const font = (w, s) => `${w} ${s}px "${family}", system-ui, sans-serif`;
    try { await document.fonts.load(font(700, 78)); } catch (_) { /* system font fallback */ }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.textBaseline = 'top'; g.fillStyle = ink; g.font = font(700, 78);
    wrap(g, ad.overlay_text || ad.headline, 90, 100, W - 180, 88, 2);
    const img = await loadImg(sceneUrl);
    g.drawImage(img, 0, 270, W, 1080);
    const fade = g.createLinearGradient(0, 1080, 0, H); fade.addColorStop(0, bg + '00'); fade.addColorStop(0.45, bg + 'e6'); fade.addColorStop(1, bg);
    g.fillStyle = fade; g.fillRect(0, 1080, W, H - 1080);
    g.fillStyle = ink; g.font = font(500, 42);
    g.fillText(String(ad.product || '').replace(/s+-s+d.*$/, '').slice(0, 44), 90, 1184, W - 180);
    if (ad.price != null) { g.fillStyle = brand; g.font = font(700, 64); g.fillText('₹' + Number(ad.price).toLocaleString('en-IN'), 90, 1240); }
    const cta = ad.cta || 'Shop now';
    g.font = font(600, 40); const tw = g.measureText(cta).width + 80;
    g.fillStyle = brand; g.beginPath(); g.roundRect(W - 90 - tw, 1226, tw, 84, 42); g.fill();
    g.fillStyle = '#FFFFFF'; g.textBaseline = 'middle'; g.fillText(cta, W - 90 - tw + 40, 1268);
    return c.toDataURL('image/jpeg', 0.93);
  }

  // The product photo, fetched through the server so the canvas is not tainted by a cross-origin image.
  async function fetchPhoto(api, url) {
    if (!url) return null;
    try { const r = await api('plugins/images/actions/photo', { url }); return r.image || null; } catch (_) { return null; }
  }

  window.AdCompose = { compose, composeScene, fetchPhoto, putMedia, getMedia };
})();
