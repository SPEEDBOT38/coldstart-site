/* Coldstart v4 onboarding: five steps, one question at a time.
   1 Business (URL) · 2 Brand DNA (confirm) · 3 Outcome (goal) · 4 Boundaries · 5 First plan (no accounts needed). */
(function () {
  const C = window.CS, S = C.S, esc = C.esc;
  const root = document.getElementById('stage');
  const ticksEl = document.getElementById('ticks');
  const NAMES = ['Business', 'Brand & product', 'Competitors & communities', 'Outcome', 'Market & channels', 'First plan'];
  const $ = (s, r) => (r || document).querySelector(s);
  let scanning = false, scanTimer = null, scanIdx = 0, lastError = '', showDesc = false;

  function ticks() {
    ticksEl.innerHTML = '<span class="ticks-label">Step ' + (S.step + 1) + ' / 6 · ' + NAMES[S.step] + '</span>' +
      NAMES.map((n, i) => '<i class="tick ' + (i < S.step ? 'done' : i === S.step ? 'now' : '') + '" title="' + n + '"></i>').join('');
  }
  function go(n) { S.step = Math.max(0, Math.min(5, n)); C.save(); render(); window.scrollTo(0, 0); const h = $('h1'); h && h.focus && h.setAttribute('tabindex', '-1') && h.focus({ preventScroll: true }); }
  function render() {
    ticks(); document.body.classList.toggle('step-later', S.step > 0);
    ([step0, step1, stepIntel, step2, step3, step4][S.step])();
  }

  /* ---------- 1. Business ---------- */
  function step0() {
    if (scanning) return renderScan();
    root.innerHTML = `<div class="ob-col">
      <div><span class="eyebrow">Let’s find your first customers</span>
      <h1 class="disp">What are we <b>growing?</b></h1></div>
      <p class="sub">Just give me your website. I’ll figure out the rest.</p>
      ${lastError ? `<div class="err" role="alert"><strong>${esc(lastError)}</strong><span>Nothing is lost. Describe the product instead and we’ll keep going.</span></div>` : ''}
      <form id="f0" class="url-row" novalidate>
        <label class="sr" for="site">Website address</label>
        <input id="site" type="text" inputmode="url" autocomplete="url" placeholder="yourwebsite.com" value="${esc(S.input.site)}" ${showDesc ? '' : 'autofocus'}>
        <button class="btn" type="submit">Explore my business →</button>
      </form>
      <div class="alt-row"><button class="link" id="toggle-desc" type="button">${showDesc ? 'Hide description' : 'Or describe your product instead'}</button>
        <span class="ob-note">No ad account or credit card needed to start.</span></div>
      ${showDesc ? `<form id="fd" class="desc-box"><label class="field"><span>What do you sell, and to whom?</span>
        <textarea id="desc" maxlength="400" placeholder="Handmade skincare for oily, acne-prone skin. Customers are 18 to 30, mostly in India.">${esc(S.input.desc)}</textarea></label>
        <div class="nav-row"><small class="muted">A site gives better results. You can add it later.</small><button class="btn" type="submit">Use this description →</button></div></form>` : ''}
    </div>`;
    $('#f0').addEventListener('submit', (e) => { e.preventDefault(); const raw = $('#site').value; const d = C.parseSite(raw); if (!d) { lastError = 'That doesn’t look like a website address.'; return render(); } lastError = ''; S.input.site = raw; S.input.noSite = false; startScan(d); });
    $('#toggle-desc').addEventListener('click', () => { showDesc = !showDesc; render(); });
    const fd = $('#fd'); if (fd) fd.addEventListener('submit', (e) => { e.preventDefault(); const t = $('#desc').value.trim(); if (t.length < 3) { lastError = 'Add a few words about what you sell.'; return render(); } lastError = ''; S.input.desc = t; S.input.noSite = true; startScan(''); });
  }

  const SCAN_STEPS = ['Opening your site', 'Reading products and pages', 'Pulling brand colours and voice', 'Working out who buys'];
  function renderScan() {   // honest: an indeterminate indicator and an elapsed clock, no invented percentage
    const sec = Math.round((Date.now() - (window.__scanT0 || Date.now())) / 1000);
    root.innerHTML = `<div class="ob-col scan" role="status" aria-live="polite">
      <div><span class="eyebrow">Studying your business</span><h1 class="disp m">Reading <b>${esc(C.parseSite(S.input.site) || 'your description')}</b></h1></div>
      <div class="bar indet" aria-hidden="true"><i></i></div>
      <ul class="scan-list">${SCAN_STEPS.map((t) => `<li class="now">${t}</li>`).join('')}</ul>
      <p class="ob-note" id="scan-clock">${sec}s · usually 15 to 30 seconds. Results appear as soon as the server returns them.</p></div>`;
  }
  async function startScan(domain) {
    scanning = true; scanIdx = 0; window.__scanT0 = Date.now(); Promise.resolve().catch(() => {}); render(); const clk = setInterval(() => { const e = document.getElementById('scan-clock'); if (!scanning || !e) return clearInterval(clk); e.textContent = Math.round((Date.now() - window.__scanT0) / 1000) + 's · usually 15 to 30 seconds. Results appear as soon as the server returns them.'; }, 1000);
    scanTimer = null;   // no simulated progress: the list shows what the scan does, not a fake position
    const t0 = Date.now();
    try {
      const body = domain
        ? { product: 'products sold at ' + domain, cat: 'other', site: domain, noSite: false, noIG: true, rivals: [] }
        : { product: S.input.desc.slice(0, 80), cat: 'other', site: '', noSite: true, noIG: true, rivals: [] };
      const r = await C.api('plugins/onboard/actions/scan', body);
      S.scan = { mode: r.mode || 'live', at: new Date().toISOString(), model: r.model, log: r.log || [] };
      S.brand = Object.assign({ name: '', tones: [], colors: [], names: [], dont: [] }, r.brand || {});
      S.products = (r.products || []).map((p) => Object.assign({ on: true }, p));
      S.icps = (r.icps || []).map((i) => Object.assign({ on: true }, i));
      S.sources = r.sources || null;
      S.input.desc = S.input.desc || (S.brand && S.brand.line) || '';
    } catch (e) {
      clearInterval(scanTimer); scanning = false;
      lastError = 'Couldn’t analyze this website right now. Try again, or describe your business to continue.'; console.warn('scan failed', e && e.message);
      showDesc = true; S.scan = null; return render();
    }
    clearInterval(scanTimer);
    const wait = Math.max(0, 1200 - (Date.now() - t0)); await new Promise((r) => setTimeout(r, wait));
    scanning = false; S.goal.k = S.goal.k || C.suggestGoal();
    if (!S.bounds.audience && S.icps[0]) S.bounds.audience = S.icps[0].who;
    go(1);
  }

  /* ---------- 2. Brand DNA ---------- */
  function priceRange() {
    const ps = (S.products || []).map((p) => Number(p.price)).filter((x) => x > 0);
    if (!ps.length) return null;
    const cur = S.brand && S.brand.currency; if (!cur) return null;   // no verified currency: don't show a range in a guessed one
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return lo === hi ? C.money(lo, cur) : C.money(lo, cur) + ' to ' + C.money(hi, cur);
  }
  function step1() {
    const b = S.brand || {}, live = S.scan && S.scan.mode === 'live';
    const pr = priceRange();
    const known = (p) => Number(p.price) > 0;
    const gaps = (p) => [!p.image && 'photo', !p.url && 'link', !known(p) && 'price'].filter(Boolean);
    const prodList = (S.products || []).slice(0, 24).map((p, i) => { const g = gaps(p); return `<button type="button" class="prod-row ${S.flagship && S.flagship.name === p.name ? 'on' : ''}" data-prod="${i}" aria-pressed="${!!(S.flagship && S.flagship.name === p.name)}">
      ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph" aria-hidden="true">No photo</span>'}
      <span class="pr-t"><strong>${esc(p.name || 'Unnamed')}</strong><small>${known(p) && (p.currency || b.currency) ? esc(C.money(p.price, p.currency || b.currency)) : known(p) ? esc(String(p.price)) + ' · currency unknown' : 'Price unknown'}${p.url ? ' · <span class="ok">link found</span>' : ''}</small></span>
      ${p.enrich ? (p.enrich.status === 'ok' ? `<span class="chip b" title="${esc(p.enrich.message)}">Photo found${(p.enrich.candidates || []).length > 1 ? ' · ' + p.enrich.candidates.length : ''}</span>` : `<span class="chip dash" title="${esc(p.enrich.reason || '')}">${esc(p.enrich.message || 'Not checked')}</span>`) : g.length ? `<span class="chip dash">Missing ${esc(g.join(', '))}</span>` : '<span class="chip b">Complete</span>'}</button>`; }).join('');
    const sw = (b.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5);
    const fl = S.flagship || { name: '', variant: '', price: '', url: '', currency: b.currency || '', kind: 'product' };   // never assume the flagship: the person picks it
    const missing = [!b.line && 'what you sell', !(S.products || []).length && 'products', !sw.length && 'colours'].filter(Boolean);
    root.innerHTML = `<div class="ob-col wide">
      <div><span class="eyebrow">Step 2 · Confirm what I understood</span><h1 class="disp">Here’s what I <b>found.</b></h1>
      <p class="sub" style="margin-top:10px">Did I get it right? Only the parts I’m unsure about are highlighted. Progress is saved as you go.</p>
      ${missing.length ? `<div class="err" style="margin-top:10px">I couldn’t read: ${esc(missing.join(', '))}. Fill in what you can below${S.input.site ? ', or <button class="link" id="rescan" type="button">try reading the site again</button>' : ''}. Nothing is invented for the gaps.</div>` : ''}</div>
      <div class="card-p">
        <div class="dna-grid">
          <div style="display:grid;gap:16px;align-content:start">
            <label class="field ${b.line ? '' : 'uncertain'}"><span>What you sell, and to whom</span>
              <textarea id="line">${esc(b.line || S.input.desc || '')}</textarea>
              ${b.line ? '' : '<small>I couldn’t pin this down. Please write one line.</small>'}</label>
            ${b.logo ? `<div class="logo-prev"><img src="${esc(b.logo)}" alt="${esc(b.name || 'Logo')} logo"><small class="muted">Logo found on your site</small></div>` : ''}
            <label class="field"><span>Brand name</span><input id="bname" type="text" value="${esc(b.name || '')}"></label>
            <fieldset class="flag" style="border:2px solid var(--ink);padding:12px;display:grid;gap:10px;background:#fff"><legend class="eyebrow" style="padding:0 6px">What should I lead with?</legend>
              <div class="seg" role="group" aria-label="Product or service"><button type="button" data-kind="product" aria-pressed="${fl.kind !== 'service'}">A product</button><button type="button" data-kind="service" aria-pressed="${fl.kind === 'service'}">A service or offer</button></div>
              <small class="muted">${(S.products || []).length ? 'Pick one from the list on the right, or type it here. I won’t choose for you.' : 'Type the product or offer you want to sell first.'}</small>
              <label class="field"><span>${fl.kind === 'service' ? 'Service or offer' : 'Product name'}</span><input id="fl-name" type="text" value="${esc(fl.name)}" maxlength="120"></label>
              <div class="cols2"><label class="field"><span>${fl.kind === 'service' ? 'Package or tier (optional)' : 'Variant (size, flavour, shade)'}</span><input id="fl-var" type="text" value="${esc(fl.variant)}" maxlength="80"></label>
                <div class="cols2" style="gap:6px"><label class="field"><span>Price</span><input id="fl-price" type="number" min="0" step="any" value="${esc(String(Number(fl.price) > 0 ? fl.price : ''))}" placeholder="Unknown"></label>
                <label class="field"><span>Currency</span><select id="fl-cur"><option value="">Not set</option>${['INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD', 'CAD', 'SGD'].map((c) => `<option ${fl.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div></div>
              <label class="field"><span>${fl.kind === 'service' ? 'Where people book or enquire (https)' : 'Where people buy it (product page, https)'}</span><input id="fl-url" type="url" value="${esc(fl.url || '')}" placeholder="https://…"></label><div id="fl-cands"></div><div id="fl-err"></div></fieldset>
            <div class="fact-row"><span>Price range</span><span>${pr ? esc(pr) : '<span class="chip dash">Not found</span>'}</span></div>
            <div class="fact-row"><span>Currency</span><span>${b.currency ? esc(b.currency) + ' <small class="muted">(from your site)</small>' : '<span class="chip dash">Not found on the site</span>'}</span></div>
            <div class="fact-row"><span>Voice</span><span>${(b.tones || []).length ? esc(b.tones.join(', ')) : '<span class="chip dash">Not found</span>'}</span></div>
            <div class="fact-row"><span>Avoid saying</span><span>${(b.dont || []).length ? esc(b.dont.join(', ')) : 'Nothing set'}</span></div>
            ${sw.length ? `<div><span class="eyebrow">Colours I read from your site</span><div class="swatches">${sw.map((c, i) => `<span class="sw"><i style="background:${esc(c)}"></i><b>${esc((b.names || [])[i] || 'Colour')}</b> ${esc(c)}</span>`).join('')}</div><small class="muted">${b.fromSite ? 'Read from your site’s styles (Firecrawl branding).' : 'Not enough colours found on the site to build a palette.'} Roles are inferred; edit them in Settings.</small></div>` : ''}
            ${!live ? '<span class="chip warn">Website not read: built from your description</span>' : ''}
          </div>
          <div style="display:grid;gap:16px;align-content:start">
            <div><span class="eyebrow">Products${(S.products || []).length ? ' · ' + S.products.length + ' found' : ''}</span>
              ${(S.products || []).length ? `<div class="prod-list" role="list">${prodList}</div><small class="muted">Read from ${esc(S.input.site || 'your site')}${S.sources && S.sources.shopify && S.sources.shopify.status === 'not_shopify' ? ' (not a Shopify store, so prices and photos are often missing)' : ''}. Unknown values stay unknown.</small>` : '<div class="chip dash">No products found. That’s fine for a service or app.</div>'}</div>
            <div><span class="eyebrow">Likely customers · tap to drop one</span>
              <div class="icp-list">${(S.icps || []).length ? S.icps.map((i, n) => `<button class="icp ${i.on === false ? 'off' : ''}" data-icp="${n}" type="button" aria-pressed="${i.on !== false}" style="text-align:left">
                <div class="row"><strong>${esc(i.name)}</strong><span class="chip ${i.evidence ? 'b' : 'dash'}">${i.evidence ? 'Evidence from your site' : 'Needs your check'}</span></div>
                <small>${esc(i.who)}</small><small>Pain: ${esc(i.pain)}</small></button>`).join('') : '<div class="chip dash">I couldn’t infer customers. You’ll set the audience in step 4.</div>'}</div></div>
          </div>
        </div>
        <div class="nav-row"><button class="btn ghost" id="back" type="button">← Back</button><button class="btn lg" id="next" type="button">Looks right →</button></div>
      </div></div>`;
    root.querySelectorAll('[data-icp]').forEach((el) => el.addEventListener('click', () => { const i = S.icps[+el.dataset.icp]; i.on = i.on === false; C.save(); step1(); }));
    $('#back').onclick = () => go(0);
    root.querySelectorAll('[data-prod]').forEach((el) => el.addEventListener('click', () => { const p = S.products[+el.dataset.prod]; if (!p) return; $('#fl-name').value = p.name || ''; $('#fl-price').value = Number(p.price) > 0 ? p.price : ''; $('#fl-url').value = p.url || ''; if (p.currency || b.currency) $('#fl-cur').value = p.currency || b.currency; root.querySelectorAll('[data-prod]').forEach((x) => { x.classList.toggle('on', x === el); x.setAttribute('aria-pressed', String(x === el)); }); drawCands(p); $('#fl-name').focus(); }));
    let pickedImg = fl.image || '';
    function drawCands(p) { const c = (p.enrich && p.enrich.candidates && p.enrich.candidates.length) ? p.enrich.candidates : [...new Set([p.image, ...(p.images || [])].filter(Boolean))].slice(0, 3).map((u) => ({ url: u, from: 'store catalogue' })); pickedImg = c[0] ? c[0].url : '';
      $('#fl-cands').innerHTML = c.length ? `<span class="eyebrow">Is this the product? Pick the right photo</span><div class="cand-row">${c.map((x, k) => `<button type="button" class="cand ${k ? '' : 'on'}" data-cand="${esc(x.url)}" aria-pressed="${!k}"><img src="${esc(x.url)}" alt="Candidate ${k + 1}" referrerpolicy="no-referrer"><small>${esc(x.from)}</small></button>`).join('')}<button type="button" class="cand" data-cand="" aria-pressed="false"><span class="ph">None of these</span></button></div><small class="muted">Found on ${esc((() => { try { return new URL((p.enrich && p.enrich.productUrl) || p.url || c[0].url).hostname; } catch (e) { return 'your site'; } })())}. Used to recognise the product only; for ads you’ll upload a photo you have the rights to.</small>` : (p.enrich ? `<small class="muted">${esc(p.enrich.message)}. You can continue without a photo.</small>` : '');
      root.querySelectorAll('[data-cand]').forEach((b) => b.onclick = () => { pickedImg = b.dataset.cand; root.querySelectorAll('[data-cand]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); }); }
    root.querySelectorAll('[data-kind]').forEach((el) => el.addEventListener('click', () => { S.flagship = Object.assign({}, fl, { name: $('#fl-name').value.trim(), variant: $('#fl-var').value.trim(), url: $('#fl-url').value.trim(), price: $('#fl-price').value.trim(), currency: $('#fl-cur').value, kind: el.dataset.kind, confirmedAt: null }); C.save(); step1(); }));
    const rs = $('#rescan'); if (rs) rs.onclick = () => { S.step = 0; C.save(); render(); };
    $('#next').onclick = () => {
      const name = $('#fl-name').value.trim(), url = $('#fl-url').value.trim(), price = $('#fl-price').value.trim(), err = [];
      if (!name) err.push('Name the product you want to lead with.');
      if (price && !(Number(price) > 0)) err.push('Price must be a positive number, or leave it blank if unknown.');
      if (price && !$('#fl-cur').value) err.push('Choose the currency for that price.');
      if (url) { let u = null; try { u = new URL(url); } catch (e) { /* invalid */ } if (!u || u.protocol !== 'https:') err.push('The buy link must be a full https:// address.'); }
      if (err.length) { $('#fl-err').innerHTML = '<div class="err">' + err.map(esc).join(' ') + '</div>'; $('#fl-name').focus(); return; }
      const hit = (S.products || []).find((p) => p.name === name);
      S.flagship = { name, kind: (S.flagship && S.flagship.kind) || 'product', variant: $('#fl-var').value.trim(), price: price ? Number(price) : null, currency: $('#fl-cur').value || null, url, image: pickedImg || '', imageRights: 'unconfirmed', imageSource: hit && hit.enrich ? hit.enrich.productUrl : null, source: hit ? 'site_scan' : 'user', confirmedAt: new Date().toISOString() };
      S.offer = { name, price: S.flagship.price, url };
      S.brand.line = $('#line').value.trim(); S.brand.name = $('#bname').value.trim() || S.brand.name; S.input.desc = S.brand.line; C.save(); C.ops.post('obTiming', { context: obCtx(), mark: 'product_confirmed', at: Date.now() }).catch(() => {}); go(2);
    };
  }

  /* ---------- 3. Outcome ---------- */
  /* ---------- 3. Competitors & communities (the person decides; suggestions are labelled) ---------- */
  const obCtx = () => ({ brand: { name: (S.brand && S.brand.name) || '', line: (S.brand && S.brand.line) || S.input.desc || '', site: S.input.site || '' }, product: S.flagship && S.flagship.name ? { name: S.flagship.name, price: S.flagship.price || null, currency: S.flagship.currency || null } : undefined, audience: ((S.icps || []).find((i) => i.on !== false) || {}).who || '', country: (S.bounds && S.bounds.country) || '' });
  let intel = { competitors: null, communities: null, cErr: '', mErr: '', loading: false, ctx: null };
  async function loadIntel(force) {
    if (intel.loading) return; intel.loading = true; stepIntel();
    let snap = {}; try { const cx = obCtx(); snap = await C.ops.get('obIntel', { site: cx.brand.site, brand: cx.brand.name, country: cx.country }); } catch (e) { /* first visit */ }
    intel.competitors = snap.competitors; intel.communities = snap.communities;
    const jobs = [];
    if (force || !intel.competitors) jobs.push(C.ops.post('obCompetitors', obCtx()).then((r) => { intel.competitors = r; C.ops.post('obTiming', { context: obCtx(), mark: 'competitors_shown', at: Date.now() }).catch(() => {}); }).catch((e) => { intel.cErr = 'Couldn’t suggest competitors right now. Add the ones you know below.'; console.warn(e.message); }));
    if (force || !intel.communities) jobs.push(C.ops.post('obCommunities', obCtx()).then((r) => { intel.communities = r; }).catch((e) => { intel.mErr = 'Couldn’t search for communities right now.'; console.warn(e.message); }));
    await Promise.all(jobs); intel.loading = false; if (S.step === 2) stepIntel();
  }
  function stepIntel() {
    const ck = (S.input.site || '') + '|' + ((S.brand && S.brand.name) || ''); if (intel.ctx !== ck) { intel = { competitors: null, communities: null, cErr: '', mErr: '', loading: false, ctx: ck }; }
    const cs = (intel.competitors && intel.competitors.items) || [], ms = (intel.communities && intel.communities.items) || [];
    const appr = cs.filter((x) => x.decision === 'approved').length;
    const kindChip = { direct: 'Direct', indirect: 'Indirect', adjacent: 'Adjacent' };
    root.innerHTML = `<div class="ob-col wide">
      <div><span class="eyebrow">Step 3 · Who you’re up against, and where buyers talk</span><h1 class="disp">Pick the competitors you <b>actually care about.</b></h1>
      <p class="sub" style="margin-top:10px">These are suggestions. Only the ones you approve are used for research and creative. You can skip this and come back later.</p></div>
      <div class="card-p">
        <section aria-labelledby="cmp-h"><div class="sec-h"><h2 id="cmp-h" class="disp s">Possible competitors</h2><span class="chip ${appr ? 'b' : 'dash'}">${appr} approved</span></div>
          ${intel.loading && !cs.length ? '<div class="skel-row" aria-busy="true">Finding competitors and checking their websites…</div>' : ''}
          ${intel.cErr ? `<div class="err">${esc(intel.cErr)}</div>` : ''}
          <div class="cmp-grid">${cs.map((x) => `<article class="cmp ${x.decision}"><div class="row"><strong>${esc(x.name)}</strong><span class="chip dash">${kindChip[x.kind] || 'Added'}</span></div>
            <a class="small" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.domain)}</a>
            ${x.overlap ? `<small>Overlap: ${esc(x.overlap)}</small>` : ''}<p class="small">${esc(x.why || '')}</p>
            <small class="muted">${x.origin === 'user_added' ? 'Added by you' : 'AI suggestion · ' + (x.evidence && x.evidence.type === 'website_reachable' ? 'website checked: “' + esc((x.evidence.title || '').slice(0, 50)) + '”' : 'website could not be checked')} · ${esc(x.confidence)} confidence</small>
            <div class="row">${x.decision === 'approved' ? '<span class="chip b">Approved</span>' : x.decision === 'rejected' ? '<span class="chip dash">Rejected</span>' : ''}
              <button class="btn sm ${x.decision === 'approved' ? 'ghost' : ''}" data-cd="${esc(x.id)}" data-v="${x.decision === 'approved' ? 'pending' : 'approved'}" type="button">${x.decision === 'approved' ? 'Undo' : 'Approve'}</button>
              ${x.decision !== 'rejected' ? `<button class="btn sm ghost" data-cd="${esc(x.id)}" data-v="rejected" type="button">Not a competitor</button>` : `<button class="btn sm ghost" data-cd="${esc(x.id)}" data-v="pending" type="button">Undo</button>`}</div></article>`).join('')}</div>
          <form id="cmp-add" class="row" style="margin-top:10px;flex-wrap:wrap"><input id="ca-n" type="text" placeholder="Competitor name" aria-label="Competitor name" maxlength="60" style="max-width:220px"><input id="ca-u" type="text" placeholder="theirsite.com" aria-label="Competitor website" maxlength="200" style="max-width:240px"><button class="btn sm" type="submit">Add competitor</button>${cs.length ? '<button class="btn sm ghost" id="cmp-more" type="button">Suggest others</button>' : ''}</form><div id="ca-e"></div></section>
        <section aria-labelledby="com-h" style="margin-top:22px"><div class="sec-h"><h2 id="com-h" class="disp s">Where your customers might be talking</h2><span class="chip dash">Suggestions, not demand data</span></div>
          ${intel.loading && !ms.length ? '<div class="skel-row" aria-busy="true">Searching for relevant communities…</div>' : ''}
          ${intel.mErr || (intel.communities && intel.communities.reason) ? `<div class="err">${esc(intel.mErr || intel.communities.reason)}</div>` : ''}
          <div class="com-grid">${ms.map((x) => `<article class="com ${x.decision}"><div class="row"><strong>${esc(x.name)}</strong>${x.decision === 'saved' ? '<span class="chip b">Saved</span>' : ''}</div>
            ${x.snippet ? `<p class="small">“${esc(x.snippet)}”</p>` : ''}<small class="muted">${esc(x.relevance)}</small><small class="muted">Source: ${esc(x.source)}</small>
            <div class="row"><button class="btn sm ${x.decision === 'saved' ? 'ghost' : ''}" data-md="${esc(x.id)}" data-v="${x.decision === 'saved' ? 'suggested' : 'saved'}" type="button">${x.decision === 'saved' ? 'Unsave' : 'Save'}</button><button class="btn sm ghost" data-md="${esc(x.id)}" data-v="not_relevant" type="button">Not relevant</button><a class="btn sm ghost" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">View on Reddit</a></div></article>`).join('')}</div>
          <form id="com-add" class="row" style="margin-top:10px"><input id="cm-n" type="text" placeholder="r/yourcommunity" aria-label="Add a subreddit" maxlength="40" style="max-width:240px"><button class="btn sm ghost" type="submit">Add community</button></form><div id="cm-e"></div></section>
        <div class="nav-row"><button class="btn ghost" id="back" type="button">← Back</button><button class="btn lg" id="next" type="button">${appr ? 'Continue →' : 'Continue without competitors →'}</button></div>
      </div></div>`;
    $('#back').onclick = () => go(1); $('#next').onclick = () => go(3);
    const decide = async (action, body) => { try { const r = await C.ops.post(action, Object.assign({ context: obCtx() }, body)); if (action === 'obDecideCompetitor') intel.competitors = r; else intel.communities = r; stepIntel(); } catch (e) { toast(e.message); } };
    root.querySelectorAll('[data-cd]').forEach((b) => b.onclick = () => decide('obDecideCompetitor', { id: b.dataset.cd, decision: b.dataset.v }));
    root.querySelectorAll('[data-md]').forEach((b) => b.onclick = () => decide('obDecideCommunity', { id: b.dataset.md, decision: b.dataset.v }));
    $('#cmp-add').onsubmit = (e) => { e.preventDefault(); const n = $('#ca-n').value.trim(), u = $('#ca-u').value.trim(); if (n.length < 2 || !u) { $('#ca-e').innerHTML = '<div class="err">Enter a name and a website.</div>'; return; } decide('obDecideCompetitor', { add: { name: n, url: u } }); };
    $('#com-add').onsubmit = (e) => { e.preventDefault(); decide('obDecideCommunity', { add: $('#cm-n').value.trim() }); };
    const more = $('#cmp-more'); if (more) more.onclick = () => { intel.competitors = null; loadIntel(true); };
    if (!intel.competitors && !intel.loading && !intel.cErr) loadIntel();
  }
  const toast = (m) => { const t = document.createElement('div'); t.className = 'toast on'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); };

  function step2() {
    const sug = C.suggestGoal();
    root.innerHTML = `<div class="ob-col wide">
      <div><span class="eyebrow">Step 4 · Choose the outcome</span><h1 class="disp">What would make this month a <b>win?</b></h1></div>
      <div class="card-p">
        <div class="opt-grid" role="group" aria-label="Goal">${C.GOALS.map((g) => `<button class="opt" type="button" data-g="${g.k}" aria-pressed="${S.goal.k === g.k}">
          ${g.k === sug ? '<span class="chip y">Suggested for you</span>' : ''}<strong>${g.t}</strong><small>${g.d}</small></button>`).join('')}</div>
        <label class="field" style="max-width:360px"><span>Optional target</span><input id="target" type="number" min="0" inputmode="numeric" placeholder="e.g. 100" value="${esc(S.goal.target)}"><small>${(C.GOALS.find((g) => g.k === S.goal.k) || {}).unit || 'results'} this month. Leave blank if unsure.</small></label>
        <div class="nav-row"><button class="btn ghost" id="back" type="button">← Back</button><button class="btn lg" id="next" type="button" ${S.goal.k ? '' : 'disabled'}>Continue →</button></div>
      </div></div>`;
    root.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { S.goal.k = b.dataset.g; C.save(); step2(); }));
    $('#target').addEventListener('input', (e) => { S.goal.target = e.target.value; C.save(); });
    $('#back').onclick = () => go(2); $('#next').onclick = () => go(4);
  }

  /* ---------- 4. Boundaries ---------- */
  function step3() {
    const B = S.bounds;
    root.innerHTML = `<div class="ob-col wide">
      <div><span class="eyebrow">Step 5 · Set boundaries</span><h1 class="disp">Where should we focus, and what can we <b>spend?</b></h1></div>
      <div class="card-p">
        <div class="cols2">
          <div style="display:grid;gap:12px;align-content:start"><span class="eyebrow">Market</span>
            <div class="seg" role="group" aria-label="Market mode"><button type="button" data-rm="set" aria-pressed="${B.regionMode === 'set'}">I know it</button><button type="button" data-rm="decide" aria-pressed="${B.regionMode === 'decide'}">Help me decide</button></div>
            <label class="field"><span>Country the ads would target</span><select id="country"><option value="">Choose…</option>${[['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'United Arab Emirates']].map(([k, t]) => `<option value="${k}" ${B.country === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            ${B.regionMode === 'set' ? `<label class="field"><span>City, country, or a few</span><input id="region" type="text" placeholder="Bengaluru, Mumbai" value="${esc(B.region)}"></label>` : '<small class="muted">I’ll compare regions in Discover and only rank them when there’s evidence.</small>'}</div>
          <div style="display:grid;gap:12px;align-content:start"><span class="eyebrow">Channels</span>
            <div class="seg" role="group" aria-label="Channels"><button type="button" data-ch="both" aria-pressed="${B.channels === 'both'}">Both</button><button type="button" data-ch="organic" aria-pressed="${B.channels === 'organic'}">Organic only</button><button type="button" data-ch="paid" aria-pressed="${B.channels === 'paid'}">Paid only</button></div>
            ${B.channels === 'organic' ? '<small class="muted">No ad budget needed.</small>' : `<label class="field"><span>Monthly ad budget${C.currency() ? ' (' + esc(C.currency()) + ')' : ' (in the target country’s currency)'}</span><input id="budget" type="number" min="0" inputmode="numeric" placeholder="10000" value="${esc(B.budget)}"><small>Leave blank to continue with organic research only. This is a cap, never a target.</small></label>`}</div>
        </div>
        <label class="field ${B.audienceMode === 'find' && !B.audience ? 'uncertain' : ''}"><span>Primary audience</span>
          <textarea id="aud" placeholder="One short description, or leave it and I’ll find it">${esc(B.audience)}</textarea>
          <small>${B.audience ? 'Prefilled from the strongest customer I found. Edit freely.' : 'Empty: I’ll suggest an audience and tell you how sure I am.'}</small></label>
        <div class="fact-row" style="border:2px solid var(--ink);padding:10px;background:#fff"><span><strong>Approval before publishing</strong></span><span><span class="chip b">Always on · locked</span> Nothing is posted, launched or spent until you approve that exact item. This can’t be switched off here.</span></div>
        <div id="s3-err"></div>
        <div class="nav-row"><button class="btn ghost" id="back" type="button">← Back</button><button class="btn lg" id="next" type="button">Show me the plan →</button></div>
      </div></div>`;
    root.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { keep(); B.regionMode = b.dataset.rm; C.save(); step3(); }));
    root.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => { keep(); B.channels = b.dataset.ch; C.save(); step3(); }));
    function keep() { const co = $('#country'); if (co) B.country = co.value; const r = $('#region'), bu = $('#budget'), a = $('#aud'); if (r) B.region = r.value.trim(); if (bu) B.budget = bu.value; if (a) { B.audience = a.value.trim(); } }
    $('#back').onclick = () => { keep(); go(3); };
    $('#next').onclick = () => { keep(); if (B.channels !== 'organic' && Number(B.budget) > 0 && !B.country) { $('#s3-err').innerHTML = '<div class="err">Choose the country your ads would target.</div>'; $('#country').focus(); return; } B.audienceMode = B.audience ? 'set' : 'find'; B.budgetMode = Number(B.budget) > 0 && B.channels !== 'organic' ? 'amount' : 'tbd'; if (B.regionMode === 'decide') B.region = B.region; C.save(); S.plan = C.buildPlan(); C.save(); go(5); };
  }

  /* ---------- 5. First plan ---------- */
  function step4() {
    const plan = C.buildPlan(); S.plan = plan; C.save();
    const g = C.GOALS.find((x) => x.k === S.goal.k) || C.GOALS[0];
    root.innerHTML = `<div class="ob-col wide">
      <div><span class="eyebrow">Step 6 · Your first plan</span><h1 class="disp">I’ve found a few places worth <b>starting.</b></h1>
      <p class="sub" style="margin-top:10px">Goal: ${g.t.toLowerCase()}${S.goal.target ? ' (' + esc(S.goal.target) + ' ' + g.unit + ')' : ''} · ${S.bounds.region ? esc(S.bounds.region) : 'region still open'} · ${S.bounds.budgetMode === 'amount' ? 'cap ' + C.money(S.bounds.budget) + '/month' : 'organic only for now'}.</p></div>
      <div class="card-p">
        <div class="plan-list">${plan.map((p, n) => `<div class="plan-item"><span class="plan-num">${n + 1}</span>
          <div><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p>
            <div class="tags"><span class="chip b">${esc(p.kind)}</span><span class="chip ${p.conf.l === 'Low' ? 'warn' : 'y'}">${p.conf.l} confidence</span>${p.assisted ? '<span class="chip dash">Assisted · you post</span>' : ''}</div></div>
          <small class="muted" style="max-width:200px">${esc(p.conf.why)}</small></div>`).join('')}
          ${S.bounds.channels === 'organic' || S.bounds.budgetMode !== 'amount' ? '<div class="plan-item skip-it"><span class="plan-num">·</span><div><h3>Paid test: skipped for now</h3><p>No ad budget set, so I won’t propose spending. You can add a cap any time in Settings.</p></div></div>' : ''}
        </div>
        <div class="fact-row" style="border:0;padding:0"><span>No accounts connected yet</span><span class="muted small">I’ll ask only when you want to execute something.</span></div>
        <div class="nav-row"><button class="btn ghost" id="back" type="button">← Adjust</button><button class="btn lg yellow" id="next" type="button">Accept plan →</button></div>
      </div></div>`;
    $('#back').onclick = () => go(4);
    $('#next').onclick = async () => { try { await Promise.all([C.ops.post('obCreatives', obCtx()), C.ops.post('obAds', { context: obCtx() })]); C.ops.post('obTiming', { context: obCtx(), mark: 'dashboard_ready', at: Date.now() }).catch(() => {}); } catch (e) { console.warn('workspace init', e.message); } C.finish(); C.log('onboarding', 'Accepted first plan', { items: plan.length, flagship: (S.flagship || {}).name || null }); try { await C.ops.get('workspace'); } catch (e) { /* workspace is created on first server call; retried in the app */ } location.href = 'app-v4.html#/home'; };
  }

  let sure = false;
  document.getElementById('restart').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!sure) { sure = true; b.textContent = 'Sure? Click again'; setTimeout(() => { sure = false; b.textContent = 'Start over'; }, 3000); return; }
    C.reset(); location.reload();
  });
  if (S.step > 0 && !S.brand) S.step = 0;
  render();
})();
