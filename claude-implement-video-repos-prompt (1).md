# PROMPT FOR CLAUDE — Implement the video repos/skills into ys-sites/video

Copy everything in this file and paste it to Claude (Claude Code). It is self-contained: the full inventory, the audit, and the per-video pull are embedded below as data. Do not send Claude the three source files separately — this file IS the brief.

> **MODE FOR THIS RUN — READ FIRST (updated Nov 23, 2026, 23:10 EST): GO ALL IN ON THE SMOOTHIE, BUT DO NOT INSTALL THE SKILLS YET.**
> Take ALL the repos/skills in the data below, mix them into ONE best system (see Section 4.6), and prepare everything — merged skills, Nvidia GPU tier, storage compression, system optimization — but **keep the repo as it is and DO NOT install any skill into the live system in this run**. No installs, no pushes, no deploys. Your deliverable this run is the finished, tested-in-plan, ready-to-install merged system + a storage report. I will say "install now" when I want you to actually install it. That is the gate — do not cross it early.

---

## 1. Who I am and what I want

I'm Mohamed, a Concordia industrial engineering student. I run a video-styles site and repo called **ys-sites/video** (Master Video Styles, live at master-video-styles-theta.vercel.app). Over the past weeks I have pulled / harvested 100+ GitHub repos and Claude Code skills about video — real-estate creator videos, Concordia lesson videos, and cinema / video-generation tools — but almost none of them are actually implemented. I want you, Claude, to implement them for me, properly, one by one.

**Goal:** turn the inventory below into working, installed, verified skills/tools inside `ys-sites/video`, so I can actually use them to make videos — not just have JSON indexes pointing at paths that don't exist.

## 2. My machine and repo — read this first, it decides what can run

- **My PC:** Windows, Ryzen 7 5825U, integrated Radeon Vega 8, **NO Nvidia GPU, NO CUDA**, 15 GB RAM. Anything that needs an Nvidia GPU / CUDA / RTX card **cannot run on my PC**. For those, do NOT install locally — mark them GPU-BLOCKED and note the cloud-rental option (renting an RTX 4060 Ti 16GB is ~$0.06–$0.11/hr on Vast.ai, RTX 4090 ~$0.34/hr on RunPod Community — cents per job, not dollars).
- **Repo:** `https://github.com/ys-sites/video`, local clone is usually at `~/workspace/video-repo`, last verified HEAD `dcf85be` (Nov 20, 2026). **I edit this repo myself. Never push over my newer work, never force-push, never rebase my commits. Work on a branch, show me the diff, and push ONLY when I explicitly say to.**
- **Website:** Master Video Styles site, skills data in `master-video-styles/data/skills.json` (35 skills listed there).
- **Already implemented — only 4, do not redo them:** `skills/creator-video/SKILL.md`, `skills/study-video/SKILL.md`, `skills/hyliox-pixel-perfect/SKILL.md`, `resources/visually-research/rea-skill/SKILL.md` (note: rea-skill does NOT register the REA MCP — that part is still open).

## 3. Hard rules — do not break these

1. **Audit before you install, install only if clean.** Before installing ANY repo/skill, read its README, SKILL.md, license, and install docs, and check it for: malicious / obfuscated code, exfiltration (sending files, keys, or data to unknown servers), credential theft, and install scripts that run arbitrary code. If anything is suspicious, stop on that item, mark it DO NOT INSTALL with the exact reason, and move on. Never install a flagged item to "see if it works".
2. **Cloning is NOT installing.** A Claude Code skill only works when its `SKILL.md` is installed into `~/.claude/skills/` (or via `npx skills add … --global`). A Python/Node tool only works after pip/npm install + venv + ffmpeg + keys. A Vite dependency only works when it is in `package.json`. Installing means the tool actually runs — prove it with a test, don't just copy files.
3. **Verify every install.** After each item, run its own smoke test (its example command, a tiny render, a `--help`, a 5-second test video) and record PASS / FAIL with the exact command and output. An install with no passing test is NOT done.
4. **Do not push, do not publish, do not deploy without my explicit say-so.** Local work only until I confirm. No GitHub push, no Vercel deploy, no npm publish.
5. **No paid API, no paid plan, no API key without my approval.** If an item needs paid credits (Higgsfield, Muapi.ai, Seedance, etc.) or an API key I haven't given you, mark it NEEDS-KEY / PAID and move on. Never invent a key, never use a key from a random file, never paste a token I gave you into a public file. Any token I paste is single-use — use it once, then delete it, never save it in the repo.
6. **Size limit — ask me before downloading anything over 50 GB.** Before you clone, download, or pull any repo, dataset, model, or media pack, check its size first (GitHub API `size` field, release asset sizes, or `git ls-remote` / shallow `--filter=blob:none` probe — do NOT do a full download just to measure it). If the total download is **over 50 GB**, STOP on that item and ask me for permission first — tell me the exact size, what it is, and why you need it. Do not download it internally, do not start a background download, and do not use a cloud GPU / paid storage to get around the limit, until I explicitly say yes. Under 50 GB, proceed normally.
7. **Respect the security gate.** All 62 catalog repos are currently `not_audited` / `not_approved`. Your audit in this task IS the gate: give each item a verdict — INSTALL / INSTALL WITH CONDITIONS / DO NOT INSTALL — and update its status accordingly.
8. **One item at a time, in the order in Section 4.** Finish and verify one before starting the next. If one fails, record why and move to the next — do not get stuck, do not silently skip.
9. **Keep the site working.** Do not break the existing site build. Run the build after any change that touches the site, and revert immediately if it breaks.
10. **Do not re-do my own edits.** If a file was edited by me more recently than the inventory, my version wins — diff against the latest, never overwrite it.

11. **Optimize for storage, and merge similar skills — do not keep five copies of the same brain.** See Section 4.5 for the full rule: implement for MY current system (Section 2), get the most skill out of the least internal storage, and combine skills that share the same underlying model / engine / workflow into one stronger unified skill instead of installing each one separately.

12. **This run: prepare and merge, DO NOT install yet.** Keep `ys-sites/video` as it is. Do not install any skill, do not add any dependency, do not change any live file in this run. Build the merged system as a plan + ready-to-install package (merged SKILL.md files, install scripts, configs) in a separate folder/branch, fully specified and verified on paper + with dry-run tests where possible. Installing happens only when I explicitly say "install now".

## 4. Implementation order — work in this order

**Phase 0 — Quick wins (do these first, they are closest to working):**
1. JS motion libraries — GSAP / anime / tween.js / konva / pixijs / three.js / lottie-web — one `npm install` each into the Vite app, then a tiny demo animation proving each renders.
2. Manim sub-skills `manim-composer` + `manimce-best-practices` — the only SkillSpector SAFE sub-skills; copy the skill + `pip install manim`, render a 5-second test (bucket B, Concordia lessons).
3. ComfyUI + LTX-Video 2B / Wan 1.3B — already on my PC, models sha256-verified; only a first test render is missing. Do the test render.
4. captions-skill + Whisper — cloned on my PC, npm install done, model cached, setup verified on a synthetic clip; run it on a real video, with my approval on the 1.5s / 4s / 8s check frames.
5. OmniVoice — on my PC, one setup command away (`setup-tier1.ps1 -Tool omnivoice`).

**Phase 1 — Core video skills (bucket C, highest value for the site):**
OpenMontage (12 pipelines, 100+ tools — biggest one, do it carefully, Python 3.10+ / FFmpeg / Node 18+), Hypit (hypit-ai/hypit), OpenFilm (openfilm/openfilm), Cinematic Skill (Moh4696/cinematic-skill — NOT AustinZ21/cinematic-skills, they are different repos), OpenReel Video (Augani/openreel-video), Vork (voyager-so/vork — GPU note: headless 3D/VFX, check if it runs without Nvidia or mark GPU-BLOCKED), Motion Educator (zeative/motion-educator — closest to bucket B lesson videos), ffmpeg-skill (kajisho5/ffmpeg-skill), AutoClip (zhouxiaoka/autoclip), Agents Video Editing Skills, iArt AI Motion Skills, Video Shotcraft, Claude Video Kit, Vox Director, paper2video, Motlab, Claude Blender Skills, AnyMachine, Stickman Video Director, Instagram agent skill, OpenMotion, Remocn, brief2mp4, blender-skills, Cap, Cobalt, LosslessCut, Comfy-Desktop, Walking Block.

**Phase 2 — Bucket A (real-estate creator video):**
claude-video-effects (Vibha-Ramprakash/claude-video-effects, 51 effects), gtavi-claudecode (bodila51/gtavi-claudecode — CORRECTION: this is LIVE, MIT, shown rendering in a GithubSignals reel — it was wrongly listed as 404 in v1), Hypit (also A-overlap), Twiligent, Postiz (NO repo stated — do not invent one, only fondpeace.com was given).

**Phase 3 — Deferred / blocked (audit, do not install yet):**
Anything needing an Nvidia GPU (Openjutsu — d3voz/openjutsu, needs CUDA / RTX 4060 Ti-class — GPU-BLOCKED on my PC, cloud-rental only), anything needing paid credits (Open Generative AI / Anil-matcha/Open-Generative-AI — needs paid muapi.ai API; advertising-ops / re-walkthrough-pro — need paid Higgsfield credits), anything DO NOT INSTALL from the audit (handdraw / paint-mv / javascript-animation were flagged DO_NOT_INSTALL — re-verify, do not install if the flag holds).

## 4.5 Optimize for my system, use the least storage, and merge similar skills to level them up

This is a core part of the job, not an afterthought. Do it for every item, and report on it in your results table.

### A. Implement for MY current system
- My system is Section 2: Windows, Ryzen 7 5825U, integrated Radeon Vega 8, **no Nvidia GPU / no CUDA**, 15 GB RAM. That is the target — do not implement as if I had a GPU workstation or a server.
- Prefer the version of each skill that actually runs here: CPU-friendly, browser-based, or cloud-API versions over local-GPU versions. Where a tool has a small / quantized / distilled model that passes the smoke test, use that one — do not download the biggest model by default.
- If a skill only runs on GPU, do NOT install a local GPU copy I cannot use. Mark it GPU-BLOCKED, note the exact cloud-rental cost to run it (Section 2), and move on.
- Keep RAM use in mind: do not run multiple heavy local models at once, and do not set defaults that load a model on startup. Load on demand, unload when done.

### B. Most skill, least internal storage
- **Never download the same thing twice.** Before downloading any model, dataset, dependency, or media pack, check whether an identical (or near-identical) copy already exists on my PC or in the repo — same model under a different name, same FFmpeg binary, same Node package, same font/icon set. Reuse the existing copy (shared cache / symlink / single shared folder). One copy, many skills.
- **Share one copy of each shared dependency:** one FFmpeg, one Python venv per compatible group (not one venv per skill), one copy of each model family (e.g. one Whisper model, one Wan model — not a separate copy per skill that uses it).
- **Download only what the skill actually uses.** No full datasets when only a subset is needed, no extra languages / voices / model sizes that the test never touches, no demo media packs unless the skill needs them to run. Prune unused files after install.
- **Keep large binaries OUT of the repo.** Models, datasets, and video assets go in a shared local store outside `ys-sites/video` (e.g. a single `AI-Local/models/` cache), gitignored, with only a small pointer / config in the repo saying where it lives. Never commit a multi-GB model into git.
- **Clean up after yourself:** delete installers, temp downloads, and failed-attempt leftovers. After each install, record how much storage it added (in MB/GB) — I want a running total, and the total must stay as low as possible.
- **Measure it:** your final report must include total internal storage added, the 5 biggest items, and what you did to shrink each one. If an item costs a lot of storage for very little skill, say so and suggest the lighter alternative.

### C. If many of them have a similar brain, combine them to level up
- "Similar brain" means: same underlying model, same engine, same workflow, or heavily overlapping instructions — e.g. several skills that all drive Remotion, or all wrap FFmpeg, or all do cinematic shot direction, or all do captions, or all do talking-head effects.
- **Do NOT install 5 near-identical skills side by side.** Instead, merge them into ONE unified skill that is stronger than any of them alone:
  1. Group them first — list each group, what they share, and what each one adds that the others lack.
  2. Keep the best of each: the best prompts, the best camera moves / effects / recipes, the best verification steps, the best defaults. Discard duplicates and contradictions (if two say opposite things, pick the one that passes the test and note why).
  3. Write ONE canonical `SKILL.md` for the merged skill, with the merged capabilities, clear variants / modes (e.g. "cinematic documentary mode", "product promo mode", "lesson mode"), and credit each source skill inside it.
  4. Keep the originals as references only (a short note pointing at the source repo) — do not keep full duplicate copies installed.
- Examples of groups to merge (verify against the real data — do not force a merge if they are genuinely different):
  - Cinematic direction: Moh4696/cinematic-skill + AustinZ21/cinematic-skills + Video Shotcraft + Motion Educator + Claude Video Kit → one director skill (shot lists, 22 camera moves, storyboard-first, beat-synced, captions, narration).
  - Video effects / motion: claude-video-effects + iArt AI Motion Skills + Remocn + HyperFrames skills → one motion/effects skill.
  - Editing pipeline: ffmpeg-skill + Agents Video Editing Skills + AutoClip + Cap + LosslessCut → one editing skill built on a single shared FFmpeg.
  - Generation backends: ComfyUI + LTX-Video + Wan + OpenFilm + OpenReel → one generation skill sharing one model cache, not five separate installs.
- **A merge only counts if it is tested.** Run the merged skill's smoke test end-to-end (one real video made with it). If the merge breaks something, unmerge that piece and record why.
- Report every merge: group members, what was kept from each, what was dropped and why, storage saved by merging, and the new unified skill's path.

## 4.6 Go all in — the smoothie: one best system, Nvidia GPU tier, 100 GB max, compress to free space

Think of it like a smoothie: you take ALL of it — every repo, every skill, every style in Appendices A–D — and you mix it into ONE best system. Not 90 separate installs. One system, with the best parts of everything, that runs on my machine.

### A. My disk right now — the budget
- My C: drive, screenshot Nov 23, 2026: **952 GB total, 612 GB used, 339 GB free.**
- **Hard budget: at most +100 GB extra, total, for the whole merged system** — models, caches, dependencies, everything. That is the ceiling, not a target. Aim well under it.
- **After compressing and deduping, free up space.** The merged system must end up using LESS than the sum of its parts: one shared model cache, one shared FFmpeg, one venv per group, no duplicate downloads, no duplicate models under different names. Report free space before and after: I want to see the number go in the right direction, or at least not eat my 339 GB free.
- If the full smoothie cannot fit in 100 GB, do NOT silently exceed it. Tell me exactly what fits in 100 GB, what you left out and why, and what it would cost (in GB) to add the rest — and ask me before going over.

### B. Nvidia GPU — include it, don't block on it
- **Add an Nvidia GPU tier to the system, whatever Nvidia GPU is available.** My PC right now has no Nvidia GPU (Radeon Vega 8 only), so design the system in two tiers:
  - **Local tier (my PC, CPU):** everything that can run on CPU / in the browser / via API — editing, captions, motion graphics, Remotion, FFmpeg, small models.
  - **Nvidia GPU tier (rented cloud GPU):** everything that needs CUDA — Openjutsu, Wan/ComfyUI heavy generation, Vork 3D/VFX, local video models. Use rented GPUs: RTX 4060 Ti 16GB ~$0.06–$0.11/hr on Vast.ai, RTX 4090 ~$0.34/hr on RunPod Community. The merged system must know how to hand a job to the GPU tier, run it, and bring the result back — with the exact rental command, cost per job, and how to shut the GPU down after.
- Do NOT permanently mark GPU skills as blocked and forget them. They are IN the smoothie — in the GPU tier, with a cloud-rental path, ready to run when I rent the GPU.
- If I get a physical Nvidia GPU later, the same GPU tier should work on it with only the device/connection changed — note what would change and what would stay the same.

### C. The smoothie — mix ALL of it into one best system
- Take ALL the skills/repos in Appendices A–D — not just the easy ones — and merge them by what they DO, not by where they came from (see Section 4.5C for the merge method). One unified skill per job: one director skill, one motion/effects skill, one editing skill, one generation skill, one captions/voice skill, one real-estate creator skill, one lesson-video skill.
- Each unified skill takes the best from every source that feeds it: best prompts, best camera moves, best effects, best verification steps, best defaults. Fill gaps with the next-best source. Drop duplicates, resolve contradictions by testing.
- The result is ONE system I can actually use: I give it a brief / footage, it knows which tier (local CPU or rented Nvidia GPU) to use, which unified skill to run, and it produces a finished video — real-estate tour, Concordia lesson, or cinematic short — without me juggling 90 separate tools.
- Keep the repo, don't install yet (Rule 12): build this as a complete, ready-to-install package — merged SKILL.md files, install scripts that respect the 100 GB budget, configs, and a step-by-step install order — in a separate folder/branch. Verify it by dry-run: every install step checked, every merged skill read through, every GPU handoff specified. No live installs in this run.

### D. Compress the data and optimize the system
- **Compress / dedupe before you add anything:** find duplicate models, duplicate downloads, duplicate media, and oversized files already on my system that these skills would duplicate — and plan to remove/compress them (with my approval for anything destructive — never delete my files without asking).
- Prefer small/quantized models that pass the test over full-size ones. Prefer streaming / on-demand loading over keeping everything resident. Prefer shared caches over per-skill copies.
- Optimize the system, not just the skills: one shared model cache, one FFmpeg, shared Node/Python deps, no background services running when idle, clear temp/cache cleanup steps.
- Report it with numbers: disk before / after, total added (must be ≤ 100 GB), storage saved by merging + compression, and the 5 biggest items left.

## 5. What to deliver back to me

