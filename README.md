# Coldstart

Landing page plus the Coldstart workspace (`app.html`), backed by a dependency-free Node API with plugin connectors.

## App + API

    npm start            # http://127.0.0.1:8765 — static site + /api
    npm test             # 75 unit/API tests (CAPI hashing, vault, plugins, end-to-end sandbox flow)

- `lib/app.js`: the API handler, used by `server.js` locally and `api/index.js` on Vercel.
- `lib/plugins/`: connectors. `meta/` covers Pixel/dataset setup and the Conversions API (event builder, Graph client, sandbox, relay, snippets); the others are `shopify.js`, `reddit.js` and `x.js`. See `docs/PLUGINS.md`.
- `lib/vault.js`: AES-256-GCM sealing for the connection cookie and stored tokens. `lib/store.js`: KV / file / memory store.
- `js/connectors.js`: the frontend for Tracking (Meta Pixel + CAPI) and Connections (plugins).
- `workers/image/`: Cloudflare Workers AI image API (FLUX / SDXL), deployed as `coldstart-images`.
- Live research, Gemini drafting, post images, Ad Library teardowns and publishing: `docs/CAPABILITIES.md` (keys, providers, costs).
- Going live with Meta: `docs/META-SETUP.md`. Every plugin stays in sandbox until its env keys exist (`.env.example`).

Research and Studio drafting run live through the API. Approval, scheduling and the calendar still use the browser-local state engine (`js/workspace-state.js`), and Ads campaign creation is still a local draft.

- `index.html`: the landing page, version 1 (yellow and cobalt).
- `v2.html`: version 2. Same content, with the scroll, theming, spacing and palette of the Hermes Agent
  site: one blue and one paper, a 1080px column, a framed viewport, a compact header that changes theme,
  eased wheel scrolling and a footer revealed from underneath. Uses `css/tokens-v2.css`, `css/v2.css` and `js/v2.js`.
- `app.html`: client-side product interface prototype sharing `css/tokens-v2.css` (`css/app.css`, `js/app.js`).
  Includes 7 views (`Run`, `Queue`, `Channels`, `Pixel`, `Competitors`, `Results`, `Brand`), keyboard
  triage (`j`/`k`, `a` approve, `r` rewrite, `x` drop), channel connection/pause holds, and a separate
  local-setup workspace vs. the fictional `Fernbook` sample run.
- `REFERENCE-PROMPTS.md`: ready-to-paste ChatGPT image-generation prompts for 3 scenes (`S01`–`S03`) and
  15 four-panel key-pose sheets (`A01`–`A15`), plus the asset checklist.
- `animation-brief.md`: which Coldie clips fit where, the nine new clips built and exported (`pixel_setup`,
  `ig_ad`, `reddit_post`, `x_post`, `web_post`, `competitor_scan`, `idle_stand`, `wave`, `celebrate`), and
  the remaining clips/scenes awaiting reference art.
- `design-system.html`: palette, type, dither primitives, components, cursor, clip library.
- `css/tokens.css`: colours, type scale, spacing, the four section themes (`data-theme`).
- `css/site.css`: layout and components.
- `js/dither.js`: ordered-dither engine (fields, edges, image reveal, preloader wipe).
- `js/main.js`: preloader, custom cursor, clip playback, scroll states, form.
- `assets/mascot/`: Coldie clips exported from `../cold-start-mascot/renders` (transparent WebM, animated WebP fallback, posters).
- `assets/fonts/`: Zen Dots, Sora, DM Mono (SIL Open Font License), self-hosted.

## Run it

    cd C:\Users\divya\coldstart-site
    python -m http.server 8765

Then open http://127.0.0.1:8765/. Opening `index.html` straight from disk also works, except the
room picture shows without its dither reveal (browsers block pixel access on `file://`).

## Not done yet

- The sign-up form only validates and shows a confirmation; nothing is sent or stored (`signup()` in `js/main.js`).
- Copy is a first draft.
- The hero clip shows WhatsApp and Gmail tiles because it reuses the existing hero render.
