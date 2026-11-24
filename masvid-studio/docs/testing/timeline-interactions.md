# Timeline interaction regression matrix

Use a disposable local project with two images, a video with audio, an audio file,
two overlapping clips that share an authored track, and a nested composition.
Keep fixtures and screenshots outside the checkout. Use the Node version in
the CI workflow and the normal Studio build. Do not test against production projects.

## Acceptance rules

- Splitting preserves the visible lane and exact adjacent boundaries.
- A drop uses the pointer's time and the row actually drawn, including scroll,
  centered row padding, track controls and zoom. Creating a row does not reset time.
- A known-duration collision resolves to the nearest free time on the intended row.
  Unknown media duration is provisional; metadata can change collision placement.
- Uploads show one placeholder per file before upload or probing completes.
  The placeholder survives saving until discovery supplies the real clip.
- Newly reserved loading rows are not editable drop targets until discovery gives
  them an authored identity. Their temporary layout keys must never enter source.
- Intentional edits preserve existing visible spill rows in the same source file
  and media zone. Locked peers cannot be silently renumbered. Canvas stacking is
  independent of horizontal timing edits.
- Drag cancellation and failed saves leave no partial source edit. Undo and redo
  restore the complete gesture. Project navigation drains the active edit before
  switching; scope changes cancel callbacks that no longer belong to the active editor.
- Trim grips align with the clip's outer borders. Their hit areas stay distinct
  on short clips and do not cover the effect badge.

## Scenario coverage

Automated tests are under `studio/src/`. Browser results below describe the
2026-11-15 computer-use run, not release acceptance or universal performance claims.
Browser passes identify the exercised variants; deterministic tests cover the listed
boundary combinations. An automated pass does not replace native transport evidence.

