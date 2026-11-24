import { expect, it } from 'vitest';
import type { GenerationJob } from '../../../shared/gateway';
import { assetTasks, mergeAssetJobs, type AssetChatSummary } from './assetTasks';
const job = (id: string, updatedAt: number, overrides: Partial<GenerationJob> = {}): GenerationJob => ({ id, state: 'completed', modality: 'image', prompt: id, model: { id: 'codex:image', provider: 'codex', modelId: 'image', label: 'Codex Image', modality: 'image', source: 'builtin', mode: 'text-to-image' }, parameters: {}, requestHash: '', createdAt: updatedAt, updatedAt, assets: [], library: { assetId: id, createNew: true }, ...overrides });
const chat: AssetChatSummary = { id: 'chat', title: 'Build a landscape', state: 'idle', updatedAt: 10 };
it('puts approvals and active work before newer finished tasks without duplicating Agent jobs', () => {
  const tasks = assetTasks([job('finished', 100), job('queued', 50, { state: 'queued' }), job('child', 5, { state: 'running', library: { assetId: 'asset', conversationId: chat.id } })], [{ ...chat, state: 'waiting' }]);
  expect(tasks.map(task => task.key)).toEqual(['agent:chat', 'direct:queued', 'direct:finished']);
});
it('retains newly submitted jobs and newer progress when a delayed poll arrives', () => {
  const submitted = job('new', 20, { state: 'queued' });
  const completed = job('old', 30);
  expect(mergeAssetJobs([submitted, completed], [job('old', 10, { state: 'running' })])).toEqual([completed, submitted]);
  expect(mergeAssetJobs([submitted], [job('new', 40)])).toEqual([job('new', 40)]);
});
it('merges model and conversation history without duplicating Agent-owned jobs or project jobs', () => {
  const child = job('child', 30, { library: { assetId: 'asset', conversationId: chat.id } });
  const tasks = assetTasks([job('project', 40, { library: undefined }), job('direct', 20), child], [chat]);
  expect(tasks.map(task => task.key)).toEqual(['agent:chat', 'direct:direct']);
  expect(tasks[0].jobs).toEqual([child]); expect(tasks[0].updatedAt).toBe(30);
});
it('keeps active child work visible and gives pending approvals precedence', () => {
  const child = job('child', 30, { state: 'running', library: { assetId: 'asset', conversationId: chat.id } });
  expect(assetTasks([child], [chat])[0].state).toBe('running');
  expect(assetTasks([child], [{ ...chat, state: 'waiting' }])[0].state).toBe('waiting');
  expect(assetTasks([child], [{ ...chat, state: 'cancelled' }])[0].state).toBe('running');
});
it('retains orphaned conversation jobs and does not let an old failure mask a successful continuation', () => {
  const old = job('old', 10, { state: 'failed', library: { assetId: 'asset', conversationId: chat.id } });
  const next = job('next', 20, { library: { assetId: 'asset', conversationId: chat.id } });
  expect(assetTasks([old], [])[0]).toMatchObject({ key: 'agent:chat', state: 'failed', jobs: [old] });
  expect(assetTasks([old, next], [chat])[0]).toMatchObject({ state: 'idle', jobs: [next, old] });
});

it('includes new project generation in workspace history while leaving historical project jobs untouched', () => {
  const task = job('project', 40, { library: undefined, projectId: 'project', saveToLibrary: true, savePending: true, state: 'failed' });
  expect(assetTasks([task, job('legacy', 30, { library: undefined })], []).map(task => task.key)).toEqual(['direct:project']);
});
