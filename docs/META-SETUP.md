# Meta setup: Pixel + Conversions API

Coldstart runs in **sandbox** until the server has Meta credentials. Sandbox fakes Meta's responses but applies the same CAPI rules (hashing, required fields, the 7-day window). There are two ways to go live, and you can use both.

## Path A: dataset ID + CAPI token (no Meta app needed, ~5 minutes)

Use this to send real server events today. It covers one dataset and can't browse ad accounts.

1. Open **Events Manager → Data sources** and select your dataset (Pixel). Create one there if you don't have it.
2. Go to **Settings → Conversions API → Generate access token** and copy the token.
3. In Coldstart, open **Tracking → Use dataset ID + token** and paste the dataset ID and the token.
   The server checks both with Meta, encrypts the token and keeps it server-side. The browser never stores it.
4. Install the code from step 3 of the Tracking page (see "Install" below).

## Path B: Facebook Login (full flow: pick an ad account, create or choose a dataset)

1. Go to <https://developers.facebook.com/apps> → **Create app** → use case **Create & manage ads with Marketing API** (or "Other" → app type **Business**). Attach it to your Business portfolio.
2. **App settings → Basic**: copy **App ID** and **App Secret**. Set the Privacy Policy URL and the App Domain (your Vercel domain).
3. Add the product **Facebook Login for Business**. Under **Settings → Valid OAuth Redirect URIs**, add:
   - `https://<your-domain>/api/plugins/meta/callback`
   - `http://localhost:8765/api/plugins/meta/callback` (local development)
4. Optional but recommended: **Facebook Login for Business → Configurations → Create**. Choose a user access token with `ads_management`, `ads_read` and `business_management`, then copy the **Configuration ID**.
5. Set the server environment (Vercel → Project → Settings → Environment Variables, or `.env` locally):

   ```
   META_APP_ID=…
   META_APP_SECRET=…
   META_CONFIG_ID=…          # optional; without it Coldstart requests the scopes directly
   SESSION_SECRET=…          # 32+ random chars, already set on the deployed project
   APP_URL=https://<your-domain>
   ```
6. Redeploy. `GET /api/health` should now show `"meta":"live"`.
7. While the app is in **Development mode**, only people with a role on the app (Admin, Developer, Tester) can log in. Before other businesses can use it you need:
   - **Business Verification** for the portfolio.
   - **App Review** with **Advanced Access** for `ads_management`, `ads_read` and `business_management`, including a screencast of the Tracking flow.

Every Graph call is signed with `appsecret_proof`. Tokens are exchanged for long-lived tokens (about 60 days). Reconnect from Tracking when the token expires; the expiry date is shown on the Tracking page.

## Install

- **Any website**: paste the snippet before `</head>`. It loads `fbq`, fires `PageView`, and exposes `coldstart(name, data)`. Each call fires the browser event with an `eventID` and sends the same event to `/api/collect/<siteKey>`. The server adds IP and user agent and forwards it to CAPI. Meta deduplicates on `event_name` + `event_id`.
- **Consent**: "Wait for coldstart.grant()" starts with `fbq('consent','revoke')` and queues server copies until your consent banner calls `coldstart.grant()`.
- **Shopify**: connect the store, then click **Send paid orders to this dataset**. That registers the `orders/paid` webhook, which sends a server `Purchase` with `event_id = order_<id>`. Then paste the **Shopify Customer Events** code under *Settings → Customer events → Add custom pixel*. Its browser `Purchase` uses the same `order_<id>`.

## Verify

1. Open **Events Manager → Test events** and copy the code (`TEST…`).
2. In Coldstart, go to **Tracking → Verify events**, choose an event, paste the code, and click **Send server event**. The event should appear in Test events within seconds.
3. Place one real test order. In Events Manager, Purchase should show **Browser and Server** with a deduplication rate above zero.
4. Remove any older hard-coded `fbq` snippets or a second Meta sales channel, or events will double-count.

## Shopify app (for live store OAuth)

Create an app in the Shopify Dev Dashboard and set these values:
- App URL: `https://<your-domain>/app.html`
- Redirect URL: `https://<your-domain>/api/plugins/shopify/callback`
- Scopes: `read_orders, read_customers`

Then set `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`. Webhooks with customer email, phone or address need **Protected customer data access** (level 2) approved on the app. Without it, Purchases still send, with less matching data.

## Production storage

Relay site keys, Shopify routes and delivery logs need a shared store on Vercel. Add **Upstash Redis** from the Vercel Marketplace; it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Without it, Vercel falls back to per-instance `/tmp`, which is fine for a demo but not for production. `/api/health` reports which store is active.
