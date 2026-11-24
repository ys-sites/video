import assert from 'node:assert/strict';
import { access, cp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { canonical, readJSON, runFile, withLock, writeJSON } from './runtime-assets.mjs';

// Hosts with a dedicated registration adapter. Any other valid --host name installs the same
// application, launcher and Skills, then hands the MCP entry to the calling Agent to register.
export const hosts = ['codex', 'claude', 'deepseek', 'workbuddy'];
export const genericHostPattern = /^[a-z][a-z0-9-]{0,31}$/;
// `constructor` and the other Object.prototype keys match the name pattern but are never an Agent name.
const prototypeHostNames = new Set(Object.getOwnPropertyNames(Object.prototype));
export const isGenericHostName = host => genericHostPattern.test(host) && !prototypeHostNames.has(host);
// Generic hosts share one flat Skills root, so their Skills have one owner rather than one per Agent name.
const genericSkillOwner = 'agents';
// Keep ownership stable so earlier local installations remain upgradable.
const owner = '@openmotion/installer';
const bundleName = 'dsh-plugin-openmotion-local';
const equalTransport = (actual, expected) => actual?.command === expected.command && JSON.stringify(actual.args) === JSON.stringify(expected.args);

export async function resolveHostCommand(command, platform = process.platform) {
  if (/\.[cm]?js$/i.test(command)) return { command: process.execPath, args: [command] };
  if (platform !== 'win32') return { command, args: [] };
  const directories = /[/\\]/.test(command) ? [''] : (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const suffixes = path.extname(command) ? [''] : ['.exe', '.com', '.cmd', '.ps1'];
  for (const directory of directories) for (const suffix of suffixes) {
    const file = path.resolve(directory.replace(/^"|"$/g, ''), command + suffix);
    try { await access(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!/\.(cmd|ps1)$/i.test(file)) return { command: file, args: [] };
    // shortcut: unwrap npm's quoted JS/native entries only; extend when another host shim format is needed.
    const shim = await readFile(file, 'utf8');
    const target = [...shim.matchAll(/["'](?:%dp0%|\$basedir)[\\/]([^"'\r\n]+\.(?:[cm]?js|exe))["']/gi)].at(-1)?.[1];
    assert(target, 'HOST_CLI_UNSUPPORTED_SHIM: Use the host .exe or JavaScript CLI entry instead of ' + file);
    const entry = path.resolve(path.dirname(file), target.replaceAll('\\', '/'));
    await access(entry);
    return /\.[cm]?js$/i.test(entry) ? { command: process.execPath, args: [entry] } : { command: entry, args: [] };
  }
  throw new Error('HOST_CLI_NOT_FOUND: ' + command + '. Install the host CLI or pass its executable/JavaScript entry path.');
}

async function runHostCli(command, args, options) {
  const resolved = await resolveHostCommand(command);
  return runFile(resolved.command, [...resolved.args, ...args], options);
}

export async function ownedHarnessBundle(directory, home, configFile) {
  if (!directory || path.dirname(directory) !== path.join(home, 'hosts') || !/^(deepseek|deepseek-[0-9a-f-]{36})$/.test(path.basename(directory))) return false;
  if (await canonical(directory) !== directory) return false;
  const scope = await readJSON(path.join(directory, 'scope.json'));
  return scope?.managedBy === owner && scope.installHome === home && scope.host === 'deepseek'
    && (scope.configFile === undefined || scope.configFile === configFile);
}

export async function harnessBundleInventory(home, configFile) {
  const entries = await readdir(path.join(home, 'hosts'), { withFileTypes: true }).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
  const owned = [];
  for (const entry of entries) {
    const directory = path.join(home, 'hosts', entry.name);
    if (entry.isDirectory() && await ownedHarnessBundle(directory, home, configFile)) owned.push(directory);
  }
  return owned.sort();
}

export async function hostPlan(options, home, launcher, previous, bundleId) {
  const host = options.host || 'codex';
  assert(hosts.includes(host) || isGenericHostName(host), 'Use --host ' + hosts.join('|') + ' or the current Agent name in lowercase letters, digits and hyphens (for example opencode)');
  const transport = { type: 'stdio', command: process.execPath, args: [launcher] };
  const saved = Object.hasOwn(previous?.hosts ?? {}, host) ? previous.hosts[host]
    : (host === 'codex' && previous?.skillsDirectory ? { skillsDirectory: previous.skillsDirectory } : null);
  if (!hosts.includes(host)) {
    // No adapter: the installer cannot read this host's configuration, so the calling Agent registers the entry.
    const skillsDirectory = await canonical(options.skillsDirectory || saved?.skillsDirectory || path.join(os.homedir(), '.agents/skills'));
    const metadata = { skillsDirectory, layout: 'flat', registration: 'agent' };
    return { host, skillOwner: genericSkillOwner, ...metadata, metadata, connection: { transport }, register: async () => {},
      agentRegistration: { serverName: 'openmotion', transport, skillsDirectory } };
  }
  const defaultSkills = host === 'claude' ? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills')
    : host === 'workbuddy' ? path.join(process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.workbuddy'), 'skills')
      : path.join(os.homedir(), '.agents/skills');
  const skillsDirectory = await canonical(options.skillsDirectory || defaultSkills);
  const metadata = { skillsDirectory, layout: host === 'codex' ? 'bundle' : 'flat' };
  if (host === 'codex') {
    const codex = options.codex || 'codex';
    const cli = args => runHostCli(codex, args);
    let current;
    try { current = JSON.parse(await cli(['mcp', 'get', 'openmotion', '--json'])); }
    catch (error) { if (!/No MCP server named ['"]openmotion['"] found/.test(error.message)) throw error; }
    assert(!current || (saved && equalTransport(current.transport, transport)), 'Existing openmotion MCP configuration is not owned by this installation');
    return { host, ...metadata, metadata, connection: current, register: async () => { if (!current) await cli(['mcp', 'add', 'openmotion', '--', process.execPath, launcher]); } };
  }
  if (host === 'claude') {
    const claude = options.claude || 'claude';
    if (bundleId) await resolveHostCommand(claude);
    const configFile = await canonical(process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'));
    const settings = await readJSON(configFile);
    assert(settings === null || (typeof settings === 'object' && !Array.isArray(settings)), 'Invalid Claude configuration');
    assert(settings?.mcpServers === undefined || (settings.mcpServers && typeof settings.mcpServers === 'object' && !Array.isArray(settings.mcpServers)), 'Invalid Claude mcpServers');
    const current = settings?.mcpServers?.openmotion;
    assert(!current || (saved?.configFile === configFile && equalTransport(current, transport)), 'Existing Claude openmotion MCP is not owned by this installation');
    metadata.configFile = configFile;
    return { host, ...metadata, metadata, connection: current && { transport: current }, register: async () => {
      if (!current) await runHostCli(claude, ['mcp', 'add-json', '-s', 'user', 'openmotion', JSON.stringify(transport)]);
    } };
  }
  if (host === 'workbuddy') {
    const configFile = path.join(await canonical(process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.workbuddy')), 'mcp.json');
    const check = config => {
      assert(config === null || (typeof config === 'object' && !Array.isArray(config)), 'Invalid WorkBuddy configuration');
      assert(config?.mcpServers === undefined || (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)), 'Invalid WorkBuddy mcpServers');
      const current = config?.mcpServers?.openmotion;
      assert(!current || (saved?.configFile === configFile && equalTransport(current, transport)), 'Existing WorkBuddy openmotion MCP is not owned by this installation');
    };
    const configured = await readJSON(configFile);
    check(configured); metadata.configFile = configFile;
    return { host, ...metadata, metadata, connection: configured?.mcpServers?.openmotion && { transport: configured.mcpServers.openmotion }, register: async () => {
      await withLock(configFile + '.openmotion.lock', async () => {
        const config = await readJSON(configFile) || {}; check(config);
        await writeJSON(configFile, { ...config, mcpServers: { ...config.mcpServers, openmotion: transport } });
      });
    } };
  }
  const profile = options.profile || 'web';
  assert(/^[a-zA-Z0-9_-]+$/.test(profile), 'Use a simple DeepSeek Harness profile name');
  const dshHome = await canonical(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
  const configFile = path.join(dshHome, 'profiles', profile, 'package.json');
  const current = await readJSON(configFile);
  assert(current === null || (typeof current === 'object' && !Array.isArray(current)), 'Invalid Harness package configuration');
  assert(current?.dependencies === undefined || (current.dependencies && typeof current.dependencies === 'object' && !Array.isArray(current.dependencies)), 'Invalid Harness dependencies');
  const legacyBundle = path.join(home, 'hosts', 'deepseek');
  const previousBundle = saved?.bundleDirectory || legacyBundle;
  assert(previousBundle === legacyBundle || (path.dirname(previousBundle) === path.join(home, 'hosts') && /^deepseek-[0-9a-f-]{36}$/.test(path.basename(previousBundle))), 'Invalid managed Harness bundle path');
  const bundleDirectory = bundleId ? path.join(home, 'hosts', 'deepseek-' + bundleId) : previousBundle;
  const dependency = current?.dependencies?.[bundleName];
  const dependencyPath = dependency && /^(file|link):/.test(dependency) ? await canonical(path.resolve(path.dirname(configFile), dependency.replace(/^(file|link):/, ''))) : null;
  const ownedDependency = dependencyPath && await ownedHarnessBundle(dependencyPath, home, configFile);
  assert(!dependency || (saved?.configFile === configFile && dependencyPath === previousBundle) || ownedDependency, 'Existing Harness OpenMotion bundle is not owned by this installation');
  const activeBundle = dependencyPath || previousBundle;
  assert(!saved || saved.configFile === configFile, 'This Harness install already targets another profile; use a separate installation for that profile');
  let dsh = options.dsh || 'dsh';
  if (!options.dsh && process.platform === 'darwin') {
    const desktop = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
    try { await access(desktop); dsh = desktop; } catch {}
  }
  if (bundleId) await resolveHostCommand(dsh);
  metadata.configFile = configFile; metadata.profile = profile; metadata.bundleDirectory = bundleDirectory;
  metadata.retainedBundles = (await harnessBundleInventory(home, configFile)).filter(directory => directory !== bundleDirectory);
  metadata.skillsDirectory = path.join(bundleDirectory, 'skills'); metadata.layout = 'deepseek';
  return { host, skillsDirectory: path.join(bundleDirectory, 'skills'), layout: 'deepseek', metadata,
    isRegistered: async () => {
      const latest = await readJSON(configFile);
      const value = latest?.dependencies?.[bundleName];
      return typeof value === 'string' && /^(file|link):/.test(value) && await canonical(path.resolve(path.dirname(configFile), value.replace(/^(file|link):/, ''))) === bundleDirectory;
    },
    readConnection: async () => {
      if (!dependency) return null;
      const patch = await readJSON(path.join(activeBundle, 'cordis.patch.yml'));
      assert(patch === null || Array.isArray(patch), 'Invalid managed Harness MCP bundle. Run setup for the same host, home and profile to repair it.');
      const configured = patch?.flatMap(item => item.insert || []).find(item => item.id === 'mcp-openmotion')?.config;
      return configured && { transport: { ...configured, type: configured.transport } };
    }, register: async () => {
    await runHostCli(dsh, ['plugin', '--profile', profile, 'add', bundleDirectory, '--ignore-scripts'], { env: { ...process.env, DSH_HOME: dshHome } });
  }, writeBundle: async (stage, appRoot, version) => {
    await writeJSON(path.join(stage, 'package.json'), { name: bundleName, version, private: true, type: 'module', files: ['cordis.patch.yml'], dsh: { bundle: { patch: './cordis.patch.yml' } } });
    const entries = [{ id: 'mcp-openmotion', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'openmotion', transport: 'stdio', command: transport.command, args: transport.args, cwd: home, failOnStartupError: true, toolCallTimeoutMs: 180000 } },
      { id: 'openmotion-skills', name: '@deepseek-ai/dsh-skill-filesystem', config: { providerName: 'openmotion', includeDefaultRoots: false, customSkillDirs: [path.join(bundleDirectory, 'skills')] } }];
    await writeJSON(path.join(stage, 'cordis.patch.yml'), [{ insert: entries }]);
  } };
}

export async function skillTargets(plan, appRoot) {
  if (plan.layout === 'bundle') return [path.join(plan.skillsDirectory, 'openmotion-workflows')];
  if (plan.layout === 'deepseek') return [plan.metadata.bundleDirectory];
  return (await readdir(path.join(appRoot, 'skills'), { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => path.join(plan.skillsDirectory, entry.name));
}

export async function obsoleteSkills(plan, home, targets) {
  if (plan.layout === 'bundle') {
    const legacy = path.join(plan.skillsDirectory, 'openmotion');
    const scope = await readJSON(path.join(legacy, 'scope.json'));
    return scope?.managedBy === owner && scope.installHome === home && (!scope.host || scope.host === plan.host) ? [legacy] : [];
  }
  if (plan.layout !== 'flat') return [];
  const entries = await readdir(plan.skillsDirectory, { withFileTypes: true }).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
  const obsolete = [];
  for (const entry of entries) {
    const target = path.join(plan.skillsDirectory, entry.name);
    if (!entry.isDirectory() || entry.name.startsWith('.') || targets.includes(target)) continue;
    let scope;
    try { scope = await readJSON(path.join(target, 'openmotion-install.json')); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    if (scope?.managedBy === owner && scope.installHome === home && scope.host === (plan.skillOwner || plan.host)) obsolete.push(target);
  }
  return obsolete;
}

export async function checkSkillOwner(target, home, host, layout) {
  const scope = await readJSON(path.join(target, layout === 'flat' ? 'openmotion-install.json' : 'scope.json'));
  const existing = await readdir(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  assert(!existing || (scope?.managedBy === owner && scope.installHome === home && (!scope.host || scope.host === host)), 'Existing openmotion Skills are not owned by this installation: ' + target);
  return existing !== null;
}

export async function copyHostSkills(stage, target, appRoot, plan, home, version, dataDirectory) {
  const scope = { managedBy: owner, installHome: home, runtimeRoot: appRoot, version, dataDirectory, host: plan.skillOwner || plan.host, ...(plan.host === 'deepseek' ? { configFile: plan.metadata.configFile } : {}) };
  if (plan.layout !== 'flat') {
    for (const name of ['skills', 'docs', 'README.md', 'AGENTS.md', 'CLAUDE.md']) await cp(path.join(appRoot, name), path.join(stage, name), { recursive: true });
    await writeJSON(path.join(stage, 'scope.json'), scope);
    if (plan.writeBundle) await plan.writeBundle(stage, appRoot, version);
    return;
  }
  const source = path.join(appRoot, 'skills', path.basename(target));
  await cp(source, stage, { recursive: true });
  await writeJSON(path.join(stage, 'openmotion-install.json'), scope);
  async function rewrite(directory, original) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name), originalFile = path.join(original, entry.name);
      if (entry.isDirectory()) await rewrite(filename, originalFile);
      else if (entry.name.endsWith('.md')) {
        const content = await readFile(filename, 'utf8');
        const updated = content.replace(/\]\((\.\.[^)#]+)(#[^)]*)?\)/g, (match, relative, hash = '') => {
          const resolved = path.resolve(path.dirname(originalFile), relative);
          return resolved.startsWith(path.join(appRoot, 'docs') + path.sep) ? '](<' + resolved + hash + '>)' : match;
        });
        if (updated !== content) await writeFile(filename, updated);
      }
    }
  }
  await rewrite(stage, source);
}
