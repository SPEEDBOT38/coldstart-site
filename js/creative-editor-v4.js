/* Creative editor + export. Layout model (9-position grid, size/colour/background/alignment per text block) and the
   photo-style prompts are adapted from Open-Pomelli (MIT, © 2024 Marketing Agent Contributors, see docs/THIRD_PARTY.md).
   Open-Pomelli renders text as DOM over the image and has no export ("HTML-to-PNG export" is on its roadmap); here the
   same layout is drawn onto a <canvas> at full resolution, so the preview and the exported PNG are the same pixels. */
(function () {
  const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  const SIZE = { eyebrow: 0.026, small: 0.032, medium: 0.045, large: 0.07, huge: 0.095 };   // fraction of canvas width
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
      product: { cx: 0.5, ground_y: 0.74, scale: 0.44 }, shadow: { strength: 0.55, softness: 0.55, angle: 18, length: 0.18 },
      text: { headline: 'top-left', body: 'top-left', cta: 'bottom-center' }, order: ['headline', 'body', 'cta'], tone: 'light',
      camera: 'eye level, 85mm', lighting: 'large soft key from upper left, gentle rim light, soft floor shadows',
      prompt: (b) => `Empty art-directed product photography set, vertical 4:5 frame, full-bleed photograph. ${b.food ? 'Warm cream seamless paper backdrop fading to soft warm beige at the floor. A low, wide, polished dark stone plinth sits centred in the lower third; its top surface is completely EMPTY. A few whole roasted almonds and cocoa nibs on the floor at the far left and far right edges only.' : 'Seamless light backdrop, a low wide plinth centred in the lower third with an EMPTY top surface, minimal props at the far edges.'} The upper 45% of the frame is calm, evenly lit negative space. Camera at eye level, 85mm lens, plinth top just below eye level. Large soft key light from the upper left, gentle rim light, realistic soft floor shadows. Premium, quiet, high-end advertising photography. No product, no packaging, no text, no logos, no colour swatches, no borders, no panels.` },
    lifestyle: { name: 'Sensory lifestyle', objective: 'Make people crave it: texture, ingredients and a real moment of enjoyment.',
      product: { cx: 0.68, ground_y: 0.66, scale: 0.42 }, shadow: { strength: 0.6, softness: 0.45, angle: -28, length: 0.3 },
      text: { headline: 'bottom-left', body: 'bottom-left', cta: 'bottom-left' }, order: ['headline', 'body', 'cta'], tone: 'dark', shade: true,
      camera: 'table height, 10° down, 50mm, shallow depth of field', lighting: 'soft window light from the right plus soft frontal fill, warm',
      prompt: (b) => `Rich food photography scene, vertical 4:5 full-bleed photograph. Camera at table height looking slightly down (about 10 degrees), 50mm lens, shallow depth of field, so a standing pouch would be seen straight-on. ${b.food ? 'A warm walnut wood table: in the back left a ceramic cup of hot chocolate with a little steam, a folded linen napkin, broken dark chocolate pieces with visible snap texture, roasted almonds, a light dusting of cocoa powder; behind, a softly blurred cosy kitchen.' : 'A styled real-life table with natural textures and lifestyle props, softly blurred home background.'} Slightly right of centre in the middle ground there is an EMPTY clear patch of table where a standing pouch will be placed; nothing stands there and props do not overlap it. Lighting: soft window light from the right with a gentle frontal fill so a front-lit studio packshot will look natural there; no hard spotlight. The lower-left third is darker, out of focus and uncluttered for text; the top-left corner is a calm dark wall. Appetising tactile textures, deep chocolate browns and caramel tones. No product, no packaging, no bags, no text, no logos, no hands, no faces.` },
    contrast: { name: 'Expressive editorial', objective: 'Stop the scroll with a bold, graphic composition and one clear benefit.',
      product: { cx: 0.75, ground_y: 0.64, scale: 0.46 }, shadow: { strength: 0.6, softness: 0.3, angle: -35, length: 0.35 },
      text: { headline: 'middle-left', body: 'middle-left', cta: 'middle-left' }, order: ['body', 'headline', 'cta'], eyebrow: 'body', tone: 'dark',
      camera: 'straight-on, 70mm, graphic', lighting: 'directional key from the right, sculpted shadow falling left',
      prompt: (b) => `Bold editorial still-life set, vertical 4:5 full-bleed photograph, straight-on camera, 70mm. Colour-blocked backdrop: a deep ${b.darkName} left half and a warm ${b.accentName} right half meeting in a clean vertical line just left of centre. On the right half an EMPTY cylindrical plinth stands on a dark grey floor; its flat top is empty. A directional key light from the right casts the plinth's shadow to the left. The left half is clean, flat and dark for large typography. Magazine-cover energy, sophisticated. No product, no packaging, no text, no logos, no colour swatches.` },
  };
  const NAMES = [['#3A1D13', 'dark chocolate brown'], ['#2B1A12', 'dark chocolate brown']];
  const colourName = (hex, fallback) => { const h = String(hex || '').replace('#', ''); if (h.length !== 6) return fallback; const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); const l = (r + g + b) / 3;
    const hue = r > g && r > b ? (g > b * 1.3 ? 'amber' : 'brown') : g > r && g > b ? 'green' : b > r && b > g ? 'blue' : 'grey'; return (l < 70 ? 'deep ' : l > 190 ? 'pale ' : '') + (hue === 'brown' && l > 120 ? 'terracotta' : hue); };
  function brief(id, brand) {
    const col = (brand && brand.colors) || [], b = BRIEFS[id];
    // colour names, not hex codes: hex in a prompt makes image models paint literal swatches
    const ctx = { food: category(brand && brand.line) === 'food', darkName: colourName(col[3] || col[0], 'dark chocolate brown'), accentName: colourName(col[2] || col[1], 'terracotta') };
    return { id, ...b, scenePrompt: b.prompt(ctx) };
  }

  function defaultLayout(x, colors) {
    const ink = colors[3] || '#111111', paper = colors[4] || '#FFFFFF', accent = colors[0] || ink;
    const B = BRIEFS[x.layout] || BRIEFS.spotlight, light = B.tone === 'light', fg = light ? ink : (paper || '#FFFFFF');
    return {
      headline: { text: x.headline || '', position: B.text.headline, size: x.layout === 'contrast' ? 'huge' : 'large', color: fg, align: 'left', bg: null, shade: !!B.shade },
      body: { text: x.body || '', position: B.text.body, size: B.eyebrow === 'body' ? 'eyebrow' : 'small', color: fg, align: 'left', bg: null },
      cta: { text: x.cta || 'Shop now', position: B.text.cta, size: 'medium', color: light ? paper : ink, align: 'left', bg: light ? accent : paper },
      order: B.order, logo: { position: x.layout === 'contrast' ? 'top-left' : light ? 'top-right' : 'top-left', tone: light ? 'dark' : 'light' },
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
    if (layout.logo && layout.logo.src) { try { const lg = await loadImg(layout.logo.src), lh = W * 0.06, lw = Math.min(W * 0.3, lg.width * lh / lg.height), lx = /right/.test(layout.logo.position) ? W - pad - lw : pad;
        if (layout.logo.recolor) { const o = document.createElement('canvas'); o.width = Math.ceil(lw); o.height = Math.ceil(lh); const og = o.getContext('2d'); og.drawImage(lg, 0, 0, lw, lh); og.globalCompositeOperation = 'source-in'; og.fillStyle = layout.logo.recolor; og.fillRect(0, 0, o.width, o.height); g.drawImage(o, lx, pad * 0.8); }
        else g.drawImage(lg, lx, pad * 0.8, lw, lh); rects.push({ k: 'logo', x: lx, y: pad * 0.8, w: lw, h: lh }); } catch (e) { /* logo optional */ } }
    const cells = {};
    (layout.order || ['headline', 'body', 'cta']).forEach((k) => { const b = layout[k]; if (b && b.text) (cells[b.position] = cells[b.position] || []).push([k, b]); });
    for (const [pos, blocks] of Object.entries(cells)) {
      const [vy, hx] = pos.split('-'); let maxW = hx === 'center' ? W - pad * 2 : cellW * 2.2; if (pb && hx === 'left' && vy !== 'top') maxW = Math.max(cellW, Math.min(maxW, pb.x - pad * 1.4));
      const measured = blocks.map(([k, b]) => {   // shrink to fit instead of silently dropping words or overflowing into the product
        const cap = k === 'headline' ? 4 : 3, wide = k === 'cta' ? W : maxW; let px = Math.round(W * SIZE[b.size || 'medium']), ls;
        const eb = b.size === 'eyebrow', txt = eb ? String(b.text || '').toUpperCase() : b.text;
        for (;;) { g.font = `${k === 'body' ? (eb ? 700 : 500) : 800} ${px}px ${fam}`; try { g.letterSpacing = eb ? Math.round(px * 0.12) + 'px' : '0px'; } catch (e) { /* older canvas */ } ls = lines(g, txt, wide); const fits = ls.length <= cap && ls.every((l) => g.measureText(l).width <= wide); if (fits || px <= W * 0.022) break; px = Math.round(px * 0.92); }
        return { k, b, px, ls, h: ls.length * px * 1.15 + (b.bg ? px * 0.9 : 0) }; });
      const total = measured.reduce((a, m) => a + m.h, 0) + (measured.length - 1) * W * 0.02;
      let y = vy === 'top' ? pad : vy === 'middle' ? (H - total) / 2 : H - pad - total;
      if (measured.some((m) => m.b.shade)) { const gr = g.createLinearGradient(0, vy === 'bottom' ? y - pad : 0, 0, vy === 'bottom' ? H : y + total + pad); gr.addColorStop(vy === 'bottom' ? 0 : 1, 'rgba(0,0,0,0)'); gr.addColorStop(vy === 'bottom' ? 1 : 0, 'rgba(0,0,0,.55)'); g.fillStyle = gr; g.fillRect(0, vy === 'bottom' ? y - pad : 0, W, vy === 'bottom' ? H - y + pad : y + total + pad); }
      for (const m of measured) {
        g.font = `${m.k === 'body' ? (m.b.size === 'eyebrow' ? 700 : 500) : 800} ${m.px}px ${fam}`; g.textBaseline = 'top'; if (m.b.size === 'eyebrow') { try { g.letterSpacing = Math.round(m.px * 0.12) + 'px'; } catch (e) { /* older canvas */ } } else { try { g.letterSpacing = '0px'; } catch (e) { /* */ } }
        const width = Math.max(...m.ls.map((l) => g.measureText(l).width));
        const al = m.b.align || (hx === 'right' ? 'right' : hx === 'center' ? 'center' : 'left');
        const x0 = hx === 'left' ? pad : hx === 'right' ? W - pad : W / 2;
        if (m.b.bg) { const bw = width + m.px * 1.2, bx = al === 'left' ? x0 : al === 'right' ? x0 - bw : x0 - bw / 2; g.fillStyle = m.b.bg; g.fillRect(bx, y, bw, m.h); }
        g.fillStyle = m.b.color || '#fff'; g.textAlign = al;
        const tx = al === 'left' ? x0 + (m.b.bg ? m.px * 0.6 : 0) : al === 'right' ? x0 - (m.b.bg ? m.px * 0.6 : 0) : x0;
        m.ls.forEach((l, n) => g.fillText(m.b.size === 'eyebrow' ? l.toUpperCase() : l, tx, y + (m.b.bg ? m.px * 0.45 : 0) + n * m.px * 1.15));
        rects.push({ k: m.k, drawn: m.ls.join(' '), px: m.px, want: Math.round(W * SIZE[m.b.size || 'medium']), x: al === 'left' ? x0 : al === 'right' ? x0 - width : x0 - width / 2, y, w: width + (m.b.bg ? m.px * 1.2 : 0), h: m.h });
        y += m.h + W * 0.02;
      }
    }
    g.textAlign = 'left';
    // deterministic checks: clipping and text/product collision
    const issues = []; const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    rects.forEach((r) => { if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) issues.push(r.k + ' is clipped'); if (pb && r.k !== 'logo' && hit(r, pb)) issues.push(r.k + ' overlaps the product'); });
    rects.forEach((r, i) => rects.slice(i + 1).forEach((q) => { if (hit(r, q)) issues.push(r.k + ' collides with ' + q.k); }));
    const R = Object.fromEntries(rects.map((r) => [r.k, r]));
    if (R.headline && R.headline.px < R.headline.want * 0.75) issues.push('headline had to shrink to ' + Math.round(100 * R.headline.px / R.headline.want) + '% to fit; shorten it or give it more room');
    if (R.headline && R.body && R.body.px * 1.5 > R.headline.px) issues.push('weak hierarchy: headline is not clearly larger than the supporting line');
    const txt = rects.filter((r) => r.k === 'headline' || r.k === 'body').sort((a, b) => a.y - b.y);
    for (let i = 1; i < txt.length; i++) { const gap = txt[i].y - (txt[i - 1].y + txt[i - 1].h); if (gap > H * 0.18) issues.push(txt[i - 1].k + ' and ' + txt[i].k + ' are stranded ' + Math.round(gap) + 'px apart; group them'); }
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
  window.CreativeEditor = { compose, open, defaultLayout, scenePrompt, brief, BRIEFS, DIMS, SIZE };
})();
