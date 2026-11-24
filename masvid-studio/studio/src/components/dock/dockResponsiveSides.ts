import type { DockviewApi } from "dockview-react";
import { COLLAPSED_SIDE_WIDTH, DOCK_GAPS, MIN_COMPACT_PREVIEW_WIDTH, MIN_PREVIEW_W, preferredSideWidths, isSideCollapsed, isSideRequestedCollapsed, previewMinimumWidth, sideMinimumWidth } from "./dockLayout";
import { fitPreviewFirstSides, type SideWidths } from "./dockSideSizing";
import { PANEL_DEFINITIONS, type PanelId } from "./panelRegistry";
import type { createSidePanelMotion } from "./dockSidePanelMotion";

export const previewIsEnabled = (api: DockviewApi) => !api.getPanel("preview")?.group.element.classList.contains("hf-dock-preview-hidden");
const zones = ["left", "right"] as const;
type Side = typeof zones[number];

/** Keep preview stable through host resizes; temporary rails never replace user preferences. */
export function createResponsiveDockSides(api: DockviewApi, dockWidth: () => number, motion: ReturnType<typeof createSidePanelMotion>, sync: () => void, savedWidths: Partial<SideWidths> = {}, fixedLayout = false) {
  const widths = new Map<Side, number>();
  let previewWidth: number | undefined;
  let lastWidth = 0;
  let lastFitted: SideWidths | undefined;
  let priority: Side = "right";
  let reflowing = false;
  let dragging = false;
  let draggedSide: Side | undefined;
  let resizedSide: Side | undefined;
  let responsiveFit = false;
  const sideGroups = () => ({ left: api.getPanel("compositions")?.group, right: api.getPanel("design")?.group });
  for (const zone of zones) if (savedWidths[zone] !== undefined) widths.set(zone, savedWidths[zone]);
  const canExpand = (id: PanelId) => {
    const zone = PANEL_DEFINITIONS[id].zone;
    // Both rails must agree: room for one side allows switching to either side.
    const smallerSide = Math.min(sideMinimumWidth(dockWidth(), true, "left"), sideMinimumWidth(dockWidth(), true, "right"));
    return zone === "center" || !previewIsEnabled(api) || dockWidth() >= smallerSide + COLLAPSED_SIDE_WIDTH + MIN_COMPACT_PREVIEW_WIDTH;
  };
  const reflow = () => {
    if (reflowing || dragging || api.hasMaximizedGroup()) return;
    const groups = sideGroups();
    const preview = api.getPanel("preview")?.group;
    if (!groups.left || !groups.right || !preview || dockWidth() <= 0) return;
    reflowing = true;
    try {
      const width = dockWidth() - DOCK_GAPS;
      const enabled = previewIsEnabled(api);
      const collapsed = { left: isSideRequestedCollapsed(groups.left), right: isSideRequestedCollapsed(groups.right) };
      const minimum = (zone: Side) => collapsed[zone] ? COLLAPSED_SIDE_WIDTH : sideMinimumWidth(width, true, zone);
      // Preserve the most recently opened side for as long as one readable column fits.
      if (enabled) {
        if (!canExpand("compositions")) {
          collapsed.left = collapsed.right = true;
        } else if (!collapsed.left && !collapsed.right && width - minimum("left") - minimum("right") < MIN_COMPACT_PREVIEW_WIDTH) {
          collapsed[priority === "left" ? "right" : "left"] = true;
        }
      }
      for (const zone of zones) {
        const group = groups[zone]!;
        const auto = collapsed[zone] && !isSideRequestedCollapsed(group);
        group.element.toggleAttribute("data-side-auto-collapsed", auto);
        group.element.classList.toggle("hf-dock-side-collapsed", collapsed[zone]);
        group.api.setConstraints({ minimumWidth: 0, maximumWidth: Infinity, minimumHeight: 96 });
      }
      const onlyTimeline = !enabled && collapsed.left && collapsed.right;
      groups.left.api.setVisible(!onlyTimeline);
      groups.right.api.setVisible(!onlyTimeline);
      preview.api.setVisible(enabled);
      if (onlyTimeline) { api.getPanel("timeline")?.group.api.setVisible(true); return; }
      const preferred = preferredSideWidths();
      const targets = Object.fromEntries(zones.map(zone => [zone, collapsed[zone] ? COLLAPSED_SIDE_WIDTH : Math.max(minimum(zone), widths.get(zone) ?? preferred[zone])])) as SideWidths;
      const minima = { left: minimum("left"), right: minimum("right") };
      preview.api.setConstraints({ minimumWidth: previewMinimumWidth(width, true, minima.left + minima.right) });
      previewWidth ??= Math.max(MIN_PREVIEW_W, width - targets.left - targets.right);
      let fitted = fitPreviewFirstSides(width, enabled ? previewWidth : 0, targets, minima, resizedSide);
      if (!enabled) {
        const available = width - (Number(collapsed.left) + Number(collapsed.right)) * COLLAPSED_SIDE_WIDTH;
        const total = (collapsed.left ? 0 : targets.left) + (collapsed.right ? 0 : targets.right);
        fitted = { left: collapsed.left ? COLLAPSED_SIDE_WIDTH : available * targets.left / total,
          right: collapsed.right ? COLLAPSED_SIDE_WIDTH : available * targets.right / total };
      }
      responsiveFit = zones.some(zone => Math.abs(fitted[zone] - targets[zone]) > 1);
      for (const zone of zones) groups[zone]!.api.setConstraints({ minimumWidth: fitted[zone], maximumWidth: fitted[zone] });
      for (const zone of zones) groups[zone]!.api.setSize({ width: fitted[zone] });
      for (const zone of zones) groups[zone]!.api.setConstraints({ minimumWidth: minima[zone], maximumWidth: collapsed[zone] ? COLLAPSED_SIDE_WIDTH : Infinity });
      // Only a larger host grows the baseline; temporary rails must not overwrite it.
      if (enabled && width > lastWidth && !zones.some(zone => groups[zone]!.element.hasAttribute("data-side-auto-collapsed"))) {
        previewWidth = Math.max(previewWidth, width - fitted.left - fitted.right);
      }
      for (const zone of zones) if (!collapsed[zone] && !widths.has(zone)) widths.set(zone, targets[zone]);
      lastWidth = width;
      lastFitted = { left: groups.left.width, right: groups.right.width };
    } finally {
      reflowing = false;
      sync();
    }
  };
  // Dockview lays itself out before ResizeObserver runs. Do not mistake that resize
  // for a user sash adjustment, which would overwrite the preview being preserved.
  const rememberSizes = (side?: Side) => {
    const groups = sideGroups();
    if (reflowing || dragging || !lastFitted || dockWidth() - DOCK_GAPS !== lastWidth || api.width !== dockWidth() || api.hasMaximizedGroup() || !previewIsEnabled(api)) return;
    if (zones.some(zone => !groups[zone] || motion.has(groups[zone]!.element))) return;
    const changed = zones.filter(zone => (!side || zone === side) && !isSideCollapsed(groups[zone]!) && Math.abs(groups[zone]!.width - lastFitted![zone]) >= 1);
    if (changed.length === 0) return;
    for (const zone of changed) widths.set(zone, groups[zone]!.width);
    if (side) resizedSide = side;
    lastFitted = { left: groups.left!.width, right: groups.right!.width };
    previewWidth = api.getPanel("preview")!.group.width;
    responsiveFit = zones.some(zone => !isSideCollapsed(groups[zone]!) && Math.abs(groups[zone]!.width - (widths.get(zone) ?? preferredSideWidths()[zone])) > 1);
  };
  const sizeSubscription = api.onDidLayoutChange(() => rememberSizes());
  // Dockview reports a sash layout after release, while ResizeObserver can run
  // between pointer moves. Until release, the live sash owns the geometry;
  // fitting the last remembered sizes here would snap it back under the cursor.
  const root = api.getPanel("preview")?.group.element.closest<HTMLElement>(".hf-dock");
  const doc = root?.ownerDocument;
  const startDrag = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const selector = '.dv-sash[aria-orientation="vertical"]';
    const sash = event.target.closest(selector);
    if (!sash) return;
    // Fixed MVP columns are library / preview / inspector, with two vertical sashes.
    const index = Array.from(root?.querySelectorAll(selector) ?? []).indexOf(sash);
    if (index < 0 || index > 1) return;
    motion.finishAll();
    rememberSizes();
    draggedSide = zones[index];
    dragging = true;
  };
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    rememberSizes(draggedSide);
    draggedSide = undefined;
    reflow();
  };
  if (fixedLayout) root?.addEventListener("pointerdown", startDrag, true);
  doc?.addEventListener("pointerup", endDrag);
  doc?.addEventListener("pointercancel", endDrag);
  doc?.addEventListener("contextmenu", endDrag);
  const setCollapsed = (id: PanelId, collapsed: boolean, animate: boolean) => {
    const group = api.getPanel(id)?.group;
    const zone = PANEL_DEFINITIONS[id].zone;
    if (!group || zone === "center" || (!collapsed && !canExpand(id))) return;
    if (!collapsed) priority = zone;
    if (isSideCollapsed(group) === collapsed && !group.element.hasAttribute("data-side-auto-collapsed")) return;
    const from = group.width;
    rememberSizes();
    motion.finishAll();
    group.element.removeAttribute("data-side-auto-collapsed");
    group.element.classList.toggle("hf-dock-side-collapsed", collapsed);
    previewWidth = undefined;
    reflow();
    const target = group.width;
    if (animate && !Object.values(sideGroups()).some(side => side?.element.hasAttribute("data-side-auto-collapsed")) && Math.abs(from - target) > 1) {
      const resize = (width: number, finished: boolean) => {
        reflowing = true;
        try {
          const opposite = api.getPanel(zone === "left" ? "design" : "compositions")?.group;
          if (opposite) opposite.api.setConstraints({ minimumWidth: opposite.width, maximumWidth: opposite.width });
          group.api.setConstraints({ minimumWidth: COLLAPSED_SIDE_WIDTH, maximumWidth: Infinity });
          group.api.setSize({ width });
        } finally { reflowing = false; }
        if (finished) reflow();
      };
      resize(from, false);
      motion.run(group.element, from, target, true, resize);
    }
    sync();
  };
  const setPreviewVisible = (visible: boolean) => {
    if (!visible) api.exitMaximizedGroup();
    api.getPanel("preview")?.group.element.classList.toggle("hf-dock-preview-hidden", !visible);
    previewWidth = undefined;
    reflow();
  };
  const hasResponsiveFit = () => responsiveFit || !previewIsEnabled(api);
  return { setCollapsed, reflow, setPreviewVisible, canExpand, hasResponsiveFit, dispose: () => {
    sizeSubscription.dispose();
    root?.removeEventListener("pointerdown", startDrag, true);
    doc?.removeEventListener("pointerup", endDrag);
    doc?.removeEventListener("pointercancel", endDrag);
    doc?.removeEventListener("contextmenu", endDrag);
  },
    resetWidths: () => { widths.clear(); resizedSide = undefined; previewWidth = undefined; lastWidth = 0; reflow(); } };
}
