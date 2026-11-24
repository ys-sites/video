# Storage and merge report (measured 2026-11-23)

## Disk

| | GB |
|---|---|
| C: total / used / free before this run (your screenshot) | 952 / 612 / 339 |
| C: free now (measured after staging) | 338.9 |
| Added by this run so far: quarantine clones for the audit (55 repos, sparse, no media/models) | 3.0 |
| **Planned by the install (dry-run total, all phases)** | **2.93** |
| GPU-tier model weights (on the rented disk, not your PC) | 0 local (47.65 on the box) |
| Budget | 100 |

After install the system uses about **3 GB of the 100 GB budget**. Pruning the audit clones afterwards (`git clean` of the 55 staged folders, which the installer does not need because it re-fetches the reviewed commits) gives the 3.0 GB back, so the net change is about +3 GB, or about +0 GB once the duplicates below are removed.

## Measured after install (2026-11-24)

| Item | Size |
|---|---|
| `AI-Local/engines` (7 engines + shared JS workspace) | 2.31 GB (stickman-director alone 1.49 GB: its bundled reference media; motion-educator 0.54 GB) |
| `AI-Local/browsers` (one Chromium + headless shell + Playwright ffmpeg) | 0.74 GB |
| `AI-Local/venvs/video-py` (torch hardlinked, not copied) | 1.12 GB on disk as listed; the 0.5 GB torch is shared with ComfyUI and the uv cache |
| Site `node_modules` (gsap, three, lottie-web) | ~0.05 GB |
| `AI-Local/apps` (Blender 0.93, Kdenlive 0.62, LosslessCut 0.62, OBS 0.57; added 2026-11-24) | 2.74 GB |
| **Total added by the install** | **about 7.0 GB of the 100 GB budget** |
| C: free | 338.9 GB before this run → 333.1 GB after (includes the 3.0 GB audit clones) |

Extra clean-up candidates found during install: an older Puppeteer Chrome in `~/.cache/puppeteer` (0.71 GB, from 2026-09-29) duplicates the shared Chromium; stickman's bundled reference media (~1.4 GB) can be pruned if you only use its code engine.

## What already exists (and is reused, never downloaded again)

| Item | Size | Used by |
|---|---|---|
| ComfyUI models (LTX 2B, Wan 1.3B, T5, UMT5, Wan VAE): SHA-256 verified | 19.2 GB | vs-generate, both tiers (same files and hashes) |
| faster-whisper small | 0.46 GB | every transcription (captions-skill is switched from `base` to `small`, avoiding a second model) |
| ComfyUI venv torch 2.15.0+cpu | 0.5 GB | hardlinked into the new `video-py` venv (uv cache); no second copy |
| System FFmpeg | — | every skill (no per-skill static ffmpeg) |
| OmniVoice venv | 3.7 GB | narration |
| Remotion project node_modules (creator-style-explainer) | 0.77 GB | becomes the shared JS workspace pattern (one install for all Remotion/HyperFrames projects) |

## The 5 biggest items, and how each was shrunk

| # | Item | Size | How it was shrunk |
|---|---|---|---|
| 1 | GPU-tier models (LTX 13B, Wan 14B t2v + i2v, CLIP-vision) | 47.65 GB | Kept off your PC entirely: they download on the rented box; shared encoders/VAE listed once (−6.9 GB vs per-family lists) |
| 2 | Local model store (already present) | 19.2 GB | One store for every skill and both tiers; nothing re-downloaded |
| 3 | `video-py` shared venv (Manim, skia, OpenCV, transformers, torch) | ~1.3 GB | One venv instead of four engine venvs (~4 × 1.2 GB); torch hardlinked (−0.5 GB) |
| 4 | Shared JS workspace (HyperFrames + Remotion + one Chromium) | ~0.6 GB | One node_modules and one headless Chromium for 5 engines that each want their own (~0.3–0.4 GB each) |
| 5 | motion-educator engine | ~0.35 GB | Pinned depth-1 fetch, `--ignore-scripts`, shared Playwright browsers folder |

