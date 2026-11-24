import { resolveTimelineResize } from "./timelineEditing";
import {
  applyClipStartTrimDelta,
  clipStartTrimDeltaBounds,
  resolveTimelineMinDuration,
} from "./timelineGroupEditing";
import type { TimelineElement } from "../store/playerStore";
import { clampToHostStart, savedClipEdges } from "../store/timelineElement";
import {
  CLIP_Y,
  TRACK_H,
  getTimelineRowGeometry,
  type TimelineRowGeometry,
} from "./timelineLayout";
import {
  isMusicTrack,
  isAudioTimelineElement,
  isStillImageTimelineElement,
} from "../../utils/timelineInspector";
import {
  stickyTimelineTime,
  TIMELINE_SNAP_PX,
  type TimelineSnapTarget,
  type TimelineSnapType,
} from "./timelineSnapping";
import { resolveInsertRow, resolveZoneDropPlacement, type TimelineDropPlacement } from "./timelineCollision";
import {
  applyTimelineGroupResizePreview,
  type TimelineGroupResizeSession,
} from "./timelineGroupEditing";
import { groupMoveFloor, resolveGroupMovers } from "./timelineMultiDragPreview";
import type { DraggedClipState, ResizingClipState } from "./timelineClipDragTypes";
import { useLinkedClipPreferences } from "../../utils/linkedClipPreferences";
import { heldAudioShiftRange, heldPartnerVideoBounds } from "./audioClipLink";
import { snapOpenReelMove } from "./timelineDragSnap";
import { canMoveTimelineElement, resolveExpandedHostAlias } from "./timelineAuthoredMoveTarget";
import { findBlockedTrackInsert, layoutAfterTrackInsert } from "./timelineDragLanding";
import type { TimelineTrackInsertLayout } from "./timelineTrackInsertLayout";
import { isPendingTimelineRow } from "./timelinePendingRows";
import { previewClipInsert } from "./timelineClipInsert";
import { timelineSpansOverlap } from "./timelineTimeBounds";
import { roundTo3 } from "../../utils/rounding";

/** Snap-target builder closure supplied by the hook (closes over refs + store). */
type BuildSnapTargets = (
  excludeElementKey: string | null,
  includeBeats: boolean,
  includePlayhead?: boolean,
) => TimelineSnapTarget[];

export interface DragPreviewContext {
  scroll: HTMLDivElement | null;
  pps: number;
  duration: number;
  trackOrder: number[];
  rowHeights?: readonly number[];
  rowGeometry?: TimelineRowGeometry;
  allowedInsertRows?: ReadonlySet<number>;
  groupTracks?: ReadonlyMap<number, readonly number[]>;
  trackInsertLayout?: TimelineTrackInsertLayout;
  elements: TimelineElement[];
  selectedKeys: ReadonlySet<string>;
  buildSnapTargets: BuildSnapTargets;
  /**
   * The set of tracks that hold audio clips (drives zone-aware drop placement).
   * Frozen for the whole gesture, so the hook builds it ONCE at drag start and
   * passes it in — see useTimelineClipDrag. Absent (e.g. in unit tests) ⇒ built
   * on demand from `elements`, so the result is identical either way.
   */
  audioTracks?: ReadonlySet<number>;
  /** Seconds between the ruler's lines; 0 or absent when snapping is off. */
  gridStep?: number;
  canInsertClips?: boolean;
}

export function createKeyboardClipDrag(
  element: TimelineElement,
  insertRow: number,
  scrollLeft: number,
  scrollTop: number,
): DraggedClipState {
  return {
    pointerId: null,
    element,
    insertRow,
    started: true,
    previewStart: element.start,
    previewTrack: element.track,
    desiredTrack: element.track,
    originClientX: 0,
    originClientY: 0,
    originScrollLeft: scrollLeft,
    originScrollTop: scrollTop,
    pointerClientX: 0,
    pointerClientY: 0,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    snapTime: null,
    snapType: null,
  };
}

