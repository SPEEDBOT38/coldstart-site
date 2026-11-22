/* Coldstart connectors client: talks to /api (plugins, Meta Pixel + CAPI, Shopify).
 * Exposes window.ColdConnectors with views + actions; workspace.js mounts them.
 * No secrets ever reach this file: tokens stay in the server's sealed httpOnly cookie. */
(function (root) {
  'use strict';
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = { ready: false, loading: false, offline: false, plugins: [], origin: '', meta: null, accounts: null, acct: '', pixels: null,
    snippet: null, tab: 'storefront', stats: null, shop: null, lastTest: null, busy: '', error: '' };
  let host = { render() {}, toast() {}, S: null, save() {} };

  async function api(path, { method = 'GET', body } = {}) {
    const r = await fetch('/api/' + path, { method, credentials: 'same-origin', headers: method === 'POST' ? { 'content-type': 'application/json', 'x-coldstart': '1' } : {}, body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.error || ('Request failed (' + r.status + ')'));
    return j;
  }
  const plugin = id => C.plugins.find(p => p.id === id);
  const conn = id => plugin(id)?.connection || null;

  function syncState() {
    const S = host.S; if (!S) return;
    const t = S.tracking;
    t.metaConnected = !!conn('meta');
    t.metaMode = conn('meta')?.mode || '';
    t.pixel = C.meta?.pixel?.id || '';
    t.pixelName = C.meta?.pixel?.name || '';
    t.consent = !!t.pixel;
    if (!t.pixel) { t.installed = false; t.tested = false; }
    if (C.shop?.linkedSiteKey) t.installed = true;
    if (C.stats) t.tested = C.stats.log.some(l => l.ok);
    if (conn('shopify')) { t.store = conn('shopify').account.id; }
    host.save();
  }

  async function refresh({ quiet } = {}) {
    if (C.loading) return; C.loading = true; C.error = '';
    try {
      const list = await api('plugins');
      C.plugins = list.plugins; C.origin = list.origin; C.offline = false;
      C.meta = conn('meta') ? await api('plugins/meta/actions/status') : null;
      if (C.meta?.pixel) {
        const [snippet, stats] = await Promise.all([api('plugins/meta/actions/snippet'), api('plugins/meta/actions/stats')]);
        C.snippet = snippet; C.stats = stats;
        try { C.assess = (await api('plugins/ops/actions/trackingAssess', { method: 'POST', body: { site: { mode: C.meta.mode }, log: stats.log || [] } })).assessment; } catch (e) { C.assess = null; }
      } else { C.snippet = null; C.stats = null; }
      if (C.meta && C.meta.via !== 'token' && !C.accounts) {
        C.accounts = (await api('plugins/meta/actions/adAccounts')).data;
        C.acct ||= C.accounts[0]?.id || '';
      }
      if (C.meta && C.acct) C.pixels = (await api('plugins/meta/actions/pixels?ad_account_id=' + encodeURIComponent(C.acct))).data;
      if (!C.meta) { C.accounts = null; C.pixels = null; C.acct = ''; }
      C.shop = conn('shopify') ? await api('plugins/shopify/actions/shop') : null;
      syncState();
    } catch (e) {
      if (!C.plugins.length) C.offline = true;
      C.error = e.message;
      if (!quiet) host.toast(e.message);
    } finally { C.ready = true; C.loading = false; host.render(); }
  }

  async function run(label, fn, ok) {
    C.busy = label; host.render();
    try { const r = await fn(); if (ok) host.toast(typeof ok === 'function' ? ok(r) : ok); return r; }
    catch (e) { host.toast(e.message); }
    finally { C.busy = ''; await refresh({ quiet: true }); }
  }

  /* ---------------- views ---------------- */
  const modeBadge = m => m === 'live' ? '<span class="badge approved mode-badge">Live</span>' : '<span class="badge held mode-badge">Sandbox</span>';
  const busy = k => C.busy === k ? 'disabled aria-busy="true"' : '';
  const ago = iso => { if (!iso) return 'never'; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };

  function offlineNote() {
    return `<div class="notice error" style="margin-bottom:18px"><strong>Backend offline.</strong> Start it with <code>npm start</code> (serves the app and <code>/api</code> on port 8765), or open the deployed app. Without it this page cannot connect Meta. ${C.error ? '<br><span class="muted">' + esc(C.error) + '</span>' : ''}</div>`;
  }

  function steps() {
    const t = host.S.tracking;
    return [['Meta connected', !!C.meta], ['Dataset chosen', !!C.meta?.pixel], ['Installed on the store', !!t.installed], ['Events received', !!t.tested]];
  }

  function stepConnect() {
    const p = plugin('meta'), m = C.meta;
    if (m) return `<section class="setup-step done" id="step-connect"><span class="step-number">✓</span><div>
      <div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3>Meta connected ${modeBadge(m.mode)}</h3><button class="btn secondary" data-action="plugin-disconnect" data-plugin="meta" ${busy('disc-meta')}>Disconnect</button></div>
      <p>${esc(m.account.name)} · ${m.via === 'token' ? 'dataset token (Conversions API only)' : 'Facebook Login'} · Graph ${esc(m.graphVersion)}${m.expires ? ' · token renews by ' + new Date(m.expires).toLocaleDateString() : ''}</p>
      ${m.mode === 'sandbox' ? '<p class="small muted">Sandbox: realistic Meta responses, no real Meta calls. Add META_APP_ID / META_APP_SECRET on the server to go live.</p>' : ''}</div></section>`;
    return `<section class="setup-step" id="step-connect"><span class="step-number">1</span><div><h3>Connect Meta ${p ? modeBadge(p.mode) : ''}</h3>
      <p>Sign in with Facebook to pick an ad account and dataset (Pixel), or paste a dataset ID and a Conversions API token from Events Manager.</p>
      <div class="row" style="flex-wrap:wrap;margin-top:12px"><a class="btn" href="/api/plugins/meta/connect" data-action-link="meta-connect">Continue with Facebook${p?.mode === 'sandbox' ? ' (sandbox)' : ''}</a>
      <button class="btn secondary" data-action="meta-token-dialog">Use dataset ID + token</button></div>
      ${p?.mode === 'sandbox' ? `<p class="small muted" style="margin-top:10px">Meta app credentials aren’t set on this server, so Facebook Login runs in sandbox. The token path always talks to the real Meta API.</p>` : ''}</div></section>`;
  }

  function stepDataset() {
    const m = C.meta, on = !!m, chosen = m?.pixel;
    let body = '';
    if (!on) body = '<p>Connect Meta first.</p>';
    else if (m.via === 'token') body = `<p>Token connections are tied to one dataset: <strong>${esc(chosen?.name || chosen?.id)}</strong> · <span class="mono">${esc(chosen?.id)}</span></p>`;
    else {
      const accts = C.accounts || [];
      body = `<div class="fields"><label class="field"><span>Ad account</span><select data-change="meta-account" name="acct">${accts.map(a => `<option value="${esc(a.id)}" ${a.id === C.acct ? 'selected' : ''}>${esc(a.name)} · ${esc(a.id)}${a.active ? '' : ' (inactive)'}</option>`).join('') || '<option>No ad accounts on this login</option>'}</select></label>
        <div class="ds-list" role="list">${(C.pixels || []).map(px => `<button type="button" role="listitem" class="ds-item ${chosen?.id === px.id ? 'is-on' : ''}" data-action="meta-select" data-id="${esc(px.id)}" ${busy('sel-' + px.id)}><span class="ds-radio"></span><span><strong>${esc(px.name)}</strong><small class="mono">${esc(px.id)} · last event ${ago(px.last_fired_time)}</small></span>${chosen?.id === px.id ? '<span class="badge approved">In use</span>' : '<span class="caption">Use</span>'}</button>`).join('') || '<p class="small muted">No datasets on this ad account yet. Create one below.</p>'}</div>
        <form id="pixel-create-form" class="inline"><label class="field grow"><span>New dataset name</span><input name="name" placeholder="${esc(host.S.brand.name)} website" maxlength="100" required></label><button class="btn secondary" type="submit" ${busy('create')}>Create dataset</button></form></div>`;
    }
    return `<section class="setup-step ${chosen ? 'done' : ''}" id="step-dataset"><span class="step-number">${chosen ? '✓' : '2'}</span><div><h3>Choose the dataset (Pixel)</h3>${body}</div></section>`;
  }

  function stepInstall() {
    const m = C.meta, sn = C.snippet, t = host.S.tracking, sh = conn('shopify');
    let body = '<p>Choose a dataset first.</p>';
    if (sn) {
      const code = C.tab === 'shopify' ? sn.shopify : sn.storefront;
      body = `<p>Every browser event fires <code>fbq</code> with an <code>eventID</code> and the same event goes server-side through Coldstart’s relay. Meta keeps one copy.</p>
      <div class="fields"><label class="field" style="max-width:340px"><span>Consent</span><select data-change="meta-consent"><option value="grant" ${m.consent !== 'wait' ? 'selected' : ''}>Send immediately</option><option value="wait" ${m.consent === 'wait' ? 'selected' : ''}>Wait for coldstart.grant()</option></select></label></div>
      <div class="code-tabs" role="tablist">${[['storefront', 'Any website'], ['shopify', 'Shopify Customer Events']].map(([k, l]) => `<button role="tab" aria-selected="${C.tab === k}" data-action="snippet-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="code-block"><pre id="snippet-code">${esc(code)}</pre><button class="btn paper" data-action="copy-snippet">Copy code</button></div>
      <p class="small muted">${C.tab === 'shopify' ? 'Shopify admin → Settings → Customer events → Add custom pixel → paste → Connect. Purchases are sent server-side from the orders/paid webhook (below) with the same order_ event ID.' : 'Paste before </head> on every page. Relay endpoint: <span class="mono">' + esc(sn.collectUrl) + '</span>'}</p>
      <div class="shop-box"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><div><span class="caption">Shopify server-side purchases</span><h4>${sh ? esc(sh.account.id) + ' ' + modeBadge(sh.mode) : 'Connect the store'}</h4></div>
      ${sh ? `<div class="row" style="flex-wrap:wrap">${C.shop?.linkedSiteKey === m.siteKey ? '<span class="badge approved">orders/paid → CAPI linked</span>' : `<button class="btn" data-action="shopify-link" ${busy('link')}>Send paid orders to this dataset</button>`}${sh.mode === 'sandbox' && C.shop?.linkedSiteKey ? `<button class="btn secondary" data-action="shopify-simulate" ${busy('sim')}>Simulate a paid order</button>` : ''}<button class="btn secondary" data-action="plugin-disconnect" data-plugin="shopify">Disconnect</button></div>`
        : `<form id="shop-connect-form" class="inline"><label class="field grow"><span>Store domain</span><input name="shop" value="${esc(t.store || '')}" placeholder="your-store.myshopify.com" required></label><button class="btn secondary" type="submit">Connect Shopify${plugin('shopify')?.mode === 'sandbox' ? ' (sandbox)' : ''}</button></form>`}</div></div>`;
    }
    return `<section class="setup-step ${t.installed ? 'done' : ''}" id="step-install"><span class="step-number">${t.installed ? '✓' : '3'}</span><div><h3>Install browser + server events</h3>${body}</div></section>`;
  }

  const MAP = [['page_viewed', 'PageView'], ['product_viewed', 'ViewContent'], ['product_added_to_cart', 'AddToCart'], ['checkout_started', 'InitiateCheckout'], ['checkout_completed', 'Purchase']];
  const AS = { verified: ['ok', 'Verified: Meta accepted real server events.'], test_events_received: ['', 'Test events only. Send a real event from the live site.'], sandbox_only: ['bad', 'Sandbox: nothing reaches Meta.'], failing: ['bad', 'Events are failing.'], installed_unverified: ['', 'No events seen yet.'], not_configured: ['', 'Not configured.'] };
  function stepDetect() {
    const d = C.detect, px = C.meta?.pixel?.id, found = d ? d.inspection.pixelIds : [];
    const mismatch = d && px && found.length && !found.includes(String(px));
    return `<section class="setup-step ${d ? 'done' : ''}" id="step-detect"><span class="step-number">${d ? '✓' : '0'}</span><div><h3>Check your website</h3>
      <p>Enter your store address. I read the public page markup to find the platform and any Meta Pixel already installed. A page can load tags later or through Tag Manager, so this is a hint, not proof.</p>
      <form id="site-detect-form" class="fields"><label class="field"><span>Website</span><input name="url" type="text" placeholder="yourstore.com" required></label><button class="btn" style="justify-self:start" type="submit" ${busy('detect')}>Check website</button></form>
      ${d ? `<div class="capi-result ${d.inspection.issues.some(i => ['duplicate_pixel', 'duplicate_loader'].includes(i.code)) ? 'bad' : 'ok'}"><strong>Platform: ${esc(d.inspection.platform)}</strong> · Pixel IDs in page: ${found.length ? found.map(esc).join(', ') : 'none found'} · GTM: ${d.inspection.gtmContainers.length ? d.inspection.gtmContainers.map(esc).join(', ') : 'none'} <span class="small muted">(markup only)</span></div>
      ${mismatch ? `<p class="small" style="color:var(--ink)"><strong>The page uses a different Pixel than the dataset you chose (${esc(px)}).</strong> Events will go to the wrong dataset until one of them is changed.</p>` : ''}
      <ul class="small">${d.inspection.issues.map(i => `<li>${esc(i.text)}</li>`).join('')}${d.guidance.map(g => `<li>${esc(g)}</li>`).join('')}</ul>
      <p class="small muted">Event mapping used by the Shopify custom pixel: ${MAP.map(([a, b]) => `<code>${a}</code> → <code>${b}</code>`).join(', ')}. Purchase uses the order id as event_id so browser and server copies deduplicate.</p>` : ''}</div></section>`;
  }
  function stepVerify() {
    const m = C.meta, st = C.stats, lt = C.lastTest, t = host.S.tracking;
    if (!m?.pixel) return `<section class="setup-step" id="step-verify"><span class="step-number">4</span><div><h3>Verify events</h3><p>Choose a dataset first.</p></div></section>`;
    const evs = ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'];
    return `<section class="setup-step ${t.tested ? 'done' : ''}" id="step-verify"><span class="step-number">${t.tested ? '✓' : '4'}</span><div><h3>Verify events</h3>
      <p>Send a server event now. Add the test code from Events Manager → Test events to see it live there.</p>
      <form id="capi-test-form" class="fields"><div class="form-columns"><label class="field"><span>Event</span><select name="event_name">${evs.map(e => `<option>${e}</option>`).join('')}</select></label><label class="field"><span>Test event code</span><input name="test_event_code" placeholder="TEST12345" pattern="TEST\\w{1,20}"></label></div>
      <label class="field"><span>Customer email (optional, hashed before sending)</span><input name="email" type="email" placeholder="you@store.com"></label>
      <button class="btn" style="justify-self:start" type="submit" ${busy('test')}>Send server event</button></form>
      ${lt ? `<div class="capi-result ${lt.ok ? 'ok' : 'bad'}" id="capi-result"><strong>${lt.ok ? `Meta received ${lt.response.events_received} event${lt.response.events_received === 1 ? '' : 's'}` : 'Rejected'}</strong>${lt.ok ? ` · fbtrace ${esc(lt.response.fbtrace_id)} · ${lt.mode}` : ' · ' + esc(lt.error)}<details><summary>Payload sent</summary><pre>${esc(JSON.stringify(lt.sent, null, 2))}</pre></details></div>` : ''}
      ${C.assess ? `<p class="capi-result ${(AS[C.assess.state] || ['', ''])[0]}"><strong>${esc((AS[C.assess.state] || ['', C.assess.state])[1])}</strong> ${esc(C.assess.next || '')} ${C.assess.state === 'verified' ? 'Browser/server deduplication is <strong>not confirmed</strong> here: check Events Manager → Diagnostics.' : ''}</p>` : ''}
      <div class="ev-grid">${evs.map(e => `<div class="ev-cell ${st?.counts[e] ? 'is-on' : ''}"><span>${e}</span><strong class="mono">${st?.counts[e] || 0}</strong></div>`).join('')}</div>
      <p class="small muted">${st?.note ? esc(st.note) : 'Counts are Meta’s 7-day event stats for this dataset.'}</p>
      <div class="table-wrap"><table class="log-table"><thead><tr><th>When</th><th>Source</th><th>Event</th><th>event_id</th><th>Result</th></tr></thead><tbody>${(st?.log || []).slice(0, 12).map(l => `<tr><td>${ago(l.at)}</td><td>${esc(l.source)}${l.test ? ' · test' : ''}</td><td>${esc(l.event_name)}</td><td class="mono">${esc(l.event_id)}</td><td>${l.ok ? '<span class="badge approved">Received</span>' : `<span class="badge failed" title="${esc(l.error)}">Rejected</span>`}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No deliveries yet.</td></tr>'}</tbody></table></div>
      <div class="row" style="margin-top:10px">${'<button class="btn secondary" data-action="stats-refresh">Refresh</button>'}</div></div></section>`;
  }

  function tracking(head) {
    if (!C.ready && !C.loading) refresh({ quiet: true });
    const done = steps().filter(s => s[1]).length;
    return head('Tracking / Meta Pixel + Conversions API', 'Connect Meta, pick the dataset, install browser and server events, then prove Meta receives them.') +
      `<div class="grid-aside"><section>${C.offline ? offlineNote() : ''}${!C.ready ? '<p class="muted">Loading connections…</p>' : stepDetect() + stepConnect() + stepDataset() + stepInstall() + stepVerify()}</section>
      <aside class="stack"><section class="blue-note px-note">${host.miniArt('pixel_setup')}<div><span class="eyebrow">Coldie / setup</span><h3>${done}/4 done<b class="cursor">_</b></h3><ul class="px-steps">${steps().map(([l, ok]) => `<li class="${ok ? 'is-ok' : ''}">${ok ? '■' : '□'} ${l}</li>`).join('')}</ul></div></section>
      <section class="panel"><div class="panel-head"><h2>How deduplication works</h2></div><div class="panel-body"><p class="small">Browser and server send the same <code>event_name</code> + <code>event_id</code>. Meta counts it once and keeps the richer server data: hashed email/phone, IP, user agent, <code>fbp</code>/<code>fbc</code>.</p><div class="divider"></div><p class="small muted">Hashing: Coldstart normalizes and SHA-256 hashes email, phone, name and address on the server. IP, user agent, fbp and fbc are sent as-is, as Meta requires.</p></div></section>
      <section class="panel"><div class="panel-body"><span class="eyebrow">Before you trust the numbers</span><p class="small muted">Remove any older hard-coded <code>fbq</code> snippet or a second Meta app on the store, or events double-count. Place one real test order and check it shows as both Browser and Server in Events Manager.</p><a class="line-button" style="display:inline-block;margin-top:14px" href="https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events" target="_blank" rel="noopener noreferrer">Meta dedup docs ↗</a></div></section></aside></div>`;
  }

  const mark = id => `<span class="plug-mark plug-${esc(id)}" aria-hidden="true">${{ meta: '∞', shopify: 'S', reddit: 'r/', x: 'X', research: '◎', studio: '✦', treg: 't' }[id] || id[0].toUpperCase()}</span>`;
  function connections(head, simulator) {
    if (!C.ready && !C.loading) refresh({ quiet: true });
    const cards = C.plugins.map(p => {
      const c = p.connection;
      const server = p.auth.type === 'server';
      const act = server ? `<span class="caption">${p.mode === 'live' ? 'Server keys set' : 'Set ' + p.missingEnv.map(esc).join(', ')}</span>`
        : c ? `<button class="btn secondary" data-action="plugin-disconnect" data-plugin="${p.id}">Disconnect</button>`
        : p.auth.needsShop ? `<form class="inline plug-shop" id="shop-connect-form"><input name="shop" placeholder="store.myshopify.com" aria-label="Shopify store domain" required><button class="btn" type="submit">Connect</button></form>`
        : `<a class="btn" href="/api/plugins/${p.id}/connect">Connect</a>`;
      return `<article class="plug-card ${c ? 'is-on' : ''}" data-plugin-card="${p.id}"><header>${mark(p.id)}<div><span class="caption">${esc(p.category)} plugin</span><h3>${esc(p.name)}</h3></div>${modeBadge(p.mode)}</header>
        <p>${esc(p.description)}</p><ul class="plug-caps">${p.capabilities.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <footer><span class="small ${c ? '' : 'muted'}">${server ? (p.mode === 'live' ? 'Runs on the server: ' + (p.missingEnv.length ? 'fallbacks active, add ' + p.missingEnv.map(esc).join(', ') + ' for full coverage' : 'all keys present') : 'Not configured') : c ? 'Connected as <strong>' + esc(c.account.name) + '</strong>' : p.mode === 'sandbox' ? 'Needs ' + p.missingEnv.map(esc).join(', ') + ' for live' : 'Not connected'}</span>${act}</footer></article>`;
    }).join('');
    return head('Connections / plugins', 'Each integration is a swappable plugin on the server. Connect only what you need.') +
      (C.offline ? offlineNote() : '') +
      `<section class="plug-grid">${cards || (C.ready ? '' : '<p class="muted">Loading plugins…</p>')}</section>
      <div class="notice" style="margin:20px 0">Tokens stay on the server in a sealed, httpOnly cookie. This page never sees them. Plugins in <strong>Sandbox</strong> use realistic stand-in responses until their app credentials are set.</div>` + simulator;
  }

  /* ---------------- actions ---------------- */
  const actions = {
    'meta-token-dialog': () => host.showDialog('Meta / dataset ID + token', `<form id="meta-token-form" class="fields"><p class="small">Events Manager → your dataset → Settings → Conversions API → <em>Generate access token</em>. The token goes straight to the Coldstart server, which checks it with Meta and stores it encrypted.</p>
      <label class="field"><span>Dataset (Pixel) ID</span><input name="pixel_id" inputmode="numeric" pattern="\\d{6,20}" required></label>
      <label class="field"><span>Conversions API access token</span><input name="access_token" type="password" autocomplete="off" required></label>
      <button class="btn" style="justify-self:start" type="submit">Verify and connect</button></form>`),
    'plugin-disconnect': el => run('disc-' + el.dataset.plugin, () => api(`plugins/${el.dataset.plugin}/disconnect`, { method: 'POST' }), 'Disconnected.').then(() => { if (el.dataset.plugin === 'meta') { C.lastTest = null; C.accounts = null; } }),
    'meta-select': el => run('sel-' + el.dataset.id, () => api('plugins/meta/actions/selectPixel', { method: 'POST', body: { pixel_id: el.dataset.id } }), 'Dataset selected. Install the code next.'),
    'snippet-tab': el => { C.tab = el.dataset.tab; host.render(); },
    'copy-snippet': async () => { const code = C.tab === 'shopify' ? C.snippet.shopify : C.snippet.storefront; try { await navigator.clipboard.writeText(code); } catch {} host.S.tracking.installed = true; host.save(); host.toast('Copied. Paste it on the store, then send a test event.'); host.render(); },
    'shopify-link': () => run('link', () => api('plugins/shopify/actions/linkMeta', { method: 'POST' }), 'Paid orders now go to Meta server-side.'),
    'shopify-simulate': () => run('sim', () => api('plugins/shopify/actions/simulateOrder', { method: 'POST', body: {} }), r => `Sandbox order ${r.order.id} sent as Purchase (${r.sent.event_id}).`),
    'stats-refresh': () => run('stats', async () => {}, ''),
  };
  const changes = {
    'meta-account': async el => { C.acct = el.value; C.pixels = null; host.render(); try { C.pixels = (await api('plugins/meta/actions/pixels?ad_account_id=' + encodeURIComponent(C.acct))).data; } catch (e) { host.toast(e.message); } host.render(); },
    'meta-consent': el => run('consent', () => api('plugins/meta/actions/setConsent', { method: 'POST', body: { consent: el.value } }), el.value === 'wait' ? 'Events wait for coldstart.grant(). Re-copy the code.' : 'Events send immediately. Re-copy the code.'),
  };
  const forms = {
    'site-detect-form': fd => run('detect', async () => { C.detect = await api('plugins/ops/actions/trackingInspect', { method: 'POST', body: { url: String(fd.get('url') || '').trim() } }); }, 'Website checked.'),
    'meta-token-form': fd => run('token', () => api('plugins/meta/token', { method: 'POST', body: { pixel_id: fd.get('pixel_id'), access_token: fd.get('access_token') } }), 'Dataset connected with the Conversions API token.').then(() => host.closeDialog()),
    'pixel-create-form': fd => run('create', async () => { const r = await api('plugins/meta/actions/createPixel', { method: 'POST', body: { ad_account_id: C.acct, name: fd.get('name') } }); await api('plugins/meta/actions/selectPixel', { method: 'POST', body: { pixel_id: r.id } }); C.pixels = null; C.accounts = null; return r; }, r => `Created ${r.name} and selected it.`),
    'shop-connect-form': fd => { const shop = String(fd.get('shop') || '').trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return host.toast('Use your-store.myshopify.com'); location.href = '/api/plugins/shopify/connect?shop=' + encodeURIComponent(shop); },
    'capi-test-form': fd => run('test', async () => {
      try { const r = await api('plugins/meta/actions/sendTestEvent', { method: 'POST', body: Object.fromEntries(fd) }); C.lastTest = { ok: true, ...r }; return r; }
      catch (e) { C.lastTest = { ok: false, error: e.message }; throw e; }
    }, r => `Meta received ${r.response.events_received} event (${r.mode}).`),
  };

  /** OAuth return: #/tracking?connected=meta or ?error=... */
  function consumeHash() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    if (!q.has('connected') && !q.has('error')) return;
    const id = q.get('connected');
    if (id) { host.toast(`${({ meta: 'Meta', shopify: 'Shopify', reddit: 'Reddit', x: 'X' })[id] || id} connected.`); if (['reddit', 'x', 'shopify'].includes(id) && host.S) { host.S.connections[id] = true; host.save(); } }
    else host.toast('Connection failed: ' + q.get('error'));
    history.replaceState(null, '', location.pathname + location.hash.split('?')[0]);
  }

  /* Post images live in IndexedDB (data URLs are too big for localStorage). */
  const media = (() => {
    let dbp;
    const db = () => dbp ||= new Promise((res, rej) => { const r = indexedDB.open('coldstart-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('images'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('images', mode); const q = fn(t.objectStore('images')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
    const cache = new Map();
    return {
      put: (id, url) => { cache.set(id, url); return tx('readwrite', s => s.put(url, id)); },
      get: async id => cache.get(id) || (await tx('readonly', s => s.get(id))) || null,
      del: id => { cache.delete(id); return tx('readwrite', s => s.delete(id)); },
      hydrate(rootEl) { rootEl.querySelectorAll('img[data-media-id]').forEach(async img => { const u = await media.get(img.dataset.mediaId); if (u) img.src = u; else img.closest('.img-frame')?.classList.add('is-missing'); }); },
    };
  })();

  root.ColdConnectors = {
    state: C, refresh, api, steps, media,
    mount(h) { host = h; consumeHash(); refresh({ quiet: true }); addEventListener('hashchange', consumeHash); },
    views: { tracking, connections },
    action: (name, el) => actions[name] ? (actions[name](el), true) : false,
    change: (name, el) => changes[name] ? (changes[name](el), true) : false,
    submit: (id, fd) => forms[id] ? (forms[id](fd), true) : false,
  };
})(window);
