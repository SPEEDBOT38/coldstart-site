/* Coldstart v4: product identity, generation jobs, identity QA and original-vs-generated comparison.
   Third-party code does the heavy lifting: tesseract.js (OCR), culori (colour distance), fastest-levenshtein (text match),
   img-comparison-slider (before/after) and @panzoom/panzoom (synchronized zoom/pan). All vendored under assets/vendor.
   Rules: the server owns the product master, jobs and limits. A creative is never labelled verified unless every check
   actually ran and passed, and even then it still needs a person's approval. */
(function () {
  const C = window.CS, esc = C.esc, $ = (s, r) => (r || document).querySelector(s);
  const St = () => window.Studio;
  const store = () => St().store();
  let toast = (m) => alert(m);
  const V = 'assets/vendor/';
  const loaded = {};
  const script = (src) => loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }));
  const sha = (u) => St().sha(u);

  /* ---------- OCR (tesseract.js, runs in the browser, nothing uploaded) ---------- */
  let worker = null, workerBusy = Promise.resolve();
  async function ocr(url, onProgress) {
    await script(V + 'tesseract/tesseract.min.js');
    const run = async () => {
      worker = worker || await Tesseract.createWorker('eng', 1, { workerPath: V + 'tesseract/worker.min.js', corePath: V + 'tesseract', langPath: V + 'tesseract', logger: (m) => onProgress && onProgress(m) });
      const { data } = await worker.recognize(url);
      const lines = data.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => (l.match(/[A-Za-z0-9]/g) || []).length >= 3);
      return { lines, confidence: Math.round(data.confidence) };
    };
    workerBusy = workerBusy.then(run, run); return workerBusy;
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sim = (a, b) => { a = norm(a); b = norm(b); const m = Math.max(a.length, b.length); return m ? 1 - QALibs.distance(a, b) / m : 1; };

  /* ---------- identity QA: real checks, honest about the ones we cannot run ---------- */
  async function qaFindings(master, genUrl, onProgress) {
    await script(V + 'qa-libs.js');
    const F = [];
    const exp = master.identity.text;
    if (exp.length) {
      let got; try { got = await ocr(genUrl, onProgress); } catch (e) { got = null; }
      if (!got) F.push({ check: 'Packaging text', status: 'unverified', detail: 'OCR could not run in this browser. Read the label yourself.' });
      else {
        const rows = exp.map((t) => ({ t, best: Math.max(0, ...got.lines.map((l) => sim(t, l))) }));
        const miss = rows.filter((r) => r.best < 0.9), part = rows.filter((r) => r.best >= 0.9 && r.best < 0.97);
        const extra = got.lines.filter((l) => norm(l).length >= 6 && !exp.some((t) => sim(t, l) >= 0.6));
        F.push(miss.length ? { check: 'Packaging text', status: 'fail', detail: 'Not found in the image: ' + miss.map((r) => '"' + r.t + '"').join(', ') + '. The label text may have been changed.' }
          : part.length ? { check: 'Packaging text', status: 'unverified', detail: 'Partly matched (OCR is imperfect): ' + part.map((r) => '"' + r.t + '" ' + Math.round(r.best * 100) + '%').join(', ') + '. Check these by eye.' }
          : { check: 'Packaging text', status: 'pass', detail: 'All ' + exp.length + ' confirmed lines were read back from the generated image.' });
        if (extra.length) F.push({ check: 'Extra text', status: 'unverified', detail: 'Text that is not on your product was read: ' + extra.slice(0, 3).map((l) => '"' + l + '"').join(', ') + '.' });
      }
    } else F.push({ check: 'Packaging text', status: 'unverified', detail: 'No packaging text was confirmed on the product master, so there is nothing to compare.' });

    if (master.identity.colors.length) {
      const img = await St().loadImg(genUrl), gen = St().palette(img);
      const far = master.identity.colors.filter((c) => Math.min(...gen.map((g) => QALibs.deltaE(QALibs.parse(c), QALibs.parse(g)))) > 30);
      if (master.alter.recolor) F.push({ check: 'Brand colours', status: 'unverified', detail: 'Recolouring is allowed for this product, so colour drift is expected. Check it by eye.' });
      else F.push(far.length ? { check: 'Brand colours', status: 'fail', detail: 'Confirmed colours not present in the image: ' + far.join(', ') + ' (heuristic palette check, ΔE2000 > 30).' } : { check: 'Brand colours', status: 'pass', detail: 'Every confirmed colour has a close match in the image (heuristic palette check).' });
    }
    F.push({ check: 'Logo', status: 'unverified', detail: master.identity.logo.present ? 'No logo matcher is connected. Compare the logo with your original.' : 'No logo recorded on the product master.' });
    F.push({ check: 'Protected regions', status: 'unverified', detail: (master.identity.regions.length ? master.identity.regions.length + ' region(s) marked. ' : '') + 'Creative-first redraws the whole image, so unchanged pixels cannot be proven. Compare these areas.' });
    F.push({ check: 'Segmentation errors', status: 'unverified', detail: 'No segmentation model is connected (needs the hosted GPU cutout service).' });
    F.push({ check: 'Altered packaging shape', status: 'unverified', detail: 'Shape and proportions need a person: use the comparison slider.' });
    return F;
  }
  const toRows = (F) => F.map((f) => [f.check, f.status, f.detail]);
  const decision = (F) => F.some((f) => f.status === 'fail') ? 'Regenerate' : 'Needs manual review';

  /* ---------- masters (server is the source of truth) ---------- */
  const masterCache = {};
  async function masters(force) { if (force || !masterCache.t || Date.now() - masterCache.t > 4000) { masterCache.list = (await C.ops.get('masters')).masters; masterCache.t = Date.now(); } return masterCache.list; }
  const masterOf = async (sku) => sku.masterId ? (await masters()).find((m) => m.id === sku.masterId) || null : null;
  const STATUS = { draft: ['Draft', 'dash'], approved: ['Approved', 'b'], needs_reapproval: ['Needs re-approval', 'warn'] };
  const statusChip = (m) => m ? `<span class="chip ${STATUS[m.status][1]}">${STATUS[m.status][0]} · v${m.version}</span>` : '<span class="chip dash">No identity yet</span>';
  const slug = (s) => String(s || 'sku').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'SKU';

  async function openMaster(skuId, done) {
    const sku = store().skus.find((s) => s.id === skuId); if (!sku) return;
    let m = null; try { m = await masterOf(sku); } catch (e) { return toast(e.message); }
    const fl = C.S.flagship || {};
    const cur = m ? JSON.parse(JSON.stringify(m.identity)) : { name: sku.name, sku: slug(sku.name), variant: (fl.name === sku.name && fl.variant) || '', refs: [], text: [], logo: { present: false, note: '' }, colors: [], regions: [] };
    const alter = Object.assign({ background: false, relight: false, recolor: false, viewpoint: false }, m ? m.alter : {});
    const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Product identity');
    const refUrl = await St().srcOf(sku.refs[0].id), img = await St().loadImg(refUrl), pal = St().palette(img);
    const allColors = [...new Set([...(cur.colors || []), ...pal])];
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Product identity</h2><button class="btn sm ghost" id="pm-x" type="button">Close</button></div>
      <div class="dlg-b" style="display:grid;gap:14px"><div>${statusChip(m)} ${m ? `<small class="mono muted" style="word-break:break-all">sha256 ${esc(m.hash.slice(0, 20))}…</small>` : ''}</div>
      ${m && m.status === 'needs_reapproval' ? '<div class="err">The protected identity changed after the last approval. Generation is blocked until you approve this version.</div>' : ''}
      <div class="cols2"><label class="field"><span>Product name</span><input id="pm-name" type="text" value="${esc(cur.name)}"></label><label class="field"><span>SKU</span><input id="pm-sku" type="text" value="${esc(cur.sku)}"></label></div>
      <label class="field"><span>Variant (size, flavour, shade)</span><input id="pm-var" type="text" value="${esc(cur.variant)}" placeholder="250 g, unscented"></label>
      <div><span class="eyebrow">Reference photos · ${sku.refs.length}</span><div class="th-row">${(await Promise.all(sku.refs.map(async (r) => `<img class="th" src="${esc(await St().srcOf(r.id))}" alt="${esc(r.label)}">`))).join('')}</div></div>
      <div><span class="eyebrow">Packaging text</span><div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0"><button class="btn sm" id="pm-ocr" type="button">Read text from photo</button><small id="pm-ocr-s" class="muted"></small></div>
        <textarea id="pm-text" rows="4" placeholder="One line per printed phrase. Edit anything the reader got wrong.">${esc(cur.text.join('\n'))}</textarea></div>
      <div><span class="eyebrow">Logo</span><label class="check-inline"><input type="checkbox" id="pm-logo" ${cur.logo.present ? 'checked' : ''}> The product shows a logo or wordmark</label><input id="pm-logo-n" type="text" placeholder="Where it sits, e.g. wordmark top centre" value="${esc(cur.logo.note)}" style="margin-top:6px"></div>
      <div><span class="eyebrow">Brand colours on the product</span><div class="tags" id="pm-cols">${allColors.map((c) => `<label class="check-inline"><input type="checkbox" value="${esc(c)}" ${cur.colors.includes(c) ? 'checked' : ''}><i class="sw-dot" style="background:${esc(c)}"></i>${esc(c)}</label>`).join('')}</div></div>
      <div><span class="eyebrow">Protected regions (drag on the photo)</span><div id="pm-reg" class="regbox" tabindex="0" aria-label="Photo. Drag to mark a protected region."><img src="${esc(refUrl)}" alt="${esc(sku.name)}" draggable="false"></div><div id="pm-reg-l" class="tags" style="margin-top:6px"></div></div>
      <div><span class="eyebrow">What may generation change?</span><small class="muted" style="display:block;margin-bottom:6px">Everything is off by default: your product stays exactly as photographed. Turn on only what you accept.</small>
        ${[['background', 'Background and scene'], ['relight', 'Lighting'], ['recolor', 'Product colour'], ['viewpoint', 'Synthesized viewpoints (new angles are invented, review required)']].map(([k, t]) => `<label class="check-inline"><input type="checkbox" data-al="${k}" ${alter[k] ? 'checked' : ''}> ${t}</label>`).join('')}</div>
      <fieldset style="border:1px solid var(--rule);padding:10px"><legend class="mono small">Confirm before approving</legend>
        <label class="check-inline"><input type="checkbox" id="c-text"> The packaging text above is exactly what is printed.</label>
        <label class="check-inline"><input type="checkbox" id="c-logo"> The logo setting is correct.</label>
        <label class="check-inline"><input type="checkbox" id="c-col"> The colours are correct.</label></fieldset>
      <div id="pm-err"></div></div>
      <div class="dlg-f"><button class="btn ghost" id="pm-save" type="button">Save draft</button><button class="btn yellow" id="pm-ok" type="button" disabled>Approve product master</button></div>`;
    d.showModal();
    // regions: draw on the photo
    const regs = JSON.parse(JSON.stringify(cur.regions)); const box = $('#pm-reg');
    const paintRegs = () => { box.querySelectorAll('.reg').forEach((n) => n.remove()); regs.forEach((r) => { const n = document.createElement('i'); n.className = 'reg'; n.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`; box.appendChild(n); }); $('#pm-reg-l').innerHTML = regs.map((r, i) => `<span class="chip dash">${esc(r.label)} ${i + 1} <button type="button" data-rr="${i}" class="x" aria-label="Remove region ${i + 1}">×</button></span>`).join('') || '<small class="muted">None marked. Mark the label, logo and any text areas.</small>'; $('#pm-reg-l').querySelectorAll('[data-rr]').forEach((b) => b.onclick = () => { regs.splice(+b.dataset.rr, 1); paintRegs(); }); };
    let start = null; const rel = (e) => { const b = box.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]; };
    box.onpointerdown = (e) => { start = rel(e); box.setPointerCapture(e.pointerId); }; box.onpointerup = (e) => { if (!start) return; const [x, y] = rel(e); const r = { x: Math.min(start[0], x), y: Math.min(start[1], y), w: Math.abs(x - start[0]), h: Math.abs(y - start[1]), label: 'protected' }; start = null; if (r.w > 0.02 && r.h > 0.02) { regs.push(r); paintRegs(); } };
    paintRegs();
    const val = () => ({ identity: { name: $('#pm-name').value.trim(), sku: $('#pm-sku').value.trim(), variant: $('#pm-var').value.trim(), refs: sku.refs.map((r) => ({ sha256: r.sha, label: (r.label || 'front').slice(0, 40) })), text: $('#pm-text').value.split('\n').map((x) => x.trim()).filter(Boolean), logo: { present: $('#pm-logo').checked, note: $('#pm-logo-n').value.trim() }, colors: [...d.querySelectorAll('#pm-cols input:checked')].map((i) => i.value), regions: regs },
      alter: Object.fromEntries([...d.querySelectorAll('[data-al]')].map((i) => [i.dataset.al, i.checked])) });
    const gate = () => { $('#pm-ok').disabled = !($('#c-text').checked && $('#c-logo').checked && $('#c-col').checked); };
    ['#c-text', '#c-logo', '#c-col'].forEach((s) => $(s).onchange = gate);
    $('#pm-x').onclick = () => d.close();
    $('#pm-ocr').onclick = async () => { const b = $('#pm-ocr'); b.disabled = true; $('#pm-ocr-s').textContent = 'Reading… first run downloads the OCR engine from this site.'; try { const r = await ocr(refUrl, (p) => { if (p.status === 'recognizing text' && $('#pm-ocr-s')) $('#pm-ocr-s').textContent = 'Reading… ' + Math.round(p.progress * 100) + '%'; }); $('#pm-text').value = r.lines.join('\n'); $('#pm-ocr-s').textContent = r.lines.length ? 'Found ' + r.lines.length + ' lines (confidence ' + r.confidence + '%). Edit anything wrong, then confirm below.' : 'No readable text found. Type what is printed.'; } catch (e) { $('#pm-ocr-s').textContent = 'OCR failed: ' + e.message + '. Type the text yourself.'; } b.disabled = false; };
    const save = async (approve) => {
      $('#pm-err').innerHTML = '';
      try {
        const body = val(); if (sku.masterId) body.id = sku.masterId;
        let r = await C.ops.post('saveMaster', body); let mm = r.master; sku.masterId = mm.id;
        if (approve) mm = (await C.ops.post('approveMaster', { id: mm.id, confirmed: { text: $('#c-text').checked, colors: $('#c-col').checked, logo: $('#c-logo').checked } })).master;
        masterCache.t = 0; sku.name = body.identity.name; C.save();
        C.log('master', (approve ? 'Approved' : 'Saved') + ' product master ' + body.identity.name, { master: mm.id, version: mm.version, hash: mm.hash });
        d.close(); toast(approve ? 'Product master approved (v' + mm.version + ').' : 'Saved as draft.'); if (done) done(); else window.AppV4.route();
      } catch (e) { $('#pm-err').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
    $('#pm-save').onclick = () => save(false); $('#pm-ok').onclick = () => save(true);
  }

  /* ---------- generation through the server job queue ---------- */
  async function generate({ sku, idea, ratio, alter, dirTitle, parentAsset }) {
    const m = await masterOf(sku);
    if (!m || m.status !== 'approved') throw Object.assign(new Error(m && m.status === 'needs_reapproval' ? 'Product identity changed. Re-approve it first.' : 'Approve this product’s identity first.'), { code: 'master_not_approved' });
    const reference = await St().media.get(sku.refs[0].id);
    const clause = 'Keep the product exactly as in the reference: same packaging, printed text, logo, colours and proportions. You may only change: ' + Object.keys(alter).filter((k) => alter[k]).map((k) => ({ background: 'the background and scene', relight: 'the lighting', recolor: 'the product colour', viewpoint: 'the camera viewpoint' }[k])).join(', ') + '. Do not add any text.';
    const r = await C.ops.post('createJob', { masterId: m.id, idempotencyKey: 'ui-' + crypto.randomUUID(), direction: dirTitle.slice(0, 60), prompt: idea + ' ' + clause, ratio, alter, reference, parentJobId: parentAsset && parentAsset.jobId });
    const id = 'as-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const asset = { id, kind: 'shoot', skuId: sku.id, jobId: r.job.id, mediaId: id, title: sku.name + ' · ' + dirTitle, synth: true, approved: false, w: { '1:1': 1080, '4:5': 1080, '9:16': 1080, '16:9': 1920 }[ratio], h: { '1:1': 1080, '4:5': 1350, '9:16': 1920, '16:9': 1080 }[ratio], parentId: parentAsset ? parentAsset.id : null,
      spec: { ratio, alter, masterId: m.id, masterVersion: m.version, masterHash: m.hash, model: r.job.model, workflow: r.job.workflow, mode: 'creative-first' }, at: new Date().toISOString() };
    if (r.job.state === 'failed' || !r.image) { asset.failed = r.job.error; store().assets.unshift(asset); asset.qa = { rows: [['Generation', 'fail', (r.job.error && r.job.error.message) || 'Provider error']], decision: 'Regenerate' }; C.save(); return { asset, job: r.job }; }
    await St().media.put(id, r.image);
    asset.qa = { rows: [['Identity checks', 'unverified', 'Running OCR and colour checks…']], decision: 'Needs manual review' };
    store().assets.unshift(asset);
    C.cost('Creative render', r.job.cost.actualUsd, asset.title); C.log('creative', 'Generated (job ' + r.job.id + '): ' + asset.title, { job: r.job.id, master: m.id, version: m.version, alter });
    C.S.inbox = C.S.inbox || []; C.S.inbox.unshift({ id: 'rv-' + asset.id, kind: 'review', title: 'Check product match: ' + asset.title, sub: 'Synthesized image. Compare it with your original before approving.', to: '#/campaigns/studio' });
    C.save();
    return { asset, job: r.job };
  }
  /* Fidelity-first: server cuts the product out (rembg), keeps its original pixels, builds the scene around it and measures the output. */
  async function generateLocked({ sku, ratio, scene }) {
    const m = await masterOf(sku);
    if (!m || m.status !== 'approved') throw Object.assign(new Error('Approve this product’s identity first.'), { code: 'master_not_approved' });
    if (!['4:5', '9:16', '1:1'].includes(ratio)) throw new Error('Fidelity-first supports 4:5, 9:16 and 1:1.');
    const reference = await St().media.get(sku.refs[0].id);
    const r = await C.ops.post('compositeAd', { masterId: m.id, reference, ratio, scene, idempotencyKey: 'ca-' + crypto.randomUUID() }), rep = r.report;
    const id = 'as-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await St().media.put(id, r.image);
    const bgRow = ['Background', 'info', rep.background_kind === 'ai_generated' ? 'AI-generated background (' + ((rep.backgroundProvider || {}).model || 'model unknown') + '), created without the product and placed behind your original pixels.' : rep.background_kind === 'user_supplied' ? 'A background you supplied.' : 'Plain generated gradient. This is not AI photography; connect a background generator for real scenes.'];
    const eq = rep.protected_pixel_equality, rows = [['Protected pixels', eq, eq === 'pass' ? rep.protected_pixels.toLocaleString() + ' product pixels compared with your original: ' + rep.protected_pixels_changed + ' changed.' : eq === 'fail' ? rep.protected_pixels_changed + ' product pixels were altered.' : 'The cutout covered too little of the product. Check the edges by eye.'], ['Background', 'unverified', 'Background is ' + rep.background + '. It does not carry product facts.'], ['Cutout quality', 'unverified', 'Matte model ' + rep.matte_model + '. Check the edges and any transparent or reflective parts yourself.']];
    rows.push(bgRow); const asset = { id, kind: 'shoot', skuId: sku.id, mediaId: id, title: sku.name + ' · Fidelity-first ' + ratio, synth: false, approved: false, w: 1080, h: { '4:5': 1350, '9:16': 1920, '1:1': 1080 }[ratio], spec: { ratio, masterId: m.id, masterVersion: m.version, masterHash: m.hash, mode: 'pixel-locked', outputSha256: rep.output_sha256 }, findings: rows.map((x) => ({ check: x[0], status: x[1], detail: x[2] })), qa: { rows, decision: eq === 'fail' ? 'Regenerate' : 'Needs manual review' }, verified: false, at: rep.at };
    store().assets.unshift(asset); C.log('creative', 'Pixel-locked composite: ' + asset.title, { master: m.id, equality: eq, output: rep.output_sha256 }); C.save(); return { asset, report: rep };
  }
  async function runQA(asset) {
    const m = (await masters(true)).find((x) => x.id === asset.spec.masterId); if (!m) throw new Error('Product master not found.');
    const F = await qaFindings(m, await St().srcOf(asset.mediaId));
    const j = (await C.ops.post('validateJob', { id: asset.jobId, findings: F })).job;
    asset.qa = { rows: toRows(F), decision: decision(F) }; asset.jobState = j.state; asset.verified = j.review.verified; asset.findings = F; C.save(); return j;
  }

  /* ---------- compare dialog: slider + synchronized zoom/pan ---------- */
  async function compare(assetId) {
    const a = store().assets.find((x) => x.id === assetId); if (!a) return;
    const sku = store().skus.find((s) => s.id === a.skuId), orig = await St().srcOf(sku.refs[0].id), gen = await St().srcOf(a.mediaId);
    await Promise.all([script(V + 'img-comparison-slider.js'), script(V + 'panzoom.min.js')]);
    if (!document.getElementById('ics')) { const l = document.createElement('link'); l.id = 'ics'; l.rel = 'stylesheet'; l.href = V + 'img-comparison-slider.css'; document.head.appendChild(l); }
    const rows = a.qa.rows, F = a.findings || [];
    const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Compare with original');
    let job = null; try { job = a.jobId ? (await C.ops.get('job', { id: a.jobId })).job : null; } catch (e) { /* offline */ }
    const view = (store().sel.cmpView) || 'slider';
    const vp = job && job.review.viewpointChanged, failed = (job && job.state === 'failed') || a.failed || (a.findings || []).some((f) => f.status === 'fail'), done = job && job.state === 'completed';
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Compare with your original</h2><button class="btn sm ghost" id="cp-x" type="button">Close</button></div>
      <div class="dlg-b" style="display:grid;gap:12px"><div class="seg" role="group" aria-label="View"><button type="button" data-v="slider" aria-pressed="${view === 'slider'}">Before / after slider</button><button type="button" data-v="side" aria-pressed="${view === 'side'}">Side by side, synced zoom</button></div>
      <div id="cp-stage">${view === 'slider' ? `<img-comparison-slider tabindex="0" aria-label="Drag to compare original and generated image"><img slot="first" src="${esc(orig)}" alt="Original"><img slot="second" src="${esc(gen)}" alt="Generated"></img-comparison-slider><div class="mono small" style="display:flex;justify-content:space-between"><span>◀ ORIGINAL</span><span>GENERATED ▶</span></div>`
        : `<div class="side2"><div><span class="mono small">ORIGINAL</span><div class="pz" id="pz1"><img src="${esc(orig)}" alt="Original"></div></div><div><span class="mono small">GENERATED</span><div class="pz" id="pz2"><img src="${esc(gen)}" alt="Generated"></div></div></div><small class="muted">Scroll to zoom, drag to pan. Both views move together.</small>`}</div>
      <div class="qa"><div class="qa-h"><strong>Findings</strong><span class="chip ${a.verified ? 'b' : 'y'}">${a.verified ? 'Checks passed, review still required' : 'Not verified'}</span></div>
      ${rows.map((r) => `<div class="qa-r"><span>${esc(r[0])}</span><span class="chip ${r[1] === 'pass' ? 'b' : r[1] === 'fail' ? 'warn' : 'dash'}">${r[1] === 'pass' ? 'Pass' : r[1] === 'fail' ? 'Fail' : r[1] === 'info' ? 'Note' : 'Unverified'}</span><small>${esc(r[2])}</small></div>`).join('')}</div>
      ${job ? `<small class="mono muted">job ${esc(job.id)} · ${esc(job.state)} · ${esc(job.workflow)} · ${esc(job.model || 'no model')}</small>` : ''}
      ${a.approved ? '<div class="chip y">Approved</div>' : `<label class="check-inline"><input type="checkbox" id="cp-seen"> I compared this with my original product and it matches.</label>${vp ? '<label class="check-inline"><input type="checkbox" id="cp-vp"> I understand the viewpoint is synthesized and invented.</label>' : ''}`}
      ${failed ? '<div class="err">Checks failed. This creative cannot be approved. Regenerate it.</div>' : !a.findings && !done && !a.approved ? '<div class="err">Identity checks have not finished. Run them from the Jobs tab.</div>' : ''}
      <div id="cp-err"></div></div>
      <div class="dlg-f" style="flex-wrap:wrap"><button class="btn ghost" id="cp-rep" type="button">Report inaccuracy</button><button class="btn ghost" id="cp-rej" type="button" ${a.approved ? 'disabled' : ''}>Reject</button><button class="btn ghost" id="cp-bg" type="button">Regenerate background</button><button class="btn yellow" id="cp-ok" type="button" disabled>Approve</button></div>`;
    d.showModal();
    $('#cp-x').onclick = () => d.close();
    d.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { store().sel.cmpView = b.dataset.v; compare(assetId); });
    if (view === 'side') { const p1 = Panzoom($('#pz1 img'), { maxScale: 6 }), p2 = Panzoom($('#pz2 img'), { maxScale: 6 }); const link = (from, to) => from.addEventListener('panzoomchange', (e) => { to.zoom(e.detail.scale, { animate: false, force: true, silent: true }); to.pan(e.detail.x, e.detail.y, { animate: false, force: true, silent: true }); }); link($('#pz1 img'), p2); link($('#pz2 img'), p1); $('#pz1').addEventListener('wheel', p1.zoomWithWheel); $('#pz2').addEventListener('wheel', p2.zoomWithWheel); }
    const sync = () => { const ok = !a.approved && !failed && a.findings && $('#cp-seen') && $('#cp-seen').checked && (!vp || $('#cp-vp').checked); $('#cp-ok').disabled = !ok; };
    ['#cp-seen', '#cp-vp'].forEach((s) => { const e = $(s); if (e) e.onchange = sync; }); sync();
    $('#cp-ok').onclick = () => { a.approved = true; a.rejected = null; C.log('creative', 'Approved creative after comparison: ' + a.title, { asset: a.id, job: a.jobId, verified: !!a.verified, viewpointSynthesized: !!vp }); C.S.inbox = (C.S.inbox || []).filter((i) => i.id !== 'rv-' + a.id); C.save(); d.close(); toast('Approved. It joins the campaign launch review.'); window.AppV4.route(); };
    $('#cp-rej').onclick = () => { d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Reject this creative</h2></div><div class="dlg-b" style="display:grid;gap:10px"><label class="field"><span>Reason</span><select id="rj-r"><option>Product looks different</option><option>Label text is wrong</option><option>Colours are off</option><option>Bad composition</option><option>Other</option></select></label></div><div class="dlg-f"><button class="btn ghost" id="rj-n" type="button">Back</button><button class="btn" id="rj-y" type="button">Reject</button></div>`; $('#rj-n').onclick = () => compare(assetId); $('#rj-y').onclick = () => { a.rejected = { reason: $('#rj-r').value, at: new Date().toISOString() }; a.approved = false; C.log('creative', 'Rejected creative: ' + a.title, { asset: a.id, reason: a.rejected.reason }); C.S.inbox = (C.S.inbox || []).filter((i) => i.id !== 'rv-' + a.id); C.save(); d.close(); window.AppV4.route(); }; };
    $('#cp-rep').onclick = () => { d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Report an inaccuracy</h2></div><div class="dlg-b" style="display:grid;gap:10px"><label class="field"><span>What is wrong with the product in this image?</span><textarea id="rp-n" rows="4" placeholder="e.g. the second line of the label reads 'Soil mix 205 g'"></textarea></label></div><div class="dlg-f"><button class="btn ghost" id="rp-b" type="button">Back</button><button class="btn" id="rp-s" type="button">Send report</button></div>`; $('#rp-b').onclick = () => compare(assetId); $('#rp-s').onclick = async () => { const n = $('#rp-n').value.trim(); if (n.length < 3) return toast('Describe the problem.'); try { await C.ops.post('report', { assetId: a.id, jobId: a.jobId, note: n }); a.approved = false; a.rejected = { reason: 'Reported: ' + n.slice(0, 80), at: new Date().toISOString() }; C.log('creative', 'Reported inaccuracy: ' + a.title, { asset: a.id, note: n }); C.save(); d.close(); toast('Reported and removed from approval.'); window.AppV4.route(); } catch (e) { toast(e.message); } }; };
    $('#cp-bg').onclick = async () => { d.close(); try { await regenerate(a, { background: true }); } catch (e) { toast(e.message); } };
  }
  async function regenerate(a, alter) {
    const sku = store().skus.find((s) => s.id === a.skuId);
    toast('Regenerating the background…');
    const { asset, job } = await generate({ sku, idea: 'Product photograph, new background and scene.', ratio: a.spec.ratio, alter, dirTitle: 'New background', parentAsset: a });
    if (job.state === 'validating') await runQA(asset).catch((e) => toast('Checks could not finish: ' + e.message));
    window.AppV4.route();
  }

  /* ---------- Jobs tab ---------- */
  const CHIP = { queued: 'dash', processing: 'y', validating: 'y', completed: 'b', failed: 'warn', cancelled: 'dash' };
  async function jobsPanel(body) {
    let jobs = [], usage = null, err = '';
    try { jobs = (await C.ops.get('jobs')).jobs; usage = await C.ops.get('usage'); } catch (e) { err = e.message; }
    const money = (v) => v == null ? 'not reported' : '$' + v.toFixed(4);
    body.innerHTML = `<section class="panel"><div class="panel-h"><h2>Generation jobs</h2><button class="btn sm ghost" id="jb-r" type="button">Refresh</button></div>
      ${err ? `<div class="panel-b"><div class="err">${esc(err)}</div></div>` : ''}
      ${usage ? `<div class="panel-b"><small class="mono">This month: ${usage.used.creativeMonth} of ${usage.caps.credits || '∞'} renders · AI/API cost ${money(usage.aiApiCost.reportedFor ? usage.aiApiCost.usd : null)}${usage.aiApiCost.unreported ? ' (' + usage.aiApiCost.unreported + ' without a reported cost)' : ''} · ad spend $0 · limits are enforced on the server</small></div>` : ''}
      ${jobs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Job</th><th>State</th><th>Model · workflow</th><th>Input</th><th>Output</th><th>Cost</th><th></th></tr></thead><tbody>${jobs.map((j) => { const local = store().assets.find((x) => x.jobId === j.id);
        return `<tr><td class="mono small">${esc(j.id)}<br><span class="muted">${new Date(j.createdAt).toLocaleString()}</span></td><td><span class="chip ${CHIP[j.state]}">${j.state}</span>${j.error ? `<br><small>${esc(j.error.message)}${j.error.retryable ? ' (retryable)' : ''}</small>` : ''}</td>
        <td>${esc(j.model || '–')}<br><small class="muted">${esc(j.workflow)} · attempt ${j.attempts}</small></td><td><small class="mono">master v${j.inputRefs.masterVersion}<br>ref ${esc(j.inputRefs.refSha.slice(0, 10))}…<br>${Object.keys(j.inputRefs.alter).filter((k) => j.inputRefs.alter[k]).join(', ')}</small></td>
        <td>${j.output ? `<small class="mono">${j.output.bytes} B<br>${esc(j.output.sha256.slice(0, 10))}…</small>` : '–'}</td><td><small>est ${money(j.cost.estimateUsd)}<br>actual ${money(j.cost.actualUsd)}</small></td>
        <td style="white-space:nowrap">${['queued', 'processing', 'validating'].includes(j.state) ? `<button class="btn sm ghost" data-cancel="${esc(j.id)}" type="button">Cancel</button>` : ''}${j.state === 'validating' && local ? `<button class="btn sm" data-qa="${esc(local.id)}" type="button">Run checks</button>` : ''}${j.state === 'failed' && j.error && j.error.retryable && j.error.code !== 'qa_failed' ? `<button class="btn sm ghost" data-retry="${esc(j.id)}" type="button">Retry</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="panel-b"><div class="empty" style="margin:0">No generation jobs yet.</div></div>'}</section>`;
    $('#jb-r').onclick = () => window.AppV4.route();
    body.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => { try { await C.ops.post('cancelJob', { id: b.dataset.cancel }); C.log('job', 'Cancelled ' + b.dataset.cancel, null); } catch (e) { toast(e.message); } window.AppV4.route(); });
    body.querySelectorAll('[data-qa]').forEach((b) => b.onclick = async () => { b.disabled = true; b.textContent = 'Checking…'; try { await runQA(store().assets.find((x) => x.id === b.dataset.qa)); } catch (e) { toast(e.message); } window.AppV4.route(); });
    body.querySelectorAll('[data-retry]').forEach((b) => b.onclick = async () => { const j = jobs.find((x) => x.id === b.dataset.retry), a = store().assets.find((x) => x.jobId === j.id); const sku = store().skus.find((s) => s.id === (a && a.skuId)) || store().skus.find((s) => (s.refs[0] || {}).sha === j.inputRefs.refSha); if (!sku) return toast('The product photo for this job is not in this browser.'); b.disabled = true; try { const r = await C.ops.post('retryJob', { id: j.id, reference: await St().media.get(sku.refs[0].id) }); if (a && r.image) { await St().media.put(a.mediaId, r.image); a.failed = null; a.qa = { rows: [['Identity checks', 'unverified', 'Run the checks.']], decision: 'Needs manual review' }; a.findings = null; C.save(); } toast('Retried: ' + r.job.state); } catch (e) { toast(e.message); } window.AppV4.route(); });
  }

  window.Identity = { init(o) { toast = o.toast || toast; }, openMaster, masterOf, masters, statusChip, generate, generateLocked, runQA, compare, regenerate, jobsPanel, qaFindings, ocr };
})();
