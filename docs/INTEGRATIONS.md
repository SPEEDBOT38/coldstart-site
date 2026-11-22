# Integration contracts

None of these has been run against a live account in this build. "Tested" means a mocked transport only.

## Rules for every adapter
Secrets come from server environment variables only (never the browser, never the store). Every call carries the workspace id and writes to the hash-chained audit log. Errors are classified retryable (429, 5xx, network) or not (4xx); retries use exponential backoff with jitter (`lib/providers/retry.js`). A missing credential returns `blocked`/"Not connected", never a silent mock. Production never substitutes a mock; the sandbox is opt-in and labelled.

## Meta Marketing API (`lib/providers/meta-ads.js`)
SDK `facebook-nodejs-business-sdk` (Platform License; review before commercial use). Scopes: `ads_management`, `ads_read`, `business_management`; Instagram and Pages publishing additionally need `pages_manage_posts`, `instagram_content_publish`, which require Meta App Review. Calls: campaign (PAUSED, objective mapped), ad set (daily budget in minor units = monthly / 30, country targeting). Retry on codes 4, 17, 32, 613, 80004. Rate limits: respect `X-Business-Use-Case-Usage`. Not implemented: creatives, ads, activation. Env: `META_APP_ID`, `META_APP_SECRET`, per-workspace token via the connect flow. Status: tested with mocked transport only.

## Facebook/Instagram organic, X, Reddit
Missing a gated publish path. Required before enabling: an `approvals.execute` branch per channel that re-verifies the payload hash, writes an execution record keyed by approval id, and refuses duplicates. X needs OAuth 2.0 user context with `tweet.write`; Reddit needs a script/web app with `submit`. Both enforce per-app rate limits and may require paid API tiers.

## Cloudflare (Workers, D1, R2, Queues) (`workers/pipeline/`)
Written, not deployed. `wrangler.toml` lists the bindings; `schema.sql` mirrors the job record; `worker.js` accepts `POST /jobs` (bearer `API_KEY`), de-duplicates on `UNIQUE(ws, idempotency_key)`, consumes from the queue, calls the GPU service, stores output in R2 under `ws/jobId`, and sets `validating`. Every query filters by `ws`. Retries: queue `max_retries=3` plus a dead-letter queue. The Vercel app does not call it yet; wiring is `lib/ops/jobs.js` `run()` → HTTP POST, then polling `GET /jobs/:id?ws=`.

## Hosted GPU / segmentation
Expected `POST {GPU_API_URL}/v1/generate` returning an image and an `x-model` header. No segmentation endpoint is defined yet; logo, protected-region and shape checks stay "Unverified" until one exists. 429/5xx are retryable.

## AI router
Research and planning use OpenRouter (`OPENROUTER_API_KEY`) when set; otherwise features say "Not connected". No spend limit exists at the router; limits are enforced here per workspace.

## Checkpoint 3 environment variables
| Variable | Purpose | State without it |
|---|---|---|
| `STORE=sqlite` / `SQLITE_FILE` | Durable local store | memory/file fallback |
| `CF_ACCOUNT_ID`, `D1_DATABASE_ID`, `CF_API_TOKEN` | D1 store | not used |
| `X_BEARER_TOKEN` | X search/counts | X source reports requires_credentials |
| `BACKGROUND_PROVIDER=cloudflare`, `CF_ACCOUNT_ID`, `CF_AI_TOKEN` | FLUX background generation | procedural backdrop only |
| `COMPOSITE_API_URL` | Pixel-locked compositor service | Fidelity-first mode disabled |

Costs so far: $0 of provider spend. Nothing was called against X, Reddit, Meta, Cloudflare or Vercel.

## Checkpoint 4 environment variables
| Variable | Purpose | Without it |
|---|---|---|
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X user-context OAuth (publishing) | publishing unavailable |
| `X_ALLOWED_ACCOUNT`, `X_PUBLISH_ENABLED=1` | designated test account + opt-in | live publish blocked |
| `PUBLISH_DAILY_CAP` | max provider posts/day/workspace (default 10) | default applies |
| `X_MAX_POSTS_READ_PER_DAY`, `SCAN_CACHE_SECONDS`, `X_COST_PER_POST_USD` | read cap (default 500), cache TTL (default 3600), price from your plan | defaults; cost shown as not reported |
| `CRON_SECRET` | authorises the Cloudflare cron call (>= 24 chars) | cron route returns 401 |
| `META_PAGE_ID`, `META_PUBLISH_ENABLED=1` | Facebook/Instagram publishing after App Review | blocked |
| `META_MAX_DAILY_BUDGET` | server cap on a draft's daily budget | no extra cap beyond the approved payload |
| `HOST` | bind address of the compositor container | 127.0.0.1 |
