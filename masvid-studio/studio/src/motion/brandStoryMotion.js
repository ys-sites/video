/** Shared absolute-time entrance pose for the interactive page and MotionHarness scene. */
export function brandSceneFrame(time, duration = .3) {
  const t = Math.max(0, Math.min(1, time / duration));
  const eased = 1 - (1 - t) ** 3;
  return { opacity: eased, travel: 1 - eased, mediaOpacity: .8 + .2 * eased };
}
