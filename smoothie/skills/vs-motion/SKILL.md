---
name: vs-motion
description: Code-rendered motion - motion graphics, kinetic typography, data and chart animation, product promos from real page captures, talking-head effects, riso/paper/hand-drawn info b-roll, line-art, and browser 3D - rendered frame-exact on this CPU with two engines (Remotion for React projects, HyperFrames for HTML+GSAP), plus headless Blender for real 3D shots (floor-plan dollhouse orbits, product turntables, 3D titles). Use when the picture is designed, not filmed or generated.
---

# Motion (two engines, one design language)

Everything here renders on the local CPU tier. Pick one engine per video and stay in it.

## Pick the engine

| Choose | When | Run |
|---|---|---|
| **Remotion** (React) | Existing Remotion projects (`video-projects/*`), data-driven or templated videos, the site's editor briefs, component kits (remocn) | Installed `remotion:*` skills; one shared workspace `video-projects/node_modules` (one install, one headless Chrome, all `@remotion/*` at one version) |
| **HyperFrames** (HTML + CSS + GSAP, seekable timeline) | Cinematic depth shots (still-to-film), launch videos from a website (brag), scene-by-scene agent builds, anything GSAP | The pinned binary `C:\Users\Sharafath\AI-Local\engines\video-js\node_modules\.bin\hyperframes` (0.9.87): `hyperframes init <name> --example blank --non-interactive --skip-skills`, then `hyperframes render` in the project. Never the scaffold's `npm run render` (it runs `npx --yes`). User env already set: `HYPERFRAMES_NO_TELEMETRY=1`, `HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_BROWSER_PATH` = the shared Chromium. Measured here: 10 s / 300 frames in 3 min 40 s |

| **Blender** (real 3D, headless) | Floor-plan "dollhouse" orbits, product or lesson-object turntables, extruded 3D titles: anything that needs real geometry, light and a camera | `blender.exe -b --factory-startup -P scripts/blender_scene.py -- --spec shot.json --out <dir>` (portable 5.3.0 in `AI-Local\apps`); proof frame with `--still` first; frames → MP4 in `vs-edit`. Details and spec examples: `references/blender.md` |

Blender renders 3D shots that drop into a Remotion/HyperFrames or `vs-edit` timeline; it is not a third timeline engine. Do not add a third engine for one video. motlab, brief2mp4 and OpenMontage's composer are references for ideas, not engines to install.

## Design language (applies to both engines)

- **Durations**: UI-scale moves 200–400 ms; on-screen text holds ≥ (words ÷ 3) s + 0.5 s; one idea per beat.
- **Easing**: ease-out for entrances, ease-in for exits, spring (damping 12–20) for playful UI; never linear except for continuous motion (tickers, drifts).
- **Stagger** 40–80 ms between siblings; build hierarchy by order, not by everything moving at once.
- **Beat grid**: cut and hit on the music grid from `vs-director`; numbers and stamps land on the spoken key word (`timing.json`).
- **AI-slop tells to avoid**: everything bouncing, centered gradient blobs, generic glassmorphism on every card, emoji bullets, typewriter on every line, constant camera drift. One signature move per video.
- **Type**: readable on a phone in one second — ≥ 3% of frame height for labels, big condensed caps for numbers.
- **9:16 safe zones**: keep text out of the top ~12% and bottom ~20%.
- **Something alive in every frame**, but only one thing asks for attention.

## Modes

| Mode | Recipe |
|---|---|
| **Kinetic type / quote / stat** | Big number counts up on its spoken word, label settles 150 ms later, background moves slower than foreground |
| **Product promo from a real UI** | Capture the real page frame-exactly (virtual-clock capture or Playwright at 60 fps), shot cards: zoom-to-feature, cursor path, before/after split, feature stack; beat-sync; privacy check (no real user data on screen) |
| **Info b-roll for a talking head** | From the transcript pick segments that are numbers, processes, comparisons or lists; render each as a 3–6 s card in one style (riso two-colour, paper cut-out, line-art ink) and drop it in with `vs-edit overlay` |
| **Talking-head effects** | Use the installed `effects` skill (45 face-tracked effects); it is already the merged result of claude-video-effects — do not reinstall the source |
| **Charts and data** | One chart per beat, draw-on axes then data, highlight the one number that matters; data from a real source, cited in the notes |
| **Line-art / hand-drawn** | SVG paths drawn on (stroke-dashoffset), boiling lines on twos (12 fps steps) for the drawn look |
| **Blender 3D shot** | Plan the move in `vs-director`, write a spec (`floorplan`, `title`, `turntable`), render the `--still` proof, look at it, then render frames; real scale from real plans; one sealed move per shot (`references/blender.md`) |
| **Browser 3D** | three.js procedural geometry (no model files), exploded views for "how it works", record with a virtual-clock frame capture, never screen-record real-time |
| **Launch video from a website** | Read the site, pick 5–7 beats (hook, problem, 3 features, proof, CTA), capture real sections, HyperFrames timeline, music bed, share copy |

## Verification (before handing to `vs-edit` QA)

Render proof frames at the start, middle and end of every scene plus each key-word hit; check no stale theme colours or placeholder text; check type size and safe zones on the 9:16 frame; then render the full video.

## Sources merged here (references only)

heygen-com/hyperframes@8cdf5b2 (engine and skills; Apache-2.0) · saranambiar/hyperframes-video-agent-skills@f6b043d (scene builder, motion design systems, product demo integration; Apache-2.0) · remocn/remocn@995f1be (Remotion component registry; MIT) · staryone/motlab@fd2bfda (Apache-2.0) and qualixar/brief2mp4@9935db4 (MIT) — idea references · vincentwei1021/video-shotcraft@59f3e9b (shot cards; Apache-2.0) · latent-spaces/brag@0637943 (launch video flow) · yian6557/eian-riso-broll@e782ad7 (riso info b-roll; licence unstated — ideas only) · JDhruv14/line-art-animation@c43d698 · moh4696/open-3d-skills@53beb89 (frame-capture, exploded-view, threejs-scene; MIT) · iamaanahmad/agents-video-editing-skills (motion-design-craft) · `resources/concordia/video-motion/{claude-video-effects,motionmaxxing,openmontage}` (local references; OpenMontage is AGPL-3.0, ideas only).
