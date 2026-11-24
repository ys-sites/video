import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runFile, writeJSON } from '../../scripts/runtime-assets.mjs';
import { verifyRegistryDownload } from './motion-registry.mjs';
import { releaseTemplateEnvironment } from '../../scripts/release-version.mjs';
import { verifyDownloaded } from './motion-release.mjs';
import { checkTemplateRuntime } from './template-runtime-check.mjs';

export function consumerEnvironment(work, source = process.env) {
  // Consumer code receives OS basics only, never CI credentials or Agent/browser IPC capabilities.
  const allowed = /^(?:PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TMPDIR|TMP|TEMP|SystemRoot|windir|ComSpec|PATHEXT|ProgramFiles(?:\(x86\))?|ProgramData|LANG|LC_ALL|TZ)$/i;
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key)));
  return { ...env, CODEX_HOME: path.join(work, 'codex'), npm_config_cache: path.join(work, 'npm-cache'),
    npm_config_userconfig: path.join(work, 'user.npmrc'), npm_config_globalconfig: path.join(work, 'global.npmrc'),
    npm_config_registry: 'https://registry.npmjs.org/', npm_config_ignore_scripts: 'true',
    npm_config_fetch_retries: '3', npm_config_fetch_retry_mintimeout: '10000', npm_config_fetch_retry_maxtimeout: '30000',
    OPENMOTION_TELEMETRY: '0', HYPERFRAMES_NO_TELEMETRY: '1' };
}

async function discover(transport, env, version, tools, templateCheck) {
  const child = spawn(transport.command, transport.args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const waiting = new Map(); let sequence = 0;
  const fail = error => { for (const p of waiting.values()) { clearTimeout(p.timer); p.reject(error); } waiting.clear(); };
  child.on('error', fail); child.on('exit', code => fail(new Error('MCP exited: ' + code)));
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', line => {
    try { const result = JSON.parse(line), p = waiting.get(result.id); if (p) { waiting.delete(result.id); clearTimeout(p.timer); result.error ? p.reject(new Error('MCP error')) : p.resolve(result.result); } }
    catch { fail(new Error('Invalid MCP JSON')); }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { waiting.delete(id); reject(new Error('MCP timed out: ' + method)); }, 120_000);
    waiting.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  let editorRuntime;
  try {
    const hello = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'motion-registry-acceptance', version: '1' } });
    assert.equal(hello.serverInfo.version, version);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    assert.deepEqual((await rpc('tools/list', {})).tools.map(t => t.name), tools);
    await rpc('resources/read', { uri: 'motion://workflow/production/start' });
    await rpc('resources/read', { uri: 'motion://engine/SKILL.md' });
    if (templateCheck) {
      const { nativeConfiguration } = await import(pathToFileURL(path.join(templateCheck.appRoot, 'scripts/npm-runtime.mjs')).href);
      const native = await nativeConfiguration(templateCheck.appRoot);
      assert(native?.paths.HYPERFRAMES_BROWSER_PATH, 'Installed package must supply its prepared browser');
      editorRuntime = await import(pathToFileURL(path.join(templateCheck.appRoot, 'editor-runtime.ts')).href);
      return await checkTemplateRuntime({ ...templateCheck, browserPath: native.paths.HYPERFRAMES_BROWSER_PATH,
        call: async (name, args = {}) => {
          const value = await rpc('tools/call', { name, arguments: args });
          assert(!value.isError, 'Template tool failed: ' + name);
          return value.structuredContent;
        },
      });
    }
    return { status: 'not-run-legacy-cms' };
  } finally {
    child.stdin.end(); child.kill(); fail(new Error('MCP session closed'));
    if (editorRuntime?.sharedEditorEnabled) {
      const editor = await editorRuntime.readEditor(templateCheck.dataDirectory);
      if (editor) await editorRuntime.editorRequest(editor, '/editor-api/shutdown', {});
    }
  }
}

