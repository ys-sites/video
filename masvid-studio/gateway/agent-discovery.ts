import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentAuth, AgentDefinition, AgentModel } from '../shared/local-agents.ts';

export type Probe = (bin: string, args: string[]) => Promise<{ ok: boolean; text: string }>;
export type AcpDiscoveryOptions = {
  timeoutMs?: number;
  catalogGraceMs?: number;
  clientInfo?: { name: string; version: string };
  isolateDeepSeek?: boolean;
};
export type AcpDiscoveryResult = { models: AgentModel[]; auth: AgentAuth; version?: string };

const PROBE_TIMEOUT_MS = 25_000;
const ACP_CATALOG_GRACE_MS = 3_500;
const MAX_NDJSON_BYTES = 4 * 1024 * 1024;
const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** npm's Windows shims are not executables. Resolve the script without running a shell. */
export async function agentInvocation(bin: string, args: string[]): Promise<{ bin: string; args: string[] }> {
  if (!/\.cmd$/i.test(bin)) return { bin, args };
  const source = await readFile(bin, 'utf8');
  const relative = source.match(/"%(?:dp0|~dp0)%?\\([^"\r\n]+\.(?:[cm]?js))"/i)?.[1];
  if (!relative || relative.includes('..') || /[%!]/.test(relative)) throw new Error('Unsupported CLI shim; use the official executable');
  return { bin: process.execPath, args: [path.resolve(path.dirname(bin), ...relative.split('\\')), ...args] };
}

export const probeAgent: Probe = async (bin, args) => {
  try {
    const command = await agentInvocation(bin, args);
    return await new Promise(resolve => execFile(command.bin, command.args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => resolve({ ok: !error, text: stdout || stderr })));
  } catch { return { ok: false, text: '' }; }
};

const stripAnsi = (value: string) => value
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

const cleanTerminalLines = (raw: string) => stripAnsi(raw).split('\n').map(line => (line.includes('\r') ? line.split('\r').pop()! : line).trim());

/** Allows Claude's `[1m]` extended-context suffix while rejecting shell metacharacters. */
export const validModelId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/@+[\] -]{0,199}$/.test(value);

const validReasoningToken = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(value);

function extractReasoning(value: any): string[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  let levels: unknown[] | undefined;
  if (Array.isArray(value.reasoning)) levels = value.reasoning;
  else if (Array.isArray(value.supported_reasoning_levels)) levels = value.supported_reasoning_levels.map((r: any) => typeof r === 'string' ? r : r?.effort);
  else if (Array.isArray(value.supportedReasoningEfforts)) levels = value.supportedReasoningEfforts.map((r: any) => typeof r === 'string' ? r : r?.reasoningEffort ?? r?.effort);
  else if (value.supportsEffort !== false && Array.isArray(value.supportedEffortLevels)) levels = value.supportedEffortLevels;
  const cleaned = levels ? [...new Set(levels.filter(validReasoningToken))] : [];
  return cleaned.length ? cleaned : undefined;
}

export function normalizeAgentModels(input: unknown[], source: AgentModel['source'] = 'cli'): AgentModel[] {
  const seen = new Set<string>();
  const names = new Set<string>();
  return input.flatMap((value: any) => {
    if (!value) return [];
    if (typeof value === 'object' && (value.visibility === 'hide' || value.hidden === true)) return [];
    const rawId = typeof value === 'string' ? value : value.slug ?? value.model ?? value.modelId ?? value.id ?? value.value;
    const id = typeof rawId === 'string' ? rawId.trim() : rawId;
    if (!validModelId(id) || seen.has(id) || id === 'default') return [];
    seen.add(id);
    const title = typeof value === 'object' ? value.display_name ?? value.displayName ?? value.name ?? value.label : undefined;
    const baseName = typeof title === 'string' && title.trim() ? title.trim().slice(0, 180) : id;
    const label = names.has(baseName) && baseName !== id ? `${baseName} (${id})`.slice(0, 180) : baseName;
    names.add(baseName);
    const reasoning = extractReasoning(value);
    return [{ id, label, source, ...(reasoning ? { reasoning } : {}) }];
  }).slice(0, 1500);
}

