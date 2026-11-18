// treg plugin: exposes the treg catalog (public search) and the server's treg connection status.
// Research uses treg through lib/treg.js; this plugin is what the Connections page shows.
import { requestJson, need } from './http.js';
import { hasTreg } from '../treg.js';

export default {
  id: 'treg', name: 'treg', vendor: 'Superdesign', category: 'Data',
  description: 'One token for thousands of per-call tools: X, Instagram, Reddit and TikTok search, the Meta Ad Library and more, priced from $0.001 a call.',
  capabilities: ['catalog.search', 'x.search', 'instagram.hashtag', 'reddit.search', 'meta_ads.library'],
  env: ['TREG_TOKEN'], optionalEnv: ['TREG_ORG'],
  docs: 'https://github.com/superdesigndev/treg', auth: { type: 'server', scopes: [] },
  liveReady: hasTreg,
  actions: {
    catalog: { method: 'GET', async run(ctx, input) {
      const q = String(input.q || '').trim();
      need(q.length >= 2 && q.length <= 120, 'Describe the job (2–120 characters).');
      const j = await requestJson(ctx.fetch, 'https://treg.to/catalog/search?q=' + encodeURIComponent(q), { timeout: 15000 });
      return { total: j.total, results: (j.results || []).slice(0, 12).map(r => ({ id: r.id, name: r.name, summary: r.summary, usd: r.cost?.value ?? null, kind: r.kind })) };
    } },
  },
};
