// @vitest-environment happy-dom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AssetChat } from '../../../shared/asset-chat';
import { AssetConversation } from './AssetConversation';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: request }));
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('./useLocalAgents', () => ({ useLocalAgents: () => ({ data: { agents: [{ id: 'codex', installed: true, auth: 'signed-in', models: [] }] } }), openAgentSettings: vi.fn() }));
vi.mock('./WorkspaceFrame', () => ({ useWorkspaceChrome: () => ({ openConnections: vi.fn() }) }));
const record = (id: string): AssetChat => ({ id, title: id, state: 'idle', createdAt: 1, updatedAt: 1, messages: [{ id: 'message', role: 'assistant', text: `Reply in ${id}`, createdAt: 1 }], approvals: [] });
let root: Root, container: HTMLDivElement;
const changed = vi.fn(), started = vi.fn(), sending = vi.fn(), error = vi.fn();
const props: ComponentProps<typeof AssetConversation> = { active: true, references: [], referenceControls: null, jobs: [], onCancel: vi.fn(), onView: vi.fn(), onError: error, onChanged: changed, onStarted: started, onSending: sending };
beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(id?: string, epoch = id) { await act(async () => root.render(<AssetConversation key={epoch} {...props} conversationId={id} />)); }
it('resumes the selected persisted conversation and never starts a turn just by opening it', async () => {
  request.mockResolvedValue({ conversation: record('chat') }); await render('chat');
  expect(container.textContent).toContain('Reply in chat');
  expect(request).toHaveBeenCalledExactlyOnceWith('assets/conversations/chat');
  expect(started).not.toHaveBeenCalled(); expect(changed).toHaveBeenCalledWith(record('chat'));
});
it('discards a late response after switching tasks and starts new tasks empty', async () => {
  let finish!: (value: { conversation: AssetChat }) => void;
  request.mockImplementation((path: string) => path.endsWith('/old') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ conversation: record('next') }));
  await render('old'); expect(container.textContent).toContain('Loading conversation');
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
  await render('next');
  await act(async () => finish({ conversation: record('old') }));
  expect(container.textContent).toContain('Reply in next'); expect(container.textContent).not.toContain('Reply in old');
  expect(changed).not.toHaveBeenCalledWith(record('old'));
  await render(undefined, 'new'); expect(container.textContent).not.toContain('Reply in next');
  expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
  expect(request).toHaveBeenCalledTimes(2);
});
it('replaces loading with recovery after a failure and retries the same conversation', async () => {
  request.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ conversation: record('chat') });
  await render('chat'); expect(container.textContent).toContain('Could not load conversation');
  expect(container.textContent).not.toContain('Loading conversation');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click());
  expect(container.textContent).toContain('Reply in chat'); expect(request).toHaveBeenCalledTimes(2);
});