/** Content-space position for the stable viewport drag actor. */
export function getTimelineDragOverlayPosition(
  drag: DraggedClipState,
  scroll: Pick<HTMLDivElement, "scrollLeft" | "scrollTop" | "getBoundingClientRect"> | null,
): { left: number; top: number } | null {
  if (!drag.started || !scroll) return null;
  const rect = scroll.getBoundingClientRect();
  return {
    left: drag.pointerClientX - rect.left + scroll.scrollLeft - drag.pointerOffsetX,
    top: drag.pointerClientY - rect.top + scroll.scrollTop - drag.pointerOffsetY,
  };
}

/**
 * Max start a drag may reach. Allow dragging past the current content into the
 * rendered timeline extent (the viewport-fill keeps that ≥ the viewport width).
 * The composition grows to fit on commit (content-driven duration), so don't
 * cap at content length.
 */
function resolveDragMaxStart(scroll: HTMLDivElement | null, pps: number, duration: number): number {
  return Math.max(duration, scroll && pps > 0 ? scroll.scrollWidth / pps : duration);
}

const INSERT_SEAM_PX = CLIP_Y;

function physicalInsertRow(
  rowFloat: number,
  y: number,
  ctx: Pick<DragPreviewContext, "trackOrder" | "allowedInsertRows">,
  geometry: TimelineRowGeometry,
) {
  const boundary = Math.round(rowFloat);
  const nearSeam = Math.abs(y - geometry.getRowTop(boundary)) <= INSERT_SEAM_PX;
  const row = nearSeam
    ? Math.max(0, Math.min(ctx.trackOrder.length, boundary))
    : resolveInsertRow(rowFloat, ctx.trackOrder.length);
  if (row !== null && ctx.allowedInsertRows && !ctx.allowedInsertRows.has(row)) return null;
  return row;
}

function dragRowAim(
  drag: DraggedClipState,
  clientY: number,
  ctx: DragPreviewContext,
  geometry: TimelineRowGeometry,
) {
  const scrollTop = ctx.scroll?.getBoundingClientRect().top ?? 0;
  let y = clientY - scrollTop + (ctx.scroll?.scrollTop ?? 0);
  // Pointer seams are line-only: crossing them never opens or captures a row.
  // Keyboard pickup still reserves a lane, so retain its expanded geometry.
  if (drag.pointerId === null && drag.started && drag.insertRow !== null) {
    const top = geometry.getRowTop(drag.insertRow);
    if (y >= top - INSERT_SEAM_PX && y <= top + TRACK_H + INSERT_SEAM_PX)
      return { rowFloat: drag.insertRow, insertRow: drag.insertRow };
    if (y > top + TRACK_H) y -= TRACK_H;
  }
  const rowFloat = geometry.getRowFromY(y);
  const originY = drag.originClientY - scrollTop + drag.originScrollTop;
  if (drag.pointerId !== null && Math.floor(rowFloat) === ctx.trackOrder.indexOf(drag.element.track) &&
      Math.abs(y - originY) <= INSERT_SEAM_PX) return { rowFloat, insertRow: null };
  return { rowFloat, insertRow: physicalInsertRow(rowFloat, y, ctx, geometry) };
}

