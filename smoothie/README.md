# The smoothie: one video system (installed 2026-11-24)

Installed on 2026-11-24 after your approval and merged to `main` on your "push". The install record is in "Install status" below; the earlier dry-run and hold notes are kept for the audit trail.

## What it is

About 110 video repos and skills were audited and mixed into **eight skills** that run on your PC, plus a rented-Nvidia tier:

| Skill | Job |
|---|---|
| `vs-studio` | Entry point: picks the job skill, the tier (local CPU or rented GPU) and enforces the six gates |
| `vs-director` | Plans every video like a film director (shots, moves, beats, review) |
| `vs-edit` | One FFmpeg toolset: cut, reframe, clip, assemble, QA, export |
| `vs-motion` | Code-rendered motion: Remotion + HyperFrames, one design language |
| `vs-voice-captions` | One Whisper, 7 caption styles, local narration, synthesized SFX, music beds |
| `vs-generate` | AI footage: local LTX/Wan, or LTX 13B / Wan 14B / FreeVideo / Openjutsu on a rented GPU |
| `vs-real-estate` | Listing tours and agent reels (extends `skills/creator-video`) |
| `vs-lesson` | Concordia lessons and explainers (extends `skills/study-video`) |

The 27 `ecc-*` skills installed earlier stay as they are (website, distribution); `vs-studio` routes to them.

## Files

| Path | What |
|---|---|
| `skills/vs-*/SKILL.md` | The eight merged skills (written fresh; sources credited by repo and commit) |
| `install/install.ps1` | Installer, **dry run by default**; real install needs `-Install -IUnderstand` |
| `install/video-py.lock.txt` | The exact 68 Python packages the shared venv will get (resolved, not installed) |
| `install/download_models_family.py` | One model list for both tiers, SHA-256 verified, `--dry-run` sizes |
| `install/gpu/` | `rent-gpu.sh`, `prepare-gpu-box.sh`, `comfy_job.py` (GPU tier) |
| `GPU-TIER.md` | Rental commands, what to rent, cost per job, shut-down, physical-GPU path |
| `STORAGE.md` | Disk before/after, biggest items, merges and savings, clean-up candidates |
| `RESULTS.md` | One row per source item with verdict, merge target, evidence and install path |
| `audit/` | Triage and SkillSpector output, verdicts.json, the scripts that produced them |

## Install order (when you say "install now")

```powershell
cd "C:\Users\Sharafath\Desktop\Website\Master Video Editor\video"
git merge smoothie/merged-system                                    # after you review the diff
powershell -ExecutionPolicy Bypass -File smoothie\install\install.ps1                              # dry run again
powershell -ExecutionPolicy Bypass -File smoothie\install\install.ps1 -Install -IUnderstand -Phase 0
powershell -ExecutionPolicy Bypass -File smoothie\install\install.ps1 -Install -IUnderstand -Phase 1
powershell -ExecutionPolicy Bypass -File smoothie\install\install.ps1 -Install -IUnderstand -Phase 2
```

Then the smoke tests (each must PASS before the next): site `npm run lint && npm run build:live`; `manim -ql` a 5-second scene; ComfyUI LTX 2B test clip (512×320, 25 frames); `captions-skill` on a real video with your approval of the 1.5 s / 4 s / 8 s frames; OmniVoice one sentence; `ffmpeg-skill probe.py` + `fit.py --aspect 9:16` on a clip; motion-educator `doctor.mjs` + a 10-second template film; one `vs-studio` end-to-end video (a 20-second real-estate reel from your footage).

## Dry-run status (2026-11-23)

`install.ps1` dry run: **21/21 steps PASS**, planned **2.93 GB** local of the 100 GB budget, free space 338.9 GB. Every engine's reviewed tree hash matches the scanned quarantine copy, and each pinned commit is still the upstream HEAD. Model list dry run: all 9 files found on Hugging Face with published hashes (19.2 GB already local, 47.65 GB GPU-only). GPU scripts pass `bash -n`; `comfy_job.py --dry-run` passes and refuses non-loopback servers.

## Install status (2026-11-24): INSTALLED

Approved by the user after a full Bitdefender scan of the quarantine (242,067 items; only 2 hits, both in `vercel-labs/agent-desktop`, which is not installed). All three phases ran: Phase 0 5/5, Phase 1 8/8, Phase 2 8/8 PASS.

