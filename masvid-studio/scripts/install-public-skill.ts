import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const source = 'nexu-io/openmotion';
const agents: Record<string, string> = { codex: 'codex', claude: 'claude-code' };
export const skillsCliVersion = '1.9.0';

type Options = {
  host: string;
  ref?: string;
  homeDirectory?: string;
  projectDirectory?: string;
  env?: NodeJS.ProcessEnv;
  run?: (command: string, args: string[], options: object) => Promise<unknown>;
};

// Only the official CLI records its own installation event. Do not synthesize
// telemetry or reinstall an existing entry merely to produce another event.
export async function installPublicSkill(options: Options) {
  const { host, ref = 'main', homeDirectory = os.homedir(), env = process.env, run = execute, projectDirectory } = options;
  if (env.OPENMOTION_SKIP_PUBLIC_SKILL === '1') return { status: 'skipped', reason: 'disabled' };
  const scopedDsh = host === 'deepseek' && Boolean(projectDirectory);
  if (!Object.hasOwn(agents, host) && !scopedDsh) return { status: 'skipped', reason: 'no Skills CLI host adapter' };
  if (projectDirectory && (!scopedDsh || !path.isAbsolute(projectDirectory))) throw new Error('Use an absolute DSH profile Skill scope');
  if (!/^(main|[a-f0-9]{40})$/.test(ref)) throw new Error('Invalid public Skill source ref');
  // Alternate host homes are intentionally outside this global CLI adapter.
  const hostHome = host === 'codex' ? env.CODEX_HOME : env.CLAUDE_CONFIG_DIR;
  const defaultHostHome = path.join(homeDirectory, host === 'codex' ? '.codex' : '.claude');
  if (!scopedDsh && hostHome && path.resolve(hostHome) !== defaultHostHome) {
    return { status: 'skipped', reason: 'custom host home; install the Skill explicitly in that profile' };
  }
  const canonicalRoot = path.join(projectDirectory || homeDirectory, '.agents');
  const targets = [path.join(canonicalRoot, 'skills/openmotion')];
  if (host === 'claude') targets.push(path.join(homeDirectory, '.claude/skills/openmotion'));
  let lock: { version?: number; skills?: Record<string, { source?: string }> } | undefined;
  let lockFile = path.join(canonicalRoot, '.skill-lock.json');
  if (projectDirectory) lockFile = path.join(projectDirectory, 'skills-lock.json');
  else if (env.XDG_STATE_HOME) lockFile = path.join(env.XDG_STATE_HOME, 'skills/.skill-lock.json');
  try { lock = JSON.parse(await readFile(lockFile, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const owned = (projectDirectory ? [1, 2].includes(lock?.version || 0) : lock?.version === 3) && lock?.skills?.openmotion?.source === source;
  let allPresent = true;
  for (const target of targets) {
    const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!existing) { allPresent = false; continue; }
    const scope = await readFile(path.join(target, 'scope.json'), 'utf8').then(JSON.parse).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (scope?.managedBy === '@openmotion/installer' && typeof scope.installHome === 'string' && scope.installHome
      && (!scope.host || scope.host === 'codex')) {
      return { status: 'skipped', reason: 'legacy Codex workflow bundle; rerun Codex setup to migrate before installing the public Skill' };
    }
    if (!owned) throw new Error('Public Skill target is not owned by Skills CLI: ' + target);
    // A stale lock must not authorize replacement of a legacy runtime bundle.
    const content = await readFile(path.join(target, 'SKILL.md'), 'utf8');
    if (!/^name: openmotion\s*$/m.test(content)) throw new Error('Unexpected public Skill at ' + target);
  }
  if (allPresent) return { status: 'present', source };
  const npm = env.npm_execpath || path.resolve(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
  await run(process.execPath, [npm, 'exec', '--yes', '--package=skills@' + skillsCliVersion, '--', 'skills', 'add',
    `https://github.com/${source}/tree/${ref}`, '--skill', 'openmotion', ...(projectDirectory ? [] : ['--global']), '--agent', scopedDsh ? 'universal' : agents[host], '--copy', '--yes'],
  { env, ...(projectDirectory ? { cwd: projectDirectory } : {}), timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  return { status: 'installed', source, ref };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(await installPublicSkill({ host: process.argv[2] || 'codex', ref: process.argv[3] || 'main' }))); }
  catch (error) {
    console.error('OpenMotion public Skill was not installed: ' + (error instanceof Error ? error.message : String(error)));
    console.error('Runtime installation remains usable. Retry with: npx skills add nexu-io/openmotion --skill openmotion -g');
    process.exitCode = 1;
  }
}
