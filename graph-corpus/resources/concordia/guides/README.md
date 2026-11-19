# Resource Library

This folder is organized by use case. Repositories cloned from the iReels video catalog are shallow source clones; Git LFS media objects were intentionally skipped to avoid downloading large model files.

## Categories

- `01 - Video & Motion Graphics` — animation, AI video production, editing, and motion-design tools.
- `02 - Website Design & UI` — interface components, design systems, website-building resources, and copy quality.
- `03 - AI Development & Agents` — agent frameworks, coding tools, models, automation, and Claude-oriented skills.
- `04 - Marketing, SEO & Growth` — advertising, social automation, SEO, launch, and LinkedIn tools.
- `05 - Security & Standards` — secure-development guidance and security assessment resources.
- `06 - Research Catalogs` — the web-resource list and source catalogs for future imports.
- `07 - Local Projects & Lessons` — local motion projects and lesson collections.
- `08 - Workspace Support` — loose source and dependency folders that are not standalone resources.
- `09 - Film & UI Reconstruction Skills` — cinematic scroll-film studio engines, screenshot-to-code prompt spec generators, and modular frontend taste skills.

## Standalone Core Skill Folders (Permanent Protected Systems)

- `rea/` — **REA: Reverse Engineer Anything** ([morluto/rea](https://github.com/morluto/rea), MIT): an MCP server plus agent skills for reverse engineering binaries, Android/Apple apps, Electron/JavaScript bundles, firmware and browser behaviour, and for building agent environments from web apps. Active in Claude Code with Ghidra and Frida tooling. **Permanently retained core system.**
- `motion-video-director/` — **Motion Video Director Skill & Engine**: The master lesson ingestion, video prompt synthesis, and 6-chapter chalkboard animation director. **Permanently retained core system.**

## Research Catalogs & Vibe-Coding Master Libraries

Located in `06 - Research Catalogs/`:
0. **[Resource security and routing](./06%20-%20Research%20Catalogs/2026-11-03-resource-security-and-routing.md)**: the 14 requested development, security, AI and motion resources, with locations, practical use and review limits.
1. **[100 Vibe-Coding Upgrade Repositories](./06%20-%20Research%20Catalogs/100-vibe-coding-upgrade-repositories.md)**: 100 battle-tested, famous open-source tools across 6 pillars (UI polish, state management, AI agents, databases, animations/rendering, build velocity) to elevate vibe-coded prototypes to production-grade quality.
2. **[30 Vibe-Coding Security Repositories](./06%20-%20Research%20Catalogs/30-vibe-coding-security-repositories.md)**: 30 specialized security tools defending against typical AI coding pitfalls (Zod schema validation, Helmet headers, rate limiters, secret detection, SAST, and LLM prompt injection defenses).
3. **[10 Skill Mastery & Acceleration Tools](./06%20-%20Research%20Catalogs/10-skill-mastery-and-acceleration-tools.md)**: 10 high-speed engines (MCP servers, Continue, Simon Willison's LLM CLI, Jina Reader, Chroma, DSPy, Instructor) to ingest and master skill data for faster, smoother final product delivery.
4. **`web_essentials.txt`**: Curated web engineering resource list.

## Video catalog import


Twenty-nine verified public GitHub repositories referenced by the iReels catalog were added to the applicable categories. DM-gated, unavailable, and unverified repository references were not cloned.

### 2026-10-26 update (insta-reels `creator-picks.json`, 29 reel picks)

23 of the picks were already here. The 6 new ones were each checked on GitHub (public, not archived, licensed) and added as shallow source clones (Git LFS media skipped):

| Repository | Folder | What it is | Skills inside |
|---|---|---|---|
| debpalash/VoiceStudio (AGPL-3.0) | `01 - Video & Motion Graphics/voicestudio` | Fully local ElevenLabs alternative: voice cloning, dubbing, dictation | `skills/voicestudio`, `skills/voicestudio-maintainer` |
| abi/screenshot-to-code (MIT) | `02 - Website Design & UI/screenshot-to-code` | Screenshot → clean HTML/Tailwind/React code | — (app, no skill file) |
| ayghri/i-have-adhd (MIT) | `03 - AI Development & Agents/i-have-adhd` | Skill that makes a coding agent lead with the answer | `skills/i-have-adhd` |
| DietrichGebert/ponytail (MIT) | `03 - AI Development & Agents/ponytail` | "Laziest senior dev" mode that cuts tokens and over-engineering | `skills/ponytail` (+ audit, debt, gain, help, review) |
| taoufik123-collab/claude-watch (MIT) | `03 - AI Development & Agents/claude-watch` | Lets Claude watch a video: scene-change frames + transcript | `SKILL.md` |
| emotixco/claude-skills-founder (MIT) | `03 - AI Development & Agents/claude-skills-founder` | Startup-founder skills: competitor matrix, pricing, GTM, fundraising, landing page, MVP scope… | 13 skills in `skills/` |

The other 200 entries on the insta-reels GitHub Repos page come from two "famous free repos" lists (large mainstream projects), not from the reels, so they are not imported here.

## Note about older folders

Some pre-existing Git repositories remain at this root because their `.git` directories have ownership restrictions that prevent a safe move. They have not been changed or deleted. The large `ode-motion-lessons` archive also remains at the root to avoid an unsafe multi-gigabyte relocation while disk capacity cannot be verified.

### 2026-11-01 iReels catalog comparison

The current iReels `main` catalog adds three repositories compared with the earlier 29-pick snapshot. Full shallow clones, with Git LFS downloads skipped, are in `01 - Video & Motion Graphics/`:

| Repository | Revision | Purpose and setup |
|---|---|---|
| `barckley75/resolve-claude-mcp` | `9398758` | MIT-licensed DaVinci Resolve MCP integration. It is a server, not a skill. Upstream says Windows support is unverified and the tools can change projects and run Python; the server has not been configured or run. |
| `Vibha-Ramprakash/claude-video-effects` | `99c9a33` | MIT-licensed talking-head effects skill, installed for Claude and Codex as `effects`. Its four core Python dependencies are unpinned, transcription may install another dependency and download a model, and its Unix-oriented setup needs Windows verification. No setup or video-processing code has been run. |
| `iamtechartist/every-joule-lesson1` | `48591dd` | Interactive 3D lesson reference. No `SKILL.md` or license was found in the repository root; preserve it as a local reference and check rights before reuse or distribution. |

The effects repository contains an optional local private-effects hook that executes `scripts/fx_private.py` if present. The downloaded revision did not include that file. Treat any added file and all dependency installation as code to review before running.

### Turbovec: local vector-search experiment

`03 - AI Development & Agents/turbovec/` contains a shallow clone of `RyanCodrai/turbovec` at `c3b043b992290ff223b903046af7f6683768241c` (MIT). `03 - AI Development & Agents/turbovec-runtime/venv/` contains an isolated Python installation of `turbovec==1.1.2` and NumPy. A locally authored companion skill is in `07 - Local Projects & Lessons/turbovec/`; it is not an upstream Turbovec skill. Its synthetic add/search/save/load test passes without reading course material.

Turbovec is potentially useful for a future semantic-search experiment when an embedding model and evaluated use case exist. It does not create embeddings, serve an API, or replace the site's browser-side keyword search or Graphify's relationship graph. Its compression is approximate: measure recall and performance with permitted representative data before any website integration. Do not index private materials or use a remote embedding service without appropriate authorization.
