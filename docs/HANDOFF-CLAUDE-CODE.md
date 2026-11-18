# Coldstart: hand-off to Claude Code (deploy, configure, verify)

Written 18 Nov 2026 by Claude (Cowork) after a full audit and live run of https://coldstart-swart-chi.vercel.app.
Repo: `C:\Users\divya\coldstart-site` (branch `master`, no git remote yet). Vercel project: `coldstart`
(`.vercel/project.json`, deployed with the Vercel CLI from this folder, not from git).

## Prompt to paste into Claude Code

```
Read docs/HANDOFF-CLAUDE-CODE.md and carry it out step by step, in order.
Work in this repo (C:\Users\divya\coldstart-site). After each step, run its "Check" and tell me the result
in one line before moving on. Stop and ask me before: creating the GitHub repo (and its visibility),
adding any paid Vercel/Upstash resource, or anything listed under "Do not". Never print, log or commit
secret values from .env or .env.local. When you finish, give me the "Report" section filled in.
```

## Where things stand

Four local commits are not in production yet. Production serves an older build (it loads
`css/onboarding.css` with no `?v=` and still shows truncated product names and a clipped "Include").

| Commit | What |
|---|---|
| `b4baba0` | Research hardening (verify, ads job, deadlines, AI chain) and its tests. Divyam's own local work, committed as it was. |
| `9c16534` | Product photos shown whole (object-fit: contain), no cut text or buttons at any width, ICP grid, ad preview with real photos, scan + level-up photo walls, workspace drafts with product photos. |
| `962ead8` | Catalogue cleanup (dedupe, drop bundle/free/gift items, in-stock first, word-boundary names), store currency from `/cart.js` (₹ not $), honest Instagram stage, **Make ad creative** (1080×1350 from the real product photo), same-origin photo fetch `POST /api/plugins/images/actions/photo`. |
| `e2ff18c` | Root `/` redirects to `/v2.html`, no plant-shop samples after onboarding (research empty state, ads from brand book), re-onboarding replaces old drafts, approval counts, research retry window, Instagram `unavailable` contract, 900px Shopify photos, a11y labels. |

Uncommitted on purpose (do not commit unless Divyam says so): `v3.html`, `onboarding-v3.html`, `app-v3.html`,
their css/js, and everything in `docs/` except this file. `.vercelignore` now excludes `/docs/` and `/scripts/`
(uncommitted change) so the VC deck, financial model and business plan are never uploaded to the public site.

Production environment (from `/api/health` on 18 Nov): onboard, research, studio, images = live.
meta, shopify, reddit, x, treg = sandbox. Store = `tmp-file (per instance)` = nothing persists.
Set on Vercel: SESSION_SECRET, OPENROUTER_API_KEY, FIRECRAWL_API_KEY, IMAGE_API_URL, IMAGE_API_KEY.
Missing: APIFY_TOKEN (in local `.env`), TREG_TOKEN, META_APP_ID/SECRET, SHOPIFY_API_KEY/SECRET,
REDDIT_CLIENT_ID/SECRET, X_CLIENT_ID, KV/Upstash.

## Steps

### 1. Preflight
- `git status --short` shows no tracked changes except `.vercelignore` and this file; `git log --oneline -4` starts with `e2ff18c`.
- `npm test` → 118 pass, 0 fail.
- Commit `.vercelignore` and this file: `git add .vercelignore docs/HANDOFF-CLAUDE-CODE.md && git commit -m "Keep docs out of deploys; Claude Code hand-off"`.
- Local smoke: `npm start`, then `curl -I http://127.0.0.1:8765/` → 307 to `/v2.html`; `curl http://127.0.0.1:8765/api/health`. Stop the server.

**Check:** tests green, redirect works.

### 2. Deploy to production
- `vercel whoami` (if not logged in, ask Divyam to run `vercel login` himself).
- Confirm `.vercel/project.json` has `"projectName":"coldstart"`.
- `vercel --prod` from the repo root.

**Check:**
- `curl -s https://coldstart-swart-chi.vercel.app/onboarding.html | grep -o "onboarding.js?v=4"` → found.
- `curl -sI https://coldstart-swart-chi.vercel.app/` → 307, `location: /v2.html`.
- `curl -s -o /dev/null -w "%{http_code}" https://coldstart-swart-chi.vercel.app/docs/Coldstart-VC-Financial-Model-INR.xlsx` → 404.

### 3. Add APIFY_TOKEN (competitor ads)
- `vercel env ls production` to see what exists.
- Add it from the local `.env` without echoing the value, e.g. in Git Bash:
  `grep '^APIFY_TOKEN=' .env | cut -d= -f2- | tr -d '\r\n' | vercel env add APIFY_TOKEN production`
  (PowerShell: `(Select-String '^APIFY_TOKEN=' .env).Line.Split('=',2)[1] | vercel env add APIFY_TOKEN production`).
- Redeploy: `vercel --prod`.

