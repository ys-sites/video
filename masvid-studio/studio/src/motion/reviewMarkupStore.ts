import { create } from 'zustand';
import type { ReviewAnchor, ReviewAnnotation, ReviewComment, ReviewMark } from '../../../shared/review-comments';
import { validateReviewAnnotation } from '../../../shared/review-comments';

export type ReviewMarkupDraft = {
  projectId: string; anchor: ReviewAnchor; sourceRevision: string; annotation: ReviewAnnotation;
  tool: ReviewMark['kind']; label: string; redo: ReviewMark[]; requestId: string; locked: boolean; inProgress: boolean; stale: boolean;
};
type MarkupState = {
  draft: ReviewMarkupDraft | null; displayed: ReviewComment | null;
  start: (draft: Pick<ReviewMarkupDraft, 'projectId' | 'anchor' | 'sourceRevision' | 'annotation'>) => void;
  patch: (patch: Partial<Pick<ReviewMarkupDraft, 'tool' | 'label' | 'locked' | 'inProgress' | 'stale'>>) => void;
  add: (mark: ReviewMark) => void; undo: () => void; redo: () => void; clear: () => void;
  touch: () => void; reset: () => void; show: (comment: ReviewComment | null) => void;
};

/** Transient presentation state only. Saved records use the shared review service. */
export const useReviewMarkupStore = create<MarkupState>((set, get) => ({
  draft: null, displayed: null,
  start: draft => set({ displayed: null, draft: { ...draft, tool: 'pen', label: '', redo: [], requestId: crypto.randomUUID(), locked: false, inProgress: false, stale: false } }),
  patch: patch => set(state => state.draft ? { draft: { ...state.draft, ...patch } } : {}),
  add: mark => {
    const draft = get().draft;
    if (!draft || draft.locked) return;
    const annotation = { ...draft.annotation, marks: [...draft.annotation.marks, mark] };
    validateReviewAnnotation(annotation);
    set({ draft: { ...draft, annotation, redo: [], requestId: crypto.randomUUID() } });
  },
  undo: () => set(({ draft }) => !draft || draft.locked || !draft.annotation.marks.length ? {} : { draft: { ...draft,
    annotation: { ...draft.annotation, marks: draft.annotation.marks.slice(0, -1) }, redo: [...draft.redo, draft.annotation.marks.at(-1)!], requestId: crypto.randomUUID() } }),
  redo: () => set(({ draft }) => !draft || draft.locked || !draft.redo.length ? {} : { draft: { ...draft,
    annotation: { ...draft.annotation, marks: [...draft.annotation.marks, draft.redo.at(-1)!] }, redo: draft.redo.slice(0, -1), requestId: crypto.randomUUID() } }),
  clear: () => set(({ draft }) => !draft || draft.locked ? {} : { draft: { ...draft,
    annotation: { ...draft.annotation, marks: [] }, redo: [], requestId: crypto.randomUUID() } }),
  touch: () => set(({ draft }) => draft ? { draft: { ...draft, requestId: crypto.randomUUID() } } : {}),
  reset: () => set({ draft: null, displayed: null }),
  show: displayed => set({ displayed }),
}));

export function reviewFrameMatches(anchor: ReviewAnchor, compositionPath: string, time: number, playing: boolean) {
  return !playing && anchor.compositionPath === compositionPath && anchor.time !== undefined && Math.abs(anchor.time - time) <= 0.04;
}
