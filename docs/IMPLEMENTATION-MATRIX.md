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
| Logo match, protected-region pixel check, segmentation, shape check | Blocked | Always shown "Unverified". Needs a hosted segmentation/GPU service. Fidelity-first (pixel-preserving) mode is Missing for the same reason. |
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
