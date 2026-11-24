import type { Direction, DockviewApi } from "dockview-react";
import { DOCK_PANEL_COMPONENT } from "./dockLayoutSchema";
import { PANEL_DEFINITIONS, PANEL_IDS, isPanelId, type PanelId } from "./panelRegistry";

export const MIN_PREVIEW_W = 360;
const MIN_PREVIEW_H = 200;
const MIN_TIMELINE_H = 100;
const MIN_SIDE_W = 200;
const MIN_SIDE_W_FLOOR = 120;
// Two standard 48px tracks plus the ruler/padding/toolbar fit comfortably in
// the default workspace without taking over the preview.
const DEFAULT_TIMELINE_H = 224;
const DEFAULT_LEFT = ["compositions", "assets", "captions", "transcript", "code", "catalog"] as const;
const DEFAULT_RIGHT = ["claude", "design", "comments", "layers", "renders", "variables", "motionBlur"] as const;
export const COLLAPSED_SIDE_WIDTH = 48;
export const MIN_MVP_SIDE_WIDTH = { left: 160, right: 200 } as const;
export const MIN_COMPACT_PREVIEW_WIDTH = 240;
export const DOCK_GAPS = 0;
// Default presets expand both sides only on a comfortable desktop host.
export const COMPACT_DOCK_WIDTH = 1012;
export const isSideCollapsed = (group: DockviewApi["groups"][number]) =>
  group.element.classList.contains("hf-dock-side-collapsed");
export const isSideRequestedCollapsed = (group: DockviewApi["groups"][number]) =>
  isSideCollapsed(group) && !group.element.hasAttribute("data-side-auto-collapsed");

/** Uncompressed preferences; responsive fitting budgets only the visible columns. */
export function preferredSideWidths() {
  return { left: 200, right: 340 };
}

/** Initial free-layout widths, with both side columns open. */
export function defaultSideWidths(viewportWidth: number) {
  const floor = sideMinimumWidth(viewportWidth);
  const left = Math.max(floor, Math.min(384, Math.max(260, Math.round(viewportWidth * 0.257))));
  const right = Math.max(Math.min(280, floor), Math.min(424, Math.round(viewportWidth * 0.284)));
  const excess = left + right - Math.max(0, viewportWidth - MIN_PREVIEW_W);
  if (excess <= 0) return { left, right };
  const shrunkRight = Math.max(floor, right - excess);
  return { left: Math.max(floor, left - (excess - (right - shrunkRight))), right: shrunkRight };
}

/**
 * Fixed MVP sides have content-specific floors. Free-layout sides retain the native shrinking policy.
 */
export function sideMinimumWidth(dockWidth: number, fixedLayout = false, zone: "left" | "right" = "left"): number {
  if (fixedLayout) return Math.min(MIN_MVP_SIDE_WIDTH[zone], Math.max(0, dockWidth - COLLAPSED_SIDE_WIDTH - DOCK_GAPS));
  const fair = Math.floor((dockWidth - MIN_PREVIEW_W) / 2);
  return Math.min(MIN_SIDE_W, Math.max(MIN_SIDE_W_FLOOR, fair));
}

export function previewMinimumWidth(dockWidth: number, fixedLayout: boolean, sideMinimum = MIN_MVP_SIDE_WIDTH.left + MIN_MVP_SIDE_WIDTH.right): number {
  if (!fixedLayout) return MIN_PREVIEW_W;
  // Responsive fitting preserves the preferred preview size separately. Using
  // all remaining space as its hard minimum locks every sash when sides reach
  // their floors, even though the preview still has room to yield to a drag.
  return Math.min(MIN_COMPACT_PREVIEW_WIDTH, Math.max(0, dockWidth - sideMinimum - DOCK_GAPS));
}

function holdsPreview(group: DockviewApi["groups"][number]) {
  return group.panels.some((panel) => panel.id === "preview");
}

/** The zone of a group whose every tab is a side panel, else null. */
export function sideZone(group: DockviewApi["groups"][number]): "left" | "right" | null {
  const zones = group.panels.map((panel) =>
    isPanelId(panel.id) ? PANEL_DEFINITIONS[panel.id].zone : "center",
  );
  const first = zones[0];
  const allSide = zones.every((zone) => zone !== "center");
  return allSide && first && first !== "center" ? first : null;
}