| Scenario and variations | Automated coverage | Computer-use result |
| --- | --- | --- |
| Split once, repeated cuts, floating-point seams; retain one lane | `player/components/timelineSplitLanes.test.ts`, `TimelineRazorInteraction.test.tsx`; `utils/timelineElementSplit.test.ts`, `razorSplitTransaction.test.ts` | Passed: image split into two adjacent clips on one row |
| Move horizontally into free time, clamp at zero, preserve relative selection offsets | `player/components/timelineClipDragCommit.test.ts`, `timelineClipDragPreview.test.ts` | Passed: same-row movement, multi-selection offsets, zero clamp and undo |
| Collision, snapping enabled/disabled, nearest free start | `player/components/timelineCollision.test.ts`, `timelineSnapping.test.ts` | Passed: collision rejected overlap; snapping off allowed 6.8 seconds, on snapped to 6.0 |
| Move to an existing lane, insert above/between/below lanes | `player/components/timelineClipDragCommit.test.ts` | Passed: existing-row move and insertion above, between and below rows; undo restored the original layout |
| Legacy spill row: horizontal move, save, actual adapter, rediscovery | `player/components/timelineLanePersistence.test.ts`, `timelineClipDragCommit.test.ts`; `hooks/timelineMoveAdapter.test.ts` | Passed after fixing the adapter operation: row 2 survived reload |
| Sparse authored indices, foreign source selection, audio/visual isolation | `player/components/timelineLanePersistence.test.ts`, `timelineClipDragCommit.test.ts` | Passed: video and audio drops retained separate media rows; sparse authored indices and foreign source selection have deterministic coverage |
| Locks reject dragging and required peer renumbering | `player/components/timelineLanePersistence.test.ts`, `timelineClipDragCommit.test.ts` | Passed: locked row did not move |
| Undo/redo lane insertion and timing; save rollback | `player/components/timelineClipDragCommit.test.ts`; `hooks/useRazorSplit.history.test.tsx` | Passed: undo returned to one row; redo restored row 2 |
| Trim start/end, minimum duration, linked/group constraints | `player/components/useTimelineClipDrag.resize.test.tsx` | Passed: right extension and left trim/undo preserved the row; linked/group constraints have deterministic coverage |
| Selected grip alignment, very short clip, FX hit area, zoom | `player/components/TimelineClip.test.tsx`; resize interaction tests | Passed: border centers measured, FX separated, pointer trim/undo and 10% zoom checked in light/dark; 800×900 left trim and FX menu also passed |
| Keyboard pickup, lane choice, commit and cancellation | `player/components/useTimelineClipDrag.keyboard.test.tsx`, `timelineKeyboardNavigation.test.ts` | Passed: Space pickup, Down lane selection, Enter commit and Escape cancellation |
| Empty timeline drop, nonzero time, sidebar/control-column offsets | `player/components/timelineLayout.test.ts`, `timelineDragDrop.test.tsx` | Passed: asset-card drop into an empty timeline at 4.89 seconds; placeholder appeared about 7 ms after drop |
| Populated centered rows, horizontal/vertical scroll, variable row heights | `player/components/timelineLayout.test.ts`, `timelineDragDrop.test.tsx` | Passed: centered rows; 456% zoom, horizontal scrolling and widened track controls retained pointer time |
| New-row external drop retains pointer time and reserves row geometry | `player/components/timelineDragDrop.test.tsx`, `timelinePendingRows.test.ts`; `hooks/useTimelineAssetDropFeedback.test.tsx` | Passed: top/bottom insertion at nonzero times, with stable reserved row during delayed save |
| Immediate feedback, delayed metadata and save, identity-based replacement | `hooks/useTimelineAssetDropFeedback.test.tsx` | Passed: immediate placeholders during 8-second upload/metadata/save delays; identity-based replacement retained row and start |
| Internal thumbnail carries both project MIME and browser Files | `player/components/timelineDragDrop.test.tsx`; `components/sidebar/AssetCard.test.tsx` | Passed after repair: reuses the existing asset, asset count unchanged; malformed-payload upload fallback has deterministic coverage |
| Batch upload: sequential placement, first file rejected/failed, one final refresh | `hooks/useTimelineAssetDropFeedback.test.tsx`, `useTimelineAssetDropOps.test.tsx` | Passed: native multi-file picker selected both images, placed sequentially at 0–3 and 3–6 seconds; failure/dismiss/retry also passed |
| Media probe, upload, save and preview failure; dismiss and retry | `hooks/useTimelineAssetDropFeedback.test.tsx` | Passed: injected upload/save/preview HTTP 503; per-file errors, floating Toast, dismiss and retry; save failure left source unchanged and preview timeout preserved the saved clip |
| Project/composition switch while work is pending | `hooks/useTimelineAssetDropFeedback.test.tsx`; `player/components/timelineDragDrop.test.tsx` | Passed: project navigation waited for the active edit to finish, then switched without adding it to the destination project; direct scope cancellation remains deterministic coverage |
| Refresh after an audio split, first frame, deferred playback, slow/failed media | `player/components/Player.test.ts`; shadow-reload/retry and `components/nle/NLEPreview.slowBoot.test.ts` | Passed: an isolated copy of the reported split-audio project revealed its first frame about 1.2 seconds after warm refresh; playback passed the 7.245-second split and activated the deferred second audio. Two-second-per-request media delays recovered; failed audio returned a visible first frame. Timer throttling and metadata-only audio/video have deterministic coverage |
| Blocks/compositions keep their own insertion contracts | `hooks/useTimelineBlockDropFeedback.test.tsx`, `useTimelineCompositionDropFeedback.test.tsx` | Automated |
| Pending reserved row rejects a second edit without saving a fractional index | `player/components/timelineDragDrop.test.tsx`, `timelinePendingRows.test.ts` | Passed: second native asset drag over a reserved row had dropEffect none and created no extra clip |
| 200 dragover events coalesce; release before RAF; edge autoscroll updates preview | `player/components/timelineDragDrop.test.tsx` | Automated; no measured FPS claim |
| Virtualized rows/clips, zoom, reduced-motion loading | `player/components/Timeline.virtualization.test.tsx`, `useTimelineGeometry.test.tsx`; shared design checks | Desktop light/dark inspected; actual 800×900 viewport verified for drag, loading/error recovery and selected grips in both themes |

## History response coverage

History restoration uses the same confirmed file delta for all edit commands. The timeline reconciles source-backed structural changes before waiting for a replacement preview; old preview messages cannot repopulate restored-away clips. Soft restores also refresh audio groups, FX/automation controls and expanded descendants. Unchanged scripted sub-compositions do not require a reload for ordinary timing/control attributes. Multi-file history reads run concurrently.

