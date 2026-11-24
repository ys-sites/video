import { IconGlyph } from "../../../packages/design-system/react/IconGlyph";

export function MotionIcon({ name, size = 16 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" className="motion-icon" aria-hidden="true" focusable="false"><IconGlyph id={`icon-${name}`} /></svg>;
}