const PROSE_LINE_RE = /^(?:available\s|loading\b|fetching\b|models(?:\s|:|$)|tip:|note:|warning:|error:|usage:|run\s|please\s|sign in|log in|not logged|no models|total:|showing\s|default model|current model|(?:provider|id|name)\s+|---+|\=+)/i;
const STRICT_LINE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+[\]-]{0,199}$/;
const PURE_SEMVER_RE = /^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i;

function looksLikeModelToken(id: string): boolean {
  if (!STRICT_LINE_ID_RE.test(id)) return false;
  if (/^https?:/i.test(id) || PURE_SEMVER_RE.test(id)) return false;
  return id.includes('/') || id.includes(':') || /[.-]/.test(id) || id === 'auto';
}

function parseLineModelEntry(rawLine: string): { id: string; label?: string } | null {
  if (!rawLine || /^[-=─━┼|+ ]+$/.test(rawLine) || PROSE_LINE_RE.test(rawLine)) return null;
  const line = rawLine.replace(/^(?:[*•▸►✓✔>]|-(?!-))\s+/, '').trim();
  if (!line || PROSE_LINE_RE.test(line)) return null;

  // Tab-separated or multi-space column output (e.g. `agy models`: `gemini-4-neon-high\tGemini 4 Neon (High)`).
  const columnMatch = line.match(/^(\S+)(?:\t+|\s{2,})(.+)$/);
  if (columnMatch) return looksLikeModelToken(columnMatch[1]) ? { id: columnMatch[1], label: columnMatch[2].trim() } : null;

  // Dash-separated label (e.g. `cursor-agent models`: `model-2 - Model two` or `auto - Auto (default)`).
  const dashMatch = line.match(/^(\S+)\s+[-–—]\s+(.+)$/);
  if (dashMatch) return looksLikeModelToken(dashMatch[1]) ? { id: dashMatch[1], label: dashMatch[2].trim() } : null;

  // Parenthesized alias / canonical ID (e.g. `aider --list-models`: `- gpt-4-turbo (openai/gpt-4-turbo)` or `auto (default)`).
  const parenMatch = line.match(/^(\S+)\s+\(([^)]+)\)$/);
  if (parenMatch) {
    const [, first, inner] = parenMatch;
    if (looksLikeModelToken(inner) && inner.includes('/')) return { id: inner, label: first };
    return looksLikeModelToken(first) ? { id: first } : null;
  }

  // Single model token per line (e.g. `opencode models`: `anthropic/claude-sonnet-4-5`).
  return !/\s/.test(line) && looksLikeModelToken(line) ? { id: line } : null;
}

