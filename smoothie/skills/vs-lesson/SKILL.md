---
name: vs-lesson
description: Concordia lessons and educational explainers that teach one thing well - source-grounded script with a claims ledger, storyboard first, one idea per beat, then built in the right engine - motion-educator templates (16 looks: chalkboard, blueprint, whiteboard, watercolour, isometric...), Manim for math, the documentary board, paper2video for research papers, stickman code engine. Extends skills/study-video; use it after study-video picks the style.
---

# Lesson video

`skills/study-video/SKILL.md` stays the first stop (style routing, Vox/watercolour/hand-drawn/Anything2Explainer/Bang Motion). This skill adds the merged production method and engines. For industrial-engineering course material, accuracy beats polish.

## 1. Ground it (no invented facts)

- Read the source end to end (lecture notes, textbook section, paper, problem set). Extract **learning objective** (one sentence: "after 60 s the viewer can…"), prerequisites, exact terminology, and worked-example steps.
- Keep a **claims ledger** (`notes/claims.md`): every number, definition and claim on screen → its source page/figure. Anything not in the ledger does not go on screen. Recreated diagrams are labelled as recreations.
- Show the full steps of worked examples; never skip the step students get wrong.

## 2. Script and storyboard (plan gate)

- 20–120 s for a concept film; 3–8 min for a full worked lesson. ~150 words a minute narrated.
- One idea per beat; real data or the actual equation on screen early; motion explains a relationship (flow, cause, transformation), never decorates.
- Storyboard every beat as a still (engine storyboard PNGs or `vs-director` table) and get approval before rendering.

## 3. Pick the engine

| Content | Engine | Notes |
|---|---|---|
| Concept explainer in a chosen look | **motion-educator** (`AI-Local/engines/motion-educator@7ff07ee`): 16 templates — cutaway, glass, cosmos, micro, stickman, clay, paper, chalkboard, blueprint, isometric, pixel, whiteboard, watercolour, neon, comic, lowpoly | Node 20+, Playwright Chromium (shared browsers path), FFmpeg, Python numpy. `new.mjs <workspace> <film> --template blueprint`, `storyboard.mjs --png`, `render.mjs`, `check.mjs`; `lookmatch.mjs` compares stills with the template's golden frames |
| Math, proofs, graphs, derivations | **Manim Community** (`manim` in the shared `video-py` venv) | Plan scenes in a composer step; `manim -ql` previews, `-qh` final; MathTex needs LaTeX (MiKTeX) — check before promising |
| History of a method, case study, "how it was discovered" | **Documentary board** (`vs-director` mode; cinematic-film engine) | One camera over one board; hits on spoken words |
| Research paper → explainer | **paper2video** method on **Remotion** (shared workspace) | Real figures and numbers early; independent fact-check pass; 16:9 + 9:16 from the same audio |
| Story with characters, faceless social lesson | **Stickman code engine** (B styles) or motion-educator `stickman` template | Code engine only; the model engine needs paid generation |
| Isometric machine / system figure | Installed `anatomy` skill | Great for process diagrams in IE topics |

## 4. Voice, captions, assembly

Narration and captions from `vs-voice-captions` (scratch voice first, timing file drives hits); motion-educator accepts a recorded take plus word times (`voice.mjs --take AUDIO --words WORDS`) so no paid TTS is needed. Assemble and QA in `vs-edit`. Lessons: −16 LUFS, captions on (accessibility), chapter markers for anything over 3 minutes.

## 5. Review (before calling it done)

A stranger with no context can follow it; every on-screen claim is in the ledger; worked steps are complete and correct; text readable on a phone; colour is not the only way information is encoded; the learning objective is met by the last beat.

## Sources merged here (references only)

zeative/motion-educator@7ff07ee (engine + templates; MIT) · lunamos/paper2video@a8c966b (MIT) · ManimCommunity/manim (MIT) and the manim-composer / manimce-best-practices notes in `resources/concordia/video-motion/openmontage` (AGPL — ideas only) · Moh4696/cinematic-skill@bf43556 (documentary board; MIT) · kaomei/stickman-video-director@8394bec (code engine; MIT) · alisa0808/vox-director@6a85a7c (Vox paper-collage arcs; needs paid Atlas Cloud for generation — ideas only) · iamtechartist/every-joule-lesson1 and Vincentwei1021/anything2explainer (local references) · academa-labs/manimgx@1fb4dd7 (ManimGL fork — not used; Manim Community covers it).
