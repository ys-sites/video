import { webMcpToolNames } from '../../../tracking/events';
import { toolFailureFields, toolInputFields } from '../../../tracking/tool-fields';
import type { studioEvents } from '../../../tracking/events';
import type { EventFields } from '../../../tracking/core';
import type { ModelContextTool } from './types';

type ToolName = typeof webMcpToolNames[number];
type Outcome = 'success' | 'failure' | 'partial' | 'cancelled' | 'unknown';
type WebMcpEvent = 'webmcp_tool_started' | 'webmcp_tool_finished' | 'webmcp_registration_result';
let sender: Promise<typeof import('../motion/tracking')> | undefined;

function report<E extends WebMcpEvent>(event: E, properties: EventFields<typeof studioEvents[E]>) {
  // Host exports can be imported in Node; initialize the browser sender only on an actual event.
  sender ??= import('../motion/tracking');
  void sender.then(({ trackMotion }) => trackMotion(event, properties)).catch(() => {});
}

function knownTool(name: string): name is ToolName {
  return (webMcpToolNames as readonly string[]).includes(name);
}

function duration(started: number) {
  return Math.max(0, Math.min(86_400_000, Math.round(performance.now() - started)));
}

function outcome(result: unknown): Outcome {
  if (!result || typeof result !== 'object') return 'unknown';
  const value = result as { isError?: boolean; ok?: boolean; status?: string; error?: { code?: string } };
  if (value.isError || value.ok === false) {
    return value.error?.code === 'ABORTED' ? 'cancelled' : 'failure';
  }
  if (value.status === 'failed') return 'failure';
  if (value.status === 'partial' || value.status === 'cancelled') return value.status;
  return 'success';
}

/** Measure the browser callback, independently of committed domain-operation events. */
export function withWebMcpTracking(tool: ModelContextTool): ModelContextTool {
  if (!knownTool(tool.name)) return tool;
  const toolName = tool.name;
  return { ...tool, execute: async (input, options) => {
    let call: { call_id: string; started: number } | undefined;
    let fields: ReturnType<typeof toolInputFields> = {};
    try {
      fields = toolInputFields(toolName, input);
      call = { call_id: crypto.randomUUID(), started: performance.now() };
      report('webmcp_tool_started', { tool_name: toolName, transport: 'webmcp', call_id: call.call_id, ...fields });
    } catch { /* Measurement must not prevent a tool invocation. */ }
    const finish = (result: unknown, failure?: Outcome, error?: unknown) => {
      if (!call) return;
      try {
        const observed = failure ?? outcome(result);
        const reply = result as { error?: unknown; kind?: string } | undefined;
        const importRejected = (observed === 'partial' || observed === 'failure')
          && (toolName === 'openmotion_import_assets' || fields.action === 'import_to_project');
        const code = observed === 'cancelled' ? 'ABORTED' : importRejected && !reply?.error ? 'ASSET_IMPORT_FAILED'
          : reply?.kind === 'invalid' ? 'INVALID_ARGUMENT' : reply?.kind === 'blocked' ? 'STUDIO_TOOL_BLOCKED'
          : reply?.kind === 'internal' ? 'STUDIO_TOOL_INTERNAL' : undefined;
        report('webmcp_tool_finished', { tool_name: toolName, transport: 'webmcp', call_id: call.call_id, ...fields,
          outcome: observed, duration_ms: duration(call.started),
          ...(['failure', 'partial', 'cancelled'].includes(observed) ? toolFailureFields(code ? { code } : reply?.error ?? error) : {}) });
      } catch { /* Results, errors and private contents belong to the caller, not telemetry. */ }
    };
    try {
      const result = await tool.execute(input, options);
      finish(result);
      return result;
    } catch (error) {
      finish(undefined, error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failure', error);
      throw error;
    }
  } };
}

export function trackWebMcpRegistration(name: string, result: 'success' | 'failure' | 'cancelled', started: number) {
  if (!knownTool(name)) return;
  try {
    report('webmcp_registration_result', { tool_name: name, transport: 'webmcp', outcome: result,
      duration_ms: duration(started) });
  } catch { /* Registration never waits for reporting. */ }
}