function parseHelpChoices(text: string): AgentModel[] {
  const lines = text.split('\n');
  let block = '';
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)(?:-[a-zA-Z],\s*)?--model\b(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const parts = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (!next.trim()) break;
      const nextIndent = next.match(/^(\s*)/)![1].length;
      if (nextIndent <= indent && /^\s*-/.test(next)) break;
      parts.push(next.trim());
    }
    block = parts.join(' ');
    break;
  }
  const source = block || text;
  const rawChoices = source.match(/Currently supported:\s*\(([^)]*)\)/i)?.[1]
    ?? source.match(/\(choices:\s*([^)]+)\)/i)?.[1]
    ?? source.match(/\[possible values:\s*([^\]]+)\]/i)?.[1]
    ?? source.match(/\(options:\s*([^)]+)\)/i)?.[1];
  if (!rawChoices) return [];
  return normalizeAgentModels(rawChoices.split(/[,|]/).map(item => item.trim().replace(/^['"]|['"]$/g, '')));
}

export function parseAgentModels(kind: AgentDefinition['discovery'], raw: string): AgentModel[] {
  const text = stripAnsi(raw);
  if (kind === 'codex') {
    const value = JSON.parse(text);
    return normalizeAgentModels(Array.isArray(value) ? value : value.models ?? value.data ?? []);
  }
  if (kind === 'help') return parseHelpChoices(text);
  if (kind === 'pi') {
    return normalizeAgentModels(cleanTerminalLines(raw).flatMap(line => {
      if (!line || /^[-=─━┼|+ ]+$/.test(line)) return [];
      const cells = line.split(/\s+/);
      if (cells.length < 2) return [];
      const [provider, model] = cells;
      if (/^provider$/i.test(provider) || /^model$/i.test(model)) return [];
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(provider) || !STRICT_LINE_ID_RE.test(model)) return [];
      return [`${provider}/${model}`];
    }));
  }
  return normalizeAgentModels(cleanTerminalLines(raw).flatMap(line => {
    const entry = parseLineModelEntry(line);
    return entry ? [entry] : [];
  }));
}

export function parseAgentAuth(_id: string, ok: boolean, raw: string): AgentAuth {
  try {
    const value = JSON.parse(raw);
    if (typeof value.loggedIn === 'boolean') return value.loggedIn ? 'signed-in' : 'signed-out';
    if (typeof value.authenticated === 'boolean') return value.authenticated ? 'signed-in' : 'signed-out';
  } catch { /* text CLI */ }
  const text = stripAnsi(raw);
  if (/not (?:logged in|authenticated)|authentication required|please (?:log|sign) in|no credentials|expired token/i.test(text)) return 'signed-out';
  if (ok && /logged in|authenticated/i.test(text)) return 'signed-in';
  return 'unknown';
}

export async function qwenModels(): Promise<AgentModel[]> {
  const file = process.env.QWEN_SETTINGS_FILE || path.join(os.homedir(), '.qwen/settings.json');
  let info;
  try { info = await stat(file); } catch { return []; }
  if (info.size > 1024 * 1024) return [];
  const value = JSON.parse(await readFile(file, 'utf8'));
  const entries = Object.values(value.modelProviders ?? {}).flatMap((list: any) => Array.isArray(list) ? list.map(item => ({ id: item.id, label: item.name })) : []);
  if (typeof value.model === 'string') entries.push({ id: value.model, label: value.model });
  else if (value.model?.name) entries.push({ id: value.model.name, label: value.model.name });
  return normalizeAgentModels(entries);
}

/** Reads configured models from Mistral Vibe's local `config.toml` when `vibe-acp` is absent. */
export async function vibeConfigModels(): Promise<AgentModel[]> {
  const home = process.env.VIBE_HOME || path.join(os.homedir(), '.vibe');
  const file = path.join(home, 'config.toml');
  let info;
  try { info = await stat(file); } catch { return []; }
  if (info.size > 1024 * 1024) return [];
  const text = await readFile(file, 'utf8');
  const entries: { id: string; label?: string }[] = [];
  let inModel = false;
  let current: { name?: string; alias?: string } = {};
  const flush = () => {
    const id = current.alias || current.name;
    if (id) entries.push({ id, label: current.name || id });
    current = {};
  };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line === '[[models]]') { if (inModel) flush(); inModel = true; continue; }
    if (line.startsWith('[')) { if (inModel) { flush(); inModel = false; } continue; }
    const kv = line.match(/^([a-zA-Z0-9_]+)\s*=\s*"([^"]+)"$/);
    if (!kv) continue;
    if (inModel) {
      if (kv[1] === 'name') current.name = kv[2];
      else if (kv[1] === 'alias') current.alias = kv[2];
    } else if (kv[1] === 'active_model') {
      entries.push({ id: kv[2], label: kv[2] });
    }
  }
  if (inModel) flush();
  return normalizeAgentModels(entries);
}

export function parseAmpAgentOptions(raw: string): AgentModel[] {
  try {
    const value = JSON.parse(stripAnsi(raw));
    const list = Array.isArray(value) ? value : value.models ?? value.options?.models ?? [];
    return normalizeAgentModels(Array.isArray(list) ? list : []);
  } catch { return []; }
}

function flattenAcpSelectOptions(options: unknown): any[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((entry: any) => (entry && typeof entry === 'object' && 'value' in entry ? [entry] : Array.isArray(entry?.options) ? entry.options : []));
}

