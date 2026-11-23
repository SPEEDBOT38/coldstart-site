/* Creative editor + export. Layout model (9-position grid, size/colour/background/alignment per text block) and the
   photo-style prompts are adapted from Open-Pomelli (MIT, © 2024 Marketing Agent Contributors, see docs/THIRD_PARTY.md).
   Open-Pomelli renders text as DOM over the image and has no export ("HTML-to-PNG export" is on its roadmap); here the
   same layout is drawn onto a <canvas> at full resolution, so the preview and the exported PNG are the same pixels. */
(function () {
  const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  const SIZE = { small: 0.032, medium: 0.045, large: 0.07, huge: 0.095 };   // fraction of canvas width
  const DIMS = { '4:5': [1080, 1350], '9:16': [1080, 1920], '1:1': [1080, 1080] };

  const STYLES = {   // Open-Pomelli photo-styles.ts (food + general), mapped to the three directions
    food: { spotlight: 'Bright airy studio, white surface, vibrant color pop, advertising-grade clarity.', lifestyle: 'Rustic wood table, warm tungsten lighting, hand-styled imperfections, an inviting gifting or treat moment.', contrast: 'Hero product with its ingredients scattered organically around it, soft shadow, appetite-driving styling.' },
    general: { spotlight: 'Clean white seamless studio background, soft diffused key light, subtle floor shadow, hero centered.', lifestyle: 'Lifestyle setting with natural daylight, shallow depth of field, lived-in textures around the product.', contrast: 'Moody dark backdrop, single rim light, deep shadows, premium cinematic mood.' },
  };
  const category = (line) => /chocolat|snack|food|drink|tea|coffee|bakery|sweet|candy|dragee|cookie|spice|beverage|restaurant/i.test(line || '') ? 'food' : 'general';
  function scenePrompt(layout, brandLine) {
    return STYLES[category(brandLine)][layout] + ' Use the exact product from the reference image: same shape, colours, packaging and printed text, no warping or distortion. Leave clear empty space for a headline. No text, no watermarks, no added logos, no prices, no model faces.';
  }

  /* Three art-directed briefs. The product is never sent to the image model: the model paints only the scene, with an
     empty, lit placement area where the compositor puts the original product pixels (Product Lock). Text sits in a
     reserved zone that does not intersect the product box, which compose() verifies geometrically. */
  const BRIEFS = {
    spotlight: { name: 'Premium product hero', objective: 'Make the product the unmistakable hero and signal quality.',
      product: { cx: 0.5, cy: 0.64, scale: 0.52 }, text: { headline: 'top-left', body: 'top-left', cta: 'top-left' },
      camera: 'eye level, 85mm, slight downward tilt', lighting: 'large soft key from upper left, gentle rim light from behind, soft contact shadow',
      prompt: (b) => `Empty art-directed product photography set, 4:5 vertical. A ${b.food ? 'polished dark stone plinth on a warm cream seamless backdrop, a few' : 'matte plinth on a seamless backdrop,'} ${b.food ? 'whole roasted almonds and cocoa nibs placed far at the edges' : 'minimal props at the far edges'}. The plinth top is centred in the lower half and completely EMPTY, ready for a product to be placed. Upper 40% of the frame is calm, uncluttered negative space in ${b.palette}. Camera at eye level, 85mm lens. Large soft key light from upper left, subtle rim light, realistic floor shadows. Premium, quiet, high-end advertising mood. No product, no packaging, no text, no logos.` },
    lifestyle: { name: 'Sensory lifestyle', objective: 'Make people crave it: texture, ingredients and a real moment of enjoyment.',
      product: { cx: 0.62, cy: 0.6, scale: 0.46 }, text: { headline: 'bottom-left', body: 'bottom-left', cta: 'bottom-left' },
      camera: '45-degree overhead, 50mm, shallow depth of field', lighting: 'warm window light from the right, golden hour, soft natural shadows',
      prompt: (b) => `Rich food photography scene, 4:5 vertical, 45-degree overhead angle, 50mm, shallow depth of field. ${b.food ? 'Warm walnut wood table with a linen napkin, a ceramic cup of hot chocolate, broken chocolate pieces, roasted almonds and a dusting of cocoa' : 'A styled real-life table setting with natural textures and lifestyle props'} arranged around an EMPTY clear space slightly right of centre in the middle of the frame where a product will be placed. Lower-left third is darker and less busy for text. Warm golden window light from the right, appetising, tactile textures, colour harmony with ${b.palette}. No product, no packaging, no text, no logos, no hands, no faces.` },
    contrast: { name: 'Expressive editorial', objective: 'Stop the scroll with a bold, graphic composition and one clear benefit.',
      product: { cx: 0.66, cy: 0.52, scale: 0.55 }, text: { headline: 'middle-left', body: 'middle-left', cta: 'bottom-left' },
      camera: 'straight-on, 70mm, graphic and flat', lighting: 'hard directional spotlight from the right, strong sculpted shadows',
      prompt: (b) => `Bold editorial still-life set, 4:5 vertical, straight-on camera, 70mm. Colour-blocked backdrop: a deep ${b.dark} left half and a ${b.accent} right half meeting in a clean vertical line, a single hard spotlight from the right casting one long sculpted shadow. The right half has an EMPTY plinth where a product will be placed; the left half is clean, flat and dark for large typography. Magazine-cover energy, high contrast, sophisticated. No product, no packaging, no text, no logos.` },
  };
  function brief(id, brand) {
    const col = (brand && brand.colors) || [], b = BRIEFS[id];
    const ctx = { food: category(brand && brand.line) === 'food', palette: col.slice(0, 3).join(', ') || 'warm neutrals', dark: col[3] || '#2B1A12', accent: col[2] || col[0] || '#C98B5E' };
    return { id, ...b, scenePrompt: b.prompt(ctx) };
  }

  function defaultLayout(x, colors) {
    const ink = colors[3] || '#111111', paper = colors[4] || '#FFFFFF', accent = colors[0] || ink;
    const B = BRIEFS[x.layout] || BRIEFS.spotlight, light = x.layout === 'spotlight';
    return {
      headline: { text: x.headline || '', position: B.text.headline, size: x.layout === 'contrast' ? 'huge' : 'large', color: light ? ink : '#FFFFFF', align: 'left', bg: null, shade: x.layout === 'lifestyle' },
      body: { text: x.body || '', position: B.text.body, size: 'small', color: light ? ink : '#FFFFFF', align: 'left', bg: null },
      cta: { text: x.cta || 'Shop now', position: B.text.cta, size: 'medium', color: paper, align: 'left', bg: accent },
      logo: { position: x.layout === 'contrast' ? 'top-left' : 'top-right' },
      productBox: null,   // filled from the compositor report: {x,y,w,h}
    };
  }

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Image did not load.')); i.src = src; });

  function lines(g, text, maxW) { const out = []; let cur = ''; for (const w of String(text || '').split(/\s+/).filter(Boolean)) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }

  /** Draw base photo + text blocks. Returns the canvas (export = canvas.toBlob). */
  async function compose(baseSrc, layout, aspect, font) {
    const [W, H] = DIMS[aspect] || DIMS['4:5'], c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const im = await loadImg(baseSrc); const s = Math.max(W / im.width, H / im.height); g.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s);
    const pad = W * 0.065, cellW = (W - pad * 2) / 3, fam = font || 'system-ui, sans-serif', rects = [];
    const pb = layout.productBox;   // keep text out of the product: limit width to the space beside it when they share a band
    if (layout.logo && layout.logo.src) { try { const lg = await loadImg(layout.logo.src), lh = W * 0.06, lw = Math.min(W * 0.3, lg.width * lh / lg.height), lx = /right/.test(layout.logo.position) ? W - pad - lw : pad; g.drawImage(lg, lx, pad * 0.8, lw, lh); rects.push({ k: 'logo', x: lx, y: pad * 0.8, w: lw, h: lh }); } catch (e) { /* logo optional */ } }
    const cells = {};
    ['headline', 'body', 'cta'].forEach((k) => { const b = layout[k]; if (b && b.text) (cells[b.position] = cells[b.position] || []).push([k, b]); });
    for (const [pos, blocks] of Object.entries(cells)) {
      const [vy, hx] = pos.split('-'); let maxW = hx === 'center' ? W - pad * 2 : cellW * 2.2; if (pb && hx === 'left' && vy !== 'top') maxW = Math.max(cellW, Math.min(maxW, pb.x - pad * 1.4));
      const measured = blocks.map(([k, b]) => { const px = Math.round(W * SIZE[b.size || 'medium']); g.font = `${k === 'body' ? 500 : 800} ${px}px ${fam}`; const ls = lines(g, b.text, k === 'cta' ? W : maxW).slice(0, k === 'headline' ? 3 : 2); return { k, b, px, ls, h: ls.length * px * 1.15 + (b.bg ? px * 0.9 : 0) }; });
      const total = measured.reduce((a, m) => a + m.h, 0) + (measured.length - 1) * W * 0.02;
      let y = vy === 'top' ? pad : vy === 'middle' ? (H - total) / 2 : H - pad - total;
      if (measured.some((m) => m.b.shade)) { const gr = g.createLinearGradient(0, vy === 'bottom' ? y - pad : 0, 0, vy === 'bottom' ? H : y + total + pad); gr.addColorStop(vy === 'bottom' ? 0 : 1, 'rgba(0,0,0,0)'); gr.addColorStop(vy === 'bottom' ? 1 : 0, 'rgba(0,0,0,.55)'); g.fillStyle = gr; g.fillRect(0, vy === 'bottom' ? y - pad : 0, W, vy === 'bottom' ? H - y + pad : y + total + pad); }
      for (const m of measured) {
        g.font = `${m.k === 'body' ? 500 : 800} ${m.px}px ${fam}`; g.textBaseline = 'top';
        const width = Math.max(...m.ls.map((l) => g.measureText(l).width));
        const al = m.b.align || (hx === 'right' ? 'right' : hx === 'center' ? 'center' : 'left');
        const x0 = hx === 'left' ? pad : hx === 'right' ? W - pad : W / 2;
        if (m.b.bg) { const bw = width + m.px * 1.2, bx = al === 'left' ? x0 : al === 'right' ? x0 - bw : x0 - bw / 2; g.fillStyle = m.b.bg; g.fillRect(bx, y, bw, m.h); }
        g.fillStyle = m.b.color || '#fff'; g.textAlign = al;
        const tx = al === 'left' ? x0 + (m.b.bg ? m.px * 0.6 : 0) : al === 'right' ? x0 - (m.b.bg ? m.px * 0.6 : 0) : x0;
        m.ls.forEach((l, n) => g.fillText(l, tx, y + (m.b.bg ? m.px * 0.45 : 0) + n * m.px * 1.15));
        rects.push({ k: m.k, x: al === 'left' ? x0 : al === 'right' ? x0 - width : x0 - width / 2, y, w: width + (m.b.bg ? m.px * 1.2 : 0), h: m.h });
        y += m.h + W * 0.02;
      }
    }
    g.textAlign = 'left';
    // deterministic checks: clipping and text/product collision
    const issues = []; const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    rects.forEach((r) => { if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) issues.push(r.k + ' is clipped'); if (pb && r.k !== 'logo' && hit(r, pb)) issues.push(r.k + ' overlaps the product'); });
    c.qa = { rects, issues };
    return c;
  }

  /** Editor dialog: live canvas preview + per-block controls. onSave(layout) persists; Export downloads a full-res PNG. */
  function open({ title, baseSrc, layout, aspect, font, onSave, fileName }) {
    const d = document.getElementById('dlg'), L = JSON.parse(JSON.stringify(layout)); let active = 'headline';
    const ctl = () => { const b = L[active]; return `<div class="seg" role="tablist">${['headline', 'body', 'cta'].map((k) => `<button type="button" data-blk="${k}" aria-pressed="${k === active}">${k === 'cta' ? 'CTA' : k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <label class="field"><span>Text</span><textarea id="ce-t" rows="2" maxlength="${active === 'body' ? 160 : 60}">${esc(b.text)}</textarea></label>
      <span class="eyebrow">Position</span><div class="pos-grid">${POSITIONS.map((p) => `<button type="button" data-pos="${p}" aria-label="${p}" aria-pressed="${b.position === p}"></button>`).join('')}</div>
      <div class="cols2"><label class="field"><span>Size</span><select id="ce-s">${Object.keys(SIZE).map((s) => `<option ${b.size === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label class="field"><span>Align</span><select id="ce-a">${['left', 'center', 'right'].map((s) => `<option ${b.align === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
      <div class="cols2"><label class="field"><span>Text colour</span><input id="ce-c" type="color" value="${esc(b.color || '#ffffff')}"></label><label class="field"><span>Background</span><span class="row"><input id="ce-b" type="color" value="${esc(b.bg || '#000000')}" ${b.bg ? '' : 'disabled'}><label class="check-inline"><input id="ce-bo" type="checkbox" ${b.bg ? 'checked' : ''}> on</label></span></label></div>`; };
    d.setAttribute('aria-label', 'Edit ad'); d.classList.add('wide');
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">${esc(title)}</h2><button class="btn sm ghost" id="ce-x" type="button">Close</button></div>
      <div class="dlg-b ce"><div class="ce-prev"><canvas id="ce-cv" aria-label="Ad preview"></canvas></div><div class="ce-ctl" id="ce-ctl"></div></div>
      <div class="dlg-f"><button class="btn ghost" id="ce-exp" type="button">Export PNG</button><button class="btn yellow" id="ce-save" type="button">Save</button></div>`;
    d.showModal();
    let busy = 0; const draw = async () => { const n = ++busy; try { const c = await compose(baseSrc, L, aspect, font); if (n !== busy) return; const cv = document.getElementById('ce-cv'); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); } catch (e) { /* shown by caller */ } };
    const bind = () => { const el = document.getElementById('ce-ctl'); el.innerHTML = ctl(); const b = L[active];
      el.querySelectorAll('[data-blk]').forEach((x) => x.onclick = () => { active = x.dataset.blk; bind(); });
      el.querySelectorAll('[data-pos]').forEach((x) => x.onclick = () => { b.position = x.dataset.pos; bind(); draw(); });
      el.querySelector('#ce-t').oninput = (e) => { b.text = e.target.value; draw(); };
      el.querySelector('#ce-s').onchange = (e) => { b.size = e.target.value; draw(); }; el.querySelector('#ce-a').onchange = (e) => { b.align = e.target.value; draw(); };
      el.querySelector('#ce-c').oninput = (e) => { b.color = e.target.value; draw(); };
      el.querySelector('#ce-b').oninput = (e) => { b.bg = e.target.value; draw(); };
      el.querySelector('#ce-bo').onchange = (e) => { b.bg = e.target.checked ? (el.querySelector('#ce-b').value || '#000000') : null; bind(); draw(); }; };
    bind(); draw();
    document.getElementById('ce-x').onclick = () => { d.classList.remove('wide'); d.close(); };
    document.getElementById('ce-save').onclick = async () => { await onSave(L); d.classList.remove('wide'); d.close(); };
    document.getElementById('ce-exp').onclick = async () => { const c = await compose(baseSrc, L, aspect, font); c.toBlob((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (fileName || 'ad') + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png'); };
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  window.CreativeEditor = { compose, open, defaultLayout, scenePrompt, brief, BRIEFS, DIMS };
})();
