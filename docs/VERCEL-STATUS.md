# Coldstart on Vercel — what's deployed, what works, what it's built on

**Checked:** 18 Nov 2026, live against production.
**Production URL:** https://coldstart-swart-chi.vercel.app (aliased; latest deploy `coldstart-3m4gg435a-...vercel.app`, 5h old at check time)
**Vercel project:** `rvit21bcs025rvitm-rveieduins-projects/coldstart`
**Repo:** `C:/Users/divya/coldstart-site` — last commit `57b2c2d` (7 commits total; **uncommitted local changes exist** on top — see "Deploy drift" below)

---

## 1. Environment variables actually set on Vercel (production)

Checked with `vercel env ls production`. Only these 5 exist — everything else in the code's `optionalEnv`/`missingEnv` lists is **not configured**:

| Variable | Set? | Used by |
|---|---|---|
| `SESSION_SECRET` | ✅ | Sealed-cookie encryption (`lib/app.js`) |
| `OPENROUTER_API_KEY` | ✅ | Gemini model access via OpenRouter (`lib/ai.js`) |
| `FIRECRAWL_API_KEY` | ✅ | Site scraping + search fallback (`lib/plugins/onboard.js`, `lib/plugins/research/sources.js`) |
| `IMAGE_API_URL` | ✅ | Points at the Cloudflare Worker |
| `IMAGE_API_KEY` | ✅ | Bearer auth to that worker |

**Not set:** `GEMINI_API_KEY`, `TREG_TOKEN`, `APIFY_TOKEN`, `META_APP_ID`/`META_APP_SECRET`, `SHOPIFY_API_KEY`/`SECRET`, `REDDIT_CLIENT_ID`/`SECRET`, `X_CLIENT_ID`, `RESEARCH_DAILY_SCANS`, `AI_DAILY_CALLS`, `IMAGE_DAILY_LIMIT`, `ONBOARD_DAILY_SCANS` (these have code defaults, so their absence is fine — but the AI/data provider keys' absence changes *which* fallback actually runs, see below).

---

## 2. Plugin-by-plugin status (from `GET /api/health` and `GET /api/plugins`, live)

| Plugin | `mode` | What it's based on | Works right now? |
|---|---|---|---|
| **onboard** | `live` | Shopify `/products.json` (no key needed) + Firecrawl scrape (`FIRECRAWL_API_KEY` ✅) + Gemini via OpenRouter (`OPENROUTER_API_KEY` ✅; `GEMINI_API_KEY` not set, so it's *always* the OpenRouter route, never direct Gemini) | **Yes** — verified end-to-end on Allbirds & GoMacro |
| **research** (social listening) | `live` | Primary path wants `TREG_TOKEN` (not set) → falls back to Firecrawl web-search (✅) for Reddit/X/Instagram; tagging via Gemini/OpenRouter (✅) | **Yes, but on the fallback path.** treg (the cheaper/better routed search) never fires in prod; every scan runs through Firecrawl search only |
| **research → competitors** (named-rival Meta Ad Library pulls) | `live` (plugin registers as live) | Needs `APIFY_TOKEN` or `TREG_TOKEN` — **neither is set** | **No.** Confirmed live: calling it returns `{"status":"needs_setup","error":"Set APIFY_TOKEN or TREG_TOKEN on the server."}`. This is the one capability that's coded, tested locally, but **not actually usable in production** |
| **studio** (AI copy drafts) | `live` | Gemini via OpenRouter (✅) | **Yes** |
| **images** (FLUX/SDXL visuals) | `live` | Own Cloudflare Worker, both `IMAGE_API_URL`/`IMAGE_API_KEY` set | **Yes** |
| **meta** (Pixel + Conversions API) | `sandbox` | Needs `META_APP_ID`/`META_APP_SECRET` (OAuth) — not set | **No — sandbox only.** Snippet/event relay code exists but there's no real Meta app connection in prod |
| **shopify** (store connect / webhook) | `sandbox` | Needs `SHOPIFY_API_KEY`/`SECRET` — not set | **No — sandbox only** |
| **reddit** (publish) | `sandbox` | Needs `REDDIT_CLIENT_ID`/`SECRET` — not set | **No — sandbox only** |
| **x** (publish) | `sandbox` | Needs `X_CLIENT_ID` — not set | **No — sandbox only** |
| **treg** (routed data catalog) | `sandbox` | Needs `TREG_TOKEN` — not set | **No** — this is the dependency that would also unlock live `research`'s primary path and the ad-pull capability |

**Store backend:** `tmp-file (per instance, add KV for production)` — confirmed via `/api/health`. Means rate-limit counters, sealed sessions, and any server-side state do **not** persist across cold starts/instances. No Upstash/Vercel KV is wired in; this was a known earlier blocker that's still unresolved.

---

## 3. What a real visitor can and can't do today

**Works on production right now:**
- Land on `v2.html`, go through `onboarding.html` — real Shopify catalogue read + real site scrape + real Gemini-drafted ICPs/brand book (not simulated, when the site has a reachable domain)
- Land in `app.html` after handoff — brand/ICP/products import works
- Run a live social-listening scan (Reddit/X/Instagram) — via Firecrawl search, not treg; results are real but weaker/noisier than the treg path would be
- Generate AI copy drafts in Studio
- Generate post images (FLUX/SDXL) via the Cloudflare worker

**Does not work on production (sandbox or needs_setup):**
- Named-rival competitor ad teardowns (`research/actions/competitors`) — returns `needs_setup`, no Apify/treg token
- Any real Meta Pixel/CAPI connection, Shopify OAuth connection, or Reddit/X OAuth publish — all sandbox-simulated, no real platform account ever gets touched
- Nothing persists reliably server-side across requests (tmp-file store)

---

## 4. Deploy drift — what's in Vercel is not what's in the working tree

`git status` shows **uncommitted local changes** not yet pushed/deployed:
```
M css/workspace.css
M js/workspace.js
M lib/ai.js
M lib/plugins/research/enrich.js
M lib/plugins/research/index.js
... (plus new untracked files: lib/plugins/research/{verify,ads,ads-job,deadline}.js, several new test files)
```
These are the research-hardening changes from the most recent work session (AI model-chain rewrite, source verification, named-rival async Apify job flow, UI fixes). **The current production deployment predates all of that** — the live `research` plugin is running the *older*, less-verified version, not the code reviewed in this session. A `vercel deploy --prod --yes` has not been run since these edits landed.

---

## 5. Net summary

| Capability tier | Status |
|---|---|
| Onboarding (real store/site read + AI brand book) | **Live, working** |
| Social research (Reddit/X/IG) | **Live, working, on the weaker fallback provider** |
| AI copy + image drafting | **Live, working** |
| Competitor ad teardown | **Code-complete, provider key missing in prod — non-functional** |
| Publishing & tracking (Meta/Shopify/Reddit/X) | **Sandbox simulation only — no real accounts connected** |
| Server-side persistence | **None — per-instance tmp file, resets on cold start** |
| Deployed code freshness | **Stale — local uncommitted fixes not yet redeployed** |

**To close the gaps:** set `APIFY_TOKEN` (or `TREG_TOKEN`) on Vercel to unlock ad-pull; set `GEMINI_API_KEY` if direct-Gemini routing (cheaper/faster than OpenRouter) is wanted; wire Upstash/Vercel KV for real persistence; obtain and set Meta/Shopify/Reddit/X OAuth app credentials to take those four plugins out of sandbox; redeploy to ship the research-hardening work already sitting uncommitted.
