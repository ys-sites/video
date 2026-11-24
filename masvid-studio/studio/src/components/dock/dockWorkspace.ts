import type { DockviewApi } from "dockview-react";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { COMPACT_DOCK_WIDTH, isSideCollapsed, isSideRequestedCollapsed } from "./dockLayout";
import type { DockController } from "./dockLayoutStore";
import { previewIsEnabled } from "./dockResponsiveSides";

const DEFAULT_AUTO_TIMELINE_MAX_H = 224;

/** Content-sized by default; a deliberate sash resize keeps a pixel preference. */
export function fittedTimelineHeight(content: number, host: number, manual: number | null) {
  const available = Math.max(96, host - 108);
  return Math.round(Math.min(
    available,
    manual ?? Math.min(Math.max(160, content), DEFAULT_AUTO_TIMELINE_MAX_H, Math.max(160, host * 0.42)),
  ));
}

export function installDockWorkspace(api: DockviewApi, controller: DockController, root: HTMLElement, projectId: string | null, storageKey: string | undefined, dockWidth: () => number) {
  const saved = readStudioUiPreferences(undefined, projectId, storageKey).workspaceLayout;
  let manual = saved?.timelineHeight ?? null;
  let content = 192;
  let frame: number | undefined;
  let dragging = false;
  let startHeight = 0;
  let restoring = true;
  const timeline = () => api.getPanel("timeline")?.group;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const group = timeline();
      if (!group?.api.isVisible || api.hasMaximizedGroup() || dragging || api.height <= 0) return;
      const target = fittedTimelineHeight(content, api.height, manual);
      if (Math.abs(group.height - target) > 1) group.api.setSize({ height: target });
    });
  };
  const remember = () => {
    if (restoring) return;
    const left = api.getPanel("compositions")?.group;
    const right = api.getPanel("design")?.group;
    writeStudioUiPreferences({ workspaceLayout: {
      left: Boolean(left && !isSideRequestedCollapsed(left)),
      right: Boolean(right && !isSideRequestedCollapsed(right)),
      preview: previewIsEnabled(api),
      timeline: timeline()?.api.isVisible ?? true,
      timelineHeight: manual,
    } }, undefined, projectId, storageKey);
  };
  controller.rememberWorkspace = remember;
  controller.setPanelVisible = (id, visible) => {
    if (id === "preview") {
      if (visible) controller.activate("preview");
      else controller.setPreviewVisible?.(false);
    } else if (id === "timeline") {
      timeline()?.api.setVisible(visible);
      if (!visible && !api.groups.some(group => group.api.isVisible && !isSideCollapsed(group))) controller.activate("preview");
    }
    else if (visible) controller.activate(id);
    else controller.setGroupCollapsed?.(id, true);
    remember();
    schedule();
  };
  controller.fitTimeline = () => {
    manual = null;
    timeline()?.api.setVisible(true);
    remember();
    schedule();
  };
  controller.setTimelineContentHeight = height => {
    if (!Number.isFinite(height) || height <= 0) return;
    content = height;
    schedule();
  };
  controller.applyWorkspacePreset = preset => {
    controller.setGroupCollapsed?.("compositions", true);
    controller.setGroupCollapsed?.("design", true);
    controller.activate("preview");
    timeline()?.api.setVisible(preset === "edit");
    if (preset === "edit") {
      manual = null;
      if (dockWidth() >= COMPACT_DOCK_WIDTH) {
        controller.activate("compositions");
        controller.activate("design");
      }
      controller.resetSideWidths?.();
    }
    remember();
    schedule();
  };
  const start = (event: PointerEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest('.dv-sash[aria-orientation="horizontal"]')) return;
    dragging = true;
    startHeight = timeline()?.height ?? 0;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const height = timeline()?.height ?? startHeight;
    if (Math.abs(height - startHeight) > 1) {
      manual = height;
      remember();
    }
    schedule();
  };
  root.addEventListener("pointerdown", start, true);
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  if (saved) {
    controller.setPreviewVisible?.(saved.preview ?? true);
    timeline()?.api.setVisible(saved.timeline);
    // Small screens start on the canvas; rail expansion requires a readable side and preview.
    if (dockWidth() >= COMPACT_DOCK_WIDTH) {
      controller.setGroupCollapsed?.("compositions", !saved.left);
      controller.setGroupCollapsed?.("design", !saved.right);
    }
  } else {
    // Masvid Studio: first visit opens the right column so the Claude chat is in view.
    setTimeout(() => { controller.setGroupCollapsed?.("design", false); controller.activate("claude"); }, 400);
  }
  restoring = false;
  schedule();
  return { schedule, dispose: () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    root.removeEventListener("pointerdown", start, true);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
  } };
}