function isAcpThoughtOption(option: any): boolean {
  if (!option || typeof option !== 'object') return false;
  if (option.category === 'thought_level') return true;
  if (option.category === 'thinking' && option.type === 'select') return true;
  return option.type === 'select' && ['thought_level', 'reasoning_effort', 'thinking'].includes(option.id);
}

function acpMetaReasoning(meta: any): string[] | null | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  if (meta.supportsReasoningEffort === false) return null;
  if (!Array.isArray(meta.reasoningEfforts)) return undefined;
  const values = meta.reasoningEfforts
    .map((level: any) => typeof level === 'string' ? level : level?.value)
    .filter(validReasoningToken);
  return values.length ? [...new Set<string>(values)] : null;
}

/**
 * Extracts normalized models + reasoning levels from ACP `configOptions` and legacy `models.availableModels`.
 * Prefers `configOptions` (matching ACP v1/v2 & t3code) so agents like Antigravity 1.4/1.5+ expose clean
 * model families with per-model reasoning levels instead of flattened effort variants.
 */
export function extractAcpModels(configOptions: unknown, availableModels: unknown): AgentModel[] {
  const configs = Array.isArray(configOptions) ? configOptions : [];
  const available = Array.isArray(availableModels) ? availableModels : [];
  const modelConfig = configs.find((item: any) => item && (item.category === 'model' || item.id === 'model') && Array.isArray(item.options));
  const configEntries = modelConfig ? flattenAcpSelectOptions(modelConfig.options) : [];
  const rawModels = configEntries.length > 0 ? configEntries : available;
  if (!rawModels.length) return [];

  const thoughtConfig = configs.find(isAcpThoughtOption);
  const sessionEfforts = [...new Set<string>(flattenAcpSelectOptions(thoughtConfig?.options).map((o: any) => o?.value).filter(validReasoningToken))];
  const availableById = new Map<string, any>();
  const availableIdSet = new Set<string>();
  for (const item of available) {
    const id = typeof item === 'string' ? item : item?.modelId ?? item?.id ?? item?.value;
    if (typeof id === 'string') { availableById.set(id, item); availableIdSet.add(id); }
  }

  // Antigravity 1.4/1.5+ encodes exact per-model efforts as `<family>-<effort>` in legacy `availableModels`.
  const hasSuffixVariants = configEntries.length > 0 && sessionEfforts.length > 0 && rawModels.some((entry: any) => {
    const id = entry?.value ?? entry?.modelId ?? entry?.id;
    return typeof id === 'string' && sessionEfforts.some(effort => availableIdSet.has(`${id}-${effort}`));
  });

  const enriched = rawModels.map((entry: any) => {
    if (!entry || typeof entry !== 'object') return entry;
    const id = entry.value ?? entry.modelId ?? entry.id;
    if (typeof id !== 'string') return entry;
    const metaLevels = acpMetaReasoning(entry._meta ?? availableById.get(id)?._meta);
    let reasoning: string[] | undefined;
    if (metaLevels === null) reasoning = undefined;
    else if (metaLevels && metaLevels.length) reasoning = metaLevels;
    else if (hasSuffixVariants) {
      const matched = sessionEfforts.filter(effort => availableIdSet.has(`${id}-${effort}`));
      if (matched.length) reasoning = matched;
    } else if (sessionEfforts.length) {
      reasoning = sessionEfforts;
    }
    return reasoning ? { ...entry, reasoning } : entry;
  });

  return normalizeAgentModels(enriched);
}

function isAcpAuthError(error: any): boolean {
  if (!error || typeof error !== 'object') return false;
  if (error.code === -32000) return true;
  const detail = `${error.message ?? ''} ${error.data?.details ?? ''} ${typeof error.data === 'string' ? error.data : ''}`;
  return /\b(?:auth(?:enticat(?:e|ed|es|ing|ion))?|credentials?|log(?:[\s-]+)?in|sign(?:[\s-]+)?in|unauthorized|unauthenticated)\b/i.test(detail);
}

type NdjsonProbeContext<T> = {
  directory: string;
  send: (payload: unknown) => void;
  done: (value: T) => void;
  fail: (error: Error) => void;
};

