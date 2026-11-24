# Smoothie install approval (2026-11-24)

**User approval (verbatim, 2026-11-23/24 session):** "if you think its sface usign the suceiry md and then i give you permison to isnatll all" — permission to install the prepared smoothie, conditional on the security review in `SECURITY.md`. This approval covers only the items listed under "Approved to install" at the pinned commits and versions below. It does not cover pushing, deploying, paid APIs, GPU rentals, or any item marked otherwise in `smoothie/RESULTS.md`.

`tools/security_gate.py` returns BLOCKED for every resource by design ("execution needs the user's explicit approval, recorded in the catalog"); this file is that record. It is not an independent full audit.

## Review performed (per SECURITY.md and MASTER-ROUTER section 4)

1. Staged with the hardened clone (shallow, hooks/LFS/submodules/symlinks/credential helper off) with provenance files.
2. Read-only triage (`tools/security/triage_staged.py`): install hooks, download-and-execute, unsafe weights, trust_remote_code, extra indexes, shipped binaries, secrets, hidden Unicode, prompt injection, telemetry. Output: `smoothie/audit/triage.json`.
3. SkillSpector 2.12 offline in a bwrap sandbox (`--unshare-all`, no network, prlimit, `--no-llm`). Output: `smoothie/audit/skillspector-staged.json`.
4. Manual review of the code that will run: network endpoints, process execution, dynamic code, model loading (`smoothie/audit/engine-code-review.txt`), npm registry metadata (install hooks, maintainers), the resolved Python lock (68 packages; `httpx2`/`httpcore2` confirmed as declared huggingface-hub 2.4.0 dependencies maintained under the pydantic org).
5. Install is pinned: every engine is fetched at the reviewed commit and its tree hash must equal the scanned tree, or the install aborts.

## Approved to install

STATUS: **APPROVED - installing (2026-11-24).**

- Bitdefender contextual scan of `resources/repo-quarantine` (2026-11-24 00:34, 242,067 items, heuristics on, all files): 2 detections, both `CMD:Heur.BZC.PZQ.Boxter` in `vercel-labs/agent-desktop/probes/windows/*/...clipboard...probe.ps1` (clipboard-capture probes in a computer-use reference repo, not in the install set). Bitdefender deleted them (after reboot). `vercel-labs/agent-desktop` is now DO NOT INSTALL. No detection in any install-set repo.
- User instruction (verbatim): "start installign the skils".
- motion-educator and stickman: SkillSpector coverage incomplete; installed on the manual source review (no malicious code found).

Previous hold (resolved):

- Source review result: no malicious code found in the install set; every high-severity scanner flag was traced to tests, docs, defensive code or false positives (`smoothie/RESULTS.md`, "Scanner flags ... resolved in source").
- Hold reasons:
  1. Bitdefender (2026-11-24 00:03) quarantined three audit report files as `Generic.PY.Stealer` (grep listings of risky-pattern lines). Assessed as a heuristic false positive on text, but an independent Bitdefender custom scan of `resources\repo-quarantine` is required before install.
  2. Claude Code's permission system blocked the install; it needs an explicit "install now" from the user (the earlier approval was conditional).
  3. SkillSpector coverage for `zeative/motion-educator` and `kaomei/stickman-video-director` is incomplete (scanner timeout); retry or explicit acceptance of the manual review.
- Approved set once the hold clears: npm `gsap@3.15.1`, `three@0.187.0`, `lottie-web@5.13.0`, `hyperframes@0.9.87` (all `--ignore-scripts`); `video-py` venv from `smoothie/install/video-py.lock.txt`; engines at the pinned commit + tree hash in `install.ps1` (ffmpeg-skill, sfx-generator, cinematic-film, still-to-film [`--no-upscale` only], motion-educator, stickman-director [code engine only], paper2video [inside video-py]); the eight `vs-*` skills.
