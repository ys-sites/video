/**
 * IconButton — Button's square sibling; shares its base/variant classes so
 * the two never drift. `aria-label` is required for screen readers.
 */

import { forwardRef } from "react";
import type { ReactNode } from "react";
import { buttonClasses, type ButtonBaseProps, type ButtonSize } from "./button.js";

interface IconButtonProps extends ButtonBaseProps {
  icon: ReactNode;
  "aria-label": string;
}

/** Square boxes on the same 24 / 28 / 32 px control heights as Button. */
const iconSizeStyles: Record<ButtonSize, string> = {
  sm: "size-ctl-sm rounded-sm",
  md: "size-ctl rounded-md",
  lg: "size-ctl-lg rounded-md",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = "md", variant = "ghost", className, disabled, ...props }, ref) => {
    const classes = buttonClasses(variant, iconSizeStyles[size], className);
    return (
      <button
        ref={ref}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        className={classes}
        {...props}
        data-odui-component="icon-button"
      >
        {icon}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