/** The drop decision for the pointer's row (see resolveZoneDropPlacement). */
function resolveDropPlacement(
  drag: DraggedClipState,
  aim: ReturnType<typeof dragRowAim>,
  previewStart: number,
  desiredTrack: number,
  ctx: DragPreviewContext,
  group: GroupDrag,
): TimelineDropPlacement {
  const { trackOrder, elements } = ctx;
  if (isPendingTimelineRow(desiredTrack, elements)) {
    return { track: drag.element.track, start: drag.element.start, insertRow: null };
  }
  const dragKey = drag.element.key ?? drag.element.id;
  const audioTracks =
    ctx.audioTracks ?? new Set(elements.filter(isAudioTimelineElement).map((e) => e.track));
  const blockedTracks = new Set<number>();
  if (group.movers.length > 1) {
    const start = Math.max(0, previewStart, group.floor);
    const delta = start - drag.element.start;
    const grabbed = savedClipEdges(drag.element, start);
    // Other selected clips retain their rows and travel with the grabbed clip.
    for (const mover of group.movers) {
      if (mover.track === drag.element.track) continue;
      const peer = savedClipEdges(mover, Math.max(0, roundTo3(mover.start + delta)));
      if (timelineSpansOverlap(grabbed.start, grabbed.end, peer.start, peer.end)) blockedTracks.add(mover.track);
    }
  }
  return resolveZoneDropPlacement({
    order: trackOrder,
    audioTracks,
    elements: group.obstacles,
    desiredTrack,
    deliberateInsertRow: aim.insertRow,
    allowedInsertRows: ctx.allowedInsertRows,
    groupTracks: ctx.groupTracks,
    blockedTracks,
    start: previewStart,
    duration: drag.element.duration,
    dragKey,
    isAudio: isAudioTimelineElement(drag.element),
    minStart: group.floor,
    origin: { track: drag.element.track, start: drag.element.start },
  });
}

interface GroupDrag {
  /** Clips the grabbed clip may not overlap: everything but the clips that move with it. */
  obstacles: TimelineElement[];
  /** Lowest start the grabbed clip may take (see groupMoveFloor). */
  floor: number;
  moving: ReadonlySet<string>;
  movers: readonly TimelineElement[];
}

const groupCache = new WeakMap<readonly TimelineElement[], WeakMap<ReadonlySet<string>, Map<TimelineElement, GroupDrag & { shift: ReturnType<typeof heldAudioShiftRange>; hasReadOnlyRows: boolean }>>>();

/** Selection and source snapshots are fixed for a gesture; only its landing changes. */
function preparedGroup(drag: DraggedClipState, ctx: DragPreviewContext) {
  let selections = groupCache.get(ctx.elements);
  if (!selections) { selections = new WeakMap(); groupCache.set(ctx.elements, selections); }
  let groups = selections.get(ctx.selectedKeys);
  if (!groups) { groups = new Map(); selections.set(ctx.selectedKeys, groups); }
  const cached = groups.get(drag.element);
  if (cached) return cached;
  const group = resolveGroupDrag(drag, ctx);
  const prepared = {
    ...group,
    shift: heldAudioShiftRange(group.movers, ctx.elements, group.moving),
    hasReadOnlyRows: ctx.elements.some(element => element !== drag.element && !canMoveTimelineElement(element)),
  };
  groups.set(drag.element, prepared);
  return prepared;
}

function resolveGroupDrag(drag: DraggedClipState, ctx: DragPreviewContext): GroupDrag {
  const movers = resolveGroupMovers(
    ctx.elements,
    ctx.selectedKeys,
    drag.element.key ?? drag.element.id,
  );
  if (!movers) {
    const moving = new Set([drag.element.key ?? drag.element.id]);
    return { obstacles: ctx.elements, floor: groupMoveFloor(drag.element, []), moving, movers: [drag.element] };
  }
  const moving = new Set(movers.map((e) => e.key ?? e.id));
  return {
    obstacles: ctx.elements.filter((e) => !moving.has(e.key ?? e.id)),
    floor: groupMoveFloor(drag.element, movers),
    moving,
    movers,
  };
}


