---
name: vs-edit
description: Edit real video and audio with one local FFmpeg - probe, cut, join, reframe to 9:16, remove silence, speed, overlays, loudness, platform exports, long-to-shorts clipping, assembly of rendered scenes with narration, and final QA (probe, flash, black/silence, loudness, contact sheet). Use whenever footage exists or a render must be assembled, checked or exported.
---

# Edit (one FFmpeg, one toolset)

Base layer of every job that has footage or rendered scenes. Engine: the ffmpeg-skill toolset installed at `C:\Users\Sharafath\AI-Local\engines\ffmpeg-skill@bad487c` (Python standard library + the system FFmpeg already on this PC). Call `python <engine>/scripts/<tool>.py ... --json`; `--help` lists flags; `--dry-run` plans without writing.

## Order of work

1. **Probe** what you plan from (`probe.py`): real duration, fps, size, audio layout. Never assume.
2. **Lossless first**: cut/remux/audio-only changes without re-encoding when possible (`cut.py` smart cut).
3. **Chain** in this order: colour → cut → join → silence → fit (reframe) → captions/overlays → sync → audio mix → loudness → export.
4. **Three or more steps or a delivery** → one `render.py` project (or `--template` for a platform), not a chain of temp files.
5. **Check** the output (`check.py OUT --platform tiktok|reels|shorts|youtube`); **look** after any picture change (`look.py OUT --tiles 3x2`, then view the PNG).
6. **Never overwrite a source.** Outputs go to `video-projects/<project>/exports/` (or the project's own folder); `--overwrite` only on this job's files.

## Tool map

| Need | Tool |
|---|---|
| Trim, split, keep ranges | `cut.py` (smart cut), `insert.py`, `freeze.py`, `reverse.py`, `loop.py` |
| Join clips / multicam / sync two sources | `join.py`, `sequence.py`, `multicam.py`, `sync.py` |
| 16:9 → 9:16, pad, crop to subject, blurred fill | `fit.py --aspect 9:16 --fit crop|pad|blur`, `crop.py`, `cropdetect.py`, `pad.py` |
| Remove dead air | `silence.py --threshold -35` |
| Speed ramps | `speedramp.py` |
| Text, logo, b-roll, picture-in-picture, grid | `graphics.py`, `overlay.py`, `broll.py`, `grid.py` |
| Captions from a transcript (simple styles) | `caption.py --animate pop --karaoke` (styled social captions: `vs-voice-captions`) |
| Colour, look, denoise, stabilise, straighten | `color.py`, `look.py`, `denoise.py`, `stabilize.py`, `straighten.py` |
| Audio cleanup, music bed, loudness | `audio.py`, `loudness.py -I -14 --tp -1` (social), `-I -16` (YouTube), `waveform.py` |
| Scene detection / find highlights | `scenes.py`, `report.py` |
| Proxies for slow footage on this laptop | `proxy.py` (edit on proxies, render from originals) |
| Platform export | `export.py` / `render.py --template` |
| Redact a region, inspect or strip metadata | `redact.py`, `metadata.py` (check `--help` for what each supports) |

## Recipes

- **Long video → shorts** (podcast, lecture, tour walk-through): transcribe (`vs-voice-captions`), pick 3–10 self-contained moments of 20–60 s with a hook in the first 2 s, `cut.py` each, `fit.py --aspect 9:16`, captions, `loudness.py`, `check.py --platform`. AutoClip (zhouxiaoka/autoclip) automates this with an LLM; it is not installed (it needs an LLM API key) — do it with these tools instead.
- **Assemble rendered scenes with narration**: probe every scene and the narration; retime scenes to the narration with `setpts`/`atempo` only within ±8% (beyond that re-render the scene); land each cut on its cue word; carry the last frame of scene N into scene N+1 when continuity matters; write a timeline manifest (scene, in, out, cue) next to the export.
- **Vertical safe zones**: keep text out of the top ~12% and bottom ~20% (platform UI); faces in the upper third.
- **Social audio**: speech −14 LUFS integrated, true peak −1 dBTP; duck music 10–14 dB under speech; music-only pieces −14 LUFS.

## QA gate (before any video is called done)

1. `check.py OUT --platform X` — codec, size, fps, duration, loudness.
2. Black frames and silence: `ffmpeg -i OUT -vf blackdetect=d=0.3 -af silencedetect=n=-50dB:d=0.8 -f null -`.
3. Flash check: no full-frame luma jump > 0.6 between consecutive frames unless the plan asked for it.
4. Contact sheet (`look.py --tiles 4x3`) viewed; first frame works as a thumbnail.
5. Report what was verified and what was not (no vision → say the pixels were not inspected).

## Desktop apps (installed portable in `C:\Users\Sharafath\AI-Local\apps`)

| App | Use it for | How |
|---|---|---|
| **OBS Studio 33.0.3** (`obs-studio-33.0.3\bin\64bit\obs64.exe`) | Recording the user: talking-head reels, screen lessons, tutorials | Portable config inside its folder. Profiles: **Reel 9x16** (1080×1920, default) and **Lesson 16x9** (1920×1080); AMD hardware H.264, hybrid MP4, saved to `C:\Users\Sharafath\Videos\OBS-recordings`. The user adds their camera/screen sources once. Remote control (obs-websocket) stays off. Start from a script only with quoted names: `--profile "Reel 9x16" --startrecording` (working dir `bin\64bit`) |
| **Kdenlive 26.08.3** (`kdenlive-26.08.3\bin\kdenlive.exe`) | Handing the user an editable timeline to fine-tune by hand | Write the cut as an edit list, then `python scripts/to_otio.py edit.json cut.otio`; the user opens Kdenlive → File → Import → OpenTimelineIO. Opening the `.otio` directly is refused and `kdenlive --render` crashes in this build, so final renders stay in this skill (FFmpeg, or Kdenlive's `melt.exe` for an MLT timeline). The same `.otio` opens in DaVinci Resolve and Premiere |
| **LosslessCut 3.70.2** (`losslesscut-3.70.2\LosslessCut.exe`) | The user's own quick trims and splits with no re-encode | Manual GUI tool; for scripted trims use `cut.py` |

Not installed (covered elsewhere): HandBrake (export.py), Shotcut (Kdenlive), DaVinci Resolve (needs 16 GB RAM and a discrete GPU).

## Sources merged here (references only)

kajisho5/ffmpeg-skill@bad487c (engine; MIT) · iamaanahmad/agents-video-editing-skills@981466b (ffmpeg-essentials, vertical-shorts, platform-export, video-qa, thumbnails, audio-mixing; MIT) · saranambiar/hyperframes-video-agent-skills@f6b043d (audio-sync-assembly, render-qa-and-surgical-changes, scene-continuity; Apache-2.0) · zhouxiaoka/autoclip@dd1f5da (long-to-shorts flow; MIT) · runesleo/claude-video-kit@3a908d8 (final-artifact gates; MIT) · `ecc-video-editing` (layer pipeline) · AustinZ21/cinematic-skills (flash check, finish).
