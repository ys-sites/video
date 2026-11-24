import type { AssetChat } from '../../../shared/asset-chat';
import type { GenerationJob, Modality } from '../../../shared/gateway';

export type AssetTaskMode = 'direct' | 'agent';
export type AssetChatSummary = Pick<AssetChat, 'id' | 'title' | 'state' | 'updatedAt'>;
export interface AssetTask {
  key: string; id: string; mode: AssetTaskMode; title: string; updatedAt: number;
  state: GenerationJob['state'] | 'idle' | 'waiting'; tone: Modality | 'agent';
  detail: string; jobs: GenerationJob[];
}

export const isActiveAssetTask = (task: AssetTask) => ['queued', 'running', 'waiting'].includes(task.state);
const taskPriority = (task: AssetTask) => task.state === 'waiting' ? 2 : isActiveAssetTask(task) ? 1 : 0;

/** A view over persisted records, never a second execution or history store. */
export function assetTasks(jobs: GenerationJob[], conversations: AssetChatSummary[]): AssetTask[] {
  const tasks: AssetTask[] = [];
  const agentJobs = new Map<string, GenerationJob[]>();
  for (const job of jobs) {
    if (!job.library && !job.saveToLibrary) continue;
    const chatId = job.library?.conversationId;
    if (chatId) { agentJobs.set(chatId, [...(agentJobs.get(chatId) ?? []), job]); continue; }
    tasks.push({ key: `direct:${job.id}`, id: job.id, mode: 'direct', title: job.prompt, updatedAt: job.updatedAt,
      state: job.state, tone: job.modality, detail: job.model.label, jobs: [job] });
  }
  const chats = new Map(conversations.map(chat => [chat.id, chat]));
  // Keep discoverable jobs even when their conversation falls outside the recent-chat page.
  for (const [id, children] of agentJobs) if (!chats.has(id)) chats.set(id, { id, title: children[0].prompt, state: 'idle', updatedAt: 0 });
  for (const chat of chats.values()) {
    const children = (agentJobs.get(chat.id) ?? []).sort((a, b) => b.createdAt - a.createdAt);
    const working = children.some(job => job.state === 'queued' || job.state === 'running');
    const state = chat.state === 'waiting' ? 'waiting' : chat.state === 'running' || working ? 'running'
      : chat.state === 'failed' || children[0]?.state === 'failed' ? 'failed'
      : chat.state === 'cancelled' ? 'cancelled' : children.length && children.every(job => job.state === 'cancelled') ? 'cancelled' : 'idle';
    tasks.push({ key: `agent:${chat.id}`, id: chat.id, mode: 'agent', title: chat.title, state, tone: 'agent', detail: 'Agent conversation',
      updatedAt: Math.max(chat.updatedAt, ...children.map(job => job.updatedAt)), jobs: children });
  }
  return tasks.sort((a, b) => taskPriority(b) - taskPriority(a) || b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
}

/** A delayed poll must not erase a just-submitted task or regress its progress. */
export function mergeAssetJobs(current: GenerationJob[], incoming: GenerationJob[]): GenerationJob[] {
  const merged = new Map(current.map(job => [job.id, job]));
  for (const job of incoming) if ((merged.get(job.id)?.updatedAt ?? -1) <= job.updatedAt) merged.set(job.id, job);
  return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export const taskStateLabel = (task: AssetTask) => task.state === 'waiting' ? 'Awaiting approval' : task.state === 'idle' ? 'Ready to continue' : task.state;
export const taskStateIcon = (task: AssetTask) => task.state === 'failed' ? 'error-warning-line' : task.state === 'waiting' ? 'shield-check-line'
  : task.state === 'running' || task.state === 'queued' ? 'loader-4-line' : task.state === 'cancelled' ? 'stop-circle-line' : task.state === 'completed' ? 'checkbox-circle-line' : 'chat-check-line';
