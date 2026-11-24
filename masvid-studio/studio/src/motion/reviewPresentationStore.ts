import { create } from 'zustand';
import type { ReviewPoint, ReviewAnchor } from '../../../shared/review-comments';

type ReviewIntent = { id: string; projectId: string; kind: 'comment' | 'annotate' | 'project' | 'cancel' };
/** Transient slots, canvas gestures and UI intent; saved data stays in the shared service. */
export const useReviewPresentationStore = create<{
  playerHost: HTMLElement | null; listHost: HTMLElement | null;
  intent: ReviewIntent | null; drafting: boolean; busy: boolean; count: number;
  mode: 'comment' | 'annotate' | null; composerOpen: boolean; point: ReviewPoint;
  frame: ReviewAnchor | null;
  placement: { id: string; target: Element | null } | null;
  setPlayerHost: (node: HTMLElement | null) => void;
  setListHost: (node: HTMLElement | null) => void;
  request: (projectId: string, kind: ReviewIntent['kind']) => void;
  compose: (point: ReviewPoint) => void;
  place: (point: ReviewPoint, target: Element | null) => void;
}>(set => ({
  playerHost: null, listHost: null, intent: null, drafting: false, busy: false, count: 0,
  mode: null, composerOpen: false, point: { x: 0.5, y: 0.5 }, placement: null, frame: null,
  setPlayerHost: playerHost => set({ playerHost }), setListHost: listHost => set({ listHost }),
  request: (projectId, kind) => set({ intent: { id: crypto.randomUUID(), projectId, kind } }),
  compose: point => set({ point, composerOpen: true }),
  place: (point, target) => set({ point, placement: { id: crypto.randomUUID(), target } }),
}));
