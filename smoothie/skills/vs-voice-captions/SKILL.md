---
name: vs-voice-captions
description: Everything you hear and read in a video - transcription with one shared Whisper model, word-timed animated captions (7 styles), narration with free local TTS (OmniVoice, Piper) or the user's own voice, code-synthesised sound effects, music beds with ducking, and loudness. Use for captions, subtitles, voice-over, SFX, music or audio cleanup.
---

# Voice and captions

Free and local first. Paid voices (fish audio MCP, ElevenLabs) are fallbacks only, after the user says yes.

## One model per job (no duplicates)

| Job | The one tool | Where |
|---|---|---|
| Transcribe / word timings | faster-whisper **small**, int8, CPU (already cached, 461 MB) | `~/.cache/huggingface/hub/models--Systran--faster-whisper-small`; set `WHISPER_MODEL=small` for `captions-skill` so it never downloads `base` |
| Animated social captions | `captions-skill/` (7 styles; Node + system Chrome) | Repo folder, already set up |
| Narration (local) | OmniVoice (`AI-Local/OmniVoice`, CPU) — clone only voices with consent; Piper for fast plain voices | `setup-tier1.ps1 -Tool omnivoice` |
| Sound effects | sfx-generator recipes (numpy synthesis, nothing to license) | `AI-Local/engines/sfx-generator@a7c25d5` |
| Music | User-supplied or licensed tracks; code-synth soundtrack (`resources/motion-systems/javascript-animation-skills`); MusicGen/ACE-Step only on the GPU tier | — |
| Mix / loudness | `vs-edit` (`audio.py`, `loudness.py`) | — |

## Captions workflow (the caption gate is mandatory)

1. Words: `python captions-skill/scripts/words.py <video>` → `<video>.words.json` (with `WHISPER_MODEL=small`).
2. Tidy the JSON, keeping timings: fix names/brands (ask when unsure), mark one key word per line (`"k": true`), break lines at natural pauses into 2–4 words under ~20 letters (`"br": true`), write symbols as read ("%", "/").
3. **Check frames** at 1.5 s, 4 s and 8 s (`node captions-skill/scripts/render.js <video> <words> <style> --still 1.5 --still 4 --still 8`), show them, **wait for approval**.
4. Render the full video; never overwrite the source. Fonts load from Google Fonts (needs internet).
5. Placement: talking head `--y 64` (under the chin); keep out of the 9:16 UI zones (top ~12%, bottom ~20%).

Default style by job: real-estate and creator reels `pop-sticker` or `editorial-highlight`; lessons `editorial-highlight` or plain SRT; cinematic films burned-in lower-case serif or none (subtitle file only).

## Narration workflow

1. Write the script for the ear: numbers as words in a `spoken` field, ≤ 20 words a line, one idea per line.
2. **Scratch voice first** (Piper or OmniVoice default voice) to time the film; build the timeline from it; swap the final voice at the end.
3. Split whole takes into one clip per line; listen to every flagged cut; join into `narration.wav` + `timing.json` (line, start, end, key-word times). Visual hits land on key-word times, not line starts.
4. Clean: high-pass ~80 Hz, gentle de-ess, −16 LUFS for the voice stem before the mix.

## Sound effects

Describe the event, the character (soft, bright, dry, long…), the length and the context (under narration? UI? loop?). Pick the nearest recipe family and adjust parameters; if none fits, make a new recipe. You cannot hear: report levels, length and the spectrogram, and let the user listen. Default for films: music only; add SFX when the story turns on a sound, and say so in the plan.

## Music bed

Pick tempo first (it sets the edit grid). Duck 10–14 dB under speech with ~150 ms attack, ~400 ms release; fade the tail; end on 0.5 s of silence. Licensed or user-provided music only; record the licence in the project notes.

## Sources merged here (references only)

`captions-skill` (@vibha.in.progress starter pack, in repo) · thisisvela/sfx-generator-skill@a7c25d5 (Apache-2.0) · iamaanahmad/agents-video-editing-skills@981466b (captions-subtitles, voiceover-tts, audio-mixing; MIT) · saranambiar/hyperframes-video-agent-skills@f6b043d (captions-and-music-bed; Apache-2.0) · Moh4696/cinematic-skill@bf43556 (scratch voice, split takes, timing file; MIT) · debpalash/VoiceStudio and coqui/piper in `resources/concordia/video-motion/` (reference) · OmniVoice (k2-fsa, installed by `setup-tier1.ps1`).
