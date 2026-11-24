
## Website skills (`master-video-styles/data/skills.json`, 35)

| Skill | Status on the site (verified) | Merged into |
|---|---|---|
| Remotion skills | ready | vs-motion |
| captions-skill | ready | vs-voice-captions |
| effects | ready | vs-motion, vs-real-estate |
| talking-head-reels | reference | vs-real-estate |
| DaVinci Resolve MCP | reference | - (needs Resolve) |
| HyperFrames (local skills) | ready | vs-motion (HyperFrames engine) |
| motionmaxxing | reference | vs-motion |
| motion-video-director | reference | vs-director |
| Anidoodle | reference | vs-lesson (study-video route) |
| Bang Motion | reference | vs-lesson (study-video route; DO_NOT_INSTALL flag) |
| Hand-drawn and whiteboard | reference | vs-lesson |
| Manim | ready | vs-lesson |
| Lemo-Opuscar, Paint MV, Huashu | reference | vs-director / vs-motion (ideas) |
| GSAP, Three.js, p5.js, Theatre.js | reference | vs-motion (GSAP + three.js installed) |
| anatomy | ready | vs-lesson |
| OmniVoice | setup | vs-voice-captions |
| Piper TTS | reference | vs-voice-captions |
| VoiceStudio, Coqui TTS | reference | - (duplicate TTS) |
| Whisper (+ whisper.cpp, WhisperX) | ready | vs-voice-captions (one model: small) |
| fish audio | paid | vs-voice-captions (paid fallback) |
| ElevenLabs, Azure, Doubao, DashScope skills | paid | - |
| Code-synth soundtrack | ready | vs-voice-captions |
| AudioCraft / MusicGen | reference | vs-voice-captions (GPU tier) |
| ACE-Step 1.5 | reference | vs-voice-captions (GPU tier) |
| media-use | reference | vs-edit |
| ElevenLabs music and SFX, Lyria | paid | - |
| ComfyUI + LTX-Video 2B / Wan 2.1 1.3B | setup | vs-generate |
| Claude Drawing | reference | vs-lesson |
| UGC Factory prompt styles | reference | vs-generate (paid styles) |
| Seedance, Kling, MiniMax H3, Grok, FLUX, Atlas Cloud | paid | - |
| Genjutsu character swap | paid | vs-generate (GPU tier; Openjutsu) |
| REA MCP | ready | vs-director (reference study) |
| rea-video | reference | vs-director |
| 136-reel creator study | ready | vs-real-estate |
| website-to-video, playwright-recording | reference | vs-motion (launch-video mode) |

Status check: the 8 `ready` entries are installed and working on this PC; none claims ready for something missing. No status change is needed until the smoothie is installed; then the installed rows (GSAP/three, Manim, HyperFrames engine) move to `ready`.

## Security tools (`security-tool-registry.json`, 12)

Not part of the video smoothie. Used in this run: SkillSpector (offline, bwrap sandbox, `--no-llm`) and the workspace triage + security gate. Trivy, Semgrep and TruffleHog run in GitHub Actions only (`.github/workflows/security.yml`); ClamAV, Nuclei, Strix, PyRIT, BLA, Codex Security and Claude Code Security Review stay staged source references (`docs/security-tool-staging.md`); the Cloudflare audit skill needs OAuth.

## Skill index (`skill-index.json`, 178 rows)

| Parent | Rows | Fate |
|---|---|---|
| openmontage | 139 | AGPL reference; ideas merged into all vs-* skills, nothing copied |
| ugc-factory | 16 | Paid Seedance styles → vs-generate prompt references |
| MiniMax-H3 (FreeVideo) | 11 | GPU tier of vs-generate |
| voicestudio | 4 | Duplicate TTS; vs-voice-captions uses OmniVoice/Piper |
| motion-library, motion-video-director, design-motion-principles, motionmaxxing | 5 | vs-motion / vs-director |
| lemo-opuscar | 2 | Style ideas (licence unstated) |
| claude-video-effects | 1 | Installed as the `effects` skill |

## Already implemented (kept, not redone)

`skills/creator-video` (extended by vs-real-estate), `skills/study-video` (extended by vs-lesson), `skills/hyliox-pixel-perfect` (website, unchanged), `resources/visually-research/rea-skill` (the REA MCP connector is available in Claude Code; the skill file itself does not register it).

## Not video (Appendix C, 73 repositories)

Rows with bucket "none" in the per-video Facebook pull (downloaders, CRMs, OS tools, games, forecasting, OCR, etc.) are out of scope by the brief's own buckets and were not cloned.
