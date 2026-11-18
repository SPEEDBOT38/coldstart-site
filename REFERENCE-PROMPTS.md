# Coldstart — scene and animation reference prompts

## Direction

V2 is the chosen direction: electric blue #0000F2, paper #F2F2F2, ink #000091, small acid-yellow #ECEA36 accents. Keep Coldie's existing character design. Animation must communicate a specific task or state, not decorate an unrelated feature.

**References are concept art, not finished animation.** We will use them to build meshes, props, poses and cameras in Blender. A single illustration cannot specify a whole movement; use the four-key-pose sheets below.

### How to use this pack

Attach the approved Coldie character sheet (or the latest approved character render) to your image-generation conversation. Paste the COMMON BLOCK plus ONE numbered prompt at a time. For scenes, generate one image per prompt, not a collage. For animations, request a four-panel sheet with consistent camera and scale.

Do not ask the generator to design the app UI: the interface is being built as editable HTML, not embedded into an image.

## COMMON BLOCK — prepend to every prompt

Use the attached Coldie reference as the authoritative character design. Preserve his star-shaped white/icy-blue head, number and shape of spikes, black rounded visor, white pixel eyes, cobalt baseball cap, sunglasses on the cap, crossbody messenger bag, gloves, shoe silhouette and body proportions. Do not redesign him or introduce costumes. Keep the visor and eyes readable.

Art direction: Y2K airbrushed mascot illustration translated into clean, buildable 3D forms, thick navy contours, softly rounded geometry, restrained glossy highlights, and subtle ordered-dither shading. Use electric blue #0000F2, paper white #F2F2F2, deep blue ink #000091; acid yellow #ECEA36 only for active signals. The output should retain legibility when reduced to a small web tile. Avoid photorealism, fur, atmospheric haze, complicated reflective surfaces, dense confetti, text-heavy UI, excessive bloom, fake logos and watermarks.

For a character pose sheet: plain paper background, orthographic three-quarter camera, full character and every prop in frame, equal character scale in every panel, consistent lighting, 12% empty margin, no cropping. Four key poses arranged left-to-right in a single row. No written captions or decorative frame. Hands must visibly touch held props; no floating grip or intersecting limbs. Prefer large, simple props to tiny detailed ones.

---

# A. Scene references (send these first)

## S01 — Launch desk / hero: recommended first

Create one wide 16:9 scene of Coldie operating a compact marketing launch desk. He stands on the RIGHT half, three-quarter view toward the LEFT, one hand touching a large launch key and the other presenting five distinct floating output cards. Cards symbolize tracking (3×3 pixel grid), a paid image ad (picture card plus megaphone), community conversation (two speech bubbles), a short social post (three text-like bars), and an article (page with image and lines). No real platform logos or readable text. Make the cards visually different and their path from one small brand cube on the desk easy to understand.

Leave the LEFT 42% mostly empty electric-blue negative space for real HTML headline and controls. Do not paint words into it. Keep Coldie's visor completely clear. Use a compact semicircular desk, a single cable or track connecting the input cube to the five cards, and one yellow status light. Show the whole character, including shoes. The scene must work as an orthographic Blender diorama, with clear separation of character, desk, cards, cable and backdrop. Camera slightly above eye level; avoid wide-angle distortion. Flat blue background, no room walls, no extra mascots. Put small action details on the right; left remains calm.

Animation intent: insert a brand cube → desk lights up → cards fan out sequentially → Coldie presents them → return to rest. Do not make the scene look like social-media engagement magically appearing; show work being prepared.

## S02 — Campaign workshop / process section

Create one wide 16:9 miniature campaign workshop, an original Coldstart scene. Four simple physical stations form one continuous tabletop from left to right: a pixel grid being plugged in, a magnifying glass over three competitor cards, an open satchel releasing draft cards, and a small results chart. Coldie is near the third station preparing drafts. Connect stations with one thin navy cable or tabletop track; one yellow indicator identifies the current stage. No extra characters, no text, no platform logos, no giant machinery.

Use a slightly elevated orthographic three-quarter view, full tabletop in frame, simple bevelled forms, electric-blue and paper palette, crisp navy outlines, sparse dither shadows. Each station must still read at mobile width. Prioritize four clear silhouettes over decorative detail. Leave breathing room above the tabletop for an HTML section heading. This is a workbench, not a spaceship cockpit.

Animation intent: one signal travels station to station; the draft station pauses at an approval tray before anything reaches results. This makes the approval boundary explicit.

## S03 — Approval desk / app empty-state and review illustration

Create a single 4:3 scene showing Coldie seated or standing beside a small desk with a tray of THREE draft cards. Coldie holds the top card toward the viewer with both hands in a patient presentation pose. A large unpressed approval stamp sits on the desk; a yellow pause indicator is visible. The scene should say 'ready for your review,' not failure or impatience. Use neutral happy pixel eyes, no tears, bombs, anger or dizzy eyes.

