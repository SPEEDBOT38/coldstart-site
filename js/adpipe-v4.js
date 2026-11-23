/* Product Lock ad pipeline, driven from the Studio UI (no console steps).
   prototype: real product + mask + shadow on a procedural backdrop + real typography (no provider cost)
   approve:   a person approves the three directions
   final:     scene (image model, never sees the product) → placement read from the scene → compositor (approved mask,
              grounded shadow, original product pixels) → deterministic typography → QA → saved design document.
   Every pixel asset is stored losslessly (PNG data URLs); exports are rebuilt from the saved design, never from a JPEG. */
(function () {
  const CE = window.CreativeEditor;
  const W = 1080, H = 1350;

  let tok = null;
  async function token(C) { if (tok && tok.until > Date.now() + 30000) return tok.v; const r = await C.api('plugins/images/actions/composeToken', {}); tok = { v: r.token, until: Date.now() + r.expires_in * 1000 }; return tok.v; }
  async function compose(body, C) {   // direct call to the Python compositor with a short-lived, workspace-scoped token from the API
    const r = await fetch('/api/compose/composite', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cs-compose': await token(C) }, credentials: 'same-origin', body: JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* below */ }
    if (!r.ok || !j || !j.image) throw new Error('Product Lock compositor failed (' + r.status + (j && j.error ? ': ' + j.error : t ? '' : ', empty response') + '). Nothing was generated in its place.');
    return j;
  }
  const img = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Image did not load.')); i.src = src; });
  async function limitPng(src, max) {   // keep the original pixels unless the photo is huge; never JPEG
    const i = await img(src); if (Math.max(i.width, i.height) <= max && /^data:image\/png/.test(src)) return src;
    const k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement('canvas'); c.width = Math.round(i.width * k); c.height = Math.round(i.height * k);
    c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); return c.toDataURL('image/png');
  }
  async function monochrome(src) {   // a single-colour logo can be recoloured for dark/light backgrounds without changing the brand mark
    try { const i = await img(src), c = document.createElement('canvas'); c.width = 64; c.height = Math.max(1, Math.round(64 * i.height / i.width)); const g = c.getContext('2d'); g.drawImage(i, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data, seen = []; for (let k = 0; k < d.length; k += 4) { if (d[k + 3] < 128) continue; seen.push([d[k], d[k + 1], d[k + 2]]); }
      if (!seen.length) return false; const m = seen.reduce((a, p) => a.map((v, n) => v + p[n] / seen.length), [0, 0, 0]);
      return seen.filter((p) => Math.abs(p[0] - m[0]) + Math.abs(p[1] - m[1]) + Math.abs(p[2] - m[2]) > 60).length / seen.length < 0.05; } catch (e) { return false; }
  }
  async function loadFont(name) {
    if (!name || /^(sans|serif|system)/i.test(name)) return 'system-ui, sans-serif';
    const fam = String(name).replace(/["']/g, '').trim();
    try { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fam).replace(/%20/g, '+') + ':wght@500;700;800&display=swap'; document.head.appendChild(l);
      await new Promise((res) => { l.onload = res; l.onerror = res; setTimeout(res, 4000); }); await document.fonts.load('700 40px "' + fam + '"'); if (document.fonts.check('700 40px "' + fam + '"')) return '"' + fam + '", system-ui, sans-serif'; } catch (e) { /* fall through */ }
    return 'system-ui, sans-serif';
  }

  async function assets({ C, S, flagship }) {
    const ref = await limitPng((await C.api('plugins/images/actions/photo', { url: flagship.image })).image, 2048);
    let logo = null, logoMono = false;
    if (S.brand && S.brand.logo) { try { logo = /^data:/.test(S.brand.logo) ? S.brand.logo : (await C.api('plugins/images/actions/photo', { url: S.brand.logo })).image; logoMono = await monochrome(logo); } catch (e) { logo = null; } }
    const font = await loadFont(S.brand && S.brand.fonts && S.brand.fonts[0]);
    return { ref, logo, logoMono, font, colors: (S.brand && S.brand.colors) || [] };
  }
  function layoutFor(x, A, box) {
    const L = (x.design && x.design.layout) ? JSON.parse(JSON.stringify(x.design.layout)) : CE.defaultLayout(x, A.colors);
    L.productBox = box;
    for (const k of ['headline', 'body', 'cta']) if (L[k] && typeof x[k] === 'string') L[k].text = x[k];   // the draft's text is the source of truth
    if (A.logo) { L.logo = { ...(L.logo || {}), src: A.logo }; if (A.logoMono) L.logo.recolor = L.logo.tone === 'light' ? (A.colors[4] || '#FFFFFF') : (A.colors[3] || A.colors[0] || '#111111'); }
    return L;
  }
  const strip = (L) => { const c = JSON.parse(JSON.stringify(L)); if (c.logo) delete c.logo.src; return c; };   // the logo is a brand asset, not part of the doc
  const shadowFor = (B, loc) => {
    const s = { ...B.shadow }; if (!loc) return s;
    s.angle = loc.light_from === 'right' ? -Math.abs(B.shadow.angle || 25) : loc.light_from === 'left' ? Math.abs(B.shadow.angle || 25) : 0;
    s.softness = Math.min(0.9, Math.max(0.15, 1 - loc.light_hardness)); return s;
  };

  // Free prototype backdrops that match each direction's tone (light hero, dark lifestyle, colour-blocked editorial),
  // so the approved layout is judged against the right contrast. Brand colours only; no generation.
  function protoBackground(id, col) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const paper = col[4] || '#FBF7F1', dark = col[3] || '#2B140C', mid = col[2] || '#6E412C', acc = col[0] || '#B8705A';
    if (id === 'spotlight') { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, paper); gr.addColorStop(0.7, col[1] || '#E8D9C8'); gr.addColorStop(1, mid); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = dark; g.globalAlpha = 0.85; g.fillRect(W * 0.22, H * 0.74, W * 0.56, H * 0.09); g.globalAlpha = 1; }
    else if (id === 'lifestyle') { const gr = g.createRadialGradient(W * 0.68, H * 0.45, 40, W * 0.6, H * 0.5, W); gr.addColorStop(0, mid); gr.addColorStop(1, dark); g.fillStyle = gr; g.fillRect(0, 0, W, H); const sh = g.createLinearGradient(0, H * 0.62, 0, H); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.6)'); g.fillStyle = sh; g.fillRect(0, 0, W, H); }
    else { g.fillStyle = dark; g.fillRect(0, 0, W * 0.5, H); g.fillStyle = acc; g.fillRect(W * 0.5, 0, W, H); g.fillStyle = mid; g.fillRect(W * 0.62, H * 0.64, W * 0.26, H * 0.36); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, H * 0.82, W, H * 0.18); }
    return c.toDataURL('image/png');
  }
  async function prototype({ C, S, ctx, x, A, msg }) {
    const B = CE.brief(x.layout, S.brand); msg(B.name + ': building the layout prototype (no generation cost)…');
    const saved = x.design && x.design.mask_approved && (await C.ops.get('obImage', { id: x.id, kind: 'mask', site: ctx.brand.site, brand: ctx.brand.name })).image;
    const cmp = await compose({ reference: A.ref, mask: saved || undefined, background: protoBackground(x.layout, A.colors), width: W, height: H, ...B.product, shadow: B.shadow }, C);
    const f = cmp.report.foreground, L = layoutFor(x, A, { x: f.x, y: f.y, w: f.w, h: f.h });
    const cv = await CE.compose(cmp.image, L, '4:5', A.font);
    await C.ops.post('obEditCreative', { context: ctx, id: x.id, asset: 'prototype', data: cv.toDataURL('image/png') });
    if (!saved) await C.ops.post('obEditCreative', { context: ctx, id: x.id, asset: 'mask', data: cmp.mask });
    await C.ops.post('obEditCreative', { context: ctx, id: x.id, design: { stage: 'prototype', brief: { id: B.id, name: B.name, objective: B.objective, camera: B.camera, lighting: B.lighting }, layout: strip(L), font: A.font,
      mask: cmp.report.mask, mask_source: cmp.report.segmentation, layout_approved: false, prototype_qa: cv.qa.issues } });
    return { qa: cv.qa.issues, mask: cmp.report.mask };
  }

  async function final({ C, S, ctx, x, A, msg }) {
    const B = CE.brief(x.layout, S.brand), t0 = Date.now(), d = x.design || {};
    if (!d.layout_approved) throw new Error(B.name + ': approve the layout prototype first.');
    const rid = (d.scene_request && d.scene_request.status !== 'done') ? d.scene_request.id : x.id + '-' + Date.now().toString(36);
    await C.ops.post('obEditCreative', { context: ctx, id: x.id, design: { scene_request: { id: rid, status: 'running', at: Date.now() } } });
    msg(B.name + ': painting the empty scene (the image model never sees your product)…');
    const g = await C.api('plugins/images/actions/generate', { prompt: B.scenePrompt, raw: true, aspect: '4:5', model: 'pro', requestId: rid, job: x.id });
    msg(B.name + ': reading the scene to place the product…');
    let loc = null; try { loc = await C.api('plugins/images/actions/locate', { image: g.image, job: x.id, hint: B.camera + '. ' + B.lighting }); } catch (e) { loc = null; }
    const P = { ...B.product }; if (loc && loc.confidence >= 0.4) { P.ground_y = Math.min(Math.max(loc.surface_y, B.product.ground_y - 0.12), B.product.ground_y + 0.12); P.cx = Math.min(Math.max(loc.cx, B.product.cx - 0.15), B.product.cx + 0.15); }
    const shadow = shadowFor(B, loc);
    msg(B.name + ': compositing your original product with a grounded shadow…');
    const mask = (await C.ops.get('obImage', { id: x.id, kind: 'mask', site: ctx.brand.site, brand: ctx.brand.name })).image;
    const cmp = await compose({ reference: A.ref, mask: mask || undefined, background: g.image, width: W, height: H, ...P, shadow }, C);
    const f = cmp.report.foreground, L = layoutFor(x, A, { x: f.x, y: f.y, w: f.w, h: f.h });
    const cv = await CE.compose(cmp.image, L, '4:5', A.font), png = cv.toDataURL('image/png');
    msg(B.name + ': visual review…');
    let crit = null; try { crit = await C.api('plugins/images/actions/critique', { image: cv.toDataURL('image/jpeg', 0.9), brief: B.name + ': ' + B.objective + ' Camera ' + B.camera + '. Light ' + B.lighting + '.', job: x.id }); } catch (e) { crit = { error: e.message }; }
    const qa = {
      mask_completeness: cmp.report.mask.status === 'ok' ? 'pass' : 'review', mask: cmp.report.mask,
      protected_pixels: cmp.report.protected_pixel_equality, protected_pixels_changed: cmp.report.protected_pixels_changed,
      grounding: cmp.report.shadow ? 'shadow_drawn' : 'none', placement_source: loc && loc.confidence >= 0.4 ? 'vision_located' : 'brief_default', placement: loc,
      text: cv.qa.issues.length ? 'review' : 'pass', text_issues: cv.qa.issues, review_required: cmp.report.review_required, critique: crit, approved: false,
    };
    await C.ops.post('obEditCreative', { context: ctx, id: x.id, asset: 'scene', data: g.image });
    await C.ops.post('obEditCreative', { context: ctx, id: x.id, image: cmp.image, layout: strip(L), approve: false,
      imageMeta: { model: g.model, usd: g.usd, cost_known: g.cost_known, generation_id: g.generation_id, attempts: g.attempts, ms: Date.now() - t0, aspect: '4:5', source: 'Scene by ' + g.model + ' (no product reference); original product composited; text by the Cold Start editor', productImage: S.flagship && S.flagship.image },
      design: { stage: 'final', layout: strip(L), placement: P, shadow, scene_request: { id: rid, status: 'done' }, prompt: B.scenePrompt, report: cmp.report, qa } });
    return { qa, usd: g.usd, png };
  }

  let brandCache = null;
  async function brand({ C, S }) {   // logo + font only (cards and the editor); cached per page load
    const k = JSON.stringify([S.brand && S.brand.logo, S.brand && S.brand.fonts]); if (brandCache && brandCache.k === k) return brandCache.v;
    let logo = null, logoMono = false;
    if (S.brand && S.brand.logo) { try { logo = /^data:/.test(S.brand.logo) ? S.brand.logo : (await C.api('plugins/images/actions/photo', { url: S.brand.logo })).image; logoMono = await monochrome(logo); } catch (e) { logo = null; } }
    const v = { logo, logoMono, font: await loadFont(S.brand && S.brand.fonts && S.brand.fonts[0]), colors: (S.brand && S.brand.colors) || [] }; brandCache = { k, v }; return v;
  }
  /** Full-resolution, lossless render of a saved design: composite PNG + saved layout. Used by cards, the editor and export. */
  async function render({ C, S, ctx, x }) {
    const A = await brand({ C, S }); const r = await C.ops.get('obImage', { id: x.id, site: ctx.brand.site, brand: ctx.brand.name });
    if (!r.image) return null; const L = layoutFor(x, A, (x.design && x.design.layout && x.design.layout.productBox) || null);
    return { base: r.image, layout: L, font: A.font, canvas: await CE.compose(r.image, L, '4:5', A.font) };
  }
  window.AdPipe = { prototype, final, assets, layoutFor, brand, render, strip };
})();
