# Plugins

Every integration is a server-side module in `lib/plugins/` that exports the same contract. The registry (`lib/plugins/index.js`) lists the available modules. `PLUGINS=meta,shopify` enables a subset without code changes.

```js
export default {
  id: 'meta', name: 'Meta', vendor: 'Meta Platforms', category: 'Tracking',
  description: '…', capabilities: ['capi.send', …], docs: 'https://…',
  env: ['META_APP_ID', 'META_APP_SECRET'],       // all present → live, else sandbox
  auth: { type: 'oauth2', scopes: [...], pkce?: true, needsShop?: true, token?: { fields, hint } },
  liveReady: () => boolean,
  authorizeUrl({ state, redirectUri, challenge, shop }) → string,
  exchange({ code, redirectUri, query, verifier, fetch }) → connection,
  sandboxAccount(query) → connection,            // used when !liveReady()
  connectToken?(input, ctx) → connection,        // optional non-OAuth path
  onDisconnect?(ctx),
  actions: { name: { method: 'GET' | 'POST', run(ctx, input) → json } },
};
// connection = { mode: 'live'|'sandbox', via, account: { id, name }, secrets: { … }, …plugin fields }
// ctx = { conn, setConn(patch), getConn(otherId), store, origin, fetch, req: { ip, ua } }
```

The host (`lib/app.js`) is responsible for:
- **OAuth**: state + PKCE in a sealed 10-minute cookie, callback verification, and the sandbox consent page.
- **Connections**: stored in a sealed AES-256-GCM httpOnly cookie (`cs_vault`). Action responses never include `secrets`.
- **Actions**: `GET|POST /api/plugins/:id/actions/:name`. POST requests need the `x-coldstart: 1` header (CSRF).
- **Shared state**: the `store` (Upstash/Vercel KV, a file, or memory) for anything a webhook or public endpoint must find without the user's cookie.

## Shipped plugins

| Plugin | Live needs | Actions |
|---|---|---|
| `meta` | `META_APP_ID`, `META_APP_SECRET` (or the token path) | status, adAccounts, pixels, createPixel, selectPixel, setConsent, snippet, sendTestEvent, stats |
| `shopify` | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | shop, linkMeta (registers orders/paid), simulateOrder (sandbox) |
| `reddit` | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | submit (self post, rules confirmation required) |
| `x` | `X_CLIENT_ID` (+ secret for confidential clients) | post |

## Adding a plugin

1. Create `lib/plugins/<id>.js` that satisfies the contract. `tests/plugins.test.mjs` checks the shape automatically.
2. Add it to `AVAILABLE` in `lib/plugins/index.js`.
3. Add its env keys to `.env.example`. The Connections page renders it from `/api/plugins`, so no UI changes are needed.
