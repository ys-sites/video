# Unchanged template export: Product Promo case measurement

## Result

| Wall-clock boundary | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Creation brief starts to files and checks ready | 333.281 s | 69.959 s | 79.0% |
| Creation brief starts to final delivery reply | 359.905 s | 195.176 s | 45.8% |

The second boundary includes composing the comparison report in the optimized run. Files-ready is not user-visible delivery. Skill development, installation and local code checks were completed before the replay clock started. These are one historical baseline and one warm replay, not a randomized benchmark or an average latency guarantee.

## Comparable input and environment

- Prompt: select Product Promo (`product-promo`), preserve the sample content, main motion and style, and deliver HTML plus MP4; no extra content requirements or attachments.
- Both runs: the same installed source runtime at `35df3061eea4deb644c6678e23c0371839f62bd2`, the same engine/dependencies and template, on macOS arm64 (Apple M5 Pro). Output: 20 s, 1920×1080, 30 fps, silent. The optimized Skill changes were developed on `6287078dcae3075aeb6e6f5670eeecef3da95872`; the running application was not upgraded for the replay.
- Baseline: user brief at 2026-11-16 16:04:24.236 +08:00, final reply at 16:10:24.141. The optimized replay started at 2026-11-16T08:31:17.640Z and ended at 2026-11-16T08:34:32.816Z.
- The optimized run reused the current chat context and warmed runtime/resource caches. A deterministic client of the same registered stdio MCP transport replaced repeated interactive WebMCP calls. This measures the combined Skill/execution workflow; it does not isolate the effect of instruction text.

## Optimized checkpoints

| Checkpoint | Seconds since replay start |
| --- | ---: |
| replay_started | 0.172 |
| workspace_template_verified | 1.257 |
| project_created | 2.501 |
| source_pinned | 4.935 |
| html_packaged | 4.999 |
| export_requested | 6.187 |
| rendering | 7.481 |
| completed | 21.927 |
| mp4_verified | 21.935 |
| playback_ready | 22.053 |
| playback_verified | 68.754 |
| files_checks_ready | 69.959 |

## Artifact and playback verification

- One new project and one new export request were used. The previous MP4 was not copied as the new render. No original project, job or result was overwritten.
- Entry HTML and all three composition HTML files matched the template after removing automatically stamped `data-hf-id` attributes. No authored copy, timing, animation or assets were rewritten.
- The newly rendered MP4 matched the baseline byte-for-byte: SHA-256 `7ed11896a193b0d86b28b7df251014ae9b85257e8bf9a9842ecc6926adefaa13`.
- OpenMotion's completed-job verifier passed file/container, H.264/yuv420p, dimensions, 30 fps, silent policy, 20 s/600 frames, full decode and first/middle/last seek checks.
- The actual new MP4 played through at normal speed in Codex IAB: ended at 20 s, measured playback 20.002 s. Seek targets 0/10/19 s loaded with readyState 4; replay advanced to 0.2603 s; final player state was paused at zero.
- HTML packaging retained local dependencies, licenses and native identity, checked source hashes before/after copying, and produced a ZIP with a receipt.
- Native editor presentation was requested twice and remained queued at the observation point. No new native project tab was observed. File delivery was reported separately; visible editor delivery was not claimed.
- Independent aesthetic acceptance was not performed. The sample is intentionally silent, so no audible soundtrack review is claimed.

## Local code validation

Node.js 26.11.1, matching the repository CI pin:

```sh
npm run check
npm run typecheck:studio
npm run build:studio
node --experimental-strip-types --test tests/template-delivery.test.ts tests/workflow.test.ts tests/mcp-onboarding.test.ts tests/adapters.test.ts
node --experimental-strip-types --test --test-name-pattern='unchanged export|ZIP stores|onboarding Skill' tests/package.test.ts
npm run test:studio -- studio/src/motion/McpConnectionPage.test.tsx
git diff --check
```

The scoped tests passed (19 backend/workflow/helper/adapter tests, 3 lightweight packaging tests and 4 Studio MCP-page tests), alongside syntax/design, type and build checks. The full distribution test was attempted but requires optional showcase media absent from the clean source snapshot (first missing file: `docs/readme/brand-hero.ja.jpg`); it is not represented as passed. The lightweight test verifies the positive distribution inventory, new MCP reference and helper inclusion for both profiles without downloading unrelated showcase media. Remote CI is recorded on the PR's final head separately.

## Reproduction

Use the installed `openmotion://workflow/template/unchanged` guidance and issue the same brief. Request a fresh export for a timing replay, retain the actual project/revision/version and export identity, and run the shipped packaging/playback helpers against those returned files. Record both files-ready and final-reply boundaries. Stop at the requested file stage and report any unavailable editor presentation; do not infer native visibility from a queued acknowledgment.
