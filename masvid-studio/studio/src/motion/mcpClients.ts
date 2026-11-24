import type { IntegrationHost } from '../../../shared/integration';

export const mcpClients = [
  { id: 'codex', name: 'Codex', brand: 'codex', host: 'codex' },
  { id: 'claude', name: 'Claude Code', brand: 'claude-code', host: 'claude' },
  { id: 'cursor', name: 'Cursor', brand: 'cursor-agent', host: 'mcp' },
  { id: 'deepseek', name: 'DeepSeek Harness', brand: 'deepseek', host: 'deepseek' },
  { id: 'desktop', name: 'Claude Desktop', brand: 'claude-code', host: 'mcp' },
  { id: 'chatgpt', name: 'ChatGPT', brand: 'openai', host: 'chatgpt' },
  { id: 'mcp', name: 'Other MCP clients', brand: 'mcp', host: 'mcp' },
] as const satisfies readonly { id: string; name: string; brand: string; host: IntegrationHost }[];

export type McpClient = typeof mcpClients[number]['id'];

export function supportsLocalConnection(client: typeof mcpClients[number]) {
  return client.host !== 'chatgpt';
}