1. The finished smoothie, ready to install (but NOT installed): the merged unified skills (one SKILL.md per job, Section 4.6C), the Nvidia GPU tier plan + rental commands + per-job costs, the install scripts in order, and a results table, one row per source item, with: Name | Repo | Verdict (INSTALL / INSTALL WITH CONDITIONS / DO NOT INSTALL / GPU-BLOCKED / NEEDS-KEY) | Merged into which unified skill (or left out, and why) | Dry-run check PASS/FAIL + command | Where it will live when installed (exact file path). Nothing installed in this run — Rule 12.
2. A storage + merge report: total internal storage added (MB/GB), the 5 biggest items and how you shrunk them, every group of similar skills you merged (members, what was kept from each, what was dropped and why, storage saved), and the path of each new unified skill. The goal is most skill, least storage — prove it with numbers.
3. The repo updated locally (branch, unpushed) with every successful install wired in — skill in the right `skills/` path, dependency in `package.json` where it belongs, and `master-video-styles/data/skills.json` + the catalog status fields updated to match reality (no more "ready" for something that isn't installed).
4. A short list of what still needs ME: keys to provide, cloud-GPU jobs to approve, paid plans to approve, and anything you could not verify.
5. Nothing pushed, nothing deployed, until I say so.

## 6. How to read the data below

- **Appendix A** is the Antigravity audit file (v3, Nov 23, 2026) — the full inventory: 62 catalog repos, 35 website skills, 178 indexed skill rows, 12 security tools, 16 clones, plus v3's 34 new video repos from the per-video Facebook pull. Statuses use ADDED / NOT ADDED / STAGED ONLY / PARTIAL. Only 4 skills are ADDED.
- **Appendix B** is the why-not-implemented audit — for every item, WHY it isn't implemented yet (gitignored by design: 53, needs Python/Node install: 32, needs Claude Code skill install: 16, security gate not passed: 13, needs API key/paid: 11, needs GPU: 9, needs manual setup: 8, dead/gated: 2, duplicate: 2, other platform: 2). Use this to know each item's blocker before you start it.
- **Appendix D** is the insta-reels skill library (ys-sites/insta-reels) — see the access note there; its full skill files could NOT be pulled yet because the repo is private and the Muse GitHub App is not installed on it. Follow the access step in Appendix D first, then implement its skills the same way as the rest.
- **Appendix C** is the per-video Facebook pull (153 rows) — every video opened individually, with the exact GitHub URL as stated, or NO REPO STATED where none was given. Never invent a URL that isn't in this data. Note the corrections in it: gtavi-claudecode is LIVE, and there are two distinct cinematic repos and two distinct HyperFrames repos.

Start with Phase 0. Work in order. Verify each install. Report back with the results table.

---

---

# APPENDIX A — Full inventory: Antigravity audit file (v3, Nov 23, 2026)

# Facebook Video Repos — For Antigravity Audit

**Version:** v3 — Nov 23, 2026 (v1 + v2 kept below, unchanged)
**Repos in this file:** v3 adds 34 new video-benefiting repos from the per-video Facebook pull (Nov 23) — 33 NOT ADDED, 1 STAGED ONLY — on top of v2's full Muse-app + website inventory (62 catalog repos, 57 video-benefiting; 35 website skills; 178 indexed skill rows / 126 distinct names; 12 security tools; 16 clones elsewhere) and v1's 15 Facebook repos + 5 lower-confidence. ADDED in ys-sites/video: 4 skills only.
**Status:** All 5 Facebook accounts now scanned per-video (Nadeem Khan, GithubSignals, Repo Radar AI, FondPeace Crazy, Hypit re-confirmed) — see v3 below. Remaining gaps: GithubSignals 10 of 28 entries unopened, Nadeem 2 entries uncaptured, older videos not reached — see `facebook-per-video-repo-pull.md`.

**Instruction to Antigravity:** Audit every repo listed below. Do NOT install anything. Do NOT push anything. Produce a verdict per repo: **INSTALL / INSTALL WITH CONDITIONS / DO NOT INSTALL**, with reasons.

---

# v3 — Per-video Facebook pull: 34 NEW video repos (Nov 23, 2026)

**What this is:** the signed-in Facebook browser scan finished (browser-task b48484b8, Nov 23, 00:44–00:54 EST). Every video on all 5 accounts was opened individually and its repo pulled. Full per-video list (152 rows): `facebook-per-video-repo-pull.md`. v1 and v2 below are unchanged.

**v3 summary:** 34 new video-benefiting (bucket A/B/C) repos added here — 33 NOT ADDED in ys-sites/video, 1 STAGED ONLY (lemo-opuscar). 6 video repos from the pull were already in v1/v2 and are NOT duplicated here (list below). No (A) real-estate video and no (B) Concordia lesson video was found; closest to (B) is Motion Educator (zeative/motion-educator). Non-video repos (95 "none" rows) and infra (3 rows) from the pull are NOT added — this file stays video-benefiting only.

## v3 correction — gtavi-claudecode is LIVE, not dead

- v1 §12 and the v1 summary table said bodila51/gtavi-claudecode was HTTP 404 as of Nov 23, 2026, based on the reel's comment "Repository is Dead". **Superseded:** the per-video pull opened the GithubSignals reel (reel 2559828137849774, 3 days ago ≈ Nov 20, 2026) and the video shows https://github.com/bodila51/gtavi-claudecode rendering as a live GitHub page, MIT. The v1 text below is left unchanged as a record; Antigravity should re-audit it as a live repo, not a dead one.
- Same repo, second sighting: FondPeace's GTA 6 Clipping Business video names the gtavi-claudecode plugin but states NO GitHub URL in its caption (only fondpeace.com) — do not treat that as a separate repo.
- Two look-alike pairs to keep distinct: Moh4696/cinematic-skill vs AustinZ21/cinematic-skills; heygen-com/hyperframes (AI video engine) vs saranambiar/hyperframes-video-agent-skills (agent skill). Neither is OpenMontage's internal "HyperFrames" GSAP motion system already in the ys-sites/video skill index.

## v3 new repos (34)

| # | Repo | Source (account, date, reel) | What it does | Bucket | Status in ys-sites/video |
|---|---|---|---|---|---|
| 1 | https://github.com/alisa0808/vox-director | Nadeem Khan, Nov 19, 4 days ago, reel 1116235964745717, https://www.facebook.com/reel/1116235964745717 | MIT, Vox-style paper-collage explainer video, Atlas Cloud + FFmpeg, 6-stage pipeline, 14 narrative arcs | C | NOT ADDED |
| 2 | https://github.com/apekshik/anymachine | GithubSignals, 2 days ago, reel 1169424822099223, https://www.facebook.com/reel/1169424822099223 | MIT, machines that work, built in Blender by an agent, 30m walker, 160 parts, hydraulics, one Python script; family AnyScene/AnyKit/AnyMachine/AnyShot | C | NOT ADDED |
| 3 | https://github.com/arjun988/blender-skills | Nadeem Khan, Nov 16, a week ago, reel 1868503394337275, https://www.facebook.com/reel/1868503394337275 | Blender shortcuts / node setups | C | NOT ADDED |
| 4 | https://github.com/atuizz/posewear | Repo Radar AI, A day ago, reel 30337875215802515, https://www.facebook.com/reel/30337875215802515 | 1,320 anime outfits with English/Chinese AI prompts | C | NOT ADDED |
| 5 | https://github.com/augani/openreel-video | Nadeem Khan, Nov 22, 12:44 PM, — (no reel ID; timeline post) | 100% client-side video editor, WebGPU/WebCodecs, multi-track, keyframes, audio, colour grading, 4K | C | NOT ADDED |
| 6 | https://github.com/austinz21/cinematic-skills | Nadeem Khan, Nov 19, 4 days ago, reel 1694893911975093, https://www.facebook.com/reel/1694893911975093 | MIT, SKILL.md pack, shot-director, 22 camera moves, still-to-film depth parallax | C | NOT ADDED |
| 7 | https://github.com/capsoftware/cap | Nadeem Khan, Nov 22, a day ago, reel 1461372758658583, https://www.facebook.com/reel/1461372758658583 | open-source screen recording / async video platform, Rust/Next.js, Studio Mode, AI captions | C | NOT ADDED |
| 8 | https://github.com/comfy-org/comfy-desktop | GithubSignals, A day ago, reel 2224417138429531, https://www.facebook.com/reel/2224417138429531 | v1.1.10, 739 stars in video, official desktop app for ComfyUI, generative AI engine | C | NOT ADDED |
| 9 | https://github.com/devedevt/ffmpeg-gui-editor-windows | Nadeem Khan, Nov 16, a week ago, reel 1841932937254453, https://www.facebook.com/reel/1841932937254453 | FFmpeg GUI video editor | C | NOT ADDED |
| 10 | https://github.com/dqfront/iart-ai-motion-skills | Nadeem Khan, Nov 22, a day ago, reel 1688903589581573, https://www.facebook.com/reel/1688903589581573 | 56 skills, 19 packs, kinetic typography/charts/3D web, frame-accurate easing | C | NOT ADDED |
| 11 | https://github.com/google-research/pointdit | Nadeem Khan, Nov 16, a week ago, reel 1149375831358806, https://www.facebook.com/reel/1149375831358806 | Google 3D geometry | C | NOT ADDED |
| 12 | https://github.com/heygen-com/hyperframes | Nadeem Khan, Nov 16, a week ago, reel 1534179238732198, https://www.facebook.com/reel/1534179238732198 | build professional videos entirely in HTML/CSS | C | NOT ADDED — name collision: "HyperFrames" in skill-index.json / site skills.json is OpenMontage's internal GSAP motion system, a different thing |
| 13 | https://github.com/iamaanahmad/agents-video-editing-skills | Nadeem Khan, Nov 22, a day ago, reel 1028289063637775, https://www.facebook.com/reel/1028289063637775 | video-editing skills for coding agents, trim/format/caption/verify, 9:16, -14 LUFS | C | NOT ADDED |
| 14 | https://github.com/imputnet/cobalt | Nadeem Khan, Nov 21, 2 days ago, reel 1860705704967725, https://www.facebook.com/reel/1860705704967725 | download videos, privacy-friendly | C | NOT ADDED |
| 15 | https://github.com/inclusionai/codeworldmodel | Nadeem Khan, Nov 19, 4 days ago, reel 2145795782998256, https://www.facebook.com/reel/2145795782998256 | world simulation + rendering, 30-min streaming, MiniMax-H3 | C | NOT ADDED |
| 16 | https://github.com/jakeschincariol/instagram-agent-skill | Nadeem Khan, Nov 16, a week ago, reel 2053533545364486, https://www.facebook.com/reel/2053533545364486 | Claude, 13 skills, plan reels, 26 viral hook formulas | A/C | NOT ADDED |
| 17 | https://github.com/kajisho5/ffmpeg-skill | FondPeace Crazy, 6 days ago, reel 1454640259452097, https://www.facebook.com/reel/1454640259452097 | 6,745 stars, 601 forks as stated, give AI coding agents local video editing powers | C | NOT ADDED |
| 18 | https://github.com/kaomei/stickman-video-director | Nadeem Khan, Nov 19, 4 days ago, reel 1410519767523000, https://www.facebook.com/reel/1410519767523000 | faceless animated videos via AI coding agents | C/A | NOT ADDED |
| 19 | https://github.com/lemomo-ai/lemo-opuscar | Nadeem Khan, Nov 19, 4 days ago, reel 1645556130311826, https://www.facebook.com/reel/1645556130311826 | 99 film styles, Canvas/WebGL, FFmpeg 1080p, commercial use | C | STAGED ONLY — full clone at ~/workspace/claude-9-repos/lemo-opuscar; catalogued in skill-index.json + local-snapshots.json, but its paths do NOT exist in the ys-sites/video clone — not wired in |
| 20 | https://github.com/leonxlnx/walking-block | GithubSignals, A day ago, reel 2026172691385792, https://www.facebook.com/reel/2026172691385792 | three.js film, Soviet apartment block on eight mechanical legs, procedural geometry/textures/shaders, no 3D assets, 45s film | C | NOT ADDED |
| 21 | https://github.com/lunamos/paper2video | Nadeem Khan, Nov 19, 4 days ago, reel 1275228981478116, https://www.facebook.com/reel/1275228981478116 | arXiv paper to 3Blue1Brown-style explainer, Remotion, 16:9+9:16, EN+Chinese | C | NOT ADDED |
| 22 | https://github.com/mifi/lossless-cut | Nadeem Khan, Nov 16, a week ago, reel 1835244260839572, https://www.facebook.com/reel/1835244260839572 | cut videos without re-rendering | C | NOT ADDED |
| 23 | https://github.com/mromidev/claude-blender-skills | GithubSignals, 3 days ago, reel 1001654152419325, https://www.facebook.com/reel/1001654152419325 | MIT, free Claude skills for realistic Blender animations, three full workflows | C | NOT ADDED |
| 24 | https://github.com/photopea/photopea | Nadeem Khan, Nov 16, a week ago, reel 1522750596351523, https://www.facebook.com/reel/1522750596351523 | browser image editor | C | NOT ADDED |
| 25 | https://github.com/qualixar/brief2mp4 | Nadeem Khan, Nov 16, a week ago, reel 1275793971415809, https://www.facebook.com/reel/1275793971415809 | AI generates real motion graphics from a written brief to MP4, Claude Code/Codex | C | NOT ADDED |
| 26 | https://github.com/remocn/remocn | Nadeem Khan, Nov 16, a week ago, reel 1491683576354841, https://www.facebook.com/reel/1491683576354841 | 900+ Remotion components, professional product videos in code | C | NOT ADDED |
| 27 | https://github.com/runesleo/claude-video-kit | Nadeem Khan, Nov 22, a day ago, reel 1134736455996366, https://www.facebook.com/reel/1134736455996366 | vertical explainer videos from research briefs, Remotion, faster-whisper captions, script-hash release gate | C | NOT ADDED |
| 28 | https://github.com/saranambiar/hyperframes-video-agent-skills | Nadeem Khan, Nov 22, a day ago, reel 1074076165687736, https://www.facebook.com/reel/1074076165687736 | HyperFrames+FFmpeg+GSAP, backward scene construction, visual-to-narration sync, audio ducking | C | NOT ADDED |
| 29 | https://github.com/spacesdrive/twiligent | Nadeem Khan, Nov 16, a week ago, reel 968911059324709, https://www.facebook.com/reel/968911059324709 | social media dashboard, YouTube/Instagram | A | NOT ADDED |
| 30 | https://github.com/staryone/motlab | GithubSignals, 2 days ago, reel 1731068955250804, https://www.facebook.com/reel/1731068955250804 | MIT, Node.js 24+, video engine where every scene is code, agent skill writes scenes, renders to MP4 in headless Chrome, no AI image/video model | C | NOT ADDED |
| 31 | https://github.com/vincentwei1021/video-shotcraft | Nadeem Khan, Nov 22, a day ago, reel 1706144397709817, https://www.facebook.com/reel/1706144397709817 | product promos, live site capture, Remotion, beat-synced, CapCut/JianYing export, 150 motion recipes | C | NOT ADDED |
| 32 | https://github.com/voyager-so/vork | Nadeem Khan, Nov 17, 6 days ago, reel 1116526131271283, https://www.facebook.com/reel/1116526131271283 | 1.6K stars, 134 forks, headless 3D/VFX engine for agents, Rust/S-lang, 1M simulated birds up to 11x faster than Blender EEVEE | C | NOT ADDED |
| 33 | https://github.com/zeative/motion-educator | GithubSignals, 3 days ago, reel 2574221139735735, https://www.facebook.com/reel/2574221139735735 | MIT, agent skill + film engine, educational films that look expensive, storyboard first, renders 1080p60, 3D replicas, diagrams, captions, narration,… | C | NOT ADDED |
| 34 | https://github.com/zhouxiaoka/autoclip | Nadeem Khan, Nov 21, 2 days ago, reel 1689611025841805, https://www.facebook.com/reel/1689611025841805 | local podcast to vertical clips, 10 top clips, animated captions | C | NOT ADDED |

## Already in v1/v2 — not duplicated (6)

- bodila51/gtavi-claudecode — see correction above: now verified LIVE, MIT (v1 said DEAD 404).
- hypit-ai/hypit — v1 §5, re-confirmed in the pull (GithubSignals reel 4579253032395557).
- Moh4696/cinematic-skill — v1; in the pull twice (Nadeem Nov 16 reel 4350302691880930 and a Nov 21 duplicate post).
- nexu-io/openmotion — v1; in the pull twice (Nadeem Nov 16, Repo Radar AI 4 days ago).
- openfilm/openfilm — v1; in the pull once (Nadeem Nov 16 reel 1616702316174914).
- Vibha-Ramprakash/claude-video-effects — v1; in the pull twice as "talking-head / claude-video-effects" (Nadeem Nov 21 and Nov 16 repeat).

## Instagram source note (not a new repo)

- **Open Generative AI — Anil-matcha/Open-Generative-AI:** source is an Instagram reel by @ai_afterhoursss, Nov 22, 2026 — https://www.instagram.com/reel/DgDzdZly1f6/ (link shared via DM only). Already in v2 §V2.6 as STAGED ONLY (front end for paid muapi.ai API). Not duplicated as a new repo here.

---

# v2 — ALL video-benefiting repos/skills: Muse app + website (Nov 23, 2026)

**This is the expansion Mohamed asked for: "add all the 100s of the repo from this Muse app and say if these were added or not — the ones benefiting anything related to video" — plus "or website". v1 below (15 Facebook repos) is kept unchanged.**

**Sources read directly, Nov 23, 2026 — no guessing:**
- `~/workspace/video-repo/resources/repo-catalog/repositories.json` — 62 repos, **all** `audit_status: not_audited`, `execution_status: not_approved`
- `~/workspace/video-repo/resources/repo-catalog/skill-index.json` — 178 skill rows, 126 distinct names, **all** `status: unreviewed_reference`, **0 of 178 paths exist on this disk**
- `~/workspace/video-repo/resources/repo-catalog/local-snapshots.json` — 28 claimed local copies, **0 of 28 paths exist in this clone** (all under gitignored `resources/concordia/`)
- `~/workspace/video-repo/resources/repo-catalog/security-tool-registry.json` — 12 security tools, all `not_audited`, 11 `blocked`
- `~/workspace/video-repo/master-video-styles/data/skills.json` — the **website** inventory, 35 skills: ready 8, setup 2, reference 20, paid 5 (note in file: "ready = installed or verified locally; reference = source copy in the repo, not installed or security-reviewed yet")
- `~/workspace/video-repo/skills/` + `resources/visually-research/rea-skill/` — the only tracked `SKILL.md` files on disk
- `~/workspace/video-repo/docs/MASTER-ROUTER.md` §1–§4, `docs/ai-editor-research.md`, `resources/repo-catalog/AUDIT-STATUS.md`
- `~/workspace/claude-9-repos/` (9 clones) + `~/workspace/agency-repos/` (7 clones)

**Status definitions — used ONLY as below, with evidence:**
- **ADDED** — actually implemented in ys-sites/video: a tracked `SKILL.md` in `skills/` or `rea-skill/`, or wired into the site/router, file path given as proof.
- **NOT ADDED** — catalogued / indexed / listed as reference only: in `repositories.json` / `skill-index.json` / `skills.json` as reference, no `SKILL.md` in `skills/`, source gitignored or absent on this disk.
- **STAGED ONLY** — a local copy was claimed/staged (in `local-snapshots.json`, `resources/concordia/…`, `graph-corpus/resources/motion-systems/` or `graph-corpus/resources/repo-quarantine/`) but not wired in, and the path does not exist in this clone (or exists only as a quarantine copy, reviewed-not-approved).
- **PARTIAL** — installed/scanned once on Mohamed's Windows PC or in WSL, or a Claude skill ready on his PC, but NOT tracked in ys-sites/video — e.g. NVIDIA SkillSpector, Cloudflare security-audit skill, Remotion / effects / captions-skill. Explain what is actually there.

**Headline counts (exact per source — do NOT add them naively, they overlap):**
- Catalog: **62 repos, 57 video-benefiting, 5 excluded** (see §V2.3). Of the 57: **ADDED 0, STAGED ONLY 10, PARTIAL 2, NOT ADDED 45.**
- Website `skills.json`: **35 skills, all video-benefiting. ADDED 1, PARTIAL 9, NOT ADDED 25.**
- Skill index: **178 rows / 126 distinct skill names, all STAGED ONLY, 0 exist on this disk.**
- Facebook v1: **15 repos, 12 of them new vs the catalog** (Cinematic Skill, motionmaxxing and OpenMontage were already in the 62).
- Clones elsewhere: **16 full clones, 1 video-related (lemo-opuscar, STAGED ONLY), 1 tangential (SlopMonster).**
- Security tools: **12, PARTIAL 2, STAGED ONLY 10.**
- Deduplicated, counting each distinct tool/repo/skill once: **about 90–95 distinct video tools** (62 catalog + 12 Facebook-only + ~20 website/quarantine-only items). Antigravity should deduplicate by repo URL — the per-table counts above are the exact, auditable numbers.

**Excluded as not video-benefiting (one line):** `openqodex/openqodex` (local AI code reviewer), `tokio-rs/topcoat` (Rust web framework), `deepseek-ai/deepseek-harness` (gated, no description in catalog), `xai-org/grok-build` (gated setup, no description), `666ghj/MiroFish` (gated, no description). Agency clones excluded: firecrawl, google-maps-scraper (gosom), huginn, listmonk, check-if-email-exists, remote-jobs, twenty, agent-desktop, agent-skills, freellmapi, heretic, Claude-Code-Game-Studios, everything-claude-code (WorldFlowAI clone — general setup, see §V2.5).

---

## V2.1 — ADDED: the only skills actually implemented in ys-sites/video (4)

| Skill | Proof (tracked file) | Bucket | What it does |
|---|---|---|---|
| creator-video | `skills/creator-video/SKILL.md` + 7 rulebooks + `references/real-estate-creator-study.md` (136-reel study) | A | Creator reels, vlog, talking-head, Kelsey/Torsten style; real-estate creator study |
| study-video | `skills/study-video/SKILL.md` | B | Concordia / educational lesson videos, explainer, study-video route |
| hyliox-pixel-perfect | `skills/hyliox-pixel-perfect/SKILL.md` (also duplicated at repo root `hyliox-pixel-perfect/`) | C / website | Pixel-perfect UI from a design — site design, not video generation |
| rea-skill (reverse-engineer-anything) | `resources/visually-research/rea-skill/SKILL.md` | C / Infra | Reverse-engineer any website/app/video. NOTE: its own SKILL.md says installing it "does not register the REA MCP server, install analysis engines, or add tools" |

**That is it. 4 ADDED in the repo. Everything else below is NOT ADDED, STAGED ONLY or PARTIAL.**

---

## V2.2 — Website: all 35 skills from `master-video-styles/data/skills.json` (Master Video Styles site)

Website status wording is the site's own: ready = installed/verified locally (on Mohamed's PC), setup = present, one step left, reference = source copy, not installed or security-reviewed, paid = needs paid API/credits. Mapped to v2 statuses below.

### Cut, captions and talking-head edits
| Website skill | Where | Site status | v2 status | Bucket |
|---|---|---|---|---|
| Remotion skills | Claude skills `remotion:*` | ready | **PARTIAL** — ready as a Claude skill on his PC, not tracked in the repo; `package.json` has no remotion dependency | B + C — editable React video projects: trims, layers, transitions, render to MP4 |
| captions-skill | `captions-skill/` | ready | **PARTIAL** — ready on PC, 7 animated caption styles from Whisper word timings; repo `docs/caption-skill-setup.md` exists, skill dir itself is gitignored/absent in this clone | A + B — captions |
| effects | Claude skill `effects` | ready | **PARTIAL** — ready on PC, 45 face-tracked effects (same 45 as `Vibha-Ramprakash/claude-video-effects` in the catalog) | A — talking-head effects |
| talking-head-reels | `talking-head-reels/` | reference | **NOT ADDED** — still a zip in the repo (`talking-head-reels.zip`, never extracted); macOS Swift scripts, Windows compatibility unverified | A |
| DaVinci Resolve MCP | `resources/concordia/video-motion/davinci-resolve-mcp` | reference | **STAGED ONLY** — claimed snapshot, path absent in this clone; also catalog `hiteshk03/davinci-resolve-mcp` and `barckley75/resolve-claude-mcp` | C — drive DaVinci Resolve timelines from Claude (52 tools) |

### Motion graphics and animation
| Website skill | Where | Site status | v2 status | Bucket |
|---|---|---|---|---|
| HyperFrames (local skills) | `resources/concordia/video-motion/openmontage` | reference | **STAGED ONLY** — inside the OpenMontage snapshot, absent here | C — HTML+GSAP compositions rendered to video locally |
| motionmaxxing | `resources/concordia/video-motion/motionmaxxing` | reference | **STAGED ONLY** — claimed snapshot, absent here; also Facebook #6 and catalog | A + C |
| motion-video-director | `resources/concordia/motion-video-director` | reference | **NOT ADDED** — 1 skill in the index, path under gitignored `resources/concordia/` | C — motion graphics, product videos, captions, SFX with a coding agent |
| Anidoodle | `resources/motion-systems/anidoodle` | reference | **STAGED ONLY** — in `graph-corpus/resources/motion-systems/anidoodle`, reference skill, not installed | B + C — code-drawn stills, films, 3D motion in 32 styles |
| Bang Motion | `resources/motion-systems/bang-motion` | reference | **STAGED ONLY** — in graph-corpus, Phase 1 recon only (`security-audits/bang-motion/run-20261119/`); also catalog `bangtutorial/bang-motion` | C — cinematic browser motion: openers, bumpers, kinetic type |
| Hand-drawn and whiteboard | `resources/motion-systems/handdraw-skill, hand-drawn-explainer` | reference | **STAGED ONLY — scanner flagged DO_NOT_INSTALL, score 100, 202 issues** (SkillSpector, mostly SC9 noise on `.git/*` + images per AUDIT-STATUS.md; not a verdict, needs source review) | B — stroke-by-stroke explainers |
| Manim | `resources/motion-systems/manim-skill` | reference | **STAGED ONLY** — scanner: SAFE, 0 issues (real scan, 1 of 10 completed) | B — math/diagram animation |
| Lemo-Opuscar, Paint MV, Huashu | `resources/concordia/video-motion/lemo-opuscar`, `resources/motion-systems` | reference | **STAGED ONLY** — full clone also at `~/workspace/claude-9-repos/lemo-opuscar` (358 MB, 99 film styles in code); implementation prompt only at `~/workspace/your_files/lemo-opuscar-video-prompt.md`, never installed | C — painterly code films: oil, watercolor, paper |
| GSAP, Three.js, p5.js, Theatre.js | `resources/concordia/video-motion/openmontage, p5.js, theatre` | reference | **STAGED ONLY** — snapshots claimed, all absent here; also catalog `greensock/GSAP`, `mrdoob/three.js`, `processing/p5.js`, `theatre-js/theatre` | C — timelines, 3D scenes, procedural characters |
| anatomy | Claude skill `anatomy` | ready | **PARTIAL** — ready on PC, not in repo | B — isometric explainer figures of how a system works |

### Voice, TTS and transcription
| Website skill | Where | Site status | v2 status | Bucket |
|---|---|---|---|---|
| OmniVoice | `C:\Users\Sharafath\AI-Local\OmniVoice` | setup | **PARTIAL** — setup script ready on PC (`setup-tier1.ps1`), not run; local TTS/voice cloning on CPU, consenting voices only | B + C — voiceover |
| Piper TTS | `resources/concordia/video-motion/piper` | reference | **STAGED ONLY** — snapshot claimed, absent here | B + C — fast light local narration, runs on CPU |
| VoiceStudio, Coqui TTS | `resources/concordia/video-motion/voicestudio, coqui-tts` | reference | **STAGED ONLY** — snapshots claimed, absent here; also catalog `debpalash/VoiceStudio`, `coqui-ai/TTS` | B + C — local voices, dubbing, narration |
| Whisper (+ whisper.cpp, WhisperX) | captions-skill venv; whisper.cpp/WhisperX in `resources/concordia/video-motion` | ready | **PARTIAL** — ready on PC per site; snapshots claimed, absent in this clone | A + B — word-timed transcripts for cuts/captions |
| fish audio | MCP connector | paid | **NOT ADDED** — paid cloud TTS/cloning/SFX on credits; free alt OmniVoice/Piper | B + C |
| ElevenLabs, Azure, Doubao, DashScope skills | `resources/concordia/video-motion/openmontage` | paid | **NOT ADDED** — paid cloud voice APIs, inside OpenMontage index | B + C |

### Music and SFX
| Website skill | Where | Site status | v2 status | Bucket |
|---|---|---|---|---|
| Code-synth soundtrack | `resources/motion-systems/javascript-animation-skills` + `video-projects/creator-style-explainer/scripts/make_music.py` | ready | **PARTIAL** — ready on PC per site; note `javascript-animation-skills` was scanner-flagged DO_NOT_INSTALL (see Hand-drawn above) | C — original music beds, whooshes, pops synthesised in code, no licence needed |
| AudioCraft / MusicGen | `resources/concordia/video-motion/audiocraft` | reference | **STAGED ONLY** — snapshot claimed, absent here; also catalog via snapshot `facebookresearch/audiocraft` | C — open-source AI music, small model can run on CPU (slowly) |
| ACE-Step 1.5 | `resources/concordia/video-motion/openmontage (acestep)` | reference | **STAGED ONLY** — inside OpenMontage index, absent here; heavy for this PC | C — open-source AI music and stems |
| media-use | `resources/concordia/video-motion/openmontage (media-use)` | reference | **STAGED ONLY** — inside OpenMontage index | C — resolves BGM/SFX into frozen local files with a licence ledger |
| ElevenLabs music and SFX, Lyria | `resources/concordia/video-motion/openmontage` | paid | **NOT ADDED** — paid cloud music/SFX | C |

### AI footage, images and B-roll
| Website skill | Where | Site status | v2 status | Bucket |
|---|---|---|---|---|
| ComfyUI + LTX-Video 2B / Wan 2.1 1.3B | `C:\Users\Sharafath\AI-Local\ComfyUI` | setup | **PARTIAL** — installed by user Nov 19 on PC, first render untested; LTX 2B + Wan 1.3B downloaded, sha256-verified; short low-res clips, 15–60 min each on this PC | C — local text/image→video |
| Claude Drawing | `resources/motion-systems/claude-drawing-skill` | reference | **STAGED ONLY** — in graph-corpus motion-systems | C — illustrations drawn in code, no image model |
| UGC Factory prompt styles | `resources/concordia/video-motion/ugc-factory` | reference | **STAGED ONLY** — snapshot claimed, absent here; also catalog `charlesdove977/UGC-Factory` (15 prompt styles incl. real estate, product 360, social hook) | A — usable with local models |
| Seedance, Kling, MiniMax H3, Grok, FLUX, Atlas Cloud | `resources/concordia/video-motion/openmontage, MiniMax-H3` | paid | **NOT ADDED** — paid cloud video/image models; free alt ComfyUI LTX/Wan | C |
| Genjutsu character swap | `resources/repo-quarantine/sirioberati` | paid | **STAGED ONLY** — staged/triaged, **not approved** per MASTER-ROUTER §1; needs Enhancor + Replicate keys, WSL2, consent from anyone replaced | A + C — Higgsfield-style "same scene, new character" via Enhancor Seedance |

