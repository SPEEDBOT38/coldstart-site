# Staging runbook (account-owner steps)

Status: **nothing below has been executed by the build agent.** Neither the build sandbox nor the developer's machine could reach Cloudflare, Vercel, X, Meta or Reddit, and no credentials were available. Every command here is prepared, not run. After you run a step, paste only its non-secret output (resource ids, test output) back.

Never paste tokens into chat. Set them as Vercel/Cloudflare secrets or shell variables.

## 1. Cloudflare (D1, R2, queue, cron worker)
```
cd workers/pipeline
npx wrangler login
npx wrangler d1 create coldstart-jobs                 # copy database_id into wrangler.toml
npx wrangler d1 migrations apply coldstart-jobs --remote
npx wrangler r2 bucket create coldstart-assets
npx wrangler queues create coldstart-jobs-q && npx wrangler queues create coldstart-jobs-dlq
npx wrangler secret put API_KEY          # random 32+ chars, also PIPELINE_API_KEY in Vercel
npx wrangler secret put CRON_SECRET      # random 24+ chars, also CRON_SECRET in Vercel
# set APP_URL in wrangler.toml to the Vercel preview URL, then:
npx wrangler deploy
```
Create an API token with **D1:Edit** only (account-scoped) for the app's store. Put `CF_ACCOUNT_ID`, `D1_DATABASE_ID`, `CF_API_TOKEN` in the Vercel project (Preview env), not in git.

## 2. Prove the store (Test A)
```
CF_ACCOUNT_ID=... D1_DATABASE_ID=... CF_API_TOKEN=... node scripts/verify-store.mjs --backend d1 > evidence-d1.json
```
Passes only if: restart persistence, 100 concurrent increments = 100, exactly one `setnx` winner, 100 concurrent reservations against a cap of 10 grant exactly 10, workspace isolation. The same script passes today on the local SQLite store (self-test), so a D1 failure would point at D1 REST behaviour, not the script.

## 3. Vercel preview
```
vercel link && vercel env add ... (Preview)   # SESSION_SECRET, CRON_SECRET, CF_*/D1_*, COMPOSITE_API_URL, COMPOSITE_KEY, X_*, META_* as available
vercel deploy                                   # preview, not production
BASE_URL=https://<preview-url> CRON_SECRET=... node scripts/staging-smoke.mjs > smoke.json
```

## 4. Compositor hosting decision
Measured locally (not on any host): peak RSS 762 MB, ~1 s cold, ~0.6 s warm per 1080×1350 composite; dependency bundle 507 MB.

| Option | Fits? | Cost model | Verdict |
|---|---|---|---|
| Vercel Python function (standard) | No: 507 MB > 500 MB limit | n/a | Out |
| Vercel Large Functions (beta, up to 5 GB) | On paper yes | Active-CPU billing; not verified | Test only if the owner wants one vendor |
| Cloud Run container (`workers/composite/Dockerfile`) | Yes: 1 vCPU / 1–2 GiB | $0.000018/vCPU-s + $0.000002/GiB-s, free tier 180k vCPU-s + 2M requests/month (Google's published price page, us-central1 tier 1) | **Cheapest candidate**: about $0.00002–0.00004 per composite warm, $0 inside the free tier |
| Fly.io / Render container | Yes | monthly instance price | Alternative |

Decision rule (agree before choosing): p95 end-to-end ≤ 8 s including cold start, error rate < 1% over 50 composites on real photos, cost ≤ $0.01 per composite. Deploy the container with min instances 0, concurrency 1–2, then run `scripts/staging-smoke.mjs` plus the real-photo harness (`scripts/validate-images.mjs`). Whichever host meets the rule at the lowest cost wins; this has NOT been measured on a host.
```
gcloud run deploy coldstart-composite --source workers/composite --region <r> --memory 2Gi --cpu 1 --concurrency 2 --min-instances 0 --set-env-vars COMPOSITE_KEY=<random>
```
Then set `COMPOSITE_API_URL` (+ `COMPOSITE_KEY`) in Vercel.

## 4b. X (Test C/D)
Create an X developer app. Two separate credentials: **app-only bearer token** (`X_BEARER_TOKEN`, read/search/counts) and **OAuth 2.0 user-context** (`X_CLIENT_ID`, `X_CLIENT_SECRET`; scopes `tweet.read tweet.write users.read offline.access`) connected through Settings → Connections with a **designated test account**. Set `X_ALLOWED_ACCOUNT=@that_account`, `X_PUBLISH_ENABLED=1`, `PUBLISH_DAILY_CAP=3`, `X_MAX_POSTS_READ_PER_DAY=200`, and `X_COST_PER_POST_USD` from your plan's price list. Set a spending limit in the X developer console.

## 4c. Meta (Test E)
Create a Meta app, add a test dataset, generate a Conversions API token and a Test Events code (Events Manager). Connect through the app's Meta connection. For Page/Instagram publishing set `META_PAGE_ID` to a designated test Page and `META_PUBLISH_ENABLED=1` only after App Review grants `pages_manage_posts` / `instagram_content_publish`. Ad drafts stay PAUSED; creating one needs Settings → Automations → budget allowed, plus `META_MAX_DAILY_BUDGET`.

## 4d. Background generation (Test B)
`BACKGROUND_PROVIDER=cloudflare`, `CF_ACCOUNT_ID`, `CF_AI_TOKEN` (Workers AI permission).
