import type { TimelineElement } from "../store/playerStore";
import type { PendingAssetDrop } from "../store/pendingAssetDrops";
import { getTimelineAssetKind } from "../../utils/timelineAssetDrop";
import { isAudioTimelineElement } from "../../utils/timelineInspector";
import { usePlayerStore } from "../store/playerStore";

/** A reserved row has no authored identity until its media finishes saving. */
export function isPendingTimelineRow(track: number, elements: readonly TimelineElement[]) {
  const drops = usePlayerStore.getState().pendingAssetDrops;
  return drops.length > 0 && timelinePendingRows(elements, drops).addedRows.has(track);
}

/** Reserve real row geometry while media is loading without making it editable. */
export function timelinePendingRows(elements: readonly TimelineElement[], drops: readonly PendingAssetDrop[]) {
  const rows = new Map<number, boolean>();
  const groups = new Map<string, number>();
  for (const element of elements) {
    rows.set(element.track, isAudioTimelineElement(element));
    if (element.audioGroup) groups.set(element.audioGroup, Math.min(groups.get(element.audioGroup) ?? Infinity, element.track));
  }
  const groupHeaders = new Set([...groups.values()].map(track => track - 0.5));
  const pendingRows = new Map<string, number>();
  const addedRows = new Map<number, boolean>();
  const identities = new Map(elements.map(e => [e.key ?? e.id, e.track]));
  for (const drop of drops) {
    const discoveredRow = drop.element && identities.get(drop.element.key ?? drop.element.id);
    if (discoveredRow != null) { pendingRows.set(drop.id, discoveredRow); continue; }
    const audio = getTimelineAssetKind(drop.assetPath) === "audio";
    const placement = drop.placement;
    const owner = drop.rowOwnerId ? pendingRows.get(drop.rowOwnerId) : undefined;
    if (owner != null) { pendingRows.set(drop.id, owner); continue; }
    let track = placement.track;
    const peers = [...rows].filter(([, kind]) => kind === audio).map(([row]) => row).sort((a, b) => a - b);
    const firstAudio = [...rows].filter(([, kind]) => kind).map(([row]) => row).sort((a, b) => a - b)[0];
    if (placement.newTrack || placement.insertRow != null) {
      const order = placement.insertRow != null ? placement.trackOrder : peers;
      const boundary = placement.insertRow ?? 0;
      const before = order[boundary - 1];
      const after = order[boundary];
      track = after == null ? (before ?? -1) + 1 : before == null ? after - 0.5 : (before + after) / 2;
      if (audio) track = peers.length ? Math.max(track, peers[0] - 0.5) : Math.max(-1, ...rows.keys()) + 1;
      if (!audio && firstAudio != null) track = Math.min(track, firstAudio - 0.5);
      while (rows.has(track)) track -= 0.125;
    } else if (rows.has(track) && rows.get(track) !== audio) {
      const match = elements.find(e => isAudioTimelineElement(e) === audio && (e.authoredTrack ?? e.track) === placement.track);
      track = match?.track ?? (audio ? Math.max(-1, ...rows.keys()) + 1 : (firstAudio ?? 0) - 0.5);
    } else if (!rows.has(track)) {
      if (!audio && firstAudio != null) track = Math.min(track, firstAudio - 0.5);
      if (audio) track = Math.max(track, ...[...rows].filter(([, kind]) => !kind).map(([row]) => row + 1));
    }
    if (groupHeaders.has(track)) {
      do { track -= 0.125; } while (groupHeaders.has(track) || rows.has(track));
    }
    if (!rows.has(track)) { rows.set(track, audio); addedRows.set(track, audio); }
    pendingRows.set(drop.id, track);
  }
  return { pendingRows, addedRows };
}
