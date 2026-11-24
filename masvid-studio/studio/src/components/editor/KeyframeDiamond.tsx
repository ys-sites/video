import { IconButton } from "open-design-ui/icon-button";
import { memo } from "react";
import { RemixIcon } from "../../icons/RemixIcons";

export type DiamondState = "active" | "inactive" | "ghost";

interface KeyframeDiamondProps {
  state: DiamondState;
  onClick: () => void;
  title: string;
  size?: number;
  isHold?: boolean;
}

// fallow-ignore-next-line complexity
export const KeyframeDiamond = memo(function KeyframeDiamond({
  state,
  onClick,
  title,
  size = 10,
  isHold = false,
}: KeyframeDiamondProps) {
  const shape = isHold ? "checkbox-blank" : "poker-diamonds";
  const color = {
    active: "text-accent",
    inactive: "text-text-2 hover:text-text-0",
    ghost: "text-text-off hover:text-text-0",
  }[state];

  return (
    <IconButton variant="plain"
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`relative shrink-0 p-0.5 transition-colors before:absolute before:-inset-1.5 before:content-[''] ${color}`}
      title={title}
      aria-label={title}
      aria-pressed={state === "active"}
      icon={<RemixIcon name={`${shape}-${state === "active" ? "fill" : "line"}`} size={size} />}
    />
  );
});
