# The smoothie: one video system, ready to install (not installed)

Branch `smoothie/merged-system`, not pushed. Nothing here is installed in the live system yet: the gate is you saying **"install now"**.

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

## What still needs you

1. **"install now"** to run the three phases above.
2. **Keys / paid (only if you want them):** Vast.ai or RunPod account + API key for the GPU tier (a few cents to ~$0.30 per job, see GPU-TIER.md); Hypit, vox-director (Atlas Cloud), UGC-Factory/re-walkthrough/advertising-ops (Higgsfield, Apify), AutoClip and DeepTutor (LLM key) stay off unless you approve.
3. **Access:** `ys-sites/insta-reels` is private: grant access (or add the Muse GitHub App) so Appendix D can be audited.
4. **Optional installs, your choice:** MiKTeX (~1 GB) for Manim equations; Blender (~0.5 GB) for the Blender modes; LosslessCut/OBS as GUI tools.
5. **Clean-up approval** (STORAGE.md): duplicate astryx clone, stale parakeet partial, the 55 audit clones after review.
6. **Could not verify:** `bodila51/gtavi-claudecode` and `devedevt/ffmpeg-gui-editor-windows` return 404; rendering quality of every engine on this CPU is untested until install; GPU times and costs are estimates until the first rental.
