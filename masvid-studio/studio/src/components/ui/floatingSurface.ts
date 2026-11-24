import { cn } from "./cn";

/**
 * Enter and exit shared by menus, popovers, dropdowns, and tooltips.
 * The open duration class differs; the shape does not.
 * `data-starting-style`/`data-ending-style` are Base UI's transition attributes.
 */
export function floatingMotion(openDuration: "duration-open" | "duration-tooltip") {
  return cn("hf-floating-motion outline-hidden", openDuration, openDuration === "duration-tooltip" && "hf-tooltip-motion");
}

/**
 * Chrome shared by every floating panel (`Popover` too); callers add their own shadow token.
 */
export const popupSurface = cn(
  "hf-od-floating-surface rounded-lg border border-border-input bg-surface",
  floatingMotion("duration-open"),
  "data-[preview-state=open]:opacity-100 data-[preview-state=open]:scale-100",
);

/** Every floating list, menu, popover and tooltip sits on this layer, above panel chrome and modals. */
export const POPUP_LAYER = "z-200";