## Merges (one skill per job)

| Unified skill | Members | Kept from each | Dropped and why | Storage saved |
|---|---|---|---|---|
| `vs-director` | shot-director + still-to-film (AustinZ21), cinematic-film (Moh4696), video-shotcraft, video-intake-and-storyboard, video-planning, ecc-taste | Six-layer shots and sealed moves; depth-plate limits; documentary board, one hero per line, hits on words; three promo modes; intake checklist | Duplicate planning checklists; ElevenLabs/fal defaults (free local first); shotcraft's Chinese-only template steps (referenced) | 5 skills → 1 (markdown, ~0 GB) |
| `vs-motion` | HyperFrames, Remotion, remocn, motlab, brief2mp4, brag, hyperframes agent skills, eian-riso-broll, line-art, open-3d-skills, claude-video-effects, motionmaxxing, OpenMontage ideas | Two engines; design rules; product-promo, info b-roll, line-art, browser-3D, launch-video modes | motlab, brief2mp4 and OpenMontage's composer as engines (third/fourth/fifth renderers); anime, tween, mojs, konva, pixi (duplicate JS brains, ~85 MB) | ~1.5 GB (three engine installs avoided) |
| `vs-edit` | ffmpeg-skill, agents-video-editing-skills, hyperframes audio-sync/QA, autoclip, claude-video-kit gates, ecc-video-editing | 42-tool stdlib engine; order of work; long→shorts recipe; assembly and QA gates | AutoClip app (needs an LLM key); moviepy route (FFmpeg covers it); per-skill ffmpeg downloads | ~0.3 GB (AutoClip env) + one FFmpeg |
| `vs-voice-captions` | captions-skill, sfx-generator, voiceover/caption/audio skills, cinematic-film narration tools, VoiceStudio, Piper | One Whisper; caption gate; scratch-voice-first timing; synthesized SFX; ducking rules | VoiceStudio and Coqui (duplicate TTS brains); `base` Whisper download | ~0.15 GB (Whisper base) + ~2 GB (second TTS stack) |
| `vs-generate` | ComfyUI LTX/Wan, FreeVideo, Openjutsu, still-to-film depth, motion-assets, stickman model-engine prompts, Hypit ideas | Tier table; one model store; one job script for both tiers; prompt order | comfy-desktop (duplicate ComfyUI, ~1 GB); codeworldmodel (8-GPU node) | ~1 GB + 47.65 GB kept off-PC |
| `vs-real-estate` | creator-video study, instagram-agent-skill, re-walkthrough idea, effects | Hook formulas, beat sheet, room-by-room tour, compliance list | Zillow scraping and paid Higgsfield | — |
| `vs-lesson` | study-video, motion-educator, paper2video, Manim, cinematic board, stickman code engine, vox-director ideas | Claims ledger, storyboard gate, engine picker by content | ManimGL fork (manimgx), Atlas Cloud generation | ~0.2 GB (second Manim) |
| `vs-studio` | router over all of the above | Tier choice and six gates | — | — |

## Clean-up candidates (your approval needed; nothing was deleted)

| Candidate | Reclaim | Note |
|---|---|---|
| `resources/repo-quarantine/retries/meta/astryx` (duplicate of `meta/astryx`) | ~0.7 GB | Same repository cloned twice |
| `~/.cache/huggingface/hub/models--handy-computer--parakeet-ultra-gguf` (`.sync.part`) | ~0.7 GB | Stale partial download from another app; check that app is not mid-download |
| The 55 audit clones from this run (after you have reviewed the results) | 3.0 GB |
| `AI-Local/downloads/apps-20261124` (the four verified app packages, already extracted) | 0.95 GB | Provenance and scan reports are kept in `smoothie/audit/` |
| uv cache "duplicates" of torch/llvmlite (7 groups, 3.2 GB) | 0 GB | Not real duplicates: they are hardlinks (same inode) to the venv files |
