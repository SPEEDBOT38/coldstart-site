# Coldstart workspace — approved scope and build contract

## Confirmed by the user
- Publishing: Reddit, X, Instagram, Facebook Pages, and the customer's Shopify website.
- Shopify is the first supported website platform. Website posts mean Shopify blog articles in this prototype.
- All three policies: per-post approval, campaign/batch approval, guarded automatic approval/publishing.
- Attached dashboard images are layout references only. Retain the approved landing page's blue/paper palette, Zen Dots/Sora/DM Mono, frame and restrained dither.
- Do not modify the approved landing page.

## Product and surface
An operate-first marketing workspace, not a sequential wizard. Research, content and scheduling run concurrently. Sidebar: Overview, Research, Studio, Calendar, Ads, Results, Tracking, Connections. Brand settings in the workspace footer. Contextual inspector rather than a permanent large mascot console.

## Workflows
1. Research: Reddit/X conversation list -> evidence inspector -> saved reference -> platform draft. Tabs separately cover product category and named-brand competitors, with Instagram organic and Meta paid evidence separated. All records in this build are prominently fictional fixtures, never represented as actual research.
2. Crawl preview: user starts an explicitly simulated scan. Animated page nodes/links and collection steps; cancel, complete and reduced-motion states. No fabricated live progress or real-network claims. Graph animation depicts crawling; existing competitor scanner mascot is only used on competitor research.
3. Studio: campaign and platform selector, editable draft, evidence reference, platform-specific preview, media/rule prerequisites, approval. All five platforms are represented.
4. Approval policy: manual per-post, batch review/approval, or explicit guarded automation; platform allowlist, daily cap and evidence rule. Policy changes must not silently approve old content. Editing approved content invalidates approval/schedule. Auto rules do not bypass destination capabilities or community checks.
5. Calendar: week and list layouts; date navigation; timezone and platform filters; click a post to inspect, edit, schedule/reschedule, cancel or simulate a publishing outcome. Failed/held work is clearly differentiated; a retry must not duplicate successful publication. Queue pause separate from paid-ad pause.
6. Tracking: Shopify domain -> simulated store connection -> guided Meta sales-channel installation preview -> dataset selection -> consent/config review -> simulated event diagnostics. Connected is not installed, installed is not verified. No real plugin installation or authorization.
7. Connections: explicit simulated connect/disconnect for all five destinations. Holds scheduled content when access is unavailable; restores only eligible work. Explain production permission requirements, do not request secrets.
8. Ads: separate local draft/review controls and paid-ad pause. No money spent and no real campaign creation.
9. Results: sample series and explanatory measurements; no claims of live attribution. Unavailable measures are not zeros.

## Scope boundary
This is a complete interactive UI prototype with local browser storage and deterministic sample data. It does not implement crawlers, OAuth, API publishing, background scheduling, ad spending, Shopify installs or actual Meta tracking. Production integration requires backend jobs, platform approvals/permissions, server-side token storage, reliable retries and event ingestion. Never show a sample simulation as live integration success.

## Layout decisions from references
Keep: persistent sidebar, work-centered overview, research list + inspector, large calendar + selected-post details.
Reject: reference dark/neon palette, large ungrounded growth metrics, duplicated navigation, decorative permanently-running agents, percentage progress without a measurable total, mascot occupying every inspector.

## Asset placement
| Surface | Asset | Meaning |
|---|---|---|
| Overview | idle_stand still | Quiet identity, not fake work |
| Research scan preview | New animated page-node SVG | Crawl/collect a simulated set of sources |
| Competitor tab | competitor_scan clip | Inspect comparison cards |
| Shopify tracking | pixel_setup clip | Tracking setup demonstration |
| Studio / Calendar | Content previews and status glyphs | No unrelated mascot moods |

## Verification
- Browser acceptance flows, console/resource errors, storage persistence, keyboard/dialog escape.
- Desktop 1440x960, tablet 1024x768, phone 390x844; all routes, no horizontal overflow.
- Unit tests for approval, schedule, holds, edits, cancellation and idempotent simulated publishing.
- Hash comparison of v2.html, css/v2.css, css/tokens-v2.css, js/v2.js, js/dither.js, js/main.js against preview/workspace/landing-baseline.json.

