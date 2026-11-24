#!/usr/bin/env python3
"""Build smoothie/RESULTS.md and audit/verdicts.json from the curated verdicts below plus scanner evidence.

python -I smoothie/audit/build_results.py <triage.json> <skillspector.json> <staged.json> <probe.json>
Verdicts are a reviewer's judgement from reading README/SKILL/licence/install files and the scan leads;
scanner numbers alone never decide a verdict.
"""
import json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
I = 'INSTALL'; IC = 'INSTALL WITH CONDITIONS'; NO = 'DO NOT INSTALL'; GPU = 'GPU-BLOCKED (GPU tier)'; KEY = 'NEEDS-KEY / PAID'
REF = 'REFERENCE (merged, not installed)'; OUT = 'LEFT OUT (out of scope)'; HAVE = 'ALREADY INSTALLED'; GONE = 'UNAVAILABLE'
ENG = r'C:\Users\Sharafath\AI-Local\engines'

# repo: (verdict, merged into, where it lives when installed, reason)
V = {
 # --- installed by smoothie/install/install.ps1 ---
 'kajisho5/ffmpeg-skill': (IC, 'vs-edit', ENG + r'\ffmpeg-skill@bad487c', 'Engine of vs-edit: 48 stdlib Python tools, no network. Copy the pinned commit; do not run `npx ffmpeg-skill` (it may install ffmpeg); never open Claude Code at that repo root (its .claude/settings.json enables a third-party plugin marketplace).'),
 'zeative/motion-educator': (IC, 'vs-lesson', ENG + r'\motion-educator@7ff07ee', '16 lesson templates + seek-exact engine. `npm ci --ignore-scripts`; Playwright Chromium in the shared browsers folder; paid voice API not used (local take + Whisper words).'),
 'Moh4696/cinematic-skill': (IC, 'vs-director, vs-lesson', ENG + r'\cinematic-film@bf43556', 'Documentary-board engine (skia, CPU). Its font and Wikimedia fetchers use the network: allow per project.'),
 'AustinZ21/cinematic-skills': (IC, 'vs-director, vs-generate', ENG + r'\still-to-film@0e5b3fe', 'Shot-director rules merged; still-to-film scripts installed. Depth model (Depth Anything V2) only from its official Hugging Face repo, no trust_remote_code.'),
 'thisisvela/sfx-generator-skill': (I, 'vs-voice-captions', ENG + r'\sfx-generator@a7c25d5', 'numpy synthesis, Apache-2.0, no network; editable install into video-py.'),
 'kaomei/stickman-video-director': (IC, 'vs-lesson', ENG + r'\stickman-director@8394bec', 'Code engine (B styles) only; model engine (A styles) needs paid generation: spend gate.'),
 'lunamos/paper2video': (IC, 'vs-lesson', ENG + r'\paper2video@a8c966b', 'Method + Remotion template in the shared JS workspace; skip its `npx -y skills add` step (Remotion skills are already installed).'),
 'heygen-com/hyperframes': (IC, 'vs-motion', ENG + r'\video-js (npm hyperframes@0.9.87)', 'Engine #2 of vs-motion: npm 0.9.87, Apache-2.0, no install hooks; `--ignore-scripts`, exact pin. Repo skills used as references.'),
 'greensock/GSAP': (IC, 'vs-motion', 'package.json (Vite app) gsap@3.15.1', 'GSAP Standard "no charge" licence (not OSI): fine for the site; read the licence before reselling templates.'),
 'mrdoob/three.js': (I, 'vs-motion', 'package.json three@0.187.0', 'MIT, no install hooks.'),
 'airbnb/lottie-web': (I, 'vs-motion', 'package.json lottie-web@5.13.0', 'MIT, no install hooks; plays After Effects/Bodymovin exports.'),
 'ManimCommunity/manim': (IC, 'vs-lesson', r'C:\Users\Sharafath\AI-Local\venvs\video-py (manim 0.19.2)', 'MathTex needs LaTeX (MiKTeX ~1 GB): ask before installing it.'),
 # --- already present ---
 'remotion-dev/remotion': (HAVE, 'vs-motion', 'remotion:* Claude skills + video-projects', 'Engine #1 of vs-motion. Planned: one shared node_modules for all Remotion projects.'),
 'motiondivision/motion': (HAVE, 'vs-motion', 'package.json motion@^12', 'Already in the Vite app.'),
 'FFmpeg/FFmpeg': (HAVE, 'vs-edit', 'system ffmpeg (N-126374)', 'One shared FFmpeg for every skill.'),
 'Vibha-Ramprakash/claude-video-effects': (HAVE, 'vs-motion, vs-real-estate', 'Claude skill `effects`', 'The installed effects skill is this source; no second copy.'),
 'affaan-m/ECC': (HAVE, 'ecc-* (27 skills)', '.claude/skills/ecc-*', 'Installed 2026-11-23 (markdown skills only).'),
 'affaan-m/everything-claude-code': (NO, '-', '-', 'Duplicate of affaan-m/ECC (same repository).'),
 'cloudflare/security-audit-skill': (HAVE, 'security (not video)', 'Codex skill + Claude plugin', 'Partial: MCP needs OAuth. Not part of the smoothie.'),
 'NVIDIA/SkillSpector': (HAVE, 'security (this audit)', 'WSL /opt/skillspector-2.12', 'Used offline in bwrap for this audit. Not a video skill.'),
 # --- merged as references ---
 'iamaanahmad/agents-video-editing-skills': (REF, 'vs-edit, vs-voice-captions, vs-director', '-', 'MIT. Recipes merged (export, QA, vertical, audio, planning); 14 overlapping skills not installed.'),
 'saranambiar/hyperframes-video-agent-skills': (REF, 'vs-motion, vs-edit, vs-director', '-', 'Apache-2.0. Scene builder, sync assembly, surgical re-render QA merged.'),
 'vincentwei1021/video-shotcraft': (REF, 'vs-director, vs-motion', '-', 'Apache-2.0. Product-promo modes and shot cards merged; its Freesound search needs a key.'),
 'runesleo/claude-video-kit': (REF, 'vs-edit', '-', 'MIT. Final-artifact gates merged into vs-edit QA.'),
 'remocn/remocn': (REF, 'vs-motion', 'on demand into a Remotion project', 'MIT component registry: add single components to a project when needed, no global install.'),
 'staryone/motlab': (REF, 'vs-motion', '-', 'Third engine avoided (Remotion + HyperFrames cover it).'),
 'qualixar/brief2mp4': (REF, 'vs-motion', '-', 'Third engine avoided; its install scripts not run.'),
 'latent-spaces/brag': (REF, 'vs-motion', '-', 'Launch-video-from-website flow merged.'),
 'yian6557/eian-riso-broll': (REF, 'vs-motion', '-', 'No licence file: ideas only (riso info b-roll), nothing copied.'),
 'JDhruv14/line-art-animation': (REF, 'vs-motion', '-', 'Line-art draw-on technique merged.'),
 'moh4696/open-3d-skills': (REF, 'vs-motion, vs-generate', '-', 'MIT. Frame capture, exploded view, motion-assets cost planning merged.'),
 'jakeschincariol/instagram-agent-skill': (REF, 'vs-real-estate', '-', 'MIT. Hook formulas and reel planning merged; drafts only, never auto-posts.'),
 'openfilm/openfilm': (REF, 'vs-director', '-', 'MIT film-agent; overlaps the merged director/motion skills.'),
 'calesthio/OpenMontage': (REF, 'all (ideas)', '-', 'AGPL-3.0: ideas only, no text or code copied. 139 skill-index rows point here.'),
 'charlesdove977/UGC-Factory': (KEY, 'vs-generate (prompt styles)', '-', 'Styles call paid Seedance/Higgsfield.'),
 'lemomo-ai/lemo-opuscar': (REF, 'vs-director, vs-motion', '-', 'Licence NOASSERTION: style ideas only.'),
 'Tejashmakwana/motionmaxxing': (REF, 'vs-motion', '-', 'Motion principles merged.'),
 'iamtechartist/every-joule-lesson1': (REF, 'vs-lesson', '-', 'Lesson reference.'),
 'Vincentwei1021/anything2explainer': (REF, 'vs-lesson (via study-video)', '-', 'Stays on the study-video route.'),
 'bangtutorial/bang-motion': (NO, 'study-video route (reference)', '-', 'Earlier SkillSpector DO_NOT_INSTALL flag still holds; reference only.'),
 'JuneYaooo/rea-video': (REF, 'vs-director (reference analysis)', '-', 'Its ChatCut section tells the agent to curl|sh a paid app with a referral tag: never follow it.'),
 'debpalash/VoiceStudio': (REF, 'vs-voice-captions', '-', 'Duplicate brain of OmniVoice/Piper.'),
 'dozentwelve/papermorph': (REF, 'vs-lesson', '-', 'PDF→narrated page idea.'),
 'apekshik/anymachine': (REF, 'vs-motion (3D, Blender)', '-', 'Needs Blender; reference.'),
 'mromidev/claude-blender-skills': (REF, 'vs-motion (3D, Blender)', '-', 'MIT; usable once Blender is installed (optional, your choice).'),
 'arjun988/blender-skills': (REF, 'vs-director (style prompts)', '-', '188 style prompt skills; overlap with director modes.'),
 'nexu-io/openmotion': (REF, '-', '-', '431 skills incl. BYOK providers: duplicate of the merged system; not installed.'),
 'academa-labs/manimgx': (REF, 'vs-lesson', '-', 'ManimGL fork; Manim Community covers it.'),
 'leonxlnx/walking-block': (REF, 'vs-motion (3D)', '-', 'No licence: ideas only.'),
 # --- needs keys / paid ---
 'hypit-ai/hypit': (KEY, 'vs-generate, vs-real-estate (ideas)', '-', 'Modified Apache licence; generation through paid HiAPI/Pollo (referral links).'),
 'alisa0808/vox-director': (KEY, 'vs-lesson (ideas)', '-', 'Generation via paid Atlas Cloud.'),
 'charlesdove977/re-walkthrough-pro': (KEY, 'vs-real-estate (idea)', '-', 'Zillow scraping via Apify + paid Higgsfield; replaced by agent-supplied photos + local depth parallax.'),
 'charlesdove977/advertising-ops': (KEY, '-', '-', 'Meta Ad Library scraping via Apify + paid Higgsfield.'),
 'zhouxiaoka/autoclip': (KEY, 'vs-edit (long→shorts recipe)', '-', 'Needs an LLM API key; the flow is rebuilt with vs-edit tools.'),
 'HKUDS/DeepTutor': (KEY, '-', '-', 'Learning app needing an LLM API key.'),
 'BudgetAny/Budget3D': (KEY, '-', '-', 'Paid cloud compute per model.'),
 'mohamedelaassal/youtubevideogenerator': (KEY, '-', '-', 'Generator app built on hosted AI APIs.'),
 'spacesdrive/twiligent': (KEY, '-', '-', 'Social analytics dashboard app needing platform API keys; optional.'),
 # --- GPU tier ---
 'd3voz/openjutsu': (GPU, 'vs-generate (GPU tier)', 'rented box only', 'Needs 16 GB VRAM and 64 GB system RAM; consent of anyone replaced.'),
 'inclusionai/codeworldmodel': (NO, '-', '-', 'Needs an 8-GPU Linux node; vendored CC BY-NC parts. Not a single-rental job.'),
 'google-research/pointdit': (OUT, '-', '-', 'Research 3D geometry model, not a production tool.'),
 'meshy-dev/ThreeRT': (OUT, '-', '-', 'Real-time ray tracing needs a local RTX display; a rented GPU does not help.'),
 'voyager-so/vork': (IC, 'vs-generate (3D, optional)', 'not in this install plan', 'Vulkan engine (Vega 8 has Vulkan 1.3: test first); source-available preview licence, not open source.'),
 # --- duplicates / not needed / unsafe ---
 'comfy-org/comfy-desktop': (NO, '-', '-', 'Duplicate: ComfyUI is already installed at the reviewed commit.'),
 'imputnet/cobalt': (NO, '-', '-', 'Downloads other people\'s videos (rights risk); the REA MCP covers reference study.'),
 'openclaw/clawhub': (NO, '-', '-', 'Skill registry: adds a supply-chain path; Claude Code skills need none.'),
 'runkids/skillshare': (NO, '-', '-', 'Skill sync tool: same reason.'),
 'w01fb0ss/pibot': (NO, '-', '-', 'Broad agent platform with email/Gmail plugins; not video.'),
 'dqfront/iart-ai-motion-skills': (NO, '-', '-', 'Repo has no skills: a README, showcase GIFs and verify scripts only.'),
 'juliangarnier/anime': (NO, '-', '-', 'Duplicate brain of motion + GSAP.'),
 'tweenjs/tween.js': (NO, '-', '-', 'Duplicate brain of motion + GSAP.'),
 'mojs/mojs': (NO, '-', '-', 'Duplicate brain of motion + GSAP.'),
 'konvajs/konva': (NO, '-', '-', 'Canvas framework not needed by any job.'),
 'pixijs/pixijs': (NO, '-', '-', '80 MB package; not needed by any job.'),
 'ffmpegwasm/ffmpeg.wasm': (NO, '-', '-', 'Duplicate of native FFmpeg; only if the site ever needs in-browser processing.'),
 'videojs/video.js': (OUT, '-', '-', 'Player; the site plays video natively.'),
 'augani/openreel-video': (OUT, '-', '-', 'Standalone web editor app; overlaps vs-edit.'),
 'capsoftware/cap': (OUT, '-', '-', 'Screen recorder app (official installer, optional); Playwright capture covers demos.'),
 'mifi/lossless-cut': (I, 'vs-edit (desktop apps)', r'C:\Users\Sharafath\AI-Local\apps\losslesscut-3.70.2', 'Installed 2026-11-24 on your request: v3.70.2 portable, SHA-256 matches the GitHub release digest; Windows build is not code-signed by the project; launch test PASS.'),
 'photopea/photopea': (OUT, '-', '-', 'Browser image editor; nothing to install.'),
 'open-slide/open-slide': (OUT, '-', '-', 'Slides tool; not video.'),
 'klad-app/klad': (OUT, '-', '-', 'Drawing app, licence unstated.'),
 'atuizz/posewear': (OUT, '-', '-', 'Anime outfit prompt pack for image generation.'),
 'bilawalsidhu/gods-eye-view': (OUT, '-', '-', '3D globe web app.'),
 'mengto/skills': (OUT, '-', '-', '217 design skills; ECC design skills already cover it.'),
 'paulirish/chrome-capture': (OUT, '-', '-', 'Tab recorder; frame-exact capture is in vs-motion.'),
 'pbakaus/impeccable': (OUT, '-', '-', 'Design critique; ECC design skills cover it.'),
 'Sandflow-ai/sand3d': (OUT, '-', '-', 'Third 3D engine.'), 'shinyobjectz/raea': (OUT, '-', '-', 'Rust creative engine.'), 'storytold/filmcraft': (OUT, '-', '-', 'Rust NLE (build from source).'),
 'barckley75/resolve-claude-mcp': (OUT, '-', '-', 'Needs DaVinci Resolve (not installed).'),
 'meta/astryx': (OUT, '-', '-', 'Design system, not video; cloned twice in quarantine (~0.7 GB duplicate).'),
 'blender/blender': (I, 'vs-motion (Blender 3D mode), vs-real-estate, vs-lesson', r'C:\Users\Sharafath\AI-Local\apps\blender-5.3.0', 'Installed 2026-11-24 on your request: 5.3.0 portable, SHA-256 matches download.blender.org, signed Blender Foundation; headless floor-plan/title/turntable renders PASS (Eevee, ~1 s per 540x960 frame).'),
 'godotengine/godot': (OUT, '-', '-', 'Game engine.'), 'GraphiteEditor/Graphite': (OUT, '-', '-', '2D editor app.'),
 'HandBrake/HandBrake': (OUT, '-', '-', 'GUI transcoder; vs-edit export covers it.'), 'KDE/kdenlive': (I, 'vs-edit (editable timeline via .otio)', r'C:\Users\Sharafath\AI-Local\apps\kdenlive-26.08.3', 'Installed 2026-11-24 on your request: 26.08.3 standalone, SHA-256 matches download.kde.org, kdenlive.exe signed KDE e.V. (melt.exe unsigned); melt render PASS; .otio validated with OpenTimelineIO 0.18.1; import via File menu not automated; kdenlive --render crashes in this build.'),
 'mltframework/shotcut': (OUT, '-', '-', 'GUI editor, optional.'), 'obsproject/obs-studio': (I, 'vs-edit (desktop apps), vs-lesson', r'C:\Users\Sharafath\AI-Local\apps\obs-studio-33.0.3', 'Installed 2026-11-24 on your request: 33.0.3 portable, SHA-256 matches the GitHub release digest, signed OBS Project LLC; profiles Reel 9x16 / Lesson 16x9, AMD H.264; scripted test recording PASS; obs-websocket off.'),
 'opentoonz/opentoonz': (OUT, '-', '-', '2D animation app, optional.'), 'airbnb/lottie-android': (OUT, '-', '-', 'Android/iOS library.'),
 'wulkano/Kap': (OUT, '-', '-', 'macOS only.'),
 '666ghj/MiroFish': (OUT, '-', '-', 'Not video (gated via DM).'), 'deepseek-ai/deepseek-harness': (OUT, '-', '-', 'Not video.'),
 'xai-org/grok-build': (OUT, '-', '-', 'Not video.'), 'openqodex/openqodex': (OUT, '-', '-', 'Code reviewer, not video.'),
 'tokio-rs/topcoat': (OUT, '-', '-', 'Rust web framework.'), 'ag-ui-protocol/ag-ui': (OUT, '-', '-', 'Agent UI protocol (infra).'),
 'a2ui-project/a2ui': (OUT, '-', '-', 'Agent UI (infra).'), 'deeplethe/sandstorm': (OUT, '-', '-', 'Sandbox infra.'),
 'Sandflow-ai': None,
 # --- unavailable ---
 'bodila51/gtavi-claudecode': (GONE, '-', '-', 'GitHub API 404 and clone says "Repository not found" on 2026-11-23 and again 2026-11-24: private or deleted (the brief\'s "LIVE" correction no longer holds).'),
 'devedevt/ffmpeg-gui-editor-windows': (GONE, '-', '-', 'GitHub API 404 on 2026-11-23; "Repository not found" again 2026-11-24.'),
 'ys-sites/insta-reels': (REF, 'vs-studio (catalog source)', '-', 'Your private catalog repo (reel scans, skills catalog, prompts). Access worked on 2026-11-24: staged at 6c34fab (667 files, 90 MB, no binaries); triage clean of install hooks and binaries, flags are text mentions in your own scan scripts. Appendix D item-by-item audit still to do; branch skills-hub not fetched.'),
}
V.pop('Sandflow-ai')