**Check:** `curl -s -X POST https://coldstart-swart-chi.vercel.app/api/plugins/research/actions/competitors -H "content-type: application/json" -H "x-coldstart: 1" -d "{\"query\":\"body lotion\",\"country\":\"IN\"}"` no longer returns `"status":"needs_setup"` with "Configure APIFY_TOKEN". (Costs a few Apify credits.)

### 4. Persistent store (Upstash Redis via Vercel)
Without this, email signups, spend caps and server state reset on every cold start.
- Ask Divyam first (free tier is enough). Then either `vercel integration add upstash` (newer CLI) or
  Dashboard → project `coldstart` → Storage → Create → Upstash for Redis → connect to all environments.
- The app already reads `KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (`lib/store.js`).
- Redeploy: `vercel --prod`.

**Check:** `curl -s https://coldstart-swart-chi.vercel.app/api/health` → `"store":"kv"`.

### 5. GitHub
- Ask Divyam: repo name and visibility (default **private**).
- Before pushing: `git ls-files | grep -iE "\.env($|\.)"` must show only `.env.example`.
- With GitHub CLI: `gh repo create <name> --private --source . --remote origin --push`.
  Without it: create an empty repo on github.com, then `git remote add origin <url>` and `git push -u origin master`.

**Check:** `git remote -v` and `git status -sb` show `master...origin/master`.

### 6. Live verification (run in a real browser, desktop + phone width)
Use `https://coldstart-swart-chi.vercel.app/` → Get early access → onboarding.

1. **Shopify store** `mcaffeine.com` (help mode, rivals Plum + Mamaearth, IG handle `mcaffeineofficial`):
   - Scan screen: Instagram stage reads "Instagram not read yet (needs a data provider) · skipped", not ✓.
   - "Found on your site" photo strip shows.
   - Shelf: no duplicate "Berries … Scrub 15 gm", no "Treat Yourself Bundle Item", prices in **₹**, full names, whole photos (no cropping), "Include" fully visible, extra-photo thumbnails switch the main photo.
2. ICPs: three cards side by side (no one-letter columns), each with "Lead products" photos.
3. Brand book: pick a Carousel ICP as main → ad preview is a swipeable carousel of real product photos; headline wraps.
4. Level up: photo wall of the shelf → **Open my workspace**.
5. Workspace:
   - Overview: "Your shelf" photo grid; "N calls to make" equals posts needing approval.
   - Studio: 8 drafts named after real products, each with its photo; **Make ad creative** builds a 1080×1350 creative (product photo, brand colours, headline, ₹ price, Shop now) and the destination preview shows it; Download works.
   - Generate image still works (images plugin live) and shows the "product is invented" note.
   - Ads: two drafts from the brand book with product photos and ₹ budgets.
   - Research: empty state "No research for MCaffeine yet"; Run live scan returns rows. Note whether Reddit and X still fail with "Search time budget exhausted" (see backlog).
   - Brand competitors: Pull Meta Ad Library (IN) returns ads once step 3 is done.
6. **Non-Shopify store**: pick any WooCommerce or custom site (e.g. a candle or apparel shop). Expect `not_shopify`, products extracted from the page, photos only where the page had them, currency guessed (INR for `.in`).
7. **No website** path ("I don't have a website yet"): flow completes on the brief alone.
8. Reload mid-flow (e.g. on Brand book) and on Level up: state resumes and the panel renders (one blank render was seen once; confirm or rule out).
9. Open DevTools console on every page: no errors.

## Do not
- Commit or print anything from `.env` / `.env.local`; never `git add -A` (the v3 files and VC docs are untracked on purpose).
- Force-push, rewrite history, or change the Vercel project link.
- Make the GitHub repo public or add paid plans without asking.
- Edit `v2.html` copy or brand tokens (blue `#0000F2`, paper `#F2F2F2`, Zen Dots / Sora / DM Mono).

## Backlog (not done yet, in priority order)
1. **Reddit/X research** — if step 6 still shows "Search time budget exhausted": Firecrawl `site:reddit.com inurl:comments` / `site:x.com inurl:status` searches exceed the window (`lib/plugins/research/index.js`, `sources.js`). Try dropping `tbs:'qdr:y'` or the `inurl:` operator for these two, lower `limit` to 10, and log per-source latency.
2. **Instagram** needs a provider (`TREG_TOKEN`) before any Instagram claim in copy.
3. **Meta app** (`META_APP_ID/SECRET` + app review) to take Pixel/CAPI out of sandbox; Shopify, Reddit, X app keys for publishing.
4. **Error logging** (e.g. Sentry or a tiny `/api/client-error` → `console.error`) so production failures are visible.
5. **Accounts**: workspace state lives in one browser's localStorage; needs sign-in + server persistence (KV/DB).
6. Results page is illustrative until Meta is connected.
7. Non-Shopify currency is only guessed from `.in`; read it from page metadata.

## Report (fill in)
- Deployed URL + deployment id:
- `/api/health` store + plugins:
- APIFY_TOKEN added: yes/no · competitor pull result:
- Upstash connected: yes/no
- GitHub remote:
- Live checks 1–9: pass/fail with one line each (screenshots of any failure):
- New issues found:
