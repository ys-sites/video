# After Effects + Claude — MCP Options

Researched Nov 17, 2026. There is no official Adobe After Effects MCP server.
Every live-session route is a community bridge. Adobe previewed native local MCP for
Photoshop, Illustrator, Premiere and After Effects (Nov 10, 2026) but it is private
beta planned for early 2027 and not publicly installable.

Key constraint: Claude must run on the same computer as After Effects (Claude Code or
Claude Desktop locally). Claude on the web (claude.ai) and ChatGPT web cannot reach
desktop After Effects.

## Options

### 1. @kumoproductions/mcp-aftereffects (0.3.2) — first pick for Claude Code
- Inspect and edit the open After Effects composition, preview changes, save an
  editable .aep. Read-only switch available.
- Requires: After Effects 2024–2026, macOS or Windows, Node.js 24+.
- After Effects preference "Allow Scripts to Write Files and Access Network" must be on.
- Claude Desktop config or `claude mcp add` for Claude Code.

### 2. @engine-room/after-effects-mcp — easiest install
- Claude Code plugin (`/plugin marketplace add Engine-Room-Games/after-effects-mcp`,
  then `/plugin install after-effects@engine-room`) or standalone
  (`claude mcp add --scope user after-effects -- npx -y @engine-room/after-effects-mcp`).
- Builds layers, keyframes, easing, effects, expressions and text — all editable
  afterwards. Tested on After Effects 2026; panel accepts 2022+.
- Claude Desktop: download the .mcpb file from the latest release and open it.
- Needs Node 22+. No render queue tools.

### 3. Higgsfield After Effects bridge — full pipeline, paid
- Hosted MCP `https://mcp.higgsfield.ai/mcp` (asset generation, 30+ image/video models)
  + bridge `https://bridge.higgsfield.ai/mcp` (drives the After Effects plugin).
- Claude builds compositions, animates layers, renders video, returns an editable .aep.
- Requires: paid Higgsfield subscription (no separate API key), After Effects 2025+,
  Higgsfield Adobe plugin installed. Plugin itself is free; generations cost credits.
- Also drives Premiere Pro and Blender through the same bridge.

### 4. Other community servers
- JUNKDOGE-JOE ae-mcp — CEP panel with checkpoint/revert tools.
- pouulll/after-effects-mcp-extended — 115+ commands plus Claude Code skills
  (ae-explainer-engaging, ae-sound-effects).
- Dakkshin after-effects-mcp.

## What this means for the Sumit style
- The Sumit style is built in After Effects by hand (roto, kinetic type, PiP collages).
  To have Claude do it, add one of the MCPs above to Claude Code on the machine that
  runs After Effects, then use the master prompt in `sumit-kelsie-edit-styles.md`.
- MotionSmith does NOT use After Effects (it renders motion graphics in the browser
  via Playwright) — it is a separate route, not an After Effects route.
- InVideo MCP only drives InVideo's editor, not After Effects.

Sources: aspect.inc (After Effects MCP guide, Nov 2026), npm @engine-room/after-effects-mcp,
voyager.so (After Effects AI), alphasignal.ai + ai-primer.com (Higgsfield Claude MCP, Sep 2026).
