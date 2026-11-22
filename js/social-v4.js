/* Real social opportunities inside the existing Discover, Action Inbox and Calendar screens. No separate dashboard.
   Server is the source of truth: scans/opportunities (ops/socialScan), publish jobs and their states (ops/*Publish). */
(function () {
  const C = window.CS, esc = C.esc, S = () => C.S, $ = (s, r) => (r || document).querySelector(s);
  const toast = (m) => window.AppV4 && window.AppV4.toast ? window.AppV4.toast(m) : void 0;
  const st = () => (S().social || (S().social = { posts: [], lastScan: null }));
  const ID = () => crypto.randomUUID();
  const brand = () => { const b = S().brand || {}, f = S().flagship || {}; return { name: b.name || 'My brand', line: b.line || S().input.desc || '', category: (S().input.desc || '').slice(0, 60) || undefined, products: [f.name].filter(Boolean), keywords: [], tones: b.tones || [] }; };
  const market = () => ({ places: String(S().bounds.region || '').split(',').map((x) => x.trim()).filter(Boolean), countryCodes: S().bounds.country ? [S().bounds.country] : [] });
  const TL = { rising: 'Rising', steady: 'Steady', declining: 'Declining', insufficient_data: 'Not enough history' };

  function oppCard(o) {
    return `<article class="opp"><div class="tags"><span class="chip b">${o.platform === 'x' ? 'X' : 'Reddit'}</span><span class="chip ${o.gated ? 'warn' : 'y'}">${o.gated ? 'Assisted only' : esc(o.opportunity_type.replace('_', ' '))}</span><span class="chip dash">${esc(TL[o.trend.label])}</span><span class="chip dash">Location: ${esc(o.geo.basis)}</span><span class="chip ${o.confidence === 'high' ? 'b' : 'dash'}">${esc(o.confidence)} confidence</span></div>
      <h3>${esc(o.title || o.excerpt.slice(0, 70))}</h3><p>${esc(o.excerpt)}</p><p class="small muted">${esc(o.explanation)}</p>
      <p class="small mono muted">${o.manual ? 'Supplied by you' : 'Fetched ' + esc(o.fetched_at.slice(0, 16).replace('T', ' ')) + ' UTC'} · posted ${esc((o.posted_at || '').slice(0, 10))} · score ${o.score === null ? 'not scored (not allowed to post)' : o.score} · research cost ${o.cost_units && o.cost_units.usd ? '$' + o.cost_units.usd : 'not reported'}</p>
      <div class="row"><a class="btn sm ghost" href="${esc(o.source_url)}" target="_blank" rel="noopener noreferrer">Open evidence</a><button class="btn sm" data-sdraft="${esc(o.id)}" type="button">Draft ${o.opportunity_type === 'participate' ? 'a reply' : 'a post'}</button></div></article>`;
  }
  async function section(view) {
    const el = document.createElement('section'); el.id = 'social-sec'; el.setAttribute('aria-labelledby', 'so-h'); view.appendChild(el);
    if (!el.isConnected) return;
    let src = []; try { src = (await C.ops.get('socialSources')).sources; } catch (e) { /* offline */ }
    let opps = []; try { opps = (await C.ops.get('opportunities')).opportunities; } catch (e) { /* offline */ }
    const draw = (msg) => {
      if (!el.isConnected) return;
      el.innerHTML = `<div class="pagehead" style="margin-bottom:14px"><h2 class="disp s" id="so-h">Real conversations to join</h2><span class="muted small">From X and Reddit evidence only. Nothing here is invented, and each item links to its source.</span></div>
      <div class="tags" style="margin-bottom:10px">${src.map((s) => `<span class="chip ${s.state === 'ready' ? 'b' : 'warn'}" title="${esc(s.reason || '')}">${esc(s.platform === 'x' ? 'X' : 'Reddit')}: ${esc(s.state.replace('_', ' '))}</span>`).join('')}</div>
      ${src.filter((s) => s.state !== 'ready').map((s) => `<p class="small muted">${esc(s.platform === 'x' ? 'X' : 'Reddit')}: ${esc(s.reason)}</p>`).join('')}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button class="btn" id="so-scan" type="button">Find opportunities</button><button class="btn ghost" id="so-reddit" type="button">Add a Reddit thread I found</button></div>${msg ? `<div class="err" style="color:var(--ink)">${esc(msg)}</div>` : ''}
      <div class="opp-grid">${opps.length ? opps.map(oppCard).join('') : '<div class="empty"><strong>No opportunities yet.</strong><p>Run a scan once X access is connected, or add a Reddit thread you found yourself.</p></div>'}</div>`;
      $('#so-scan', el).onclick = scan; $('#so-reddit', el).onclick = redditDialog; el.querySelectorAll('[data-sdraft]').forEach((b) => b.onclick = () => draft(opps.find((o) => o.id === b.dataset.sdraft)));
    };
    async function scan() {
      const b = $('#so-scan', el); if (!b) return; b.disabled = true; b.textContent = 'Scanning…';
      try { const r = await C.ops.post('socialScan', { brand: brand(), market: market(), idempotencyKey: 'scan-' + ID() }); st().lastScan = { at: r.at, cost: r.cost, blocked: r.blocked }; C.save(); opps = (await C.ops.get('opportunities')).opportunities; draw(r.opportunities.length ? '' : (r.blocked[0] ? 'No scan ran: ' + r.blocked[0].reason : 'No matching conversations found.')); }
      catch (e) { draw(e.message); }
    }
    draw('');
  }
  function redditDialog() {
    const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Add a Reddit thread');
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Add a Reddit thread</h2></div><div class="dlg-b" style="display:grid;gap:10px"><p class="small muted">Reddit is in assisted mode. Cold Start does not fetch Reddit. Paste the link and the text you read, and I will help you write a reply you post yourself.</p>
      <label class="field"><span>Thread link</span><input id="rd-u" type="url" placeholder="https://www.reddit.com/r/…"></label><label class="field"><span>Title</span><input id="rd-t" type="text" maxlength="300"></label><label class="field"><span>What the post says</span><textarea id="rd-x" rows="5" maxlength="3000"></textarea></label><div id="rd-e"></div></div>
      <div class="dlg-f"><button class="btn ghost" id="rd-c" type="button">Cancel</button><button class="btn yellow" id="rd-s" type="button">Add</button></div>`;
    d.showModal(); $('#rd-c').onclick = () => d.close();
    $('#rd-s').onclick = async () => { try { await C.ops.post('importReddit', { url: $('#rd-u').value.trim(), title: $('#rd-t').value, text: $('#rd-x').value, brand: brand(), market: market() }); d.close(); window.AppV4.route(); } catch (e) { $('#rd-e').innerHTML = `<div class="err">${esc(e.message)}</div>`; } };
  }
  async function draft(o) {
    const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Draft'); d.innerHTML = '<div class="dlg-b"><p>Writing a draft…</p></div>'; d.showModal();
    let r; try { r = await C.ops.post('draftPost', { opportunityId: o.id, brand: brand() }); } catch (e) { d.innerHTML = `<div class="dlg-b"><div class="err">${esc(e.message)}</div></div><div class="dlg-f"><button class="btn" id="dd-c" type="button">Close</button></div>`; $('#dd-c').onclick = () => d.close(); return; }
    const dr = r.draft;
    d.innerHTML = `<div class="dlg-h"><h2 class="disp s">${dr.platform === 'x' ? 'X post' : 'Reddit reply'} · review and edit</h2><button class="btn sm ghost" id="dd-x" type="button">Close</button></div><div class="dlg-b" style="display:grid;gap:10px">
      <div class="tags"><span class="chip ${dr.mode === 'ai' ? 'b' : 'warn'}">${dr.mode === 'ai' ? 'AI draft' : 'Template, needs your edit'}</span><a class="chip dash" href="${esc(o.source_url)}" target="_blank" rel="noopener noreferrer">Source</a></div><p class="small muted">${esc(dr.note)}</p>
      <label class="field"><span>Text</span><textarea id="dd-t" rows="7">${esc(dr.text)}</textarea></label><small id="dd-n" class="muted"></small><div id="dd-i"></div>
      ${dr.platform === 'x' ? '<label class="field"><span>Publish at (optional, your local time)</span><input id="dd-w" type="datetime-local"></label>' : '<label class="field"><span>Paste the community rules (from the subreddit’s About page)</span><textarea id="dd-r" rows="4" maxlength="6000"></textarea></label><div><button class="btn sm ghost" id="dd-rc" type="button">Check against the rules</button></div><div id="dd-rv" aria-live="polite"></div><p class="small muted">Reddit: you post this yourself, only if the community’s rules allow it. This check reads only the rules you paste. It cannot see unwritten norms or moderator decisions.</p>'}<div id="dd-e"></div></div>
      <div class="dlg-f"><button class="btn ghost" id="dd-c" type="button">Cancel</button><button class="btn yellow" id="dd-s" type="button">Send to Action Inbox</button></div>`;
    const check = async () => { const t = $('#dd-t').value; $('#dd-n').textContent = t.length + ' characters'; const x = await C.ops.post('checkDraft', { platform: dr.platform, text: t, kind: dr.kind }).catch(() => ({ issues: [] })); $('#dd-i').innerHTML = x.issues.map((i) => `<div class="err" style="color:var(--ink)">${esc(i)}</div>`).join(''); return x.issues; };
    let rv = null; const rules = async () => { if (dr.platform !== 'reddit') return true; const x = await C.ops.post('redditAssess', { opportunityId: o.id, rulesText: $('#dd-r').value, draft: $('#dd-t').value }); rv = x.rules; const L = { blocked: ['err', 'Do not post this'], caution: ['err', 'Possible problems'], allowed_if_followed: ['', 'No conflict found in the rules you pasted'], unknown_rules: ['err', 'Rules not checked'] }[rv.verdict]; $('#dd-rv').innerHTML = `<div class="${L[0]}" style="color:var(--ink)"><strong>${L[1]}.</strong> ${esc(x.thread.why)} ${rv.reasons.map(esc).join(' ')} ${esc(rv.note || '')}</div>`; return rv.verdict === 'allowed_if_followed' || rv.verdict === 'caution'; };
    if ($('#dd-rc')) $('#dd-rc').onclick = rules;
    $('#dd-t').oninput = check; check(); $('#dd-x').onclick = $('#dd-c').onclick = () => d.close();
    $('#dd-s').onclick = async () => {
      const issues = await check(); if (issues.length || /\[Write|\[write/.test($('#dd-t').value)) { $('#dd-e').innerHTML = `<div class="err">${issues.length ? 'Fix the issues above first.' : 'Replace the placeholder text in [brackets] with your own words.'}</div>`; return; }
      if (dr.platform === 'reddit' && !(await rules())) { $('#dd-e').innerHTML = '<div class="err">Reddit drafts need a passing rules check first (paste the rules and check).</div>'; return; }
      const when = $('#dd-w') && $('#dd-w').value ? new Date($('#dd-w').value).toISOString() : undefined;
      try {
        const payload = { channel: dr.platform, text: $('#dd-t').value.trim(), ...(when ? { scheduledAt: when } : {}) };
        const { job } = await C.ops.post('createPublish', { payload, idempotencyKey: 'pub-' + ID() });
        st().posts.unshift({ id: job.id, hash: job.payloadHash, platform: dr.platform, text: payload.text, scheduledAt: when || null, sourceUrl: o.source_url, oppId: o.id });
        S().inbox = S().inbox || []; S().inbox.unshift({ id: 'sp-' + job.id, kind: 'post', title: (dr.platform === 'x' ? 'Post to X: ' : 'Reddit reply (you post it): ') + payload.text.slice(0, 60), sub: (when ? 'Scheduled ' + when.slice(0, 16).replace('T', ' ') + ' UTC. ' : 'No time set. ') + 'Nothing is sent until you approve and publish.', to: '#/calendar', jobId: job.id, hash: job.payloadHash });
        C.log('social', 'Draft sent to Action Inbox', { job: job.id, opportunity: o.id }); C.save(); d.close(); toast('In your Action Inbox for approval.'); location.hash = '#/inbox';
      } catch (e) { $('#dd-e').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
  }
  /** Called by the Action Inbox when the person approves a social post: binds the approval to the exact content hash on the server. */
  async function approve(it) { await C.ops.post('authorizePublish', { id: it.jobId, hash: it.hash }); C.log('approval', 'Approved social post ' + it.jobId, { hash: it.hash }); }

  const LAB = { requested: 'Waiting for your approval', authorized: 'Approved', queued: 'Queued', executing: 'Publishing…', verified: 'Verified', completed: 'Published', blocked: 'Held', failed: 'Failed', unknown_external_state: 'Needs your check', cancelled: 'Cancelled' };
  async function calendarSection(view) {
    const posts = st().posts; if (!posts.length) return;
    const el = document.createElement('section'); el.className = 'panel'; el.id = 'social-cal'; view.appendChild(el);
    let xManual = true; try { xManual = (await C.ops.get('integrations')).integrations.x.state !== 'ready'; } catch (e) { /* keep manual */ }
    const manual = (p) => p.platform === 'reddit' || (p.platform === 'x' && xManual);
    let jobs = {}; try { (await C.ops.get('publishJobs')).jobs.forEach((j) => { jobs[j.id] = j; }); } catch (e) { /* offline */ }
    el.innerHTML = `<div class="panel-h"><h2>Social posts</h2><span class="muted small">Status comes from the server. “Published” means the platform returned the post, or that you told us you posted it.</span></div>` + posts.map((p) => {
      const j = jobs[p.id], s = j ? j.state : 'unknown', auth = j && j.authorized, due = !p.scheduledAt || new Date(p.scheduledAt) <= new Date();
      const verif = j && j.state === 'completed' ? (j.verification === 'user_attested' ? 'Posted by you. Not verified by ' + (p.platform === 'x' ? 'X' : 'Reddit') + '.' : 'Read back from the platform.') : '';
      return `<div class="inbox-row" style="grid-template-columns:1fr auto"><div><strong>${p.platform === 'x' ? 'X' : 'Reddit'} · ${esc(p.text.slice(0, 80))}</strong><small>${p.scheduledAt ? 'Scheduled ' + esc(p.scheduledAt.slice(0, 16).replace('T', ' ')) + ' UTC' : 'No time set'} · <a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a></small>
        <div class="tags" style="margin-top:6px"><span class="chip ${s === 'completed' ? 'b' : s === 'failed' || s === 'blocked' || s === 'unknown_external_state' ? 'warn' : 'dash'}">${esc(LAB[s] || s)}</span>${verif ? `<span class="chip dash">${esc(verif)}</span>` : ''}${j && j.error ? `<span class="chip warn">${esc(j.error.message)}</span>` : ''}${j && j.url && s === 'completed' ? `<a class="chip dash" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">Open post</a>` : ''}${j && j.metrics && j.metrics.length ? `<span class="chip dash">${esc(JSON.stringify(j.metrics[j.metrics.length - 1]).slice(0, 80))}</span>` : ''}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${p.platform === 'x' && !xManual && auth && ['authorized', 'blocked', 'failed'].includes(s) ? `<button class="btn sm" data-sp-run="${p.id}" type="button" ${due ? '' : 'disabled title="Not due yet"'}>Publish now</button>` : ''}${manual(p) && auth && !['completed', 'cancelled'].includes(s) ? `${p.platform === 'x' ? `<a class="btn sm ghost" target="_blank" rel="noopener noreferrer" href="https://x.com/intent/post?text=${encodeURIComponent(p.text)}">Open X to post</a>` : ''}<button class="btn sm ghost" data-sp-copy="${p.id}" type="button">Copy text</button><button class="btn sm yellow" data-sp-man="${p.id}" type="button">I posted it</button>` : ''}${s === 'unknown_external_state' ? `<button class="btn sm ghost" data-sp-res="${p.id}" type="button">I checked the platform</button>` : ''}${s === 'completed' && p.platform === 'x' && j && j.verification !== 'user_attested' ? `<button class="btn sm ghost" data-sp-met="${p.id}" type="button">Refresh metrics</button>` : ''}${!['completed', 'cancelled', 'executing'].includes(s) ? `<button class="btn sm ghost" data-sp-can="${p.id}" type="button">Cancel</button>` : ''}</div></div>`;
    }).join('');
    const act = (sel, fn) => el.querySelectorAll(sel).forEach((b) => b.onclick = async () => { b.disabled = true; try { await fn(b); } catch (e) { toast(e.message); } window.AppV4.route(); });
    act('[data-sp-run]', async (b) => { const r = await C.ops.post('runPublish', { id: b.dataset.spRun }); toast(r.blocked ? 'Held: ' + r.blocked.reason : r.unknown ? 'Result unknown. Check the platform.' : r.job.state === 'completed' ? 'Published and confirmed.' : r.job.state === 'unknown_external_state' ? 'Accepted but not confirmed. Check the platform.' : 'Failed: ' + (r.job.error && r.job.error.message)); });
    act('[data-sp-copy]', async (b) => { await navigator.clipboard.writeText(posts.find((p) => p.id === b.dataset.spCopy).text); toast('Copied.'); });
    act('[data-sp-man]', async (b) => { const u = await askUrl(); if (u) { await C.ops.post('markManual', { id: b.dataset.spMan, url: u }); toast('Recorded as posted by you.'); } });
    act('[data-sp-can]', async (b) => { await C.ops.post('cancelPublish', { id: b.dataset.spCan }); });
    act('[data-sp-met]', async (b) => { const r = await C.ops.post('refreshMetrics', { id: b.dataset.spMet }); toast(r.metrics ? 'Metrics saved.' : r.note); });
    act('[data-sp-res]', async (b) => { const u = await askUrl('Paste the link if it is live, or leave empty if nothing was posted.', true); await C.ops.post('resolvePublish', u ? { id: b.dataset.spRes, outcome: 'published', externalId: new URL(u).pathname, url: u } : { id: b.dataset.spRes, outcome: 'not_published' }); });
  }
  function askUrl(msg = 'Paste the link to your post.', optional) {
    return new Promise((res) => { const d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Post link'); d.innerHTML = `<div class="dlg-h"><h2 class="disp s">${esc(msg)}</h2></div><div class="dlg-b"><label class="field"><span>Link</span><input id="au" type="url" placeholder="https://"></label><div id="au-e"></div></div><div class="dlg-f"><button class="btn ghost" id="au-c" type="button">Cancel</button><button class="btn yellow" id="au-s" type="button">Save</button></div>`; d.showModal(); $('#au-c').onclick = () => { d.close(); res(null); };
      $('#au-s').onclick = () => { const v = $('#au').value.trim(); if (!v && !optional) { $('#au-e').innerHTML = '<div class="err">Paste the link.</div>'; return; } d.close(); res(v || ''); }; });
  }
  window.Social = { section, calendarSection, approve };
})();