/** Recompute the dragged-clip preview (move + snap + group clamp + drop placement). */
export function computeDragPreview(
  drag: DraggedClipState,
  clientX: number,
  clientY: number,
  ctx: DragPreviewContext,
): DraggedClipState {
  const { scroll, pps, duration, trackOrder, buildSnapTargets } = ctx;
  const geometry =
    ctx.rowGeometry ?? getTimelineRowGeometry(ctx.rowHeights ?? trackOrder.map(() => TRACK_H));
  const aim = dragRowAim(drag, clientY, ctx, geometry);
  const aimedRow = Math.floor(aim.rowFloat);
  const desiredTrack = trackOrder[aimedRow] ??
    (aimedRow < 0 ? (trackOrder[0] ?? 0) - 1 : (trackOrder.at(-1) ?? 0) + 1);
  // OpenReel subtracts the grab offset from content-space X. The pickup
  // coordinates recover the same origin after OM's horizontal scroll.
  const scrollDelta = (scroll?.scrollLeft ?? drag.originScrollLeft) - drag.originScrollLeft;
  const delta = (clientX - drag.originClientX + scrollDelta) / Math.max(pps, 1);
  const requestedStart = drag.element.start + delta;
  const rawStart = clampToHostStart(drag.element, Math.min(resolveDragMaxStart(scroll, pps, duration), requestedStart));
  // OpenReel drag rules: the pointer owns time; edge snapping never grabs the playhead.
  const targets = drag.snapDisabled ? [] : buildSnapTargets(
    drag.element.key ?? drag.element.id,
    !isMusicTrack(drag.element),
    false,
  );
  const snapped = snapOpenReelMove(rawStart, drag.element.duration, targets, pps,
    drag.snapDisabled ? 0 : ctx.gridStep);
  // A snap the saved clip would miss jumps on release, so the clip stays where the pointer put it.
  const target = snapTarget(snapped);
  const missed =
    target !== null && !guideIfSaved(drag.element, { start: snapped.start }, target, pps);
  const snap = missed ? { start: rawStart, snapTime: null, snapType: null } : snapped;
  // A group moves rigidly: the grabbed clip stops where any mover would cross its host's start.
  const group = preparedGroup(drag, ctx);
  const shift = group.shift;
  const origin = drag.element.start;
  const floored = Math.max(snap.start, group.floor);
  const previewStart = origin + Math.max(shift.min, Math.min(floored - origin, shift.max));
  // Resolve against the time the native project can actually store.
  const keepOrigin = previewStart === origin && desiredTrack === drag.element.track;
  const authoredStart = savedClipEdges(drag.element, previewStart).start;
  const savedStart = keepOrigin || group.moving.size > 1 ||
    authoredStart < group.floor || authoredStart - origin < shift.min || authoredStart - origin > shift.max
    ? previewStart : authoredStart;
  const insertion = !keepOrigin && ctx.canInsertClips !== false && drag.pointerId !== null && aim.insertRow === null &&
    trackOrder[aimedRow] !== undefined && !ctx.groupTracks?.has(desiredTrack) &&
    !isPendingTimelineRow(desiredTrack, ctx.elements) &&
    ((ctx.selectedKeys.size < 2 && !drag.element.expandedHostKey) || !resolveExpandedHostAlias(drag, ctx))
    ? previewClipInsert(
      ctx.elements, drag.element, group.moving, desiredTrack, rawStart,
      requestedStart + drag.pointerOffsetX / Math.max(pps, 1), !drag.altKey,
      TIMELINE_SNAP_PX / Math.max(pps, 1),
    ) : null;
  let placement: TimelineDropPlacement = insertion
    ? { track: desiredTrack, insertRow: null, start: insertion.start }
    : resolveDropPlacement(drag, aim, savedStart, desiredTrack, ctx, group);
  if (placement.insertRow !== null && group.hasReadOnlyRows) {
    const layout = layoutAfterTrackInsert(drag.element, placement.start, placement.insertRow, null, ctx);
    const sources = new Map(ctx.elements.map(el => [el.key ?? el.id, el]));
    if (layout && findBlockedTrackInsert(layout.normalized, sources))
      placement = { track: drag.element.track, insertRow: null, start: origin };
  }
  const { track: previewTrack, insertRow } = placement;
  const guide = insertion || placement.invalidDrop ? null : guideIfSaved(drag.element, placement, snapTarget(snap), pps);
  return {
    ...drag,
    started: true,
    pointerClientX: clientX,
    pointerClientY: clientY,
    previewStart: placement.start,
    previewTrack,
    // The lane the POINTER aims at (before the zone clamp): the commit reads it to
    // tell a deliberate vertical lane change from a horizontal drag.
    desiredTrack,
    insertRow,
    invalidDrop: placement.invalidDrop,
    insertion: insertion?.insertion,
    snapTime: guide?.time ?? null,
    snapType: guide?.type ?? null,
    snapEdge: guide ? snapped.snapEdge : undefined,
  };
}