/** Idempotent; rewrites every group's minimum, since dockview keeps a constraint once set. */
export function applySideMinimums(api: DockviewApi, dockWidth = window.innerWidth, fixedLayout = false) {
  const cap = defaultSideWidths(dockWidth);
  const railWidth = COLLAPSED_SIDE_WIDTH;
  const sideMinimum = api.groups.reduce((sum, group) => {
    const zone = sideZone(group);
    if (fixedLayout && !group.api.isVisible) return sum;
    return sum + (zone ? isSideCollapsed(group) ? railWidth : sideMinimumWidth(dockWidth, fixedLayout, zone) : 0);
  }, 0);
  // Reserve a complete track below the toolbar/ruler, including the wrapped phone toolbar.
  const timelineHeight = fixedLayout ? (dockWidth <= 480 ? 160 : 128) : MIN_TIMELINE_H;
  const hostHeight = api.groups[0]?.element.closest<HTMLElement>(".hf-dock")?.clientHeight ?? 0;
  const previewHeight = fixedLayout && hostHeight > 0
    ? Math.min(MIN_PREVIEW_H, Math.max(96, hostHeight - timelineHeight - DOCK_GAPS))
    : MIN_PREVIEW_H;
  for (const group of api.groups) {
    if (fixedLayout && sideZone(group) && !group.api.isVisible) continue;
    if (fixedLayout) {
      if (holdsPreview(group)) group.api.setConstraints({ minimumHeight: previewHeight });
      if (group.panels.some(panel => panel.id === "timeline")) group.api.setConstraints({ minimumHeight: timelineHeight });
    }
    if (group.element.hasAttribute("data-side-motion")) continue;
    if (isSideCollapsed(group)) {
      group.api.setConstraints({ minimumWidth: railWidth, maximumWidth: railWidth });
      group.api.setSize({ width: railWidth });
      continue;
    }
    if (holdsPreview(group)) {
      group.api.setConstraints({ minimumWidth: previewMinimumWidth(dockWidth, fixedLayout, sideMinimum) });
      continue;
    }
    const zone = sideZone(group);
    const minimumWidth = sideMinimumWidth(dockWidth, fixedLayout, zone ?? "left");
    group.api.setConstraints({ minimumWidth, maximumWidth: Number.POSITIVE_INFINITY });
    const limit = zone === "right" ? cap.right : cap.left;
    if (!fixedLayout && zone && minimumWidth < MIN_SIDE_W && group.width > limit) {
      group.api.setSize({ width: limit });
    }
  }
}

function minimumSize(id: PanelId) {
  if (id === "preview") return { minimumWidth: MIN_PREVIEW_W, minimumHeight: MIN_PREVIEW_H };
  if (id === "timeline") return { minimumHeight: MIN_TIMELINE_H };
  return { minimumWidth: MIN_SIDE_W };
}

export function addRegisteredPanel(
  api: DockviewApi,
  id: PanelId,
  position?: { referencePanel?: PanelId; direction: Direction },
) {
  return api.addPanel({
    id,
    component: DOCK_PANEL_COMPONENT,
    title: PANEL_DEFINITIONS[id].title,
    renderer: "always",
    ...minimumSize(id),
    ...(position ? { position } : {}),
  });
}

function addSideColumn(
  api: DockviewApi,
  ids: readonly PanelId[],
  panels: readonly PanelId[],
  direction: "left" | "right",
) {
  const [first, ...rest] = ids.filter((id) => panels.includes(id));
  if (!first) return undefined;
  addRegisteredPanel(api, first, { referencePanel: "preview", direction });
  for (const id of rest)
    addRegisteredPanel(api, id, { referencePanel: first, direction: "within" });
  api.getPanel(first)?.api.setActive();
  return first;
}

/** The default Edit layout: [library | preview | inspector] over a full-width timeline. */
export function buildEditLayout(
  api: DockviewApi,
  viewportWidth: number,
  panels: readonly PanelId[] = PANEL_IDS,
) {
  api.clear();
  const widths = defaultSideWidths(viewportWidth);
  addRegisteredPanel(api, "preview");
  addRegisteredPanel(api, "timeline", { referencePanel: "preview", direction: "below" });
  const left = addSideColumn(api, DEFAULT_LEFT, panels, "left");
  const right = addSideColumn(api, DEFAULT_RIGHT, panels, "right");
  applySideMinimums(api, viewportWidth);
  if (left) api.getPanel(left)?.group.api.setSize({ width: widths.left });
  if (right) api.getPanel(right)?.group.api.setSize({ width: widths.right });
  api.getPanel("timeline")?.group.api.setSize({ height: DEFAULT_TIMELINE_H });
}
