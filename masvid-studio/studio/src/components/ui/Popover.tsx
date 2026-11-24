/**
 * Popover: `Menu`'s floating chrome (`popupSurface`) without item semantics, so arrow keys
 * stay with whatever is focused inside (rename inputs, forms). Only the shadow differs.
 */

import { Popover as BasePopover } from "@base-ui/react/popover";
import { useRef, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";
import {
  floatingMotion,
  POPUP_LAYER,
  popupSurface,
  useInlinePortal,
  type PopupPreviewState,
  type PortalContainer,
} from "./Menu";

/** Matches Menu's gap from its trigger, and its viewport margin. */
const SIDE_OFFSET = 6;
const VIEWPORT_MARGIN = 8;

/** The arrow's 14x8 box overlaps the popup's border by 1px, so its fill hides the border where it meets the popup. */
const ARROW_PX = 7;
const ARROW_CORNER_CLEARANCE = 10;
const arrowPlace = cn(
  "data-[side=bottom]:-top-[7px] data-[side=top]:-bottom-[7px] data-[side=top]:rotate-180",
  "data-[side=left]:-right-[10px] data-[side=left]:rotate-90",
  "data-[side=right]:-left-[10px] data-[side=right]:-rotate-90",
);

interface PopoverProps extends Omit<ComponentPropsWithoutRef<typeof BasePopover.Root>, "children"> {
  /** A single element. It becomes the trigger; no wrapper is added around it. */
  trigger: ReactElement;
  /** An adjacent action that previews the panel on hover and keeps its own click behavior. */
  primaryAction?: ReactElement;
  /** Standard hover/focus hint for the popover trigger. */
  tooltip?: string;
  /** Also reveal a hoverable help panel; activation still pins it open. */
  openOnHover?: boolean;
  /** Arbitrary content. The popover owns none of its keys. */
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  collisionAvoidance?: ComponentPropsWithoutRef<
    typeof BasePopover.Positioner
  >["collisionAvoidance"];
  /** Points the popup at its trigger. Off by default; the default gap from the trigger grows by the arrow's height. */
  arrow?: boolean;
  /** Portal target. Pass the shadow root when the trigger lives in one; `null` keeps it inline. */
  container?: PortalContainer;
  /** Names the popup for assistive tech. */
  "aria-label"?: string;
  "aria-describedby"?: string;
  /**
   * What to focus on open. Defaults to Base UI's behaviour (the first tabbable
   * element), which is what a rename field wants.
   */
  initialFocus?: ComponentPropsWithoutRef<typeof BasePopover.Popup>["initialFocus"];
  /** Preserve form choices while closed; Base UI keeps the popup hidden and inert. */
  keepMounted?: boolean;
  finalFocus?: ComponentPropsWithoutRef<typeof BasePopover.Popup>["finalFocus"];
  className?: string;
  /** Custom surface for a picker whose text input needs standard Popover focus handling. */
  renderPanel?: ReactElement;
  "data-preview-state"?: PopupPreviewState;
}

export function Popover({
  trigger,
  primaryAction,
  tooltip,
  openOnHover = false,
  children,
  side = "bottom",
  align = "center",
  arrow = false,
  sideOffset = arrow ? SIDE_OFFSET + ARROW_PX : SIDE_OFFSET,
  collisionAvoidance,
  container,
  className,
  renderPanel,
  initialFocus,
  keepMounted,
  finalFocus,
  modal,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  "data-preview-state": previewState,
  ...root
}: PopoverProps) {
  const inline = useInlinePortal(container);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const menuTrigger = <BasePopover.Trigger render={trigger} openOnHover={openOnHover}
    delay={primaryAction ? 0 : undefined} aria-describedby={describedBy} />;
  return (
    <BasePopover.Root {...root} modal={modal}>
      {primaryAction && <BasePopover.Trigger ref={primaryRef} render={primaryAction} openOnHover delay={0}
        aria-haspopup={undefined} aria-expanded={undefined} aria-controls={undefined}
        onClick={event => event.preventBaseUIHandler()} />}
      {tooltip === undefined ? menuTrigger : <Tooltip label={tooltip} wrap>{menuTrigger}</Tooltip>}
      {inline.host}
      <BasePopover.Portal {...inline.portal} keepMounted={keepMounted}>
        {modal === true && (
          <BasePopover.Backdrop className={cn("fixed inset-0 data-[closed]:pointer-events-none", POPUP_LAYER)} />
        )}
        <BasePopover.Positioner
          anchor={primaryAction ? primaryRef : undefined}
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={VIEWPORT_MARGIN}
          collisionAvoidance={collisionAvoidance}
          arrowPadding={ARROW_CORNER_CLEARANCE}
          className={POPUP_LAYER}
        >
          <BasePopover.Popup
            render={renderPanel}
            aria-label={ariaLabel}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            data-preview-state={previewState}
            className={cn(
              renderPanel ? floatingMotion("duration-open") : cn(popupSurface, "p-3 text-step-11 text-text-1 shadow-popover"),
              className,
            )}
          >
            {arrow && (
              <BasePopover.Arrow className={arrowPlace}>
                <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden="true" className="block">
                  <path d="M0 8 L7 1 L14 8" className="fill-surface stroke-border-input" />
                </svg>
              </BasePopover.Arrow>
            )}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
