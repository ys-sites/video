import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
/** The OpenDesign connector version this release speaks to. */
export const connectorVersion = '0.1.10';
export const connectorPackage = '@powerformer/vela-cli';
/** Why a connector could not be prepared: npm was not found, npm could not install it, or the installed copy does not run. */
export type ConnectorProblem = 'npm_missing' | 'install_failed' | 'start_failed';
export class ConnectorUnavailable extends Error {
  readonly problem: ConnectorProblem;
  /** Local diagnostic only (end of npm's output or the start error); never shown or sent as telemetry. */
  readonly detail: string;
  constructor(problem: ConnectorProblem, detail: unknown) {
    super('OpenDesign connector unavailable: ' + problem);
    this.problem = problem;
    const output = (detail as { stderr?: unknown })?.stderr;
    this.detail = String(typeof output === 'string' && output.trim() ? output : (detail as Error)?.message ?? detail).trim().slice(-600);
  }
}

/** The private installation, outside the application so it survives upgrades and needs nothing on PATH. */
export const connectorRuntime = (dataDirectory: string) => path.join(dataDirectory, 'account', 'runtime');
const installArgs = (root: string) => ['install', '--prefix', root, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `${connectorPackage}@${connectorVersion}`];
/** What a person can run in a terminal when automatic installation keeps failing. POSIX shells expand `$` and backticks in double quotes. */
export function manualInstallCommand(root: string, platform = process.platform) {
  const quoted = platform === 'win32' ? `"${root}"` : `'${root.replaceAll("'", `'\\''`)}'`;
  return `npm install --prefix ${quoted} --ignore-scripts ${connectorPackage}@${connectorVersion}`;
}

/**
 * npm locations to try, most specific first. `process.execPath` is the resolved binary, so a Homebrew Node reports its
 * Cellar directory, where npm lives under `libexec` rather than next to Node. Hosts may also start the service without
 * the terminal's npm on PATH, so PATH is the last resort rather than the first.
 */
export function npmCliCandidates(execPath: string, platform: string, env: NodeJS.ProcessEnv) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join, dirname = platform === 'win32' ? path.win32.dirname : path.posix.dirname;
  const bin = dirname(execPath), cli = ['node_modules', 'npm', 'bin', 'npm-cli.js'];
  const launched = env.npm_execpath && /(^|[\\/])npm-cli\.js$/.test(env.npm_execpath) ? [env.npm_execpath] : [];
  if (platform === 'win32') return [...launched, join(bin, ...cli)];
  return [...launched, join(bin, '..', 'lib', ...cli), join(bin, '..', 'libexec', 'lib', ...cli)];
}
async function npmOnPath(platform: string, env: NodeJS.ProcessEnv) {
  const separator = platform === 'win32' ? ';' : ':';
  for (const directory of (env.PATH ?? env.Path ?? '').split(separator).filter(Boolean)) {
    // Windows ships `npm.cmd` beside `node_modules\npm`; elsewhere `npm` links to `npm-cli.js`.
    const candidate = platform === 'win32' ? path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js') : await realpath(path.join(directory, 'npm')).catch(() => '');
    if (candidate.endsWith('npm-cli.js') && await access(candidate).then(() => true, () => false)) return candidate;
  }
}
export async function findNpmCli(execPath = process.execPath, platform = process.platform, env = process.env) {
  for (const candidate of npmCliCandidates(execPath, platform, env)) if (await access(candidate).then(() => true, () => false)) return candidate;
  return npmOnPath(platform, env);
}

/** The connector binary installed under `from` (a module or package.json path), checked to be the locked version. */
export async function verifyConnector(from: string) {
  const binary = createRequire(from)(connectorPackage).resolveVelaCliBin({ strict: true }) as string;
  const { stdout } = await execute(binary, ['--version'], { timeout: 5000 });
  if (stdout.trim() !== connectorVersion) throw new Error('The installed account connector version is not supported');
  return binary;
}

/** Installs the locked connector into `root` with lifecycle scripts disabled; reuses an installation that already works. */
export async function installConnector(root: string, options: { signal?: AbortSignal; timeoutMs?: number; findNpm?: () => Promise<string | undefined> } = {}) {
  const manifest = path.join(root, 'package.json');
  try { return await verifyConnector(manifest); } catch { /* Install below. */ }
  const npmCli = await (options.findNpm ?? findNpmCli)();
  if (!npmCli) throw new ConnectorUnavailable('npm_missing', 'npm was not found next to ' + process.execPath + ' or on PATH');
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await execute(process.execPath, [npmCli, ...installArgs(root)], { timeout: options.timeoutMs ?? 300_000, maxBuffer: 1024 * 1024, signal: options.signal, windowsHide: true });
  } catch (error) { throw new ConnectorUnavailable('install_failed', error); }
  try { return await verifyConnector(manifest); } catch (error) { throw new ConnectorUnavailable('start_failed', error); }
}
