import { MEDIA_EXT } from '../../../shared/asset-names';

export { IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, FONT_EXT, MEDIA_EXT } from '../../../shared/asset-names';
export const LUT_EXT = /\.cube$/i;

export function isMediaFile(path: string): boolean {
  return MEDIA_EXT.test(path);
}
