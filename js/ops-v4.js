/* Coldstart v4 ops layer: header controls, Action Inbox, assistant drawer, command palette and the Settings hub
   (Brand, Connections, Automations, Usage, Team, Audit, Privacy, Notifications).
   Spec rules honoured here: approval-first, no silent scope expansion, nothing "connected" or "published" unless it is,
   every approval hashed and revocable, ad spend / AI cost / platform fees kept apart. */
(function () {
  const C = window.CS, esc = C.esc, $ = (s, r) => (r || document).querySelector(s);
  const S = () => C.S;
  const toast = (t) => (window.AppV4 ? window.AppV4.toast(t) : alert(t));
  const route = () => window.AppV4 && window.AppV4.route();
  const fmt = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const usd = (n) => (n == null ? 'cost not reported' : '$' + Number(n).toFixed(4));
  const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const FRESH_POLICY = () => ({ approval: 'each', allow: { draft: true, organic: false, paid: false, budget: false }, caps: { research: 20, credits: 40 }, paused: false });
  const fail = (e) => toast(e.message || 'Request failed');

  /* ---------- caps: used by research and studio before spending ---------- */
  function guard(kind) {
    const p = S().policy || (S().policy = FRESH_POLICY());
    if (p.paused) return 'All automation is paused. Resume it in Settings → Automations.';
    const today = new Date().toDateString(), month = new Date().toISOString().slice(0, 7);
    if (kind === 'research') { const n = (S().ledger || []).filter((l) => l.kind === 'Research scan' && new Date(l.at).toDateString() === today).length; if (p.caps.research && n >= p.caps.research) return 'Daily research cap reached (' + p.caps.research + '). Raise it in Settings → Automations.'; }
    if (kind === 'creative') { const n = (S().ledger || []).filter((l) => l.kind === 'Creative render' && l.at.slice(0, 7) === month).length; if (p.caps.credits && n >= p.caps.credits) return 'Monthly creative-credit cap reached (' + p.caps.credits + '). Raise it in Settings → Automations.'; }
    return '';
  }

  /* ---------- header ---------- */
  let popEl = null;
  function pop(anchor, html) {
    closePop(); popEl = document.createElement('div'); popEl.className = 'pop'; popEl.innerHTML = html; document.body.appendChild(popEl);
    const r = anchor.getBoundingClientRect(); popEl.style.top = r.bottom + 6 + 'px'; popEl.style.right = Math.max(8, innerWidth - r.right) + 'px';
    setTimeout(() => document.addEventListener('click', outside), 0); return popEl;
  }
  const outside = (e) => { if (popEl && !popEl.contains(e.target)) closePop(); };
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } document.removeEventListener('click', outside); }

  function refresh() {
    const open = (S().inbox || []).filter((i) => !(i.snoozeUntil && i.snoozeUntil > Date.now())).length;
    const b = $('#inbox-badge'); if (b) { b.textContent = open; b.hidden = !open; }
    const w = $('#ws-switch'); if (w) w.textContent = (S().brand && S().brand.name) || 'Your workspace';
    const ct = document.querySelector('[data-nav=home] .ct'); if (ct) ct.remove();
    const pa = $('#pause-flag'); if (pa) pa.hidden = !(S().policy && S().policy.paused);
  }
  function wireHeader() {
    $('#btn-search').onclick = openPalette;
    $('#btn-assist').onclick = () => (assistOpen() ? closeAssist() : openAssist());
    $('#btn-add').onclick = (e) => { const el = pop(e.currentTarget, '<a href="#/campaigns/library">Add a product</a><a href="#/campaigns/studio">Create a creative</a><button data-a type="button">Ask Cold Start…</button>'); el.querySelector('[data-a]').onclick = () => { closePop(); openAssist(); }; el.querySelectorAll('a').forEach((a) => a.addEventListener('click', closePop)); };
    $('#btn-bell').onclick = (e) => { const ev = (S().audit || []).slice(0, 5); pop(e.currentTarget, `<div class="pop-h">Notifications</div>${ev.map((x) => `<div class="pop-r"><b>${esc(x.text)}</b><small>${fmt(x.at)}</small></div>`).join('') || '<div class="pop-r">Nothing yet.</div>'}<a href="#/settings/audit" class="pop-f">Open activity log</a>`); };
    $('#ws-switch').onclick = (e) => pop(e.currentTarget, `<div class="pop-h">Workspace</div><div class="pop-r"><b>${esc((S().brand && S().brand.name) || 'Your workspace')}</b><small>Owner · this browser</small></div><div class="pop-r"><small>Only one workspace per browser in this build.</small></div><a href="onboarding-v4.html" class="pop-f">Start another business setup</a>`);
    $('#btn-pause').onclick = () => { setPause(true); };
    syncPolicy();
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } if (e.key === 'Escape') { closePop(); closeAssist(); } });
  }
  async function syncPolicy() { try { const p = (await C.ops.get('policy')).policy; S().policy = Object.assign(S().policy || FRESH_POLICY(), p); C.save(); refresh(); return p; } catch (e) { return null; } }
  async function setPause(v) {
    try { await C.ops.post('setPolicy', { paused: v }); } catch (e) { return toast('Could not change the pause state: ' + e.message); }
    S().policy.paused = v; C.log('policy', v ? 'All automation paused' : 'Automation resumed', { paused: v }); C.save();
    toast(v ? 'Paused. The server will refuse new generations, research and launches.' : 'Resumed.'); refresh(); if (/settings/.test(location.hash)) route();
  }

  /* ---------- command palette ---------- */
  function openPalette() {
    const cmds = [['Go to Home', '#/home'], ['Go to Discover', '#/discover'], ['Go to Campaigns', '#/campaigns'], ['Go to Calendar', '#/calendar'], ['Go to Results', '#/results'], ['Open Action Inbox', '#/inbox'], ['Open Creative Studio', '#/campaigns/studio'], ['Open Product Library', '#/campaigns/library'], ['Settings: Brand', '#/settings/brand'], ['Settings: Connections', '#/settings/connections'], ['Settings: Automations and limits', '#/settings/automations'], ['Settings: Usage', '#/settings/usage'], ['Settings: Activity log', '#/settings/audit'], ['Ask Cold Start…', 'assist'], ['Pause all automation', 'pause']];
    const d = document.getElementById('pal');
    d.innerHTML = `<div class="dlg-b"><input id="pal-q" type="text" placeholder="Search pages and actions" aria-label="Search" autocomplete="off"><div id="pal-l" class="pal-l"></div></div>`;
    const list = (q) => { const m = cmds.filter((c) => c[0].toLowerCase().includes(q.toLowerCase())); $('#pal-l').innerHTML = m.map((c, i) => `<button type="button" data-i="${cmds.indexOf(c)}" class="${i === 0 ? 'on' : ''}">${esc(c[0])}</button>`).join('') || '<div class="small muted" style="padding:10px">No match.</div>'; };
    const run = (i) => { const c = cmds[i]; d.close(); if (c[1] === 'assist') openAssist(); else if (c[1] === 'pause') setPause(true); else location.hash = c[1]; };
    list(''); d.showModal(); $('#pal-q').focus();
    $('#pal-q').oninput = (e) => list(e.target.value);
    $('#pal-q').onkeydown = (e) => { if (e.key === 'Enter') { const f = $('#pal-l button'); if (f) run(+f.dataset.i); } };
    $('#pal-l').onclick = (e) => { const b = e.target.closest('button'); if (b) run(+b.dataset.i); };
  }

  /* ---------- assistant drawer ---------- */
  const assistOpen = () => !!$('#assist');
  function openAssist() {
    if (assistOpen()) { const i = $('#assist .cmp-input'); i && i.focus(); return; }
    const el = document.createElement('aside'); el.id = 'assist'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Cold Start assistant');
    el.innerHTML = `<div class="drawer-h"><div><span class="eyebrow">Assistant</span><h2 class="disp s">Tell me what to change</h2></div><button class="btn sm ghost" id="as-x" type="button">Close</button></div>
      <div class="drawer-b" style="gap:14px"><p class="small muted">I can prepare changes to your region, channels, ad cap and tone. I show exactly what changes first, and I never publish, spend or connect anything on my own.</p>${window.AppV4.composer()}</div>`;
    document.body.appendChild(el); window.AppV4.bindComposer(el); $('#as-x').onclick = closeAssist; const i = $('#assist .cmp-input'); i && i.focus();
  }
  function closeAssist() { const el = $('#assist'); if (el) el.remove(); }

  /* ---------- Action Inbox (S13) ---------- */
  let fType = 'all', fStatus = 'open', sel = new Set();
  const TYPE = { approval: 'Approval', review: 'Creative review', confirm: 'Confirm', post: 'Social post' };
  function inbox(view) {
    const all = S().inbox || [], now = Date.now();
    const items = all.filter((i) => (fType === 'all' || i.kind === fType) && (fStatus === 'all' || (fStatus === 'snoozed' ? i.snoozeUntil > now : !(i.snoozeUntil > now))));
    view.innerHTML = `<div class="pagehead"><div><span class="eyebrow">Action Inbox</span><h1 class="disp">Everything that needs <b>your yes.</b></h1><p class="muted">Each item states what it does, what it costs and what it can touch. Nothing runs until you approve it.</p></div></div>
    <div class="filters"><select id="f-type" aria-label="Type"><option value="all">All types</option>${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${fType === k ? 'selected' : ''}>${v}</option>`).join('')}</select><select id="f-status" aria-label="Status"><option value="open" ${fStatus === 'open' ? 'selected' : ''}>Open</option><option value="snoozed" ${fStatus === 'snoozed' ? 'selected' : ''}>Snoozed</option><option value="all" ${fStatus === 'all' ? 'selected' : ''}>All</option></select>
      <button class="btn sm ghost" id="bulk" type="button" ${sel.size ? '' : 'disabled'}>Bulk approve (${sel.size})</button><a class="link" href="#/settings/audit">View history</a></div>
    <section class="panel">${items.length ? items.map((i) => `<div class="inbox-row" style="grid-template-columns:auto auto 1fr auto"><input type="checkbox" data-sel="${esc(i.id)}" aria-label="Select" ${sel.has(i.id) ? 'checked' : ''}><i class="dot ${i.kind === 'approval' ? 'y' : ''}"></i>
      <div><strong>${esc(i.title)}</strong><small>${esc(i.sub)}</small><div class="tags" style="margin-top:6px"><span class="chip dash">${TYPE[i.kind] || i.kind}</span><span class="chip ${i.kind === 'approval' ? 'warn' : 'dash'}">${i.kind === 'approval' ? 'High impact: review individually' : 'Low risk'}</span>${i.snoozeUntil > now ? '<span class="chip">Snoozed</span>' : ''}</div>${i.note ? `<small class="mono">Changes requested: ${esc(i.note)}</small>` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><a class="btn sm" href="${esc(i.to)}">Review</a>${i.kind === 'approval' ? '' : `<button class="btn sm ghost" data-ok="${esc(i.id)}" type="button">Approve</button>`}<button class="btn sm ghost" data-chg="${esc(i.id)}" type="button">Request changes</button><button class="btn sm ghost" data-no="${esc(i.id)}" type="button">Reject</button><button class="btn sm ghost" data-snz="${esc(i.id)}" type="button">Snooze</button></div></div>`).join('') : '<div class="empty"><strong>Inbox is clear.</strong><p>Approvals, creative checks and confirmations land here so you never have to hunt for them.</p></div>'}</section>`;
    $('#f-type').onchange = (e) => { fType = e.target.value; inbox(view); }; $('#f-status').onchange = (e) => { fStatus = e.target.value; inbox(view); };
    const act = (id, fn, msg, type) => { const it = S().inbox.find((x) => x.id === id); if (!it) return; fn(it); C.log('inbox', msg + ': ' + it.title, { item: id, kind: it.kind, decision: type }); C.save(); sel.delete(id); route(); };
    view.querySelectorAll('[data-sel]').forEach((c) => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); inbox(view); });
    view.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => { const it = S().inbox.find((x) => x.id === b.dataset.ok); if (it && it.kind === 'post') { try { await window.Social.approve(it); } catch (e) { return toast(e.message); } } act(b.dataset.ok, (it2) => { S().inbox = S().inbox.filter((x) => x !== it2); }, 'Approved', 'approve'); });
    view.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => act(b.dataset.no, (it) => { S().inbox = S().inbox.filter((x) => x !== it); }, 'Rejected', 'reject'));
    view.querySelectorAll('[data-snz]').forEach((b) => b.onclick = () => act(b.dataset.snz, (it) => { it.snoozeUntil = Date.now() + 864e5; }, 'Snoozed 24 h', 'snooze'));
    view.querySelectorAll('[data-chg]').forEach((b) => b.onclick = () => {
      const it = S().inbox.find((x) => x.id === b.dataset.chg), d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Request changes');
      d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Request changes</h2></div><div class="dlg-b" style="display:grid;gap:10px"><p class="small">${esc(it.title)}</p><label class="field"><span>What should change?</span><textarea id="rc-n" rows="4" maxlength="200" placeholder="e.g. Lower the budget cap, remove the Reddit post"></textarea></label><div id="rc-e"></div></div><div class="dlg-f"><button class="btn ghost" id="rc-x" type="button">Cancel</button><button class="btn" id="rc-s" type="button">Send request</button></div>`;
      d.showModal(); $('#rc-n').focus(); $('#rc-x').onclick = () => d.close();
      $('#rc-s').onclick = () => { const n = $('#rc-n').value.trim(); if (n.length < 3) { $('#rc-e').innerHTML = '<div class="err">Say what should change (at least a few words).</div>'; return; } d.close(); act(b.dataset.chg, (x) => { x.note = n.slice(0, 200); }, 'Requested changes', 'changes'); };
    });
    $('#bulk').onclick = () => { const picked = [...sel].map((id) => S().inbox.find((x) => x.id === id)).filter(Boolean); if (picked.some((i) => i.kind === 'approval')) return toast('Approvals can’t be bulk approved. Review each one.'); picked.forEach((i) => C.log('inbox', 'Bulk approved: ' + i.title, { item: i.id })); S().inbox = S().inbox.filter((i) => !sel.has(i.id)); sel.clear(); C.save(); route(); };
  }

  /* ---------- Settings hub ---------- */
  const TABS = [['brand', 'Brand & voice'], ['connections', 'Connections'], ['automations', 'Automations & limits'], ['usage', 'Plan & usage'], ['team', 'Team'], ['audit', 'Activity & approvals'], ['notifications', 'Notifications'], ['privacy', 'Privacy & data']];
  function settings(view, tab) {
    tab = TABS.some((t) => t[0] === tab) ? tab : 'brand';
    view.innerHTML = `<div class="pagehead"><div><span class="eyebrow">Settings</span><h1 class="disp">Control what Cold Start <b>can do.</b></h1></div></div>
      <div class="set-layout"><nav class="set-nav" aria-label="Settings">${TABS.map((t) => `<a href="#/settings/${t[0]}" ${t[0] === tab ? 'aria-current="page"' : ''}>${t[1]}</a>`).join('')}</nav><div id="set-body" class="stack"></div></div>`;
    ({ brand, connections, automations, usage, team, audit, notifications, privacy })[tab]($('#set-body'));
  }

  function brand(el) {
    const b = S().brand || {}, hist = S().brandVersions || [];
    el.innerHTML = `<section class="panel"><div class="panel-h"><h2>Brand DNA</h2><span class="chip dash">Applies to future drafts, never to published items</span></div><div class="panel-b" style="display:grid;gap:14px">
      <div class="cols2"><label class="field"><span>Brand name</span><input id="b-name" type="text" value="${esc(b.name || '')}"></label><label class="field"><span>Website</span><input id="b-url" type="text" value="${esc(S().input.site || '')}"></label></div>
      <label class="field"><span>Positioning · what you sell, and to whom</span><textarea id="b-line">${esc(b.line || '')}</textarea></label>
      <div class="cols2"><label class="field"><span>Allowed claims (one per line)</span><textarea id="b-allow">${esc((b.allow || []).join('\n'))}</textarea></label><label class="field"><span>Prohibited claims / words (one per line)</span><textarea id="b-avoid">${esc((b.dont || []).join('\n'))}</textarea></label></div>
      <div class="cols2"><label class="field"><span>Languages</span><input id="b-lang" type="text" value="${esc(b.languages || 'English')}"></label><label class="field"><span>Tone notes</span><input id="b-tone" type="text" value="${esc(b.toneNote || '')}" placeholder="less promotional, more playful"></label></div>
      <div class="fact-row" style="border:0;padding:0"><span>Colours</span><span>${(b.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map((c) => `<i class="sw-dot" style="background:${esc(c)}" title="${esc(c)}"></i>`).join('') || 'None read'}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="b-save" type="button">Save changes</button>${hist.length ? '<button class="btn ghost" id="b-rev" type="button">Revert to previous version</button>' : ''}</div><small class="muted">${hist.length} earlier version${hist.length === 1 ? '' : 's'} kept.</small></div></section>`;
    $('#b-save').onclick = () => {
      const S_ = S(); (S_.brandVersions = S_.brandVersions || []).unshift({ at: new Date().toISOString(), brand: JSON.parse(JSON.stringify(S_.brand || {})), site: S_.input.site });
      const lines = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
      Object.assign(S_.brand, { name: $('#b-name').value.trim(), line: $('#b-line').value.trim(), allow: lines('#b-allow'), dont: lines('#b-avoid'), languages: $('#b-lang').value.trim(), toneNote: $('#b-tone').value.trim() }); S_.input.site = $('#b-url').value.trim();
      C.log('brand', 'Brand settings changed', { name: S_.brand.name, prohibited: S_.brand.dont }); C.save(); C.writeHandoff(); toast('Saved. Future drafts will use this.'); refresh(); settings($('#view'), 'brand');
    };
    const rv = $('#b-rev'); if (rv) rv.onclick = () => { const v = S().brandVersions.shift(); S().brand = v.brand; S().input.site = v.site; C.log('brand', 'Reverted brand to version from ' + fmt(v.at), null); C.save(); toast('Reverted.'); settings($('#view'), 'brand'); };
  }

  const CONNS = [
    ['Meta ads', 'Ad account + Facebook Page', { read: 1, draft: 1, publish: 0, ads: 0 }, ['ads_read', 'ads_management', 'business_management', 'pages_read_engagement'], 'Marketing API access and Meta review decide what can run. This build only creates paused drafts.', 'meta'],
    ['Instagram', 'Professional account linked to a Page', { read: 1, draft: 1, publish: 0, ads: 0 }, ['instagram_basic', 'instagram_content_publish'], 'Publishing needs an eligible professional account. Connects through Meta.', 'meta'],
    ['Facebook Page', 'Page you admin', { read: 1, draft: 1, publish: 0, ads: 0 }, ['pages_manage_posts', 'pages_read_engagement'], 'Used for organic posts and ad identity. Connects through Meta.', 'meta'],
    ['X', 'Posting handle', { read: 1, draft: 1, publish: 0, ads: 0 }, ['tweet.write', 'tweet.read', 'users.read'], 'Pay-per-use API: about $0.015 a post, $0.20 with a link. Publishing from this app is not enabled yet.', 'x'],
    ['Reddit', 'Assisted only', { read: 1, draft: 1, publish: 0, ads: 0 }, [], 'Commercial API access needs Reddit’s approval. Research and copy-for-manual-posting only. Not automation.', 'reddit']
  ];
  async function connections(el) {
    el.innerHTML = '<div class="panel"><div class="panel-b">Checking connections…</div></div>';
    let plugins = [];
    try { plugins = (await (await fetch('/api/plugins')).json()).plugins; } catch (e) { el.innerHTML = '<div class="err">Could not read connection status: ' + esc(e.message) + '</div>'; return; }
    const by = Object.fromEntries(plugins.map((p) => [p.id, p]));
    const yes = (v) => `<span class="chip ${v ? 'b' : 'dash'}">${v ? 'Yes' : 'No'}</span>`;
    const state = (c) => { const p = by[c[5]]; if (c[0] === 'Reddit') return '<span class="chip y">Assisted</span>'; if (!p || !p.connection) return `<span class="chip warn">Not connected</span>`; return p.connection.mode === 'sandbox' ? '<span class="chip y">Sandbox · simulated</span>' : `<span class="chip b">Connected · ${esc((p.connection.account || {}).name || '')}</span>`; };
    const cap = (c, i) => { const p = by[c[5]], live = p && p.connection && p.connection.mode === 'live'; return c[0] === 'Reddit' ? c[2] : { read: live && c[2].read, draft: c[2].draft, publish: false, ads: false }; };
    const rows = CONNS.map((c) => [...c]);
    el.innerHTML = `<section class="panel"><div class="panel-h"><h2>Connections</h2><span class="muted small">Never asks for passwords or card details. Meta holds ad payment.</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Account</th><th>Status</th><th>Read</th><th>Draft</th><th>Publish</th><th>Manage ads</th><th></th></tr></thead><tbody>
      ${rows.map((c, i) => { const k = cap(c, i), p = by[c[5]], conn = p && p.connection; return `<tr><td><strong>${c[0]}</strong><br><small class="muted">${c[1]}</small></td><td>${state(c)}${p && p.mode === 'sandbox' && c[0] !== 'Reddit' ? '<br><small class="muted">App credentials not configured on the server: ' + esc((p.missingEnv || []).join(', ')) + '</small>' : ''}</td><td>${yes(k.read)}</td><td>${yes(k.draft)}</td><td>${yes(k.publish)}</td><td>${yes(k.ads)}</td><td style="white-space:nowrap"><button class="btn sm ghost" data-perm="${i}" type="button">View permissions</button> ${c[0] === 'Reddit' ? '<a class="btn sm" href="#/discover">Open research</a>' : conn ? `<button class="btn sm ghost" data-disc="${c[5]}" type="button">Disconnect</button>` : `<a class="btn sm" href="/api/plugins/${c[5]}/connect">${p && p.mode === 'live' ? 'Connect' : 'Connect (sandbox)'}</a>`}</td></tr>`; }).join('')}</tbody></table></div></section>
      <section class="panel"><div class="panel-h"><h2>Tracking and events</h2><a class="btn sm" href="app-v3.html#/tracking">Open tracking wizard</a></div><div class="panel-b"><p class="small">Status: <span class="chip warn">Unverified</span> A conversion event stays unverified until a real signal arrives. Automatic installation is not promised for every site.</p></div></section>
      <p class="small muted">A sandbox connection is a simulator: launches against it are labelled “Simulated” and nothing reaches Meta, X or Facebook. Real OAuth needs production app keys and platform review.</p>`;
    el.querySelectorAll('[data-disc]').forEach((b) => b.onclick = async () => { try { await fetch(`/api/plugins/${b.dataset.disc}/disconnect`, { method: 'POST', headers: { 'x-coldstart': '1', 'content-type': 'application/json' }, body: '{}' }); C.log('connection', 'Disconnected ' + b.dataset.disc, null); toast('Disconnected.'); connections(el); } catch (e) { fail(e); } });
    el.querySelectorAll('[data-perm]').forEach((b) => b.onclick = () => { const c = CONNS[+b.dataset.perm], d = document.getElementById('dlg'); d.setAttribute('aria-label', c[0] + ' permissions'); d.innerHTML = `<div class="dlg-h"><h2 class="disp s">${c[0]} permissions</h2><button class="btn sm ghost" id="dx" type="button">Close</button></div><div class="dlg-b"><p class="small">${esc(c[4])}</p>${c[3].length ? '<span class="eyebrow">Would be requested</span><div class="tags">' + c[3].map((p) => `<span class="chip dash">${p}</span>`).join('') + '</div>' : '<p class="small">No permissions: Reddit stays manual.</p>'}<p class="small muted">You can revoke access at any time, and drafts stay if a connection fails.</p></div>`; d.showModal(); $('#dx').onclick = () => d.close(); });
  }

  const ACTIONS = [['draft', 'Prepare drafts and plans', 'Always on. Drafts never leave Cold Start.', true], ['organic', 'Publish approved organic posts', 'Facebook, Instagram, X after you approve each one.', false], ['paid', 'Launch approved paid ads', 'Creates or activates a Meta campaign after approval.', false], ['budget', 'Change ad budgets', 'Raising spend is never automatic.', false]];
  async function automations(el) {
    let p; try { p = (await C.ops.get('policy')).policy; } catch (e) { el.innerHTML = '<div class="err">Could not read the server policy: ' + esc(e.message) + '</div>'; return; }
    if (!el.isConnected) return; S().policy = Object.assign(S().policy || FRESH_POLICY(), p); C.save(); refresh();
    el.innerHTML = `<section class="panel"><div class="panel-h"><h2>Automation status</h2><span class="chip ${p.paused ? 'warn' : 'b'}">${p.paused ? 'Paused' : 'Active'}</span></div><div class="panel-b" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn ${p.paused ? '' : 'yellow'}" id="pz" type="button">${p.paused ? 'Resume automation' : 'Pause all automation'}</button><small class="muted">Enforced by the server: while paused it refuses new research, image generation and launches. Content that already exists at a platform is not touched.</small></div></section>
      <section class="panel"><div class="panel-h"><h2>Allowed actions</h2></div>${ACTIONS.map((a) => `<label class="check-row" style="grid-template-columns:28px 1fr auto"><input type="checkbox" data-act="${a[0]}" ${p.allow[a[0]] ? 'checked' : ''} ${a[3] ? 'disabled' : ''}><span><strong>${a[1]}</strong><br><small class="muted">${a[2]}</small></span><span class="chip ${p.allow[a[0]] ? 'y' : 'dash'}">${p.allow[a[0]] ? 'Allowed' : 'Off'}</span></label>`).join('')}
        <div class="panel-b"><div class="fact-row" style="border:0;padding:0"><span>Approval policy</span><span>Approve before publish. Locked: every post, ad and budget increase needs your yes.</span></div><small class="muted">Switching an action on records consent only. Nothing can publish or spend until the account is connected and each item is approved.</small></div></section>
      <section class="panel"><div class="panel-h"><h2>Limits (enforced on the server)</h2></div><div class="panel-b cols2"><label class="field"><span>Research scans per day</span><input id="cap-r" type="number" min="0" max="1000" value="${p.caps.research}"></label><label class="field"><span>Creative renders per month</span><input id="cap-c" type="number" min="0" max="5000" value="${p.caps.credits}"></label></div>
        <div class="panel-b" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="cap-save" type="button">Save limits</button><button class="btn ghost" id="reset" type="button">Reset to safe defaults</button></div><small class="panel-b muted" style="display:block">Ad spend is capped per campaign in the launch review. No ad spend can happen in this build.</small></section>`;
    $('#pz').onclick = () => setPause(!p.paused);
    el.querySelectorAll('[data-act]').forEach((c) => c.onchange = async () => {
      const k = c.dataset.act, to = c.checked;
      if (!to) { try { await C.ops.post('setPolicy', { allow: { [k]: false } }); C.log('policy', 'Narrowed scope: ' + k + ' off', null); } catch (e) { fail(e); } return automations(el); }
      c.checked = false; const a = ACTIONS.find((x) => x[0] === k), d = document.getElementById('dlg'); d.setAttribute('aria-label', 'Expand scope');
      d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Expand what Cold Start can do?</h2></div><div class="dlg-b"><div class="diff"><strong>Scope change</strong><div><del>${esc(a[1])}: off</del> → <ins>${esc(a[1])}: allowed</ins></div></div><p class="small">${esc(a[2])} Every item still needs your approval, and nothing can run until the account is connected. This needs your fresh, explicit consent.</p></div><div class="dlg-f"><button class="btn ghost" id="no" type="button">Keep off</button><button class="btn yellow" id="yes" type="button">I consent</button></div>`;
      d.showModal(); $('#no').onclick = () => d.close(); $('#yes').onclick = async () => { try { await C.ops.post('setPolicy', { allow: { [k]: true } }); C.log('policy', 'Expanded scope with consent: ' + k + ' allowed', null); } catch (e) { fail(e); } d.close(); automations(el); };
    });
    $('#cap-save').onclick = async () => { try { await C.ops.post('setPolicy', { caps: { research: Number($('#cap-r').value), credits: Number($('#cap-c').value) } }); C.log('policy', 'Limits changed', null); toast('Limits saved on the server.'); } catch (e) { fail(e); } };
    $('#reset').onclick = async () => { try { await C.ops.post('resetPolicy', {}); C.log('policy', 'Reset to safe defaults', null); toast('Safe defaults restored.'); automations(el); } catch (e) { fail(e); } };
  }

  async function usage(el) {
    let u; try { u = await C.ops.get('usage'); } catch (e) { el.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; return; }
    const L = S().ledger || [];
    el.innerHTML = `<div class="cols3"><div class="kpi" style="border:2px solid var(--ink);background:#fff"><span class="eyebrow">Cold Start fee</span><strong>–</strong><small class="muted">${esc(u.subscription.note)}</small></div><div class="kpi" style="border:2px solid var(--ink);background:#fff"><span class="eyebrow">Ad spend</span><strong>$${u.adSpend.usd}</strong><small class="muted">${esc(u.adSpend.note)}</small></div><div class="kpi" style="border:2px solid var(--ink);background:#fff"><span class="eyebrow">AI and API cost</span><strong>${u.aiApiCost.reportedFor ? '$' + u.aiApiCost.usd.toFixed(3) : 'not reported'}</strong><small class="muted">${u.aiApiCost.unreported ? u.aiApiCost.unreported + ' render(s) with no cost from the provider' : 'as reported by providers'}</small></div></div>
      <section class="panel"><div class="panel-h"><h2>Against your limits (server counts)</h2></div><div class="panel-b"><div class="fact-row"><span>Research scans today</span><span>${u.used.researchToday} / ${u.caps.research || 'off'}</span></div><div class="fact-row"><span>Creative renders this month</span><span>${u.used.creativeMonth} / ${u.caps.credits || 'off'}</span></div><small class="muted">The three buckets are never added together. No spend forecast is shown: there is not enough history to estimate honestly.</small></div></section>
      <section class="panel"><div class="panel-h"><h2>This browser’s activity ledger</h2><button class="btn sm ghost" id="ex-u" type="button" ${L.length ? '' : 'disabled'}>Export CSV</button></div>${L.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Type</th><th>Detail</th><th>Cost</th></tr></thead><tbody>${L.slice(0, 50).map((l) => `<tr><td>${fmt(l.at)}</td><td>${esc(l.kind)}</td><td>${esc(l.note || '')}</td><td>${usd(l.usd)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No usage yet.</div>'}</section>`;
    const x = $('#ex-u'); if (x) x.onclick = () => download('coldstart-usage.csv', 'at,type,note,usd\n' + L.map((l) => [l.at, l.kind, '"' + (l.note || '').replace(/"/g, '""') + '"', l.usd == null ? '' : l.usd].join(',')).join('\n'), 'text/csv');
  }

  function team(el) {
    el.innerHTML = `<section class="panel"><div class="panel-h"><h2>Members</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Person</th><th>Role</th><th>Approval rights</th></tr></thead><tbody><tr><td><strong>You</strong></td><td><span class="chip b">Owner</span></td><td>All approvals</td></tr></tbody></table></div></section>
      <section class="panel"><div class="panel-h"><h2>Invite someone</h2><span class="chip dash">Not available yet</span></div><div class="panel-b" style="display:grid;gap:12px"><div class="cols2"><label class="field"><span>Email</span><input type="text" disabled placeholder="teammate@company.com"></label><label class="field"><span>Role</span><select disabled><option>Editor</option></select></label></div><button class="btn" disabled>Invite</button><small class="muted">Inviting people needs sign-in and a server-side account system. This build stores one workspace in this browser, so it can’t honestly send or accept invites.</small></div></section>
      <section class="panel"><div class="panel-h"><h2>Roles</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Role</th><th>Can do</th></tr></thead><tbody><tr><td>Owner</td><td>Everything, including billing, ownership transfer and deletion</td></tr><tr><td>Admin</td><td>Settings, connections, approvals</td></tr><tr><td>Editor</td><td>Create drafts and creatives. Approve only if granted</td></tr><tr><td>Viewer</td><td>Read only</td></tr></tbody></table></div></section>`;
  }

  let aq = '', at = 'all';
  function audit(el) {
    const ev = (S().audit || []).filter((e) => (at === 'all' || e.type === at) && (!aq || (e.text + e.id).toLowerCase().includes(aq.toLowerCase())));
    const types = [...new Set((S().audit || []).map((e) => e.type))];
    el.innerHTML = `<section class="panel"><div class="panel-h"><h2>Approvals</h2><span class="muted small">Each is bound to the exact payload by a hash, checked by the server</span></div>${(S().approvals || []).length ? (S().approvals || []).map((a) => `<div class="inbox-row" style="grid-template-columns:1fr auto"><div><strong>${esc(a.action)}</strong><small>${esc(a.actor)} · ${fmt(a.at)} · scope: ${esc((a.scope.channels || []).join(', '))}, publish ${a.scope.publish ? 'yes' : 'no'}, spend ${esc(String(a.scope.spend))}</small><small class="mono" style="word-break:break-all">sha256 ${esc(a.hash)}</small></div>${a.revoked || ['invalidated', 'revoked'].includes(a.status) ? `<span class="chip warn">${a.status === 'invalidated' ? 'Voided: content changed' : 'Revoked'}</span>` : `<button class="btn sm ghost" data-rev="${a.id}" type="button">Revoke</button>`}</div>`).join('') : '<div class="empty">No approvals yet.</div>'}</section>
      <section class="panel"><div class="panel-h"><h2>Activity log</h2><button class="btn sm ghost" id="ex-a" type="button">Export log</button></div><div class="panel-b" style="display:flex;gap:8px;flex-wrap:wrap"><input id="aq" type="text" placeholder="Search or event ID" value="${esc(aq)}" style="max-width:260px"><select id="at" style="width:auto"><option value="all">All types</option>${types.map((t) => `<option ${t === at ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      ${ev.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Type</th><th>Action</th><th>Hash</th><th></th></tr></thead><tbody>${ev.slice(0, 80).map((e) => `<tr><td>${fmt(e.at)}</td><td>${esc(e.type)}</td><td>${esc(e.text)}<br><small class="muted mono">${e.id}</small></td><td class="mono small">${esc((e.hash || '').slice(0, 10))}</td><td>${e.payload ? `<button class="btn sm ghost" data-ev="${e.id}" type="button">View changes</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No events.</div>'}</section>`;
    $('#aq').onchange = (e) => { aq = e.target.value; audit(el); $('#aq').focus(); }; $('#at').onchange = (e) => { at = e.target.value; audit(el); };
    $('#ex-a').onclick = () => download('coldstart-activity-log.json', JSON.stringify(S().audit || [], null, 2));
    el.querySelectorAll('[data-ev]').forEach((b) => b.onclick = () => { const e = S().audit.find((x) => x.id === b.dataset.ev), d = document.getElementById('dlg'); d.innerHTML = `<div class="dlg-h"><h2 class="disp s">Event ${esc(e.id)}</h2><button class="btn sm ghost" id="dx" type="button">Close</button></div><div class="dlg-b"><p class="small">${esc(e.text)}<br><span class="mono">sha256 ${esc(e.hash)}</span></p><pre class="mono small" style="white-space:pre-wrap;background:#fff;border:1px solid var(--rule);padding:10px">${esc(JSON.stringify(e.payload, null, 2))}</pre></div>`; d.showModal(); $('#dx').onclick = () => d.close(); });
    el.querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => {
      const a = S().approvals.find((x) => x.id === b.dataset.rev), d = document.getElementById('dlg');
      try { await C.ops.post('revoke', { id: a.serverId || a.id }); a.revoked = true; a.status = 'revoked'; const c = (S().campaigns || []).find((x) => x.id === a.campaign); if (c) { c.status = 'draft'; c.approvalId = null; c.steps.forEach((s2) => { s2.approved = false; }); } C.log('approval', 'Revoked unexecuted approval ' + a.id, { approval: a.id }); C.save(); toast('Revoked before anything ran. The campaign is back to draft.'); audit(el); }
      catch (e) {
        if (e.code === 'already_executed') { d.setAttribute('aria-label', 'Already executed'); d.innerHTML = `<div class="dlg-h"><h2 class="disp s">This already ran</h2><button class="btn sm ghost" id="dx" type="button">Close</button></div><div class="dlg-b"><p class="small">${esc(e.message)}</p><p class="small muted">Revoking only stops approvals that have not run. Pausing automation does not remove content that exists on a platform either.</p></div>`; d.showModal(); $('#dx').onclick = () => d.close(); }
        else fail(e);
      }
    });
  }

  function notifications(el) {
    const n = S().notif || (S().notif = { inapp: true, email: false, cats: { approvals: true, failures: true, results: false }, digest: 'off' });
    el.innerHTML = `<section class="panel"><div class="panel-h"><h2>Notifications</h2></div><div class="panel-b" style="display:grid;gap:12px">
      <label class="check-inline"><input type="checkbox" id="n-in" ${n.inapp ? 'checked' : ''}> In-app</label><label class="check-inline"><input type="checkbox" id="n-em" ${n.email ? 'checked' : ''}> Email <span class="chip dash">Delivery not wired yet</span></label>
      ${[['approvals', 'Approvals waiting'], ['failures', 'Failures and blocked publishing'], ['results', 'Results and recommendations']].map(([k, t]) => `<label class="check-inline"><input type="checkbox" data-nc="${k}" ${n.cats[k] ? 'checked' : ''}> ${t}</label>`).join('')}
      <label class="field" style="max-width:220px"><span>Digest</span><select id="n-d"><option value="off">Off</option><option value="daily" ${n.digest === 'daily' ? 'selected' : ''}>Daily</option><option value="weekly" ${n.digest === 'weekly' ? 'selected' : ''}>Weekly</option></select></label>
      <div style="display:flex;gap:8px"><button class="btn" id="n-s" type="button">Save preferences</button><button class="btn ghost" id="n-t" type="button">Send test notification</button></div></div></section>`;
    $('#n-s').onclick = () => { n.inapp = $('#n-in').checked; n.email = $('#n-em').checked; n.digest = $('#n-d').value; el.querySelectorAll('[data-nc]').forEach((c) => { n.cats[c.dataset.nc] = c.checked; }); C.save(); toast('Saved.'); };
    $('#n-t').onclick = () => toast('Test notification: this is how in-app alerts appear.');
  }

  function privacy(el) {
    el.innerHTML = `<section class="panel"><div class="panel-h"><h2>Your data</h2></div><div class="panel-b" style="display:grid;gap:12px"><p class="small">Everything in this build lives in this browser: plans, approvals, product photos and creatives. Research and scans send your business description to the server to run, and are not kept in your account.</p><div><button class="btn" id="ex" type="button">Export my data</button></div><small class="muted">The export contains settings, plan, approvals and the activity log. Photos and videos stay in the Product Library and can be downloaded one by one.</small></div></section>
      <section class="panel"><div class="panel-h"><h2>Delete workspace</h2><span class="chip warn">Cannot be undone</span></div><div class="panel-b" style="display:grid;gap:12px;max-width:420px"><p class="small">Removes this workspace’s data from this browser, including product photos and creatives. Connected accounts aren’t touched because none are connected.</p><label class="field"><span>Type the workspace name to confirm: <b>${esc((S().brand && S().brand.name) || 'delete')}</b></span><input id="dn" type="text"></label><button class="btn" id="del" type="button" disabled style="background:var(--danger);border-color:var(--danger)">Delete workspace</button></div></section>`;
    $('#ex').onclick = async () => { const s = JSON.parse(JSON.stringify(S())); try { s.server = await C.ops.get('exportData'); } catch (e) { s.server = { error: e.message }; } download('coldstart-export.json', JSON.stringify(s, null, 2)); C.log('privacy', 'Data exported', null); };
    const need = ((S().brand && S().brand.name) || 'delete').trim();
    $('#dn').oninput = (e) => { $('#del').disabled = e.target.value.trim() !== need; };
    $('#del').onclick = async () => { try { const w = (await C.ops.get('workspace')).workspace; await C.ops.post('deleteWorkspace', { confirm: w.slice(0, 6) }); } catch (e) { /* server data may already be gone */ } try { await new Promise((r) => { const q = indexedDB.deleteDatabase('coldstart-v4-media'); q.onsuccess = q.onerror = q.onblocked = r; }); localStorage.removeItem('coldstart.v4'); localStorage.removeItem('coldstart.handoff.v1'); } catch (e) { /* ignore */ } location.href = 'onboarding-v4.html'; };
  }

  window.Ops = { syncPolicy, guard, refresh, inbox, settings, openAssist, closeAssist, wire: wireHeader };
  document.addEventListener('DOMContentLoaded', () => {});
})();
