# Reuse register

Rule: find a maintained implementation first; write only glue. **Verification limits of this checkpoint:** the build sandbox could not read the GitHub API or Hugging Face (blocked), so stars, last-commit dates and model-card licences were NOT checked. Licences marked `registry` were read from npm/PyPI today; `handoff` means copied from the handoff document and still needs a human check before commercial use. "Pinned" is the version in `package.json` / `requirements.txt`.

| Component | Source | Licence | Use in this repo | Integration | Status |
|---|---|---|---|---|---|
| Product matte | `danielgatis/rembg` (PyPI `rembg` 2.0.87, pinned in `workers/composite/requirements.txt`) | MIT (registry) | Matte for pixel-locked composites | Installed as a Python dependency inside `workers/composite/service.py`; ~120 lines of glue | **Used, tested for real** (`tests/composite.integration.test.mjs`) |
| Matte weights | `u2netp.onnx` from U²-Net (downloaded from the rembg release) | Apache-2.0 per the U²-Net project (handoff/knowledge; not re-verified) | Default model (`REMBG_MODEL=u2netp`) | Loaded by rembg | **Licence review still required**; quality on glossy, transparent and tiny-text products is untested |
| Compositing | Pillow (HPND), NumPy (BSD) | permissive | Single-resample, alpha composite, shadow | Python dependencies | Used |
| BiRefNet | `ZhengPeng7/BiRefNet` | code MIT (handoff) | Better matte candidate | Not installed. Weights host (Hugging Face) is unreachable from this sandbox | Not evaluated. Verify the checkpoint licence and training data |
| SAM 2 | `facebookresearch/sam2` | handoff: not verified | Interactive mask correction | Not integrated | Not implemented |
| OCR | `tesseract.js` (+ core, eng data), vendored | Apache-2.0 (registry: not re-checked) | Packaging text first pass in the browser | Already in v4 | Used. PaddleOCR is not added: one OCR system is enough until Tesseract measurably fails |
| Slider / zoom | `img-comparison-slider`, `@panzoom/panzoom` | MIT (existing) | Compare dialog | Existing | Used |
| Validation / canonical JSON | `zod`, `json-canonicalize` | MIT / MIT (existing) | Payload schemas, approval hashes | Existing | Used |
| Meta Marketing API | `facebook-nodejs-business-sdk` | Platform licence (existing review note) | PAUSED campaign/ad set draft | Existing adapter, mocked transport only | Not live-verified |
| X client | `twitter-api-v2` 1.31.0 (registry: Apache-2.0) | Apache-2.0 | Installed but **not** used: the existing OAuth 2.0 plugin (`lib/plugins/x.js`) already posts, and the outbox reads posts back with the same `fetch` helper | Not integrated | Candidate for search; Workers compatibility untested |
| Retry | `p-retry` | MIT (existing) | Provider retries | Existing | Used |
| FFmpeg | system `ffmpeg` binary (present in the sandbox) | LGPL/GPL depending on the build | Product Lock video | Not integrated this checkpoint. Do not use `ffmpeg-static` (GPL-3.0, registry) | Not implemented |
| `fluent-ffmpeg` | npm | MIT (registry) | Possible thin wrapper | Not installed | Not implemented |
| Postiz | `gitroomhq/postiz-app`, `postiz-agent` | AGPL (handoff) | Study only; possible separate hosted service | **No source copied.** Not evaluated: needs a hosted API key and cost check | Not implemented |
| Mochiscout | `zernonia/mochiscout` | AGPL (handoff) | Architecture reference only | No source copied | Not implemented |
| Meta Pixel GTM template, CAPI GTM tag | `meta/GoogleTagManager-WebTemplate-For-FacebookPixel`, `facebookincubator/ConversionsAPI-Tag-for-GoogleTagManager` | Apache-2.0 for the web template (handoff) | Customer-installed route | Not integrated | Not implemented (P1) |
| `meta-ads-kit`, WooCommerce plugin | `TheMattBerman/meta-ads-kit`, `meta/facebook-for-woocommerce` | handoff: GPL for the plugin | Playbooks / official plugin the customer installs | No source copied | Not implemented (P1) |
| ComfyUI, Qwen-Image, LTX-2, Wan2.2 | see handoff | not verified | Hosted GPU options | None connected | Blocked: no GPU account |
| Cloudflare Workers AI FLUX.2 | Cloudflare docs | provider terms | Pilot background generator | Not connected. The endpoint name, payload and price must be read from current Cloudflare docs first | Blocked: no Cloudflare credentials |

## Checkpoint 3 additions
| Item | Version/source | License | How used | Notes |
|---|---|---|---|---|
| `stopword` | npm | MIT | Keyword tokenising in the social pipeline | Dependency, no copied code |
| `node:sqlite` | Node built-in | n/a | Durable local store backend | Needs a Node version that ships it (device Node 24 does) |
| Cloudflare D1 REST API | Cloudflare docs | provider terms | `d1Backend` adapter, same SQL as SQLite | Contract-tested with a SQLite fake only |
| X API v2 search/counts/tweets | docs.x.com | provider terms | Search, counts-based trend baseline, publish, metrics | Coded to the official docs; mock_only |
| mochiscout, reddit-research-agent, postiz-app | GitHub | AGPL / see repo | **Study-only, no source copied** | GitHub API was unreachable from the build sandbox, so their licenses were not re-verified this checkpoint |
| Cloudflare Workers AI FLUX.1 schnell | developers.cloudflare.com/workers-ai/models/flux-1-schnell | Model/provider terms | Optional background generator | Price not shown on the model page; cost recorded as null, not guessed |

## Not reused on purpose
`@imgly/background-removal` (AGPL/commercial), `ffmpeg-static` (GPL-3.0), any AGPL/GPL source in the proprietary core.
