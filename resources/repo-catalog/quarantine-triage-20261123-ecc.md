# Quarantine triage — affaan-m/ECC (2026-11-23)

- Source: https://github.com/affaan-m/ECC, commit `4adeee6732a12d1540f49a4d50a38ce8c97f9a53` (2026-11-19), MIT.
- Staged: `resources/repo-quarantine/affaan-m/ECC`, a hardened shallow clone with no hooks, LFS, submodules, symlinks, or credential helper. The checkout has 4,951 files (109 MB) and 328 top-level skills (1,089 `SKILL.md` files including translations).
- Scope: a read-only text review. This is not an audit. `python tools/security_gate.py` returns BLOCKED, as it does for every resource.

## Whole repository (not installed)

| Item | Observation | Decision |
|---|---|---|
| `hooks/hooks.json` | 56 hook commands, mostly `node -e` scripts that would run on Claude Code tool calls | Not installed. This is too invasive for this workspace. |
| `install.ps1`, `install.sh` | `npm install --ignore-scripts`, then copy the plugin into the user config | Not run |
| `ecc2/`, `src/`, `scripts/`, `docker/`, `mcp-configs/` | Rust and Node runtime, MCP server configurations | Not reviewed and not run |
| Plugin `ecc@ecc` | Full harness (agents, commands, hooks, rules) | Not installed |

## 27 installed skills (markdown only)

The following skills were copied to `.claude/skills/ecc-<name>/`. The SHA-256 checksum of every file is recorded in `.claude/skills/ECC-PROVENANCE.json`.

- **Video:** video-editing, manim-video, motion-foundations, motion-patterns, motion-advanced, short-video-distribution, taste, ui-demo
- **Website:** frontend-design-direction, frontend-patterns, react-patterns, react-testing, vite-patterns, typescript-patterns, seo, make-interfaces-feel-better, accessibility, frontend-a11y, design-system, browser-qa, e2e-testing, verification-loop, web-perimeter-owasp-2025-audit
- **Content:** content-engine, brand-voice, marketing-campaign, search-first

The following checks were run on these skills:

- **Hidden Unicode:** checked for bidirectional and zero-width characters, U+2060 to U+2064, U+FEFF, and Unicode tag characters. None were found.
- **Symlinks:** none.
- **Instruction override or exfiltration text:** none. `short-video-distribution` explicitly treats transcripts as data and requires approval before uploading.
- **Pipe-to-shell commands and global installs:** none. `tasteforge-video` mentions `pip install` and was excluded.
- **Bundled non-markdown files:**
  - `manim-video/assets/network_graph_scene.py` is an example scene.
  - `frontend-design-direction/scripts/check-evidence.js` is a local JSON checker that uses only `fs` and `path` and makes no network calls.
  - `video-editing/assets/fusion/*` contains macOS-only DaVinci Resolve Lua installers and macros. These were not copied.
- **`web-perimeter-owasp-2025-audit`:** this skill makes bounded passive `curl` probes. Its workspace note restricts it to the user's own hosts.

Workspace changes: each skill's frontmatter `name` was prefixed with `ecc-`, and a "This workspace" section was appended. That section maps fal.ai, Veo, and Kling to local LTX-Video or Wan, and ElevenLabs to OmniVoice or Piper, and points to `docs/MASTER-ROUTER.md`.

## Excluded skills

| Skills | Reason |
|---|---|
| `remotion-video-creation` | Duplicates the installed official `remotion:*` plugin |
| `react-performance` | Duplicates `vercel:react-best-practices` |
| `taste-distillation`, `taste-application`, `tasteforge-video` | Require ECC's Python package and scripts (76 and 14 non-markdown files) |
| `fal-ai-media`, `videodb` | Paid APIs. The free-first rule applies; the local equivalents are listed in the master router |
| `crosspost`, `social-publisher`, `x-api` | Automated text posting. Video posting goes through `short-video-distribution` with approval |
| `security-review`, `security-scan` | The built-in `security-review` and the Cloudflare audit rule cover this. `security-scan` needs the AgentShield npm package |
| `liquid-glass-design` and about 290 others | Unrelated to video or website work: SwiftUI, Django, Kotlin, healthcare, networking, finance, and similar |

To add another ECC skill, repeat this review on its folder, then copy it with the same method and record it in `ECC-PROVENANCE.json`.
