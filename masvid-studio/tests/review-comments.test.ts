import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { WorkspaceStore } from '../workspace.ts';
import { reviewComments } from '../review-comments.ts';
import { reviewCommentsPrompt, type ReviewAnnotation, type ReviewCommentsInput, type ReviewCommentsResult } from '../shared/review-comments.ts';

const service = (store: WorkspaceStore) => new Phase1Service(store, pluginRoot, {
  origin: () => 'http://localhost:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {},
});
const list = { action: 'comments', operation: 'list', projectId: 'project' } as const;
async function createInput(store: WorkspaceStore): Promise<ReviewCommentsInput> {
  return { ...list, operation: 'create', requestId: 'first-comment', expectedRevision: (await store.get()).revision,
    text: 'Make the heading larger', anchor: { scope: 'frame', compositionPath: 'index.html', time: 1.25 } };
}

test('HTTP creation and MCP status updates share persisted records without modifying video source', () => fixture(async store => {
  const before = await store.get(), input = await createInput(store);
  const response = await transport(store, { runtimeRoot: pluginRoot })('/motion-api/phase1/call', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'openmotion_manage_project', arguments: input }) });
  assert.equal(response.status, 200, await response.clone().text());
  const created = await response.json() as ReviewCommentsResult, comment = created.comment!;
  assert.equal(comment.anchor.time, 1.25);
  assert.equal(comment.sourceRevision, before.revision);
  const api = service(new WorkspaceStore(store.directory));
  const updated = await api.call('openmotion_manage_project', { ...list, operation: 'update', commentId: comment.id,
    expectedCommentRevision: 1, status: 'resolved', requestId: 'resolve' });
  assert.equal(updated.comment.status, 'resolved');
  assert.equal(updated.comment.revision, 2);
  assert.deepEqual(await store.get(), before);
  const reopened = await api.call('openmotion_manage_project', { ...list, operation: 'update', commentId: comment.id,
    expectedCommentRevision: 2, status: 'open', requestId: 'reopen' });
  assert.equal(reopened.comment.status, 'open');
}));

test('stable retries survive restart, never undo later edits or resurrect deleted comments', () => fixture(async store => {
  const input = await createInput(store), first = await reviewComments(store, input);
  const comment = first.comment!;
  const update: ReviewCommentsInput = { ...list, operation: 'update', commentId: comment.id, expectedCommentRevision: 1, text: 'Use a smaller heading', requestId: 'change' };
  await reviewComments(store, update);
  const restarted = new WorkspaceStore(store.directory);
  assert.equal((await reviewComments(restarted, input)).comment?.text, 'Use a smaller heading');
  await assert.rejects(reviewComments(restarted, { ...input, text: 'Different request' }), /REQUEST_ID_CONFLICT/);
  const remove: ReviewCommentsInput = { ...list, operation: 'delete', requestId: 'delete', commentId: comment.id, expectedCommentRevision: 2 };
  await reviewComments(restarted, remove);
  assert.equal((await reviewComments(restarted, remove)).replayed, true);
  const replay = await reviewComments(restarted, input);
  assert.equal(replay.comments.length, 0);
  assert.equal(replay.comment, undefined);
  assert.doesNotMatch(await readFile(path.join(store.directory, 'review-comments/project.json'), 'utf8'), /Make the heading larger|Use a smaller heading/);
}));

