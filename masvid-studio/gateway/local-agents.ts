import path from 'node:path';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import { localAgents, type AgentChoice, type AgentDirectory, type AgentLaunch, type AgentModel, type LocalAgent } from '../shared/local-agents.ts';
import { resolveAgent } from './agents.ts';
import {
  discoverAcp,
  discoverClaudeModels,
  discoverCodexAppServer,
  discoverPiRpc,
  normalizeAgentModels,
  parseAgentAuth,
  parseAgentModels,
  parseAmpAgentOptions,
  probeAgent,
  qwenModels,
  validModelId,
  vibeConfigModels,
  type AcpDiscoveryOptions,
  type AcpDiscoveryResult,
  type Probe,
} from './agent-discovery.ts';
import { readSettings, writeSettings } from './settings-storage.ts';
import { launchTerminal, terminalCommand } from './agent-terminal.ts';

type AgentDiscoverers = {
  acp: (bin: string, args: string[], options?: AcpDiscoveryOptions) => Promise<AcpDiscoveryResult>;
  codex: (bin: string) => Promise<{ models: AgentModel[]; auth: LocalAgent['auth'] }>;
  claude: (bin: string) => Promise<{ models: AgentModel[]; version?: string }>;
  pi: (bin: string) => Promise<{ models: AgentModel[] }>;
};

const defaultDiscoverers: AgentDiscoverers = {
  acp: discoverAcp,
  codex: discoverCodexAppServer,
  claude: discoverClaudeModels,
  pi: discoverPiRpc,
};

const BIN_ALIASES: Record<string, string[]> = Object.fromEntries(
  localAgents.filter(agent => agent.binAliases?.length).map(agent => [agent.bin, [agent.bin, ...agent.binAliases!]]),
);

export async function resolveLocalAgent(bin: string): Promise<string | null> {
  const names = BIN_ALIASES[bin] ?? [bin];
  for (const name of names) {
    const found = await resolveAgent(name);
    if (found) return found;
  }
  const home = os.homedir();
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter).filter(dir => path.isAbsolute(dir)),
    path.join(home, '.local/bin'),
    path.join(home, '.bun/bin'),
    path.join(home, '.cargo/bin'),
    path.join(home, '.npm-global/bin'),
    path.join(home, '.opencode/bin'),
    path.join(home, '.cursor/bin'),
    path.join(home, '.antigravity/bin'),
    path.join(home, '.claude/local'),
    path.join(home, '.kiro/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(process.platform === 'win32' && process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
  ];
  for (const dir of dirs) for (const name of names) for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd'] : ['']) {
    const file = path.join(dir, name + suffix);
    try { await access(file, constants.X_OK); return file; } catch { /* next */ }
  }
  return null;
}

function antigravityAcpClientInfo(version?: string): { name: string; version: string } {
  // Antigravity < 1.5.1 only exposes non-Gemini models to allowlisted ACP editors such as Zed.
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (match) {
    const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (major < 1 || (major === 1 && (minor < 5 || (minor === 5 && patch < 1)))) {
      return { name: 'zed', version: '0.0.0' };
    }
  }
  return { name: 'openmotion-model-discovery', version: '1' };
}

function mergeModels(...lists: AgentModel[][]): AgentModel[] {
  const seen = new Set<string>();
  const merged: AgentModel[] = [];
  for (const list of lists) {
    for (const model of list) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      merged.push(model);
    }
  }
  return merged;
}

function helpHasText(help: { ok: boolean; text: string }): boolean {
  return help.ok || (Boolean(help.text) && /\b(?:usage|options|flags|commands)\b/i.test(help.text));
}