Plain paper background, electric-blue desk and cap, ink-blue outlines, tiny yellow status accent. Full head, hands, card and stamp visible; no text or logos on cards, only image blocks and short line bars. Keep the composition readable as a 240px UI illustration. Do not render an entire dashboard behind the character.

Animation intent: present card → small blink → patient breathing loop. The stamp is pressed only after user approval.

**Existing night-room scene:** keep it for the 'you build, Coldie handles the work' editorial break or end-of-run rest state. It does not explain tracking, writing or results, so do not reuse it for those features.

---

# B. Task animation sheets

The first nine clips below are in the initial Blender build batch. References can guide a polish pass; they are not needed to begin the procedural builds. 'In build' is not a claim that rendering or visual approval is finished.

## A01 — pixel_setup (in build)

Four-panel animation key-pose sheet. Panel 1: neutral standing Coldie with a small glowing cube in one hand and a large 3×3 grid tile floating just to the side at chest height, centre cell empty. Panel 2: he leans slightly and reaches the cube toward the empty cell. Panel 3: cube clicks into the centre, three grid cells light yellow in sequence, his head turns toward it with focused eyes. Panel 4: satisfied nod, clear tick-shaped signal on the tile, then hand ready to retrieve the cube. His hand stays below or beside the visor throughout. Use a large grid and one cube, no laptop and no unrelated floating hearts. The camera and feet remain fixed.

Placement: Meta Pixel tile, installation progress. 3–4-second loop; completion tick is reserved for a successful state.

## A02 — ig_ad (in build)

Four-panel key-pose sheet. Coldie has a chunky blue megaphone and one square advertisement card with a simple image block. Panel 1: megaphone lowered, card at the side. Panel 2: he raises the megaphone next to—not in front of—the visor, leaning toward the card. Panel 3: two clean sound arcs travel from the megaphone to the card; three small hearts rise off the card. Panel 4: sound fades, megaphone lowers, returning to rest. Keep shoulders, elbows and grip physically plausible. No actual Instagram logo or interface text. Prioritize the visible act of promoting a post.

Placement: paid campaign preparation tile, not spend confirmation. 3–4-second loop.

## A03 — reddit_post (in build)

Four-panel key-pose sheet. Panel 1: Coldie holds a large speech-bubble card beside a stack of two similar cards. Panel 2: he places his card onto the conversation stack. Panel 3: the stack bounces gently and a chunky upward arrow rises from it; he follows it with his eyes. Panel 4: small approving fist gesture and return to rest. The motion should feel like contributing to a conversation, not blasting spam. No Reddit logo, no robots posting hundreds of cards, no fake vote counts. Large bubbles, one arrow, readable hands.

Placement: community-post drafting. 3–4-second loop. The real app still requires community rules and human review.

## A04 — x_post (in build)

Four-panel key-pose sheet. Panel 1: Coldie holds a phone at chest height with one hand; free hand ready to type. Panel 2: free glove taps the phone in a clear writing gesture. Panel 3: a short post card with three line bars rises from the phone after a deliberate send flick; two speed strokes show its direction. Panel 4: card has moved to the side and shrunk, and Coldie lowers the phone. Keep the visor uncovered and phone readable at thumbnail size. No X logo or real text. Do not substitute running for posting.

Placement: short-post feature; publish version only after approval. 2.5–3-second loop.

## A05 — web_post (in build)

Four-panel key-pose sheet. Coldie stands at a floating laptop or very small desk. Panel 1: hands poised over keyboard. Panel 2: alternating typing pose, head angled toward the screen. Panel 3: a page card rises behind the laptop with a headline-like bar, image block and four text-like bars. Panel 4: page moves into an output tray, hands settle. Use a simple thick laptop silhouette, enough clearance between gloves and keys, and a full visible visor. No readable text, logos or scenery. This is writing, not laughing while watching a tablet.

Placement: article drafting. 4-second loop.

## A06 — competitor_scan (in build)

Four-panel key-pose sheet. Three dashboard cards hover in a small arc beside Coldie; each has a different simple arrangement of bars. Panel 1: he lifts a magnifying glass with a large clear lens. Panel 2: magnifier rests over card one; it enlarges slightly. Panel 3: magnifier moves to card two while his head follows; cards never cover the face. Panel 4: card three is highlighted and he draws the magnifier back. Use a restrained yellow highlight, no real company logos, no readable numbers, no spy or hacking motifs.

Placement: competitor research and scanning progress. 4-second loop.

## A07 — idle_stand (in build)

Four-panel subtle-motion key-pose sheet. Coldie stands calmly on both feet, happy pixel eyes, shoulders relaxed, shades resting on cap. Show rest, a small inhale with slight body lift, a blink, and return to identical rest. Head movement is minimal; bag follows the body with a small delayed sway. No props, no floating icons, no motion of the feet across the floor. Character silhouette and camera must match in all four panels.

Placement: neutral base state and transitions. 3-second seamless loop.

