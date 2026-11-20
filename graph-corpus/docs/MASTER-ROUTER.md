# Master router — start here

One map of every tool, skill, repo and asset in this workspace. For any request — "make a video", "add X to the website", "implement this repo" — find the request type in §1, follow its route, and check the tool's status in §2 before promising a result. Keep this file current whenever a tool is added, installed, approved or removed.

**Machine:** Ryzen 7 5825U, integrated Radeon Vega 8 (no NVIDIA/CUDA), 15 GB shared RAM, Vulkan 1.3, ffmpeg installed, Windows 11 + WSL Ubuntu. Local AI runs on CPU (PyTorch) or iGPU (Vulkan via llama.cpp). Models above ~3B parameters for video do not fit; use the cloud route in §3.

## 1. Request → route

| Request | Route (read in this order) | Render / output path |
|---|---|---|
| Educational lesson, explainer, study video | `skills/study-video/SKILL.md` → `docs/video-style-routing.md` → `docs/study-animation-resources.md` | Remotion (installed Claude skill) or the motion skill's own renderer |
| Creator reel, vlog, talking-head, Kelsey/Torsten style; **any "edit in creator style" request** | `skills/creator-video/SKILL.md` → `skills/creator-video/references/real-estate-creator-study.md` (136-reel study: archetypes, numbers, recipes) → `master-video-styles/prompts/mega-video-styles-prompt.md` (18 styles) → `master-video-styles/playbooks/` → `docs/creator-editor-workflow.md` | Remotion; `effects` skill for face-tracked effects |
| Talking-head reels / voiceover glass reel | `docs/local-first-reel-workflows.md` → `talking-head-reels/`, `voiceover-glass-reel/` | Local tools first; Higgsfield notes are reference only |
| Captions (pop-sticker) | `captions-skill/SKILL.md` + `docs/caption-skill-setup.md` — show frames at 1.5 s, 4 s, 8 s and wait for approval | Local caption renderer |
| SaaS / product launch promo | `docs/motionsmith-workflow.md` + `skills/creator-video/SKILL.md` | Remotion or HyperFrames |
| Multi-agent animation (Levi Lab style: voice→scenes→parallel layers→code→review) | Remotion skill; one subagent per layer only for videos > 20 s | Remotion Studio preview, render after approval |
| Character swap / Higgsfield-style "same scene, new character" | Genjutsu (`resources/repo-quarantine/sirioberati/Genjustsu-Open-Source-Workflow`) — staged and triaged, **not approved**; see triage file. Needs Enhancor + Replicate keys, WSL2, catbox fallback off, consent from anyone replaced | Seedance 2.5 via Enhancor (paid, draft first) |
| AI-generated footage (text/image → video) | §3 local AI stack: LTX-Video 2B or Wan 1.3B in ComfyUI. Higher quality, with sound and up to ~60 s: FreeVideo (MiniMax H3) on a rented NVIDIA GPU (§3 cloud route) | `C:\Users\Sharafath\AI-Local\ComfyUI\output` |
| Voice-over, voice cloning | Free first: OmniVoice (local, CPU) or Piper; fish audio MCP (paid credits) only as fallback — it replaces ElevenLabs. Free routes for every paid tool: `docs/ai-editor-research.md` § Free first | Clone only voices the user has consent for |
| Chat-to-edit request ("edit this like Opus / ChatCut / Captions / Shorty"), or a brief pasted from the site's **AI Editor** tab | `docs/ai-editor-research.md` (capability map) → `skills/creator-video/SKILL.md` § Chat-to-edit briefs | Remotion project, render after approval |
| Copy / analyse a reference video shot-by-shot | `JuneYaooo/rea-video` skill (do **not** follow its ChatCut install section) | Analysis report, then rebuild with Remotion |
| Analyse a competitor / reference **website** | REA MCP `capture_browser_scenario` (launch Chrome, `capture.at_end: ["screenshot","accessibility"]`) | Adapt structure and ideas; never copy text, branding or media |
| Real-estate reels | Study: `skills/creator-video/references/real-estate-creator-study.md`; evidence (sheets, cuts, transcripts): `resources/creator-styles/real-estate-study/`; browse: `real-estate-reels/Real-Estate-Reels-Reference.html`, `real-estate-reels-expansion/Real-Estate-Reels-Expansion.html` | Rebuild evidence: `python tools/study_reels.py metrics|transcribe|summarize|report` |
| Pixel-perfect UI from a design | `skills/hyliox-pixel-perfect/SKILL.md` | — |
| Website (live: masvid.vercel.app, Vercel project `master-video-styles`, root directory `master-video-styles/`, no build step) | Pages are generated: edit `master-video-styles/data/*.json` or `scripts/build.py`, then `python master-video-styles/scripts/build.py` (index, styles, skills, reels). The AI Editor at `/editor/` is the Vite app (`src/App.tsx`, `src/components/AIEditorStudio.tsx`): `npm run lint`, then `npm run build:live` and commit `master-video-styles/editor/`. Home layout follows opus.pro/ai-video-editor (`docs/ai-editor-research.md`) | Vercel deploys from `main` |
| Security check of the website | 20-attack prompt (static SPA: none apply today); hardening = headers in `vercel.json`, no keys in `vite.config.ts` `define` | — |
| Security check of a new repo | §4 | `resources/repo-catalog/` |
| Automation (watch feeds, auto-post, notify) | Huginn (`resources/repo-quarantine/huginn/huginn`) — needs Docker; not installed | — |

