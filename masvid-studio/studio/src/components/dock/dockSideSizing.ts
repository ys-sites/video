import type { SerializedDockview } from "dockview-react";
import { COLLAPSED_SIDE_WIDTH } from "./dockLayout";

export type SideWidths = { left: number; right: number };

/** Spend the sides' shrinkable space before reducing the remembered preview width. */
export function fitPreviewFirstSides(width: number, preview: number, preferred: SideWidths, minimum: SideWidths, resizedSide?: keyof SideWidths): SideWidths {
  const left = Math.max(minimum.left, preferred.left);
  const right = Math.max(minimum.right, preferred.right);
  const capacity = left + right - minimum.left - minimum.right;
  const shrink = Math.min(capacity, Math.max(0, left + right + preview - width));
  if (resizedSide) {
    // Keep the last deliberate sash position while the untouched side recovers
    // from temporary compression. Neither side's preference is rewritten.
    const fitted = { left, right };
    const other = resizedSide === "left" ? "right" : "left";
    const otherShrink = Math.min(shrink, fitted[other] - minimum[other]);
    fitted[other] -= otherShrink;
    fitted[resizedSide] -= shrink - otherShrink;
    return fitted;
  }
  const fraction = capacity > 0 ? shrink / capacity : 0;
  return {
    left: left - (left - minimum.left) * fraction,
    right: right - (right - minimum.right) * fraction,
  };
}

/** Read saved column sizes before Dockview scales its tree to the initial host box. */
export function savedSideWidths(layout: SerializedDockview | undefined): Partial<SideWidths> {
  const result: Partial<SideWidths> = {};
  if (!layout) return result;
  const visit = (node: SerializedDockview["grid"]["root"], horizontal: boolean) => {
    if (Array.isArray(node.data)) {
      for (const child of node.data) {
        if (Array.isArray(child.data)) visit(child, !horizontal);
        else if (horizontal && typeof child.size === "number" && Number.isFinite(child.size) && child.size > COLLAPSED_SIDE_WIDTH) {
          if (child.data.views.includes("compositions")) result.left = child.size;
          if (child.data.views.includes("design")) result.right = child.size;
        }
      }
    }
  };
  visit(layout.grid.root, layout.grid.orientation === "HORIZONTAL");
  return result;
}
