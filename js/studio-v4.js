/* Coldstart v4 Creative Studio: Product Library, Product Shoot, Create Ads, Animate, plus a QA report.
   Principle: the customer's real product is the source of truth.
   - Original uploads are immutable (SHA-256 recorded) and are never sent through an edit unless the user picks creative-first.
   - Ad text (headline, price, CTA) is drawn as real text layers after the image, so copy is exact and editable without regenerating.
   - Product Lock video only moves the camera over the approved still: zoom, pan and text. No pixels are redrawn.
   - Anything a generative model touched is labelled "synthesized", and checks we cannot run say "Unverified", never "Passed". */
(function () {
  const C = window.CS, esc = C.esc;
  const DB = 'coldstart-v4-media';
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const media = {
    async put(k, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('m', 'readwrite'); t.objectStore('m').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
    async get(k) { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction('m').objectStore('m').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); },
    async del(k) { const d = await idb(); return new Promise((res) => { const t = d.transaction('m', 'readwrite'); t.objectStore('m').delete(k); t.oncomplete = res; }); }
  };
  const store = () => (C.S.studio || (C.S.studio = { skus: [], assets: [], tab: 'shoot', sel: {} }));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const $ = (s, r) => (r || document).querySelector(s);
  let toast = () => {}, rerender = () => {};
  const urlCache = {};
  async function srcOf(k) { if (!k) return ''; if (urlCache[k]) return urlCache[k]; const v = await media.get(k); if (!v) return ''; const u = typeof v === 'string' ? v : URL.createObjectURL(v); urlCache[k] = u; return u; }
  const sha = async (src) => { const b = typeof src === 'string' ? await (await fetch(src)).arrayBuffer() : await src.arrayBuffer(); const h = await crypto.subtle.digest('SHA-256', b); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  const loadImg = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = u; });
  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });

  function palette(img) {
    const c = document.createElement('canvas'); c.width = c.height = 24; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data, bins = {};
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; const k = [d[i], d[i + 1], d[i + 2]].map((v) => Math.round(v / 48) * 48).join(','); bins[k] = (bins[k] || 0) + 1; }
    return Object.entries(bins).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => '#' + k.split(',').map((v) => Math.min(255, +v).toString(16).padStart(2, '0')).join(''));
  }

  /* ---------- Product Library ---------- */
  async function addRef(skuId, dataUrl, label) {
    const img = await loadImg(dataUrl), id = uid('ref-');
    await media.put(id, dataUrl);
    const sku = store().skus.find((s) => s.id === skuId);
    sku.refs.push({ id, label: label || 'Original', w: img.naturalWidth, h: img.naturalHeight, sha: await sha(dataUrl), colors: palette(img), at: new Date().toISOString() });
    C.save();
  }
  async function newSku(name, price, dataUrl, source) {
    const sku = { id: uid('sku-'), name: name || 'Untitled product', price: Number(price) || 0, source: source || 'upload', refs: [] };
    store().skus.unshift(sku); await addRef(sku.id, dataUrl); return sku;
  }
  async function importStore() {
    const prods = (C.S.products || []).filter((p) => p.image && !store().skus.some((s) => s.name === p.name)).slice(0, 6);
    if (!prods.length) return toast('No new store photos to import.');
    let ok = 0;
    for (const p of prods) {
      try { const r = await C.api('plugins/images/actions/photo', { url: p.image }); await newSku(p.name, p.price, r.image, 'store'); ok++; } catch (e) { /* skip one */ }
    }
    toast(ok ? 'Imported ' + ok + ' product photo' + (ok > 1 ? 's' : '') + '.' : 'Could not fetch those photos. Upload them instead.');
    rerender();
  }

  async function library(root) {
    const st = store();
    const cards = await Promise.all(st.skus.map(async (s) => {
      const th = await Promise.all(s.refs.map(async (r) => `<figure style="margin:0"><img src="${esc(await srcOf(r.id))}" alt="${esc(s.name)} ${esc(r.label)}" class="th"><figcaption class="mono small">${esc(r.label)} · ${r.w}×${r.h}</figcaption></figure>`));
      const r0 = s.refs[0] || {};
      return `<article class="sku"><div class="th-row">${th.join('')}</div>
        <div style="display:grid;gap:8px"><label class="field"><span>Product name (one SKU, one identity)</span><input data-sku-name="${s.id}" type="text" value="${esc(s.name)}"></label>
        <div class="tags"><span class="chip b">${s.refs.length} reference${s.refs.length > 1 ? 's' : ''}</span><span class="chip ${s.refs.length >= 3 ? 'y' : 'dash'}">${s.refs.length >= 3 ? 'Good coverage' : 'Add 3 to 5 angles for packaging detail'}</span><span class="chip dash">OCR: not run</span></div>
        <small class="muted mono" style="word-break:break-all">Original locked · sha256 ${esc((r0.sha || '').slice(0, 16))}… · colours ${(r0.colors || []).map((c) => `<i class="sw-dot" style="background:${esc(c)}"></i>`).join('')}</small>
        <div class="tags" data-ident="${s.id}"><span class="chip dash">No identity yet</span></div><div class="row-btns"><button class="btn sm yellow" data-ident-open="${s.id}" type="button">Product identity</button><label class="btn sm ghost" style="cursor:pointer">Add angle<input type="file" accept="image/png,image/jpeg,image/webp" data-add-ref="${s.id}" hidden></label><button class="btn sm" data-shoot="${s.id}" type="button">Open in Studio</button><button class="btn sm ghost" data-del-sku="${s.id}" type="button">Remove</button></div></div></article>`;
    }));
    root.innerHTML = `${head('library')}
      <div class="pagehead"><div><span class="eyebrow">Campaigns / Product Library</span><h1 class="disp">Your real product is the <b>source of truth.</b></h1><p class="muted">Upload photos of the actual product. Originals are stored once, never overwritten, and every creative traces back to one. A 50 ml and a 100 ml bottle are two products.</p></div></div>
      <div class="panel"><div class="panel-b" style="display:grid;gap:14px"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label class="field" style="flex:1;min-width:200px"><span>Product name</span><input id="up-name" type="text" placeholder="Barrier Cream 50 ml" value="${esc((C.S.flagship || {}).name || '')}"></label>
        <label class="field" style="width:130px"><span>Price</span><input id="up-price" type="number" min="0" placeholder="799" value="${esc(String((C.S.flagship || {}).price || ''))}"></label>
        <label class="btn" style="cursor:pointer">Upload product photo<input id="up-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>
        ${(C.S.products || []).some((p) => p.image) ? '<button class="btn ghost" id="imp" type="button">Import from my store</button>' : ''}</div>
        <small class="muted">JPG, PNG or WebP up to 6 MB. Stored in this browser only. One photo is enough to start.</small></div></div>
      <div class="sku-list">${cards.join('') || '<div class="empty" style="margin:0"><strong>No products yet.</strong><p>Add one photo of the product you want to advertise.</p></div>'}</div>`;
    $('#up-file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 6e6) return toast('That photo is over 6 MB.'); try { await newSku($('#up-name').value.trim() || f.name.replace(/\.[^.]+$/, ''), $('#up-price').value, await readFile(f)); toast('Saved. Original is locked.'); rerender(); } catch (er) { toast(er.message); } };
    const imp = $('#imp'); if (imp) imp.onclick = importStore;
    masters_().then((ms) => root.querySelectorAll('[data-ident]').forEach((n) => { const sk = st.skus.find((x) => x.id === n.dataset.ident); n.innerHTML = window.Identity.statusChip(ms.find((m) => m.id === sk.masterId)); })).catch(() => {});
    root.querySelectorAll('[data-ident-open]').forEach((b) => b.onclick = () => window.Identity.openMaster(b.dataset.identOpen));
    root.querySelectorAll('[data-add-ref]').forEach((i) => i.onchange = async () => { const f = i.files[0]; if (!f || f.size > 6e6) return toast('Pick a photo under 6 MB.'); const n = store().skus.find((s) => s.id === i.dataset.addRef).refs.length; await addRef(i.dataset.addRef, await readFile(f), ['Side', 'Back', 'Close-up', 'Detail'][n - 1] || 'Angle'); rerender(); });
    root.querySelectorAll('[data-sku-name]').forEach((i) => i.onchange = () => { store().skus.find((s) => s.id === i.dataset.skuName).name = i.value.trim() || 'Untitled product'; C.save(); });
    root.querySelectorAll('[data-del-sku]').forEach((b) => b.onclick = () => { const st2 = store(); const s = st2.skus.find((x) => x.id === b.dataset.delSku); s.refs.forEach((r) => media.del(r.id)); st2.skus = st2.skus.filter((x) => x !== s); C.save(); rerender(); });
    root.querySelectorAll('[data-shoot]').forEach((b) => b.onclick = () => { store().sel.sku = b.dataset.shoot; C.save(); location.hash = '#/campaigns/studio'; });
  }
  const masters_ = () => window.Identity.masters(true);
  const head = (cur) => `<div class="subnav"><a href="#/campaigns/c1" ${cur === 'c' ? 'aria-current="page"' : ''}>Campaign</a><a href="#/campaigns/studio" ${cur === 'studio' ? 'aria-current="page"' : ''}>Creative Studio</a><a href="#/campaigns/library" ${cur === 'library' ? 'aria-current="page"' : ''}>Product Library</a></div>`;

  /* ---------- QA report ---------- */
  function qa(a) {
    const rows = [], gen = a.synth;
    rows.push(['Source product', a.skuId ? 'pass' : 'warn', a.skuId ? 'Linked to an original in the Product Library.' : 'No source product.']);
    rows.push(['Original pixels protected', gen ? 'unverified' : 'pass', gen ? 'Creative-first: the product went through a generative model. It may differ from your real product.' : 'Original photo pixels are used as they are.']);
    rows.push(['Label text', (a.textLayers || !gen) ? 'pass' : 'unverified', a.textLayers ? 'Headline, price and CTA are real text layers: exact characters, editable.' : !gen ? 'No text was added or redrawn.' : 'No OCR service connected, so printed packaging text is not verified.']);
    if (a.kind !== 'video' || gen) rows.push(['Printed label on product', gen ? 'unverified' : 'pass', gen ? 'Not machine-checked (OCR not connected). Compare with your original.' : 'Taken from your original photo, unchanged.']);
    rows.push(['Logo', gen ? 'unverified' : 'pass', gen ? 'Logo match needs approved artwork and a checker. Not connected.' : 'Original pixels, so the logo is as photographed.']);
    if (a.w) rows.push(['Resolution', Math.min(a.w, a.h) >= 1000 ? 'pass' : 'warn', a.w + '×' + a.h + (Math.min(a.w, a.h) >= 1000 ? '' : '. Low for ads: export may look soft.')]);
    if (a.kind === 'video') rows.push(['Temporal consistency', 'pass', 'Product Lock: one still, camera moves only. No frames are generated.']);
    const bad = rows.some((r) => r[1] === 'warn'), unv = rows.some((r) => r[1] === 'unverified');
    return { rows, decision: bad ? 'Regenerate' : (gen || unv) ? 'Needs manual review' : 'Publishable' };
  }
  const qaHtml = (q) => `<div class="qa"><div class="qa-h"><strong>Creative QA</strong><span class="chip ${q.decision === 'Publishable' ? 'b' : q.decision === 'Regenerate' ? 'warn' : 'y'}">${q.decision}</span></div>${q.rows.map((r) => `<div class="qa-r"><span>${esc(r[0])}</span><span class="chip ${r[1] === 'pass' ? 'b' : r[1] === 'warn' || r[1] === 'fail' ? 'warn' : 'dash'}">${r[1] === 'unverified' ? 'Unverified' : r[1] === 'pass' ? 'Pass' : r[1] === 'fail' ? 'Fail' : 'Check'}</span><small>${esc(r[2])}</small></div>`).join('')}</div>`;

  /* ---------- Studio shell ---------- */
  const TABS = [['shoot', 'Product Shoot', 'Studio and lifestyle images'], ['ads', 'Create Ads', 'Campaign-ready creatives'], ['animate', 'Animate', 'Short product videos'], ['jobs', 'Jobs', 'Generation queue and cost']];
  async function studio(root) {
    const st = store(); const tab = st.tab || 'shoot';
    root.innerHTML = `${head('studio')}<div class="pagehead"><div><span class="eyebrow">Campaigns / Creative Studio</span><h1 class="disp">Make it <b>look like you.</b></h1><p class="muted">Three actions. No prompts, seeds or node graphs. Nothing here publishes: approve a creative, then it joins the campaign for the launch review.</p></div></div>
      <div class="tabs3">${TABS.map((t) => `<button class="tab3" data-tab="${t[0]}" aria-pressed="${tab === t[0]}" type="button"><strong>${t[1]}</strong><small>${t[2]}</small></button>`).join('')}</div><div id="studio-body"></div>`;
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { st.tab = b.dataset.tab; C.save(); rerender(); });
    const body = $('#studio-body');
    if (tab === 'jobs') return window.Identity.jobsPanel(body);
    if (!st.skus.length) { body.innerHTML = '<div class="empty" style="margin:0"><strong>Start with a real product photo.</strong><p>The Studio always builds from your own product so it never changes what you sell.</p><a class="btn" href="#/campaigns/library" style="margin-top:12px">Open Product Library</a></div>'; return; }
    await ({ shoot, ads, animate, jobs: () => window.Identity.jobsPanel(body) })[tab](body);
  }
  const skuSel = (sel) => `<label class="field"><span>Product</span><select id="f-sku">${store().skus.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`;
  const assetsOf = (kind) => store().assets.filter((a) => !kind || a.kind === kind);
  async function gallery(list, emptyMsg) {
    if (!list.length) return `<div class="empty" style="margin:0">${emptyMsg}</div>`;
    const items = await Promise.all(list.map(async (a) => `<article class="asset"><div class="asset-media">${a.kind === 'video' ? `<video src="${esc(await srcOf(a.mediaId))}" controls muted loop playsinline></video>` : `<img src="${esc(await srcOf(a.mediaId))}" alt="${esc(a.title)}">`}</div>
      <div class="asset-b"><strong>${esc(a.title)}</strong><div class="tags"><span class="chip ${a.synth ? 'warn' : 'b'}">${a.synth ? 'Synthesized product' : 'Original pixels'}</span><span class="chip ${a.approved ? 'y' : 'dash'}">${a.approved ? 'Approved' : 'Draft'}</span>${a.verified ? '<span class="chip b">Checks passed</span>' : a.synth ? '<span class="chip dash">Not verified</span>' : ''}</div>${qaHtml(a.qa)}
      ${a.rejected ? `<div class="chip warn">Rejected: ${esc(a.rejected.reason)}</div>` : ''}
      <div class="row-btns">${a.approved ? `<button class="btn sm ghost" data-unapprove="${a.id}" type="button">Unapprove</button>` : ((a.synth || (a.spec && a.spec.mode === 'pixel-locked')) ? `<button class="btn sm yellow" data-compare="${a.id}" type="button">Compare and review</button>` : `<button class="btn sm yellow" data-approve="${a.id}" type="button">Approve</button>`)}<button class="btn sm ghost" data-use="${a.id}" type="button">Use as source</button><a class="btn sm ghost" href="${esc(await srcOf(a.mediaId))}" download="${esc((a.title || 'creative').replace(/\W+/g, '-'))}.${a.kind === 'video' ? 'webm' : 'png'}">Download</a><button class="btn sm ghost" data-del="${a.id}" type="button">Delete</button></div></div></article>`));
    return `<div class="asset-grid">${items.join('')}</div>`;
  }
  function wireAssets(body) {
    body.querySelectorAll('[data-compare]').forEach((b) => b.onclick = () => window.Identity.compare(b.dataset.compare));
    body.querySelectorAll('[data-approve]').forEach((b) => b.onclick = () => { const a = store().assets.find((x) => x.id === b.dataset.approve); a.approved = true; C.log('creative', 'Approved creative: ' + a.title, { asset: a.id, synthesized: !!a.synth, source: a.spec && a.spec.source }); C.S.inbox = (C.S.inbox || []).filter((i) => i.id !== 'rv-' + a.id); C.save(); const camp = (C.S.campaigns || [])[0]; C.S.activity.unshift({ t: new Date().toISOString(), text: 'Approved creative “' + a.title + '” for the campaign.' }); C.save(); toast('Approved. It joins the campaign launch review.'); rerender(); });
    body.querySelectorAll('[data-unapprove]').forEach((b) => b.onclick = () => { store().assets.find((x) => x.id === b.dataset.unapprove).approved = false; C.save(); rerender(); });
    body.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { const s = store(); const a = s.assets.find((x) => x.id === b.dataset.del); media.del(a.mediaId); s.assets = s.assets.filter((x) => x !== a); C.save(); rerender(); });
    body.querySelectorAll('[data-use]').forEach((b) => b.onclick = () => { store().sel.asset = b.dataset.use; store().tab = 'ads'; C.save(); rerender(); });
  }

  /* ---------- A. Product Shoot ---------- */
  const DIRS = {
    studio: { t: 'Studio', plan: { camera: 'eye level, 85mm look', surface: 'seamless light-grey sweep', lighting: 'soft key light, gentle contact shadow', space: 'generous negative space on the left' } },
    luxury: { t: 'Luxury', plan: { camera: 'low angle, shallow depth of field', surface: 'dark polished stone with a soft reflection', lighting: 'moody rim light with a warm accent', space: 'negative space above the product' } },
    lifestyle: { t: 'Lifestyle', plan: { camera: 'slightly raised, natural framing', surface: 'wooden shelf in a bright room, a few neutral props', lighting: 'soft window light', space: 'room on the right' } },
    editorial: { t: 'Editorial', plan: { camera: 'dramatic three-quarter angle', surface: 'coloured paper set with one bold shape', lighting: 'hard light with a crisp shadow', space: 'asymmetric composition' } }
  };
  const RAT = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920], '16:9': [1920, 1080] };
  let busy = false;
  async function shoot(body) {
    const st = store(), sel = st.sel; const sku = st.skus.find((s) => s.id === sel.sku) || st.skus[0];
    const dir = sel.dir || 'studio', ratio = sel.ratio || '1:1';
    const lockedOk = await C.ops.get('integrations').then((r) => /^configured/.test(r.compositor || '')).catch(() => false); const mode = lockedOk && sel.mode !== 'creative' ? 'locked' : 'creative';
    body.innerHTML = `<div class="grid-main"><div class="stack"><section class="panel"><div class="panel-b" style="display:grid;gap:16px">
      ${skuSel(sku.id)}
      <div><span class="eyebrow">Visual direction</span><div class="seg" role="group">${Object.entries(DIRS).map(([k, d]) => `<button data-dir="${k}" aria-pressed="${dir === k}" type="button">${d.t}</button>`).join('')}<button data-dir="surprise" aria-pressed="${dir === 'surprise'}" type="button">Surprise me</button></div></div>
      <div><span class="eyebrow">Aspect ratio</span><div class="seg" role="group">${Object.keys(RAT).map((k) => `<button data-ratio="${k}" aria-pressed="${ratio === k}" type="button">${k}</button>`).join('')}</div></div>
      <div id="ident-gate"></div>
      <div><span class="eyebrow">What may change in this shoot?</span><div id="alter-box" class="stack" style="gap:6px"></div>
        <div class="opt-grid three" style="grid-template-columns:1fr 1fr;margin-top:10px"><button class="opt" type="button" id="mode-locked" ${lockedOk ? `aria-pressed="${mode === 'locked'}"` : 'disabled aria-disabled="true"'}><span class="chip ${lockedOk ? 'y' : 'dash'}">${lockedOk ? 'Available' : 'Not connected'}</span><strong>Fidelity-first</strong><small>${lockedOk ? 'Cuts your product out with a real matte, keeps its original pixels untouched and builds the scene around it. Checked from the output pixels.' : 'Needs the product compositor (COMPOSITE_API_URL). Nothing is simulated.'}</small></button>
        <button class="opt" type="button" id="mode-creative" aria-pressed="${mode === 'creative'}"><span class="chip y">Available</span><strong>Creative-first</strong><small>Reference-guided edit. The whole image is regenerated, so every result is labelled synthesized and needs your comparison.</small></button></div></div>
      <div><button class="btn lg" id="go-shoot" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Shooting… up to a minute' : 'Create product shoot →'}</button> <span class="muted small">Uses one image generation. Server caps apply.</span></div>
      <div id="shoot-err"></div></div></section></div>
      <aside class="stack"><section class="panel"><div class="panel-h"><h2>Reference</h2></div><div class="panel-b"><img class="th big" src="${esc(await srcOf((sku.refs[0] || {}).id))}" alt="${esc(sku.name)}"><p class="small muted" style="margin-top:8px">${sku.refs.length} reference${sku.refs.length > 1 ? 's' : ''}. ${sku.refs.length < 3 ? 'For new viewpoints, add side, back and close-up photos in the Library. I won’t invent unseen sides.' : 'Good coverage.'}</p></div></section></aside></div>
      <section><h2 class="disp s" style="margin-bottom:12px">Product shoots</h2>${await gallery(assetsOf('shoot'), '<strong>No shoots yet.</strong>')}</section>`;
    if (!body.isConnected || !$('#f-sku')) return;
    $('#f-sku').onchange = (e) => { sel.sku = e.target.value; C.save(); rerender(); };
    body.querySelectorAll('[data-dir]').forEach((b) => b.onclick = () => { sel.dir = b.dataset.dir; C.save(); rerender(); });
    body.querySelectorAll('[data-ratio]').forEach((b) => b.onclick = () => { sel.ratio = b.dataset.ratio; C.save(); rerender(); });
    const m = await window.Identity.masterOf(sku).catch(() => null);
    const ok = m && m.status === 'approved';
    $('#ident-gate').innerHTML = ok ? `<div class="tags">${window.Identity.statusChip(m)}<small class="muted mono">identity hash ${esc(m.hash.slice(0, 12))}…</small></div>` : `<div class="err">${m && m.status === 'needs_reapproval' ? 'This product’s identity changed. Re-approve it before generating.' : 'No approved product identity yet. Generation stays locked until you confirm the packaging text, logo and colours.'} <button class="btn sm" id="open-id" type="button">Set up product identity</button></div>`;
    const oi = $('#open-id'); if (oi) oi.onclick = () => window.Identity.openMaster(sku.id);
    const want = sel.alter || (sel.alter = { background: true });
    $('#alter-box').innerHTML = [['background', 'Background and scene'], ['relight', 'Lighting'], ['recolor', 'Product colour'], ['viewpoint', 'New viewpoint (synthesized)']].map(([k, t]) => { const allowed = ok && m.alter[k]; return `<label class="check-inline" style="${allowed ? '' : 'opacity:.55'}"><input type="checkbox" data-want="${k}" ${allowed && want[k] ? 'checked' : ''} ${allowed ? '' : 'disabled'}> ${t}${allowed ? '' : ' <small class="muted">(not allowed on this product)</small>'}</label>`; }).join('');
    body.querySelectorAll('[data-want]').forEach((i) => i.onchange = () => { want[i.dataset.want] = i.checked; C.save(); });
    $('#go-shoot').disabled = busy || !ok;
    const ml = $('#mode-locked'); if (ml && lockedOk) ml.onclick = () => { sel.mode = 'locked'; C.save(); rerender(); }; $('#mode-creative').onclick = () => { sel.mode = 'creative'; C.save(); rerender(); };
    $('#go-shoot').onclick = () => runShoot(sku, dir, ratio, body, mode);
    wireAssets(body);
  }
  async function runShoot(sku, dir, ratio, body, mode) {
    if (busy) return;
    if (mode === 'locked') { busy = true; rerender(); try { const { asset } = await window.Identity.generateLocked({ sku, ratio }); toast(asset.qa.rows[0][1] === 'pass' ? 'Done. Product pixels were kept. Compare, then approve.' : 'Checks need your review.'); } catch (e) { toast(e.message); } busy = false; rerender(); return; }
    const keys = Object.keys(DIRS), d = dir === 'surprise' ? keys[Math.floor(Math.random() * keys.length)] : dir, plan = DIRS[d].plan;
    const alter = Object.fromEntries(Object.entries(store().sel.alter || {}).filter(([, v]) => v));
    if (!Object.keys(alter).length) return toast('Choose what may change first.');
    const idea = `${DIRS[d].t} product photograph. Camera: ${plan.camera}. Surface: ${plan.surface}. Lighting: ${plan.lighting}. Composition: ${plan.space}. One product only.`;
    busy = true; rerender();
    try {
      const { asset, job } = await window.Identity.generate({ sku, idea, ratio, alter, dirTitle: DIRS[d].t });
      if (job.state === 'validating') { toast('Checking the label and colours against your product…'); await window.Identity.runQA(asset).catch((e) => toast('Checks could not finish: ' + e.message)); }
      else toast('Generation failed: ' + ((job.error && job.error.message) || 'provider error'));
    } catch (e) { toast(e.message); window.__shootErr = e.message; }
    busy = false; rerender();
  }
  const readBlob = async (u) => readFile(await (await fetch(u)).blob());

  /* ---------- B. Create Ads ---------- */
  const PLAT = { instagram: ['Instagram', 1080, 1350], facebook: ['Facebook', 1200, 628], x: ['X', 1600, 900] };
  const GOALS = { sales: ['Get sales', 'Shop now'], intro: ['Introduce my product', 'Meet it'], visit: ['Bring visitors to my website', 'Learn more'] };
  const STYLE = { editorial: 'Premium editorial', lifestyle: 'Real-world lifestyle', bold: 'Bold graphic' };
  function adSpec() {
    const sel = store().sel, b = C.S.brand || {}, ic = (C.S.icps || []).find((i) => i.on !== false) || {};
    const g = sel.goal || 'sales';
    return Object.assign({ goal: g, plat: 'instagram', style: 'editorial', headline: b.headline || ic.hook || (b.name ? 'Meet ' + b.name : ''), price: '', cta: GOALS[g][1] }, sel.ad || {});
  }
  async function sourceImage() {
    const st = store(), sel = st.sel;
    const a = st.assets.find((x) => x.id === sel.asset && x.kind !== 'video');
    if (a) return { url: await srcOf(a.mediaId), skuId: a.skuId, synth: a.synth, label: a.title, from: a.id };
    const sku = st.skus.find((s) => s.id === sel.sku) || st.skus[0];
    return { url: await srcOf((sku.refs[0] || {}).id), skuId: sku.id, synth: false, label: sku.name + ' (original photo)', from: null };
  }
  function drawAd(canvas, img, sp) {
    const [, W, H] = PLAT[sp.plat]; canvas.width = W; canvas.height = H; const x = canvas.getContext('2d'), P = (C.S.brand && C.S.brand.colors) || [];
    const prim = /^#[0-9a-f]{6}$/i.test(P[0] || '') ? P[0] : '#0000F2';
    const k = Math.max(W / img.naturalWidth, H / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    x.fillStyle = '#111'; x.fillRect(0, 0, W, H); x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const m = Math.round(W * 0.06), disp = (s) => `italic ${s}px "Zen Dots", "Arial Black", sans-serif`, body = (s) => `600 ${s}px "Sora", system-ui, sans-serif`;
    const wrap = (t, font, maxW) => { x.font = font; const words = String(t).split(/\s+/), lines = []; let cur = ''; words.forEach((w) => { const tt = cur ? cur + ' ' + w : w; if (x.measureText(tt).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tt; }); if (cur) lines.push(cur); return lines; };
    const hs = Math.round(W * (sp.style === 'bold' ? 0.062 : 0.05)), caps = sp.style === 'bold';
    const head = (caps ? sp.headline.toUpperCase() : sp.headline);
    if (sp.style === 'bold') {
      const lines = wrap(head, disp(hs), W - m * 2 - 40), bh = lines.length * hs * 1.15 + 60 + (sp.price ? hs : 0) + hs * 1.6;
      x.fillStyle = prim; x.fillRect(m, H - m - bh, W - m * 2, bh); x.fillStyle = '#fff'; x.font = disp(hs); x.textBaseline = 'top';
      lines.forEach((l, i) => x.fillText(l, m + 20, H - m - bh + 30 + i * hs * 1.15)); let y = H - m - bh + 30 + lines.length * hs * 1.15 + 10;
      if (sp.price) { x.font = body(hs * 0.7); x.fillText(sp.price, m + 20, y); y += hs; }
      pill(x, sp.cta, m + 20, y, hs * 0.5, '#ECEA36', '#000091');
    } else {
      const g = x.createLinearGradient(0, H * (sp.style === 'lifestyle' ? 0.55 : 0.5), 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      const lines = wrap(head, disp(hs), W - m * 2), hh = lines.length * hs * 1.15; x.fillStyle = '#fff'; x.textBaseline = 'top'; x.font = disp(hs);
      let y = H - m - hh - hs * 1.8 - (sp.price ? hs : 0); lines.forEach((l, i) => x.fillText(l, m, y + i * hs * 1.15)); y += hh + 14;
      if (sp.price) { x.font = body(hs * 0.62); x.fillText(sp.price, m, y); y += hs; }
      pill(x, sp.cta, m, y, hs * 0.48, '#ECEA36', '#000091');
    }
  }
  function pill(x, t, px, py, fs, bg, fg) { x.font = `600 ${fs}px "Sora", sans-serif`; const w = x.measureText(t.toUpperCase()).width + fs * 1.6, h = fs * 2; x.fillStyle = bg; x.beginPath(); x.roundRect ? x.roundRect(px, py, w, h, 6) : x.rect(px, py, w, h); x.fill(); x.fillStyle = fg; x.textBaseline = 'middle'; x.fillText(t.toUpperCase(), px + fs * 0.8, py + h / 2); x.textBaseline = 'top'; }
  async function ads(body) {
    const sp = adSpec(), src = await sourceImage(), st = store();
    await document.fonts.load('italic 40px "Zen Dots"').catch(() => {}); await document.fonts.load('600 20px Sora').catch(() => {});
    body.innerHTML = `<div class="grid-main"><div class="stack"><section class="panel"><div class="panel-b" style="display:grid;gap:16px">
      <div><span class="eyebrow">What should this creative achieve?</span><div class="seg" role="group">${Object.entries(GOALS).map(([k, g]) => `<button data-goal="${k}" aria-pressed="${sp.goal === k}" type="button">${g[0]}</button>`).join('')}</div></div>
      <div><span class="eyebrow">Where is it going?</span><div class="seg" role="group">${Object.entries(PLAT).map(([k, p]) => `<button data-plat="${k}" aria-pressed="${sp.plat === k}" type="button">${p[0]}</button>`).join('')}</div></div>
      <div><span class="eyebrow">Creative direction</span><div class="seg" role="group">${Object.entries(STYLE).map(([k, t]) => `<button data-style="${k}" aria-pressed="${sp.style === k}" type="button">${t}</button>`).join('')}</div></div>
      <label class="field"><span>Headline · real text layer, exact</span><input id="ad-h" type="text" maxlength="70" value="${esc(sp.headline)}"></label>
      <div class="cols2"><label class="field"><span>Price or offer (optional)</span><input id="ad-p" type="text" maxlength="30" placeholder="₹799" value="${esc(sp.price)}"></label><label class="field"><span>Call to action</span><input id="ad-c" type="text" maxlength="24" value="${esc(sp.cta)}"></label></div>
      <label class="field"><span>Source image</span><select id="ad-src"><option value="">${esc(src.label)}</option>${st.assets.filter((a) => a.kind !== 'video' && a.approved).map((a) => `<option value="${a.id}" ${a.id === src.from ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select><small>${src.synth ? 'This source is synthesized: the product may differ from your real one.' : 'Original pixels. The product is not redrawn.'}</small></label>
      <div><button class="btn lg" id="ad-save" type="button">Save this creative →</button> <span class="muted small">Editing the headline re-renders text only. Nothing is regenerated.</span></div></div></section></div>
      <aside class="stack"><section class="panel"><div class="panel-h"><h2>Preview · ${PLAT[sp.plat][0]} ${PLAT[sp.plat][1]}×${PLAT[sp.plat][2]}</h2></div><div class="panel-b"><canvas id="ad-cv" class="ad-cv" aria-label="Ad preview"></canvas><p class="small muted" style="margin-top:8px">Text sits over the photo. If it covers the product, switch direction or use a source with empty space.</p></div></section></aside></div>
      <section><h2 class="disp s" style="margin-bottom:12px">Ad creatives</h2>${await gallery(assetsOf('ad'), '<strong>No ad creatives yet.</strong>')}</section>`;
    let img = null; try { img = await loadImg(src.url); } catch (e) { return toast(e.message); }
    const draw = () => drawAd($('#ad-cv'), img, adSpec());
    draw();
    const set = (patch) => { st.sel.ad = Object.assign(adSpec(), patch); C.save(); };
    body.querySelectorAll('[data-goal]').forEach((b) => b.onclick = () => { const g = b.dataset.goal; set({ goal: g, cta: GOALS[g][1] }); st.sel.goal = g; rerender(); });
    body.querySelectorAll('[data-plat]').forEach((b) => b.onclick = () => { set({ plat: b.dataset.plat }); rerender(); });
    body.querySelectorAll('[data-style]').forEach((b) => b.onclick = () => { set({ style: b.dataset.style }); rerender(); });
    [['ad-h', 'headline'], ['ad-p', 'price'], ['ad-c', 'cta']].forEach(([id, k]) => $('#' + id).addEventListener('input', (e) => { set({ [k]: e.target.value }); draw(); }));
    $('#ad-src').onchange = (e) => { st.sel.asset = e.target.value || null; C.save(); rerender(); };
    $('#ad-save').onclick = async () => {
      const s = adSpec(); if (!s.headline.trim()) return toast('Add a headline first.');
      const cv = $('#ad-cv'), url = cv.toDataURL('image/png'), id = uid('as-'); await media.put(id, url);
      const a = { id, kind: 'ad', skuId: src.skuId, mediaId: id, title: s.headline.slice(0, 40) + ' · ' + PLAT[s.plat][0], synth: !!src.synth, approved: false, textLayers: true, w: cv.width, h: cv.height, spec: { ...s, source: src.from || 'original', layers: ['headline', 'price', 'cta'] }, at: new Date().toISOString() };
      a.qa = qa(a); st.assets.unshift(a); C.log('creative', 'Saved ad draft: ' + a.title, { asset: a.id, layers: a.spec.layers }); C.save(); toast('Saved as a draft creative.'); rerender();
    };
    wireAssets(body);
  }

  /* ---------- C. Animate (Product Lock) ---------- */
  async function animate(body) {
    const st = store(), cands = st.assets.filter((a) => a.kind !== 'video' && a.approved);
    const sel = st.sel.anim || {};
    body.innerHTML = `<div class="grid-main"><div class="stack"><section class="panel"><div class="panel-b" style="display:grid;gap:16px">
      <div><span class="eyebrow">Mode</span><div class="opt-grid three">
        <button class="opt" type="button" aria-pressed="true"><span class="chip y">Available</span><strong>Product Lock</strong><small>Your approved still stays untouched. Only the camera push-in, pan and light move.</small></button>
        <button class="opt" type="button" disabled><span class="chip dash">Not connected</span><strong>Cinematic AI</strong><small>Image-to-video models (Wan, LTX). Needs a GPU service and identity-drift checks.</small></button>
        <button class="opt" type="button" disabled><span class="chip dash">Not connected</span><strong>True 3D</strong><small>Orbits need several views or a 3D asset. I won’t invent your product’s back.</small></button></div></div>
      ${cands.length ? `<label class="field"><span>Approved still to animate</span><select id="an-src">${cands.map((a) => `<option value="${a.id}" ${a.id === sel.id ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></label>
      <div class="cols2"><label class="field"><span>Motion</span><select id="an-m"><option value="push">Slow push-in</option><option value="pan">Gentle pan</option></select></label><label class="field"><span>Length</span><select id="an-d"><option value="5">5 seconds</option><option value="8">8 seconds</option></select></label></div>
      <div><button class="btn lg" id="an-go" type="button">Render video →</button> <span class="muted small">Renders in your browser. Nothing is uploaded.</span></div>` : '<div class="empty" style="margin:0"><strong>Approve a still first.</strong><p>Product Lock animates a creative you approved, so the product on screen is one you already checked. Approve an ad or shoot in the other tabs.</p></div>'}
      </div></section></div><aside class="stack"><section class="panel"><div class="panel-h"><h2>Preview</h2></div><div class="panel-b"><canvas id="an-cv" class="ad-cv"></canvas><p class="small muted" id="an-note" style="margin-top:8px">Zoom stays under 8%, so edges may crop slightly.</p></div></section></aside></div>
      <section><h2 class="disp s" style="margin-bottom:12px">Videos</h2>${await gallery(assetsOf('video'), '<strong>No videos yet.</strong>')}</section>`;
    wireAssets(body);
    if (!cands.length) return;
    $('#an-go').onclick = async () => {
      const a = cands.find((x) => x.id === $('#an-src').value) || cands[0], mo = $('#an-m').value, dur = Number($('#an-d').value), btn = $('#an-go');
      if (typeof MediaRecorder === 'undefined') return toast('This browser can’t record video. Try Chrome or Edge.');
      btn.disabled = true; btn.textContent = 'Rendering… ' + dur + ' s';
      try {
        const img = await loadImg(await srcOf(a.mediaId)), cv = $('#an-cv'), maxW = 1080, sc = Math.min(1, maxW / img.naturalWidth);
        cv.width = Math.round(img.naturalWidth * sc) & ~1; cv.height = Math.round(img.naturalHeight * sc) & ~1; const x = cv.getContext('2d');
        const stream = cv.captureStream(30), rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm', videoBitsPerSecond: 6e6 }), chunks = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        const done = new Promise((r) => rec.onstop = r); rec.start(); const t0 = performance.now();
        await new Promise((res) => { (function f(now) { const t = Math.min(1, (now - t0) / (dur * 1000)), e = t * t * (3 - 2 * t), z = 1 + 0.07 * e; const w = cv.width * z, h = cv.height * z, ox = mo === 'pan' ? -(w - cv.width) * e : -(w - cv.width) / 2, oy = -(h - cv.height) / 2; x.drawImage(img, ox, oy, w, h); t < 1 ? requestAnimationFrame(f) : res(); })(t0); });
        rec.stop(); await done; const blob = new Blob(chunks, { type: 'video/webm' }), id = uid('as-'); await media.put(id, blob);
        const v = { id, kind: 'video', skuId: a.skuId, mediaId: id, title: a.title + ' · ' + (mo === 'pan' ? 'pan' : 'push-in'), synth: a.synth, approved: false, w: cv.width, h: cv.height, spec: { mode: 'product-lock', motion: mo, seconds: dur, source: a.id, zoomMax: 1.07 }, at: new Date().toISOString() };
        v.qa = qa(v); store().assets.unshift(v); C.save(); toast('Video rendered. Product pixels were not redrawn.');
      } catch (e) { toast(e.message); }
      rerender();
    };
  }

  window.Studio = { init(o) { toast = o.toast; rerender = o.rerender; if (window.Identity) window.Identity.init({ toast }); }, library, studio, media, store, sha, loadImg, palette, srcOf };
})();