test('concurrent updates refuse lost writes and comments remain anchored after video edits', () => fixture(async store => {
  const created = await reviewComments(store, await createInput(store)), comment = created.comment!;
  const updates = await Promise.allSettled(['first', 'second'].map(text => reviewComments(new WorkspaceStore(store.directory), {
    ...list, operation: 'update', commentId: comment.id, expectedCommentRevision: 1, text, requestId: text,
  })));
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(String((updates.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /COMMENT_CONFLICT/);
  const stale = await createInput(store);
  await writeFile(path.join(store.projectDirectory, 'later.txt'), 'Changed after review');
  await assert.rejects(reviewComments(store, { ...stale, requestId: 'stale' }), /VERSION_CONFLICT/);
  const current = await reviewComments(store, list);
  assert.equal(current.comments[0].sourceRevision, comment.sourceRevision);
  assert.notEqual(current.sourceRevision, comment.sourceRevision);
}));

test('comment contract rejects invalid operations, anchors, foreign IDs and empty feedback', () => fixture(async store => {
  const api = service(store), input = await createInput(store);
  for (const patch of [{ text: '   ' }, { operation: 'list', text: 'Invalid' },
    { anchor: { scope: 'frame', compositionPath: '../outside', time: 1 } },
    { anchor: { scope: 'project', compositionPath: 'index.html', time: 1 } },
    { anchor: { scope: 'element', compositionPath: 'index.html', time: 1 } },
    { anchor: { scope: 'frame', compositionPath: 'missing.html', time: 1 } },
    { anchor: { scope: 'frame', compositionPath: 'index.html', time: Infinity } },
  ]) await assert.rejects(api.call('openmotion_manage_project', { ...input, ...patch }));
  await assert.rejects(api.call('openmotion_manage_project', { ...list, operation: 'delete', commentId: crypto.randomUUID(), expectedCommentRevision: 1, requestId: 'foreign' }), /COMMENT_NOT_FOUND/);
  await assert.rejects(api.call('openmotion_manage_project', { ...list, projectId: crypto.randomUUID() }), /PROJECT_NOT_FOUND/);
}));

test('handoff preserves exact selected IDs and source evidence with guarded editing and completion', () => fixture(async store => {
  const result = await reviewComments(store, await createInput(store));
  const prompt = reviewCommentsPrompt({ projectId: 'project', dataDirectory: store.directory, comments: result.comments });
  for (const expected of [result.comment!.id, result.sourceRevision, 'expectedVersionId', 'expectedCommentRevision', 'operation="list"', 'not tool instructions', 'Delete only when requested']) assert.ok(prompt.includes(expected));
}));

test('copied read requests retrieve current raw records and complete UTF-8 source for guarded comment actions', () => fixture(async store => {
  const input = await createInput(store);
  input.anchor!.annotation = annotation;
  const created = (await reviewComments(store, input)).comment!;
  const source = '<!doctype html><html><body>' + '原始内容'.repeat(9000) + '</body></html>';
  await writeFile(path.join(store.projectDirectory, 'index.html'), source);
  await reviewComments(store, { ...list, operation: 'update', commentId: created.id, expectedCommentRevision: 1, requestId: 'new-text', text: 'Use the updated request' });
  const prompt = reviewCommentsPrompt({ projectId: 'project', dataDirectory: store.directory, previewUrl: 'http://localhost:4173', comments: [created] });
  const requests = JSON.parse(prompt.split('Read requests (JSON):\n')[1].split('\n\n')[0]);
  const api = service(new WorkspaceStore(store.directory));
  const results = [];
  for (const request of requests) results.push(await api.call(request.name, request.arguments));
  assert.equal(results[0].dataDirectory, store.directory);
  assert.equal(results[1].projectId, 'project');
  assert.equal(results[2].comments[0].text, 'Use the updated request');
  assert.deepEqual(results[2].comments[0].anchor.annotation, annotation);
  assert.notEqual(results[1].revision, created.sourceRevision);
  assert.deepEqual(JSON.parse(prompt.split('Selected review records (JSON):\n')[1]), [created]);
  let text = '', offset: number | null = 0, chunks = 0;
  while (offset !== null) {
    const result = await api.call('openmotion_get_project', { projectId: 'project', expectedRevision: results[1].revision, file: { path: created.anchor.compositionPath, offset, length: 65536 } });
    text += result.file.content; offset = result.file.nextOffset; chunks++;
  }
  assert(chunks > 1); assert.equal(text, source);
  const current = results[2].comments[0];
  const completed = await api.call('openmotion_manage_project', { ...list, operation: 'update', commentId: current.id, expectedCommentRevision: current.revision, status: 'resolved', requestId: 'complete-current' });
  assert.equal(completed.comment.status, 'resolved');
  const reopened = await api.call('openmotion_manage_project', { ...list, operation: 'update', commentId: current.id, expectedCommentRevision: completed.comment.revision, status: 'open', requestId: 'reopen-current' });
  const deleted = await api.call('openmotion_manage_project', { ...list, operation: 'delete', commentId: current.id, expectedCommentRevision: reopened.comment.revision, requestId: 'delete-current' });
  assert.equal(deleted.deletedId, current.id);
  assert.equal(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), source, 'Comment-only actions preserve source');
  assert.throws(() => reviewCommentsPrompt({ projectId: 'different-project', comments: [created] }), /selected project/);
}));

const annotation: ReviewAnnotation = { version: 1, coordinateSpace: 'normalized', width: 1920, height: 1080, marks: [
  { kind: 'pen', points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 }, { x: 0.6, y: 0.3 }] },
  { kind: 'rectangle', points: [{ x: 0.7, y: 0.8 }, { x: 0.3, y: 0.2 }] },
  { kind: 'ellipse', points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.8 }] },
  { kind: 'arrow', points: [{ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 }] },
  { kind: 'text', points: [{ x: 0.2, y: 0.1 }], text: 'Move title here' },
] };