Unsure which skill fits? `python tools/resource_catalog.py route "<task>"` suggests candidates (it never runs them).

## 2. Capability status

**Ready now** — Claude skills/connectors in this environment: `remotion:*` (create, render, captions, studio), `effects` (45 talking-head effects), `anatomy` (isometric explainer figures), `dataviz`; MCP: REA (web/binary analysis), HyperFrames by HeyGen (hosted projects only), fish audio (TTS/voice, paid credits), invideo, Canva.

| Tool | Location | Status | Use for |
|---|---|---|---|
| Cloudflare plugin (`cloudflare@cloudflare` 1.0.4) | Claude Code user plugin; skills in `~/.claude/plugins/cache/cloudflare/cloudflare/1.0.4/skills` (wrangler, workers, R2 via `cloudflare` skill), MCP `https://mcp.cloudflare.com/mcp` | Installed 2026-11-19 from the official `cloudflare/skills` marketplace; MCP needs a restart and a one-time Cloudflare OAuth login | R2 video storage, Workers for signed uploads; `cf` CLI not installed (optional, user to decide) |
| Worker `masvid-uploads` | `workers/masvid-uploads` → https://masvid-uploads.restoredinmtl.workers.dev (Cloudflare account restoredinmtl) | Deployed 2026-11-19; R2 bucket `masvid-videos` + Workers AI (Llama 3.3 70B). Requires a Supabase sign-in, so it stays idle until accounts are switched on | Video uploads (≤95 MB, 2 GB per user) and the editor's chat agent. Redeploy: `npx wrangler@4.20.0 deploy` in that folder |
| ComfyUI (CPU) | `C:\Users\Sharafath\AI-Local\ComfyUI` | Installed by user 2026-11-19; first render untested | Node-based image/video generation |
| LTX-Video 2B distilled fp8 | `ComfyUI\models\checkpoints` + T5 fp8 in `text_encoders` | Downloaded 2026-11-19, sha256-verified; render untested | Fastest local text/image→video; low res, short clips, ~15–40 min each |
| Wan 2.1 T2V 1.3B | `ComfyUI\models\diffusion_models` + UMT5 fp8 + Wan VAE | Downloaded 2026-11-19, sha256-verified; render untested | Better motion than LTX, slower (~30–60+ min per short clip) |
| OmniVoice | `C:\Users\Sharafath\AI-Local\OmniVoice` | Setup script ready; run `setup-tier1.ps1 -Tool omnivoice` | Local TTS / voice cloning on CPU |
| freefield apps | `resources/repo-quarantine/neuregex/freefield` | Reviewed, not yet loaded into ComfyUI | 120 ComfyUI apps; only small-model apps are practical here |
| inference-optimisation-skill | `resources/repo-quarantine/sybil-solutions/...` | Reviewed, not installed | Speed up local LLMs (llama.cpp + Vulkan on the iGPU) |
| 14 motion skills | `resources/motion-systems/*` | Reference skills; scanner flags reviewed as benign, 3 large folders incompletely scanned | Styles: Anidoodle, Bang Motion, Paint MV, hand-drawn, Manim, etc. |
| open-higgsfield-ai, Open-Generative-AI | `resources/repo-quarantine/...` | Reviewed; front ends for paid **muapi.ai** API | Hosted image/video generation with a muapi key |
| FreeVideo (MiniMax H3, `FlashML-org/FreeVideo` 2259974) | `resources/repo-quarantine/FlashML-org/FreeVideo` | Triaged 2026-11-20, no malicious indicators, **not approved**. Hard-requires NVIDIA RTX 30+ (≥ 8 GB VRAM) or Apple-silicon Mac; refuses this PC | Best open text/image→video with audio, ~60 s, drama/shot tools; has its own MCP + Claude skill. Cloud GPU only |
| HunyuanVideo, Open-Sora, LongCat-Video-Avatar, HeyGem, WanGP (large models) | `resources/repo-quarantine/...` | Too large for this PC | Cloud GPU route (§3) |
| 12 security tools | `resources/security-tools/*`, `resources/skillspector-source` | Source staged; SkillSpector installed in WSL | §4 |

