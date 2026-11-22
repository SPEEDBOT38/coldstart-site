/* Coldstart v4 onboarding: five steps, one question at a time.
   1 Business (URL) · 2 Brand DNA (confirm) · 3 Outcome (goal) · 4 Boundaries · 5 First plan (no accounts needed). */
(function () {
  const C = window.CS, S = C.S, esc = C.esc;
  const root = document.getElementById('stage');
  const ticksEl = document.getElementById('ticks');
  const NAMES = ['Business', 'Brand DNA', 'Outcome', 'Boundaries', 'First plan'];
  const $ = (s, r) => (r || document).querySelector(s);
  let scanning = false, scanTimer = null, scanIdx = 0, lastError = '', showDesc = false;

  function ticks() {
    ticksEl.innerHTML = '<span class="ticks-label">Step ' + (S.step + 1) + ' / 5 · ' + NAMES[S.step] + '</span>' +
      NAMES.map((n, i) => '<i class="tick ' + (i < S.step ? 'done' : i === S.step ? 'now' : '') + '" title="' + n + '"></i>').join('');
  }
  function go(n) { S.step = Math.max(0, Math.min(4, n)); C.save(); render(); window.scrollTo(0, 0); const h = $('h1'); h && h.focus && h.setAttribute('tabindex', '-1') && h.focus({ preventScroll: true }); }
  function render() {
    ticks(); document.body.classList.toggle('step-later', S.step > 0);
    ([step0, step1, step2, step3, step4][S.step])();
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
  function renderScan() {
    const pct = Math.min(90, 12 + scanIdx * 24);
    root.innerHTML = `<div class="ob-col scan" role="status" aria-live="polite">
      <div><span class="eyebrow">Studying your business</span><h1 class="disp m">Reading <b>${esc(C.parseSite(S.input.site) || 'your description')}</b></h1></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <ul class="scan-list">${SCAN_STEPS.map((t, i) => `<li class="${i < scanIdx ? 'done' : i === scanIdx ? 'now' : 'todo'}">${t}</li>`).join('')}</ul>
      <p class="ob-note">Usually 15 to 25 seconds. The bar holds at 90% until the real answer arrives.</p></div>`;
  }
  async function startScan(domain) {
    scanning = true; scanIdx = 0; render();
    scanTimer = setInterval(() => { if (scanIdx < SCAN_STEPS.length - 1) { scanIdx++; renderScan(); } }, 4500);
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
      lastError = 'I couldn’t read that site (' + e.message + ').';
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
    const cur = (S.brand && S.brand.currency) || 'INR';
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return lo === hi ? C.money(lo, cur) : C.money(lo, cur) + ' to ' + C.money(hi, cur);
  }
  function step1() {
    const b = S.brand || {}, live = S.scan && S.scan.mode === 'live';
    const pr = priceRange();
    const prodStrip = (S.products || []).slice(0, 10).map((p) => p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ph">${esc((p.name || '').slice(0, 14))}</span>`).join('');
    const sw = (b.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5);
    const fl = S.flagship || (S.products && S.products[0] ? { name: S.products[0].name, variant: '', price: S.products[0].price || '', url: S.products[0].url || '', image: S.products[0].image || '' } : { name: '', variant: '', price: '', url: '' });
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
            <label class="field"><span>Brand name</span><input id="bname" type="text" value="${esc(b.name || '')}"></label>
            <fieldset class="flag" style="border:2px solid var(--ink);padding:12px;display:grid;gap:10px;background:#fff"><legend class="eyebrow" style="padding:0 6px">Flagship product I should lead with</legend>
              ${(S.products || []).length > 1 ? `<label class="field"><span>Pick from your store</span><select id="fl-pick"><option value="">Something else…</option>${S.products.slice(0, 8).map((p, i) => `<option value="${i}" ${p.name === fl.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
              <label class="field"><span>Product name</span><input id="fl-name" type="text" value="${esc(fl.name)}" maxlength="120"></label>
              <div class="cols2"><label class="field"><span>Variant (size, flavour, shade)</span><input id="fl-var" type="text" value="${esc(fl.variant)}" maxlength="80" placeholder="250 g"></label><label class="field"><span>Price (${(b.currency) === 'USD' ? '$' : '₹'})</span><input id="fl-price" type="number" min="0" step="any" value="${esc(String(fl.price || ''))}"></label></div>
              <label class="field"><span>Where people buy it (checkout or product page, https)</span><input id="fl-url" type="url" value="${esc(fl.url || '')}" placeholder="https://yourstore.com/products/…"></label><div id="fl-err"></div></fieldset>
            <div class="fact-row"><span>Price range</span><span>${pr ? esc(pr) : '<span class="chip dash">Not found</span>'}</span></div>
            <div class="fact-row"><span>Language</span><span>${(b.currency || 'INR') === 'INR' ? 'English (India)' : 'English'}</span></div>
            <div class="fact-row"><span>Voice</span><span>${(b.tones || []).length ? esc(b.tones.join(', ')) : '<span class="chip dash">Not found</span>'}</span></div>
            <div class="fact-row"><span>Avoid saying</span><span>${(b.dont || []).length ? esc(b.dont.join(', ')) : 'Nothing set'}</span></div>
            ${sw.length ? `<div><span class="eyebrow">Colours I read from your site</span><div class="swatches">${sw.map((c, i) => `<span class="sw"><i style="background:${esc(c)}"></i>${esc(c)}</span>`).join('')}</div></div>` : ''}
            ${!live ? '<span class="chip warn">Website not read: built from your description</span>' : ''}
          </div>
          <div style="display:grid;gap:16px;align-content:start">
            <div><span class="eyebrow">Products${(S.products || []).length ? ' · ' + S.products.length + ' found' : ''}</span>
              ${(S.products || []).length ? `<div class="prod-strip">${prodStrip}</div>` : '<div class="chip dash">No products found. That’s fine for a service or app.</div>'}</div>
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
    const pick = $('#fl-pick'); if (pick) pick.onchange = () => { const p = S.products[+pick.value]; if (p) { $('#fl-name').value = p.name || ''; $('#fl-price').value = p.price || ''; $('#fl-url').value = p.url || ''; } };
    const rs = $('#rescan'); if (rs) rs.onclick = () => { S.step = 0; C.save(); render(); };
    $('#next').onclick = () => {
      const name = $('#fl-name').value.trim(), url = $('#fl-url').value.trim(), price = $('#fl-price').value.trim(), err = [];
      if (!name) err.push('Name the product you want to lead with.');
      if (price && !(Number(price) >= 0)) err.push('Price must be a number.');
      if (url) { let u = null; try { u = new URL(url); } catch (e) { /* invalid */ } if (!u || u.protocol !== 'https:') err.push('The buy link must be a full https:// address.'); }
      if (err.length) { $('#fl-err').innerHTML = '<div class="err">' + err.map(esc).join(' ') + '</div>'; $('#fl-name').focus(); return; }
      const hit = (S.products || []).find((p) => p.name === name);
      S.flagship = { name, variant: $('#fl-var').value.trim(), price: price ? Number(price) : null, url, image: (hit && hit.image) || '', confirmedAt: new Date().toISOString() };
      S.offer = { name, price: S.flagship.price, url };
      S.brand.line = $('#line').value.trim(); S.brand.name = $('#bname').value.trim() || S.brand.name; S.input.desc = S.brand.line; C.save(); go(2);
    };
  }

  /* ---------- 3. Outcome ---------- */
  function step2() {
    const sug = C.suggestGoal();
    root.innerHTML = `<div class="ob-col wide">
      <div><span class="eyebrow">Step 3 · Choose the outcome</span><h1 class="disp">What would make this month a <b>win?</b></h1></div>
      <div class="card-p">
        <div class="opt-grid" role="group" aria-label="Goal">${C.GOALS.map((g) => `<button class="opt" type="button" data-g="${g.k}" aria-pressed="${S.goal.k === g.k}">
          ${g.k === sug ? '<span class="chip y">Suggested for you</span>' : ''}<strong>${g.t}</strong><small>${g.d}</small></button>`).join('')}</div>
        <label class="field" style="max-width:360px"><span>Optional target</span><input id="target" type="number" min="0" inputmode="numeric" placeholder="e.g. 100" value="${esc(S.goal.target)}"><small>${(C.GOALS.find((g) => g.k === S.goal.k) || {}).unit || 'results'} this month. Leave blank if unsure.</small></label>
        <div class="nav-row"><button class="btn ghost" id="back" type="button">← Back</button><button class="btn lg" id="next" type="button" ${S.goal.k ? '' : 'disabled'}>Continue →</button></div>
      </div></div>`;
    root.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { S.goal.k = b.dataset.g; C.save(); step2(); }));
    $('#target').addEventListener('input', (e) => { S.goal.target = e.target.value; C.save(); });
    $('#back').onclick = () => go(1); $('#next').onclick = () => go(3);
  }

  /* ---------- 4. Boundaries ---------- */
  function step3() {
    const B = S.bounds;
    root.innerHTML = `<div class="ob-col wide">
      <div><span class="eyebrow">Step 4 · Set boundaries</span><h1 class="disp">Where should we focus, and what can we <b>spend?</b></h1></div>
      <div class="card-p">
        <div class="cols2">
          <div style="display:grid;gap:12px;align-content:start"><span class="eyebrow">Market</span>
            <div class="seg" role="group" aria-label="Market mode"><button type="button" data-rm="set" aria-pressed="${B.regionMode === 'set'}">I know it</button><button type="button" data-rm="decide" aria-pressed="${B.regionMode === 'decide'}">Help me decide</button></div>
            <label class="field"><span>Country the ads would target</span><select id="country"><option value="">Choose…</option>${[['IN', 'India'], ['US', 'United States'], ['GB', 'United Kingdom'], ['AE', 'United Arab Emirates']].map(([k, t]) => `<option value="${k}" ${B.country === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            ${B.regionMode === 'set' ? `<label class="field"><span>City, country, or a few</span><input id="region" type="text" placeholder="Bengaluru, Mumbai" value="${esc(B.region)}"></label>` : '<small class="muted">I’ll compare regions in Discover and only rank them when there’s evidence.</small>'}</div>
          <div style="display:grid;gap:12px;align-content:start"><span class="eyebrow">Channels</span>
            <div class="seg" role="group" aria-label="Channels"><button type="button" data-ch="both" aria-pressed="${B.channels === 'both'}">Both</button><button type="button" data-ch="organic" aria-pressed="${B.channels === 'organic'}">Organic only</button><button type="button" data-ch="paid" aria-pressed="${B.channels === 'paid'}">Paid only</button></div>
            ${B.channels === 'organic' ? '<small class="muted">No ad budget needed.</small>' : `<label class="field"><span>Monthly ad budget (${(S.brand && S.brand.currency) === 'USD' ? '$' : '₹'})</span><input id="budget" type="number" min="0" inputmode="numeric" placeholder="10000" value="${esc(B.budget)}"><small>Leave blank to continue with organic research only. This is a cap, never a target.</small></label>`}</div>
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
    $('#back').onclick = () => { keep(); go(2); };
    $('#next').onclick = () => { keep(); if (B.channels !== 'organic' && Number(B.budget) > 0 && !B.country) { $('#s3-err').innerHTML = '<div class="err">Choose the country your ads would target.</div>'; $('#country').focus(); return; } B.audienceMode = B.audience ? 'set' : 'find'; B.budgetMode = Number(B.budget) > 0 && B.channels !== 'organic' ? 'amount' : 'tbd'; if (B.regionMode === 'decide') B.region = B.region; C.save(); S.plan = C.buildPlan(); C.save(); go(4); };
  }

  /* ---------- 5. First plan ---------- */
  function step4() {
    const plan = C.buildPlan(); S.plan = plan; C.save();
    const g = C.GOALS.find((x) => x.k === S.goal.k) || C.GOALS[0];
    root.innerHTML = `<div class="ob-col wide">
      <div><span class="eyebrow">Step 5 · Your first plan</span><h1 class="disp">I’ve found a few places worth <b>starting.</b></h1>
      <p class="sub" style="margin-top:10px">Goal: ${g.t.toLowerCase()}${S.goal.target ? ' (' + esc(S.goal.target) + ' ' + g.unit + ')' : ''} · ${S.bounds.region ? esc(S.bounds.region) : 'region still open'} · ${S.bounds.budgetMode === 'amount' ? 'cap ' + C.money(S.bounds.budget, (S.brand && S.brand.currency) || 'INR') + '/month' : 'organic only for now'}.</p></div>
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
    $('#back').onclick = () => go(3);
    $('#next').onclick = async () => { C.finish(); C.log('onboarding', 'Accepted first plan', { items: plan.length, flagship: (S.flagship || {}).name || null }); try { await C.ops.get('workspace'); } catch (e) { /* workspace is created on first server call; retried in the app */ } location.href = 'app-v4.html#/home'; };
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
