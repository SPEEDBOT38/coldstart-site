// Plugin registry. A plugin is a module exporting the connector contract (see docs/PLUGINS.md).
// Enable a subset with PLUGINS=meta,shopify; add one by importing it into AVAILABLE.
import meta from './meta/index.js';
import shopify from './shopify.js';
import reddit from './reddit.js';
import x from './x.js';

const AVAILABLE = [meta, shopify, reddit, x];

export function listPlugins() {
  const only = (process.env.PLUGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return only.length ? AVAILABLE.filter(p => only.includes(p.id)) : AVAILABLE;
}
export const getPlugin = id => listPlugins().find(p => p.id === id) || null;

/** Public description: never includes secrets. */
export function describe(p, conn) {
  return {
    id: p.id, name: p.name, vendor: p.vendor, category: p.category, description: p.description, capabilities: p.capabilities,
    docs: p.docs, auth: { type: p.auth.type, scopes: p.auth.scopes, needsShop: !!p.auth.needsShop, token: p.auth.token ? { fields: p.auth.token.fields, hint: p.auth.token.hint } : null },
    mode: p.liveReady() ? 'live' : 'sandbox', missingEnv: p.env.filter(k => !process.env[k]),
    actions: Object.keys(p.actions),
    connection: conn ? { mode: conn.mode, via: conn.via, account: conn.account, pixel: conn.pixel || null } : null,
  };
}
