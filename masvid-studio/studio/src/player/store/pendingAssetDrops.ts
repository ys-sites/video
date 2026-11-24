import type { TimelineElement } from "./timelineElement";
import type { TimelineDropPlacement } from "../components/timelineCallbacks";
import { usePlayerStore } from "./playerStore";
import { generateId } from "../../utils/generateId";
import { getTimelineAssetKind } from "../../utils/timelineAssetDrop";

export interface PendingAssetDrop {
  id: string;
  assetPath: string;
  placement: TimelineDropPlacement;
  duration?: number;
  waitingForPlacement?: boolean;
  element?: TimelineElement;
  failed?: "add" | "preview";
  rowOwnerId?: string;
}

export function beginPendingAssetDrop(
  assetPath: string,
  placement: TimelineDropPlacement,
  duration?: number,
  waitingForPlacement = false,
): string {
  const id = generateId();
  duration ??= ["image", "text"].includes(getTimelineAssetKind(assetPath) ?? "") ? 3 : undefined;
  usePlayerStore.setState((state) => ({
    pendingAssetDrops: [...state.pendingAssetDrops, { id, assetPath, placement, duration, waitingForPlacement }],
  }));
  return id;
}

export function updatePendingAssetDrop(id: string, patch: Partial<PendingAssetDrop>): void {
  usePlayerStore.setState((state) => ({
    pendingAssetDrops: state.pendingAssetDrops.map((drop) => drop.id === id ? { ...drop, ...patch } : drop),
  }));
}

export function isPendingAssetDropActive(id: string): boolean {
  return usePlayerStore.getState().pendingAssetDrops.some((drop) => drop.id === id);
}

export function finishPendingAssetDrop(id: string, element?: TimelineElement): void {
  const placement = usePlayerStore.getState().pendingAssetDrops.find(drop => drop.id === id)?.placement;
  updatePendingAssetDrop(id, element ? {
    element, duration: element.duration,
    placement: { ...placement, start: element.start, track: placement?.track ?? element.track },
  } : { failed: "add" });
}

export function dismissPendingAssetDrop(id: string): void {
  usePlayerStore.setState((state) => ({
    pendingAssetDrops: state.pendingAssetDrops.filter((drop) => drop.id !== id),
  }));
}

export function failPendingAssetPreviews(): void {
  usePlayerStore.setState((state) => ({
    pendingAssetDrops: state.pendingAssetDrops.map((drop) =>
      drop.element && !drop.failed ? { ...drop, failed: "preview" } : drop),
  }));
}