## A08 — wave (in build)

Four-panel key-pose sheet. Neutral stance, then one arm raised outward so the glove stays entirely outside the visor silhouette; gentle side-to-side hand wave; relaxed settle back to the same neutral pose. Head tilts toward the raised hand. No confetti or extra props. Show elbow bending rather than a rigid arm rotating at the shoulder. All fingers and arm remain inside the image margin.

Placement: welcome/onboarding, not a running task. 2-second one-shot.

## A09 — celebrate (in build)

Four-panel key-pose sheet. Panel 1: crouch anticipation. Panel 2: small jump with arms outward and up, visor unobstructed. Panel 3: airborne peak with four small four-point yellow stars, legs tucked slightly. Panel 4: soft landing and settle into neutral standing. Keep peak and stars comfortably inside the frame. No money, invented analytics, trophies or giant confetti cloud.

Placement: real completion, campaign approved, first verified conversion. 2-second one-shot; never used for a failed or merely submitted request.

## A10 — generate_campaigns (next)

Four-panel key-pose sheet. Panel 1: Coldie opens his messenger bag and retrieves one simple brand cube. Panel 2: cube is placed onto a small work surface. Panel 3: three differently shaped draft cards fan out—square ad, speech bubble, article page. Panel 4: cards land in an APPROVAL TRAY beside a large unpressed checkmark stamp, and Coldie presents the tray to the viewer. No automatic publishing, no traffic numbers, no readable labels. Keep the same post-card designs used in the other sheets.

Placement: campaign generation stage. 4-second loop ending in a review-ready hold.

## A11 — analyze_results (next)

Four-panel key-pose sheet. Coldie studies a small chart board with three simple bars. Panel 1: neutral attentive pose. Panel 2: he compares two bars with a short pointer. Panel 3: one bar is highlighted yellow while the others stay blue; he tilts his head thoughtfully. Panel 4: he places a small recommendation card beside the chart. The chart is not required to rise: show analysis, not guaranteed success. No numeric claims, money symbols or trophies.

Placement: results analysis and recommendation state. 4-second loop.

---

# C. App-specific state sheets (after the task set)

## A12 — review_wait

Four key poses: Coldie lifts one draft from an approval tray, presents it with both hands, blinks patiently, and returns to the presentation pose. Big clear card, no text, no tears, no angry hands. A small yellow pause square remains beside the tray. Most movement is breathing, not repeated waving. The meaning is 'ready for your decision.'

Placement: review queue and waiting-on-you. Quiet 3-second loop.

## A13 — connection_required

Four key poses: Coldie holds two large halves of a simple connector with a visible gap between them, looks toward the viewer, points once to the gap, then returns to holding them. Do not connect them in this loop. No panic, sparks or breakage. A separate final pose shows the halves correctly connected with a checkmark, for after successful authorization.

Placement: disconnected channel, expired access. 3-second wait loop plus a completion pose.

## A14 — attention_needed

Four key poses: Coldie spots a small flagged card, leans forward with focused eyes, points to one highlighted area of the card, then waits. A single yellow warning diamond is enough. No swearing, bombs, crying, aggressive expressions or red screen takeover. Make him a helpful assistant, not an offended character.

Placement: rejected ad, missing event, recoverable error. Calm 3-second loop.

## A15 — paused

Four key poses: Coldie places his tool on the desk, presses a large two-bar pause control, folds hands calmly beside it, then holds the pose with one blink. Output cards remain still. No sleeping/dizzy eyes. Supply one extra neutral pose to resume into.

Placement: paused channel or entire run. One-shot into a quiet hold.

---

# D. What to send back

## Needed first

1. The **S01 Launch desk image**, generated with the approved Coldie reference attached. This establishes the new hero composition.
2. Any corrections to the currently accepted Coldie model: proportions, cap/wordmark, shades, bag, shoe shape. Without a correction, the existing model stays canonical.
3. If you want platform logos rather than neutral icons: approved SVG/transparent PNG assets for Meta, Instagram, Reddit and X. A neutral article/page icon can represent the website. No need to generate logos in an image model.

## Useful next, not blockers

- S02 and S03 scene images.
- Four-pose sheets for any task animation whose look you want to direct. Start with pixel_setup and generate_campaigns; shared card/desk props will carry across the set.
- A real example app: URL, logo, one-line description, target customer, and 2–3 preferred writing examples. Until supplied, the interface uses a visibly labeled fictional Fernbook sample.
- Your actual Coldstart logo/wordmark as SVG if it differs from the current typographic treatment.

## Decisions, not visual assets

- Define 'alt post': another platform, an alternate draft, or image alt text? It has not been silently treated as a channel.
- Real approval policy and budget limits. Prototype default: no publication or spend without approval; disconnected/paused channels hold approved work.
- Platforms available at launch, so we do not promise integrations before they exist.

Do not send passwords, access tokens or card details in the chat. Real account authorization is a later implementation step, not an asset request.
