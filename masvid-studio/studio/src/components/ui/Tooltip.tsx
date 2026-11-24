/**
 * Tooltip: Base UI's tooltip in Studio tokens. The trigger is a box-less
 * `display: contents` wrapper so a disabled control still gets hover.
 */

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
} from "react";
import { cn } from "./cn";
import { floatingMotion, POPUP_LAYER } from "./floatingSurface";

interface TooltipProps {
  label?: string;
  /** Optional plain-language explanation below the feature name. */
  description?: string;
  /** A single element, wrapped in a box-less span so a disabled one still gets hover. */
  children: ReactElement<{ "aria-describedby"?: string }>;
  /** Hover delay in ms. */
  delay?: number;
  disabled?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  /** Wraps a long label at a reading width and cuts it at this many lines with an ellipsis. Unset, one line. */
  lines?: number;
  /** Wrap the complete label without clamping it. */
  wrap?: boolean;
  /** Keep this tooltip in its trigger's native dialog top layer. Enabled by default. */
  withinDialog?: boolean;
  /** Portal into an explicit overlay when its stacking layer is not a native dialog. */
  portalContainer?: ComponentProps<typeof BaseTooltip.Portal>["container"];
}

/** Matches the old bubble's gap from its trigger, and its viewport margin. */
const SIDE_OFFSET = 6;
const VIEWPORT_MARGIN = 8;

export function Tooltip({
  label,
  description,
  children,
  delay = 200,
  side,
  disabled = false,
  lines,
  wrap = false,
  withinDialog = true,
  portalContainer,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const unavailable = disabled || !label;
  const resolvedSide = side ?? (boxRef.current?.closest(".om-app-header") ? "bottom" : "top");
  const container = portalContainer
    ?? (withinDialog ? boxRef.current?.closest("dialog") : null)
    ?? (document.fullscreenElement?.contains(boxRef.current) ? document.fullscreenElement as HTMLElement : undefined);
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);

  return (
    <BaseTooltip.Root open={open && !unavailable} onOpenChange={setOpen} disabled={unavailable}>
      <BaseTooltip.Trigger delay={delay} render={<span ref={boxRef} className="contents" />}>
        {cloneElement(children, {
          "aria-describedby": open && !unavailable
            ? [children.props["aria-describedby"], tooltipId].filter(Boolean).join(" ")
            : children.props["aria-describedby"],
        })}
      </BaseTooltip.Trigger>
      {/* Dialogs and fullscreen paint above ordinary body portals. */}
      <BaseTooltip.Portal container={container}>
        <BaseTooltip.Positioner
          anchor={() => boxRef.current?.firstElementChild ?? null}
          side={resolvedSide}
          sideOffset={SIDE_OFFSET}
          collisionPadding={VIEWPORT_MARGIN}
          className={cn(POPUP_LAYER, "pointer-events-none")}
        >
          <BaseTooltip.Popup
            id={tooltipId}
            role="tooltip"
            className={cn(
              "studio-tooltip pointer-events-none rounded-md border border-border-input bg-surface px-2 py-1 text-step-10 font-medium text-text-1 shadow-menu",
              lines || description || wrap ? "max-w-[min(300px,calc(100vw-16px))] whitespace-normal break-words" : "whitespace-nowrap",
              description && "px-3 py-2",
              floatingMotion("duration-tooltip"),
            )}
          >
            {description ? (
              <>
                <span className="block font-semibold">{label}</span>
                <span className="mt-1 block whitespace-pre-line font-normal leading-normal">{description}</span>
              </>
            ) : lines ? (
              <span
                className="line-clamp-(--tooltip-lines)"
                style={{ "--tooltip-lines": lines } as CSSProperties}
              >
                {label}
              </span>
            ) : (
              label
            )}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