export async function registrySmoke(directory, { fromCandidate = false } = {}) {
  const c = await verifyDownloaded(directory, process.env.MOTION_EXPECTED_SHA256, process.env.MOTION_VERSION);
  const platform = process.platform + '-' + process.arch;
  assert(['darwin-arm64', 'win32-x64'].includes(platform), 'Use a supported native runner');
  const file = path.join(directory, `registry-${platform}.json`);
  let phase = fromCandidate ? 'candidate-verified' : 'registry-download';
  const checkpoint = async next => { phase = next; console.log('Installation phase: ' + phase); await writeJSON(file, { status: 'running', phase, version: c.version, platform, tgzSHA256: c.tgzSHA256 }); };
  await checkpoint(phase);
  try {
  const work = await mkdtemp(path.join(os.tmpdir(), 'om-registry-')), env = consumerEnvironment(work);
  for (const name of ['user.npmrc', 'global.npmrc']) await writeFile(path.join(work, name), '');
  const project = path.join(work, 'project'), host = path.join(work, 'host');
  await mkdir(project); await mkdir(env.CODEX_HOME);
  await writeFile(path.join(env.CODEX_HOME, 'config.toml'), '[mcp_servers.unrelated]\ncommand = "keep-this-server"\n');
  const npm = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
  const cli = args => runFile(process.execPath, [npm, ...args], { cwd: project, env, timeout: 20 * 60_000 });
  if (!fromCandidate) console.log('Fetching the exact version anonymously from the public registry');
  const tgz = fromCandidate ? path.join(directory, c.tgz) : (await verifyRegistryDownload(directory, { destination: work })).tgz;
  await checkpoint('host-install');
  console.log('Installing the pinned test host in an isolated prefix');
  await cli(['install', '--prefix', host, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', '@openai/codex@0.166.0']);
  const codex = path.join(host, 'node_modules/@openai/codex/bin/codex.js');
  const home = path.join(work, 'app'), data = path.join(work, 'data'), skills = path.join(project, '.agents/skills');
  const command = ['exec', '--yes', '--package', tgz, '--', 'openmotion'];
  const setup = [...command, 'setup', '--host', 'codex', '--home', home, '--data-dir', data, '--skills-dir', skills, '--codex', codex];
  console.log('Running fresh and repeated setup with isolated data, Skills and host settings');
  await checkpoint('setup');
  const first = JSON.parse(await cli(setup)), second = JSON.parse(await cli(setup));
  assert.equal(first.appRoot, second.appRoot); assert.equal((await readdir(path.join(home, 'apps'))).length, 1);
  assert.match(await readFile(path.join(env.CODEX_HOME, 'config.toml'), 'utf8'), /keep-this-server/);
  const manifest = JSON.parse(await readFile(path.join(directory, 'release-npm.json')));
  assert.equal(manifest.templateEnvironment, releaseTemplateEnvironment(c.version));
  const state = JSON.parse(await readFile(path.join(home, 'install.json')));
  assert.equal(state.templateEnvironment, manifest.templateEnvironment);
  const templateConfig = JSON.parse(await readFile(path.join(first.appRoot, 'shared/template-config.json')));
  assert.equal(templateConfig.environment, manifest.templateEnvironment);
  for (const skill of manifest.skills) await access(path.join(state.skillsDirectory, 'skills', skill, 'SKILL.md'));
  console.log('Preparing the checksum-pinned browser, FFmpeg and ffprobe');
  await checkpoint('native-prepare');
  await cli([...command, 'prepare', '--home', home]);
  const installed = JSON.parse(await runFile(process.execPath, [codex, 'mcp', 'get', 'openmotion', '--json'], { cwd: project, env }));
  assert.equal(installed.transport.command, process.execPath); assert.deepEqual(installed.transport.args, [first.launcher]);
  console.log('Checking the actual registered MCP transport and resources');
  const templateCheck = templateConfig.source === 'hosted'
    ? { appRoot: first.appRoot, dataDirectory: data, output: path.join(directory, `template-runtime-${platform}`) } : null;
  const consumerInput = path.join(work, 'runtime-check.json'), consumerReport = path.join(work, 'runtime-result.json');
  await writeJSON(consumerInput, { transport: installed.transport, version: c.version, tools: manifest.mcp.tools, templateCheck, report: consumerReport });
  await checkpoint(templateCheck ? 'template-runtime' : 'mcp-discovery');
  // Installed code and its browser dependencies execute only with consumer credentials.
  await runFile(process.execPath, [fileURLToPath(import.meta.url), 'consumer', consumerInput], { cwd: project, env, timeout: 10 * 60_000 });
  const templateRuntime = JSON.parse(await readFile(consumerReport, 'utf8'));
  const report = { status: 'passed', platform, version: c.version, sourceCommit: c.sourceCommit, tgzSHA256: c.tgzSHA256,
    node: process.version, codex: '0.166.0', templateEnvironment: templateConfig.environment,
    ...(fromCandidate ? { candidateColdInstall: 'passed', registryColdInstall: 'not-run' } : { registryColdInstall: 'passed' }),
    repeatSetup: 'passed', unrelatedSettings: 'preserved',
    nativePreparation: 'passed', mcpTools: manifest.mcp.tools.length, skills: manifest.skills.length, resources: 'passed', templateRuntime,
    realModelTurn: 'not-run', humanPlayback: 'not-run', windowsDesktopAcceptance: 'not-run' };
  await writeJSON(file, report); return report;
  } catch (error) {
    await writeJSON(file, { status: 'failed', phase, platform, version: c.version, tgzSHA256: c.tgzSHA256, error: 'REGISTRY_ACCEPTANCE_FAILED' });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'consumer') {
    const input = JSON.parse(await readFile(process.argv[3], 'utf8'));
    await writeJSON(input.report, await discover(input.transport, process.env, input.version, input.tools, input.templateCheck));
  } else await registrySmoke(path.resolve(process.argv[2]), { fromCandidate: process.argv[3] === '--candidate' });
}
