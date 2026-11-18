/* Local sample-state engine: no transport, storage, timers, or real publishing.
 * All actions mutate the supplied version-1 state and return {ok, reason?, post?}.
 * UTC timestamps accept seconds or milliseconds with Z; scheduling never converts zones.
 * simulatePublish accepts success|failure; scheduled work must be due. Failed work can retry.
 * setPolicy merges rules without touching posts. applyAutomation explicitly approves only.
 * Undated auto approvals reserve today's allowance; dated reservations use their UTC day.
 * UI may update sourceId/media/ruleChecked; scheduling and publishing revalidate them.
 * Render all records as samples and all connection/publish actions as simulations.
 */
(function (root) {
  'use strict';
  const platforms = ['reddit', 'x', 'instagram', 'facebook', 'shopify'];
  function post(id, campaign, platform, title, body) {
    return {id, campaign, platform, title, body, status: 'draft', scheduledAt: null,
      approved: false, sourceId: null, media: false, ruleChecked: false, error: '', attempts: 0};
  }
  const fail = reason => ({ok: false, reason});
  const good = p => p ? {ok: true, post: p} : {ok: true};
  const text = value => typeof value === 'string' && value.trim().length > 0;
  function log(s, message, time = new Date().toISOString()) {
    s.activity.unshift({text: 'Simulation: ' + message, time});
  }
  const terminalPost = p => ['published', 'cancelled'].includes(p.status);
  function target(s, id) { return s.posts.find(p => p.id === id); }
  function approveOne(p) { p.approved = true; p.status = 'approved'; p.error = ''; }
  function utc(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
    const ms = Date.parse(value);
    return Number.isFinite(ms) && new Date(ms).toISOString() === value.replace(/(?<!\.\d{3})Z$/, '.000Z');
  }
  function prerequisites(p) {
    if (!platforms.includes(p.platform) || !text(p.title) || !text(p.body)) return 'Valid destination, title and body are required.';
    if (p.platform === 'instagram' && p.media !== true) return 'Instagram needs media before scheduling.';
    if (p.platform === 'reddit' && p.ruleChecked !== true) return 'Confirm Reddit community rules before scheduling.';
    return '';
  }
  function heldReason(s, p) {
    return s.paused ? 'Workspace is paused.' : s.connections[p.platform] !== true ? 'Destination is disconnected.' : '';
  }
  function reconcile(s) {
    for (const p of s.posts) {
      if (!['scheduled', 'held'].includes(p.status)) continue;
      const reason = heldReason(s, p) || (p.approved !== true ? 'Approval is required.' : '') || prerequisites(p) || autoReason(s, p, p.scheduledAt) || (!utc(p.scheduledAt) ? 'A valid schedule is required.' : '');
      p.status = reason ? 'held' : 'scheduled'; p.error = reason;
    }
  }
  function autoReason(s, p, iso) {
    const c = s.campaigns.find(c => c.id === p.campaign);
    if (!c) return 'Campaign is missing.';
    if (c.policy !== 'auto') return '';
    if (!c.rules.platforms.includes(p.platform)) return 'Destination is not allowed by automation rules.';
    if (c.rules.requireEvidence && !text(p.sourceId)) return 'Automation requires source evidence.';
    const day = (iso || new Date().toISOString()).slice(0, 10);
    const reserved = s.posts.filter(q => q.id !== p.id && q.campaign === p.campaign && q.approved === true && q.status !== 'cancelled' &&
      (typeof q.scheduledAt === 'string' ? q.scheduledAt.slice(0, 10) === day : !iso && q.status !== 'published')).length;
    return reserved >= c.rules.maxPerDay ? 'Automation daily cap reached.' : '';
  }
  const api = {
    cancel(s, id) {
      const p = target(s, id);
      if (!p || terminalPost(p)) return fail('Post is missing or immutable.');
      p.status = 'cancelled'; p.approved = false; p.scheduledAt = null; p.error = '';
      log(s, 'cancelled local post.'); return good(p);
    },
    simulatePublish(s, id, outcome = 'success', nowISO = new Date().toISOString()) {
      const p = target(s, id);
      if (!p || terminalPost(p)) return fail('Post is missing or immutable; duplicate publishing is blocked.');
      if (!['success', 'failure'].includes(outcome) || !utc(nowISO)) return fail('Invalid simulation outcome or UTC time.');
      if (p.approved !== true || !['approved', 'scheduled', 'held', 'failed'].includes(p.status)) return fail('Approval is required before simulating publishing.');
      const blocked = heldReason(s, p);
      if (blocked) { p.status = 'held'; p.error = blocked; return {ok: false, reason: blocked, post: p}; }
      if (p.scheduledAt && (!utc(p.scheduledAt) || Date.parse(p.scheduledAt) > Date.parse(nowISO))) return fail('Scheduled simulation is not due yet.');
      const reason = prerequisites(p) || autoReason(s, p, nowISO);
      if (reason) return fail(reason);
      p.attempts++; p.scheduledAt = nowISO;
      p.status = outcome === 'success' ? 'published' : 'failed';
      p.error = outcome === 'success' ? '' : 'Simulated ' + p.platform + ' publishing failure. Retry locally; no network request was made.';
      log(s, p.platform + (p.status === 'published' ? ' published locally; no network request was made.' : ' failed locally.'), nowISO);
      return outcome === 'success' ? good(p) : {ok: false, reason: p.error, post: p};
    },
    applyAutomation(s, campaignId) {
      const c = s.campaigns.find(c => c.id === campaignId);
      if (!c || c.policy !== 'auto') return fail('Select a campaign in automatic approval mode.');
      let count = 0;
      for (const p of s.posts) {
        if (p.campaign !== campaignId || !['draft', 'needs_approval'].includes(p.status) || p.approved) continue;
        const reason = prerequisites(p) || autoReason(s, p, p.scheduledAt);
        if (reason) { p.error = reason; continue; }
        approveOne(p); count++;
      }
      log(s, 'automation approved ' + count + ' eligible posts; nothing was published.'); return good();
    },
    edit(s, id, changes) {
      const p = target(s, id);
      if (!p || terminalPost(p)) return fail('Post is missing or immutable.');
      if (!changes || !text(changes.title) || !text(changes.body)) return fail('Title and body are required.');
      p.title = changes.title; p.body = changes.body; p.approved = false;
      p.scheduledAt = null; p.status = 'needs_approval'; p.error = '';
      log(s, 'edited post; approval and schedule cleared.'); return good(p);
    },
    setConnection(s, platform, connected) {
      if (!platforms.includes(platform) || typeof connected !== 'boolean') return fail('Invalid destination or connection value.');
      s.connections[platform] = connected; reconcile(s);
      log(s, platform + (connected ? ' connected locally.' : ' disconnected locally.')); return good();
    },
    setPaused(s, paused) {
      if (typeof paused !== 'boolean') return fail('Pause must be a boolean.');
      s.paused = paused; reconcile(s); log(s, paused ? 'workspace paused.' : 'workspace resumed.'); return good();
    },
    schedule(s, id, iso, nowISO = new Date().toISOString()) {
      const p = target(s, id);
      if (!p || terminalPost(p)) return fail('Post is missing or immutable.');
      if (!utc(iso) || !utc(nowISO) || Date.parse(iso) <= Date.parse(nowISO)) return fail('Choose a future UTC ISO time.');
      if (p.approved !== true) return fail('Approval is required before scheduling.');
      const reason = prerequisites(p) || autoReason(s, p, iso); if (reason) return fail(reason);
      p.scheduledAt = iso; p.error = heldReason(s, p); p.status = p.error ? 'held' : 'scheduled';
      log(s, 'scheduled ' + p.platform + ' locally.', nowISO); return good(p);
    },
    setPolicy(s, campaignId, mode, rules) {
      const c = s.campaigns.find(c => c.id === campaignId);
      if (!c || !['each', 'batch', 'auto'].includes(mode)) return fail('Invalid campaign or approval policy.');
      const r = {...c.rules, ...rules};
      if (!Array.isArray(r.platforms) || r.platforms.some(p => !platforms.includes(p)) ||
        !Number.isInteger(r.maxPerDay) || r.maxPerDay < 1 || typeof r.requireEvidence !== 'boolean') return fail('Invalid automation rules.');
      c.policy = mode; c.rules = {platforms: [...new Set(r.platforms)], maxPerDay: r.maxPerDay, requireEvidence: r.requireEvidence};
      log(s, 'changed approval policy; existing posts were not approved or published.'); return good();
    },
    approveBatch(s, campaignId) {
      const c = s.campaigns.find(c => c.id === campaignId);
      if (!c || c.policy !== 'batch') return fail('Select a campaign in batch approval mode.');
      const pending = s.posts.filter(p => p.campaign === campaignId && !terminalPost(p) && !p.approved);
      if (pending.some(p => !text(p.title) || !text(p.body))) return fail('Every post needs a title and body.');
      pending.forEach(approveOne); log(s, 'approved campaign batch.'); return good();
    },
    approve(s, id) {
      const p = target(s, id);
      if (!p || terminalPost(p)) return fail('Post is missing or immutable.');
      if (!text(p.title) || !text(p.body)) return fail('Title and body are required.');
      if (p.approved) return good(p);
      approveOne(p); log(s, 'approved ' + p.title + '.'); return good(p);
    },
    createPost(s, input) {
      if (!input || !platforms.includes(input.platform) || !s.campaigns.some(c => c.id === input.campaign)) return fail('Choose a valid destination and campaign.');
      if (!text(input.title) || !text(input.body)) return fail('Title and body are required.');
      if (input.sourceId != null && !text(input.sourceId)) return fail('Evidence must be a nonempty source ID.');
      let n = 1; while (s.posts.some(p => p.id === 'post-' + n)) n++;
      const p = post('post-' + n, input.campaign, input.platform, input.title, input.body);
      p.sourceId = input.sourceId || null; s.posts.push(p);
      log(s, 'created draft for ' + p.platform + '.'); return good(p);
    },
    seed(nowISO = new Date().toISOString()) {
      const now = new Date(nowISO);
      if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid sample seed date.');
      const date = now.toISOString().slice(0, 10);
      const today = new Date(date + 'T23:59:59.999Z').toISOString();
      const dayShift = (d, h = 14) => new Date(Date.parse(date + `T${String(h).padStart(2, '0')}:00:00Z`) + d * 86400000).toISOString();
      const tomorrow = dayShift(1, 12);
      const samples = [
        ['reddit', 'A soil-check routine', 'Sample discussion: how do you check moisture before watering?'],
        ['x', 'Meet the care kit', 'Sample: a moisture meter, soft leaf cloth and a calmer watering routine.'],
        ['instagram', 'A little leaf care', 'Sample photo caption: wipe dusty leaves gently with our reusable cloth.'],
        ['facebook', 'Weekend plant check', 'Sample reminder: check the soil, rotate the pot, enjoy the new growth.'],
        ['shopify', 'When should you water?', 'Sample guide: plant needs differ. Check soil and drainage before watering.'],
        ['x', 'The potting mat', 'Sample: keep the repotting mess on a washable mat.'],
        ['instagram', 'Repotting day', 'Sample product photo caption for our fictional potting mat.'],
        ['reddit', 'Learning about drainage', 'Sample discussion: what helped you improve drainage?'],
        ['facebook', 'A greener corner', 'Sample launch announcement for the Fern & Form care kit.'],
        ['shopify', 'Three gentle care habits', 'Sample blog draft: observe leaves, check soil, keep a simple care journal.']
      ];
      const slotMap = {1: today, 2: tomorrow, 3: dayShift(0, 9), 4: dayShift(2, 11), 5: dayShift(3, 15)};
      const posts = samples.map(([platform, title, body], i) => {
        const p = post('sample-' + (i + 1), i < 5 ? 'launch' : 'evergreen', platform, title, body);
        p.status = ['needs_approval','scheduled','scheduled','published','failed','scheduled','needs_approval','draft','approved','draft'][i];
        p.approved = ['scheduled','published','failed','approved'].includes(p.status);
        p.scheduledAt = slotMap[i] || null;
        p.media = platform === 'instagram'; p.ruleChecked = i === 0;
        p.sourceId = 'sample-care-guide';
        p.attempts = i === 3 || i === 4 ? 1 : 0;
        p.error = i === 4 ? 'Simulated publishing failure. Retry this sample locally.' : '';
        return p;
      });
      return {version: 1, brand: {name: 'Fern & Form', url: 'https://fern-and-form.myshopify.com',
        line: 'Thoughtful essentials for everyday plant care.', voice: 'Warm, practical, honest.', avoid: 'Unproven claims; pressure selling.'},
        campaigns: [{id: 'launch', name: 'Care kit launch', policy: 'each', rules: {platforms: [...platforms], maxPerDay: 3, requireEvidence: true}},
          {id: 'evergreen', name: 'Everyday plant care', policy: 'batch', rules: {platforms: [...platforms], maxPerDay: 3, requireEvidence: true}}],
        connections: Object.fromEntries(platforms.map(p => [p, true])), paused: false, posts,
        activity: [{text: 'Sample workspace loaded. Connections and publishing are local simulations only.', time: now.toISOString()}],
        tracking: {store: 'fern-and-form.myshopify.com', installed: false, pixel: '', consent: false, tested: false}, saved: []};
    }
  };
  root.ColdState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