## Platform reference checked during requirements
Shopify's Meta Pixel help describes configuration through Facebook and Instagram by Meta. Shopify's GraphQL articleCreate documentation covers blog article creation; it is the production integration direction, not an implemented API here.

Documentation references:
- `https://help.shopify.com/en/manual/promoting-marketing/analyze-marketing/meta-pixel/`
- `https://help.shopify.com/en/manual/promoting-marketing/analyze-marketing/meta-data-sharing`
- `https://shopify.dev/docs/api/admin-graphql/latest/mutations/articleCreate`


## UX research round 2 (applied)
Researched category tools before this pass; findings that changed the UI:

- **Reddit audience research (GummySearch-style)**: discovery is organized by audience *themes and intent* (pain, buying intent, feedback), not raw keyword lists. → Conversations tab now has intent filters with counts, topic chips, per-signal relevance + engagement context, and community-rule notes surfaced at draft time (self-promo windows matter before posting).
- **Ad research tools (Foreplay/Spyder-style swipe files)**: value comes from *saved teardowns* — hook, format, observed duration, CTA/destination — kept as a library next to your own drafts. → Brand competitors tab now has 6 teardown cards (IG organic vs Meta Ad Library kept separate), brand/channel filters, save-to-evidence and one-click "draft an angle".
- **Approval workflows (Planable-style)**: approval mode is a property of the workspace/campaign, always visible while editing — not buried in settings. → Studio has a persistent policy ribbon (Each post / Batch / Guarded auto) with rules in a dialog; switching modes never approves or publishes existing drafts.
- **Publishing calendars**: pipeline stage filtering and filling empty slots from approved work is the standard job. → Calendar has a stage ribbon (clickable counts) and "+ schedule" quick-slots on open days.
- **Shopify tracking reality**: duplicate pixels from hardcoded theme snippets, and browser/CAPI deduplication via shared event_id, are the two issues that actually bite. → Tracking has a plugin stack (sales channel, Customer Events, Pixel Helper, theme conflict scanner) and a browser↔CAPI dedup table with inspectable payloads; Purchase deliberately stays "not observed".

Verification this round: engine 14/14, browser suite 40/40 (incl. the 6 new UX checks), flow suite 30/30, zero console errors, 9 routes at 1440px and mobile captures without horizontal overflow. Landing files hash-identical to baseline.

Sources for this round:
- https://parsestream.com/gummysearch-review
- https://admanage.ai/blog/foreplay-vs-magicbrief
- https://help.planable.io/hc/en-us/articles/21715325828380-How-to-set-up-your-agency-in-Planable
- https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event
- https://attribuly.com/blogs/diagnose-shopify-meta-pixel-capi-purchase-undercounting/


## Component system (round 3)
Every repeating UI piece now has exactly one home. `components.html` is the living shelf:
- **CSS home**: one block per component in `css/workspace.css` (linked `?v=2` to defeat stale caching).
- **JS home**: a `C` factory layer in `js/workspace.js` (row, stat, insight, empty, seg, panel) beside the existing `btn/link/badge/platform` helpers. Views compose factories; they no longer hand-roll rows, stats, empties or segmented groups.
- **Placement rules** are on the shelf itself (10 bins + a component→home→usage→rule map). Rows are for scanning, cards for inspecting; one blue note per view; insight blocks keep their disclaimer; sample data always wears the dashed badge; dithered bar edges mean sample numbers.

Cleanup this round: removed 12 dead CSS rules (tag-cloud, task-line, trace, status-dot, section-title, spacer, toggle-note, field-label, inline-link, badge.pending…), guarded the two-column stacks with `minmax(0,1fr)`, and made `.result-row` collapse earlier — which fixed a real 762–900px tablet overflow on Results that the refactor surfaced. Stylesheet is now cache-versioned.

Verified: engine 14/14 · browser 40/40 at 1440×960 · flows 30/30 · zero console errors · all 9 routes at 1440/1024/820/762/390 with zero horizontal overflow. Landing hash-identical to baseline.
