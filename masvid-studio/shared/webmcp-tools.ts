import { ToolInputError } from './tool-input-error.ts';
import { phase1Tools, validateInput } from './phase1-tools.ts';
import { assetReadToolResult } from './asset-library.ts';

function failure(message: string, applied: boolean | 'unknown', fallback = 'WEBMCP_CALL_FAILED', validation?: { invalid_field?: string; validation_rule?: string }) {
  const code = /^([A-Z][A-Z_]+)(?::|$)/.exec(message)?.[1] ?? fallback;
  return { isError: true, error: { code, message, applied, ...(validation?.invalid_field ? { invalid_field: validation.invalid_field, validation_rule: validation.validation_rule } : {}) } };
}

/** Page registration reuses the public contract and the existing service authority. */
export function buildOpenMotionWebMcpTools(request: (url: string, init?: RequestInit) => Promise<Response>) {
  // Game tools serve the user's external Agent over MCP; the in-page WebMCP surface does not expose them.
  return phase1Tools.filter(tool => !tool.name.startsWith('openmotion_game_')).map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description + ' WebMCP returns the existing service result on success, or isError=true with error={code,message,applied}. After an uncertain write, read the project or original job before retrying; retain the original requestId.',
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: tool.annotations.readOnlyHint, untrustedContentHint: true },
    execute: async (input: object, options?: { signal: AbortSignal }) => {
      let dispatched = false;
      try {
        options?.signal.throwIfAborted();
        validateInput(tool.inputSchema, input);
        const body = JSON.stringify({ name: tool.name, arguments: input });
        dispatched = true;
        const response = await request('/motion-api/phase1/call', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: options?.signal,
        });
        const result = await response.json();
        if (!response.ok) return { ...result, ...failure(typeof result.error === 'string' ? result.error : `HTTP ${response.status}`,
          typeof result.applied === 'boolean' ? result.applied : 'unknown', result.code ?? 'WEBMCP_CALL_FAILED', result) };
        return tool.name === 'openmotion_assets_use' && (input as { action?: string }).action === 'read'
          ? assetReadToolResult(result) : result;
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error), dispatched ? 'unknown' : false,
          options?.signal.aborted ? 'ABORTED' : dispatched ? 'WEBMCP_TRANSPORT_ERROR' : 'INVALID_ARGUMENT',
          error instanceof ToolInputError ? error : undefined);
      }
    },
  }));
}