export class LocalAgentDirectory {
  readonly file: string;
  cache = new Map<string, LocalAgent>();
  pending = new Map<string, Promise<LocalAgent>>();
  private queue = Promise.resolve();
  readonly directory: string;
  readonly resolve: typeof resolveLocalAgent;
  readonly probe: Probe;
  readonly terminal: typeof launchTerminal;
  readonly discoverers: AgentDiscoverers;
  constructor(
    directory: string,
    resolve = resolveLocalAgent,
    probe: Probe = probeAgent,
    terminal = launchTerminal,
    discoverers: Partial<AgentDiscoverers> = {},
  ) {
    this.directory = directory;
    this.resolve = resolve;
    this.probe = probe;
    this.terminal = terminal;
    this.discoverers = { ...defaultDiscoverers, ...discoverers };
    this.file = path.join(directory, 'agents/preferences.json');
  }
  async preferences(): Promise<{ default: AgentChoice | null; custom: Record<string, string[]> }> { return readSettings(this.file, { default: null, custom: {} }); }
  async list(): Promise<AgentDirectory> {
    const prefs = await this.preferences();
    const agents = await Promise.all(localAgents.map(async agent => {
      const installed = Boolean(await this.resolve(agent.bin)), cached = this.cache.get(agent.id);
      return { ...agent, ...(installed ? cached : undefined), installed, auth: installed ? cached?.auth ?? 'unknown' : 'unknown', models: [...(installed ? cached?.models ?? [] : []), ...normalizeAgentModels(prefs.custom[agent.id] ?? [], 'custom')].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index) } as LocalAgent;
    }));
    return { agents, default: prefs.default };
  }
  inspect(id: string): Promise<LocalAgent> {
    if (this.pending.has(id)) return this.pending.get(id)!;
    const work = this.probeOne(id).finally(() => this.pending.delete(id)); this.pending.set(id, work); return work;
  }

  private async resolveCompanionBin(primaryBin: string, companionName: string): Promise<string | null> {
    const dir = path.dirname(primaryBin);
    for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd'] : ['']) {
      const sibling = path.join(dir, companionName + suffix);
      try { await access(sibling, constants.X_OK); return sibling; } catch { /* next */ }
    }
    return this.resolve(companionName);
  }

  private async tryAcpCandidates(
    bin: string,
    candidates: string[][],
    options: AcpDiscoveryOptions,
  ): Promise<{ ok: boolean; models: AgentModel[]; auth: LocalAgent['auth']; version?: string }> {
    let anySucceeded = false;
    let version: string | undefined;
    for (const args of candidates) {
      try {
        const data = await this.discoverers.acp(bin, args, options);
        anySucceeded = true;
        if (data.version && !version) version = data.version;
        if (data.auth === 'signed-out') return { ok: true, models: [], auth: 'signed-out', version };
        if (data.models.length > 0) return { ok: true, models: data.models, auth: data.auth, version };
      } catch { /* try next ACP argument variant */ }
    }
    return { ok: anySucceeded, models: [], auth: 'unknown', version };
  }

  private async probeOne(id: string): Promise<LocalAgent> {
    const def = localAgents.find(agent => agent.id === id); if (!def) throw new Error('Unknown Agent');
    const bin = await this.resolve(def.bin);
    const result: LocalAgent = { ...def, installed: Boolean(bin), auth: 'unknown', models: [], checkedAt: new Date().toISOString() };
    if (!bin) { this.cache.delete(id); return result; }
    const [version, help] = await Promise.all([this.probe(bin, ['--version']), this.probe(bin, [...(def.startArgs ?? []), '--help'])]);
    result.version = version.ok ? version.text.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?\b/)?.[0] : undefined;
    // Do not pass model/effort flags to an older CLI that does not advertise them.
    const hasHelp = helpHasText(help);
    result.modelFlag = hasHelp && /(?:^|\s)--model\b/.test(help.text) ? '--model' : undefined;
    result.effortFlag = hasHelp && /(?:^|\s)--effort\b/.test(help.text) ? '--effort' : undefined;
    const authArgs = id === 'codex' ? ['login', 'status'] : ['claude', 'openclaude'].includes(id) ? ['auth', 'status'] : id === 'cursor-agent' ? ['status'] : undefined;
    if (authArgs) { const auth = await this.probe(bin, authArgs); result.auth = parseAgentAuth(id, auth.ok, auth.text); }

    const acpOptions: AcpDiscoveryOptions = {
      ...(id === 'antigravity' ? { clientInfo: antigravityAcpClientInfo(result.version) } : {}),
      ...(id === 'deepseek-harness' ? { isolateDeepSeek: true } : {}),
    };

    try {
      if (def.discovery === 'codex') {
        let discovered = false;
        try {
          const data = await this.discoverers.codex(bin);
          if (data.auth === 'signed-out') { result.auth = 'signed-out'; discovered = true; }
          else if (data.models.length > 0) { result.models = data.models; discovered = true; }
        } catch { /* fall back to `codex debug models` */ }
        if (!discovered) {
          const models = await this.probe(bin, ['debug', 'models']);
          if (!models.ok) throw new Error('Model discovery unavailable');
          result.models = parseAgentModels('codex', models.text);
        }
      } else if (def.discovery === 'claude') {
        try {
          const data = await this.discoverers.claude(bin);
          if (data.version && !result.version) result.version = data.version;
          if (data.models.length > 0) result.models = data.models;
        } catch { /* fall back to Claude aliases */ }
        if (!result.models.length) result.models = normalizeAgentModels(['sonnet', 'opus', 'haiku'], 'alias');
      } else if (def.discovery === 'pi') {
        let discovered = false;
        try {
          const data = await this.discoverers.pi(bin);
          if (data.models.length > 0) { result.models = data.models; discovered = true; }
        } catch { /* fall back to `pi --list-models` */ }
        if (!discovered) {
          const data = await this.probe(bin, def.modelArgs!);
          if (!data.ok) throw new Error('Model discovery unavailable');
          result.models = parseAgentModels('pi', data.text);
        }
      } else if (def.discovery === 'qwen') {
        const local = await qwenModels();
        const acp = def.acpArgs ? await this.tryAcpCandidates(bin, [def.acpArgs], acpOptions) : { ok: false, models: [], auth: 'unknown' as const };
        if (acp.version && !result.version) result.version = acp.version;
        if (acp.auth === 'signed-out' && !local.length) result.auth = 'signed-out';
        result.models = mergeModels(acp.models, local);
        if (!acp.ok && !local.length && result.auth !== 'signed-out') throw new Error('Model discovery unavailable');
      } else if (def.discovery === 'vibe') {
        const acpBin = def.acpBin ? await this.resolveCompanionBin(bin, def.acpBin) : null;
        const acp = acpBin ? await this.tryAcpCandidates(acpBin, [def.acpArgs ?? []], acpOptions) : { ok: false, models: [], auth: 'unknown' as const };
        if (acp.version && !result.version) result.version = acp.version;
        if (acp.auth === 'signed-out') result.auth = 'signed-out';
        const local = await vibeConfigModels();
        result.models = mergeModels(acp.models, local);
      } else if (def.discovery === 'amp') {
        const acpBin = def.acpBin ? await this.resolveCompanionBin(bin, def.acpBin) : null;
        const acp = acpBin ? await this.tryAcpCandidates(acpBin, [def.acpArgs ?? []], acpOptions) : { ok: false, models: [], auth: 'unknown' as const };
        if (acp.version && !result.version) result.version = acp.version;
        if (acp.auth === 'signed-out') result.auth = 'signed-out';
        if (acp.models.length > 0) result.models = acp.models;
        else {
          const opts = await this.probe(bin, ['plugins', 'show-agent-options', '--json']);
          result.models = opts.ok ? parseAmpAgentOptions(opts.text) : parseAgentModels('help', help.text);
        }
      } else if (def.discovery === 'acp') {
        const candidates = [def.acpArgs!, ...(def.acpFallbacks ?? [])];
        const acp = await this.tryAcpCandidates(bin, candidates, acpOptions);
        if (acp.version && !result.version) result.version = acp.version;
        if (acp.auth === 'signed-out') {
          result.auth = 'signed-out';
        } else if (acp.models.length > 0) {
          result.models = acp.models;
        } else {
          let fallbackOk = acp.ok;
          if (def.modelArgs) {
            const data = await this.probe(bin, def.modelArgs);
            if (data.ok) { fallbackOk = true; result.models = parseAgentModels('lines', data.text); }
          }
          if (!result.models.length && hasHelp) {
            const fromHelp = parseAgentModels('help', help.text);
            if (fromHelp.length > 0) { fallbackOk = true; result.models = fromHelp; }
          }
          if (!fallbackOk) throw new Error('Model discovery unavailable');
        }
      } else if (def.discovery === 'help') {
        if (def.acpArgs && hasHelp && /\bacp\b/i.test(help.text)) {
          const acp = await this.tryAcpCandidates(bin, [def.acpArgs], acpOptions);
          if (acp.auth === 'signed-out') result.auth = 'signed-out';
          else if (acp.models.length > 0) result.models = acp.models;
        }
        if (!result.models.length && hasHelp) result.models = parseAgentModels('help', help.text);
      } else if (def.modelArgs) {
        const data = await this.probe(bin, def.modelArgs);
        if (data.ok) result.models = parseAgentModels(def.discovery, data.text);
        if (!result.models.length && def.acpArgs && (!hasHelp || /\bacp\b/i.test(help.text) || ['opencode', 'cursor-agent', 'mimo'].includes(id))) {
          const acp = await this.tryAcpCandidates(bin, [def.acpArgs], acpOptions);
          if (acp.version && !result.version) result.version = acp.version;
          if (acp.auth === 'signed-out') result.auth = 'signed-out';
          else if (acp.models.length > 0) result.models = acp.models;
          else if (!data.ok && !acp.ok && id !== 'atomcode') throw new Error('Model discovery unavailable');
        } else if (!data.ok && id !== 'atomcode') {
          const fromHelp = hasHelp ? parseAgentModels('help', help.text) : [];
          if (fromHelp.length > 0) result.models = fromHelp;
          else throw new Error('Model discovery unavailable');
        }
        if (!result.models.length && hasHelp) result.models = parseAgentModels('help', help.text);
      }
    } catch { result.discoveryError = 'Could not discover models. Sign in or update the Agent, then refresh.'; }
    this.cache.set(id, result); return result;
  }
  private change(fn: () => Promise<void>) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }
  async addModel(id: string, model: unknown) {
    if (!localAgents.some(agent => agent.id === id) || !validModelId(model) || model === 'default') throw new Error('Invalid Agent model ID');
    await this.change(async () => { const prefs = await this.preferences(); prefs.custom[id] = [...new Set([...(prefs.custom[id] ?? []), model])].slice(0, 100); await writeSettings(this.file, prefs); });
  }
  async choose(choice: AgentChoice | null) {
    if (choice) await this.validate(choice);
    await this.change(async () => { const prefs = await this.preferences(); prefs.default = choice; await writeSettings(this.file, prefs); });
  }
  private async validate(choice: AgentChoice) {
    if (!choice || !localAgents.some(agent => agent.id === choice.agent) || !validModelId(choice.model)) throw new Error('Invalid Agent selection');
    if (!this.cache.has(choice.agent)) await this.inspect(choice.agent);
    const agent = (await this.list()).agents.find(agent => agent.id === choice.agent)!;
    if (!agent.installed) throw new Error('Install the Agent first');
    if (agent.auth === 'signed-out') throw new Error('Sign in to the Agent first');
    const model = agent.models.find(model => model.id === choice.model);
    if (choice.model !== 'default' && !model) throw new Error('Refresh models or add the exact model ID');
    if (choice.reasoning && !model?.reasoning?.includes(choice.reasoning)) throw new Error('Unsupported reasoning level');
    return agent;
  }
  async prepare(choice: AgentChoice, cwd: string, previewUrl: string, action: 'login' | 'launch'): Promise<AgentLaunch> {
    const def = localAgents.find(agent => agent.id === choice.agent); if (!def) throw new Error('Unknown Agent');
    const bin = await this.resolve(def.bin); if (!bin) throw new Error('Install the Agent first');
    const agent = action === 'launch' ? await this.validate(choice) : undefined;
    const args = [...(action === 'login' ? def.loginArgs ?? def.startArgs ?? [] : def.startArgs ?? [])];
    const modelInCommand = action === 'launch' && choice.model !== 'default' && Boolean(agent?.modelFlag);
    if (modelInCommand) args.push(agent!.modelFlag!, choice.model);
    if (action === 'launch' && choice.reasoning) {
      if (choice.agent === 'codex') args.push('-c', `model_reasoning_effort="${choice.reasoning}"`);
      else if (agent?.effortFlag) args.push(agent.effortFlag, choice.reasoning);
    }
    const instruction = `Connect this Agent to OpenMotion using ${previewUrl}/connect/guide?host=${choice.agent === 'codex' || choice.agent === 'claude' ? choice.agent : choice.agent === 'deepseek-harness' ? 'deepseek' : 'mcp'}. Verify access to the current project before editing. ${choice.model !== 'default' ? `Use model ${choice.model}${choice.reasoning ? ` with ${choice.reasoning} reasoning` : ''}. ` : ''}Keep the Agent's normal approval controls enabled.`;
    return { command: terminalCommand(bin, args, cwd), instruction, modelInCommand, terminalAvailable: ['darwin', 'win32', 'linux'].includes(process.platform) };
  }
  async open(choice: AgentChoice, cwd: string, previewUrl: string, action: 'login' | 'launch') {
    const plan = await this.prepare(choice, cwd, previewUrl, action);
    await this.terminal(this.directory, plan.command); return plan;
  }
}
const directories = new Map<string, LocalAgentDirectory>();
export function localAgentsFor(directory: string) { let value = directories.get(directory); if (!value) { value = new LocalAgentDirectory(directory); directories.set(directory, value); } return value; }
