/* Insights: the page the founder lands on after onboarding. It drives the server pipeline (js-side of lib/intel) step by step,
   keeps the painted ads in the browser, and shows the brand book, the Instagram ICPs, the competitor analysis, every ad read,
   and three new ads for existing products. Exposed as window.Insights; workspace.js calls visit(), render() and afterRender(). */
(function () {
  const API = 'plugins/intel/actions/';
  const STAGES = [['brand', 'Reading your brand'], ['instagram', 'Reading your Instagram'], ['pull', 'Pulling competitor ads'], ['analyze', 'Reading each ad'], ['synthesize', 'Writing the competitor analysis'], ['write', 'Writing 3 ads'], ['paint', 'Painting each ad from your product photo']];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let loopBusy = false;

  // What the server needs from the onboarding handoff. Nothing secret: the server keeps its own keys.
  function inputFrom(S) {
    const ob = S.onboarding || {}, b = S.brand || {}, book = ob.book || {};
    return {
      brand: { name: b.name, url: b.url, ig: ob.ig, line: b.line, voice: b.voice, avoid: b.avoid, currency: ob.currency || 'INR', category: ob.category, product: ob.product },
      kit: { colors: { primary: book.colors && book.colors[0], secondary: book.colors && book.colors[1], accent: book.colors && book.colors[2], background: book.colors && book.colors[3], text: book.colors && book.colors[4] }, fonts: { heading: (book.fonts || [])[0] } },
      products: (ob.products || []).filter(p => p && p.name).slice(0, 12),
      icps: (ob.icps || []).slice(0, 3),
      competitors: (ob.competitors || []).filter(Boolean).slice(0, 4),
      country: (ob.currency || 'INR') === 'INR' ? 'IN' : 'US',
    };
  }

  // Start a run for this onboarding (once), then keep stepping it until it is done.
  // The run happens during onboarding now; the workspace only shows what it produced.
  async function visit(ctx) { return ctx.S.intel || null; }

  async function loop(ctx) {
    if (loopBusy) return;
    loopBusy = true;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const I = ctx.S.intel;
        if (!I || I.done || !I.run) break;
        const r = await ctx.api(API + 'step', { method: 'POST', body: { run: I.run } });
        if (r.image) { const key = 'ins-' + I.run.id + '-' + I.images.length; await ctx.media.put(key, r.image); I.images.push(key); }
        I.run = r.run; I.done = !!r.done; I.error = r.run.error ? r.run.error.message : null;
        ctx.save(); ctx.rerender();
        if (!I.done) await sleep(1200);
      }
    } catch (e) {
      ctx.S.intel.error = e.message; ctx.save(); ctx.toast(e.message);
    } finally { loopBusy = false; ctx.rerender(); }
  }

  const pct = (v) => (v == null ? '' : Math.round(v * 100) + '%');
  const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || '');
  function swatches(S) {
    const ob = S.onboarding || {}, book = ob.book || {}, names = book.names || [], cols = (book.colors || []).filter(hexOk);
    return cols.length ? cols.map((c, i) => `<span class="ins-swatch"><i style="background:${esc(c)}"></i><small>${esc(names[i] || '')} ${esc(c)}</small></span>`).join('') : '<span class="muted small">No colours read from the site yet.</span>';
  }

  function progressView(I) {
    const run = I.run || {}, stage = run.stage || 'brand';
    const idx = STAGES.findIndex(([k]) => k === stage);
    const steps = STAGES.map(([k, label], i) => {
      const state = I.done && !I.error ? 'done' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
      return `<li class="ins-step is-${state}"><span></span>${esc(label)}</li>`;
    }).join('');
    const log = (run.log || []).slice(-10).map(l => `<li class="ins-log is-${esc(l.kind)}">${esc(l.text)}</li>`).join('');
    const err = I.error ? `<p class="notice warn">${esc(I.error)}</p>` : '';
    return `<section class="ins-progress panel panel-body" aria-live="polite">
      <span class="eyebrow">Building your insights</span>
      <h2>Reading ${esc((S_brand_name(run)) || 'your brand')} and its rivals</h2>
      <p class="small muted">About three minutes. You can leave this page; the run keeps going while it is open.</p>
      <ol class="ins-steps">${steps}</ol>
      <ul class="ins-logs">${log}</ul>${err}</section>`;
  }
  const S_brand_name = run => (run.input && run.input.brand && run.input.brand.name) || '';

  function brandBook(S, run) {
    const b = run.brand || {}, ob = S.onboarding || {}, book = ob.book || {};
    return `<section class="panel ins-card" aria-labelledby="ins-brand"><div class="panel-head"><h2 id="ins-brand">Brand book</h2><span class="caption">${b.read_from === 'website' ? 'Read from your website' : 'From onboarding'}</span></div>
      <div class="panel-body ins-grid2">
        <div><span class="eyebrow">What you sell</span><p>${esc(b.sells || (S.brand && S.brand.line) || '')}</p>
          <span class="eyebrow">Voice</span><p>${esc(b.tone_of_voice || (S.brand && S.brand.voice) || '')}</p>
          ${(b.voice_traits || []).length ? `<p class="ins-chips">${b.voice_traits.map(t => `<span class="gen-chip static">${esc(t)}</span>`).join('')}</p>` : ''}
          ${b.voice_sample ? `<blockquote class="ins-quote">${esc(b.voice_sample)}</blockquote>` : ''}
          <span class="eyebrow">Buyer</span><p>${esc(b.target_buyer || '')}</p>
          ${(b.proof_points || []).length ? `<span class="eyebrow">Proof you have</span><ul class="ins-list">${b.proof_points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div>
        <div><span class="eyebrow">Colours</span><div class="ins-swatches">${swatches(S)}</div>
          <span class="eyebrow">Type</span><p>${esc((book.fonts || []).filter(Boolean)[0] || 'Sans-serif')}</p>
          <span class="eyebrow">Headline</span><p>${esc(book.headline || ob.hook || '')}</p>
          ${book.say ? `<span class="eyebrow">What you say</span><p>${esc(book.say)}</p>` : ''}
          ${book.logo ? `<img class="ins-logo" src="${esc(book.logo)}" alt="${esc(S.brand && S.brand.name || 'Brand')} logo" referrerpolicy="no-referrer">` : ''}
          <span class="eyebrow">Avoid</span><p class="small">${esc(b.avoid || (S.brand && S.brand.avoid) || '')}</p></div>
      </div></section>`;
  }

  function icpCards(S, run) {
    const found = run.icps_ig || [];
    const mine = (S.onboarding && S.onboarding.icps) || [];
    const card = (i, src) => `<article class="ins-icp"><span class="caption">${esc(src)} · ${esc(i.role || 'buyer')}</span><h3>${esc(i.name)}</h3><p>${esc(i.who)}</p><p class="small muted"><strong>Pain:</strong> ${esc(i.pain)}</p><p class="small"><strong>Stops the scroll with:</strong> “${esc(i.hook)}”</p>${i.evidence ? `<blockquote class="ins-quote small">${esc(i.evidence)}</blockquote>` : ''}${(i.scroll || []).length ? `<p class="small muted">Spends time on ${esc((i.scroll || []).join(', '))}</p>` : ''}</article>`;
    return `<section class="panel ins-card" aria-labelledby="ins-icp"><div class="panel-head"><h2 id="ins-icp">Your buyers</h2><span class="caption">${found.length ? 'Read from your Instagram captions' : 'From onboarding'}</span></div>
      <div class="panel-body ins-icps">${found.length ? found.map(i => card(i, 'Instagram')).join('') : mine.map(i => card(i, 'Onboarding')).join('') || '<p class="muted small">No buyer profiles yet.</p>'}</div></section>`;
  }

  function analysis(run) {
    const s = run.synthesis;
    if (!s) return `<section class="panel ins-card"><div class="panel-body"><p class="muted small">The competitor analysis is not ready${run.error ? '' : ' yet'}.</p></div></section>`;
    const n = s.niche || {}, rec = n.recommended_angles || [], yt = s.you_vs_them || {};
    const comps = (s.competitors || []).map(c => `<article class="ins-comp"><h3>${esc(c.name)}</h3><p>${esc(c.whats_working)}</p>${(c.signature_hooks || []).length ? `<p class="small muted">Signature hooks: ${c.signature_hooks.map(esc).join(' · ')}</p>` : ''}<p class="small"><strong>Offer:</strong> ${esc(c.offer_strategy || 'none seen')}</p></article>`).join('');
    return `<section class="panel ins-card" aria-labelledby="ins-analysis"><div class="panel-head"><h2 id="ins-analysis">Competitive analysis</h2><span class="caption">Read from live Meta ads</span></div>
      <div class="panel-body">
        <div class="ins-grid2"><div>
          <span class="eyebrow">The open space</span><p class="ins-headline">${esc(n.headline_open || '')}</p><p>${esc(n.whitespace || '')}</p>
          <span class="eyebrow">Everyone leans on</span><ul class="ins-list">${(n.overused_angles || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
          <span class="eyebrow">Nobody does well</span><ul class="ins-list">${(n.underused_angles || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
        </div><div>
          <span class="eyebrow">Recommended angles</span>${rec.map(r => `<div class="ins-rec"><strong>${esc(r.angle)}</strong><p class="small">${esc(r.why)}</p></div>`).join('')}
          ${s.recommended_audience ? `<span class="eyebrow">Target this audience</span><p><strong>${esc(s.recommended_audience)}</strong></p>` : ''}
          ${yt.summary ? `<span class="eyebrow">You vs them</span><p>${esc(yt.summary)}</p><p class="small"><strong>Your gap:</strong> ${esc(yt.gap || '')}</p>` : ''}
        </div></div>
        <div class="ins-comps">${comps}</div>
      </div></section>`;
  }

  function adReads(run) {
    const groups = Object.entries(run.ads || {});
    if (!groups.length) return '';
    return `<section class="panel ins-card" aria-labelledby="ins-ads"><div class="panel-head"><h2 id="ins-ads">Competitor ads, each one read</h2><span class="caption">Strict page matching: nothing guessed</span></div>
      <div class="panel-body">${groups.map(([name, list]) => `<h3 class="ins-group">${esc(name)} · ${list.length} live ad${list.length === 1 ? '' : 's'}</h3>
        ${list.length ? `<div class="ins-ad-grid">${list.map(a => {
          const r = a.read || {};
          return `<article class="ins-ad">${a.image_url ? `<img src="${esc(a.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="ins-ad-noimg">No image</div>'}
            <div class="ins-ad-body"><span class="caption">${esc(a.display_format)} · ${a.days_running != null ? a.days_running + ' days running' : 'start date unknown'}${a.collation_count > 1 ? ' · ' + a.collation_count + ' variants' : ''}</span>
            <p class="small"><strong>Hook (${esc(r.hook?.type || '—')}):</strong> ${esc(r.hook?.line || a.headline || '')}</p>
            <p class="small"><strong>Angle:</strong> ${esc(r.angle || '—')}${r.secondary_angle ? ' · ' + esc(r.secondary_angle) : ''} · <strong>Audience:</strong> ${esc(r.audience || '—')}</p>
            ${r.why_it_works ? `<p class="small muted">${esc(r.why_it_works)}</p>` : ''}
            ${a.link_url ? '' : ''}${a.ad_library_url ? `<a class="small" href="${esc(a.ad_library_url)}" target="_blank" rel="noopener noreferrer">Open in the Ad Library ↗</a>` : ''}</div></article>`;
        }).join('')}</div>` : '<p class="muted small">No ads matched this name. Coldie does not guess a different page.</p>'}`).join('')}</div></section>`;
  }

  function newAds(S, run, I) {
    const vs = run.variants || [];
    if (!vs.length) return '';
    return `<section class="panel ins-card" aria-labelledby="ins-new"><div class="panel-head"><h2 id="ins-new">Three new ads for your products</h2><span class="caption">Each painted from your real product photo</span></div>
      <div class="panel-body ins-new">${vs.map((v, k) => `<article class="ins-newad">
        <div class="ins-newad-img">${I.images[k] ? `<img data-media-id="${esc(I.images[k])}" alt="${esc(v.headline)}" />` : `<div class="ins-ad-noimg">${v.paint_error ? 'Could not paint this one' : 'Painting…'}</div>`}</div>
        <div class="ins-newad-body"><span class="caption">${esc(v.angle)} · ${esc(v.product || 'your brand')}</span>
          <h3>${esc(v.headline)}</h3><p class="small">${esc(v.primary_text)}</p>
          <p class="small muted"><strong>Why this ad:</strong> ${esc(v.why_this_angle)}</p>
          ${v.inspired_by && v.inspired_by.competitor ? `<p class="small muted"><strong>Borrowed structure from ${esc(v.inspired_by.competitor)}:</strong> ${esc(v.inspired_by.what_we_borrowed)}</p>` : ''}
          <p class="small muted"><strong>For:</strong> ${esc(v.audience || '')} · <strong>CTA:</strong> ${esc(v.cta)}${v.claims_flagged && v.claims_flagged.length ? ` · <span class="warn-text">placeholder kept for: ${esc(v.claims_flagged.join(', '))}</span>` : ''}</p>
          ${v.verified === false ? `<p class="small warn-text"><strong>Check the label before you use this:</strong> ${esc(v.check_issues || 'the product may differ from the photo')}</p>` : ''}
          <div class="row"><a class="btn secondary" data-download="${k}" href="#" download="ad-${k + 1}.jpg">Download</a>${btnHtml('Send to Studio', 'ins-to-studio', k)}</div>
        </div></article>`).join('')}</div></section>`;
  }
  const btnHtml = (label, action, k) => `<button type="button" class="btn" data-action="${action}" data-k="${k}">${esc(label)}</button>`;

  function render(ctx) {
    const S = ctx.S, I = S.intel;
    if (!S.onboarding) return `<section class="panel panel-body"><span class="eyebrow">Insights</span><h2>Finish onboarding first</h2><p class="muted">Insights reads your brand, buyers and rivals once onboarding is done.</p></section>`;
    if (!I || !I.run) return `<section class="panel panel-body"><span class="eyebrow">Insights</span><h2>Not made yet</h2><p class="muted small">Insights are made during onboarding, at the last quest. Finish onboarding and they will appear here, in Ads and in AI studio.</p></section>`;
    const run = I.run;
    if (!I.done) return progressView(I);
    return `<div class="ins-page">${I.error ? `<p class="notice warn">${esc(I.error)}</p>` : ''}
      ${(run.log || []).some(l => l.kind === 'warn') ? `<details class="ins-notes"><summary>Notes from this run (${(run.log || []).filter(l => l.kind === 'warn').length})</summary><ul>${run.log.filter(l => l.kind === 'warn').map(l => `<li>${esc(l.text)}</li>`).join('')}</ul></details>` : ''}
      ${newAds(S, run, I)}${analysis(run)}${icpCards(S, run)}${brandBook(S, run)}${adReads(run)}</div>`;
  }

  async function afterRender() {}

  async function act(ctx, action, el) {
    const I = ctx.S.intel;
    if (action === 'ins-to-studio') {
      const k = Number(el.dataset.k), v = I.run.variants[k];
      const key = I.images[k];
      const body = [v.primary_text, v.headline && '— ' + v.headline, v.cta && '(' + v.cta + ')'].filter(Boolean).join('\n\n');
      ctx.createDraft({ platform: 'instagram', title: v.headline || v.angle, body, mediaKey: key });
    }
  }

  // Ads and AI studio results from the finished run. Each ad keeps its composed image in the media store.
  function applyAds(S, I) {
    const vs = I.run.variants || [], keys = I.images || [], at = String(I.at || '').slice(-6);
    const budget = (I.input && I.input.brand && I.input.brand.currency) === 'INR' || !I.input ? 500 : 8;
    S.ads = vs.map((v, k) => ({ id: 'ins-ad-' + (k + 1) + '-' + at, title: v.headline || v.angle, goal: [v.angle, v.product].filter(Boolean).join(' · '), budget, status: 'draft', photo: null, mediaId: keys[k] || null, icp: v.audience || '', product: v.product || '', source: 'insights', verified: v.verified === true, check: v.check_issues || null }));
    const made = vs.map((v, k) => ({ id: keys[k], prompt: v.creative_direction || v.headline || '', model: 'Insights · ' + (v.product || 'your product'), style: v.angle || 'product', aspect: '4:5', ms: null, at: I.at })).filter(g => g.id);
    S.generations = [...made, ...(S.generations || []).filter(g => !keys.includes(g.id))].slice(0, 24);
  }

  // Runs the analysis in the background of the workspace: reads, writes, composes the three ads from the real product photos,
  // then puts them in Ads and AI studio. Resumes from the saved run after a reload. Nothing is shown while it works.
  async function background(ctx) {
    const S = ctx.S;
    if (loopBusy || !S.onboarding) return;
    let h = null; try { h = JSON.parse(localStorage.getItem('coldstart.handoff.v1') || 'null'); } catch (_) { h = null; }
    if (!S.intel || S.intel.at !== (h && h.insights && h.insights.at)) {
      if (!h || !h.insights || !h.insights.input) return;
      S.intel = { at: h.insights.at, input: h.insights.input, run: null, images: [], done: false, imported: false, error: null };
      ctx.save();
    }
    const I = S.intel;
    if (I.imported) return;
    loopBusy = true;
    try {
      if (!I.run) { I.run = (await ctx.api(API + 'create', { method: 'POST', body: I.input })).run; ctx.save(); }
      for (let guard = 0; guard < 200 && I.run.stage !== 'done' && I.run.stage !== 'failed'; guard++) {
        const r = await ctx.api(API + 'step', { method: 'POST', body: { run: I.run } });
        I.run = r.run; ctx.save();
        if (r.done) break;
        await sleep(1200);
      }
      if (I.run.stage === 'failed') { I.error = I.run.error ? I.run.error.message : 'The analysis stopped.'; ctx.save(); return; }
      const kit = (I.input && I.input.kit) || {}, keys = [];
      const products = (I.input && I.input.products) || [];
      for (let k = 0; k < I.run.variants.length; k++) {
        const v = I.run.variants[k];
        const price = (products.find(p => p.name === v.product) || {}).price;
        const brandName = (I.input && I.input.brand && I.input.brand.name) || '';
        // the scene is generated from the real product photo, then the text is set around it
        const scene = await ctx.api(API + 'scene', { method: 'POST', body: { variant: v, product: { name: v.product, image: v.product_image }, brand: { name: brandName, tone_of_voice: I.run.brand && I.run.brand.tone_of_voice }, palette: { primary: kit.colors && kit.colors.primary, background: kit.colors && kit.colors.background, text: kit.colors && kit.colors.text } } });
        I.run.variants[k].verified = scene.verified; I.run.variants[k].check_issues = scene.issues; I.run.variants[k].scene_attempts = scene.attempts;
        const img = await window.AdCompose.composeScene(scene.image, { ...v, price }, { kit, brandName });
        const key = 'ins-' + String(I.at).slice(-6) + '-' + k;
        await window.AdCompose.putMedia(key, img); keys.push(key);
      }
      I.images = keys; I.done = true; I.imported = true;
      applyAds(S, I);
      ctx.save(); ctx.rerender();
      ctx.toast('Three new ads are ready in Ads and AI studio.');
    } catch (e) {
      I.error = e.message; ctx.save();
    } finally { loopBusy = false; }
  }

  window.Insights = { visit, loop, render, afterRender, act, inputFrom, background };
})();
