# Chet GTA — production pipeline

Each step ends in a **gate**: the user approves before the next step spends credits. Log every step's prompts and results in `brainstorming.md`.

Status words used below: **ready** = installed and usable now · **setup ready** = install script exists, not yet run · **reference** = staged source we read for prompting/planning ideas, not executed · **not approved** = staged, needs the security gate and the user's approval before it runs · **cloud GPU** = too big for this PC (no NVIDIA GPU).

**Higgsfield:** the user's main generator for images, video and audio. No Higgsfield connection exists in this session, so each step writes prompts ready to paste into Higgsfield (or to run through Higgsfield tools once they are connected). Before any batch: check the balance, total the credits for the whole list, ask once, and test one item of each kind first (`resources/higgsfield-reference/voiceover-glass-reel-higgsfield.md`).

## Folder layout

```
chet-gta/
  brainstorming.md          living memory (read first, append last)
  PIPELINE.md               this file
  project.json
  story/storyline.md        beats, layout, scenes, lines
  01-assets/                characters/ objects/ locations/ style/  (sheets + prompts)
  02-voice/                 <character>/ reference, voice bible, tests, locked settings
  03-manga-storyboard/      pages/ panels/ panel-list.md
  04-higgsfield-scenes/     S01…S10/  prompts.md, start frames, takes, selects
  05-edit/                  timeline, HUD and phone UI, bubble composite, captions, exports
  input/                    user-supplied photos, voice samples, logo (never overwritten)
```

## Step 00 — Plan (done in I-001)
Storyline, beat sheet, scene list, open questions. Tools: `vs-director` skill (beats, six-layer shots, sealed moves; merges AustinZ21/cinematic-skills, Moh4696/cinematic-skill, vincentwei1021/video-shotcraft, saranambiar/hyperframes-video-agent-skills, iamaanahmad/agents-video-editing-skills), `ecc-marketing-campaign`, `ecc-content-engine`, `ecc-taste`, `creator-video` skill and the 136-reel hook study. References: storytold/filmcraft, openfilm/openfilm, alisa0808/vox-director, heydamir/unslop (strip AI-sounding lines from the script).

## Step 00b — @qinacademy reel study (before Step 01)
The real Chet and Sobhi are studied from the reels the user saves into `input/qin-instagram/` (Instagram needs a login, so nothing is scraped). For every file: a contact sheet and cut and pacing metrics (`vs-edit`, same method as `tools/study_reels.py`), and a Whisper transcript (`vs-voice-captions`). Then per-character notes: look, wardrobe, voice, catchphrases, energy and running jokes, plus the brand logo and colours. Output: `01-assets/characters/<name>/bible.md` and `02-voice/<name>/voice-bible.md`, which feed the lines in `story/storyline.md`. References: JuneYaooo/rea-video (shot-by-shot analysis), `creator-video` study method.

## Step 01 — Assets: character, object and location sheets
**Deliverables**
- Style bible: two looks. (a) Game layer, GTA VI-inspired: sun-bleached neon, high-saturation teal and magenta, glossy real-time-render look, slight satire. (b) Bubble layer: realistic webcam, RGB-lit room.
- Character sheets (front, back, 3/4, head close-up, 3–4 expressions): **Chet** (game), **Sobhi** (real life, plus an optional game version for the fourth-wall shot), **student**, **cashier**, 2–3 background students.
- Object sheet: KD-style box (Q4), shopping basket, Chet's phone and its UI frame, payment card and terminal, Chet's car, Sobhi's controller, headset and phone.
- Location sheets: store aisle (KD wall), aisle end-cap, checkout, parking lot, car interior, Sobhi's gaming room.

**How:** Higgsfield image models (the reference doc suggests `soul_cinematic` / `seedream_v5_pro` / `cinematic_studio_2_5`, with reference photos as `image_references` to keep faces). The three-panel character-sheet prompt pattern comes from `resources/higgsfield-reference/`. Fallbacks: Canva `generate-image` (ready), fish audio `generate_image` (paid credits). References: sunnychase/open-higgsfield-ai and Anil-matcha/Open-Generative-AI (Higgsfield-style front ends, muapi.ai; reference), atuizz/posewear (poses; reference), sirioberati/Genjutsu (Higgsfield-style character swap; **not approved**, consent needed).
**Gate:** user approves every sheet; locked sheets become the references for every later prompt.