async function runNdjsonProbe<T>(
  bin: string,
  args: string[] | ((directory: string) => Promise<string[]>),
  timeoutMs: number,
  setup: (ctx: NdjsonProbeContext<T>) => { onMessage: (message: any) => void; onExit?: () => void },
): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-agent-probe-'));
  try {
    const resolvedArgs = typeof args === 'function' ? await args(directory) : args;
    const command = await agentInvocation(bin, resolvedArgs);
    return await new Promise<T>((resolve, reject) => {
      const child = spawn(command.bin, command.args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let finished = false, buffer = '', bytes = 0;

      const terminate = (error?: Error, value?: T) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        child.kill();
        const force = setTimeout(() => child.kill('SIGKILL'), 500);
        force.unref();
        const settle = () => { clearTimeout(force); error ? reject(error) : resolve(value!); };
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) settle();
        else child.once('close', settle);
      };

      const send = (payload: unknown) => {
        if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(payload) + '\n');
      };

      const timer = setTimeout(() => terminate(new Error('Agent model discovery timed out')), timeoutMs);
      child.stderr.resume();
      child.stdin.on('error', () => {});
      const hooks = setup({
        directory,
        send,
        done: value => terminate(undefined, value),
        fail: error => terminate(error),
      });
      child.once('error', () => terminate(new Error('Could not start Agent model discovery')));
      child.once('exit', () => {
        if (hooks.onExit) hooks.onExit();
        terminate(new Error('Agent closed model discovery'));
      });
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_NDJSON_BYTES) return terminate(new Error('Agent model response is too large'));
        buffer += chunk;
        for (;;) {
          const end = buffer.indexOf('\n');
          if (end < 0) break;
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try { hooks.onMessage(JSON.parse(line)); }
          catch { /* Ignore non-protocol diagnostics; the bounded timeout remains active. */ }
        }
      });
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** ACP discovery performs initialize + session/new only. No prompt or tool execution is sent. */
export async function discoverAcp(bin: string, args: string[], options: AcpDiscoveryOptions = {}): Promise<AcpDiscoveryResult> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const catalogGraceMs = options.catalogGraceMs ?? ACP_CATALOG_GRACE_MS;
  const clientInfo = options.clientInfo ?? { name: 'openmotion-model-discovery', version: '1' };
  const buildArgs = async (directory: string) => {
    if (!options.isolateDeepSeek) return args;
    // DeepSeek Harness persists session/new before any prompt and has no session/delete.
    const patchPath = path.join(directory, 'probe-patch.json');
    await writeFile(patchPath, JSON.stringify([
      { id: 'session-persistence-jsonl', config: { root: path.join(directory, 'sessions') } },
      { id: 'session-projection-cache', disabled: true },
    ]));
    return [...args, '--patch', patchPath];
  };

  return runNdjsonProbe<AcpDiscoveryResult>(bin, buildArgs, timeoutMs, ctx => {
    let agentVersion: string | undefined;
    let canDeleteSession = false;
    let sessionId: string | undefined;
    let latestConfigOptions: unknown;
    let initialAvailableModels: unknown;
    let sessionCreated = false;
    let deleting = false;
    let deleteResult: AcpDiscoveryResult | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let cleanupTimer: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      if (graceTimer) clearTimeout(graceTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    };
    const sendRpc = (id: number, method: string, params: unknown) => ctx.send({ jsonrpc: '2.0', id, method, params });
    const complete = (value: AcpDiscoveryResult) => {
      if (deleting) return;
      clearTimers();
      if (canDeleteSession && sessionId) {
        deleting = true;
        deleteResult = value;
        try { sendRpc(3, 'session/delete', { sessionId }); } catch { ctx.done(value); return; }
        cleanupTimer = setTimeout(() => ctx.done(value), 300);
        cleanupTimer.unref();
        return;
      }
      ctx.done(value);
    };
    const finishCurrent = () => complete({
      models: extractAcpModels(latestConfigOptions, initialAvailableModels),
      auth: 'unknown',
      ...(agentVersion ? { version: agentVersion } : {}),
    });

    sendRpc(1, 'initialize', { protocolVersion: 1, clientInfo, clientCapabilities: {} });
    return {
      onExit: () => {
        clearTimers();
        if (deleting && deleteResult) ctx.done(deleteResult);
        else if (sessionCreated) ctx.done({ models: extractAcpModels(latestConfigOptions, initialAvailableModels), auth: 'unknown', ...(agentVersion ? { version: agentVersion } : {}) });
      },
      onMessage: message => {
        if (deleting && message.id === 3) {
          clearTimers();
          if (deleteResult) ctx.done(deleteResult);
        } else if (message.method && message.id !== undefined) {
          // Decline any server-initiated operation during discovery.
          ctx.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Discovery does not support client operations' } });
        } else if (message.method === 'session/update' && message.params?.update) {
          const update = message.params.update;
          if (update.sessionUpdate === 'config_option_update' && Array.isArray(update.configOptions)) {
            latestConfigOptions = update.configOptions;
            if (sessionCreated && extractAcpModels(latestConfigOptions, initialAvailableModels).length > 1) finishCurrent();
          }
        } else if (message.error && (message.id === 1 || message.id === 2)) {
          clearTimers();
          if (isAcpAuthError(message.error)) ctx.done({ models: [], auth: 'signed-out', ...(agentVersion ? { version: agentVersion } : {}) });
          else ctx.fail(new Error('Agent could not list models'));
        } else if (message.id === 1) {
          const res = message.result ?? {};
          if (typeof res.agentInfo?.version === 'string' && res.agentInfo.version.trim()) {
            agentVersion = res.agentInfo.version.trim().match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?\b/)?.[0];
          }
          canDeleteSession = res.agentCapabilities?.sessionCapabilities?.delete != null
            || res.agentCapabilities?.session_capabilities?.delete != null;
          sendRpc(2, 'session/new', { cwd: ctx.directory, mcpServers: [] });
        } else if (message.id === 2) {
          sessionCreated = true;
          const result = message.result ?? {};
          if (typeof result.sessionId === 'string') sessionId = result.sessionId;
          if (result.configOptions !== undefined && (latestConfigOptions === undefined || extractAcpModels(result.configOptions, undefined).length > extractAcpModels(latestConfigOptions, undefined).length)) {
            latestConfigOptions = result.configOptions;
          }
          initialAvailableModels = result.models?.availableModels;
          const initial = extractAcpModels(latestConfigOptions, initialAvailableModels);
          // Agents like Qoder CLI & OpenCode fetch their catalog asynchronously after session/new.
          if (initial.length > 1 || catalogGraceMs <= 0) complete({ models: initial, auth: 'unknown', ...(agentVersion ? { version: agentVersion } : {}) });
          else graceTimer = setTimeout(finishCurrent, catalogGraceMs);
        }
      },
    };
  });
}

