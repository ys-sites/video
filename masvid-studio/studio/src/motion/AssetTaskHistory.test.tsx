// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetTaskHistory } from './AssetTaskHistory';
import type { AssetTask } from './assetTasks';
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string) => text, formatDate: () => 'Nov 15' }) }));
const tasks: AssetTask[] = [
  { key: 'direct:model', id: 'model', mode: 'direct', title: 'Paint the forest', updatedAt: 1, state: 'failed', tone: 'image', detail: 'Codex Image', jobs: [] },
  { key: 'agent:chat', id: 'chat', mode: 'agent', title: 'Build a soundtrack', updatedAt: 2, state: 'waiting', tone: 'agent', detail: 'Agent conversation', jobs: [] },
];
let root: Root, container: HTMLDivElement;
const select = vi.fn(), retry = vi.fn();
beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(error?: string) { await act(async () => root.render(<AssetTaskHistory tasks={tasks} loading={false} error={error} onRetry={retry} onSelect={select} trigger={<button>Tasks</button>} />)); }
const button = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent === text)!;
async function click(el: HTMLElement) { await act(async () => { el.click(); }); }
it('animates queued and running tasks and stops when their state changes', async () => {
  for (const state of ['queued', 'running', 'completed', 'failed', 'cancelled', 'waiting', 'idle'] as const) {
    await act(async () => root.render(<AssetTaskHistory tasks={[{ ...tasks[0], state }]} loading={false} onRetry={retry} onSelect={select} trigger={<button>Tasks</button>} />));
    if (!document.querySelector('.om-task-history')) await click(button('Tasks'));
    const icon = document.querySelector('.om-task-state svg')!;
    const spinning = state === 'queued' || state === 'running';
    expect(icon.classList.contains('animate-spin')).toBe(spinning);
    expect(icon.classList.contains('motion-reduce:animate-none')).toBe(spinning);
  }
});
it('hides the Agent filter while keeping generation filtering and existing conversations accessible', async () => {
  await render();
  expect(document.querySelector('.om-task-history')).toBeNull();
  await click(button('Tasks'));
  expect(document.querySelectorAll('.om-task-item')).toHaveLength(2);
  expect(container.querySelector('.om-task-history')).toBeNull(); // portal, not an inline disclosure
  expect(button('Agent')).toBeUndefined();
  await click(button('Generate'));
  expect(document.querySelectorAll('.om-task-item')).toHaveLength(1);
  expect(document.querySelector('.om-task-item')?.textContent).toContain('Paint the forest');
  await click(button('All tasks'));
  expect(document.querySelectorAll('.om-task-item')).toHaveLength(2);
  await click([...document.querySelectorAll<HTMLElement>('.om-task-item')].find(item => item.textContent?.includes('Build a soundtrack'))!);
  expect(select).toHaveBeenCalledExactlyOnceWith(tasks[1]);
  expect(document.querySelector('[data-open].om-task-history')).toBeNull();
});
it('searches model labels and exposes recovery without losing existing tasks', async () => {
  await render('offline'); await click(button('Tasks'));
  expect(document.body.textContent).toContain('Could not load task history');
  await click(button('Retry')); expect(retry).toHaveBeenCalledOnce();
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search tasks"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'codex'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(document.querySelectorAll('.om-task-item')).toHaveLength(1);
  expect(document.querySelector('.om-task-item')?.textContent).toContain('Paint the forest');
});