### Analysis / reference-video tools
| Website skill | Where | Site status | v2 status | Bucket |
|---|---|---|---|---|
| REA MCP | MCP connector | ready | **PARTIAL** — ready as an MCP connector on PC, not tracked in repo (rea-skill SKILL.md itself is ADDED, the MCP is not) | C / Infra — dissects websites/apps: structure, screenshots, interactions |
| rea-video | `resources/repo-quarantine/JuneYaooo/rea-video` | reference | **STAGED ONLY** — quarantine copy in graph-corpus; also catalog `JuneYaooo/rea-video` | C — shot-by-shot breakdown of a reference video + remake plan |
| 136-reel creator study | `skills/creator-video/references/real-estate-creator-study.md` | ready | **ADDED** — tracked in the repo, part of creator-video (§V2.1) | A — 12 measured reel types: length, shot timing, words/min, hooks, CTAs |
| website-to-video, playwright-recording | `resources/concordia/video-motion/openmontage` | reference | **STAGED ONLY** — inside OpenMontage index | B + C — turn a site/app walkthrough into a video |

**Website totals: 35 = ADDED 1, PARTIAL 9, NOT ADDED 25.** (Reference 20 + paid 5 = 25 NOT ADDED; ready 8 = 7 PARTIAL + 1 ADDED; setup 2 = PARTIAL.)

---

## V2.3 — Muse app catalog: all 62 repos in `resources/repo-catalog/repositories.json`

All 62: `audit_status: not_audited`, `execution_status: not_approved`. One line each. **STAGED ONLY** = one of the 8 with a `local_reference` (snapshot claimed, path absent in this clone) PLUS Bang Motion and rea-video, which are staged only as graph-corpus copies — 10 in total. **PARTIAL** = the 2 security items below. Everything else is **NOT ADDED**.

| # | Repo | Bucket | v2 status | What it does (one line, from the catalog's own mention) |
|---|---|---|---|---|
| 1 | 666ghj/MiroFish — https://github.com/666ghj/MiroFish | — | NOT ADDED (excluded — gated, no description in catalog) | Gated resource ("comment CROWD to receive via DM"); no description given |
| 2 | academa-labs/manimgx — https://github.com/academa-labs/manimgx | B | NOT ADDED | Open-source animation engine (Rust + wgpu) that runs most Manim Community code, built for AI agents |
| 3 | affaan-m/ECC — https://github.com/affaan-m/ECC | Infra | NOT ADDED | 63 AI agents / 249 skills GitHub repo (gated) |
| 4 | affaan-m/everything-claude-code — https://github.com/affaan-m/everything-claude-code | Infra | NOT ADDED | Whole Claude Code setup (gated). NOTE: a different clone exists at `~/workspace/claude-9-repos/everything-claude-code` from `WorldFlowAI/everything-claude-code` — different origin, do not conflate |
| 5 | airbnb/lottie-android — https://github.com/airbnb/lottie-android | C | NOT ADDED | Render After Effects animations natively on Android/iOS |
| 6 | airbnb/lottie-web — https://github.com/airbnb/lottie-web | C | NOT ADDED | Render After Effects animations natively on the web |
| 7 | bangtutorial/bang-motion — https://github.com/bangtutorial/bang-motion | C | STAGED ONLY (graph-corpus motion-systems copy) | Free Claude Code skill that turns your coding agent into a motion designer — openers, promos, kinetic type |
| 8 | barckley75/resolve-claude-mcp — https://github.com/barckley75/resolve-claude-mcp | C | STAGED ONLY | Connect DaVinci Resolve Studio to Claude via MCP, 52 tools for timelines, colour, Fusion, rendering |
| 9 | bilawalsidhu/gods-eye-view — https://github.com/bilawalsidhu/gods-eye-view | B + C | NOT ADDED | Live globe / spatial intelligence in browser — ready-made map/globe visuals for documentaries/explainers (flagged by Mohamed, Nov 15) |
| 10 | blender/blender — https://github.com/blender/blender | C | NOT ADDED | Full 3D creation suite for product visuals and animated explainers |
| 11 | BudgetAny/Budget3D — https://github.com/BudgetAny/Budget3D | C | NOT ADDED | One photo → 3D model, with a compute budget you control |
| 12 | calesthio/OpenMontage — https://github.com/calesthio/OpenMontage | A + B + C | STAGED ONLY | Agentic video production, 12 pipelines, 100+ tools, 700+ skills (see v1 #14; AGPL-3.0) |
| 13 | charlesdove977/advertising-ops — https://github.com/charlesdove977/advertising-ops | A + C | NOT ADDED | Top 3 newest repos for Claude Code, all on Higgsfield MCP: ad-creative system, Zillow-to-video-tour, consistent-character UGC ad factory |
| 14 | charlesdove977/re-walkthrough-pro — https://github.com/charlesdove977/re-walkthrough-pro | A | NOT ADDED | Any Zillow link → cinematic room-by-room home tour, no camera |
| 15 | charlesdove977/UGC-Factory — https://github.com/charlesdove977/UGC-Factory | A + C | STAGED ONLY | UGC ad factory, 15 prompt styles incl. real estate, product 360, social hook (see §V2.4) |
| 16 | cloudflare/security-audit-skill — https://github.com/cloudflare/security-audit-skill | Infra / security | PARTIAL | Security-audit skill for coding agents, 6-phase harness. Staged at `resources/security-tools/cloudflare-security-audit` @ `c1c8a8c`, `not_audited` / `blocked`; NO complete audit ever ran (AUDIT-STATUS.md). Install: `npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit` (+ `--global`) |
| 17 | debpalash/VoiceStudio — https://github.com/debpalash/VoiceStudio | B + C | STAGED ONLY | Local speech with saved/designed voices, transcription, dubbing/narration automation |
| 18 | deepseek-ai/deepseek-harness — https://github.com/deepseek-ai/deepseek-harness | — | NOT ADDED (excluded — gated, no description) | Gated resource, full video walkthrough; no description in catalog |
| 19 | dozentwelve/papermorph — https://github.com/dozentwelve/papermorph | B | NOT ADDED | AI skill that turns static PDFs into living, narrated web experiences |
| 20 | FFmpeg/FFmpeg — https://github.com/FFmpeg/FFmpeg | C | NOT ADDED | Universal video/audio converter every video pipeline runs on (ffmpeg is installed on his PC; the repo itself is not in ys-sites/video) |
| 21 | ffmpegwasm/ffmpeg.wasm — https://github.com/ffmpegwasm/ffmpeg.wasm | C | NOT ADDED | FFmpeg in the browser; client-side video conversion on a website |
| 22 | godotengine/godot — https://github.com/godotengine/godot | C | NOT ADDED | Multi-platform 2D/3D game engine; interactive demos and animation |
| 23 | GraphiteEditor/Graphite — https://github.com/GraphiteEditor/Graphite | C | NOT ADDED | Community 2D content app for graphic design / digital illustration |
| 24 | greensock/GSAP — https://github.com/greensock/GSAP | C | NOT ADDED | Pro JavaScript animation library; motion for client sites and video |
| 25 | HandBrake/HandBrake — https://github.com/HandBrake/HandBrake | A + B | NOT ADDED | Free video transcoder; compress lessons/reels for fast loading |
| 26 | HKUDS/DeepTutor — https://github.com/HKUDS/DeepTutor | B | NOT ADDED | Open-source AI learning workspace — textbooks supply context for tutoring, quizzes, problem-solving |
| 27 | iamtechartist/every-joule-lesson1 — https://github.com/iamtechartist/every-joule-lesson1 | B | STAGED ONLY | Every Joule Lesson 1: Energy stores, interactive 3D physics lesson |
| 28 | JDhruv14/line-art-animation — https://github.com/JDhruv14/line-art-animation | B + C | NOT ADDED | Claude skill + TypeScript library for hand-inked line-art SVG animations, rendered as video |
| 29 | juliangarnier/anime — https://github.com/juliangarnier/anime | C | NOT ADDED | JavaScript animation engine for slick web/video motion |
| 30 | JuneYaooo/rea-video — https://github.com/JuneYaooo/rea-video | C | STAGED ONLY (quarantine copy) | Reverse-engineers any video shot by shot and hands you a plan to remake it; also website §V2.2 |
| 31 | KDE/kdenlive — https://github.com/KDE/kdenlive | A + B | NOT ADDED | Free multi-track video editor (MLT framework) |
| 32 | konvajs/konva — https://github.com/konvajs/konva | B + C | NOT ADDED | HTML5 canvas framework for interactive graphics, whiteboards, diagrams |
| 33 | latent-spaces/brag — https://github.com/latent-spaces/brag | A + C | NOT ADDED | Claude skill that reads your actual site/code, plans a trailer-style launch video |
| 34 | ManimCommunity/manim — https://github.com/ManimCommunity/manim | B | NOT ADDED | Python framework for explanatory math animations; perfect for ENGR 213-style lessons |
| 35 | mengto/skills — https://github.com/mengto/skills | C | NOT ADDED | Curated skills for demos: dream-loop 3D visuals with Blender + critic agent, Hairline isometric line drawings, design skills |
| 36 | meshy-dev/ThreeRT — https://github.com/meshy-dev/ThreeRT | C | NOT ADDED | Meshy's hardware ray-traced three.js: real-time path tracer |
| 37 | meta/astryx — https://github.com/meta/astryx | Infra / website | NOT ADDED | Meta's open-source design system, 150+ components, React 19+, beta. Also a full clone at `~/workspace/claude-9-repos/astryx` |
| 38 | mltframework/shotcut — https://github.com/mltframework/shotcut | A + B | NOT ADDED | Cross-platform open-source video editor for cutting reels/lessons |
| 39 | Moh4696/cinematic-skill — https://github.com/Moh4696/cinematic-skill | B + C | NOT ADDED | See v1 #1 — documentary films from code, Python+Skia |
| 40 | mojs/mojs — https://github.com/mojs/mojs | C | NOT ADDED | Motion-graphics toolbelt for the web; animated bursts/icons |
| 41 | motiondivision/motion — https://github.com/motiondivision/motion | C | STAGED ONLY | Motion animation library (claimed snapshot `resources/concordia/motion-library`, absent here); also a dependency of the Vite site? No — `package.json` lists `motion` ^12.23.24, so the *npm package* is used, the *repo* is not installed as a skill |
| 42 | mrdoob/three.js — https://github.com/mrdoob/three.js | C | NOT ADDED | JavaScript 3D library; interactive 3D product/concept visuals |
| 43 | nexu-io/openmotion — https://github.com/nexu-io/openmotion | C | NOT ADDED | First full-stack agentic video generator — reverse-engineer any video, then recreate/edit/render with HTML+TypeScript. NOTE: video vid_387 was by FondPeace Crazy — the one unscanned account |
| 44 | obsproject/obs-studio — https://github.com/obsproject/obs-studio | B | NOT ADDED | Free screen recording / livestreaming studio; record study lessons |
| 45 | openqodex/openqodex — https://github.com/openqodex/openqodex | — | NOT ADDED (excluded — not video: local AI code reviewer) | Open-source AI code reviewer that runs locally |
| 46 | opentoonz/opentoonz — https://github.com/opentoonz/opentoonz | B + C | NOT ADDED | Full open-source 2D animation software; hand-drawn cartoon lessons |
| 47 | paulirish/chrome-capture — https://github.com/paulirish/chrome-capture | B + C | NOT ADDED | Records any Chrome tab at 60–120fps — walkthrough capture |
| 48 | pbakaus/impeccable — https://github.com/pbakaus/impeccable | C | NOT ADDED | Gives your coding agent a design vocabulary: polish, bolder visuals |
| 49 | pixijs/pixijs — https://github.com/pixijs/pixijs | C | NOT ADDED | Fast flexible 2D WebGL renderer for interactive web content |
| 50 | remotion-dev/remotion — https://github.com/remotion-dev/remotion | B + C | NOT ADDED (repo) / PARTIAL (skill) | Make videos programmatically with React; templated study videos. The *repo* is not in ys-sites/video; the *Claude skill* `remotion:*` is ready on his PC (website §V2.2) |
| 51 | Sandflow-ai/sand3d — https://github.com/Sandflow-ai/sand3d | C | NOT ADDED | Python 3D-modelling library built for LLMs: describe a shape in words, the model writes the code that builds it |
| 52 | shinyobjectz/raea — https://github.com/shinyobjectz/raea | C | NOT ADDED | Free open-source creative engine (Rust, Bevy, Dioxus): AI agents build/edit/animate/render videos, motion graphics, 3D scenes, shaders, games programmatically |
| 53 | storytold/filmcraft — https://github.com/storytold/filmcraft | A + B | NOT ADDED | Open-source non-linear video editor written from scratch in Rust |
| 54 | Tejashmakwana/motionmaxxing — https://github.com/Tejashmakwana/motionmaxxing | A + C | STAGED ONLY | See v1 #6 — motion-design quality rules |
| 55 | tokio-rs/topcoat — https://github.com/tokio-rs/topcoat | — | NOT ADDED (excluded — not video: Rust web framework) | Batteries-included Rust web framework with an LLMs.txt |
| 56 | tweenjs/tween.js — https://github.com/tweenjs/tween.js | C | NOT ADDED | Simple JavaScript tweening engine for UI/video animation |
| 57 | Vibha-Ramprakash/claude-video-effects — https://github.com/Vibha-Ramprakash/claude-video-effects | A | STAGED ONLY | Claude Code skill, 45 talking-head effects, face tracking, layers behind your head (same 45 as website `effects`, PARTIAL on PC) |
| 58 | videojs/video.js — https://github.com/videojs/video.js | B | NOT ADDED | Open-source HTML video player framework; embed lessons/reels on any site |
| 59 | Vincentwei1021/anything2explainer — https://github.com/Vincentwei1021/anything2explainer | B | NOT ADDED | Topic in → narrated explainer (also in graph-corpus motion-systems as `anything2explainer`) |
| 60 | wulkano/Kap — https://github.com/wulkano/Kap | B | NOT ADDED | Open-source screen recorder built with web tech; capture tutorials fast |
| 61 | xai-org/grok-build — https://github.com/xai-org/grok-build | — | NOT ADDED (excluded — gated setup, no description) | Gated resource ("comment GROK"); no description in catalog |
| 62 | NVIDIA/SkillSpector — https://github.com/NVIDIA/SkillSpector | Infra / security | PARTIAL | **Not a video tool and not a GPU tool.** A scanner that audits AI agent skills/prompts (prompt-injection, malicious instructions). Clone failed (only 11/582 files via connector); SkillSpector 2.12.0 was installed in a gitignored WSL venv (`resources/skillspector-venv`, absent in this clone), `skill-inspector` Codex skill installed. One real pass: 19 motion folders, 10 completed, 9 incomplete (OOM/timeout). `docs/skillspector-results.json` "0 issues, SAFE" is the runner's fallback path when the binary is missing — not evidence of a real scan. Runs on CPU. |

**Catalog totals: 62 = video-benefiting 57 (ADDED 0, STAGED ONLY 10, PARTIAL 2, NOT ADDED 45) + excluded 5 (all NOT ADDED).**

---

## V2.4 — Skill index: all 178 indexed skills, grouped (all STAGED ONLY)

`skill-index.json`: 178 rows, 126 distinct names, all `unreviewed_reference`, **0 of 178 paths exist on this disk**. Do NOT list all 178 individually — they are mostly duplicates of the same skill shipped in `.agents/skills/` and `.claude/skills/` inside one parent repo. Grouped by parent:

| Parent (claimed path) | Rows | Distinct names | v2 status | What the group is |
|---|---|---|---|---|
| OpenMontage — `resources/concordia/video-motion/openmontage/` | 139 | ~95 | STAGED ONLY | The whole OpenMontage skill library: video creation/edit/translate/understand/toolkit, Remotion + HyperFrames, GSAP + Three.js (11 sub-skills), Manim, ComfyUI, LTX2, Seedance 2.0/2.5, Kling, MiniMax-H3, HeyGen, Flux, TTS (ElevenLabs, Azure, Doubao, Fish Audio, text-to-speech, speech-to-text), music (ACE-Step, Lyria), SFX, faceswap, avatar-video, 3D-asset-generation, media-use, website-to-video, playwright-recording, video-download, etc. This is where most of the "178" comes from — one repo, counted ~3× (`.agents/` + `.claude/` + duplicates). |
| UGC-Factory — `resources/concordia/video-motion/ugc-factory/` | 16 | 16 | STAGED ONLY | 1 parent skill + 15 Seedance style skills: cinematic, 3D-CGI, cartoon, comic-to-video, fight-scenes, motion-design-ad, ecommerce-ad, anime-action, product-360, music-video, social-hook, brand-story, fashion-lookbook, food-beverage, **real-estate** |
| MiniMax-H3 — `resources/concordia/video-motion/MiniMax-H3/` | 11 | 9 | STAGED ONLY | h3-prompt-writing (×3 copies), 3D-animation-short, brand-promo, co-op-game-intro, handdrawn-live-video, minimalist-product-ad, music-video-subtitle, paper-collage-explainer, papercraft-stop-motion-explainer |
| VoiceStudio — `resources/concordia/video-motion/voicestudio/` | 4 | 4 | STAGED ONLY | voicestudio, voicestudio-maintainer, fastapi-python, vite (the last two are dev skills, not video) |
| motion-library — `resources/concordia/motion-library/` | 2 | 2 | STAGED ONLY | fix, improve (motion library agent skills) |
| lemo-opuscar — `resources/concordia/video-motion/lemo-opuscar/` | 2 | 1 | STAGED ONLY | lemo-opuscar (plugin + tools/directory copies) |
| motion-video-director | 1 | 1 | STAGED ONLY | motion-video-director |
| claude-video-effects | 1 | 1 | STAGED ONLY | effects (45 talking-head effects) |
| design-motion-principles | 1 | 1 | STAGED ONLY | design-motion-principles |
| motionmaxxing | 1 | 1 | STAGED ONLY | motionmaxxing |

**Skill-index totals: 178 rows = STAGED ONLY 178, ADDED 0, NOT ADDED 0 (they are not "not added" in the catalog sense — they were claimed as staged copies, and none of those copies is on this disk).**

---

## V2.5 — Clones elsewhere: `~/workspace/claude-9-repos/` (9) + `~/workspace/agency-repos/` (7)

Full git clones, none wired into ys-sites/video. Only the video ones get full entries; the rest are one line in the excluded list.

| Clone | Remote | v2 status | Bucket / note |
|---|---|---|---|
| lemo-opuscar | `lemomo-ai/lemo-opuscar` (358 MB) | STAGED ONLY | C — 99 film styles in code; the video one. Implementation prompt only at `~/workspace/your_files/lemo-opuscar-video-prompt.md` |
| SlopMonster | `ItsssssJack/SlopMonster` | NOT ADDED | C (tangential) — video "slop" critique; has a `SKILL.md`, not used by the video repo |
| everything-claude-code | `WorldFlowAI/everything-claude-code` | NOT ADDED | Infra — general Claude Code setup collection. **Different origin from catalog `affaan-m/everything-claude-code`** — do not conflate |
| astryx | `meta/astryx` | NOT ADDED | Infra / website — Meta design system; also catalog #37 |
| agent-skills, agent-desktop, freellmapi, heretic, Claude-Code-Game-Studios | addyosmani, vercel-labs, tashfeenahmed, p-e-w, Donchitos | NOT ADDED | Not video — general agent skills / desktop / LLM API / game studios |

Agency clones (7): firecrawl, google-maps-scraper (gosom — the Maps scraper, NOT omkarcloud), huginn, listmonk, check-if-email-exists, remote-jobs, twenty (3.5 GB) — **none is video-related, all NOT ADDED**. Only huginn is even mentioned in the video repo: MASTER-ROUTER §1 routes automation to `resources/repo-quarantine/huginn/huginn`, "needs Docker; **not installed**" (a copy also survives in `graph-corpus/resources/repo-quarantine/huginn/`).

---

## V2.6 — Quarantine / motion-systems extras not in the 62 (from MASTER-ROUTER §2)

Staged copies in `graph-corpus/resources/repo-quarantine/` and `graph-corpus/resources/motion-systems/` (14 motion folders). All **STAGED ONLY** unless noted; "reviewed, not approved" or "too large for this PC" per the router. Do not promote any of these to trusted status on GitHub popularity alone (AGENTS.md).

| Item | Where | v2 status | Bucket / note |
|---|---|---|---|
| ComfyUI | `graph-corpus/resources/repo-quarantine/Comfy-Org/ComfyUI` | PARTIAL | C — installed on PC at `C:\Users\Sharafath\AI-Local\ComfyUI`, first render untested; repo copy is quarantine only |
| LTX-Video | `…/Lightricks/LTX-Video` | STAGED ONLY | C — local text/image→video model; LTX-Video 2B is the one downloaded on PC |
| HunyuanVideo | `…/Tencent-Hunyuan/HunyuanVideo` | STAGED ONLY | C — too large for this PC; cloud-GPU route only |
| Open-Sora | `…/hpcaitech/Open-Sora` | STAGED ONLY | C — too large for this PC; cloud-GPU route only |
| WanGP | `…/deepbeepmeep/WanGP` | STAGED ONLY | C — Wan 2.1 1.3B downloaded on PC; big WanGP models need cloud GPU |
| HeyGem | `…/suifeng9203/HeyGem.ai` | STAGED ONLY | C — avatar video, too large for this PC |
| LongCat-Video-Avatar | `…/MeiGen-AI/LongCat-Video-Avatar` | STAGED ONLY | C — avatar video, too large for this PC |
| freefield | `…/neuregex/freefield` | STAGED ONLY | C — 120 ComfyUI apps; only small-model apps are practical on this PC |
| Open-Generative-AI, open-higgsfield-ai | `…/Anil-matcha/`, `…/sunnychase/` | STAGED ONLY | C — front ends for paid muapi.ai API (hosted image/video generation) |
| inference-optimisation-skill | `…/sybil-solutions/` | STAGED ONLY | Infra — speed up local LLMs (llama.cpp + Vulkan on iGPU) |
| Motion-systems (14 folders) | `graph-corpus/resources/motion-systems/` | STAGED ONLY | B + C — anidoodle, anything2explainer, bang-motion, claude-animation-base, claude-drawing-skill, claude-motion-styles, hand-drawn-explainer, handdraw-skill, huashu-art-motion, javascript-animation-skills, manim-skill, motion-design-skill, motion-skill, paint-mv-skills. Scanner: 10 completed, 9 incomplete; manim-skill SAFE, motion-design-skill CAUTION, handdraw / paint-mv / javascript-animation DO_NOT_INSTALL (mostly SC9 noise + AE1 coverage gaps per AUDIT-STATUS.md — not verdicts) |
| talking-head-reels.zip, voiceover-glass-reel.zip | repo root, tracked | NOT ADDED | A — both still zipped, never extracted; extracted dirs gitignored and absent |

---

## V2.7 — Security tools: all 12 in `security-tool-registry.json`

All `not_audited`; 11 `blocked`, SkillSpector "tool installed; reference not independently audited". These are audit tools, not video features — they produce reports, they add no video capability. **None is ADDED to ys-sites/video as a working tool.**

| Tool | Repo | v2 status |
|---|---|---|
| SkillSpector | NVIDIA/SkillSpector | **PARTIAL** — see catalog #62 |
| Cloudflare Security Audit | cloudflare/security-audit-skill | **PARTIAL** — see catalog #16 |
| Strix, Trivy, Nuclei, TruffleHog, Semgrep, Codex Security, ClamAV, Claude Code Security Review, BLA, PyRIT | usestrix/strix, aquasecurity/trivy, projectdiscovery/nuclei, trufflesecurity/trufflehog, semgrep/semgrep, openai/codex-security, Cisco-Talos/clamav, anthropics/claude-code-security-review, qybaihe/bla, Azure/PyRIT | **STAGED ONLY** — source staged at `resources/security-tools/*` @ the commits in the registry, all `blocked`, none run to completion in this repo. Note: `.github/workflows/security.yml` runs TruffleHog, Semgrep, Trivy and a SkillSpector job in CI — that is the only place any of these actually execute |

---

## V2.8 — v2 summary (for Antigravity: start here)

| Source | Total | ADDED | PARTIAL | STAGED ONLY | NOT ADDED |
|---|---|---|---|---|---|
| Repo skills actually in ys-sites/video (§V2.1) | 4 | **4** | 0 | 0 | 0 |
| Website skills.json (§V2.2) | 35 | 1* | 9 | 0 | 25 |
| Catalog 62 repos (§V2.3) | 62 (57 video) | 0 | 2 | 10 | 50 |
| Skill index (§V2.4) | 178 rows / 126 names | 0 | 0 | 178 | 0 |
| Facebook v1 (§v1, 12 new vs catalog) | 15 (12 new) | 0 | 0 | 0 | 15 |
| Clones elsewhere (§V2.5) | 16 (2 video-ish) | 0 | 0 | 1 | 15 |
| Security tools (§V2.7) | 12 | 0 | 2 | 10 | 0 |