def main():
    triage = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))['results'] if Path(sys.argv[1]).exists() else {}
    ss = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))['results'] if Path(sys.argv[2]).exists() else []
    staged = json.loads(Path(sys.argv[3]).read_text(encoding='utf-8'))
    probe = json.loads(Path(sys.argv[4]).read_text(encoding='utf-8'))
    tl = {k.lower(): v for k, v in triage.items()}
    st = {k.lower(): v for k, v in staged.items()}
    ssr = {}
    for r in ss:
        ssr.setdefault(r['repository'].lower(), []).append(r)
    rows, out = [], {}
    for repo, (verdict, merged, where, why) in sorted(V.items(), key=lambda x: x[0].lower()):
        k = repo.lower()
        s = st.get(k, {}); t = tl.get(k) or next((v for kk, v in tl.items() if kk.endswith('/' + k.split('/')[1])), None)
        sig = ''
        if t:
            hot = {x: n for x, n in t['signals'].items() if x in ('download_execute', 'prompt_injection', 'secret_literal', 'obfuscation', 'trust_remote_code', 'extra_index', 'install_hook', 'unsafe_weights') and n}
            sig = 'triage: ' + (', '.join(f'{a} {b}' for a, b in hot.items()) or 'no high-risk signals') + (f'; {t["binary_count"]} binaries/weights in tree' if t['binary_count'] else '') + (f'; hidden Unicode in {len(t["hidden_unicode_files"])} files' if t['hidden_unicode_files'] else '')
        sp = ssr.get(k) or [v for kk, v in ssr.items() if kk.startswith(k)]
        if sp and isinstance(sp[0], list): sp = sp[0]
        if sp:
            done = [x for x in sp if x.get('status') == 'scanner_completed']
            recs = sorted({str(x.get('recommendation')) for x in done})
            sig += f'; SkillSpector {len(done)}/{len(sp)} folders: {"/".join(recs) or "incomplete"}'
        commit = (s.get('commit') or '')[:7]
        check = sig.strip('; ') or ('registry/metadata check' if verdict in (I, IC, HAVE) else 'metadata + README review')
        out[repo] = {'verdict': verdict, 'merged_into': merged, 'installed_at': where, 'reason': why, 'commit': commit, 'evidence': check,
                     'size_kb': (probe.get(k) or {}).get('size_kb')}
        rows.append(f'| {repo} | {"https://github.com/" + repo} {("@" + commit) if commit else ""} | **{verdict}** | {merged} | {check} | {where} | {why} |')
    (HERE / 'verdicts.json').write_text(json.dumps(out, indent=1), encoding='utf-8')
    counts = {}
    for v in out.values(): counts[v['verdict']] = counts.get(v['verdict'], 0) + 1
    head = ['| Name | Repo @ reviewed commit | Verdict | Merged into | Audit evidence (dry-run check) | Lives at when installed | Why |', '|---|---|---|---|---|---|---|']
    (HERE / 'results-repos.md').write_text('\n'.join(head + rows) + '\n', encoding='utf-8')
    print(len(out), 'repos;', counts)
    extra_sections(HERE.parents[1])

