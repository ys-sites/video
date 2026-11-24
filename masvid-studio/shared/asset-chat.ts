import type { AssetReference } from './asset-library.ts';
export interface AssetChatMessage { id: string; role: 'user' | 'assistant' | 'tool'; text: string; createdAt: number }
export interface AssetChatApproval { id: string; kind: 'generation' | 'command' | 'file'; title: string; detail: string }
export interface AssetChat {
  id: string; title: string; createdAt: number; updatedAt: number; threadId?: string;
  state: 'idle' | 'running' | 'waiting' | 'failed' | 'cancelled';
  messages: AssetChatMessage[]; approvals: AssetChatApproval[]; error?: string;
  requestReceipts?: { requestId: string; inputHash: string }[];
  /** Retained for conversations persisted before per-turn receipts. */
  lastRequestId?: string; lastRequestHash?: string;
}
export interface AssetChatInput { requestId: string; text: string; references?: AssetReference[]; model?: string; reasoning?: string }
