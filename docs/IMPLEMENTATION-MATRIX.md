# Implementation matrix (functional MVP, v4)

Status words: **Working** = built and exercised by an automated test; **Partial** = works with stated limits; **Mocked** = only a stand-in runs; **Missing** = not built; **Blocked** = needs something outside this repo (credentials, hosted service, account).
"Tested" below means: `npm test` (134 server tests, providers mocked) and `node tests/e2e/run.mjs` (32 Playwright checks, 1440px and 390px; only onboarding scan, research scan and the image worker are mocked; OCR, compare, approvals, jobs, caps and pause run for real).

| Area | Status | Notes |
|---|---|---|
| Workspace isolation (sealed cookie, every record keyed by workspace) | Working | Cross-tenant and header-less POST refused (tests). Durable only with Upstash/KV; on Vercel without KV it is per-instance. |
| Product identity: upload, SKU/variant, refs by hash, confirmed text/logo/colours/regions, approval | Working | Approval needs the three confirmations. Identity change or widening an allowed alteration voids it (`needs_reapproval`). |
| Allowed alterations (background, relight, recolour, viewpoint) | Working | Off by default; server rejects anything the master does not allow (403); viewpoint flagged as synthesized. |
| Image comparison (slider, side-by-side synced zoom/pan, findings, approve/reject/regenerate background/report) | Working | Approve gated by a "compared it" checkbox and by failed QA. Never says "verified" unless every check passes, and even then says review is still required. |
| Packaging-text check | Partial | Real OCR (tesseract.js, vendored). Mismatch below 90% similarity fails; 90–97% is "unverified". Fidelity depends on photo quality. |
| Colour check | Working | CIEDE2000 palette check (culori). |
| Fidelity-first (pixel-locked) composite | Partial | `workers/composite` (rembg u2netp + Pillow) is exercised for real by `tests/composite.integration.test.mjs` and the Studio e2e: protected product pixels are compared with the locked foreground from the output image (480,778 px, 0 changed on the fixture). Background is procedural (no generator connected). Only a synthetic fixture was tried: glossy, transparent and tiny-text products are untested. Needs a host for the Python worker (not Vercel). Still needs human approval. |
| Logo match, segmentation model quality, shape check | Blocked | Always shown "Unverified". Needs a hosted segmentation/GPU service.  |
| Job queue: states, cost, model, workflow version, retry, cancel, idempotency | Partial | All states and rules enforced server-side and tested. Executor runs inline in the request; the Cloudflare Queues consumer in `workers/pipeline` is written but never deployed or run. Storage is durable only with KV. |
| Server-side limits | Working | Pause (423), research/day and renders/month caps (429). Ad-spend cap is **not** backend-enforced (removed from the UI rather than faked). |
| Onboarding: flagship, variant, price, checkout URL, approval policy, Accept plan, persistence, recovery | Working | Scan is mocked in tests; the live scan needs a Firecrawl key. Confirmed info is not re-asked. |
| Approvals bound to payload (RFC 8785 JSON → SHA-256), actor, time, scope | Working | Server re-hashes before execute; mismatch voids the approval. Revoke only before execution. |
| Pause All | Working | Blocks new generations, research and launches. Does not touch already-published content (there is none in this build). |
| `prompt()` | Working | Replaced by dialogs with validation (test asserts no native dialog). |
| Meta campaign draft | Partial | Creates a PAUSED campaign and ad set through the official SDK. Tested against a mocked transport. Blocked from live use: no Meta app or token here. Creatives and activation are not implemented (by design). |
| Meta sandbox | Working | Marked "simulated, nothing exists on Meta". Terminal and duplicate-safe. |
| Facebook/Instagram organic publishing | Missing | Existing plugins only; not wired to the approval gate in this pass. |
| X, Reddit publishing | Missing | `lib/plugins/x.js` and `reddit.js` are read/research code from earlier versions; no approved-publish path. `twitter-api-v2` is installed but unused. |
| Shopify | Blocked | No store connected. |
| Hosted GPU, AI router | Blocked | Contract only (`docs/INTEGRATIONS.md`). Image generation uses the configured provider URL; tests use a mock. |
| Results (live metrics) | Missing | Shows "Not connected" until an ad account is connected. |
| A11y | Working | axe (WCAG 2.0/2.1 A and AA) has no serious or critical findings on six key screens, desktop. Keyboard: Ctrl+K palette, Escape closes dialogs. |
| Responsive | Working | No horizontal overflow on 11 screens at 390px. |
| 55-screen specification | **Not claimed complete** | Only the journeys above were exercised. |

## Added in checkpoint 2 (status labels: verified_live | tested_sandbox | mock_only | requires_credentials | requires_approval | not_implemented)
| Area | Status | Notes |
|---|---|---|
| Publish outbox (`lib/ops/outbox.js`) | Working (mock_only against providers) | Authorization bound to the content hash; attempt persisted before the write; timeouts/unreadable posts become `unknown_external_state` and are never retried blindly; Pause All and the organic switch block the call; idempotent creation; cancel-after-publish refused. 11 tests, provider mocked. |
| ProviderAdapter contract (`lib/providers/adapters.js`) | Working | `status/publish/verify`. X: coded, **mock_only** (no live post). Facebook, Instagram: not_implemented. Reddit: requires_approval (assisted mode only). |
| Transactional quotas / ledger (`lib/ops/ledger.js`) | Working, local-only | Atomic reserve (SETNX idempotency + INCRBY, undone on cap breach) → execute → settle/release, each exactly once. Bucket `ai_api` only; ad spend and subscription are never summed in. 100-concurrent test passes on memory and SQLite. Upstash and D1 paths are coded but not run live. |
| Durable store (`lib/store.js`) | Working locally (SQLite); D1/Upstash adapters contract-tested against fakes | `STORE=sqlite` uses `node:sqlite` (WAL). D1 REST adapter uses identical SQL; never run against a real D1. |
| Social intelligence (`lib/social/*`) | Logic working, tested on fixtures; **no live X/Reddit data** | Keywords → search → evidence → dedupe → clusters → baseline-window trends → region basis → eligibility gate → explainable score. X source needs `X_BEARER_TOKEN` (requires_credentials). Reddit is assisted/manual only (requires_approval). |
| Draft → approve → schedule → publish (`js/social-v4.js` + outbox) | Working in the browser (e2e), mock_only for X, manual for Reddit | Reddit result is recorded as `user_attested`, never "verified". X publish is coded against the official v2 API but never called live. |
| Meta tracking (`lib/tracking/inspect.js`) | Inspection + state machine, fixtures only | Markup detection is `markup_only` confidence. `verified` requires live-mode accepted non-test events; dedupe stays `unconfirmed` without Graph diagnostics. No ops UI beyond the ops actions. |
| Background generation (`lib/providers/background.js`) | Interface + Cloudflare FLUX adapter, **requires_credentials** | Endpoint/payload read from the official model page; never called. Backgrounds are generated without the product, then composited pixel-locked. |
| Scheduled scans (cron) | Not implemented | Scans run on demand, bounded and ledger-metered. |
| Product Lock video, Results from real insights | Not implemented | |
