import type { TimelineElement } from "../../store/timelineElement";

interface TrackItem {
  readonly id: string;
  readonly startTime: number;
  readonly duration: number;
}

interface Track {
  readonly id: string;
  readonly locked: boolean;
  readonly items: readonly TrackItem[];
}

export interface Project {
  readonly timeline: { readonly tracks: readonly Track[] };
  readonly itemsByTrack: ReadonlyMap<string, readonly TrackItem[]>;
}

export function getTrackItems(project: Project, trackId: string): readonly TrackItem[] {
  return project.itemsByTrack.get(trackId) ?? [];
}

// OM passes regular lanes only. OpenReel's universal tracks are all standard.
export function isStandardTrack(_track: Track): boolean {
  return true;
}

const tracksByElements = new WeakMap<readonly TimelineElement[], Map<number, Track>>();

export function openReelPlacementInput(
  elements: readonly TimelineElement[],
  trackOrder: readonly number[],
  blockedTracks?: ReadonlySet<number>,
): Project {
  let byTrack = tracksByElements.get(elements);
  if (!byTrack) {
    const lanes = new Map<number, { id: string; locked: boolean; items: TrackItem[] }>();
    for (const element of elements) {
      let lane = lanes.get(element.track);
      if (!lane) {
        lane = { id: String(element.track), locked: false, items: [] };
        lanes.set(element.track, lane);
      }
      lane.locked ||= element.timelineLocked === true;
      lane.items.push({ id: element.key ?? element.id, startTime: element.start, duration: element.duration });
    }
    byTrack = lanes;
    tracksByElements.set(elements, byTrack);
  }
  const tracks = trackOrder.map(track => {
    const lane = byTrack.get(track) ?? { id: String(track), locked: false, items: [] };
    return blockedTracks?.has(track) && !lane.locked ? { ...lane, locked: true } : lane;
  });
  return { timeline: { tracks }, itemsByTrack: new Map(tracks.map(track => [track.id, track.items])) };
}
