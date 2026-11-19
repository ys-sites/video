# Animation style system

Run `npm.cmd run dev` and open the local URL Vite prints. Select a style, enter a story, beats and assets, select a destination, then copy or download the production brief. Drafts and imported profiles are saved in this browser's local storage; download briefs for portable copies. Clearing browser data removes the saved draft.

The first profile is derived from the user-provided `Vox guide.md` and `Vox Explainer Guide - justdodani.pdf`. The page preview is a code-drawn illustration of the paper-collage direction, not a produced video, a reconstruction of the reference artwork, or a guarantee of visual fidelity. No image generation, video rendering, Resolve composition, or model call happens in this app.

The **Talking-head captions** profile uses the user's supplied captions-reel guide and Motion Video Director 3.5.2 plugin guidance. It plans editable captions around checked speech timing, two contrasting type roles, depth around the subject, restrained sound and frame-specific revision. It does not transcribe, matte, edit footage or render a reel itself. See `docs/captions-reel-workflow.md` and the accompanying review-note template. Keep the licensed plugin private and apply its guidance only to appropriate projects.

The **Creator vlog** profile is a general footage-led starting point. **Kelsey · creator reel** uses the six selected `kelssie3` references as editing evidence, with the excluded formats preserved separately. Both produce planning briefs; the app itself does not render videos. For future requests in this workspace, `skills/creator-video/SKILL.md` routes phrases such as "vlog implementation" and Kelsey-style edits, with local source ingestion through `tools/ingest_video_reference.py`.

For an editing project with separate good/bad references, editable rule books and optional style-comparison plans, see `docs/creator-editor-workflow.md`. These are independently authored starter rules, not the private or paid materials described in the video.

`resources/creator-styles/sources/` holds separate SHA-256-verified packages from the two source editors. Their accompanying `.manifest.json` files record the copied files. `resources/creator-styles/graphify-out/` contains the local Graphify index; `scope.json` records what it covers. The graph describes selected text and media inventories, not a full analysis of every video frame or audio track. Rebuild the package index after additional local imports with `python tools/build_creator_graph.py`, then run `graphify export html` from `resources/creator-styles`.

## Adding a style

Choose **Export profile**, edit the JSON, and import it through **Import a style profile**. Give every profile a unique `id`; each text field is required. `motion` and `pieces` must be nonempty arrays of strings. Use `source` to identify the reference and `promptSuffix` for its own asset prompt guidance. The current Vox profile remains available. Profiles describe direction; custom profiles do not automatically supply a rendered preview or editor integration.

## Production handoff

The exported brief provides the style rules, user inputs, suggested pieces and local reference paths for an assistant such as Claude Opus 5.5. The recipient must have access to those local files. The app does not connect to Claude, provide credentials, or submit content to a provider. Review the plan and approve image generation or final production separately, as requested by the supplied guide. User-supplied story facts and asset rights require review. Select the actual editor and check its current capabilities before creating a project.

## Resource routing

- `resources/concordia/motion-video-director`: planning, timing and review guidance.
- `resources/concordia/video-motion/design-motion-principles`: design and motion reference.
- `resources/concordia/video-motion/motionmaxxing`: motion direction reference; review scripts and external services before execution.
- `resources/concordia/video-motion/react-three-fiber` and `drei`: source references for optional 3D scenes, not installed renderer integrations.
- `resources/concordia/3d/product-layout/CREDITS.md`: provenance for the local industrial GLB assets. Use only when relevant and honor asset rights.

Those resources are local reference copies and are not automatically run. Choose only material that serves the user's specific style and story; the guide's paper aesthetic and editorial clarity take priority over unrelated promotional defaults.

## Cloud Master Video Styles integration

`master-video-styles/` (pulled from `origin/main` commit `d1b0d95`) adds 17 style playbooks, 166 studied reference reels, a 12-move motion dictionary, an 18-tool reference map, and 5 markdown playbooks/prompts. `src/masterStylesData.ts` imports `master-video-styles/data/styles.json`, `master-video-styles/data/reels.json`, and the markdown files directly as a single source of truth, merging the 17 cloud styles into `builtInStyles` in `src/styles.ts` (37 total built-in profiles) and surfacing the full catalog in `src/App.tsx` while preserving all 20 original profiles and browser `localStorage` drafts.