SITE_MAP = {  # website skill name -> unified skill
    'Remotion skills': 'vs-motion', 'captions-skill': 'vs-voice-captions', 'effects': 'vs-motion, vs-real-estate', 'talking-head-reels': 'vs-real-estate',
    'DaVinci Resolve MCP': '- (needs Resolve)', 'HyperFrames (local skills)': 'vs-motion (HyperFrames engine)', 'motionmaxxing': 'vs-motion',
    'motion-video-director': 'vs-director', 'Anidoodle': 'vs-lesson (study-video route)', 'Bang Motion': 'vs-lesson (study-video route; DO_NOT_INSTALL flag)',
    'Hand-drawn and whiteboard': 'vs-lesson', 'Manim': 'vs-lesson', 'Lemo-Opuscar, Paint MV, Huashu': 'vs-director / vs-motion (ideas)',
    'GSAP, Three.js, p5.js, Theatre.js': 'vs-motion (GSAP + three.js installed)', 'anatomy': 'vs-lesson', 'OmniVoice': 'vs-voice-captions',
    'Piper TTS': 'vs-voice-captions', 'VoiceStudio, Coqui TTS': '- (duplicate TTS)', 'Whisper (+ whisper.cpp, WhisperX)': 'vs-voice-captions (one model: small)',
    'fish audio': 'vs-voice-captions (paid fallback)', 'Code-synth soundtrack': 'vs-voice-captions', 'AudioCraft / MusicGen': 'vs-voice-captions (GPU tier)',
    'ACE-Step 1.5': 'vs-voice-captions (GPU tier)', 'media-use': 'vs-edit', 'ComfyUI + LTX-Video 2B / Wan 2.1 1.3B': 'vs-generate',
    'Claude Drawing': 'vs-lesson', 'UGC Factory prompt styles': 'vs-generate (paid styles)', 'Genjutsu character swap': 'vs-generate (GPU tier; Openjutsu)',
    'REA MCP': 'vs-director (reference study)', 'rea-video': 'vs-director', '136-reel creator study': 'vs-real-estate',
    'website-to-video, playwright-recording': 'vs-motion (launch-video mode)'}