## 3. Local AI stack

- Root: `C:\Users\Sharafath\AI-Local\` (outside the git repo). One Python 3.12 venv per tool, created with `uv` (`C:\Users\Sharafath\AppData\Roaming\Python\Python314\Scripts\uv.exe`). CPU PyTorch from `https://download.pytorch.org/whl/cpu`.
- Setup: `setup-tier1.ps1 -Tool comfyui|omnivoice` (clones from the reviewed quarantine commit, never from the network).
- Models: `download-models.py` — official Hugging Face `.safetensors` only, each verified against the published SHA-256; resumable. Never load `.ckpt`/`.pt`/`.pkl` weights from unofficial sources (they can execute code).
- Start ComfyUI: `C:\Users\Sharafath\AI-Local\ComfyUI\.venv\Scripts\python.exe main.py --cpu` then open http://127.0.0.1:8188.
- Practical limits: keep video at ≤ 512 px wide, ≤ 3–5 s, few steps (distilled models). Close other apps while rendering (RAM is shared with the iGPU).
- Cloud route for 11–14B models (HunyuanVideo, Open-Sora, LongCat, HeyGem, big WanGP models): rent an NVIDIA GPU by the hour (paid — the user decides), run ComfyUI there, control it from this PC's browser.
- FreeVideo on the cloud route: Linux RTX 30/40/50 box (16 GB VRAM + 32 GB RAM ≈ 8–10 min per 5 s clip per its benchmarks), clone the reviewed commit, `./setup.sh` with official-only sources, `freevideo server` on 127.0.0.1 and reach it through `ssh -L`. Never `--listen 0.0.0.0` on a public host.

## 4. Security rules for anything new

1. Stage only: `resources/repo-quarantine/<owner>/<repo>` via the hardened clone (no hooks, LFS, submodules or symlinks; shallow) with a `*.provenance.json` (commit, date).
2. Triage read-only: install hooks, download-and-execute, pickle weights, `trust_remote_code`, extra package indexes, shipped binaries, secrets, hidden Unicode, prompt-injection text. Record in `resources/repo-catalog/quarantine-triage-20261119.md` (or a new dated file).
3. `python tools/security_gate.py <path>` — currently always BLOCKED; execution needs the user's explicit approval, recorded in the catalog.
4. Run approved tools only from `AI-Local` copies at the reviewed commit, in their own venv.
5. Scanner scores are leads, not verdicts. Known SkillSpector noise: SC9 on `.git/*` and images, AE1 = coverage gap. Scan clean `git archive` exports (`tools/scan_motion_skills.py --clean-export`).

Audit status: `resources/repo-catalog/AUDIT-STATUS.md`. Security tool roles: `docs/security-tool-staging.md`.

## 5. Assets and projects

| What | Where |
|---|---|
| Style studio data | `master-video-styles/` (playbooks, prompts, data) and `src/masterStylesData.ts` |
| Creator research (Kelsey/kelssie3 — private, not licensed for publication) | `resources/creator-styles/`, `Creator style kelssie3/` |
| Motion library, 3D assets, director guides | `resources/concordia/` |
| Presets | `Kenyset preset pack/` + `docs/kenyset-presets.md` |
| Video projects | `video-projects/` (e.g. `shawarma-moods-christmas-2026`) |
| Reference PDFs | `Vox Explainer Guide - justdodani.pdf`, `Motion-Graphics-with-Claude-Code.pdf`, `video-editing-systems-inventory.pdf` |
| Website research (Opus, ChatCut, Captions, Shorty; 2026-11-19) | `docs/ai-editor-research.md` — patterns taken, capability map, APIs that would close gaps |
| Website research (ignix.social, 2026-11-19) | Outcome headline, one primary CTA + reassurance, "Sound familiar?" before/after, numbered "start where you need it" cards, short product video, real examples |

## 6. Removed

- 2026-11-19: `Immortal-Protocols/lastbook` deleted (offline survival library; no video or website use).
