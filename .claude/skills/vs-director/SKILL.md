---
name: vs-director
description: Plan any video like a film director before anything is built - story clocks, beats, a shot list with one sealed camera move per shot, storyboard, beat grid, and review of every result. Use for cinematic shorts, documentaries, product promos, real-estate tours, lessons and AI-generation prompts. Modes - documentary board, still-to-film, product promo, generation prompts.
---

# Director

An adjective makes a model guess; a camera instruction tells it what to do. This skill turns "make it cinematic" into shots that a renderer, a generator or a person with a phone can execute. It plans; `vs-motion`, `vs-generate` and `vs-edit` build.

## Workflow (stop at the plan gate and the look gate)

1. **Brief in one line + three clocks.** Story in one sentence, the feeling at the end, delivery ratio, length, music/tempo. Clocks: story time, screen time, music time. Tempo sets the edit grid (bar = 240 / BPM seconds; 125 BPM → 1.92 s).
2. **Beats.** List beats; each must teach or make the viewer feel something new, or it is cut. Decide where geography is established, the screen direction per sequence, and the one held moment of stillness.
3. **Shot list** (table below). Every shot gets six layers: subject and action, size, angle/height, lens/focus, camera move, pace and limits.
4. **Choose moves by feeling, never by impressiveness** (table below). One main move per shot, two at most joined by a trigger. Everything else is a cut.
5. **Seal every move**: start frame, end frame, speed, and what must not change. "Pan right" alone pans until the clip ends.
6. **Animatic** on the beat grid with scratch audio; review with a contact sheet; cut shots here, not later.
7. **Look test**: one shot to final (`vs-studio` look gate), then build the rest.
8. **Review** every generated or rendered shot against the checklist below; give notes in the shot-list vocabulary.

| # | In (tc) | Beat / purpose | Size · angle · lens | Subject action (blocking) | Move (type, direction, speed) | Start → end frame | Holds (scale, direction) | Sound / cut cue | Dur |
|---|---|---|---|---|---|---|---|---|---|

## Moves by feeling

| Want the viewer to… | Move | Watch for |
|---|---|---|
| Lean in, discover, intimacy | Slow push-in (dolly) | Not a zoom: a push changes parallax, a zoom flattens |
| Leave, conclude, show scale | Pull-out / pedestal up | End on a composed wide, never mid-air |
| Follow an action across space | Truck / tracking | Keep screen direction; in 9:16 trucks read narrow, prefer depth |
| Reveal something hidden | Reveal past a foreground edge, tilt up | Hold a beat longer than comfortable before the reveal |
| Feel unease or vertigo | Dolly-zoom (push + opposite zoom) | Only on purpose, once |
| Survey a place (real estate, landscape) | Slow orbit or crane | Heavy things stay still; no wobble |
| Energy, montage | Cuts on the beat, shrinking shot length toward the climax | Not more camera movement |

Look-alike pairs to keep apart: pan vs truck, zoom vs dolly, tilt vs pedestal, POV vs FPV, orbit vs arc. **Static first when unsure**: if the composition fails still, no move will save it.

## Rules

- Frame for the delivery ratio. 9:16: tilts, pedestals, cranes and depth carry the frame; keep caption and UI safe zones clear (top ~12%, bottom ~20%). 16:9: lateral moves and landscape scale.
- **Frame 0 is the poster**: open on a composed frame, never black.
- Geography before action; scale needs a ruler (a person, a door, a car).
- Something moves inside every frame; a camera move on a dead still reads as a slideshow.
- No white flashes or unmotivated strobes (`vs-edit` flash check).
- Default to music only; add sound effects when the story turns on a sound, and say so in the plan.
- Nothing invented that looks real: archive photos and documents get credits; a document drawn in code is labelled a recreation; AI images illustrate, never serve as evidence.

## Modes

| Mode | Use | Build with |
|---|---|---|
| **Documentary board** | History, investigation, founder story, "how it works" | One continuous camera over one designed board of photos, cards, maps and big numbers; one hero per narration line; hits land on the spoken word; time only moves forward after the cold open. Engine: `cinematic-film` (Python + skia, CPU) via `vs-motion` |
| **Still-to-film** | A film from stills or AI images | Depth plate + virtual camera with parallax (push/pull far, truck small, pan/orbit ≤10% of frame); something alive in every frame; CG only when something must enter, turn or be seen from another side. Run `prep_plate.py ... --no-upscale` (skips the pickle-format Swin2SR weights; depth uses Depth Anything V2 safetensors, ~1.3 GB on first use). Depth runs on CPU slowly, GPU tier fast |
| **Product promo** | SaaS / app / website | Real page captures, shot recipe cards, beat sync, three modes: template, autonomous, co-created (approve brief → direction → shot map → storyboard) |
| **Generation prompts** | Text/image→video models | Six-layer prompt per shot, one move, sealed start/end, subject blocking described, negative list (no flashes, no morphing, heavy things still) → `vs-generate` |
| **Real-estate tour** | Listings | Establish exterior (crane/orbit) → threshold push-in → room-by-room trucks in one screen direction → hero feature hold → exterior pull-out; see `vs-real-estate` |

## Review checklist

Shot: purpose clear · one main move, sealed · blocking described · start/end frames match the plan · nothing that should be still moves · readable on a phone in one second · safe zones clear.
Sequence: screen direction held · geography established before action · scale readable · rhythm tightens toward the climax · one held moment · first frame works as a thumbnail.

## Sources merged here (references only; nothing copied verbatim)

AustinZ21/cinematic-skills@0e5b3fe (shot-director, still-to-film; MIT) · Moh4696/cinematic-skill@bf43556 (cinematic-film; MIT) · vincentwei1021/video-shotcraft@59f3e9b (product-promo modes and shot cards; Apache-2.0) · saranambiar/hyperframes-video-agent-skills@f6b043d (intake and storyboard; Apache-2.0) · iamaanahmad/agents-video-editing-skills@981466b (video-planning; MIT) · `ecc-taste` (music-video aesthetics). Full source: `resources/repo-quarantine/<owner>/<repo>` at those commits.