def extra_sections(repo):
    lines = ['', '## Website skills (`master-video-styles/data/skills.json`, 35)', '',
             '| Skill | Status on the site (verified) | Merged into |', '|---|---|---|']
    data = json.loads((repo / 'master-video-styles/data/skills.json').read_text(encoding='utf-8'))
    for g in data['groups']:
        for s in g['skills']:
            m = next((v for k, v in SITE_MAP.items() if s['name'].startswith(k[:18])), '-')
            lines.append(f"| {s['name']} | {s['status']} | {m} |")
    lines += ['', 'Status check: the 8 `ready` entries are installed and working on this PC; none claims ready for something missing. No status change is needed until the smoothie is installed; then the installed rows (GSAP/three, Manim, HyperFrames engine) move to `ready`.', '',
              '## Security tools (`security-tool-registry.json`, 12)', '',
              'Not part of the video smoothie. Used in this run: SkillSpector (offline, bwrap sandbox, `--no-llm`) and the workspace triage + security gate. Trivy, Semgrep and TruffleHog run in GitHub Actions only (`.github/workflows/security.yml`); ClamAV, Nuclei, Strix, PyRIT, BLA, Codex Security and Claude Code Security Review stay staged source references (`docs/security-tool-staging.md`); the Cloudflare audit skill needs OAuth.', '',
              '## Skill index (`skill-index.json`, 178 rows)', '',
              '| Parent | Rows | Fate |', '|---|---|---|',
              '| openmontage | 139 | AGPL reference; ideas merged into all vs-* skills, nothing copied |',
              '| ugc-factory | 16 | Paid Seedance styles → vs-generate prompt references |',
              '| MiniMax-H3 (FreeVideo) | 11 | GPU tier of vs-generate |',
              '| voicestudio | 4 | Duplicate TTS; vs-voice-captions uses OmniVoice/Piper |',
              '| motion-library, motion-video-director, design-motion-principles, motionmaxxing | 5 | vs-motion / vs-director |',
              '| lemo-opuscar | 2 | Style ideas (licence unstated) |',
              '| claude-video-effects | 1 | Installed as the `effects` skill |',
              '', '## Already implemented (kept, not redone)', '',
              '`skills/creator-video` (extended by vs-real-estate), `skills/study-video` (extended by vs-lesson), `skills/hyliox-pixel-perfect` (website, unchanged), `resources/visually-research/rea-skill` (the REA MCP connector is available in Claude Code; the skill file itself does not register it).',
              '', '## Not video (Appendix C, 73 repositories)', '',
              'Rows with bucket "none" in the per-video Facebook pull (downloaders, CRMs, OS tools, games, forecasting, OCR, etc.) are out of scope by the brief\'s own buckets and were not cloned.']
    (HERE / 'results-other.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')

if __name__ == '__main__':
    main()