/** Codex app-server model/list RPC: ~2s vs ~16s for `codex debug models`, paginated and clean. */
export async function discoverCodexAppServer(bin: string, timeoutMs = 20_000): Promise<{ models: AgentModel[]; auth: AgentAuth }> {
  return runNdjsonProbe(bin, ['app-server', '--listen', 'stdio://'], timeoutMs, ctx => {
    let pages = 0, requestId = 1;
    const collected: unknown[] = [];
    ctx.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'openmotion-model-discovery', version: '1' } } });
    return {
      onMessage: message => {
        if (message.method && message.id !== undefined) {
          ctx.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Discovery does not support client operations' } });
        } else if (message.error && message.id !== undefined) {
          if (isAcpAuthError(message.error)) ctx.done({ models: [], auth: 'signed-out' });
          else ctx.fail(new Error('Codex could not list models'));
        } else if (message.id === 1) {
          ctx.send({ jsonrpc: '2.0', method: 'initialized' });
          requestId = 2;
          ctx.send({ jsonrpc: '2.0', id: requestId, method: 'model/list', params: {} });
        } else if (message.id === requestId && requestId >= 2) {
          const res = message.result ?? {};
          const page = Array.isArray(res.data) ? res.data : Array.isArray(res.models) ? res.models : [];
          collected.push(...page);
          pages++;
          if (typeof res.nextCursor === 'string' && res.nextCursor && pages < 10) {
            requestId++;
            ctx.send({ jsonrpc: '2.0', id: requestId, method: 'model/list', params: { cursor: res.nextCursor } });
          } else {
            ctx.done({ models: normalizeAgentModels(collected), auth: 'unknown' });
          }
        }
      },
    };
  });
}