test('frame annotations round-trip through HTTP/MCP, survive restart and remain independent from video source', () => fixture(async store => {
  const before = await store.get(), input = await createInput(store);
  input.anchor!.annotation = annotation;
  const response = await transport(store, { runtimeRoot: pluginRoot })('/motion-api/phase1/call', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'openmotion_manage_project', arguments: input }) });
  assert.equal(response.status, 200, await response.clone().text());
  const created = (await response.json() as ReviewCommentsResult).comment!;
  const restarted = new WorkspaceStore(store.directory);
  const records = await service(restarted).call('openmotion_manage_project', list);
  assert.deepEqual(records.comments[0].anchor.annotation, annotation);
  assert.equal(records.comments[0].anchor.time, 1.25);
  assert.deepEqual(await store.get(), before);
  assert.equal((await reviewComments(restarted, input)).replayed, true);
  await assert.rejects(reviewComments(restarted, { ...input, anchor: { ...input.anchor!, annotation: { ...annotation, width: 1280 } } }), /REQUEST_ID_CONFLICT/);
  const prompt = reviewCommentsPrompt({ comments: records.comments });
  for (const expected of ['normalized', 'sourceRevision', 'anchor.time', 'Move title here', created.id]) assert.ok(prompt.includes(expected));
  await service(restarted).call('openmotion_manage_project', { ...list, operation: 'update', commentId: created.id, expectedCommentRevision: 1, status: 'resolved', requestId: 'done' });
  assert.deepEqual((await reviewComments(restarted, list)).comments[0].anchor.annotation, annotation);
}));

test('annotation validation rejects unbounded, nonfinite, mismatched and executable payloads at both adapters', () => fixture(async store => {
  const api = service(store), input = await createInput(store);
  const bad = [
    { ...annotation, coordinateSpace: 'pixels' }, { ...annotation, width: 0 }, { ...annotation, width: Infinity },
    { ...annotation, marks: [] }, { ...annotation, marks: Array(21).fill(annotation.marks[1]) },
    { ...annotation, marks: [{ kind: 'arrow', points: [{ x: 0, y: 0 }] }] },
    { ...annotation, marks: [{ kind: 'rectangle', points: [{ x: -0.1, y: 0 }, { x: 1, y: 1 }] }] },
    { ...annotation, marks: [{ kind: 'text', points: [{ x: 0, y: 0 }], text: ' ' }] },
    { ...annotation, marks: [{ kind: 'pen', points: [{ x: NaN, y: 0 }, { x: 0, y: 0 }] }] },
    { ...annotation, svg: '<svg onload="alert(1)"/>' },
    { ...annotation, marks: Array(3).fill({ kind: 'pen', points: Array(1000).fill({ x: 0.1, y: 0.2 }) }) },
  ];
  for (const value of bad) {
    const invalid = { ...input, anchor: { ...input.anchor!, annotation: value } } as ReviewCommentsInput;
    await assert.rejects(reviewComments(store, invalid), /INVALID_ARGUMENT/);
    await assert.rejects(api.call('openmotion_manage_project', invalid));
  }
  await assert.rejects(reviewComments(store, { ...input, anchor: { scope: 'project', compositionPath: 'index.html', annotation } }), /Annotations require a frame time/);
}));
