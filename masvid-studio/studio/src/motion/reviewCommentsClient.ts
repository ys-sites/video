import type { ReviewAnchor, ReviewCommentsInput, ReviewCommentsResult } from '../../../shared/review-comments';
import type { DomEditSelection } from '../components/editor/domEditingTypes';
import { mintElementHandle, patchTargetAddress } from '../webmcp/handles';
import { motionApi } from './useWorkspace';

export function requestComments(input: ReviewCommentsInput, signal?: AbortSignal) {
  return motionApi<ReviewCommentsResult>('/phase1/call', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'openmotion_manage_project', arguments: input }) }, input.projectId);
}

export function captureReviewAnchor(scope: ReviewAnchor['scope'], projectId: string, compositionPath: string, time: number, selection: DomEditSelection | null): ReviewAnchor {
  const anchor: ReviewAnchor = { scope, compositionPath: scope === 'project' ? 'index.html' : compositionPath, ...(scope === 'project' ? {} : { time }) };
  if (scope !== 'element') return anchor;
  if (!selection?.element.isConnected) throw new Error('Select an element in the current preview first.');
  const handle = mintElementHandle(patchTargetAddress(selection, compositionPath, projectId));
  if (!handle) throw new Error('This element cannot be located. Comment on the current frame instead.');
  const rect = selection.element.getBoundingClientRect();
  anchor.element = {
    handle, sourceFile: selection.sourceFile, label: selection.label.slice(0, 240) || selection.tagName,
    tagName: selection.tagName, hfId: selection.hfId, domId: selection.id ?? undefined,
    selector: selection.selector, selectorIndex: selection.selectorIndex,
    text: (selection.element.textContent ?? '').trim().slice(0, 1000),
    box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
  return anchor;
}

export function reviewTime(time: number) {
  const ms = Math.round(time * 1000);
  return `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
}
