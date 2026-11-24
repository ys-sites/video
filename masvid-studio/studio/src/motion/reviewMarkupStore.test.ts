// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { isTypingTarget, ownsPlainKeys } from '../utils/typingTarget';
import { reviewFrameMatches, useReviewMarkupStore } from './reviewMarkupStore';
import type { ReviewMark } from '../../../shared/review-comments';

const mark: ReviewMark = { kind: 'arrow', points: [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.5 }] };
beforeEach(() => {
  useReviewMarkupStore.getState().reset();
  useReviewMarkupStore.getState().start({ projectId: 'a', sourceRevision: 'revision', anchor: { scope: 'frame', time: 2, compositionPath: 'scene.html' },
    annotation: { version: 1, coordinateSpace: 'normalized', width: 1920, height: 1080, marks: [] } });
});

it('drawing history never changes the captured frame and new marks invalidate redo and request IDs', () => {
  const store = useReviewMarkupStore.getState();
  const request = store.draft!.requestId;
  store.add(mark); store.undo();
  expect(useReviewMarkupStore.getState().draft!.annotation.marks).toHaveLength(0);
  store.redo();
  expect(useReviewMarkupStore.getState().draft!.annotation.marks).toEqual([mark]);
  store.undo(); store.add({ ...mark, kind: 'rectangle' });
  expect(useReviewMarkupStore.getState().draft!.redo).toHaveLength(0);
  expect(useReviewMarkupStore.getState().draft!.requestId).not.toBe(request);
  expect(useReviewMarkupStore.getState().draft!.anchor.time).toBe(2);
  store.patch({ locked: true }); store.clear(); store.undo(); store.add(mark);
  expect(useReviewMarkupStore.getState().draft!.annotation.marks).toHaveLength(1);
});

it('marks display only in their composition at the paused time', () => {
  const anchor = useReviewMarkupStore.getState().draft!.anchor;
  expect(reviewFrameMatches(anchor, 'scene.html', 2.01, false)).toBe(true);
  expect(reviewFrameMatches(anchor, 'scene.html', 2.2, false)).toBe(false);
  expect(reviewFrameMatches(anchor, 'scene.html', 2, true)).toBe(false);
  expect(reviewFrameMatches(anchor, 'index.html', 2, false)).toBe(false);
});

it('review drawing and panel keys are isolated from video editing shortcuts', () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-studio-keyboard-owner', '');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); svg.append(path);
  expect(isTypingTarget(path)).toBe(true); expect(ownsPlainKeys(path)).toBe(true);
  const button = document.createElement('button'), panel = document.createElement('section');
  panel.setAttribute('data-studio-keyboard-owner', ''); panel.append(button);
  expect(isTypingTarget(button)).toBe(true);
});
