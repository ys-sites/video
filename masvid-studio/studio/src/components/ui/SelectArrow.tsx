import { RemixIcon } from "../../icons/RemixIcons";
/** Symmetric bounds keep the caret centered when its trigger opens. */
export function SelectArrow({ size = 14 }: { size?: number }) {
  return (
    <RemixIcon name="arrow-down-s-line" size={size} data-select-arrow="true" className="shrink-0 text-panel-text-5" />
  );
}
