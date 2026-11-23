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

  function defaultLayout(x, colors) {
    const ink = colors[3] || '#111111', paper = colors[4] || '#FFFFFF', accent = colors[0] || ink;
    const top = x.layout !== 'lifestyle';
    return {
      headline: { text: x.headline || '', position: top ? 'top-left' : 'bottom-left', size: 'huge', color: '#FFFFFF', align: 'left', bg: null, shade: true },
      body: { text: x.body || '', position: top ? 'top-left' : 'bottom-left', size: 'small', color: '#FFFFFF', align: 'left', bg: null },
      cta: { text: x.cta || 'Shop now', position: 'bottom-left', size: 'medium', color: paper, align: 'left', bg: accent },
    };
  }

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Image did not load.')); i.src = src; });

  function lines(g, text, maxW) { const out = []; let cur = ''; for (const w of String(text || '').split(/\s+/).filter(Boolean)) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }

  /** Draw base photo + text blocks. Returns the canvas (export = canvas.toBlob). */
  async function compose(baseSrc, layout, aspect, font) {
    const [W, H] = DIMS[aspect] || DIMS['4:5'], c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const im = await loadImg(baseSrc); const s = Math.max(W / im.width, H / im.height); g.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s);
    const pad = W * 0.065, cellW = (W - pad * 2) / 3, fam = font || 'system-ui, sans-serif';
    const cells = {};
    ['headline', 'body', 'cta'].forEach((k) => { const b = layout[k]; if (b && b.text) (cells[b.position] = cells[b.position] || []).push([k, b]); });
    for (const [pos, blocks] of Object.entries(cells)) {
      const [vy, hx] = pos.split('-'), maxW = hx === 'center' ? W - pad * 2 : cellW * 2.2;
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
        y += m.h + W * 0.02;
      }
    }
    g.textAlign = 'left';
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
  window.CreativeEditor = { compose, open, defaultLayout, scenePrompt, DIMS };
})();
