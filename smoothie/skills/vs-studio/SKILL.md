---
name: vs-studio
description: Entry point of the merged video system. Use first for any request to make, edit, caption, voice, generate or publish a video (real-estate tour, Concordia lesson, cinematic short, product promo, reel). Picks the job skill, the tier (local CPU or rented Nvidia GPU) and the gates.
---

# Video studio (router)

One system instead of 100 tools. Read the brief or footage, then route. `docs/MASTER-ROUTER.md`, `AGENTS.md` and the user's words win over this file.

## 1. Pick the job

| The request is mostly… | Skill | Notes |
|---|---|---|
| Real footage to cut, tighten, reframe, clip, export | `vs-edit` | Always the base layer when footage exists |
| Real-estate / creator reel, listing tour, agent content | `vs-real-estate` | Extends `skills/creator-video` (136-reel study) |
| Lesson, explainer, paper, concept film | `vs-lesson` | Extends `skills/study-video` |
| Cinematic short, documentary, trailer, "make it feel like a film" | `vs-director` → `vs-motion` / `vs-generate` | Director plans every shot first |
| Motion graphics, kinetic type, product promo, UI animation, 3D web, Blender 3D shots (floor plans, turntables, 3D titles) | `vs-motion` | Code-rendered, CPU-friendly |
| Record the user (camera, screen) or hand them an editable timeline | `vs-edit` desktop apps: OBS (record), Kdenlive via `.otio` (hand edit), LosslessCut (quick trims) | Portable apps in `AI-Localpps` |
| Footage that does not exist yet (AI b-roll, image→video) | `vs-generate` | Local small models or GPU tier |
| Narration, captions, music, sound effects | `vs-voice-captions` | Free local first |
| Publish to TikTok / Shorts / Reels | `ecc-short-video-distribution` | Approval for every post |

Most videos chain: `vs-director` (plan) → `vs-motion` / `vs-generate` / footage → `vs-voice-captions` → `vs-edit` (assemble, QA, export).

## 2. Pick the tier

| Tier | Runs | Use for |
|---|---|---|
| **Local CPU** (this PC: Ryzen 7 5825U, Vega 8, 15 GB RAM, no CUDA) | FFmpeg, Remotion, HyperFrames, Manim, code engines, Whisper small, OmniVoice/Piper, LTX-Video 2B / Wan 1.3B (≤512 px, 3–5 s, 15–60 min a clip) | Everything by default |
| **Nvidia GPU** (rented; later a physical card) | LTX 13B, Wan 14B (t2v, i2v), FreeVideo/MiniMax-H3, Openjutsu, depth/upscale models at speed, Blender Cycles at scale | Only when the local result is not good enough and the user approves the cost |

GPU handoff: `smoothie/GPU-TIER.md` (rent → prepare → tunnel → `comfy_job.py` → fetch → **destroy**). Always state the expected cost before renting; never leave an instance running.

## 3. Gates (apply in every job)

1. **Plan gate** — show the shot list / beat table before building anything longer than 20 s.
2. **Look gate** — one finished still or 3-second test before the full render.
3. **Caption gate** — for pop-sticker captions, frames at 1.5 s, 4 s, 8 s and wait (`captions-skill`).
4. **Spend gate** — any paid API, credit or GPU rental needs the user's yes in this conversation.
5. **Publish gate** — nothing is posted, pushed or deployed without an explicit yes.
6. **QA gate** — `vs-edit` QA (probe, loudness, black/silence, contact sheet) before calling a video done.

## 4. Never

- Run code from `resources/repo-quarantine/` directly. Engines run only from `AI-Local/engines/<name>@<commit>` copies installed by `smoothie/install/install.ps1`.
- Download a model twice: all weights live in `AI-Local/ComfyUI/models` (one store, both tiers use the same files and hashes).
- Load a model at startup or keep two heavy models in RAM at once.
- Publish Kelsey/kelssie3 material or any footage not licensed for publication.
