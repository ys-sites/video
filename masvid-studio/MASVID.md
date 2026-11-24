# Masvid Studio

Your own video studio on this PC: OpenMotion's editor (timeline, preview, layers, captions, templates) with a **Claude chat panel** that edits the open video the way you ask, in the style you pick. Built from [OpenMotion](https://github.com/nexu-io/openmotion) `74a3d1e` (Apache-2.0, see `LICENSE` and `NOTICE`).

## Start it

Double-click **Masvid Studio** on the Desktop (or Start Menu → AI-Local video apps). It opens <http://localhost:4180/>. The button "Open editor" on masvid.vercel.app finds it there.

Manual start: `powershell -ExecutionPolicy Bypass -File masvid-studio\scripts\start-masvid-studio.ps1`

## Chat with Claude

Open a project; the **Claude** tab is on the right. Type what you want ("add yellow pop captions", "make it 9:16", "cut the first 3 seconds", "export an MP4"), optionally pick a **style** (your 14 site styles, the `vs-*` video skills, creator and lesson skills, OpenMotion recipes). Claude edits the project and the preview refreshes.

- Runs your installed Claude Code with your own login. No API key, nothing billed beyond your Claude plan.
- Claude gets only this studio's editing tools plus read-only file access (no shell, no file writes outside the studio's tools, none of your other Claude connectors).
- One conversation per project, saved in `openmotion-data/masvid-studio/`. "New chat" starts fresh.

## What changed from OpenMotion

| Area | Change | Files |
|---|---|---|
| Claude chat | Server bridge (ported from the master-studio prototype) and editor panel | `gateway/claude-chat.ts`, `server.ts`, `studio/src/components/panels/ClaudeChatPanel.tsx`, dock registry/layout files |
| Website link | `GET /api/ping` with CORS for masvid.vercel.app (private-network preflight) | `server.ts` |
| Free only | Paid providers removed from every list (OpenDesign Cloud and account, fal.ai, Atlas Cloud, WaveSpeedAI, Codex, paid API presets); local engines kept: ComfyUI, Ollama, LM Studio, LiteLLM, OVMS, OMLX, rapid-mlx, Claude Code | `shared/provider-registry.ts` |
| Privacy | Telemetry always off | `shared/tracking.ts` |
| Brand | Masvid Studio name, logo, favicon, title; no sales banner, Pricing, Discord or GitHub buttons | `packages/design-system/{index.js,studio.css,brand/masvid-*}`, `studio/index.html`, `studio/src/motion/{ApplicationChrome,campaignAttribution}.tsx/ts` |
| Your skills | `tools/sync_openmotion_skills.py` copies your skills and site styles into `library/skills/masvid-*` (generated, not committed) | `tools/` in the repo root |

## Still to do

- Explore/home page: replace OpenMotion's template showcase with your styles, reels and skills.
- Upload a clip from the chat (the Assets panel import works today).
- Switch your Claude Code `openmotion` MCP registration and the projects folder from the old `../openmotion` checkout to this studio (needs your OK: it stops the old server).
