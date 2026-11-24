import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { WorkspaceStore, projectPath } from './workspace.ts';
import { atomicJson, jsonFile } from './phase1-versions.ts';
import type { ReviewComment, ReviewCommentsInput, ReviewCommentsResult } from './shared/review-comments.ts';
import { validateReviewAnnotation } from './shared/review-comments.ts';

type Receipt = { hash: string; commentId?: string; deletedId?: string };
type State = { comments: ReviewComment[]; receipts: Record<string, Receipt> };
const invalid = (message: string): never => { throw new Error('INVALID_ARGUMENT: ' + message); };
function validateOperation(input: ReviewCommentsInput) {
  const common = ['action', 'projectId', 'operation'];
  const fields = {
    list: [], create: ['requestId', 'expectedRevision', 'text', 'anchor'],
    update: ['requestId', 'commentId', 'expectedCommentRevision', 'text', 'status'],
    delete: ['requestId', 'commentId', 'expectedCommentRevision'],
  }[input.operation];
  if (!fields || Object.keys(input).some(key => ![...common, ...fields].includes(key))) invalid('Fields do not match the comment operation');
  if (input.status !== undefined && !['open', 'resolved'].includes(input.status)) invalid('Unknown comment status');
  if (input.operation === 'list') return;
  if (!input.requestId || !/^[\w-]{1,100}$/.test(input.requestId)) invalid('Stable requestId required');
  if (input.text !== undefined && (!input.text.trim() || input.text.length > 8000)) invalid('Comment text must contain 1–8000 characters');
  if (input.operation === 'create') {
    if (!input.text || !input.anchor || !input.expectedRevision) invalid('text, anchor and expectedRevision required');
    const anchor = input.anchor!;
    if (!['project', 'frame', 'element'].includes(anchor.scope)) invalid('Unknown comment scope');
    projectPath(anchor.compositionPath);
    if (anchor.scope === 'project' ? anchor.time !== undefined || anchor.element !== undefined : !Number.isFinite(anchor.time) || anchor.time! < 0) invalid('Anchor time does not match scope');
    if ((anchor.scope === 'element') !== Boolean(anchor.element)) invalid('Element metadata required only for element scope');
    if (anchor.element) projectPath(anchor.element.sourceFile);
    if (anchor.annotation !== undefined) {
      if (anchor.scope === 'project') invalid('Annotations require a frame time');
      validateReviewAnnotation(anchor.annotation);
    }
  } else {
    if (!input.commentId || !Number.isSafeInteger(input.expectedCommentRevision) || input.expectedCommentRevision! < 1) invalid('commentId and expectedCommentRevision required');
    if (input.operation === 'update' && input.text === undefined && input.status === undefined) invalid('text or status required');
  }
}

/** Shared HTTP/MCP service. Record + retry receipt commit together under a cross-process lock. */
export async function reviewComments(store: WorkspaceStore, input: ReviewCommentsInput): Promise<ReviewCommentsResult> {
  validateOperation(input);
  return store.lock(async () => {
    const scoped = store.forProject(input.projectId);
    const file = path.join(store.directory, 'review-comments', input.projectId + '.json');
    const state = await jsonFile<State>(file, { comments: [], receipts: {} });
    const current = await scoped.get();
    const result = (): ReviewCommentsResult => ({ projectId: input.projectId, sourceRevision: current.revision, comments: state.comments });
    if (input.operation === 'list') return result();
    // Canonical ordering makes JSON key order irrelevant to retries.
    const hash = createHash('sha256').update(JSON.stringify(input, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest('hex');
    const previous = Object.hasOwn(state.receipts, input.requestId!) ? state.receipts[input.requestId!] : undefined;
    if (previous) {
      if (previous.hash !== hash) throw new Error('REQUEST_ID_CONFLICT: Use a new requestId for a different operation');
      return { ...result(), comment: state.comments.find(comment => comment.id === previous.commentId), deletedId: previous.deletedId, replayed: true };
    }
    let comment: ReviewComment | undefined, deletedId: string | undefined;
    if (input.operation === 'create') {
      if (current.revision !== input.expectedRevision) throw new Error('VERSION_CONFLICT: Project changed. Refresh the frame and capture the comment again');
      const paths = [input.anchor!.compositionPath, ...(input.anchor!.element ? [input.anchor!.element.sourceFile] : [])];
      if (paths.some(name => !current.project?.files.some(file => file.path === name))) throw new Error('COMMENT_TARGET_NOT_FOUND: Source file is no longer in this project');
      if (state.comments.length >= 2000) throw new Error('COMMENT_LIMIT: Delete old comments before adding more');
      const now = Date.now();
      comment = { id: randomUUID(), projectId: input.projectId, revision: 1, text: input.text!.trim(), status: 'open',
        anchor: structuredClone(input.anchor!), sourceRevision: current.revision, createdAt: now, updatedAt: now };
      state.comments.push(comment);
    } else {
      const index = state.comments.findIndex(comment => comment.id === input.commentId);
      if (index < 0) throw new Error('COMMENT_NOT_FOUND: Comment does not exist in this project');
      const before = state.comments[index];
      if (before.revision !== input.expectedCommentRevision) throw new Error('COMMENT_CONFLICT: Comment changed. Read it again before retrying');
      if (input.operation === 'delete') { deletedId = before.id; state.comments.splice(index, 1); }
      else {
        comment = { ...before, text: input.text?.trim() ?? before.text, status: input.status ?? before.status, revision: before.revision + 1, updatedAt: Date.now() };
        state.comments[index] = comment;
      }
    }
    Object.defineProperty(state.receipts, input.requestId!, { value: { hash, commentId: comment?.id, deletedId }, enumerable: true, configurable: true, writable: true });
    await atomicJson(file, state);
    return { ...result(), comment, deletedId };
  });
}