const snapTarget = (s: { snapTime: number | null; snapType: TimelineSnapType | null }) =>
  s.snapTime !== null && s.snapType !== null ? { time: s.snapTime, type: s.snapType } : null;

/** A snap's guide, kept only when the clip's edge as its file will save it is within a pixel of it. */
export function guideIfSaved(
  element: TimelineElement,
  clip: { start: number; duration?: number },
  target: TimelineSnapTarget | null,
  pps: number,
): TimelineSnapTarget | null {
  if (!target) return null;
  const saved = savedClipEdges(element, clip.start, clip.duration);
  const off = Math.min(Math.abs(saved.start - target.time), Math.abs(saved.end - target.time));
  return off * pps < 1 ? target : null;
}

/** The composition time whose frame a trim shows: the edge being dragged. */
export function trimPreviewTime(edge: "start" | "end", start: number, duration: number): number {
  // One frame back: the last visible frame of a clip sits just before its end time.
  const frame = 1 / useLinkedClipPreferences.getState().compositionFps;
  return edge === "start" ? start : Math.max(start, start + duration - frame);
}

export interface ResizePreviewContext {
  scroll: HTMLDivElement | null;
  pps: number;
  buildSnapTargets: BuildSnapTargets;
  elements?: readonly TimelineElement[];
  gestureKeys?: ReadonlySet<string>;
  /** Seconds between the ruler's lines; 0 or absent when snapping is off. */
  gridStep?: number;
}

export interface ResizePreviewResult {
  originScrollLeft: number;
  previewStart: number;
  previewDuration: number;
  previewPlaybackStart?: number;
  /** The target the trimmed edge snapped to; null when the edge is free. */
  snapTime: number | null;
  snapType: TimelineSnapType | null;
}