\* The 1 ADDED in the website table is the 136-reel creator study, which is part of creator-video in §V2.1 — counted in both tables, do not double-count it in a grand total.

**Bottom line for Antigravity:** Mohamed has **about 90–95 distinct video tools** catalogued/indexed/listed across the Muse app and the website, and **4 skills actually added** in ys-sites/video (creator-video, study-video, hyliox-pixel-perfect, rea-skill), plus 9 more that are PARTIAL on his Windows PC as Claude skills / local installs (Remotion, captions-skill, effects, anatomy, Whisper, REA MCP, Code-synth, OmniVoice, ComfyUI+LTX/Wan). Everything else is a catalog entry, a staged copy that does not survive a fresh clone (gitignored), or a reference listing on the website. **Audit the NOT ADDED and STAGED ONLY items first** — those are the ones that would actually change what he can make if installed — and give each the INSTALL / INSTALL WITH CONDITIONS / DO NOT INSTALL verdict from §v1, with the machine limits (Ryzen 7, no Nvidia GPU, 15 GB RAM) applied. Do NOT install anything. Do NOT push anything.

---

---

## Context — Mohamed's setup

- **Machine:** Windows PC, Ryzen 7 5825U, integrated Radeon Vega 8, **NO Nvidia GPU**, 15 GB RAM
- **Target repo:** [ys-sites/video](https://github.com/ys-sites/video) — public Vite + React + TypeScript site (Master Video Styles)
- **What he wants:** organise video work into three buckets —
  - **A — Real estate content-creator video style**
  - **B — Concordia lesson video generation** (engineering explainer / documentary lessons)
  - **C — Cinema / cinematography / video generation / image generation**
- **Current state of ys-sites/video (verified Nov 23, 2026):** 62 repos catalogued, 178 skills indexed, 331 videos catalogued — but only **4 skills actually implemented** (`creator-video`, `study-video`, `hyliox-pixel-perfect`, `rea-skill`). Most pulled repos are gitignored catalog entries, not installed. Cloning a repo is NOT installing it: a Claude Code skill needs `npx skills add … --global` / `~/.claude/skills/`, a Python/Node tool needs `pip`/`npm install` + venv + system deps, and a website dependency needs to be in `package.json`.

## Audit criteria — apply to every repo

For each repo, check and report:

1. **Security issues** — malicious instructions, prompt injection in skill files, hardcoded secrets, suspicious install scripts, supply-chain risks.
2. **License / commercial-use limits** — is it MIT/Apache (free for client work), AGPL, source-available, or non-commercial only? Flag anything that blocks Mohamed's agency/client work.
3. **README-vs-code completeness** — does the code actually contain what the README promises (workflows, scripts, pipelines)? List missing files by name.
4. **Installability on his machine** — Windows + Ryzen 7 + integrated Radeon, no Nvidia GPU, 15 GB RAM. Flag anything needing an Nvidia GPU, macOS-only tooling, Docker, a paid API, or heavy model weights.
5. **What kind of thing it is** — a Claude Code skill (`SKILL.md`), a Python/Node tool, or a separate hosted app (e.g. a Laravel SaaS). These install completely differently.
6. **Verdict:** INSTALL / INSTALL WITH CONDITIONS / DO NOT INSTALL, with reasons.

---

## Verified repos — from Facebook reels (12 reels read, 13 repos, 12 live, 1 dead)

### 1. Cinematic Skill — Moh4696/cinematic-skill
- **Repo:** https://github.com/Moh4696/cinematic-skill
- **Source:** Nadeem Khan (@hexnadeem) reel, Nov 13, 2026 — https://www.facebook.com/reel/4350302691880930/
- **What it does:** Agent skill (Claude Code, Codex, Cursor, Gemini CLI) that builds narrated documentary films entirely from code — agent writes the script, records voiceover, fetches public-domain photos, draws every frame deterministically in Python + Skia. No AI video generation, so no blurry hallucinations. Styles include documentary/history, product launch, science/engineering.
- **License / stars:** MIT, 921 stars (verified Nov 23)
- **Install notes:** `npx skills add Moh4696/cinematic-skill`; needs Node 22.20+, ffmpeg, `pip install -r requirements.txt`
- **Bucket:** B Concordia + C Cinema
- **Status in ys-sites/video:** Not installed yet

### 2. sfx-generator-skill — thisisvela/sfx-generator-skill
- **Repo:** https://github.com/thisisvela/sfx-generator-skill
- **Source:** Comment on the Cinematic Skill reel above, Nov 15, 2026 — https://thisisvela.github.io/sfx-generator-skill/ — not in the video itself
- **What it does:** Claude Code / Codex skill that turns a sentence into a finished sound effect — 99 deterministic numpy recipes, an `sfx` CLI, local tuning page, levels specced against narration.
- **License / stars:** Apache 2.0, 0 stars (very new/small)
- **Bucket:** C video generation — supports A and B too
- **Status in ys-sites/video:** Not installed yet

### 3. skillshare — runkids/skillshare
- **Repo:** https://github.com/runkids/skillshare
- **Source:** GithubSignals reel, May 29, 2026 — https://www.facebook.com/reel/2193739521414733/
- **What it does:** One source of truth that syncs skills, agents, rules, MCP connections, plugins and hooks across all AI CLI tools (Claude Code, Codex, Pi, OpenCode) with one command, plus a built-in security audit.
- **License / stars:** MIT, 3,292 stars
- **Bucket:** Infra — pipeline/organisation, not A/B/C. Directly relevant to his "organise 100+ repos" problem.
- **Status in ys-sites/video:** Not installed yet

### 4. ClawHub — openclaw/clawhub
- **Repo:** https://github.com/openclaw/clawhub
- **Source:** GithubSignals reel, Sep 14, 2026 — https://www.facebook.com/reel/1406998574725065/
- **What it does:** Public skill/plugin registry for OpenClaw — an "app store" for tiny text-file agent skills; browse, search, install with one command.
- **License / stars:** MIT, 9,559 stars
- **Bucket:** Infra / registry — a place to find and publish skills, not a video tool itself
- **Status in ys-sites/video:** Not installed yet

### 5. Hypit — hypit-ai/hypit
- **Repo:** https://github.com/hypit-ai/hypit
- **Source:** GithubSignals reel, Sep 15, 2026 (the reel Mohamed linked) — https://www.facebook.com/reel/4579253032395557/
- **What it does:** AI agents clone a viral video as a complete workflow — swap the face, rewrite the words, replace the B-roll — and ship 100 variants in one command.
- **License / stars:** TypeScript, 31,141 stars
- **Install notes:** `npx skills add hypit-ai/hypit -g`; needs Node 22.15+, pnpm; generation models via HypiHub or own API/local models, billed by the provider
- **Bucket:** A Real Estate + C video generation — the single most direct fit for real-estate content (one winning listing-tour format → 100 variants)
- **Status in ys-sites/video:** Not installed yet

### 6. motionmaxxing — tejashmakwana/motionmaxxing
- **Repo:** https://github.com/tejashmakwana/motionmaxxing
- **Source:** GithubSignals reel, Oct 12, 2026 — https://www.facebook.com/reel/2620157271731680/
- **What it does:** Agent skill ("looksmaxxing for motion graphics") that turns generic AI video into professional motion design, using measured rules from 53 real professional motion moments; scripts inspect frames and fail "lazy patterns" (flat colours, boring fades, page chrome). Renders locally from HTML.
- **License / stars:** Apache 2.0, 1,773 stars
- **Bucket:** A + C — quality pass over AI-generated real-estate promos and lesson videos
- **Status in ys-sites/video:** Not installed yet. Note: a copy of this repo's name also appears in Mohamed's catalogues; verify whether any local copy exists before re-cloning.

### 7. eian-riso-broll — yian6557/eian-riso-broll
- **Repo:** https://github.com/yian6557/eian-riso-broll
- **Source:** GithubSignals reel, Oct 16, 2026 — https://www.facebook.com/reel/2300438027409110/
- **What it does:** Hand a coding agent a talking-head script; it picks the key numbers/quotes and renders ten vertical (1080×1920) risograph-style info animations (big number, before/after, key quote), local/offline, free.
- **Install notes:** Needs Node 22+, Chrome, ffmpeg
- **⚠️ LICENCE TRAP:** Source-available under a custom "Eian Personal Non-Commercial License 1.0" — commercial use (monetised accounts, advertising, client/employer projects) needs prior written authorisation and a fee. This matters for his agency/client work. Fine for his own content; do not use for clients without permission.
- **Bucket:** A + B — talking-head real-estate videos (price, sqft, before/after) and Concordia lessons (formulas, numbers, key quotes)
- **Status in ys-sites/video:** Not installed yet

### 8. Openjutsu — d3voz/openjutsu
- **Repo:** https://github.com/d3voz/openjutsu
- **Source:** GithubSignals reel, Oct 28, 2026 — https://www.facebook.com/reel/1434114118228494/
- **What it does:** Local, open-source Genjutsu-style character/object swap for video — drop in a video + a character photo, the main person is replaced while movement and soundtrack stay intact. Runs on your own GPU (MiniMax H3, SAM 3.1, Qwen3-VL via ComfyUI).
- **License / stars:** MIT, 2,557 stars
- **⚠️ GPU REQUIREMENT:** Needs an NVIDIA GPU (tested on RTX 4060 Ti 16GB) + ComfyUI + Node 22.6+. Mohamed has NO Nvidia GPU — cloud-GPU rental is the only route, or skip.
- **Bucket:** A + C — face-swap himself or a client into viral/property video formats; object swap / relighting for listing videos
- **Status in ys-sites/video:** Not installed yet

### 9. Open 3D Skills — moh4696/open-3d-skills
- **Repo:** https://github.com/moh4696/open-3d-skills
- **Source:** GithubSignals reel, Nov 1, 2026 — https://www.facebook.com/reel/1840941600692165/
- **What it does:** Eight agent skills for 3D/animated websites — three.js scenes from code, scroll films, transparent video (incl. Safari), cursor-following characters, exploded views of machines, AI motion assets, browser checks, 60fps recording.
- **License / stars:** MIT, 471 stars
- **Install notes:** `npx skills add Moh4696/open-3d-skills`. Same author as Cinematic Skill; Cinematic Skill's README says it uses this repo's `motion-assets` skill for AI stills — the two are designed to work together.
- **Bucket:** A + C, with B upside (exploded-view diagrams of machines/engines for Concordia MIAE lessons; 3D property/showcase web experiences)
- **Status in ys-sites/video:** Not installed yet

### 10. klad — klad-app/klad
- **Repo:** https://github.com/klad-app/klad
- **Source:** GithubSignals reel, Nov 13, 2026 — https://www.facebook.com/reel/1216298607386542/
- **What it does:** 2D painting/animation app shared by human + coding agent on the same canvas — the agent paints with real brushes/layers via CLI, no image model, every stroke stays editable data; animates via keyframes; pixel art + Godot export.
- **License:** Source-available, NOT open source (free for personal use and companies under €500k/yr revenue); macOS-first, build from source with Rust.
- **Bucket:** C image generation / painting — hand-drawn thumbnails, diagrams and game-style assets for lesson videos; custom art for real-estate branding without AI-image randomness
- **Status in ys-sites/video:** Not installed yet

### 11. OpenFilm — openfilm/openfilm
- **Repo:** https://github.com/openfilm/openfilm
- **Source:** GithubSignals reel, Nov 14, 2026 — https://www.facebook.com/reel/1453326723604185/
- **What it does:** "The open source AI video agent" — coding agent makes movies by writing them as web pages (one HTML file per film, one `frame(t)` function per shot; Three.js/WebGL/Canvas/SVG/CSS), with a local in-browser Studio editor to tweak anything by hand.
- **License / stars:** MIT, 9,024 stars
- **Install notes:** `npx skills add openfilm/openfilm` (Node 22.2+, ffmpeg) or desktop app
- **Bucket:** C + B — a serious candidate for the Concordia lesson-video pipeline (films as editable code, deterministic re-renders, human-editable timeline). Overlaps with Cinematic Skill; the two are alternatives/complements (OpenFilm = HTML/web-page films, Cinematic = Python/Skia documentary films).
- **Status in ys-sites/video:** Not installed yet

### 12. gtavi-claudecode — bodila51/gtavi-claudecode — ⚠️ DEAD
- **Repo:** https://github.com/bodila51/gtavi-claudecode
- **Source:** GithubSignals reel, Nov 19, 2026 — https://www.facebook.com/reel/2559828137849774/
- **What it was:** Claude Code plugin that watches GTA 6 streams, cuts high-energy moments into 9:16 clips with hooks/captions for paid clipping campaigns.
- **Status:** HTTP 404 as of Nov 23, 2026; the reel's own comment says "Repository is Dead". **Do not plan around it. Verdict: DO NOT INSTALL (unavailable).**
- **Bucket:** Would have been A (clip automation for creators)

### 13. PiBot — w01fb0ss/pibot
- **Repo:** https://github.com/w01fb0ss/pibot
- **Source:** GithubSignals reel, Nov 22, 2026 (most recent) — https://www.facebook.com/reel/2569463580227290/
- **What it does:** Open-source, local-first AI agent *team* for your desktop — named bots in group chats that plan, run commands, edit files, browse and use your computer, with approvals for risky steps; macOS/Windows/Linux/Android; built on the pi agent kernel.
- **License / stars:** Apache 2.0, 422 stars, created Nov 21, 2026 (very new)
- **Bucket:** Infra — a local agent team to *run* his video pipeline (research → script → render → publish) rather than a video tool itself
- **Status in ys-sites/video:** Not installed yet

---

## Later finds (not in the original 12 reels)

### 14. Open Montage — calesthio/OpenMontage (now OpenMontageInc/OpenMontage)
- **Repo:** https://github.com/calesthio/OpenMontage
- **Source:** Brody reel, Oct 11, 2026 — https://www.facebook.com/reel/1507884381100233/ — caption was "Comment 'repo' and I'll send it over", no link in the caption
- **What it does:** Open-source agentic video production system — 12 production pipelines, 100+ tools, 700+ agent skill and production-knowledge files. Turns an AI coding assistant into a full video production studio: describe the video, it researches, scripts, generates footage, adds voiceover, finds music, burns in subtitles, renders the finished cut (Remotion / HyperFrames). Pipelines include Cinematic Trailer, Explainer, Documentary Montage, Clip Factory, Avatar Spokesperson, Atelier (bespoke). Budget governance: estimate before execution, default $10 cap.
- **License / stars:** AGPL-3.0 — mind network/SaaS obligations for agency/client use. ~23–72k stars reported (counts vary by source/date; verify live).
- **Install notes:** Python 3.10+, FFmpeg, Node.js 18+, AI coding assistant; `git clone https://github.com/calesthio/OpenMontage.git`, venv + `pip install -r requirements.txt`, Remotion composer `npm install`. Heavyweight — a whole studio, not a single skill.
- **Bucket:** A + B + C — the umbrella pipeline the rest can sit inside or alongside. Strongest for B (Explainer + Documentary Montage) and A (Clip Factory).
- **Status in ys-sites/video:** Already catalogued as one of the 62 repos, reference only, NOT implemented. Claimed local copy at `resources/concordia/video-motion/openmontage` does not exist in a fresh clone (gitignored, Windows PC only).

### 15. VideoGenius AI — mohamedelaassal/youtubevideogenerator
- **Repo:** https://github.com/mohamedelaassal/youtubevideogenerator
- **Source:** Dann Paker - LeadGen & AI reel, Oct 6, 2026 — https://www.facebook.com/reel/1732829408845956/
- **What it does (per README):** YouTube Video Generator SaaS — AI script generation (GPT-4/Gemini), smart visual selection, professional voiceover, autopilot mode, direct YouTube upload, SEO optimisation, advanced analytics. Laravel 12 + Inertia.js backend, Vue.js 3 + Tailwind frontend, MySQL, Redis, n8n, Docker Compose, OpenAI/Pexels/Google Cloud TTS/YouTube APIs.
- **License:** MIT
- **⚠️ AUDIT BLOCKED — Nov 23, 2026:** An execution-risk check stopped the install. Nothing was installed, nothing was committed, nothing was pushed. The repo is a full separate Laravel SaaS (PHP, MySQL, Redis, Docker, n8n, YouTube OAuth, paid API keys), NOT a Claude Code skill — it does not belong in `skills/` as a copy of the app. Host separately only, audit first.
- **README-vs-code gap — VERIFIED:** README says core automation is in `workflows/complete_video_generator.json` and `scripts/video_generator.py` / `scripts/tts_generator.py`, and links a `CONTRIBUTING.md`. The cloned tree (HEAD `fe864bea1da2fe040047b2eb0c65ac77fbd9004f`, last commit Nov 1, 2026, "Add Docker environment example", 1.5 MB shallow clone) has **no `workflows/` directory at all**, `scripts/` contains `create_video.py`, `gtts_client.py`, `pixabay_client.py`, `unsplash_client.py`, `install_dependencies.sh`, `requirements.txt` — not the two Python files the README names — and no `CONTRIBUTING.md`. Treat the README's feature list as unproven until a clean, full-tree review is done.
- **Other audit findings:** `.env.example` ships with a pre-filled `APP_KEY` and a default weak n8n password, with `APP_DEBUG=true`. That file must never be copied to `.env` as-is; keys must be generated/rotated and debug turned off. No hardcoded production secrets were confirmed — that full grep was not completed because of the block.
- **Bucket:** A + B — YouTube script-to-upload automation for real-estate and Concordia lessons
- **Status in ys-sites/video:** Not installed. Mohamed has NOT confirmed whether to proceed despite the risk — do not install without his plain-words confirmation.

---

## Lower confidence — Instagram/TikTok only, no Facebook reel URL confirmed

These surfaced from the same accounts (GithubSignals) on Instagram/TikTok, but no Facebook reel URL was found for them. Do NOT count them as confirmed Facebook finds. Audit only if Mohamed confirms them.

- **open-slide — open-slide/open-slide** — https://github.com/open-slide/open-slide — React slide framework built for agents; agent writes decks, in-browser inspector. MIT, ~8.9k stars. Bucket B (+A) — directly useful for Concordia lesson decks.
- **3d-new-era-ai — leandrodaf/3d-new-era-ai** — Open-source home/floor-plan/interior-design editor in Rust; AI designs with you via MCP, renders photos. Bucket A — directly relevant to real-estate content.
- **Codevember 2026 — acher249/codevember-2026** — One interactive three.js scene per day in November, WebGPU in-browser. Bucket C.
- **oh-my-subagents — ringlochid/oh-my-subagents** — Durable sub-agents with persistent state + interruption recovery. Bucket: Infra.
- **Feynman — advaitpaliwal/feynman** — AI research agent: audits papers against their code, 4 sub-agents, /audit /lit /deepresearch. Note: repo has since moved to Companion-Inc/feynman per a secondary source — verify the live location. Bucket: research, not video.

---

## Accounts NOT yet scanned (file update needed)

- **Repo Radar AI** — profile 61573369875592, 7,136 followers — https://www.facebook.com/share/1D6Rss23Wi/?mibextid=wwXIfr — zero videos retrieved via API (403). A signed-in Facebook browser scan is running separately.
- **FondPeace Crazy** — @fondpeacecrazy, profile 61595100991996, 3,607 followers — https://www.facebook.com/share/1JXcndPFHk/?mibextid=wwXIfr — zero repos found via API (403). Looks like a promo account for fondpeace.com, a short-video platform, not a repo/skills account. Needs confirmation from the browser scan.

Also note: "RepoRadar" (facebook.com/RepoRadar) is a DIFFERENT page from "Repo Radar AI" — do not mix them up.

---

## Summary table

| # | Repo | Bucket | License | Status |
|---|------|--------|---------|--------|
| 1 | Moh4696/cinematic-skill | B + C | MIT | Live, not installed |
| 2 | thisisvela/sfx-generator-skill | C (supports A+B) | Apache 2.0 | Live, not installed |
| 3 | runkids/skillshare | Infra | MIT | Live, not installed |
| 4 | openclaw/clawhub | Infra | MIT | Live, not installed |
| 5 | hypit-ai/hypit | A + C | — (verify) | Live, not installed |
| 6 | tejashmakwana/motionmaxxing | A + C | Apache 2.0 | Live, not installed |
| 7 | yian6557/eian-riso-broll | A + B | Non-commercial only ⚠️ | Live, not installed |
| 8 | d3voz/openjutsu | A + C | MIT | Live, needs Nvidia GPU ⚠️ |
| 9 | moh4696/open-3d-skills | A + C (+B) | MIT | Live, not installed |
| 10 | klad-app/klad | C | Source-available, macOS-first | Live, not installed |
| 11 | openfilm/openfilm | C + B | MIT | Live, not installed |
| 12 | bodila51/gtavi-claudecode | A | — | DEAD 404 ❌ |
| 13 | w01fb0ss/pibot | Infra | Apache 2.0 | Live, not installed |
| 14 | calesthio/OpenMontage | A + B + C | AGPL-3.0 ⚠️ | Live, catalogued only |
| 15 | mohamedelaassal/youtubevideogenerator | A + B | MIT | Audit BLOCKED ⚠️, not installed |

---

# APPENDIX B — Why each item is not implemented yet (audit, Nov 23, 2026)

# Video skills/repos — which are implemented, and why the rest aren't

**Repo audited:** `~/workspace/video-repo` (ys-sites/video), HEAD `dcf85be` (Nov 20, 2026) · **Date:** Nov 23, 2026 · **Read-only audit — nothing installed, modified, or pushed.**

## Summary

- **Total rows in this file (main tables, §1–§7): 149** — catalog video 57, website 35, skill-index groups 10, clones (video) 5, security tools 12, quarantine 16, motion-systems 14. The 4 implemented skills are listed again in §8 for the full picture (2 of them also appear in §2).
- **IMPLEMENTED: 1** · **PARTIAL: 19** (usable on his Windows PC, not in this repo) · **STAGED ONLY: 83** (a copy exists somewhere local, not installed) · **NOT ADDED: 46** (no local copy at all in this clone).
- **Not implemented: 148 of 149 rows (99%).**

### Breakdown by primary reason (not-implemented rows only)

| Reason | Count | What it means |
|---|---|---|
| gitignored by design | 53 | |
| needs Claude Code skill install | 16 | |
| needs Python/Node tool install | 32 | |
| needs API key / paid credits | 11 | |
| needs GPU (Nvidia CUDA) | 9 | |
| needs another platform | 2 | |
| needs manual setup step | 8 | |
| security gate not passed | 13 | |
| dead / 404 / gated repo | 2 | |
| duplicate of another entry | 2 | |

### The one-sentence answer

Almost nothing failed for one dramatic reason. The pattern is three layers deep: **(1) the copies that do exist live on his Windows PC under gitignored paths** (`resources/.gitignore`: `concordia/*`, `motion-systems/`, `repo-quarantine/`, `security-tools/`, `skillspector-*`; root `.gitignore`: `captions-skill/`, `talking-head-reels/`, `voiceover-glass-reel/`) — so a fresh clone of ys-sites/video contains only the JSON indexes pointing at paths that don't exist (all 28 `local-snapshots.json` paths and all 178 `skill-index.json` paths are missing in this clone); **(2) cloning was never the install step** — a Claude Code skill only works when its `SKILL.md` is installed into `~/.claude/skills/` (or `npx skills add … --global`), and a Python/Node tool only works after pip/npm + venv + ffmpeg + keys, and neither step was done for the staged copies; **(3) the security gate fails closed for everything** — all 62 catalog repos are `not_audited` / `not_approved` in `repositories.json`, `tools/security_gate.py` always returns BLOCKED, and no complete Cloudflare audit was ever finished (AUDIT-STATUS.md). On top of that, the GPU-heavy tools can't run on his PC at all (Ryzen 7 5825U, integrated Radeon Vega 8, no NVIDIA/CUDA, 15 GB RAM — MASTER-ROUTER), and a dozen of the rest are paid cloud APIs.

### How to read the tables

- **IMPLEMENTED** = the `SKILL.md` / code actually exists and is tracked in `~/workspace/video-repo` at the path shown. **PARTIAL** = it works (or nearly works) on his Windows PC — Claude Code skill, `C:\Users\Sharafath\AI-Local\`, or an MCP — but it is not in this repo. **STAGED ONLY** = a source copy exists somewhere local (PC gitignored dir, `graph-corpus/` README/SKILL.md copy, or an external clone in `~/workspace/claude-9-repos/` / `agency-repos/`) but it was never installed or wired in. **NOT ADDED** = only a mention in a JSON catalog — no local copy anywhere in this clone.
- **Why** gives one primary reason per row, with the evidence that proves it. The security gate (`not_audited` / `not_approved`) applies to all 62 catalog repos, so it is only listed as the primary reason where it is the *only* remaining blocker (the 12 security tools); everywhere else the more specific blocker is listed.
- **Bucket:** A = real-estate creator video, B = Concordia lesson video, C = cinema / cinematography / video generation, Infra = tooling/infrastructure, Non-video = excluded from the main tables (listed in one line under each section).

## 1. Catalog — all 62 repos in `resources/repo-catalog/repositories.json` (57 video-benefiting)

| Name | Repo / skill | Status | Why not implemented (reason + evidence) | Bucket |
|---|---|---|---|---|
| manimgx | `academa-labs/manimgx` | NOT ADDED | **needs Python/Node tool install** — Rust+wgpu animation engine; needs cargo/pip install + build, no local copy; catalog not_audited/not_approved | B |
| ECC | `affaan-m/ECC` | NOT ADDED | **dead / 404 / gated repo** — Gated: comment 'ECC' on an IG reel to receive via DM; no local copy; same content as everything-claude-code | Infra |
| everything-claude-code | `affaan-m/everything-claude-code` | NOT ADDED | **duplicate of another entry** — Duplicate of affaan-m/ECC — catalog metadata full_name is affaan-m/ECC, same 62,777 KB size; also gated ('STACK' via DM) | Infra |
| lottie-android | `airbnb/lottie-android` | NOT ADDED | **needs another platform** — Native Android/iOS library, not a Claude skill or web dep; no local copy; not_audited | Infra |
| lottie-web | `airbnb/lottie-web` | NOT ADDED | **needs Python/Node tool install** — Web library; needs npm install into the Vite app — not in package.json, no local copy; not_audited | Infra |
| bang-motion | `bangtutorial/bang-motion` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus/resources/motion-systems/bang-motion/; full source gitignored (resources/.gitignore: motion-systems/); SkillSpector retry: DO_NOT_INSTALL; not_audited | C |
| resolve-claude-mcp | `barckley75/resolve-claude-mcp` | STAGED ONLY | **gitignored by design** — local_reference resources/concordia/video-motion/resolve-claude-mcp in repositories.json, but path does not exist in this clone; resources/.gitignore: concordia/*; also needs DaVinci Resolve + MCP install | C |
| gods-eye-view | `bilawalsidhu/gods-eye-view` | NOT ADDED | **needs Python/Node tool install** — Browser 3D globe web app; needs clone + npm/build + hosting, no local copy; not_audited | C |
| blender | `blender/blender` | NOT ADDED | **needs Python/Node tool install** — Full desktop 3D suite — a download/install, not a skill; no local copy; not_audited | C |
| Budget3D | `BudgetAny/Budget3D` | NOT ADDED | **needs API key / paid credits** — One photo to 3D with a 'compute budget you control' — paid cloud compute per model; no local copy; not_audited | C |
| OpenMontage | `calesthio/OpenMontage (now OpenMontageInc/OpenMontage)` | STAGED ONLY | **gitignored by design** — local_reference resources/concordia/video-motion/openmontage in repositories.json, path does not exist in this clone; resources/.gitignore: concordia/*; 139 skill rows in skill-index.json all point at that missing path; needs Python 3.10+/FFmpeg/Node 18+ | C |
| advertising-ops | `charlesdove977/advertising-ops` | NOT ADDED | **needs API key / paid credits** — Built on Higgsfield MCP — needs paid Higgsfield credits + MCP setup; no local copy; not_audited | A |
| re-walkthrough-pro | `charlesdove977/re-walkthrough-pro` | NOT ADDED | **needs API key / paid credits** — Zillow-to-video via Higgsfield MCP — needs paid Higgsfield credits; no local copy; not_audited | A |
| UGC-Factory | `charlesdove977/UGC-Factory` | STAGED ONLY | **gitignored by design** — local_reference resources/concordia/video-motion/ugc-factory, path does not exist in this clone; resources/.gitignore: concordia/*; 16 skill rows in skill-index.json point at the missing path; most styles call paid Seedance | C |
| security-audit-skill | `cloudflare/security-audit-skill` | PARTIAL | **needs manual setup step** — Cloudflare plugin 1.0.4 installed on his PC (MASTER-ROUTER §2, ~/.claude/plugins/cache/cloudflare/…) but MCP needs a restart + one-time Cloudflare OAuth; full audit never completed (AUDIT-STATUS.md: 'No complete Cloudflare audits have been completed', WSL access denied); the '0 vulnerabilities' docs are from a local regex script, not this skill | Infra |
| VoiceStudio | `debpalash/VoiceStudio` | STAGED ONLY | **gitignored by design** — local_reference resources/concordia/video-motion/voicestudio, path does not exist in this clone; resources/.gitignore: concordia/*; 4 skill rows point at the missing path; needs Python venv + models | C |
| papermorph | `dozentwelve/papermorph` | NOT ADDED | **needs Claude Code skill install** — Claude skill (PDF to narrated web experience); no local copy, never installed into ~/.claude/skills/; not_audited | C |
| FFmpeg | `FFmpeg/FFmpeg` | PARTIAL | **needs manual setup step** — Binary is installed on his Windows PC (MASTER-ROUTER: 'ffmpeg installed'), but the FFmpeg source repo is not cloned and it is not a package.json dependency — it is a system tool, not an implemented repo | Infra |
| ffmpeg.wasm | `ffmpegwasm/ffmpeg.wasm` | NOT ADDED | **needs Python/Node tool install** — Browser FFmpeg; needs npm install — not in package.json, no local copy; not_audited | Infra |
| godot | `godotengine/godot` | NOT ADDED | **needs Python/Node tool install** — Game engine — a desktop download/install, not a skill; no local copy; not_audited | C |
| Graphite | `GraphiteEditor/Graphite` | NOT ADDED | **needs Python/Node tool install** — Rust 2D app — needs build/install from source or release binary; no local copy; not_audited | Infra |
| GSAP | `greensock/GSAP` | NOT ADDED | **needs Python/Node tool install** — JS animation library; needs one npm install — not in package.json (only 'motion' is), no local copy; not_audited | Infra |
| HandBrake | `HandBrake/HandBrake` | NOT ADDED | **needs Python/Node tool install** — Desktop transcoder — a download/install, not a skill; no local copy; not_audited | Infra |
| DeepTutor | `HKUDS/DeepTutor` | NOT ADDED | **needs Python/Node tool install** — AI learning workspace app; needs Python/Node install + LLM API key; no local copy; not_audited | B |
| every-joule-lesson1 | `iamtechartist/every-joule-lesson1` | STAGED ONLY | **gitignored by design** — local_reference resources/concordia/video-motion/every-joule-lesson1, path does not exist in this clone; resources/.gitignore: concordia/*; only a guide copy survives in graph-corpus/resources/concordia/guides/ | B |
| line-art-animation | `JDhruv14/line-art-animation` | NOT ADDED | **needs Claude Code skill install** — Claude skill + TS library; no local copy, never installed into ~/.claude/skills/; not_audited | C |
| anime | `juliangarnier/anime` | NOT ADDED | **needs Python/Node tool install** — JS animation engine; needs npm install — not in package.json, no local copy; not_audited | Infra |
| rea-video | `JuneYaooo/rea-video` | STAGED ONLY | **gitignored by design** — Quarantine copy on his PC (resources/repo-quarantine/, gitignored); only README.md in graph-corpus; triage warns its ChatCut section tells the agent to curl|sh a paid app with a referral tag — must not be followed; not_audited | C |
| kdenlive | `KDE/kdenlive` | NOT ADDED | **needs Python/Node tool install** — Desktop editor — a download/install, not a skill; no local copy; not_audited | Infra |
| konva | `konvajs/konva` | NOT ADDED | **needs Python/Node tool install** — Canvas framework; needs npm install — not in package.json, no local copy; not_audited | Infra |
| brag | `latent-spaces/brag` | NOT ADDED | **needs Claude Code skill install** — Claude skill (launch-video generator); no local copy, never installed into ~/.claude/skills/; not_audited | C |
| manim | `ManimCommunity/manim` | NOT ADDED | **needs Python/Node tool install** — Python framework; needs pip + ffmpeg + LaTeX install; no local copy; not_audited | B |
| mengto/skills | `mengto/skills` | NOT ADDED | **needs Claude Code skill install** — Curated Claude skills (dream-loop, Hairline…); no local copy, never installed into ~/.claude/skills/; not_audited | C |
| ThreeRT | `meshy-dev/ThreeRT` | NOT ADDED | **needs GPU (Nvidia CUDA)** — Hardware ray-traced three.js — needs an RTX/NVIDIA GPU for real-time path tracing; his PC has integrated Radeon Vega 8, no CUDA; no local copy | C |
| astryx | `meta/astryx` | STAGED ONLY | **needs Python/Node tool install** — Full clone exists only in ~/workspace/claude-9-repos/astryx (1.8 GB), not in video-repo and not wired into the Vite app; npm package @astryxdesign/core never added to package.json | Infra |
| shotcut | `mltframework/shotcut` | NOT ADDED | **needs Python/Node tool install** — Desktop editor — a download/install, not a skill; no local copy; not_audited | Infra |
| cinematic-skill | `Moh4696/cinematic-skill` | NOT ADDED | **needs Claude Code skill install** — Claude skill (90-sec narrated documentary from code); verified in Facebook reel 4350302691880930, but no local copy, never installed into ~/.claude/skills/; not_audited | C |
| mojs | `mojs/mojs` | NOT ADDED | **needs Python/Node tool install** — JS motion library; needs npm install — not in package.json, no local copy; not_audited | Infra |
| motion | `motiondivision/motion` | STAGED ONLY | **gitignored by design** — local_reference resources/concordia/motion-library, path does not exist in this clone; resources/.gitignore: concordia/*; note the npm package 'motion' IS in package.json (^12.23.24) — the library is usable, the skill snapshot (fix/improve) is not | Infra |
| three.js | `mrdoob/three.js` | NOT ADDED | **needs Python/Node tool install** — JS 3D library; needs npm install — not in package.json, no local copy; not_audited | Infra |
| openmotion | `nexu-io/openmotion` | NOT ADDED | **needs Claude Code skill install** — Agentic video generator skill; repo only named in a reel, no local copy, never installed; not_audited | C |
| obs-studio | `obsproject/obs-studio` | NOT ADDED | **needs Python/Node tool install** — Desktop recorder — a download/install, not a skill; no local copy; not_audited | Infra |
| opentoonz | `opentoonz/opentoonz` | NOT ADDED | **needs Python/Node tool install** — Desktop 2D animation app — a download/install, not a skill; no local copy; not_audited | B |
| chrome-capture | `paulirish/chrome-capture` | NOT ADDED | **needs Python/Node tool install** — CLI recorder (Chrome tab to MP4); needs npm/CLI install + Chrome; no local copy; not_audited | C |
| impeccable | `pbakaus/impeccable` | NOT ADDED | **needs Claude Code skill install** — Claude skill (design vocabulary/critique); no local copy, never installed into ~/.claude/skills/; not_audited | Infra |
| pixijs | `pixijs/pixijs` | NOT ADDED | **needs Python/Node tool install** — WebGL renderer; needs npm install — not in package.json, no local copy; not_audited | Infra |
| remotion | `remotion-dev/remotion` | PARTIAL | **needs Claude Code skill install** — Remotion Claude skills are 'ready' on his PC (MASTER-ROUTER §2: remotion:*) and video-projects/creator-style-explainer/package.json has @remotion/* 4.0.545, but the remotion repo itself is not cloned and remotion is not in the root package.json — usable on PC, not implemented in this repo | B |
| sand3d | `Sandflow-ai/sand3d` | NOT ADDED | **needs Python/Node tool install** — Python 3D library for LLMs; needs pip install + LLM; no local copy; not_audited | C |
| raea | `shinyobjectz/raea` | NOT ADDED | **needs Python/Node tool install** — Rust/Bevy/Dioxus creative engine; needs cargo build + install; no local copy; not_audited | C |
| filmcraft | `storytold/filmcraft` | NOT ADDED | **needs Python/Node tool install** — Rust NLE written from scratch; needs cargo build; no local copy; not_audited | C |
| motionmaxxing | `Tejashmakwana/motionmaxxing` | STAGED ONLY | **gitignored by design** — local_reference resources/concordia/video-motion/motionmaxxing, path does not exist in this clone; resources/.gitignore: concordia/*; 1 skill row points at the missing path | C |
| tween.js | `tweenjs/tween.js` | NOT ADDED | **needs Python/Node tool install** — JS tweening engine; needs npm install — not in package.json, no local copy; not_audited | Infra |
| claude-video-effects | `Vibha-Ramprakash/claude-video-effects` | STAGED ONLY | **gitignored by design** — local_reference resources/concordia/video-motion/claude-video-effects, path does not exist in this clone; resources/.gitignore: concordia/*; the 'effects' skill itself is already ready on his PC (MASTER-ROUTER §2) — the snapshot is staged, the skill is usable there, not in this repo | C |
| video.js | `videojs/video.js` | NOT ADDED | **needs Python/Node tool install** — HTML video player framework; needs npm install — not in package.json, no local copy; not_audited | Infra |
| anything2explainer | `Vincentwei1021/anything2explainer` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus/resources/motion-systems/anything2explainer/; full source gitignored (resources/.gitignore: motion-systems/); scanner status incomplete; needs Remotion to render; not_audited | B |
| Kap | `wulkano/Kap` | NOT ADDED | **needs another platform** — macOS-only screen recorder (Swift) — will not run on his Windows PC; no local copy; not_audited | Infra |
| SkillSpector | `NVIDIA/SkillSpector` | PARTIAL | **security gate not passed** — Scanner 2.12.0 IS installed in WSL (AUDIT-STATUS.md: resources/skillspector-venv + skillspector-source, both gitignored) and 19 motion folders were scanned (10 completed, 9 incomplete/OOM), but it is a scanner, not a video skill; its '0 issues SAFE' stamp in docs/skillspector-results.json is a fallback when the binary is missing; no independent audit verdict | Infra |

Non-video, excluded from this table (5): 666ghj/MiroFish (gated, comment 'CROWD' via DM), deepseek-ai/deepseek-harness (gated, comment 'HARNESS' via DM — AI harness, not video), openqodex/openqodex (AI code reviewer), tokio-rs/topcoat (Rust web framework), xai-org/grok-build (gated, comment 'GROK' via DM — Grok setup, not video).

## 2. Website — all 35 skills in `master-video-styles/data/skills.json`

| Name | Repo / skill | Status | Why not implemented (reason + evidence) | Bucket |
|---|---|---|---|---|
| Remotion skills | `Claude skills remotion:*` | PARTIAL | **needs Claude Code skill install** — Ready on his PC per MASTER-ROUTER §2 (remotion:* Claude skill) and used in video-projects/creator-style-explainer; no SKILL.md in this repo — the skill lives in Claude Code on his PC, not in ys-sites/video | C |
| captions-skill | `captions-skill/` | PARTIAL | **gitignored by design** — Root .gitignore lists captions-skill/ — the clone lives on his PC only (docs/caption-skill-setup.md: cloned from Vibha-Ramprakash/claude-caption-styles, npm install run, faster-whisper model cached); setup verified on a synthetic clip, no user video rendered yet | C |
| effects | `Claude skill effects` | PARTIAL | **needs Claude Code skill install** — Ready on his PC per MASTER-ROUTER §2 (45 face-tracked effects); snapshot path resources/concordia/video-motion/claude-video-effects does not exist in this clone (gitignored) | C |
| talking-head-reels | `talking-head-reels/` | STAGED ONLY | **gitignored by design** — Zip talking-head-reels.zip (704 KB) is tracked in the repo but NEVER extracted — root .gitignore lists talking-head-reels/; scripts + references are inside the zip only; docs/local-first-reel-workflows.md is the only live route | C |
| DaVinci Resolve MCP | `resources/concordia/video-motion/davinci-resolve-mcp` | STAGED ONLY | **gitignored by design** — Snapshot in local-snapshots.json (hiteshk03/davinci-resolve-mcp) but path does not exist in this clone; resources/.gitignore: concordia/*; also needs DaVinci Resolve installed + MCP wiring | C |
| HyperFrames (local skills) | `resources/concordia/video-motion/openmontage` | STAGED ONLY | **gitignored by design** — Points at the OpenMontage snapshot, which does not exist in this clone (gitignored concordia/*); hosted HyperFrames MCP is the paid route | C |
| motionmaxxing | `resources/concordia/video-motion/motionmaxxing` | STAGED ONLY | **gitignored by design** — Snapshot path does not exist in this clone; resources/.gitignore: concordia/* (see catalog entry) | C |
| motion-video-director | `resources/concordia/motion-video-director` | STAGED ONLY | **gitignored by design** — 1 skill row in skill-index.json points at resources/concordia/motion-video-director/skills/motion-video-director/SKILL.md, which does not exist in this clone; resources/.gitignore: concordia/* | C |
| Anidoodle | `resources/motion-systems/anidoodle` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus/resources/motion-systems/anidoodle/; full source gitignored (resources/.gitignore: motion-systems/); SkillSpector status incomplete | C |
| Bang Motion | `resources/motion-systems/bang-motion` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector retry: DO_NOT_INSTALL | C |
| Hand-drawn and whiteboard | `resources/motion-systems/handdraw-skill, hand-drawn-explainer` | STAGED ONLY | **gitignored by design** — SKILL.md copies only in graph-corpus; full source gitignored; SkillSpector: handdraw-skill DO_NOT_INSTALL, hand-drawn-explainer DO_NOT_INSTALL (retry, scanner_incomplete) | B |
| Manim | `resources/motion-systems/manim-skill` | STAGED ONLY | **gitignored by design** — SKILL.md copies only in graph-corpus; full source gitignored; SkillSpector: manim-composer SAFE, manimce-best-practices SAFE, manimgl-best-practices DO_NOT_INSTALL, motion-design CAUTION — the SAFE sub-skills are the closest to usable; still needs pip install of Manim itself | B |
| Lemo-Opuscar, Paint MV, Huashu | `resources/concordia/video-motion/lemo-opuscar, resources/motion-systems` | STAGED ONLY | **needs Claude Code skill install** — Full lemo-opuscar clone exists only in ~/workspace/claude-9-repos/lemo-opuscar (358 MB, 99 film styles) — never installed as a Claude Code skill and not in this repo; paint-mv SKILL.md copies in graph-corpus, scanner: paint-mv DO_NOT_INSTALL, animate CAUTION, render/storyboard SAFE | C |
| GSAP, Three.js, p5.js, Theatre.js | `resources/concordia/video-motion/openmontage, p5.js, theatre` | NOT ADDED | **needs Python/Node tool install** — Snapshot paths (p5.js, theatre, etc.) do not exist in this clone (gitignored concordia/*); none of GSAP/three/p5/theatre is in package.json — each needs an npm install; not_audited | Infra |
| anatomy | `Claude skill anatomy` | PARTIAL | **needs Claude Code skill install** — Ready on his PC per MASTER-ROUTER §2 (anatomy Claude skill); no SKILL.md in this repo | B |
| OmniVoice | `C:\Users\Sharafath\AI-Local\OmniVoice` | PARTIAL | **needs manual setup step** — On his PC at C:\Users\Sharafath\AI-Local\OmniVoice; MASTER-ROUTER: 'Setup script ready; run setup-tier1.ps1 -Tool omnivoice' — the setup step was never run; CPU TTS/voice cloning, consent-only voices | C |
| Piper TTS | `resources/concordia/video-motion/piper` | STAGED ONLY | **gitignored by design** — Snapshot in local-snapshots.json (rhasspy/piper) but path does not exist in this clone; resources/.gitignore: concordia/*; needs Python install | C |
| VoiceStudio, Coqui TTS | `resources/concordia/video-motion/voicestudio, coqui-tts` | STAGED ONLY | **gitignored by design** — Snapshots in local-snapshots.json but paths do not exist in this clone; resources/.gitignore: concordia/*; need Python venvs + model downloads | C |
| Whisper (+ whisper.cpp, WhisperX) | `captions-skill venv; whisper.cpp and WhisperX in resources/concordia/video-motion` | PARTIAL | **needs Python/Node tool install** — Word timings work through the captions-skill venv on his PC (faster-whisper base model cached); whisper.cpp / WhisperX snapshot paths do not exist in this clone (gitignored concordia/*) | C |
| fish audio | `MCP connector` | PARTIAL | **needs API key / paid credits** — MCP connector listed ready in MASTER-ROUTER §2, but it is paid credits — fallback only, replaces ElevenLabs; no free route in this repo | C |
| ElevenLabs, Azure, Doubao, DashScope skills | `resources/concordia/video-motion/openmontage` | NOT ADDED | **needs API key / paid credits** — Cloud voice APIs — need paid API keys/credits; their skill files live inside the missing OpenMontage snapshot (gitignored) | C |
| Code-synth soundtrack | `resources/motion-systems/javascript-animation-skills (soundtrack); video-projects/creator-style-explainer/scripts/make_music.py` | STAGED ONLY | **gitignored by design** — soundtrack SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector: DO_NOT_INSTALL; the make_music.py path named in skills.json was not found in this clone (video-projects/ only has creator-style-explainer with no scripts/ dir) | C |
| AudioCraft / MusicGen | `resources/concordia/video-motion/audiocraft` | STAGED ONLY | **gitignored by design** — Snapshot in local-snapshots.json (facebookresearch/audiocraft) but path does not exist in this clone; resources/.gitignore: concordia/*; small model can run on CPU slowly, needs Python + model download | C |
| ACE-Step 1.5 | `resources/concordia/video-motion/openmontage (acestep)` | STAGED ONLY | **needs GPU (Nvidia CUDA)** — Skill file lives inside the missing OpenMontage snapshot (gitignored); ACE-Step is heavy for this PC (MASTER-ROUTER: 'heavy for this PC') — needs a GPU / cloud GPU | C |
| media-use | `resources/concordia/video-motion/openmontage (media-use)` | STAGED ONLY | **gitignored by design** — Skill file lives inside the missing OpenMontage snapshot (gitignored concordia/*) | C |
| ElevenLabs music and SFX, Lyria | `resources/concordia/video-motion/openmontage` | NOT ADDED | **needs API key / paid credits** — Cloud music/SFX — need paid API keys/credits; skill files inside the missing OpenMontage snapshot | C |
| ComfyUI + LTX-Video 2B / Wan 2.1 1.3B | `C:\Users\Sharafath\AI-Local\ComfyUI` | PARTIAL | **needs manual setup step** — Installed on his PC 2026-11-19 with LTX-Video 2B + Wan 1.3B models downloaded and sha256-verified (MASTER-ROUTER §2), but 'first render untested' — the one remaining step is a test render; 15–60 min per short clip on CPU | C |
| Claude Drawing | `resources/motion-systems/claude-drawing-skill` | STAGED ONLY | **gitignored by design** — README only in graph-corpus/resources/motion-systems/claude-drawing-skill/ (no SKILL.md tracked); full source gitignored; SkillSpector status incomplete | C |
| UGC Factory prompt styles | `resources/concordia/video-motion/ugc-factory` | STAGED ONLY | **gitignored by design** — Snapshot path does not exist in this clone; resources/.gitignore: concordia/*; 15 prompt styles, most call paid Seedance | A |
| Seedance, Kling, MiniMax H3, Grok, FLUX, Atlas Cloud | `resources/concordia/video-motion/openmontage, MiniMax-H3` | NOT ADDED | **needs API key / paid credits** — Cloud video/image models — need paid API keys/credits; skill files inside the missing OpenMontage / MiniMax-H3 snapshots (gitignored) | C |
| Genjutsu character swap | `resources/repo-quarantine/sirioberati` | STAGED ONLY | **needs API key / paid credits** — Triaged, not approved (quarantine-triage-20261119.md): needs paid ENHANCOR_API_KEY + REPLICATE_API_TOKEN, WSL2, and the catbox upload fallback must be turned off; uploads clips to public hosts by default | C |
| REA MCP | `MCP connector` | PARTIAL | **needs manual setup step** — MCP connector listed ready in MASTER-ROUTER §2, but the rea-skill file in this repo does not register it — the MCP still needs wiring into Claude Code; see implemented rea-skill note | Infra |
| rea-video | `resources/repo-quarantine/JuneYaooo/rea-video` | STAGED ONLY | **gitignored by design** — Quarantine copy on his PC (gitignored repo-quarantine/); only README.md in graph-corpus; triage: do NOT follow its ChatCut curl|sh install instruction; not_audited — this is NOT the implemented resources/visually-research/rea-skill | C |
| 136-reel creator study | `skills/creator-video/references/real-estate-creator-study.md` | IMPLEMENTED | — already implemented — | A |
| website-to-video, playwright-recording | `resources/concordia/video-motion/openmontage` | STAGED ONLY | **gitignored by design** — Skill files live inside the missing OpenMontage snapshot (gitignored concordia/*) | C |

## 3. Skill index — `resources/repo-catalog/skill-index.json`, 178 rows / 126 distinct names, grouped by parent (10 groups)

| Name | Repo / skill | Status | Why not implemented (reason + evidence) | Bucket |
|---|---|---|---|---|
| OpenMontage — 139 rows | `resources/concordia/video-motion/openmontage/.agents/skills/* + .claude/skills/* (139 rows, ~100 distinct names)` | STAGED ONLY | **gitignored by design** — All 139 rows point at resources/concordia/video-motion/openmontage, which does not exist in this clone (resources/.gitignore: concordia/*); status in skill-index.json is unreviewed_reference for every row; the .agents/ and .claude/ copies are duplicates of each other. Many of these skills are also paid-API wrappers (ElevenLabs, Kling, Seedance, HeyGen, Azure, Doubao, DashScope, FLUX, Grok) — a second blocker after the gitignore. | C |
| UGC-Factory — 16 rows | `resources/concordia/video-motion/ugc-factory/skill/* (16 rows: ugc-factory + 15 seedance-* styles)` | STAGED ONLY | **gitignored by design** — All 16 rows point at the missing UGC-Factory snapshot (gitignored concordia/*); unreviewed_reference; the 15 style skills mostly call paid Seedance | A |
| MiniMax-H3 — 11 rows | `resources/concordia/video-motion/MiniMax-H3/* (11 rows, incl. h3-prompt-writing x3 duplicates)` | STAGED ONLY | **gitignored by design** — All 11 rows point at the missing MiniMax-H3 snapshot (gitignored concordia/*); unreviewed_reference; h3-prompt-writing appears 3x (.agents, .claude, skills) — duplicates of one skill; MiniMax H3 is a paid cloud model | C |
| VoiceStudio — 4 rows | `resources/concordia/video-motion/voicestudio/* (fastapi-python, vite, voicestudio, voicestudio-maintainer)` | STAGED ONLY | **gitignored by design** — All 4 rows point at the missing VoiceStudio snapshot (gitignored concordia/*); unreviewed_reference; fastapi-python/vite are generic coding skills, not video | C |
| motion-library — 2 rows | `resources/concordia/motion-library/.agents/skills/fix, improve` | STAGED ONLY | **gitignored by design** — Both rows point at the missing motion-library snapshot (gitignored concordia/*); unreviewed_reference; fix/improve are generic code-review skills, not video skills | Infra |
| lemo-opuscar — 2 rows | `resources/concordia/video-motion/lemo-opuscar/plugin/skills/lemo-opuscar, tools/directory` | STAGED ONLY | **needs Claude Code skill install** — Both rows point at the missing lemo-opuscar snapshot (gitignored concordia/*); the full repo does exist as a clone in ~/workspace/claude-9-repos/lemo-opuscar (358 MB) — it was never installed as a Claude Code skill | C |
| motion-video-director — 1 row | `resources/concordia/motion-video-director/skills/motion-video-director/SKILL.md` | STAGED ONLY | **gitignored by design** — Path does not exist in this clone; resources/.gitignore: concordia/*; unreviewed_reference | C |
| claude-video-effects — 1 row | `resources/concordia/video-motion/claude-video-effects/SKILL.md (effects)` | PARTIAL | **needs Claude Code skill install** — Snapshot path does not exist in this clone (gitignored), but the 'effects' skill itself is ready on his PC per MASTER-ROUTER §2 — usable in Claude Code there, not in this repo | C |
| design-motion-principles — 1 row | `resources/concordia/video-motion/design-motion-principles/skills/design-motion-principles/SKILL.md` | STAGED ONLY | **gitignored by design** — Path does not exist in this clone; snapshot in local-snapshots.json (kylezantos/design-motion-principles), gitignored concordia/*; unreviewed_reference | C |
| motionmaxxing — 1 row | `resources/concordia/video-motion/motionmaxxing/SKILL.md` | STAGED ONLY | **gitignored by design** — Path does not exist in this clone; local_reference in repositories.json, gitignored concordia/*; unreviewed_reference | C |

Every one of the 178 rows has status `unreviewed_reference` in the JSON, and **0 of 178 paths exist in this clone** — all point under `resources/concordia/…`, which is gitignored (`concordia/*`) and contains only a README.md in this clone. The 139 OpenMontage rows are mostly the same skills repeated under `.agents/skills/`, `.claude/skills/`, and `skills/` — three copies of one parent, not 139 different skills.

## 4. Full clones elsewhere — `~/workspace/claude-9-repos/` (9) + `~/workspace/agency-repos/` (7) = 16 (5 video-related)

| Name | Repo / skill | Status | Why not implemented (reason + evidence) | Bucket |
|---|---|---|---|---|
| lemo-opuscar | `lemomo-ai/lemo-opuscar — ~/workspace/claude-9-repos/lemo-opuscar (358 MB)` | STAGED ONLY | **needs Claude Code skill install** — Full clone present (99 film styles, plugin + tools), but never installed as a Claude Code skill (no ~/.claude/skills/lemo-opuscar) and not copied into ys-sites/video; also listed in skill-index as 2 missing-path rows | C |
| SlopMonster | `~/workspace/claude-9-repos/SlopMonster (9.8 MB)` | STAGED ONLY | **needs Python/Node tool install** — Python std-lib writing checker (AI-slop detector for scripts/README) with SKILL.md; clone present, never installed as a skill and not in video-repo; tangential to video — only helps script wording | Infra |
| astryx | `meta/astryx — ~/workspace/claude-9-repos/astryx (1.8 GB)` | STAGED ONLY | **needs Python/Node tool install** — Full clone present, but the npm package @astryxdesign/core was never added to package.json and nothing in the Vite app uses it; also in catalog as meta/astryx | Infra |
| agent-skills | `addyosmani/agent-skills — ~/workspace/claude-9-repos/agent-skills (4.2 MB)` | STAGED ONLY | **needs Claude Code skill install** — Production engineering skills for coding agents (spec/plan/build/test/review/ship); clone present, never installed as Claude Code skills, not video-specific | Infra |
| everything-claude-code (WorldFlowAI) | `~/workspace/claude-9-repos/everything-claude-code (816 KB)` | STAGED ONLY | **duplicate of another entry** — Clone present, but a different origin from catalog affaan-m/everything-claude-code — same name, same purpose (whole Claude Code setup); either way it is a generic setup bundle, not a video skill, and it is not installed | Infra |

Non-video clones, excluded from this table (11): check-if-email-exists (Rust email checker), firecrawl (web scraper, 230 MB), google-maps-scraper — actually gosom (43 MB), huginn (Ruby automation agents, 22 MB — also in quarantine, needs Docker), listmonk (newsletter, 64 MB), remote-jobs (job board), twenty (CRM, 3.5 GB), Claude-Code-Game-Studios (game dev), agent-desktop (desktop agent), freellmapi (free LLM API wrapper), heretic (training-free LLM modification, needs a GPU).

## 5. Security tools — `resources/repo-catalog/security-tool-registry.json` (12)

| Name | Repo / skill | Status | Why not implemented (reason + evidence) | Bucket |
|---|---|---|---|---|
| Strix | `usestrix/strix — resources/security-tools/strix` | STAGED ONLY | **security gate not passed** — Registry says audit_status not_audited, execution_status blocked; path does not exist in this clone (resources/.gitignore: security-tools/); also needs a binary/tool install | Infra |
| Cloudflare Security Audit | `cloudflare/security-audit-skill — resources/security-tools/cloudflare-security-audit` | PARTIAL | **security gate not passed** — Source staged per registry (commit c1c8a8c) but path does not exist in this clone; the Claude plugin 1.0.4 IS installed on his PC — see catalog entry; no complete audit ever finished, so the gate still fails closed | Infra |
| Trivy | `aquasecurity/trivy — resources/security-tools/trivy` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone (gitignored security-tools/); needs binary install | Infra |
| Nuclei | `projectdiscovery/nuclei — resources/security-tools/nuclei` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone; needs binary install | Infra |
| TruffleHog | `trufflesecurity/trufflehog — resources/security-tools/trufflehog` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone; needs binary install | Infra |
| Semgrep | `semgrep/semgrep — resources/security-tools/semgrep` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone; needs pip/binary install | Infra |
| Codex Security | `openai/codex-security — resources/security-tools/codex-security` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone | Infra |
| ClamAV | `Cisco-Talos/clamav — resources/security-tools/clamav` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone; needs binary install | Infra |
| Claude Code Security Review | `anthropics/claude-code-security-review — resources/security-tools/claude-security-review` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone | Infra |
| BLA | `qybaihe/bla — resources/security-tools/bla` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone | Infra |
| PyRIT | `Azure/PyRIT — resources/security-tools/pyrit` | STAGED ONLY | **security gate not passed** — Registry: not_audited / blocked; path does not exist in this clone; needs Python install; tools/security/pyrit_redteam.py exists in-repo but is a wrapper, not the tool | Infra |
| SkillSpector | `NVIDIA/SkillSpector — resources/skillspector-source` | PARTIAL | **security gate not passed** — Installed in WSL per AUDIT-STATUS.md (SkillSpector 2.12.0, resources/skillspector-venv + skillspector-source, both gitignored) and 19 motion folders scanned — 10 completed, 9 incomplete/OOM; it is the scanner, not an approved toolchain, and its own registry entry is 'tool installed; reference not independently audited' | Infra |

## 6. Quarantine extras — `resources/repo-catalog/quarantine-triage-20261119.md` (16 in the triage table, Nov 19 — the file header says 15, Genjutsu was added later)

| Name | Repo / skill | Status | Why not implemented (reason + evidence) | Bucket |
|---|---|---|---|---|
| huginn | `huginn/huginn` | STAGED ONLY | **needs Python/Node tool install** — Quarantine copy on PC (gitignored repo-quarantine/); only README.md in graph-corpus; Ruby/Rails app — needs Docker + review of every agent that calls external services; also a clone in ~/workspace/agency-repos/huginn | Infra |
| HeyGem.ai | `suifeng9203/HeyGem.ai` | STAGED ONLY | **needs GPU (Nvidia CUDA)** — Triage: ships prebuilt ffmpeg Windows DLLs + VMAF .pkl models (unverifiable binaries); needs NVIDIA GPU + Docker; last pushed 2025-04; 'Do not run from this checkout' | C |
| OmniVoice | `k2-fsa/OmniVoice` | PARTIAL | **needs manual setup step** — On his PC at C:\Users\Sharafath\AI-Local\OmniVoice; setup script ready, never run (see website W16); triage: torch.load without weights_only in eval scripts — load weights only from the official source | C |
| ComfyUI | `Comfy-Org/ComfyUI` | PARTIAL | **needs manual setup step** — On his PC at C:\Users\Sharafath\AI-Local\ComfyUI; first render untested (see website W27); triage: no malicious indicators, custom nodes are the real risk — each needs its own review | C |
| WanGP | `deepbeepmeep/WanGP` | STAGED ONLY | **needs GPU (Nvidia CUDA)** — Triage: 'Highest-risk install surface' — prebuilt .dll/.so, torch.load(weights_only=False), 11x trust_remote_code=True, shell=True in setup.py, extra package index; AND needs NVIDIA GPU — not usable on his Radeon PC | C |
| rea-video | `JuneYaooo/rea-video` | STAGED ONLY | **gitignored by design** — Quarantine copy on PC (gitignored); only README.md in graph-corpus; triage: core tool OK to review further, but its ChatCut install instruction (curl|sh / irm|iex with a referral tag) must not be followed | C |
| Genjutsu | `sirioberati/Genjustsu-Open-Source-Workflow` | STAGED ONLY | **needs API key / paid credits** — Triaged, not approved: needs paid ENHANCOR_API_KEY + REPLICATE_API_TOKEN, WSL2, catbox fallback off; uploads clips to public hosts by default (see website W31) | C |
| LongCat-Video-Avatar | `MeiGen-AI/LongCat-Video-Avatar` | STAGED ONLY | **needs GPU (Nvidia CUDA)** — Triage: project homepage, 247 MB of media, NO license declared — no reuse rights by default; needs a large NVIDIA GPU | C |
| inference-optimisation-skill | `sybil-solutions/inference-optimisation-skill` | STAGED ONLY | **needs GPU (Nvidia CUDA)** — Triage: nothing flagged, low risk — but 'not relevant without a GPU'; reviewed, not installed (MASTER-ROUTER §2) | Infra |
| lastbook | `Immortal-Protocols/lastbook` | NOT ADDED | **dead / 404 / gated repo** — DELETED 2026-11-19 at Mohamed's request (MASTER-ROUTER §6) — offline survival-knowledge app, no video or website use; no longer present anywhere | Non-video |
| open-higgsfield-ai | `sunnychase/open-higgsfield-ai` | STAGED ONLY | **needs API key / paid credits** — Triage: web front end for the paid muapi.ai API — prompts/media go to api.muapi.ai, not local or free; no license declared | C |
| Open-Generative-AI | `Anil-matcha/Open-Generative-AI` | STAGED ONLY | **needs API key / paid credits** — Triage: same paid muapi.ai dependency; three git submodules from other repos not fetched or reviewed | C |
| freefield | `neuregex/freefield` | STAGED ONLY | **needs GPU (Nvidia CUDA)** — Triage: nothing flagged, but it is a ComfyUI app pack (120 apps) — inherits ComfyUI/custom-node risk and needs NVIDIA GPU; MASTER-ROUTER: 'Reviewed, not yet loaded into ComfyUI' | C |
| Open-Sora | `hpcaitech/Open-Sora` | STAGED ONLY | **needs GPU (Nvidia CUDA)** — Triage: Gradio demo pip-installs packages at runtime with shell=True; 'Data-centre GPUs required; don't run the Gradio app' | C |
| HunyuanVideo | `Tencent-Hunyuan/HunyuanVideo` | STAGED ONLY | **needs GPU (Nvidia CUDA)** — Triage: no malicious indicators, but licence has territory/usage limits — read before commercial use; needs a large NVIDIA GPU | C |
| LTX-Video | `Lightricks/LTX-Video` | PARTIAL | **needs manual setup step** — Model downloaded on his PC (LTX-Video 2B distilled fp8, sha256-verified) inside ComfyUI, but first render untested (see website W27); triage: load weights only from Lightricks' official Hugging Face repo | C |

All 15 were staged in `resources/repo-quarantine/` (gitignored) and remain BLOCKED by `tools/security_gate.py`. Triage is a static read-only scan, not a full audit — SkillSpector, dependency (OSV) and malware-signature scans were not run on these. Several overlap §2 (OmniVoice, ComfyUI, LTX-Video, Genjutsu, rea-video) — counted once per section, noted in the evidence.

## 7. Motion systems — `resources/repo-catalog/motion-system-triage.json` (14 folders)

| Name | Repo / skill | Status | Why not implemented (reason + evidence) | Bucket |
|---|---|---|---|---|
| Anidoodle | `anidoodle` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus/resources/motion-systems/anidoodle/; full source gitignored (resources/.gitignore: motion-systems/); SkillSpector status incomplete; 1,685 files scanned in triage, 170 credential/secret-access signals (needs source-level review, not a verdict) | C |
| anything2explainer | `anything2explainer` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector status incomplete (see catalog entry) | B |
| Bang Motion | `bang-motion` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector retry: DO_NOT_INSTALL | C |
| claude-animation-base | `claude-animation-base` | STAGED ONLY | **gitignored by design** — README only in graph-corpus (no SKILL.md tracked); full source gitignored; only 12 files in triage scan | C |
| claude-drawing-skill | `claude-drawing-skill` | STAGED ONLY | **gitignored by design** — README only in graph-corpus (no SKILL.md tracked); full source gitignored; SkillSpector status incomplete | C |
| claude-motion-styles | `claude-motion-styles` | STAGED ONLY | **gitignored by design** — README only in graph-corpus (no SKILL.md tracked); full source gitignored; only 1 file in triage scan — almost certainly a stub/empty checkout | C |
| hand-drawn-explainer | `hand-drawn-explainer` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector retry: DO_NOT_INSTALL (scanner_incomplete) | B |
| handdraw-skill | `handdraw-skill` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector: DO_NOT_INSTALL | B |
| huashu-art-motion | `huashu-art-motion` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector status incomplete | C |
| javascript-animation-skills | `javascript-animation-skills` | STAGED ONLY | **gitignored by design** — SKILL.md copies only in graph-corpus (javascript-animation + soundtrack); full source gitignored; SkillSpector: DO_NOT_INSTALL for both sub-skills | C |
| manim-skill | `manim-skill` | STAGED ONLY | **gitignored by design** — SKILL.md copies only in graph-corpus; full source gitignored; SkillSpector: manim-composer SAFE, manimce-best-practices SAFE, manimgl-best-practices DO_NOT_INSTALL, motion-design CAUTION — the two SAFE sub-skills are the closest to usable in this whole section, still need Manim pip-installed | B |
| motion-design-skill | `motion-design-skill` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector: CAUTION | C |
| motion-skill | `motion-skill` | STAGED ONLY | **gitignored by design** — SKILL.md copy only in graph-corpus; full source gitignored; SkillSpector retry: DO_NOT_INSTALL | C |
| paint-mv-skills | `paint-mv-skills` | STAGED ONLY | **gitignored by design** — SKILL.md copies only in graph-corpus (paint-mv, animate, render, storyboard); full source gitignored; SkillSpector: paint-mv DO_NOT_INSTALL, animate CAUTION, render SAFE, storyboard SAFE | C |

These are the 14 folders under `resources/motion-systems/` (gitignored). Only a README.md + SKILL.md copy of each survives in `graph-corpus/resources/motion-systems/` — the full source is on his PC only. SkillSpector verdicts are scanner leads, not safety verdicts (AUDIT-STATUS.md): DO_NOT_INSTALL appears for handdraw, javascript-animation, bang-motion, motion-skill, paint-mv, manimgl; SAFE only for manim-composer, manimce-best-practices, paint-mv-render, paint-mv-storyboard.

## 8. Implemented — the 4 skills that ARE in this repo (for the full picture)

| Name | Repo / skill | Status | Why not implemented (reason + evidence) | Bucket |
|---|---|---|---|---|
| creator-video | `skills/creator-video/SKILL.md` | IMPLEMENTED | — already implemented — | A |
| study-video | `skills/study-video/SKILL.md` | IMPLEMENTED | — already implemented — | B |
| hyliox-pixel-perfect | `skills/hyliox-pixel-perfect/SKILL.md` | IMPLEMENTED | — already implemented — | C |
| rea-skill | `resources/visually-research/rea-skill/SKILL.md` | IMPLEMENTED | — already implemented — | Infra |

## Easiest wins — not-implemented items closest to installable

1. **GSAP / anime / tween.js / konva / pixijs / three.js / lottie-web (npm libraries)** — one `npm install` each into the Vite app, no GPU, no key, no skill install. GSAP is the single easiest: it is a plain JS library, the repo already uses the `motion` npm package, and the only blocker is the `not_audited` catalog flag. Do the Antigravity audit on these first; they are the lowest-risk installs in the whole file.
2. **Manim sub-skills `manim-composer` + `manimce-best-practices` (motion-systems §7)** — the only two sub-skills SkillSpector marked SAFE, with SKILL.md copies already in `graph-corpus/`. Remaining work: copy the skill into `~/.claude/skills/`, `pip install manim`, and run the security gate. Directly serves bucket B (ENGR 213 / MIAE 221 lesson animations).
3. **ComfyUI + LTX-Video 2B / Wan 1.3B (§2 W27 / §6)** — already installed on his PC with models downloaded and sha256-verified. The only missing step is a first test render (15–60 min per short clip on CPU). If that works, local text/image-to-video is real without spending anything.
4. **captions-skill (§2 W02) + Whisper (§2 W19)** — already cloned on his PC, npm install done, faster-whisper base model cached, setup verified on a synthetic clip with check frames at 1.5 s / 4 s / 8 s. Remaining work: un-ignore it (or copy the skill in), point it at a real video, and get his approval on the three check frames. This is the pop-sticker caption workflow he already asked for.
5. **OmniVoice (§2 W16 / §6)** — on his PC at `C:\Users\Sharafath\AI-Local\OmniVoice` with a setup script ready (`setup-tier1.ps1 -Tool omnivoice`). One command away from local CPU voice cloning/narration — consent-only voices. (Cloudflare security-audit-skill is the same shape — plugin installed, one OAuth + restart away — but it only unlocks audits, not videos, so it ranks below these five for video work.)

## What would NOT help, however much is pulled

- **Pulling more repos.** 62 catalogued + 178 indexed + 16 cloned and only 4 are implemented — the bottleneck was never discovery, it is install + audit + wiring. Every new pull adds another `not_audited` row.
- **The GPU-heavy quarantine stack on this PC** (WanGP, HunyuanVideo, Open-Sora, HeyGem, LongCat, ACE-Step, freefield): they need 8–24 GB VRAM NVIDIA cards; his Radeon Vega 8 cannot run them. The honest route is a rented cloud GPU (~$0.11/hr for an RTX 4060 Ti 16GB on Vast.ai, ~$0.34/hr for a 4090 on RunPod Community) or skipping them.
- **The paid-API skills** (Seedance, Kling, MiniMax H3, ElevenLabs, HeyGen, Higgsfield/Genjutsu, fish audio, Lyria): no install step fixes a missing API key or credits — each needs a paid account decision first.

## Verification

- Row counts checked against the JSON sources before writing: catalog 57 video rows (+ 5 non-video in one line = 62), website 35 = 35, skill-index 10 groups covering 178 rows, clones 5 video (+ 11 non-video = 16), security 12 = 12, quarantine 16 (triage table has 16 rows; its header says 15), motion-systems 14 = 14, implemented 4 = 4.
- Path existence was checked with `(base / path).exists()` for every `local_reference`, `local-snapshots.json` (28 paths — all missing), `skill-index.json` (178 paths — all missing), and `security-tool-registry.json` (12 paths — all missing) path in this clone at HEAD `dcf85be`; `git ls-files` confirms only `resources/concordia/README.md` is tracked under `resources/concordia/`, and `resources/.gitignore` confirms `concordia/*`, `motion-systems/`, `repo-quarantine/`, `security-tools/`, `skillspector-source/`, `skillspector-venv/` are gitignored by design. `~/.claude/skills/` does not exist in this VM — Claude Code skill installs live on his Windows PC, not here.
- No GitHub fetching was needed: every reason above comes from a local file (repositories.json, skill-index.json, skills.json, local-snapshots.json, security-tool-registry.json, quarantine-triage-20261119.md, motion-system-triage.json, motion-skillspector-summary/retry.json, AUDIT-STATUS.md, docs/MASTER-ROUTER.md, docs/caption-skill-setup.md, .gitignore, resources/.gitignore, package.json).

---

# APPENDIX C — Per-video Facebook pull (153 rows, Nov 23, 2026)

# Facebook Per-Video Repo Pull — Nov 23, 2026

**Source:** signed-in Facebook browser scan (browser-task b48484b8), same session Mohamed signed in to himself as Leo Das. Each video's full caption / reel was opened individually. **No repo URL below is guessed:** where a reel states no GitHub URL it says NO REPO STATED.
**Dates** are Facebook relative dates; approx. calendar dates inferred from today, Mon Nov 23, 2026: a week ago ≈ Nov 16, 6 days ≈ Nov 17, 5 days ≈ Nov 18, 4 days ≈ Nov 19, 3 days ≈ Nov 20, 2 days ≈ Nov 21, a day ago ≈ Nov 22. Stars/forks are as stated in that caption/video, not re-checked live on GitHub.
**Buckets:** (A) real-estate content-creator video style, (B) Concordia lesson video generation, (C) cinema / cinematography / video generation / image generation, (infra) pipeline/registry, (none) other dev tool. Bucket is as assigned in the scan report; notes after the bucket letter are the report's own qualifiers (e.g. "closest to (B)").

## Totals

- **152 video rows pulled:** Nadeem Khan 90, GithubSignals 18 (+ Hypit re-confirmed as its own row = 19 opened of 28), Repo Radar AI 21, FondPeace Crazy 22, Hypit 1.
- **139 rows state a GitHub repo, 13 state NO REPO STATED.**
- **Buckets:** (none) 95, (C) 46, (A/C) 3, (A) 3, (C/A) 2, (infra) 3. Video-benefiting (A/B/C) rows: 54, covering 40 distinct repos.
- **No (A) real-estate video and no (B) Concordia lesson video** was found in any account in the window scanned. Closest to (B): GithubSignals Motion Educator (educational films, storyboard first). Closest to (A): Hypit, GTA 6 Clip Automation / gtavi-claudecode, FondPeace GTA 6 Clipping Business, Postiz, and Nadeem's Instagram-agent skill.

## Count reconciliation — read before trusting the section headers

- **Nadeem Khan — header in the scan report says "76 of 78", but 90 rows are listed.** The 90 reconcile exactly: 76 unique Videos-list entries + 9 repeat/duplicate-post rows (Cinematic Skill duplicate post, MiniMind repeat, Underdog Woof repeat, TTS voting arena repeat, talking-head / claude-video-effects repeat, IT-Tools repeat, Cobalt repeat, Awesome Mac repeat, faceless YouTube channel — same Stickman repo, different reel) + 5 Nov 22 timeline rows without reel IDs (NectarLink, OpenReel Video, Streambert, Ghost Downloader 3, Leonida). The 2 unpulled Videos entries are in Remaining Unopened below (MiniMind, "Nadeem Khan's Video"). This file records all 90 rows as listed.
- **Repo Radar AI — header says "ALL 22 Videos entries pulled, 21 unique repos", but 21 rows are listed.** PhoneBox is the same reel in Most Popular and in the list, so it was counted twice in the header (22 entries) but appears once in the report text (21 rows, 21 unique repos). This file records the 21 rows as listed.
- **GithubSignals — 19 of 28 opened:** 18 rows listed here + Hypit (listed as its own row in §5, re-confirmed). 10 entries unopened — see Remaining Unopened. Known-list items skillshare, ClawHub, motionmaxxing, eian-riso-broll, Openjutsu, Open 3D Skills, klad were NOT found under those names in the opened reels — do not treat them as re-verified.
- **FondPeace Crazy — all 22 Videos entries pulled.** Stars/forks are as stated in FondPeace captions.

## Key corrections vs v1

- **gtavi-claudecode is NOT dead.** GithubSignals' reel (reel 2559828137849774, 3 days ago ≈ Nov 20) shows https://github.com/bodila51/gtavi-claudecode rendering as a live GitHub page, MIT. v1 listed it as DEAD 404 — that verdict is superseded; see the v3 correction in the Antigravity file. FondPeace's GTA 6 Clipping video names the same gtavi-claudecode plugin but states NO GitHub URL in its caption (only fondpeace.com).
- **Two different "cinematic skills" repos:** Moh4696/cinematic-skill and AustinZ21/cinematic-skills — not the same repo.
- **Two different HyperFrames repos:** heygen-com/hyperframes (the AI video engine) and saranambiar/hyperframes-video-agent-skills (the agent skill). Do not confuse either with OpenMontage's internal "HyperFrames" GSAP motion system already in the ys-sites/video skill index.
- **No repo was confirmed dead/404** by opening GitHub in this session.

## 1. Nadeem Khan — @hexnadeem — https://www.facebook.com/hexnadeem/videos — 90 rows

| # | Date (approx) | Video | Reel URL | GitHub repo (exactly as stated) | What it does | Bucket |
|---|---|---|---|---|---|---|
| 1 | Nov 23, ≈12:00 AM, reel via https://www.facebook.com/hexnadeem/videos | LocalCode | https://www.facebook.com/hexnadeem/videos | https://github.com/mjwsolo/localcode | agentic software development on Apple Silicon Mac, local models, speculative drafting | none |
| 2 | Nov 22, 10:55 PM, 0:19 | NectarLink | — (no reel ID captured; timeline post) | https://github.com/thtbee/nectarlink | Android–Windows/Linux phone bridge, notifications/clipboard/calls, file transfer, screen mirroring, E2E encrypted, zero cloud | none |
| 3 | Nov 22, 12:44 PM | OpenReel Video | — (no reel ID captured; timeline post) | https://github.com/Augani/openreel-video | 100% client-side video editor, WebGPU/WebCodecs, multi-track, keyframes, audio, colour grading, 4K | C |
| 4 | Nov 22, 12:10 PM, 0:17 | Streambert | — (no reel ID captured; timeline post) | https://github.com/truelockmc/streambert | stream/download movies, TV, anime, ad-free, subtitles, TMDB, offline | none |
| 5 | Nov 22, 11:30 AM, 0:19 | Ghost Downloader 3 | — (no reel ID captured; timeline post) | https://github.com/xiaoyouchr/ghost-downloader-3 | multi-protocol downloader, Torrents/HTTP/FTP/M3U8, multithread chunking, real-browser TLS fingerprints | none |
| 6 | Nov 22, 10:39 AM | Leonida | — (no reel ID captured; timeline post) | https://github.com/ItsNotRexed/Leonida | Xbox Series static recompilation to Windows, RDNA2 shaders to Vulkan SPIR-V, zero emulation | none |
| 7 | Nov 22, 14h ago, reel 1925870991509212 | OpenComputer | https://www.facebook.com/reel/1925870991509212 | https://github.com/diggerhq/opencomputer | agentic local AI desktop, macOS/Windows, local data, privacy-first | none |
| 8 | Nov 22, a day ago, reel 1132266229439595 | Codync | https://www.facebook.com/reel/1132266229439595 | https://github.com/leepokai/Codync | stop waiting at terminal for AI coding agents; parallel agents, unified timeline, notifications | none |
| 9 | Nov 22, a day ago, reel 29199039866424262 | Free Claude Code | https://www.facebook.com/reel/29199039866424262 | https://github.com/alishahryar1/free-claude-code | routes 12 coding harnesses to 60+ providers, 1.3B+ free tokens/month | none |
| 10 | Nov 22, a day ago, reel 2183604603038122 | OpenVINO | https://www.facebook.com/reel/2183604603038122 | https://github.com/openvinotoolkit/openvino | Intel deep-learning toolkit | none |
| 11 | Nov 22, a day ago, reel 1556223443011014 | App Store Compliance | https://www.facebook.com/reel/1556223443011014 | https://github.com/mjmirza/app-store-compliance | pre-submission scanner for 117 app rejection patterns | none |
| 12 | Nov 22, a day ago, reel 1696591435424815 | Inkling 2 Mini | https://www.facebook.com/reel/1696591435424815 | NO REPO STATED | only https://huggingface.co/thinkingmachines/Inkling-2-Mini — Thinking Machines open-weights multimodal model, 79.2% SWE-bench, 3.4B active / 26.4B total | none |
| 13 | Nov 22, a day ago, reel 1116502881255024 | tiny-voca | https://www.facebook.com/reel/1116502881255024 | https://github.com/n4ze3m/tiny-voca | 4.5M-param TTS, 18MB, 70x real-time | none — audio |
| 14 | Nov 22, a day ago, reel 1164984986000120 | Training 3D generative models | https://www.facebook.com/reel/1164984986000120 | NO REPO STATED | only https://huggingface.co/datasets/scenario-labs/3d-collection — Scenario 3D Collection, 39GB, 1,342 assets, CC BY 4.0 | C — 3D dataset |
| 15 | Nov 22, a day ago, reel 888011681035676 | indic-speak | https://www.facebook.com/reel/888011681035676 | NO REPO STATED | only https://huggingface.co/bodhan-ai/indic-speak — TTS, 22 Indian languages | none — audio |
| 16 | Nov 22, a day ago, reel 1461372758658583 | Cap | https://www.facebook.com/reel/1461372758658583 | https://github.com/CapSoftware/Cap | open-source screen recording / async video platform, Rust/Next.js, Studio Mode, AI captions | C — video recording |
| 17 | Nov 22, a day ago, reel 1028289063637775 | Agents Video Editing Skills | https://www.facebook.com/reel/1028289063637775 | https://github.com/iamaanahmad/agents-video-editing-skills | video-editing skills for coding agents, trim/format/caption/verify, 9:16, -14 LUFS | C |
| 18 | Nov 22, a day ago, reel 1688903589581573 | iArt AI Motion Skills | https://www.facebook.com/reel/1688903589581573 | https://github.com/dqfront/iart-ai-motion-skills | 56 skills, 19 packs, kinetic typography/charts/3D web, frame-accurate easing | C |
| 19 | Nov 22, a day ago, reel 1706144397709817 | Video Shotcraft | https://www.facebook.com/reel/1706144397709817 | https://github.com/Vincentwei1021/video-shotcraft | product promos, live site capture, Remotion, beat-synced, CapCut/JianYing export, 150 motion recipes | C |
| 20 | Nov 22, a day ago, reel 1074076165687736 | HyperFrames Video Agent Skills | https://www.facebook.com/reel/1074076165687736 | https://github.com/saranambiar/hyperframes-video-agent-skills | HyperFrames+FFmpeg+GSAP, backward scene construction, visual-to-narration sync, audio ducking | C |
| 21 | Nov 22, a day ago, reel 1134736455996366 | Claude Video Kit | https://www.facebook.com/reel/1134736455996366 | https://github.com/runesleo/claude-video-kit | vertical explainer videos from research briefs, Remotion, faster-whisper captions, script-hash release gate | C |
| 22 | Nov 22, a day ago, reel 2109001809762169 | Lucide | https://www.facebook.com/reel/2109001809762169 | https://github.com/lucide-icons/lucide | 1,600 icons | none |
| 23 | Nov 21, 2 days ago, reel 28765980036407573 | MR Office | https://www.facebook.com/reel/28765980036407573 | https://github.com/XinaTian/MROffice | 6-in-1 workspace, AGPL-3.0 | none |
| 24 | Nov 21, 2 days ago, reel 1126233470300616 | EspoCRM | https://www.facebook.com/reel/1126233470300616 | https://github.com/espocrm/espocrm | open-source CRM | none |
| 25 | Nov 21, 2 days ago, reel 1445794827714174 | Awesome Mac | https://www.facebook.com/reel/1445794827714174 | https://github.com/jaywcjlove/awesome-mac | curated macOS software list | none |
| 26 | Nov 21, 2 days ago, reel 1860705704967725 | Cobalt (video downloader) | https://www.facebook.com/reel/1860705704967725 | https://github.com/imputnet/cobalt | download videos, privacy-friendly | C — video downloading |
| 27 | Nov 21, 2 days ago, reel 2557780848050643 | IT-Tools | https://www.facebook.com/reel/2557780848050643 | https://github.com/CorentinTh/it-tools | developer utilities in one place | none |
| 28 | Nov 21, 2 days ago, reel 1591971376017008 | Cinematic Skill (duplicate post) | https://www.facebook.com/reel/1591971376017008 | https://github.com/Moh4696/cinematic-skill | 258 stars, 16 forks, MIT, as in week-ago version below | C |
| 29 | Nov 21, 2 days ago, reel 1282455361330253 | talking-head / claude-video-effects | https://www.facebook.com/reel/1282455361330253 | https://github.com/Vibha-Ramprakash/claude-video-effects | 51 viral video effects into Claude Code | C |
| 30 | Nov 21, 2 days ago, reel 1292822453033626 | Underdog Woof | https://www.facebook.com/reel/1292822453033626 | NO REPO STATED | only https://huggingface.co/ConwayResearch/Underdog-Woof — 40MB TTS, 1.4% error, 14x real-time | none — audio |
| 31 | Nov 21, 2 days ago, reel 1114265364750472 | TTS voting arena / open-tts-leaderboard | https://www.facebook.com/reel/1114265364750472 | https://github.com/huggingface/open-tts-leaderboard | compare 70+ TTS models | none — audio |
| 32 | Nov 21, 2 days ago, reel 1689611025841805 | AutoClip | https://www.facebook.com/reel/1689611025841805 | https://github.com/zhouxiaoka/autoclip | local podcast to vertical clips, 10 top clips, animated captions | C |
| 33 | Nov 21, 2 days ago, reel 1464503645887406 | OpenHydroNet / flood-forecasting | https://www.facebook.com/reel/1464503645887406 | https://github.com/google-research/flood-forecasting | flood forecasting | none |
| 34 | Nov 21, 2 days ago, reel 1728285972234843 | PaperOrchestra | https://www.facebook.com/reel/1728285972234843 | https://github.com/google-research/paper-orchestra | research writing automated | none |
| 35 | Nov 20, 3 days ago, reel 3294001170792872 | Reverb-TTS | https://www.facebook.com/reel/3294001170792872 | https://github.com/software-mansion-labs/Reverb-TTS | 297M-param TTS, 7 languages, 0.96% WER, 232x real-time | none — audio |
| 36 | Nov 20, 3 days ago, reel 1721967172725767 | pipecat-session-continuity | https://www.facebook.com/reel/1721967172725767 | https://github.com/meet987654/pipecat-session-continuity | Pipecat sessions | none |
| 37 | Nov 20, 3 days ago, reel 1648828510062466 | MiniCPM-OCR | https://www.facebook.com/reel/1648828510062466 | https://github.com/OpenBMB/MiniCPM-OCR | 1.3B OCR, 93.68 SOTA | none |
| 38 | Nov 19, 4 days ago, reel 1116235964745717 | Vox Director | https://www.facebook.com/reel/1116235964745717 | https://github.com/Alisa0808/vox-director | MIT, Vox-style paper-collage explainer video, Atlas Cloud + FFmpeg, 6-stage pipeline, 14 narrative arcs | C |
| 39 | Nov 19, 4 days ago, reel 1866022974573204 | Project Maya | https://www.facebook.com/reel/1866022974573204 | https://github.com/mw00/project-maya | 748B MoE inference, DeepSeek-V4.1-Flash, 30+ tok/s RTX 5090 | none |
| 40 | Nov 19, 4 days ago, reel 1275228981478116 | paper2video | https://www.facebook.com/reel/1275228981478116 | https://github.com/Lunamos/paper2video | arXiv paper to 3Blue1Brown-style explainer, Remotion, 16:9+9:16, EN+Chinese | C |
| 41 | Nov 19, 4 days ago, reel 1645556130311826 | Lemo-Opuscar | https://www.facebook.com/reel/1645556130311826 | https://github.com/lemomo-ai/lemo-opuscar | 99 film styles, Canvas/WebGL, FFmpeg 1080p, commercial use | C |
| 42 | Nov 19, 4 days ago, reel 2145795782998256 | CodeWorldModel 2.0 | https://www.facebook.com/reel/2145795782998256 | https://github.com/inclusionAI/CodeWorldModel | world simulation + rendering, 30-min streaming, MiniMax-H3 | C |
| 43 | Nov 19, 4 days ago, reel 1694893911975093 | cinematic-skills (AustinZ21, distinct from Moh4696) | https://www.facebook.com/reel/1694893911975093 | https://github.com/AustinZ21/cinematic-skills | MIT, SKILL.md pack, shot-director, 22 camera moves, still-to-film depth parallax | C |
| 44 | Nov 19, 4 days ago, reel 1787761022337375 | rust-anything | https://www.facebook.com/reel/1787761022337375 | https://github.com/erkamyaman/rust-anything | — | none |
| 45 | Nov 19, 4 days ago, reel 1529357099101918 | MiniMind (repeat) | https://www.facebook.com/reel/1529357099101918 | https://github.com/jingyaogong/minimind | train a 64M model, ~$20 | none |
| 46 | Nov 19, 4 days ago, reel 1410519767523000 | Stickman Video Director (faceless animated videos) | https://www.facebook.com/reel/1410519767523000 | https://github.com/kaomei/stickman-video-director | faceless animated videos via AI coding agents | C/A |
| 47 | Nov 19, 4 days ago, reel 1017536917288716 | optimizerDuck | https://www.facebook.com/reel/1017536917288716 | https://github.com/itsfatduck/optimizerDuck | Windows debloat | none |
| 48 | Nov 19, 4 days ago, reel 1835870880781665 | last30days-skill | https://www.facebook.com/reel/1835870880781665 | https://github.com/mvanhorn/last30days-skill | Google searches editors, last-30-days searches | none |
| 49 | Nov 19, 4 days ago, reel 1126415423475431 | ARTEX | https://www.facebook.com/reel/1126415423475431 | https://github.com/BaaRai/ARTEX | AI pentesting | none |
| 50 | Nov 19, 4 days ago, reel 1485072176893832 | Arcane | https://www.facebook.com/reel/1485072176893832 | https://github.com/getarcaneapp/arcane | Docker management | none |
| 51 | Nov 18, 5 days ago, reel 1477216334504402 | lastbook | https://www.facebook.com/reel/1477216334504402 | https://github.com/Immortal-Protocols/lastbook | offline / internet-down AI | none |
| 52 | Nov 17, 6 days ago, reel 1114840154686085 | Ply | https://www.facebook.com/reel/1114840154686085 | https://github.com/mustafaTokmak/ply | macOS iPhone over USB | none |
| 53 | Nov 17, 6 days ago, reel 2008976879782296 | Claudinho | https://www.facebook.com/reel/2008976879782296 | https://github.com/arturogarrido/claudinho | football / Claude Code | none |
| 54 | Nov 17, 6 days ago, reel 1145478561310456 | Infradeck | https://www.facebook.com/reel/1145478561310456 | https://github.com/karlo-ks/Infradeck | homelab dashboard | none |
| 55 | Nov 17, 6 days ago, reel 1826596505263702 | AG-UI | https://www.facebook.com/reel/1826596505263702 | https://github.com/ag-ui-protocol/ag-ui | agent–user interaction protocol | infra |
| 56 | Nov 16, a week ago, reel 1667699074758386 | phonebox | https://www.facebook.com/reel/1667699074758386 | https://github.com/ersinkoc/phonebox | 121 widgets, 30 templates, old Android phone as dashboard | none |
| 57 | Nov 16, a week ago, reel 1841932937254453 | FFmpeg-GUI-Editor-Windows | https://www.facebook.com/reel/1841932937254453 | https://github.com/DevedevT/FFmpeg-GUI-Editor-Windows | FFmpeg GUI video editor | C |
| 58 | Nov 16, a week ago, reel 2346804529430649 | CL4R1T4S | https://www.facebook.com/reel/2346804529430649 | https://github.com/elder-plinius/CL4R1T4S | secret system prompts | none |
| 59 | Nov 16, a week ago, reel 1275793971415809 | brief2mp4 | https://www.facebook.com/reel/1275793971415809 | https://github.com/qualixar/brief2mp4 | AI generates real motion graphics from a written brief to MP4, Claude Code/Codex | C |
| 60 | Nov 16, a week ago, reel 1954325018863095 | shotput | https://www.facebook.com/reel/1954325018863095 | https://github.com/keshav-exe/shotput | — | none |
| 61 | Nov 16, a week ago, reel 1438103721853869 | plannotator | https://www.facebook.com/reel/1438103721853869 | https://github.com/backnotprop/plannotator | — | none |
| 62 | Nov 16, a week ago, reel 1868503394337275 | blender-skills | https://www.facebook.com/reel/1868503394337275 | https://github.com/arjun988/blender-skills | Blender shortcuts / node setups | C |
| 63 | Nov 16, a week ago, reel 1133409002431399 | zerotrash | https://www.facebook.com/reel/1133409002431399 | https://github.com/zerotrashapp/zerotrash | — | none |
| 64 | Nov 16, a week ago, reel 1136900588920377 | Underdog Woof (repeat) | https://www.facebook.com/reel/1136900588920377 | NO REPO STATED | only https://huggingface.co/ConwayResearch/Underdog-Woof | none — audio |
| 65 | Nov 16, a week ago, reel 1101812466002301 | SynthID Detector | https://www.facebook.com/reel/1101812466002301 | NO REPO STATED | only https://synthid.com/ — Google DeepMind AI-media watermark detection | C — detection |
| 66 | Nov 16, a week ago, reel 1005032979308492 | TTS voting arena (repeat) | https://www.facebook.com/reel/1005032979308492 | https://github.com/huggingface/open-tts-leaderboard | — | none — audio |
| 67 | Nov 16, a week ago, reel 2231590444372080 | d1-2B (3ms AI decisions) | https://www.facebook.com/reel/2231590444372080 | NO REPO STATED | only https://huggingface.co/LiquidAI/d1-2B — LiquidAI 2B model | none |
| 68 | Nov 16, a week ago, reel 1491683576354841 | Remocn | https://www.facebook.com/reel/1491683576354841 | https://github.com/Remocn/remocn | 900+ Remotion components, professional product videos in code | C |
| 69 | Nov 16, a week ago, reel 2053533545364486 | Instagram agent skill | https://www.facebook.com/reel/2053533545364486 | https://github.com/Jakeschincariol/instagram-agent-skill | Claude, 13 skills, plan reels, 26 viral hook formulas | A/C |
| 70 | Nov 16, a week ago, reel 2271645256901375 | Heretic | https://www.facebook.com/reel/2271645256901375 | NO REPO STATED | only https://huggingface.co/xtools-at/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic — uncensored model | none |
| 71 | Nov 16, a week ago, reel 1108879771765031 | talking-head / claude-video-effects (repeat) | https://www.facebook.com/reel/1108879771765031 | https://github.com/Vibha-Ramprakash/claude-video-effects | — | C |
| 72 | Nov 16, a week ago, reel 1713783493446424 | Chimera | https://www.facebook.com/reel/1713783493446424 | https://github.com/jamesondh/chimera-vocal-synth | voice synth | none — audio |
| 73 | Nov 16, a week ago, reel 1149375831358806 | PointDiT | https://www.facebook.com/reel/1149375831358806 | https://github.com/google-research/pointdit | Google 3D geometry | C — 3D |
| 74 | Nov 16, a week ago, reel 28358176923856737 | Zonos Three Mini | https://www.facebook.com/reel/28358176923856737 | https://github.com/Zyphra/ZONOS3-Mini | TTS | none — audio |
| 75 | Nov 16, a week ago, reel 2011411053596704 | islandcn | https://www.facebook.com/reel/2011411053596704 | https://github.com/opencoredev/islandcn | Dynamic Island component | none |
| 76 | Nov 16, a week ago, reel 2203848377677584 | Univer | https://www.facebook.com/reel/2203848377677584 | https://github.com/dream-num/univer | office / spreadsheet SDK | none |
| 77 | Nov 16, a week ago, reel 1955727762076116 | ApkStart | https://www.facebook.com/reel/1955727762076116 | https://github.com/RoutineMiku/apkstart | — | none |
| 78 | Nov 16, a week ago, reel 2655914421524630 | Fontsource | https://www.facebook.com/reel/2655914421524630 | https://github.com/fontsource/fontsource | fonts | none |
| 79 | Nov 16, a week ago, reel 2193949897882471 | faceless YouTube channel (Most Popular, same Stickman repo, different reel) | https://www.facebook.com/reel/2193949897882471 | https://github.com/kaomei/stickman-video-director | 243.9K views | C/A |
| 80 | Nov 16, a week ago, reel 1672790804378895 | OpenMotion | https://www.facebook.com/reel/1672790804378895 | https://github.com/nexu-io/openmotion | recreate a viral video for your brand, reverse-engineers video into editable HTML + Motion Markdown | C |
| 81 | Nov 16, a week ago, reel 1534179238732198 | HyperFrames (HeyGen) | https://www.facebook.com/reel/1534179238732198 | https://github.com/heygen-com/hyperframes | build professional videos entirely in HTML/CSS | C |
| 82 | Nov 16, a week ago, reel 1522750596351523 | Photopea | https://www.facebook.com/reel/1522750596351523 | https://github.com/photopea/photopea | browser image editor | C — image |
| 83 | Nov 16, a week ago, reel 2203215900230823 | IT-Tools (repeat) | https://www.facebook.com/reel/2203215900230823 | https://github.com/CorentinTh/it-tools | — | none |
| 84 | Nov 16, a week ago, reel 2125593488816563 | Cobalt (repeat) | https://www.facebook.com/reel/2125593488816563 | https://github.com/imputnet/cobalt | — | C |
| 85 | Nov 16, a week ago, reel 1835244260839572 | LosslessCut | https://www.facebook.com/reel/1835244260839572 | https://github.com/mifi/lossless-cut | cut videos without re-rendering | C |
| 86 | Nov 16, a week ago, reel 968911059324709 | Twiligent | https://www.facebook.com/reel/968911059324709 | https://github.com/spacesdrive/twiligent | social media dashboard, YouTube/Instagram | A |
| 87 | Nov 16, a week ago, reel 1576115001224216 | Awesome Mac (repeat) | https://www.facebook.com/reel/1576115001224216 | https://github.com/jaywcjlove/awesome-mac | — | none |
| 88 | Nov 16, a week ago, reel 4350302691880930 | Cinematic Skill | https://www.facebook.com/reel/4350302691880930 | https://github.com/Moh4696/cinematic-skill | 258 stars, 16 forks, MIT, narrated cinematic films built entirely from code, one continuous camera over photos/maps/cards, Claude Code/Codex/Cursor/Gemini CLI | C |
| 89 | Nov 16, a week ago, reel 1616702316174914 | OpenFilm | https://www.facebook.com/reel/1616702316174914 | https://github.com/openfilm/openfilm | 6.3K stars, 604 forks, MIT, open-source AI video agent, turns any coding agent into a video agent, editor to change anything | C |
| 90 | Nov 17, 6 days ago, reel 1116526131271283 | Vork | https://www.facebook.com/reel/1116526131271283 | https://github.com/voyager-so/vork | 1.6K stars, 134 forks, headless 3D/VFX engine for agents, Rust/S-lang, 1M simulated birds up to 11x faster than Blender EEVEE | C |

## 2. GithubSignals — profile 61590627770961, 43K followers — https://www.facebook.com/profile.php?id=61590627770961&sk=videos — 18 rows

| # | Date (approx) | Video | Reel URL | GitHub repo (exactly as stated) | What it does | Bucket |
|---|---|---|---|---|---|---|
| 1 | Most Popular, reel 988295136953484 | Beamer | https://www.facebook.com/reel/988295136953484 | https://github.com/kalkman-code/beamer | GPL-3.0, v1.3.13, one keyboard/mouse for Mac/Windows/Linux, 1.9K likes | none |
| 2 | 3h ago, reel 1346715787504754 | cache-maxxing | https://www.facebook.com/reel/1346715787504754 | https://github.com/5m0k3/cache-maxxing | MIT, v0.5.1, Claude Code plugin, live bar above chat, cache expiry / cost estimate, handoff summary | none |
| 3 | 4h ago, reel 1167426439269113 | Miniature San Francisco | https://www.facebook.com/reel/1167426439269113 | NO REPO STATED | only https://x.com/aridutilh/status/2124583048427798911, via @aridutilh — miniature SF in browser, real buses/planes/boats/weather, rideable robotaxis | C — simulation, no repo |
| 4 | 9h ago, reel 1398752192102688 | Inkrail | https://www.facebook.com/reel/1398752192102688 | https://github.com/Aaryanverma/Inkrail | MIT, v0.1.1, typewriter that feels like one, textured paper, mechanical sounds, Mac/Windows — caption link not expanded in this session, record as video-shown | none |
| 5 | 12h ago, reel 2569463580227290 | PiBot | https://www.facebook.com/reel/2569463580227290 | https://github.com/w01fb0ss/pibot | Apache-2.0, open-source local-first AI agent team for desktop, macOS/Windows/Linux/Android, pi agent kernel | none |
| 6 | 15h ago, reel 4457942391124993 | Mobile Agent Testers | https://www.facebook.com/reel/4457942391124993 | https://github.com/pierridotite/mobile-agent-testers | MIT, 20 AI testers on 20 phones in parallel, $0, 54 stars in video | none |
| 7 | 19h ago, reel 1156505896838157 | Colab Playground | https://www.facebook.com/reel/1156505896838157 | https://github.com/scarletkc/colab-playground | MIT, desktop app for Google Colab CLI, GPU sessions, cost guards, port forwarding | none |
| 8 | A day ago, reel 2026172691385792 | Walking Block | https://www.facebook.com/reel/2026172691385792 | https://github.com/leonxlnx/walking-block | three.js film, Soviet apartment block on eight mechanical legs, procedural geometry/textures/shaders, no 3D assets, 45s film | C |
| 9 | A day ago, reel 2224417138429531 | Comfy-Desktop | https://www.facebook.com/reel/2224417138429531 | https://github.com/comfy-org/comfy-desktop | v1.1.10, 739 stars in video, official desktop app for ComfyUI, generative AI engine | C — image generation |
| 10 | A day ago, reel 1170611448638136 | go-bot | https://www.facebook.com/reel/1170611448638136 | https://github.com/xyc999-ai/go-bot | open-source self-hosted personal AI agent in Go, web research, browser automation, image generation/editing, Office docs, long-term memory | none |
| 11 | 3 days ago, reel 2559828137849774 | GTA 6 Clip Automation / gtavi-claudecode | https://www.facebook.com/reel/2559828137849774 | https://github.com/bodila51/gtavi-claudecode | MIT, GitHub page renders live in video, NOT dead here; Claude Code plugin, monitors GTA 6 streams, cuts ready-to-post 9:16 vertical clips, hooks/captions, paid content rewards, unofficial fan project | A/C |
| 12 | 3 days ago, reel 1807029370588796 | phone-harness | https://www.facebook.com/reel/1807029370588796 | https://github.com/phone-harness/phone-harness | MIT, 15,100+ PyPI downloads, let Claude Code/Codex/agent use a real phone, scroll/tap/type/read screen, no jailbreak | none |
| 13 | 2 days ago, reel 901405119661768 | YouDash | https://www.facebook.com/reel/901405119661768 | https://github.com/sa4hnd/youdash | GPL-3.0, 213 stars in video, native YouTube for Apple CarPlay, ad blocking | none |
| 14 | 3 days ago, reel 2574221139735735 | Motion Educator | https://www.facebook.com/reel/2574221139735735 | https://github.com/zeative/motion-educator | MIT, agent skill + film engine, educational films that look expensive, storyboard first, renders 1080p60, 3D replicas, diagrams, captions, narration, music, SFX | C — closest to (B) lesson video |
| 15 | 3 days ago, reel 1001654152419325 | Claude Blender Skills | https://www.facebook.com/reel/1001654152419325 | https://github.com/mromidev/claude-blender-skills | MIT, free Claude skills for realistic Blender animations, three full workflows | C |
| 16 | 2 days ago, reel 1169424822099223 | AnyMachine | https://www.facebook.com/reel/1169424822099223 | https://github.com/apekshik/anymachine | MIT, machines that work, built in Blender by an agent, 30m walker, 160 parts, hydraulics, one Python script; family AnyScene/AnyKit/AnyMachine/AnyShot | C |
| 17 | 3 days ago, reel 1451005589862411 | Lumio | https://www.facebook.com/reel/1451005589862411 | https://github.com/cavaldos/Lumio | GPL-3.0, fast open-source keyboard launcher for macOS, Rust core, SwiftUI, OCR in images/PDFs, fork of kunkka19xx/look | none |
| 18 | 2 days ago, reel 1731068955250804 | Motlab | https://www.facebook.com/reel/1731068955250804 | https://github.com/staryone/motlab | MIT, Node.js 24+, video engine where every scene is code, agent skill writes scenes, renders to MP4 in headless Chrome, no AI image/video model | C |

## 3. Repo Radar AI — profile 61573369875592, 7.1K followers — https://www.facebook.com/profile.php?id=61573369875592&sk=videos — 21 rows

| # | Date (approx) | Video | Reel URL | GitHub repo (exactly as stated) | What it does | Bucket |
|---|---|---|---|---|---|---|
| 1 | Most Popular / 5 days ago, reel 1117449587559448 | PhoneBox | https://www.facebook.com/reel/1117449587559448 | https://github.com/ersinkoc/phonebox | 121 widgets, 30 templates, old Android phone as dashboard, system stats, AI coding quotas, touch controls, Windows/Linux/macOS USB/Wi-Fi | none |
| 2 | 4h ago, reel 3249398708784231 | Sandstorm | https://www.facebook.com/reel/3249398708784231 | https://github.com/deeplethe/sandstorm | thousands of AI agent sandboxes on one machine, 0.1s wake, zero cold starts | infra |
| 3 | 10h ago, reel 1180756254633802 | A2UI | https://www.facebook.com/reel/1180756254633802 | https://github.com/a2ui-project/a2ui | AI agents generate native interfaces, no UI hallucination, works offline | infra |
| 4 | 12h ago, reel 1799492187773259 | Fast-anything | https://www.facebook.com/reel/1799492187773259 | https://github.com/EL4CTEO/fast-anything | Python benchmark 4.91s to 42ms | none |
| 5 | 20h ago, reel 1477669834469239 | TinCan | https://www.facebook.com/reel/1477669834469239 | https://github.com/radianceskills-dev/tincan-releases | Android phone runs Linux sandbox + offline AI models | none |
| 6 | 21h ago, reel 1148879884280294 | Muelle | https://www.facebook.com/reel/1148879884280294 | https://github.com/crafter-station/Muelle | Windows taskbar as glass dock, smooth animations | none |
| 7 | A day ago, reel 1860415401760499 | YouDash | https://www.facebook.com/reel/1860415401760499 | https://github.com/sa4hnd/YouDash | native YouTube on Apple CarPlay, no browser wrapper | none |
| 8 | A day ago, reel 1359390889493500 | AutoClip | https://www.facebook.com/reel/1359390889493500 | https://github.com/zhouxiaoka/autoclip | 10 short clips from one long video, highlights, framing follows speaker | C |
| 9 | A day ago, reel 30337875215802515 | PoseWear | https://www.facebook.com/reel/30337875215802515 | https://github.com/atuizz/posewear | 1,320 anime outfits with English/Chinese AI prompts | C — image generation |
| 10 | A day ago, reel 4531059713876253 | OpenSRE | https://www.facebook.com/reel/4531059713876253 | https://github.com/Tracer-Cloud/opensre | failed CI runs become proposed fixes | none |
| 11 | 2 days ago, reel 1670991371188943 | Firecrawl | https://www.facebook.com/reel/1670991371188943 | https://github.com/firecrawl/firecrawl | AI agent retrieves web information without URLs, websites into AI-ready data | none |
| 12 | 2 days ago, reel 1797206994839304 | App Store Compliance | https://www.facebook.com/reel/1797206994839304 | https://github.com/mjmirza/app-store-compliance | 117 rejection patterns | none |
| 13 | 2 days ago, reel 2976932729337921 | Ghost-Downloader-3 | https://www.facebook.com/reel/2976932729337921 | https://github.com/XiaoYouChR/Ghost-Downloader-3 | capitalisation as stated here; same repo as Nadeem's lowercase form — torrents/videos/file downloads | none |
| 14 | 3 days ago, reel 1164786006087997 | uv | https://www.facebook.com/reel/1164786006087997 | https://github.com/astral-sh/uv | 10–100x faster than pip | none |
| 15 | 3 days ago, reel 1513247037289955 | AOCI-CODE | https://www.facebook.com/reel/1513247037289955 | https://github.com/aoci-spec/aoci-code | coding agent indexes ~500,000 lines | none |
| 16 | 3 days ago, reel 1794999104914176 | Jiangshan-map | https://www.facebook.com/reel/1794999104914176 | https://github.com/DeanChensj/jiangshan-map | 2,400 years of Chinese history, interactive map | none |
| 17 | 4 days ago, reel 2191186604846029 | OpenMotion | https://www.facebook.com/reel/2191186604846029 | https://github.com/nexu-io/openmotion | recreate a viral video for your brand | C |
| 18 | 4 days ago, reel 29769100229348222 | MiniMind | https://www.facebook.com/reel/29769100229348222 | https://github.com/jingyaogong/minimind | train your own LLM in 2 hours, 64M model, ~$20 | none |
| 19 | 4 days ago, reel 29046816151677561 | Rust-anything | https://www.facebook.com/reel/29046816151677561 | https://github.com/erkamyaman/rust-anything | — | none |
| 20 | 5 days ago, reel 1504680618233205 | PaperOrchestra | https://www.facebook.com/reel/1504680618233205 | https://github.com/google-research/paper-orchestra | research writing automated | none |
| 21 | 5 days ago, reel 2293046641623927 | Claude-BugHunter | https://www.facebook.com/reel/2293046641623927 | https://github.com/elementalsouls/Claude-BugHunter | 83 skills, 681 disclosed-report patterns, 24 vulnerability classes, Claude Code bug-hunting, authorized security testing | none |

## 4. FondPeace Crazy — @fondpeacecrazy, profile 61595100991996 — https://www.facebook.com/fondpeacecrazy/videos — 22 rows

| # | Date (approx) | Video | Reel URL | GitHub repo (exactly as stated) | What it does | Bucket |
|---|---|---|---|---|---|---|
| 1 | Most Popular, video https://www.facebook.com/61595100991996/videos/1609946120218957 | AutoClip | https://www.facebook.com/61595100991996/videos/1609946120218957 | https://github.com/zhouxiaoka/autoclip | git clone https://github.com/zhouxiaoka/autoclip.git, 10,031 stars, +1,787 forks today as stated, transforms long videos into viral short clips automatically | C |
| 2 | 4h ago, reel 1141204345329504 | HyperFrames | https://www.facebook.com/reel/1141204345329504 | https://github.com/heygen-com/hyperframes | 88,282 stars, 8,215 forks as stated, open-source AI video engine | C |
| 3 | 5h ago, reel 1460613776207153 | MiniMind | https://www.facebook.com/reel/1460613776207153 | https://github.com/jingyaogong/minimind | 68,539 stars, 8,967 forks as stated, train your own LLM in 2 hours | none |
| 4 | 17h ago, reel 1160214326370415 | firecrawl | https://www.facebook.com/reel/1160214326370415 | https://github.com/firecrawl/firecrawl | 206,537 stars, 10,796 forks as stated | none |
| 5 | 2 days ago, reel 921932097581727 | Bend 2 | https://www.facebook.com/reel/921932097581727 | https://github.com/bendlang/bend | 25,703 stars, 820 forks as stated, fast language that blocks AI mistakes with proof | none |
| 6 | 2 days ago, reel 1164935466291936 | AFFiNE | https://www.facebook.com/reel/1164935466291936 | https://github.com/toeverything/AFFiNE | 75,788 stars, 5,581 forks as stated, Notion + Miro in one open-source app | none |
| 7 | 2 days ago, reel 3824136871058854 | WorkDaddy | https://www.facebook.com/reel/3824136871058854 | https://github.com/babygoton/WorkDaddy | 3,304 stars, 360 forks as stated, desktop helper for WorkBuddy & CodeBuddy AI | none |
| 8 | 2 days ago, reel 1140341938709206 | Ghost Downloader 3 | https://www.facebook.com/reel/1140341938709206 | https://github.com/XiaoYouChR/Ghost-Downloader-3 | 13,045 stars, 810 forks as stated | none |
| 9 | 3 days ago, reel 1672718194635379 | PaperOrchestra | https://www.facebook.com/reel/1672718194635379 | https://github.com/google-research/paper-orchestra | 4,850 stars, 596 forks as stated | none |
| 10 | 3 days ago, reel 29943300065287727 | GTA 6 Clipping Business | https://www.facebook.com/reel/29943300065287727 | NO REPO STATED | caption names “gtavi-claudecode plugin for Claude Code” but gives only https://fondpeace.com for the full guide/links; do not invent a GitHub URL — automate GTA 6 clipping, earn from clips | A/C |
| 11 | 4 days ago, reel 1474634004865399 | Postiz | https://www.facebook.com/reel/1474634004865399 | NO REPO STATED | only https://fondpeace.com, $480k/month revenue claim as stated — automating social media growth | A |
| 12 | 4 days ago, reel 1643333057488145 | openGym | https://www.facebook.com/reel/1643333057488145 | https://github.com/DuarteSantos8/openGym | 22,763 stars, 3,026 forks as stated, open-source gym tracker | none |
| 13 | 4 days ago, reel 1512854050687544 | CLI-Anything | https://www.facebook.com/reel/1512854050687544 | https://github.com/HKUDS/CLI-Anything | 59,673 stars, 5,422 forks as stated, making all software agent-native | none |
| 14 | 4 days ago, reel 1138488282256004 | Superpowers | https://www.facebook.com/reel/1138488282256004 | https://github.com/obra/superpowers | 319,574 stars, 28,490 forks as stated, agentic revolution | none |
| 15 | 4 days ago, reel 1201310698886890 | Creator Monetization | https://www.facebook.com/reel/1201310698886890 | NO REPO STATED | FondPeace platform, 95% tips, 60% ad revenue, fondpeace.com | A |
| 16 | 5 days ago, reel 2322753185236682 | Univer | https://www.facebook.com/reel/2322753185236682 | https://github.com/dream-num/univer | 28,895 stars, 2,616 forks as stated, build your own AI office | none |
| 17 | 5 days ago, reel 2240815907314043 | Claude BugHunter | https://www.facebook.com/reel/2240815907314043 | https://github.com/elementalsouls/Claude-BugHunter | 8,507 stars, 1,297 forks as stated | none |
| 18 | 5 days ago, reel 1846518476488830 | SkillEvaluator | https://www.facebook.com/reel/1846518476488830 | https://github.com/NVIDIA/SkillEvaluator | 3,127 stars, 443 forks as stated | none |
| 19 | 6 days ago, reel 3599277236940411 | FondPeace itself | https://www.facebook.com/reel/3599277236940411 | NO REPO STATED | fondpeace.com only — future of social, open source, algorithm-free | none |
| 20 | 6 days ago, reel 1454640259452097 | ffmpeg-skill | https://www.facebook.com/reel/1454640259452097 | https://github.com/kajisho5/ffmpeg-skill | 6,745 stars, 601 forks as stated, give AI coding agents local video editing powers | C |
| 21 | 6 days ago, reel 1094942480208564 | Claude Red | https://www.facebook.com/reel/1094942480208564 | https://github.com/SnailSploit/Claude-Red | 11,135 stars, 1,517 forks as stated, offensive security skills for Claude, red team | none |
| 22 | 6 days ago, reel 1615948240336783 | Blazer | https://www.facebook.com/reel/1615948240336783 | https://github.com/ankane/blazer | 4,807 stars, 503 forks as stated, open-source BI, SQL to charts/dashboards/alerts | none |

## 5. Hypit reel — re-confirmed — GithubSignals, https://www.facebook.com/reel/4579253032395557 — 1 rows

| # | Date (approx) | Video | Reel URL | GitHub repo (exactly as stated) | What it does | Bucket |
|---|---|---|---|---|---|---|
| 1 | Nov 20–23 window (date not shown in reel viewer) | Hypit | https://www.facebook.com/reel/4579253032395557 | https://github.com/hypit-ai/hypit | Take one viral video and turn it into a hundred new versions with a single command. Clone any viral video with AI agents, 1 command, 100 variants, 100M views; footage, captions, B-roll and effects anchored to words; generation models optional, video can cost $0. 1.1K likes, 257 shares, 11 comments. | C — with (A) overlap |

## 6. Add-on — Orca (sent Nov 23, 01:34 EST, after the main pull)

| # | Date (approx) | Video | Reel URL | GitHub repo (exactly as stated) | What it does | Bucket |
|---|---|---|---|---|---|---|
| 1 | Date not shown / not verified — reel does not appear in FondPeace's Videos list or at the top of its timeline as loaded Nov 23, 01:35 AM (newest there still HyperFrames, Nov 22, 7:58 PM) | Orca | https://www.facebook.com/reel/1640816047552278 | https://github.com/stablyai/orca.git | Open-source AI orchestrator — runs multiple coding agents (Claude Code, Grok, Codex, OpenCode, Pi) side-by-side, each in its own Git worktree, tracked in one desktop dashboard, using your own API subscriptions. MIT. 103,300+ stars, +6,526 forks in a single day, as stated in the caption (not re-checked live). 76 comments, 196 shares. | none |

## Remaining Unopened — state plainly

- **Nadeem Khan:** 2 Videos entries whose reel IDs were not captured — MiniMind, 2 days ago, 267 views, and "Nadeem Khan's Video", 2 days ago, 1.4K views, 0:23, black thumbnail, no title in the list. MiniMind's repo is the same jingyaogong/minimind as its repeat post, but that specific reel's link was not captured, so no repo is assigned to it here. Scrolling Nadeem's Videos past Nov 16 was also not done.
- **GithubSignals:** 10 of 28 Videos entries not opened in this session — 2 days ago 3.9K views; 2 days ago 20.4K views (thumbnail: "BUILT ENTIRELY IN RUST"); 3 days ago 19.8K views (thumbnail: Wayland compositor); 3 days ago 16.3K views (thumbnail: 3D island scene); 3 days ago 9.3K views; 3 days ago 3.3K views; 3 days ago 8.9K views; 4 days ago 1.8K views; 4 days ago 2.3K views; 4 days ago 14.2K views. Inkrail's caption link was also not expanded (repo recorded as shown in its video). Videos older than 4 days ago were not reached.
- **Repo Radar AI and FondPeace Crazy:** complete for the Videos lists as loaded in this session (22 entries each per the scan header; 21 rows listed for Repo Radar AI — see reconciliation above); older videos below those lists were not reached.
- **No repo was confirmed dead/404** by opening GitHub in this session. The only "dead" note from the original assignment, gtavi-claudecode, is contradicted by the video evidence above (live GitHub page in the GithubSignals reel).

_Total rows in this file: 153 (152 from the main pull + 1 Orca add-on)._


---

# APPENDIX D — insta-reels skill library (ys-sites/insta-reels) — PULL PENDING ACCESS

**Repo:** https://github.com/ys-sites/insta-reels.git — **private repo. Status on Nov 23, 2026: NOT PULLED — I could not read it.**
- Unauthenticated GitHub API returns 404 for this repo, and `git ls-remote` prompts for a username (private).
- The connected GitHub App also returns 404 for `ys-sites/insta-reels` (`get_file_contents` README.md: "failed to get repository info: 404 Not Found") — the Muse GitHub App is NOT installed on this repo yet.
- There is no local clone of insta-reels in this workspace.

**Access step (do this first, before implementing anything from this appendix):**
1. Open the GitHub App install page and select `ys-sites/insta-reels` (and `ys-sites/video` if it is not already selected): https://github.com/apps/meta-muse-ai/installations/new
2. Once access is confirmed (a `get_file_contents` read of its README.md succeeds), pull the repo shallow first (`git clone --depth 1`), check its total size, and apply the 50 GB rule in Section 3, Rule 6 — if it is over 50 GB, ask Mohamed for permission before downloading it internally.
3. Then fill in the inventory below from the real files and implement them in the same order/rules as the rest of this prompt. Do not guess at file names or skill contents before you can read them.

**What is known about insta-reels from Mohamed's own records (use as a guide, verify against the real repo once you have access):**
- Built Oct 9, 2026. Live at https://ireels.vercel.app/ — a catalog + playbook per video: every AI-teaching video from his Instagram DMs organized into replicable blueprints (AI video generation, AI editing, real-estate format, dev tools, website benefits).
- Daily 8 AM job scans both Instagram accounts' DMs for new videos, applies his filters, and rebuilds the site.
- Vetting rule (Nov 8): an empty/thin caption from a known AI creator is NOT an auto-drop — watch the video first.
- Style guide: 8 styles, including Kelsie fly-through + AI home transformation as Style 8. Melissa Orta @melissaortarealtor "If this were my property" pitch (vid_428) — Mohamed: "Love this style"; that is Style 2 in the master prompt + repo playbook.
- Standing instruction (Nov 17): ALL video-editing work from the past week goes to ys-sites/video, NOT ireels — so insta-reels skills harvested here should be MIGRATED into ys-sites/video, not built out in ireels. The Master Video Styles site (ys-sites/video) is the live home for them now.
- Alias note: ireels.vercel.app is PINNED — re-run assign_alias after every create_deployment. Vercel deploy is BLOCKED (403) and needs re-authorization; the live site is stale. Do not attempt a Vercel deploy of insta-reels without Mohamed's explicit say-so.
- Vercel author rule: commits on Vercel-connected private repos MUST be authored Sharafath <ys.mkg.sites@gmail.com>.
- Thumbnails fall back to gradients (known fix: make insta-reels-thumbs public).

**What Claude should extract from insta-reels once access is granted (fill in, do not invent):**
- Every skill / playbook / style in the repo: file path, name, what it does, bucket (A/B/C), and whether it duplicates something already in ys-sites/video (especially the Sumit talking-head style, Kelsie listing-tour style, Melissa vision pitch, and the 8-style guide — these already exist in Master Video Styles in some form; migrate, don't duplicate).
- The DM-scan / rebuild pipeline: how the daily scan works, what it needs (Instagram access, cron), and whether it can run for ys-sites/video.
- The catalog data: how many videos, what fields per video, and whether that catalog should merge into ys-sites/video's skill-index / repo-catalog.
- Verdict per skill: INSTALL / INSTALL WITH CONDITIONS / DO NOT INSTALL, with the same test-and-verify rule as the rest of this prompt.

**Size note for this repo:** size could NOT be verified (private, no access) — check it first on access, per Rule 6. If it is over 50 GB, ask Mohamed before downloading it internally.
