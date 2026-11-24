import { designSystemAsset } from '../index.js';
import { platformIcons } from '../platform-icons.js';

/** Decorative artwork; the containing control supplies its accessible name. */
export function PlatformIcon({ platform }: { platform: keyof typeof platformIcons }) {
  return <span className="om-platform-icon" aria-hidden="true"><img src={designSystemAsset(platformIcons[platform])} alt="" draggable={false} /></span>;
}
