# Capabilities

Each capability lists what it uses, in fallback order, and what it costs. Every scan and draft is also capped per day so the public URL can't drain the credits (`RESEARCH_DAILY_SCANS`, default 60; `AI_DAILY_CALLS`, default 300; plus per-IP hourly caps).

| Capability | Where in the app | Providers (first that works wins) | Typical cost |
|---|---|---|---|
| Listen: Reddit, X, Instagram | Research → Conversations → **Run live scan** | treg routed search (`anyapi.reddit.search`, `treg.x.search.posts`, `treg.instagram.hashtag.posts`) → Firecrawl web search (`site:` query) | treg: $0.001–0.015 per source · Firecrawl: ~2 credits |
| Tag + summarise | Same scan: intent, topic, match %, insight, angle, themes | Gemini Flash-Lite (`GEMINI_API_KEY`) → Gemini via OpenRouter → keyword heuristic (labelled) | ≈ $0.003 per scan |
| Competitor ads | Research → Brand competitors → **Pull Meta Ad Library** | treg `meta-ad-library.meta-ads.library.search` (Graph `ads_archive`, free) | free on treg |
| Ad teardowns | Same pull: hook, observed, gap, angle, competitor table | Gemini Flash-Lite | ≈ $0.002 |
| Drafting | Studio → New draft → **Write with Gemini**; editor → **Rewrite with Gemini** | Gemini Flash → OpenRouter Gemini | ≈ $0.001 per draft |
| Publishing | Studio → approved post → **Publish now** | Reddit and X plugins (OAuth). Sandbox until `REDDIT_*` / `X_CLIENT_ID` are set | platform-free |
| Pixel + CAPI | Tracking | Meta plugin (see META-SETUP.md) | free |

## Keys

```
TREG_TOKEN=          # treg.to → sign in (GitHub) → team API key. New accounts get $1.00 credit once.
GEMINI_API_KEY=      # aistudio.google.com/apikey. Used before OpenRouter when present.
GEMINI_MODEL=gemini-flash-latest          GEMINI_FAST_MODEL=gemini-flash-lite-latest
OPENROUTER_API_KEY=  # fallback route to the same Gemini models
OPENROUTER_MODEL=google/gemini-3.7-flash  OPENROUTER_FAST_MODEL=google/gemini-3.5-flash-lite
FIRECRAWL_API_KEY=   # web-search fallback for Reddit / X / Instagram
```

Set them in Vercel with `vercel env add <NAME> production` (the command prompts for the value, so it never lands in shell history), then `vercel deploy --prod --yes`. Locally, add them to `.env`.

## Honesty rules the code enforces
- A source with no provider returns `needs_setup` with the missing key. No sample rows are mixed into live results.
- Web-search rows have no engagement numbers, and the UI says "Found via web search · no engagement data".
- Without an AI key, tags come from keyword rules and the scan says `ai: heuristic`. Drafting refuses rather than producing filler.
- Ad Library visibility is never presented as performance (no ROAS, no spend).

`node scripts/smoke.mjs "your question" [--ads]` runs a real scan and two drafts with the keys in `.env`.