/** Compute the trim preview for a pointer x (pure — the hook applies the state). */
// fallow-ignore-next-line complexity
export function computeResizePreview(
  resize: ResizingClipState,
  clientX: number,
  ctx: ResizePreviewContext,
): ResizePreviewResult {
  const { scroll, pps, buildSnapTargets } = ctx;
  // Scroll compensation: auto-scroll moves the content while the pointer stays
  // put, so fold the scroll delta into the pointer x (mirrors
  // the clip drag's originScrollLeft handling).
  const originScrollLeft = resize.originScrollLeft ?? scroll?.scrollLeft ?? 0;
  const effectiveClientX = clientX + ((scroll?.scrollLeft ?? originScrollLeft) - originScrollLeft);

  const sourceRemaining =
    resize.element.sourceDuration != null
      ? Math.max(
          0,
          (resize.element.sourceDuration - (resize.element.playbackStart ?? 0)) /
            Math.max(resize.element.playbackRate ?? 1, 0.1),
        )
      : Number.POSITIVE_INFINITY;
  const normalizedTag = resize.element.tag.toLowerCase();
  const canSeedPlaybackStart =
    resize.element.kind === "composition" || normalizedTag === "audio" || normalizedTag === "video";
  // Trim limit = available source media only — NOT the composition length.
  // Duration is content-driven (the comp grows/shrinks to fit on commit), so
  // capping a trim at the current comp end both blocked extending the last clip
  // rightward and, after a far move, collapsed a clip to the sliver between its
  // start and the comp end (the 8s→0.95s audio incident). Images/text/shapes
  // have no source, so they extend freely.
  const video = ctx.elements
    ? heldPartnerVideoBounds(resize.element, ctx.elements, ctx.gestureKeys ?? new Set())
    : null;
  const minStart = Math.max(clampToHostStart(resize.element, 0), video?.start ?? 0);
  const maxEnd = Math.min(resize.element.start + sourceRemaining, video?.end ?? Infinity);
  let nextResize = resolveTimelineResize(
    {
      start: resize.element.start,
      duration: resize.element.duration,
      originClientX: resize.originClientX,
      pixelsPerSecond: pps,
      minStart,
      maxEnd,
      playbackStart:
        isStillImageTimelineElement(resize.element)
          ? undefined
          : resize.edge === "start" && canSeedPlaybackStart
            ? (resize.element.playbackStart ?? 0)
            : resize.element.playbackStart,
      playbackRate: resize.element.playbackRate,
    },
    resize.edge,
    effectiveClientX,
  );

  // Snap within the same limits resolveTimelineResize enforces. The music
  // track defines the beats, so it must not snap to them.
  const trimTargets = resize.snapDisabled ? [] : buildSnapTargets(
    resize.element.key ?? resize.element.id,
    !isMusicTrack(resize.element),
  );
  const gridStep = resize.snapDisabled ? 0 : ctx.gridStep ?? 0;
  let snap: TimelineSnapTarget | null = null;
  const previous = resize.snapTime != null && resize.snapType ? { time: resize.snapTime, type: resize.snapType } : null;
  if (resize.edge === "end") {
    const edgeTime = nextResize.start + nextResize.duration;
    const { time: snapped, target } = stickyTimelineTime(edgeTime, trimTargets, pps, gridStep, previous);
    // Stay within [start+minDuration, maxEnd] so the snap can't create a
    // degenerate clip or run past the source/composition limit.
    const snappedDuration = Math.round((snapped - nextResize.start) * 1000) / 1000;
    if (
      target &&
      snapped <= maxEnd + 1e-6 &&
      snappedDuration >= resolveTimelineMinDuration() - 1e-6
    ) {
      const onTarget =
        snapped === edgeTime ? nextResize : { ...nextResize, duration: snappedDuration };
      snap = guideIfSaved(resize.element, onTarget, target, pps);
      if (snap) nextResize = onTarget;
    }
  } else {
    const { time: snapped, target } = stickyTimelineTime(nextResize.start, trimTargets, pps, gridStep, previous);
    const clip = { ...nextResize, playbackRate: resize.element.playbackRate };
    const delta = snapped - nextResize.start;
    const bounds = clipStartTrimDeltaBounds(clip, minStart, resolveTimelineMinDuration());
    if (target && delta >= bounds.minDelta - 1e-6 && delta <= bounds.maxDelta + 1e-6) {
      const onTarget =
        snapped === nextResize.start ? nextResize : applyClipStartTrimDelta(clip, delta);
      snap = guideIfSaved(resize.element, onTarget, target, pps);
      if (snap) nextResize = onTarget;
    }
  }

  return {
    originScrollLeft,
    previewStart: nextResize.start,
    previewDuration: nextResize.duration,
    previewPlaybackStart: nextResize.playbackStart,
    snapTime: snap?.time ?? null,
    snapType: snap?.type ?? null,
  };
}

/**
 * Apply a rigid group-resize preview: fold the grabbed clip's raw delta into the
 * session and publish a coordinator-owned projection. Canonical elements stay
 * pristine until the exactly-once commit.
 */
export function previewGroupResize(
  session: TimelineGroupResizeSession,
  next: ResizePreviewResult,
  setResizeState: (
    v: ResizePreviewResult & { groupPreview: TimelineGroupResizeSession["changes"] },
  ) => void,
): void {
  const grabbedChange = applyTimelineGroupResizePreview(session, next);
  const previewStart = grabbedChange?.start ?? next.previewStart;
  const previewDuration = grabbedChange?.duration ?? next.previewDuration;
  // A member clamp can pull the grabbed edge off the raw snap target; then no guide.
  const edgeTime = session.edge === "end" ? previewStart + previewDuration : previewStart;
  const stillSnapped = next.snapTime != null && Math.abs(edgeTime - next.snapTime) < 1e-3;
  setResizeState({
    originScrollLeft: next.originScrollLeft,
    previewStart,
    previewDuration,
    previewPlaybackStart: grabbedChange?.playbackStart ?? next.previewPlaybackStart,
    snapTime: stillSnapped ? next.snapTime : null,
    snapType: stillSnapped ? next.snapType : null,
    groupPreview: session.changes,
  });
}
