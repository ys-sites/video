# ECC skills: when to use which

There are 27 skills from [affaan-m/ECC](https://github.com/affaan-m/ECC) (MIT, commit `4adeee6`) installed as project skills in `.claude/skills/ecc-*`. Claude Code loads them automatically in this folder. Each `SKILL.md` ends with a "This workspace" section that adapts it to this machine. That section, `AGENTS.md`, and `docs/MASTER-ROUTER.md` take precedence over the upstream text. The triage and exclusions are recorded in `resources/repo-catalog/quarantine-triage-20261123-ecc.md`.

The ECC skills add to the existing routes; they do not replace them. Pick the workspace route first, then layer the ECC skill on top.

## Video

| Request | First route | ECC skill to add |
|---|---|---|
| Cut or structure real footage (vlog, tutorial, long to short) | `skills/creator-video/SKILL.md` | `ecc-video-editing`: FFmpeg cutting and the layer pipeline, with free local generation and voice |
| Music video, fancam, or a deliberately aesthetic edit | Creator route | `ecc-taste`: mood, colour, and beat grammar |
| Technical explainer with graphs or diagrams | `skills/study-video/SKILL.md` | `ecc-manim-video` (Manim is not installed; ask before installing it) |
| Demo or walkthrough video of the website | — | `ecc-ui-demo`: Playwright recording, then finish in Remotion |
| Post a finished vertical video to TikTok, Shorts, or Reels | — | `ecc-short-video-distribution`: platform checks, captions, and approval. With no publisher connected, it produces a manual upload sheet |

## Website (masvid.vercel.app and the `/editor/` Vite app)

| Request | ECC skill |
|---|---|
| Visual direction, polish, spacing, typography | `ecc-frontend-design-direction`, `ecc-make-interfaces-feel-better`, `ecc-design-system` |
| UI animation in the editor app | `ecc-motion-foundations` → `ecc-motion-patterns` → `ecc-motion-advanced` |
| React, TypeScript, or Vite code | `ecc-react-patterns`, `ecc-typescript-patterns`, `ecc-vite-patterns`, `ecc-frontend-patterns` (for performance, use `vercel:react-best-practices`) |
| Accessibility | `ecc-accessibility`, `ecc-frontend-a11y` |
| Search visibility | `ecc-seo` |
| Tests and verification | `ecc-react-testing`, `ecc-e2e-testing`, `ecc-browser-qa` (with REA or Chrome), `ecc-verification-loop` |
| Passive security check of our own hosts | `ecc-web-perimeter-owasp-2025-audit` (only masvid.vercel.app and the masvid-uploads worker) |

## Content and growth

| Request | ECC skill |
|---|---|
| Content system across platforms | `ecc-content-engine` (drafts only; it never posts) |
| Writing-voice profile | `ecc-brand-voice` (Kelsey material stays internal) |
| Launch or campaign plan | `ecc-marketing-campaign` (use with `docs/motionsmith-workflow.md` for product promos) |
| "Is there already a tool for this?" | `ecc-search-first`, followed by the quarantine rules in master router section 4 |

## Not installed

The ECC plugin, hooks, installers, Rust and Node runtime, and MCP configurations were not installed. The excluded skills, with reasons, are listed in the triage file.
