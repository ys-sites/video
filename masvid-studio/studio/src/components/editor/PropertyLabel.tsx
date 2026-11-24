import { Tooltip } from "../ui/Tooltip";
import { useTextOverflow } from "../ui/useTextOverflow";

/** Property names share the available row width without displacing controls. */
export function PropertyLabel({ label, className = "", ...props }: {
  label: string;
  className?: string;
  "data-flat-toggle-label"?: string;
}) {
  const { ref, overflowing, measure } = useTextOverflow(label);
  return (
    <Tooltip label={label} wrap disabled={!overflowing}>
      <span {...props} tabIndex={overflowing ? 0 : undefined} onPointerEnter={measure} onFocus={measure} className={`min-w-0 flex-1 cursor-default text-[11px] ${className}`}>
        <span ref={ref} className="block truncate">{label}</span>
      </span>
    </Tooltip>
  );
}
