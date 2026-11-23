/* Product Lock ad pipeline, driven from the Studio UI (no console steps).
   prototype: real product + mask + shadow on a procedural backdrop + real typography (no provider cost)
   approve:   a person approves the three directions
   final:     scene (image model, never sees the product) → placement read from the scene → compositor (approved mask,
              grounded shadow, original product pixels) → deterministic typography → QA → saved design document.
   Every pixel asset is stored losslessly (PNG data URLs); exports are rebuilt from the saved design, never from a JPEG. */
(function () {
  const CE = window.CreativeEditor;
  const W = 1080, H = 1350;
  // Vercel functions accept ≤ 4.5 MB per request. The product is drawn at ≤ ~700 px tall, so a 1400 px lossless reference is
  // plenty; the generated scene is not protected, so it travels as a high-quality JPEG.
  const REF_MAX = 1400;
  async function sceneForCompositing(src) { const i = await img(src); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/jpeg', 0.95); }

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
  async function viaCanvas(src) { const i = await img(src); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/png'); }
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
    // Full-resolution original: drop CDN resize parameters (Shopify &width=…), then load it directly when the host allows CORS
    // (most product CDNs do); fall back to the same-origin proxy. Either way the pixels are the store's own photo.
    let src = flagship.image; try { const u = new URL(src); ['width', 'height', 'crop'].forEach((k) => u.searchParams.delete(k)); src = u.href; } catch (e) { /* keep */ }
    let ref = null; try { ref = await limitPng(await viaCanvas(src), REF_MAX); } catch (e) { ref = null; }
    if (!ref) ref = await limitPng((await C.api('plugins/images/actions/photo', { url: src })).image, REF_MAX);
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
  // Shadow/grounding parameters come from the scene as measured (light direction, softness, camera, support extent);
  // the brief supplies defaults when the measurement is missing or unsure.
  const shadowFor = (B, loc) => {
    const s = { ...B.shadow }; if (!loc || loc.confidence < 0.4) return s;
    s.light_from = loc.light_from; s.light_hardness = loc.light_hardness; s.camera = loc.camera || s.camera;
    if (loc.width) s.support_x = [Math.max(0, loc.cx - loc.width / 2), Math.min(1, loc.cx + loc.width / 2)];
    return s;
  };
  // Scene geometry vs the brief's compatibility spec: an incompatible scene is reported for regeneration, not forced.
  const geometryCheck = (B, loc) => {
    const issues = []; if (!loc) return { ok: false, issues: ['scene could not be measured'] };
    if (B.spec && B.spec.camera === 'eye_level' && /overhead|high/.test(loc.camera || '')) issues.push('scene camera is ' + loc.camera + ' but the product photo is eye-level: the upright pouch cannot sit convincingly');
    if (loc.width && loc.width < 0.18) issues.push('support is only ' + Math.round(loc.width * 100) + '% of the frame wide; too narrow for the pouch');
    if (loc.light_hardness > 0.7) issues.push('scene light is hard (' + loc.light_hardness + ') while the product is softly front-lit: lighting will not match');
    return { ok: !issues.length, issues, needs_new_background: issues.some((i) => /camera|narrow/.test(i)) };
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

  async function final({ C, S, ctx, x, A, msg, opts }) {
    const B = CE.brief(x.layout, S.brand), t0 = Date.now(), d = x.design || {};
    if (!d.layout_approved) throw new Error(B.name + ': approve the layout prototype first.');
    let g = null, rid = d.scene_request && d.scene_request.id;
    if (opts && opts.reuseScene) {   // refine placement/shadow/typography on the saved scene: no image-generation call
      const sc = (await C.ops.get('obImage', { id: x.id, kind: 'scene', site: ctx.brand.site, brand: ctx.brand.name })).image;
      if (!sc) throw new Error(B.name + ': no saved scene to reuse; generate it first.');
      const prev = (await C.ops.get('obImage', { id: x.id, site: ctx.brand.site, brand: ctx.brand.name })).image;   // keep the version being replaced for before/after
      if (prev) await C.ops.post('obEditCreative', { context: ctx, id: x.id, asset: 'before', data: prev, design: { before: { layout: d.layout, qa_overall: d.qa && d.qa.critique && d.qa.critique.overall, at: Date.now() } } });
      g = { image: sc, model: x.imageMeta && x.imageMeta.model, usd: 0, cost_known: true, generation_id: x.imageMeta && x.imageMeta.generation_id, attempts: [], reused: true };
    } else {
      rid = (d.scene_request && d.scene_request.status !== 'done') ? d.scene_request.id : x.id + '-' + Date.now().toString(36);
      await C.ops.post('obEditCreative', { context: ctx, id: x.id, design: { scene_request: { id: rid, status: 'running', at: Date.now() } } });
      msg(B.name + ': painting the empty scene (the image model never sees your product)…');
      g = await C.api('plugins/images/actions/generate', { prompt: B.scenePrompt, raw: true, aspect: '4:5', model: 'pro', requestId: rid, job: x.id });
    }
    msg(B.name + ': reading the scene to place the product…');
    let loc = null; try { loc = await C.api('plugins/images/actions/locate', { image: g.image, job: x.id, hint: B.camera + '. ' + B.lighting }); } catch (e) { loc = null; }
    const P = { ...B.product }; if (loc && loc.confidence >= 0.4) { P.ground_y = Math.min(Math.max(loc.surface_y, B.product.ground_y - 0.12), B.product.ground_y + 0.12); P.cx = Math.min(Math.max(loc.cx, B.product.cx - 0.15), B.product.cx + 0.15); }
    if (B.spec && B.spec.placement) {   // keep the product inside the brief's placement polygon (scene measurement can drift to a back edge)
      const xs = B.spec.placement.map((p) => p[0]), yy = B.spec.placement.map((p) => p[1]);
      P.cx = Math.min(Math.max(P.cx, Math.min(...xs)), Math.max(...xs)); P.ground_y = Math.min(Math.max(P.ground_y, Math.min(...yy)), Math.max(...yy));
    }
    const mv = x.design && x.design.manual_placement; if (mv && opts && opts.reuseScene) Object.assign(P, mv);   // a person's correction wins on re-placement
    const shadow = shadowFor(B, loc), geometry = geometryCheck(B, loc);
    msg(B.name + ': compositing your original product with a grounded shadow…');
    const mask = (await C.ops.get('obImage', { id: x.id, kind: 'mask', site: ctx.brand.site, brand: ctx.brand.name })).image;
    const sceneJ = await sceneForCompositing(g.image);
    let cmp = await compose({ reference: A.ref, mask: mask || undefined, background: sceneJ, width: W, height: H, ...P, shadow }, C);
    let f = cmp.report.foreground, L = layoutFor(x, A, { x: f.x, y: f.y, w: f.w, h: f.h });
    let cv = await CE.compose(cmp.image, L, '4:5', A.font), png = cv.toDataURL('image/png');
    msg(B.name + ': visual review…');
    let crit = null; try { crit = await C.api('plugins/images/actions/critique', { image: cv.toDataURL('image/jpeg', 0.9), brief: B.name + ': ' + B.objective + ' Camera ' + B.camera + '. Light ' + B.lighting + '. Compositing parameters you can name: product position (cx, ground_y), scale, shadow strength/softness/direction, typography; or say the background must be regenerated.', job: x.id }); } catch (e) { crit = { error: e.message }; }
    const refinements = [];
    const wantsShadow = (c) => c && !c.error && (c.findings || []).some((fd) => /shadow/i.test(fd.parameter || '') && !fd.needs_new_background);
    if (wantsShadow(crit)) {   // at most ONE automatic refinement, then a person decides
      const s2 = { ...shadow, strength: Math.min(1.5, (shadow.strength || 1) * 1.35), length: (shadow.length || (shadow.light_from === 'front' ? 0.35 : 0.6)) * 1.25 };
      msg(B.name + ': strengthening the grounding once (reviewer finding)…');
      const c2 = await compose({ reference: A.ref, mask: mask || undefined, background: sceneJ, width: W, height: H, ...P, shadow: s2 }, C);
      const f2 = c2.report.foreground, L2 = layoutFor(x, A, { x: f2.x, y: f2.y, w: f2.w, h: f2.h }); const cv2 = await CE.compose(c2.image, L2, '4:5', A.font);
      let cr2 = null; try { cr2 = await C.api('plugins/images/actions/critique', { image: cv2.toDataURL('image/jpeg', 0.9), brief: B.name + ': ' + B.objective, job: x.id }); } catch (e) { cr2 = { error: e.message }; }
      refinements.push({ change: 'shadow strength ×1.35, cast length ×1.25', before_overall: crit.overall, after_overall: cr2 && cr2.overall, kept: !!(cr2 && !cr2.error && cr2.overall >= crit.overall) });
      if (cr2 && !cr2.error && cr2.overall >= crit.overall) { cmp = c2; f = f2; L = L2; cv = cv2; png = cv2.toDataURL('image/png'); crit = cr2; Object.assign(shadow, s2); }
    }
    const qa = { refinements,
      mask_completeness: cmp.report.mask.status === 'ok' ? 'pass' : 'review', mask: cmp.report.mask,
      protected_pixels: cmp.report.protected_pixel_equality, protected_pixels_changed: cmp.report.protected_pixels_changed,
      grounding: cmp.report.shadow ? (cmp.report.shadow.contact_visible ? 'shadow_drawn' : 'shadow_too_faint') : 'none', shadow: cmp.report.shadow, geometry, fit_to_support: cmp.report.fit_to_support, placement_source: loc && loc.confidence >= 0.4 ? 'vision_located' : 'brief_default', placement: loc,
      text: cv.qa.issues.length ? 'review' : 'pass', text_issues: cv.qa.issues, review_required: cmp.report.review_required, critique: crit, approved: false,
    };
    if (!g.reused) await C.ops.post('obEditCreative', { context: ctx, id: x.id, asset: 'scene', data: g.image });
    await C.ops.post('obEditCreative', { context: ctx, id: x.id, image: cmp.image, layout: strip(L), approve: false,
      imageMeta: { model: g.model, usd: g.reused ? (x.imageMeta && x.imageMeta.usd) : g.usd, reused_scene: !!g.reused, cost_known: g.cost_known, generation_id: g.generation_id, attempts: g.attempts, ms: Date.now() - t0, aspect: '4:5', source: 'Scene by ' + g.model + ' (no product reference); original product composited; text by the Cold Start editor', productImage: S.flagship && S.flagship.image },
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
  async function renderBefore({ C, S, ctx, x }) {
    const A = await brand({ C, S }); const r = await C.ops.get('obImage', { id: x.id, kind: 'before', site: ctx.brand.site, brand: ctx.brand.name });
    if (!r.image) return null; const L = layoutFor(x, A, (x.design && x.design.before && x.design.before.layout && x.design.before.layout.productBox) || null);
    return CE.compose(r.image, L, '4:5', A.font);
  }
  window.AdPipe = { prototype, final, assets, layoutFor, brand, render, renderBefore, strip };
})();