| Smoke test | Result |
|---|---|
| Site `npm run lint` + `npm run build` after adding gsap/three/lottie-web | PASS (live output `master-video-styles/editor` untouched) |
| `video-py` imports (manim 0.19.2, torch 2.15.0+cpu hardlinked x3, skia, OpenCV) | PASS |
| Manim 5-second scene `-ql` | PASS (480p MP4) |
| ffmpeg-skill `probe.py` + `fit.py --aspect 9:16` | PASS (270x480) |
| sfx-generator `sfx render bong` | PASS (0.38 s, 48 kHz stereo) |
| cinematic-film `check_setup.py` | PASS ("ready"; scratch voice optional) |
| motion-educator `doctor.mjs` | PASS after adding `playwright@1.65.1` (Chromium WebGL2 on the Vega 8 via Direct3D 11) |
| HyperFrames 0.9.87 render (blank, 10 s, 300 frames) | PASS in 3 min 40 s with the shared Chromium |
| ComfyUI LTX/Wan test clip | NOT RUN (15-40 min CPU; next step) |
| captions-skill on a real video | NOT RUN (needs your video and your approval of the 1.5 s / 4 s / 8 s frames) |
| still-to-film depth model | NOT RUN (downloads Depth Anything V2, 1.3 GB, on first use) |

### Desktop apps added 2026-11-24 (your "yes do whatd helpful and useful")

Portable, official builds in `C:\Users\Sharafath\AI-Local\apps` (2.74 GB), each SHA-256 checked against the publisher's checksum before extraction; Start Menu folder **AI-Local video apps**.

| App | Signature | Smoke test | Wired into |
|---|---|---|---|
| Blender 5.3.0 | Valid (Blender Foundation) | PASS: headless floor-plan "dollhouse" orbit (4 s, 120 frames at 540x960 in 128 s, Eevee on the Vega 8), 3D title and turntable proof frames | `vs-motion` Blender mode (`scripts/blender_scene.py`, `references/blender.md`), `vs-real-estate`, `vs-lesson` |
| OBS Studio 33.0.3 | Valid (OBS Project LLC) | PASS: scripted 7 s colour-card recording, AMD hardware H.264, hybrid MP4; remote control (obs-websocket) off | `vs-edit` desktop apps, `vs-lesson`; profiles Reel 9x16 (default) and Lesson 16x9, saving to `Videos\OBS-recordings` |
| Kdenlive 26.08.3 | kdenlive.exe valid (KDE e.V.); melt.exe unsigned | PASS: MLT timeline rendered with its melt engine; `.otio` from `vs-edit/scripts/to_otio.py` validated with OpenTimelineIO 0.18.1. NOT VERIFIED: the File → Import → OpenTimelineIO click itself. `kdenlive --render` crashes in this build | `vs-edit` (hand the user an editable timeline) |
| LosslessCut 3.70.2 | Not signed by the project (hash verified) | PASS: launches | `vs-edit` (manual quick trims) |

During the Kdenlive test a keyboard-automation attempt sent Esc and Alt+F to the browser instead of Kdenlive (Windows reported the wrong window as focused) and a capture of that window was taken; the menu was closed with Esc and the capture deleted. Keyboard automation is not used again.

Settings made (user environment): `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, `HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_BROWSER_PATH` and `PLAYWRIGHT_BROWSERS_PATH` = one shared Chromium, `WHISPER_MODEL=small`.

Side effect caught and reverted: `hyperframes init` installed six HyperFrames agent skills into `~/.claude/skills` and `~/.agents/skills`. They were moved (not deleted) to `AI-Local/engines/video-js/_held-skills/`; SkillSpector rated two DO_NOT_INSTALL, two CAUTION, two incomplete. They stay inactive unless reviewed and approved.

## Security review status (2026-11-24)

Source review of everything that would be installed: no malicious code found; all scanner flags resolved in `RESULTS.md`. **Install on hold** until: a Bitdefender custom scan of `resources\repo-quarantine` is clean (Bitdefender flagged three audit *report* files as a stealer heuristic; no repository file was flagged), you say "install now" explicitly, and the motion-educator/stickman SkillSpector scans are retried or accepted. Record: `resources/repo-catalog/smoothie-approval-20261124.md`.

## What still needs you

1. **Bitdefender custom scan** of `resources\repo-quarantine`, then **"install now"** to run the three phases above.
2. **Keys / paid (only if you want them):** Vast.ai or RunPod account + API key for the GPU tier (a few cents to ~$0.30 per job, see GPU-TIER.md); Hypit, vox-director (Atlas Cloud), UGC-Factory/re-walkthrough/advertising-ops (Higgsfield, Apify), AutoClip and DeepTutor (LLM key) stay off unless you approve.
3. **Appendix D:** `ys-sites/insta-reels` became reachable on 2026-11-24 and is staged in quarantine at `6c34fab` (667 files, triage clean). The item-by-item Appendix D audit is the next step; its `skills-hub` branch is not fetched yet.
4. **Optional installs, your choice:** MiKTeX (~1 GB) for Manim equations; Blender (~0.5 GB) for the Blender modes; LosslessCut/OBS as GUI tools.
5. **Clean-up approval** (STORAGE.md): duplicate astryx clone, stale parakeet partial, the 55 audit clones after review.
6. **Could not verify:** `bodila51/gtavi-claudecode` and `devedevt/ffmpeg-gui-editor-windows` return "Repository not found" (checked 2026-11-23 and 2026-11-24); rendering quality of every engine on this CPU is untested until install; GPU times and costs are estimates until the first rental.