## Step 02 — Voice foundation
One locked voice per speaking character (Chet, Sobhi, student, cashier) plus the cashier's trance version. These are used for every line in the video.

**Deliverables per character** (`02-voice/<name>/`): voice bible (age, pitch, pace, accent, energy, sample lines), clean reference audio, 3 test lines, the locked model and settings, consent note.

**Tools, tried in this order (free first):**
| Tool | Status | Use |
|---|---|---|
| OmniVoice (k2-fsa, `C:\Users\Sharafath\AI-Local\OmniVoice`) | setup ready (`setup-tier1.ps1 -Tool omnivoice`) | Local voice cloning from a 10–30 s sample; primary |
| Piper | ready via `vs-voice-captions` | Fast local scratch voices for timing |
| Higgsfield audio / lip-sync | user's account | On-screen dialogue matched to the generated faces |
| fish audio MCP (`create_voice_clone`, `design_voice`, `text_to_speech`) | ready, paid credits | Fallback clone, or a designed voice for invented characters |
| debpalash/VoiceStudio | not approved | Reference / possible later local voice studio |
| suifeng9203/HeyGem, MeiGen-AI/LongCat-Video-Avatar | cloud GPU | Lip-sync and talking avatars if Higgsfield's lip-sync falls short |
| thisisvela/sfx-generator-skill, fish audio `generate_sound_effect` | reference / paid | Phone buzz, scanner beep, trance drone |
| FFmpeg via `vs-edit` | ready | Trance processing: pitch, reverb, reverse echo, ducking |

**Consent:** if Chet or Sobhi is a real person, clone only from their own recording and with their OK. Otherwise design an original voice.
**Gate:** the user listens to the test lines and locks each voice.

## Step 03 — Manga storyboard
One black-and-white manga panel for **every action** in the beat sheet (about 30 panels), 9:16 panels, 4–6 per page. Each panel carries: shot ID, size and angle, the one camera move (with its start and end frame), the character pose, the dialogue balloon, the SFX lettering, and timing. Panels act as the AI's plan and as layout or start-frame references for Step 04.

**Tools:** `vs-director` shot list → panel list (`03-manga-storyboard/panel-list.md`); Higgsfield image model in an ink-and-screentone manga style using the locked sheets; Canva `generate-image` as a fallback. References: JDhruv14/line-art-animation, kaomei/stickman-video-director, `resources/motion-systems/` (Anidoodle and the hand-drawn styles), dozentwelve/papermorph. The animatic is assembled on the 100 BPM grid with scratch Piper audio (`vs-edit`).
**Gate:** the user approves the animatic before any video generation.

## Step 04 — Higgsfield, scene by scene
For each scene S01–S10 (`story/storyline.md`): a six-layer prompt per shot (subject and action, size, angle, lens, one sealed move, pace and limits), a start frame made from the manga panel and the locked sheets, and a negative list (no logos, no text in the picture, no morphing faces, no flashes). Generate one look-test shot to final first, then batch the rest. Keep 2–3 takes and pick a select per shot.

**Tools:** Higgsfield video models (main). Fallbacks: local LTX-Video 2B / Wan 2.1 1.3B in ComfyUI (ready, low resolution, short clips; best for drafts), FreeVideo / MiniMax H3 and d3voz/openjutsu (cloud GPU, not approved), WanGP, HunyuanVideo and Open-Sora (cloud GPU). Planning reference: `vs-generate`.
**Gate:** every shot reviewed against the `vs-director` checklist.

## Step 05 — Edit, sound, captions, delivery
- Assembly on the beat grid with `vs-edit` (FFmpeg) or Remotion; Kdenlive for hand fixes.
- Overlays built in code (Remotion / Masvid Studio / OpenMotion): Finals Level stars, OBJECTIVE text, the GTA-style phone and its notifications (the `effects` skill's iMessage pop-ups as a base), subtitles with speaker names, the TRANS—ACTION title, the Sobhi bubble and its grow-to-half-frame move, and the end card.
- Captions with `captions-skill` (pop-sticker: show frames at 1.5 s, 4 s and 8 s and wait for approval).
- Sound: music bed with ducking, SFX, loudness (`vs-voice-captions`).
- QA: flash, black and silence checks, loudness, safe zones, contact sheet (`vs-edit`). Export 1080×1920.
- Publishing only with approval (`ecc-short-video-distribution`).
