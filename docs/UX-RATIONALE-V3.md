# Coldstart v3 UX Rationale & Architecture Documentation

## 1. Overview & What Changed
Coldstart was redesigned end to end into a new, non-destructive **v3 suite** consisting of:
- **`v3.html`** (replacing/advancing `v2.html`): Marketing landing page with interactive problem simulation, live capability matrix, and direct onboarding links.
- **`onboarding-v3.html`** (advancing `onboarding.html`): 8-quest gamified onboarding with MetaCroc runner, 94% live-scan progress cap, honest Instagram disclosure, and mobile-first responsiveness down to 360px.
- **`app-v3.html`** (advancing `app.html`): Operate-first workspace elevating **Tracking / Meta Pixel + CAPI** as the hero post-onboarding job, paired with research, studio drafting, calendar, ads, results, and connections.
- Existing files (`v2.html`, `onboarding.html`, `app.html`, `lib/app.js`, `lib/plugins/*`, `tests/*`) were kept intact to preserve backwards compatibility and ensure existing contracts remain unviolated.

---

## 2. Key UX & Architectural Decisions

### A. The Marketing Site (`v3.html`, `css/v3.css`, `js/v3.js`)
1. **Direct Funnel Connection:**
   - Previous versions of the landing page had no direct, functional CTA link into `onboarding.html`. In v3, the primary top CTA, sticky bar CTA, hero action, and bottom banner lead directly into `onboarding-v3.html`, while secondary CTAs invite visitors to inspect `app-v3.html#/tracking`.
2. **Interactive "One Order Counted 3×" Simulator (`#problem`):**
   - Directly visualizes the core insight: how a single ₹1,499 Shopify purchase gets counted 3 times by Meta when an unverified store has a hardcoded theme snippet, a duplicate channel pixel, and a server webhook without a shared `event_id`.
   - Toggleable to "Coldstart Verified (1× Deduplicated)", proving how Shopify Customer Events and the server CAPI relay share `event_id = order_<id>` to achieve a 100% accurate deduplication rate.
3. **Hard Honesty Contract (`#capabilities`):**
   - Explicitly categorized and filterable table badges:
     - **LIVE:** Store scan (`/products.json` + Firecrawl + Gemini ICPs), market research (`treg` + Gemini), Ad Library search, Studio Gemini writing + Workers AI post images, Meta CAPI token path.
     - **SANDBOX:** Meta Facebook Login OAuth, Shopify OAuth + webhook link, Reddit/X direct publishing.
     - **SAMPLE / BROWSER-LOCAL:** Fern & Form workspace, approval/calendar engine, paid ad review drafts, Results session trends.
     - **NOT IMPLEMENTED:** Instagram profile reading during onboarding (clearly reported as not read, never guessed).
4. **Pre-Revenue & Engineering Proof:**
   - Zero fabricated customer quotes or inflated ROAS figures. Demonstrates integrity via 116+ automated unit/API tests, AES-256-GCM sealed cookies, daily server budget caps, and strict human approval gates.

---

### B. Gamified Onboarding (`onboarding-v3.html`, `css/onboarding-v3.css`, `js/onboarding-v3.js`)
1. **8 Clear Quests with XP & Levels:**
   - Level 1 *Cold Start* → Level 2 *Warming Up* → Level 3 *Getting Traffic* → Level 4 *Pixel Perfect*.
2. **MetaCroc Runner During 15–25s Live Scan:**
   - Interactive game with visual obstacle legend: pink boxes (duplicate pixels), pink bars (rejected ads), and yellow stars (conversion events).
   - Includes accessible "Watch instead" autopilot and "Fast-forward" controls for users who prefer skipping the arcade layer.
   - Progress bar strictly caps at 94% until the live API returns and minimum play duration elapses.
3. **Mobile & Form Factor Polish:**
   - Rail automatically collapses into a compact horizontal stepper on viewports `<1180px` and stacks on mobile `<860px` down to 360px without horizontal overflow.
4. **Handoff Contract (`coldstart.handoff.v1`):**
   - Level 8 exports clean brand data, products, ICPs, and Brand Book into `localStorage.setItem('coldstart.handoff.v1', ...)` and navigates the founder directly to `app-v3.html#/tracking?from=onboarding`.

---

### C. Workspace Operating System (`app-v3.html`, `css/workspace-v3.css`, `js/workspace-v3.js`)
1. **Tracking Hero (Job #1):**
   - Placed at the top of the workflow hierarchy. Emphasizes the 3-Gate Signal Progression: *Connected → Installed → Verified*.
   - Includes a dedicated Browser ↔ Server CAPI Deduplication Inspector covering `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, and deliberately unverified `Purchase` until a live test event is sent.
2. **Operate-First Navigation:**
   - Overview (Command Center + Coldie Shift Trace), Tracking (Hero), Research (Conversations, Competitors, Category, Saved), Studio (5 Destinations, Approval Policy Ribbon, Gemini writing, AI images), Calendar (Week/List layouts, Timezones, Quick Slots), Ads (Local review drafts with independent pause), Results (Sample traffic series), Connections (Plugin cards + local simulator), and Brand context.
3. **Invariable Human Approval Gate:**
   - Editing any approved post immediately strips its approval and unschedules it. Nothing ever auto-publishes or auto-spends budget.

---

## 3. Comprehensive State Inventory Across Surfaces

| Surface | State | Visual Representation & System Behavior |
|---|---|---|
| **Marketing (v3.html)** | Loading | Dithered wipe preloader with animated Coldie, progress counter, and fallback timeout. |
| **Marketing (v3.html)** | Live | Interactive 3× simulator running in browser, health badge probing `/api/health`. |
| **Marketing (v3.html)** | Error | Form validation feedback on malformed founder emails, graceful offline banner. |
| **Onboarding** | Initial (Quest 1–3) | Clean, high-contrast form panels, live category benchmark chips, tag box. |
| **Onboarding** | Scanning (Quest 4) | MetaCroc canvas active, telemetry log streaming, progress capped at 94% until API returns. |
| **Onboarding** | Live Scan Success | Real Shopify products with photo URLs, site-derived palette, Gemini-grounded quotes. |
| **Onboarding** | Scan Fallback | Clear "Simulated Preview" badge, deterministic sample products and ICP archetypes. |
| **Workspace** | Tracking: Connected | Mode badge (Live vs Sandbox), account details, Graph version, token renewal status. |
| **Workspace** | Tracking: Installed | Storefront & Customer Events code blocks with copy-to-clipboard, webhook link status. |
| **Workspace** | Tracking: Verified | Test event response with `events_received`, 7-day dataset counts, dedup log. |
| **Workspace** | Studio: Draft | Status badge "Draft", copy editor active, preflight warning on missing prerequisites. |
| **Workspace** | Studio: Approved | Status badge "Approved", preflight green, eligible for scheduling or local publish. |
| **Workspace** | Studio: Held / Paused | Status badge "Held" when queue paused or channel disconnected, error banner displayed. |
| **Workspace** | Results: Sample | Dithered bar charts, ROAS marked as "— (Attribution not connected)", sample disclaimer. |