function claudeModelLabel(info: any): string {
  const display = typeof info.displayName === 'string' ? info.displayName.trim() : '';
  const descHead = typeof info.description === 'string' ? info.description.split(' · ')[0]?.trim() ?? '' : '';
  if (display && descHead && descHead.toLowerCase().startsWith(display.toLowerCase()) && descHead.length <= 80) return descHead;
  if (display) return display;
  if (typeof info.resolvedModel === 'string' && info.resolvedModel.trim()) return info.resolvedModel.trim();
  return String(info.value ?? '');
}

/** Claude Code stdio control_request initialize (~200ms). Sends no prompt and disables hooks/MCP. */
export async function discoverClaudeModels(bin: string, timeoutMs = 15_000): Promise<{ models: AgentModel[]; version?: string }> {
  const args = [
    '--print', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
    '--setting-sources', 'user',
    '--settings', JSON.stringify({ disableAllHooks: true }),
    '--mcp-config', JSON.stringify({ mcpServers: {} }),
    '--no-session-persistence',
  ];
  return runNdjsonProbe(bin, args, timeoutMs, ctx => {
    ctx.send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize' } });
    return {
      onMessage: message => {
        if (message.type !== 'control_response' || message.response?.request_id !== 'init-1') return;
        if (message.response.subtype !== 'success') return ctx.fail(new Error('Claude initialize failed'));
        const payload = message.response.response ?? {};
        const rawList = Array.isArray(payload.models) ? payload.models : [];
        const mapped = rawList
          .filter((item: any) => item && typeof item.value === 'string' && item.value.trim() !== 'default')
          .map((item: any) => ({
            id: item.value.trim(),
            label: claudeModelLabel(item),
            supportsEffort: item.supportsEffort,
            supportedEffortLevels: item.supportedEffortLevels,
          }));
        const version = typeof payload.claude_code_version === 'string'
          ? payload.claude_code_version.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?\b/)?.[0]
          : undefined;
        ctx.done({ models: normalizeAgentModels(mapped, 'cli'), ...(version ? { version } : {}) });
      },
    };
  });
}

function piModelReasoning(model: any): string[] | undefined {
  if (!model || model.reasoning !== true) return undefined;
  const map = model.thinkingLevelMap && typeof model.thinkingLevelMap === 'object' ? model.thinkingLevelMap : undefined;
  const levels = PI_THINKING_LEVELS.filter(level => {
    const mapped = map?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
  return levels.length ? [...levels] : undefined;
}

/** Pi RPC discovery (`pi --mode rpc --no-session` -> `get_available_models`). */
export async function discoverPiRpc(bin: string, timeoutMs = 20_000): Promise<{ models: AgentModel[] }> {
  return runNdjsonProbe(bin, ['--mode', 'rpc', '--no-session'], timeoutMs, ctx => {
    ctx.send({ id: 'models-1', type: 'get_available_models' });
    return {
      onMessage: message => {
        if (message.type !== 'response' || message.command !== 'get_available_models') return;
        if (message.success === false) return ctx.fail(new Error('Pi could not list models'));
        const list = Array.isArray(message.data?.models) ? message.data.models : [];
        const mapped = list.flatMap((model: any) => {
          const provider = typeof model?.provider === 'string' ? model.provider.trim() : '';
          const id = typeof model?.id === 'string' ? model.id.trim() : '';
          if (!provider || !id) return [];
          const slug = `${provider}/${id}`;
          const reasoning = piModelReasoning(model);
          return [{ id: slug, label: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : slug, ...(reasoning ? { reasoning } : {}) }];
        });
        ctx.done({ models: normalizeAgentModels(mapped) });
      },
    };
  });
}
