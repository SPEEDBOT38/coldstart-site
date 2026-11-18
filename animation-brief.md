# Coldie animation brief

What the landing page needs from the mascot, checked against the nine clips that exist
(`cold-start-mascot/renders/anims`) and the hero scene (`renders/hero`).

## 1. Where the current clips are used, and whether they fit

Version 1 of the page (`index.html`):

| Placement | Clip used | Fits? | Why |
| --- | --- | --- | --- |
| Preloader | `loading_screen` | Yes | Thinking pose with a loading dot on the visor. |
| Hero | hero scene | No | The tiles are WhatsApp, Gmail, Instagram and X. Coldstart's channels are Meta, Instagram, Reddit, X and web posts. |
| Job 01, Meta Pixel | `loading_screen` | No | Generic waiting pose, nothing about a pixel. The preloader already uses it. |
| Job 02, Instagram ads | `cool_shades` | No | A mood, not an action. |
| Job 03, Reddit reach | `laugh_tablet` | No | Lying down laughing at a tablet reads as scrolling, not posting. |
| Job 04, Posts on X | `run_loop` | No | Running has no link to posting. |
| Job 05, Web posts | `idle_sit` | No | Sitting hunched has no link to writing. |
| How it works, 4 stages | none | Missing | The character sheet names these four states, but no clip exists for any of them. |
| Moods, 6 tiles | `cry_flail`, `angry_swear`, `bomb_panic`, `faceplant`, `laugh_tablet`, `cool_shades` | Yes | Reactions used as reactions. |
| Sign-up | `run_loop` | Partly | Works as "get going"; a wave would read better. |
| Sign-up confirmation | none | Missing | Nothing plays when the form is sent. |

Separate problem: `cool_shades`, `bomb_panic` and `faceplant` are one-shots, and version 1 loops them,
so they snap back to the first frame. Version 2 plays them once and holds the last frame.

The pattern: every existing clip is a reaction or a basic loop. None shows Coldie doing one of the
product's jobs.

## 2. Clips to make

Twelve items: one re-render and eleven new clips. All 720×720, transparent, 24 fps, same camera as the
existing set.

### Jobs (unblocks the "What Coldie does" section)

| Clip | Type, length | What happens | Props |
| --- | --- | --- | --- |
| `pixel_setup` | loop, 3–4 s | Coldie snaps a small glowing cube into a floating 3×3 grid tile; the tile lights up and the visor shows a tick. | pixel cube, grid tile |
| `ig_ad` | loop, 3 s | Coldie raises a megaphone at a floating square post card; hearts pop off the card. | megaphone, post card, hearts |
| `reddit_post` | loop, 3 s | Coldie drops a speech-bubble card onto a stack of bubbles; an up-arrow rises from it. | speech bubbles, up-arrow |
| `x_post` | loop, 2.5 s | Coldie types on a phone, taps send, and a short post card flies off. | phone, post card |
| `web_post` | loop, 4 s | Coldie types at a laptop; a page fills with lines and slides out. | laptop, page |

### Stages (unblocks "From setup to scale")

| Clip | Type, length | What happens | Props |
| --- | --- | --- | --- |
| `pixel_setup` | (same clip as above) | Stage 01, Installing. | |
| `competitor_scan` | loop, 4 s | A magnifier sweeps across three floating dashboard cards; the visor shows a scanning bar. Also covers a sixth job tile. | magnifier, 3 cards |
| `generate_campaigns` | loop, 4 s | Coldie opens the satchel; ad and post cards fan out and circle. | post cards (reused) |
| `analyze_results` | loop, 4 s | A bar chart grows; Coldie points at the tallest bar and the visor shows an up-arrow. | chart bars, pointer |

### General

| Clip | Type, length | What happens | Used for |
| --- | --- | --- | --- |
| `idle_stand` | loop, 3 s | Standing, breathing, a blink, soft visor glow. | Hero resting pose, footers, empty states. `idle_sit` is seated, so there is no standing idle. |
| `wave` | one-shot, 2 s | Friendly wave, settles into the idle pose. | Hero greeting, sign-up section. |
| `celebrate` | one-shot, 2 s | Small jump, arms up, a few stars. | Sign-up confirmation, first-traffic moments. |

### Re-render

| Clip | What changes | Needs from you |
| --- | --- | --- |
| `hero_channels` | The existing hero scene with five tiles: Meta, Instagram, Reddit, X, Web. | Tile images for Meta, Reddit and Web in the same rounded-square style as the four already supplied. |

## 3. Rules for the new clips

- Every action clip starts and ends on the `idle_stand` pose, so clips can follow each other without a jump.
- One-shots end on a pose that can be held.
- One post-card prop is shared by `ig_ad`, `reddit_post`, `x_post` and `generate_campaigns`.

## 4. Suggested order

1. `idle_stand` (the base pose everything else starts from)
2. `pixel_setup`, `ig_ad`, `reddit_post`, `x_post`, `web_post`
3. `hero_channels` re-render (once the three tile images exist)
4. `competitor_scan`, `generate_campaigns`, `analyze_results`
5. `wave`, `celebrate`

## 5. Where they go on the page

Built, rendered at 720×720 RGBA (`alpha_mode: 1`), visually verified on 8-frame sheets (`renders/anims_web/*_sheet.png`), and exported to `assets/mascot/` (`webm`, `poster.webp`, `anim.webp`, plus `.end.webp` for one-shots):

- **Wired into `v2.html` (`#jobs` section):** `pixel_setup`, `ig_ad`, `reddit_post`, `x_post`, `web_post`, `competitor_scan`.
- **Wired into `app.html` (`js/app.js`):** `idle_stand` (neutral standing empty/waiting states).
- **Exported in `assets/mascot/` ready for onboarding/completion hooks:** `wave` (one-shot), `celebrate` (one-shot).
- **Remaining (prompts in `REFERENCE-PROMPTS.md`):** `generate_campaigns`, `analyze_results`, app states (`review_wait`, `connection_required`, `attention_needed`, `paused`), and scenes `S01`–`S03`.
