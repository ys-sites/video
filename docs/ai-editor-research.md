# AI editor research — Opus, ChatCut, Captions, Shorty (2026-11-19)

Website teardown with the REA MCP (`capture_browser_scenario`, Chrome launch, accessibility + screenshot at the end of a 4 s settle). Captured pages: `opus.pro/ai-video-editor`, `chatcut.io`, `captions.ai/features/edit-with-ai`, `shortyedit.com`, and Instagram reel `DfqReHJOECi` (login wall: only the caption, counts and first frame were visible, so no shot-by-shot breakdown). We took structure and interaction ideas, never their text, branding or media. The result is the **AI Editor** tab: `src/components/AIEditorStudio.tsx`.

## What each site does well, and what we took

| Site | Pattern | On our page |
|---|---|---|
| Opus | One promise, then two entry cards (long video → clips / raw footage → finished edit); "AI makes the edit, you keep the last word"; Speed/Customize/AI feature tabs; "which do I need" comparison; API + MCP block; FAQ | Hero with two entry cards, Full edit / Clips modes, feature tabs, "Which way in?", "In your agent", FAQ |
| ChatCut | Chat panel + preview + multi-track timeline (motion graphics, image, video, music, SFX) in one demo; edit log "here's what I changed"; every layer editable; 4-step loop ending in "save as a skill, batch" | Working editor: chat → edit log with a reason per change → six-track timeline; click a block to rename, nudge or remove; undo/redo; the 4-step loop |
| Captions | "Try it now" prompt box with quick-prompt chips and style picker; one-tap fixes grid (trim, denoise, eye contact, background, enhance, zooms) | Quick prompts, style picker, one-tap fixes that feed the next edit and name the tool that does each fix |
| Shorty | Prompt bar with footage tile, **reference reel**, format, duration and a **versions** stepper; workflow shortcuts; template gallery with "Recreate this" by category | Reference-reel field, versions stepper, and a "Recreate this" gallery built from the 12 measured archetypes of our 136-reel study (not their templates) |
| Instagram `zoejobss` reel (12K likes, 5.8K comments) | Real-estate agent screen-records Shorty on listing footage; caption funnel "Comment LISTING and I'll send the link + prompt" | Confirms the HT/CF listing recipes and the comment-for-link CTA pattern already in the creator study §5 |

## Capability map — their features on our stack

| Feature | Our route | Status |
|---|---|---|
| Long video → clips | Whisper word timings (captions-skill venv) → Claude picks hook/payoff → Remotion | Ready |
| Animated captions | `captions-skill` pop-sticker or `remotion:remotion-captions` (check frames 1.5/4/8 s) | Ready |
| Filler and pause removal | Word timings → trims in Remotion `<OffthreadVideo>` | Ready |
| Auto reframe 9:16/1:1/16:9 | `effects` skill face tracking, or ffmpeg crop | Ready |
| Zooms, face-tracked effects | `effects` skill (45 effects) | Ready |
| Denoise + loudness | ffmpeg `afftdn` + `loudnorm` to −14 LUFS | Ready (basic); better isolation needs a model or API |
| Background removal | `effects` skill segmentation | Ready for simple cases |
| B-roll | User footage; generated inserts via ComfyUI LTX/Wan (slow on this PC) | Partial — stock search needs an API key |
| AI voice-over / clone | OmniVoice (local CPU) or fish audio MCP (paid credits) | Ready; clone only with consent |
| AI music | Licensed library only | Gap |
| Eye contact | — | Gap: needs an NVIDIA GPU (Maxine) or a paid service |
| Image/video models | fish audio, invideo, HyperFrames MCPs (paid); Higgsfield-style workflows pending Genjutsu review | Partial |
| Recreate a reference reel | `JuneYaooo/rea-video` skill (staged, not approved to run) → Remotion | Pending approval |
| Chat-to-edit in your agent | Claude Code + this repo's skills (the page exports the brief) | Ready |

## APIs that would close the gaps (optional, user decides)

- **Pexels API key** (free): automatic stock B-roll search for the B-roll track.
- **Voice isolation** (e.g. ElevenLabs or Auphonic, paid): studio-grade denoise beyond ffmpeg.
- **Cloud GPU by the hour** (paid): eye contact, large video models, heavy matting (MASTER-ROUTER §3).
- Not needed: an LLM API — Claude Code does the planning and editing.
