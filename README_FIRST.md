# READ ME FIRST — Cold Start_ status (feat/creative-editor)

_Last updated: 24 Nov 2026_

## What is live right now

| | |
|---|---|
| **Production URL** | https://coldstart-swart-chi.vercel.app (Vercel login protected; share links needed for outsiders) |
| **Live deployment** | `dpl_E2J12A7u5cD4KUQ59qKyzPTxexiX` — READY |
| **Live commit** | `b3bb604` on branch `feat/creative-editor` (deployed directly from this branch; **not merged to main**) |
| **Vercel project** | `coldstart` (`prj_BVJ4sF9Z9svW2fXKbbaFUaQ8Npu8`) |
| **Database** | Neon project `small-thunder-87278305`, `main` branch (Production); `preview` branch for Preview |
| **Rollback target** | `dpl_CnynRjmR8AQFjP5VFK311VnLp3gN` (commit `5ee1010`) — promote it in Vercel to roll back |

## How it got there (deploy procedure)

Git pushes do **not** auto-deploy Production (Ignored Build Step:
`[ "$VERCEL_ENV" = "production" ] && exit 0 || exit 1`). To deploy:

1. Push the branch to GitHub (`git push origin feat/creative-editor`).
2. In Vercel, temporarily clear the Ignored Build Step, create a Production deployment from the exact commit, wait for READY.
3. Restore the Ignored Build Step command above.
4. After changing environment variables, redeploy the same commit (env changes only apply to new deployments).

## What is on this branch (Creative Engine)

Studio flow: **Rewrite copy with AI → Generate layout prototypes (free) → Approve these 3 layouts → Generate 3 final ads → checks + AI review → Approve (per ad) → Edit → Export PNG.**

- **Product Lock**: the image model only paints an empty scene; the original product pixels are composited by the Python compositor (`api/compose/[op].py` → `workers/composite/`). Protected pixels are verified unchanged.
- **Cutout fixes** (`workers/composite/maskfix.py`): fills holes in opaque packaging (flagged for review), removes source-shadow haze.
- **Grounding** (`workers/composite/ground.py`): contact shadow following the real base, cast shadow from measured light/camera, surface-adaptive, limited to the support.
- **Pipeline UI**: `js/adpipe-v4.js`, `js/app-v4.js`, editor `js/creative-editor-v4.js` (briefs + scene compatibility specs).
- **Server**: `lib/plugins/images.js` (generation, vision placement `locate`, `critique`, ledger, budget, compositor tokens), `lib/gemini-image.js` (OpenRouter), `lib/onboard/intel.js` (copy, drafts, approval gate).
- **Approval gate**: blocked if pixels changed, cutout needs review, text issues, or the reviewer has blocking issues (override needs a written reason).

## Who can use it (feature gate)

The Creative Engine is **off for everyone in Production except allowlisted workspaces**:

| Env var (Production) | Value / meaning |
|---|---|
| `CREATIVE_PIPELINE_WORKSPACES` | `FlmfihaYw1EuSlh8` (test workspace only) — comma-separated list |
| `CREATIVE_PIPELINE` | unset. `on` = everyone, `off` = nobody |
| `CREATIVE_BUDGET_USD` | `3` — per-workspace spend cap (reserved before each paid call) |

Other workspaces see "Ad generation is paused…". To enable a workspace: get its id from
`/api/plugins/images/actions/ledger` (`"workspace"`), add it to the allowlist, redeploy.

## Security

- Browser → compositor calls need a 10-minute HMAC token from `images/composeToken` (signed with `SESSION_SECRET`), only for enabled workspaces, 40/day.
- Server → compositor calls are blocked by Vercel Deployment Protection (bypass deliberately not enabled).
- Secrets live only in Vercel env vars; never commit them.

## Costs so far (test workspace)

≈ **$0.88** confirmed of the $3 budget: 5 scene generations at ~$0.137 each (OpenRouter-confirmed) plus vision calls.
Historical $0 records were corrected and logged in the budget record's `audit` field.

## Tests

```
npm test                                   # Node + headless-browser typography + python compositor tests
python3 workers/composite/test_maskfix.py
python3 workers/composite/test_ground.py
python3 workers/composite/test_token.py
U2NET_HOME=workers/composite/models python3 workers/composite/test_composite_pipeline.py
```

## Known open issues

- No ad approved yet: the AI reviewer still flags weak contact shadows (2/5) and lighting mismatch.
- Lifestyle (B) and Editorial (C) scenes need regeneration (camera/light incompatible with the eye-level, front-lit packshot).
- Re-place "before" snapshot can exceed Vercel's 4.5 MB request limit (spotlight failed once).
- No wall (vertical surface) shadows; no manual product/shadow controls.
- Branch is not merged to main.