The 2026-11-18 local sample-project run measured Undo/Redo/Undo after a split at 48 / 34.4 / 36.6 ms to the correct timeline rows, and undoing a deletion at 36.2 ms. These operations still rebuild the preview asynchronously. A separate real-GSAP restore using dot-property timeline registration completed in place at 36.8 ms, restored its tween and preserved unrelated timeline objects. These are fixture-specific observations, not universal performance limits or native-keyframe-editor acceptance.

| Restore class | Deterministic coverage | Local browser evidence |
| --- | --- | --- |
| Move, trim, track and batch changes | `gsapUndoRestore.test.ts`, `timelineRestoreSync.test.ts`, `timelineHistoryRestore.test.ts`, timeline editing/group suites | Native trim commands and clip resize; undo/redo preserve file bytes |
| Volume, fades, mute/lock, FX and automation across files | Restore matrix and `automationStoreSync.test.ts` | Covered deterministically; no blanket native-UI performance claim |
| Split/delete/add row restoration | `timelineHistoryRestore.test.ts`, preview-persistence history integration and Razor/delete suites | Native split, Undo/Redo, delete and Undo; timeline responds before preview replacement |
| Keyframe/script changes | Script parsing, real-GSAP retiming and history restore suites | Direct restore through the actual preview GSAP runtime; dot registration and independent timelines checked |
| Audio-group/expanded sub-composition state | `timelineRestoreSync.test.ts`, group volume and automation suites | Covered deterministically |
| Concurrent work and delayed preview | Pending-history router tests; parallel file reads; project-switch/live-gesture tests | Old preview held while split/delete rows restore |

Runtime-generated structure, changed nested scripts, missing source snapshots and ambiguous identities retain runtime rediscovery/reload fallback. New media still needs decoding, and preview fidelity is distinct from prompt timeline feedback. New operations should use the shared history/restore path and extend this matrix rather than adding a separate undo stack.

## Repeatable browser sequence

1. Create a blank project. Upload image A through the native file chooser. Check
   immediate loading feedback, then the clip and preview. Repeat with multiple
   files and verify order and one final preview refresh.
2. Split A halfway. Confirm both halves share one row. Move the right half right,
   trim it, and move it below the occupied row. Reload, then undo and redo.
3. Lock the destination row and attempt another move. Unlock it. Repeat with
   audio, linked video/audio, a multi-selection and a nested composition.
4. Prepare overlapping same-authored-track clips. Move the second displayed row
   horizontally until it no longer overlaps. Reload and verify the row is retained.
5. Drag image/video/audio assets and OS files at nonzero times into empty space,
   existing rows and row gutters. Repeat after horizontal/vertical scrolling and
   changing zoom or track-control width. Record both release and loaded positions.
6. Hold a drag at each viewport edge, release before the next rendered frame,
   cancel outside the timeline, and change project during a delayed upload.
7. Select long and short clips at several zoom levels. Check both trim grips,
   FX menu, resize cursor and actual trims. Repeat in light/dark and narrow layouts.
8. Split a soundtrack so its second clip starts later. Refresh at zero and at a
   retained playhead position. Confirm the first frame appears while the second
   audio remains deferred, then play across the split and confirm its media clock
   advances. Repeat with delayed and failed audio responses; no extra ten-second
   wait may be caused by the deferred clip.

## Verification limits

Native asset-card dragover/drop and native multi-file picker upload were delivered
and verified. Finder-to-Chrome OS file dragging was attempted repeatedly, but the
computer-use native drag transport produced no browser drag/drop events. That
cross-application gesture remains unverified; file payload and fallback behavior
are covered deterministically, and actual file-picker upload is a separate pass.

Use an isolated disposable service for project-navigation tests. A loopback proxy
can delay upload, metadata or save responses and inject HTTP 503 failures without
changing application code. Record native event types, placeholder rectangles and
source snapshots. Do not infer performance from a screenshot: observed placeholder
latencies are fixture-specific, while RAF batching and release/autoscroll ordering
have deterministic coverage. Audio waveform decoding was unavailable in the local
fixture service; these checks do not establish audiovisual playback quality.
Reset temporary viewport, theme and proxy settings after testing.

Run `npm run check`, `npm run typecheck:studio`, `npm run build:studio`,
`npm run design:check` and `npm run test:studio` before publication. Check actual
CI separately. Installation, export fidelity and human visual acceptance are
outside this interaction matrix.
