import { PlatformIcon } from '../../../../packages/design-system/react/PlatformIcon';
import type { SocialPlatformId } from '../../../../shared/scenarios';
import { RemixIcon } from '../../icons/RemixIcons';

const PLATFORM_ICON_MAP = {
  x: 'x',
  instagram: 'reels',
  tiktok: 'tiktok',
  douyin: 'douyin',
  xiaohongshu: 'xiaohongshu',
} as const;

export function SocialPlatformGlyph({
  platform,
  size = 'sm',
}: {
  platform: SocialPlatformId | string;
  size?: 'sm' | 'md';
}) {
  const mapped = PLATFORM_ICON_MAP[platform as keyof typeof PLATFORM_ICON_MAP];
  if (mapped) {
    return (
      <span
        className="om-step-platform-glyph"
        data-size={size}
        data-platform={platform}
        aria-hidden="true"
      >
        <PlatformIcon platform={mapped} />
      </span>
    );
  }
  return (
    <span
      className="om-step-platform-glyph om-step-platform-glyph--fallback"
      data-size={size}
      data-platform={platform}
      aria-hidden="true"
    >
      <RemixIcon name="global-line" size={size === 'md' ? 14 : 12} />
    </span>
  );
}
