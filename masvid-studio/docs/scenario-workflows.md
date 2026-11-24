# Scenario Workflows

**Workflows** (backed by OpenMotion's scenario workflow contract) guide end-to-end production from a single creative idea through web pages, visual assets, video and motion films, audio, multi-platform social copy, and one downloadable ZIP package. Each workflow supports two modes in one workspace — **Step by step** (`manual`) for hands-on iterative creation and **Agent mode** (`agent`, `?mode=agent`) for concise prompt + Skills delegation to an external MCP Agent — backed by shared versioned runs and a unified **Assets** collection.

## Workflow taxonomy

Workflows are organized into three categories under **Workflows** in the top navigation (`?page=scenarios`), its hover mega popover, the Explore hero carousel, and the Workflows highlights rail:

| Category | Workflow / Scenario ID | Title | Ordered steps |
| --- | --- | --- | --- |
| **Topics** (`topic`) | `motion-full-chain` | Idea to Motion Film | Brief → Storyboard → Motion film → Soundtrack → Social posts |
| **Topics** (`topic`) | `gemini-4-neon` | Interactive Code Animation | Brief → Code animation → Key stills → Film & motion → Social posts |
| **Topics** (`topic`) | `design-full-chain` | Landing Page & Launch Kit | Brief → Landing page → Page images → Embed images → Promo video → Social posts |
| **Campaigns** (`campaign`) | `black-friday` | Black Friday Promo Kit | Brief → Product images → Detail page → 30s sales film → Social posts |
| **Roles** (`role`) | `ai-influencer` | Virtual Creator Episode | Brief & script → Persona visuals → Link-in-bio page → Voiceover & audio → Talking video → Social posts |

Every step carries curated `ScenarioSkillRef` bindings (`step.skills[]`) identifying either a curated Studio library Skill (`source: 'library'`, loaded via `openmotion_get_skill(skillId)`) or a workflow resource guide (`source: 'workflow'`, loaded via MCP `resources/read` on `resourceUri` such as `openmotion://workflow/*`). Existing Studio destinations (Motion Studio, Design Studio, Cinema Studio, Model Hub, Black Friday collection, Template library, Skills) remain directly reachable from navigation and context links inside each workflow.

## Dual workspace modes and Assets

Opening any workflow navigates to `?page=scenario&scenario=<id>[&run=<uuid>][&mode=agent][&step=<stepId>]` (defaults to **Step by step** unless `mode=agent` is requested).

- **Run header:** displays the workflow cover, **All workflows** breadcrumb, workflow title and category badge, **Workflow mode** segmented switch (**Step by step** vs **Agent mode**), run switcher (create, rename or archive drafts), contextual **Copy for Agent** (header action in Step-by-step mode), desktop toggle to collapse/reopen **Assets**, and **Export all** (builds and downloads a full ZIP bundle directly).
- **Agent mode (`?mode=agent`, `ScenarioAgentModeView.tsx`):** renders a clean two-column workspace:
  - **Left column — Assets + Prompt & parameters:** inline shared **Assets** panel at the top (so users can upload, import, select, pin, and inspect attached reference assets cleanly), paired below with a **Prompt & parameters** composer featuring one-click `Try:` brief presets, **Clear**, a large natural-language `Prompt` textarea, primary scenario fields, and progressive-disclosure secondary parameters (**More parameters** / **Hide parameters**) synchronized directly to the persisted run brief, plus a direct **Switch to step by step** link.
  - **Right column — Copy for Agent + Skills workflow:** centers the primary **Copy for Agent** CTA (auto-creating a persisted run when invoked on an unsaved draft and copying compact output from `scenarioConcisePrompt`), quick **Sync** and **MCP guide** actions, a **Preview prompt** / **Hide prompt** toggle inspecting the generated concise instructions, and a grouped **Skills workflow** timeline displaying every step's `ScenarioSkillRef` chips (`role`, `id`, version count, status) with direct click-through (`Open {step} in step-by-step mode`).
- **Step by step mode (`manual`):** combines the non-linear step navigation rail (**Workflow steps**, allowing direct jumps to any step with sensible upstream default bindings and without locking downstream steps), a single guided brief/creation workbench (**Generate media** for direct image/video/audio generation into **Assets** via configured providers, **Copy MCP prompt**, **MCP guide**, **Sync**, progressive disclosures for reuse/templates, live preview, per-step export actions, and **Version history** `v1…vn`), and the collapsible **Assets** sidebar.
- **Assets collection & pinning:** docked on the right at desktop widths (`>= 1100px`) in Step-by-step mode (`240–520px` resizable drawer, opaque medium-width drawer `768–1099px`, mobile bottom sheet `< 768px`) or placed inline at the top left in Agent mode. Empty zero-count filter chips stay hidden until populated. Supports single, multi-select (`Select`), and bulk **Import** / **Export** (`Export all`, `Export selected`, `Export filtered`). Every uploaded, imported, or generated asset is stored as a **pinned reference** (`assetId/versionId`, Design `projectId/revision`, Motion `projectId/sessionId`) without duplicating media bytes; **Remove from workflow** unbinds only the workflow reference without deleting workspace assets.
- **Automatic cross-tab sync:** window focus, tab `visibilitychange` back to `visible`, and manual **Sync** actions refresh the active run and highlight newly added items in **Assets**.

## Export and packaging

- **Per-step export:** every step header offers a lightweight menu for immediate deliverables (HTML/ZIP for Design pages, direct downloads for active media files, Markdown/JSON copy or download for social packs and briefs, editor links, and step-scoped ZIP packages).
- **Single, multi-select, filtered, and full bundle export:** **Assets** and top-bar **Export all** build validated ZIP archives via `openmotion_assets_use(action="scenario", scenario={ command: "export", poolItemIds?: [...], ... })` and stream them from `GET /motion-api/scenarios/bundles/:id/file`. A full bundle contains `manifest.json`, `README.md`, `brief/`, unpacked `web/<step-id>/` pages (with embedded local `assets/*` paths that open from disk), optional standalone HTML, pinned `media/` outputs, `social/` posts, `motion/` project links, and optional Motion source archives; passing `poolItemIds` packages only the chosen items alongside `manifest.json`.
  Studio's **Export all** includes media from previous iterations by default. The ZIP uses the localized draft title, and media files use their displayed titles with their original version numbers and file extensions. Enable **Active outputs only** in the Assets export options to restrict which iteration outputs are included.
  When present, the saved script and social copy match the versions shown in Studio. A newer brief or asset-only version still leaves those files and the copy's attached media available for export.

## MCP and Agent integration

Workflows preserve the twenty-two registered phase-one MCP tool names and share one backend domain service (`gateway/scenario-runs.ts`) across Studio and external Agents:

- **Workflow / scenario orchestration:** `openmotion_assets_use` with `action="scenario"` exposes `catalog`, `list`, `get`, `create`, `update_run`, `update_brief`, `update_step`, `add_pool`, `update_pool`, `remove_pool`, `add_iteration`, `generate`, `sync`, `cancel`, `promote`, `create_page`, `embed_image`, `link_design`, `create_motion`, `link_motion`, and `export`. Mutations carry explicit `runId`, `expectedRevision`, and a stable `requestId`; `add_pool` accepts optional `recordIteration=true` and `note` to write Agent-processed workspace assets back into both **Assets** and the target step's version history atomically.
- **Concise Skills handoff (`scenarioConcisePrompt` & `ScenarioSkillRef`):** in **Agent mode** (`?mode=agent`), clicking **Copy for Agent** (or inspecting **Preview prompt**) formats compact `[Metadata]`, `[Task & Parameters]`, `[Skills Pipeline]`, and `[Instructions]` via `scenarioConcisePrompt` in `shared/scenarios.ts`. Instead of repeating prose instructions per step, it lists each step's Skills cleanly as `library:<skillId>` (loaded by the Agent via `openmotion_get_skill(skillId)`) or `resource:<resourceUri>` (loaded via MCP `resources/read`, e.g., `openmotion://workflow/*`). `scenarioSkills(scenario)` exposes the deduplicated Skill list per workflow.
- **Step-scoped MCP write-back:** `scenarioAgentPrompt` and `scenarioRunAgentPrompt` in `shared/scenarios.ts` continue to power per-step **Copy MCP prompt**, Step-by-step **Copy for Agent**, and the **MCP · Connect Agent** handbook (`Run a workflow and save back to Assets`). Copying from a fresh draft creates and persists the run first so every copied instruction carries `runId`, `expectedRevision`, `stepId` (when step-scoped), attached **Assets**, and exact MCP write-back commands (`generate` + `sync`, `add_pool` with `recordIteration=true`, `add_iteration`, `link_design`, `link_motion`, `update_brief`).
- **Binary image embedding into HTML projects:** `openmotion_design_edit` with `action="import_asset"` (and `POST /motion-api/design/projects/:id/import-asset`) copies a pinned workspace asset version into a Design Studio project via `DesignProjects.importBinaryFile()`, creating a new revision-checked `vN` snapshot and returning its project-relative path.

Workflow audio and video generation saves assets as `Draft title · Step name vN`. The optional `generate.locale` localizes the step name and the default draft name. Studio passes the current interface locale, and external callers can omit it to use the saved draft locale. Custom draft names are used as entered.

See [MCP Phase 1 tools](mcp-phase1-tools.md) and [Product architecture](product/architecture.md#scenario-workflows) for contract details.

## Capability boundaries

- **No built-in text or design LLM:** offline starter HTML pages, script outlines, and multi-platform social drafts are deterministic templates seeded from your brief. AI-authored HTML pages and copy come from your connected external Agent via the shared Skills handoff prompt.
- **Provider-backed media generation:** image, video, speech, and music generation use your configured providers in **Model providers** (OpenDesign account or BYOK). When no compatible model is configured, steps show a setup panel alongside offline upload, workspace-asset import, and Agent handoff alternatives without fabricating results.
- **Export-only social packs:** social posts are drafted, edited, copied, and exported as Markdown/JSON/text files; OpenMotion does not publish directly to social platforms.
- **Distinct verification evidence:** automated unit/DOM checks, browser visual checks across light/dark themes and viewports, paid model generation, and human visual acceptance remain separate evidence.

## Adding a new Topic, Campaign or Role workflow

Navigation, Explore, the Workflows hub, the MCP catalog, and run persistence all read from the shared registry. Adding a new workflow requires four changes:

1. **Register the definition** in `shared/scenarios.ts` (`scenarioDefinitions`), specifying `id`, `category` (`topic | campaign | role`), `title`, `subtitle`, `description`, `icon`, `links`, `briefFields`, and ordered `steps` (referencing valid `studioScenes` IDs, `RemixIcon` names from `packages/design-system/icons.svg`, and `skills: ScenarioSkillRef[]` entries pointing to curated `library` Skills or `workflow` resource URIs).
2. **Add a local cover mapping** in `studio/src/scenario/scenarioCovers.ts`.
3. **Add translations across all 10 non-English locales** in `studio/src/i18n/scenario-ui.json` — covering title, subtitle, description, fields, steps, and every `skill.label` / `skill.role` (preserving `{placeholders}`, `openmotion_*` tool names, and using `项目` rather than `工程` in `zh-CN`).
4. **Optionally add a starter page recipe** in `shared/scenario-content.ts` if the scenario introduces a new `PageRecipeId`.

Validate changes with:

```bash
npm run check
npm run design:check
npm run typecheck:backend
npm run typecheck:studio
npm run test:studio -- src/i18n src/motion/ScenarioNavigation.test.tsx src/motion/WorkspacePageNavigation.test.tsx src/motion/workspacePageRouting.test.ts
node --experimental-strip-types --test tests/mcp-onboarding.test.ts tests/scenario-runs.test.ts tests/scenario-content.test.ts tests/scenario-bundle.test.ts
```
