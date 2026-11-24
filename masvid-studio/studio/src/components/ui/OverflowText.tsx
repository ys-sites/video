import { Tooltip } from "./Tooltip";
import { useTextOverflow } from "./useTextOverflow";

/** A clipped text label reveals its complete value only when it is truncated. */
export function OverflowText({ text, className = "" }: { text: string; className?: string }) {
  const { ref, overflowing, measure } = useTextOverflow(text);
  return <Tooltip label={text} wrap disabled={!overflowing}>
    <span ref={ref} onPointerEnter={measure} className={`cursor-default ${className}`}>{text}</span>
  </Tooltip>;
}
