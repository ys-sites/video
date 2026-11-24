import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { diagnose, localManifest, setup } from '../scripts/npm-installer.mjs';
import { hosts } from '../scripts/npm-hosts.mjs';
import { configureNativeEnvironment, ensureNativeRuntime, nativeConfiguration } from '../scripts/npm-runtime.mjs';
import { canonical, obtainAsset, relativePath, runFile, sha256, withLock, writeJSON } from '../scripts/runtime-assets.mjs';

const dummyRuntime = () => ({ targets: { fixture: { platform: process.platform, arch: process.arch,
  browser: { url: 'https://example.invalid/browser.zip', sha256: 'b'.repeat(64), executable: 'browser/chrome' },
  media: { url: 'https://example.invalid/media.tar.gz', sha256: 'c'.repeat(64), directory: 'media' },
} } });

async function fixture(t: any) {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-npm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function archive(directory: string, source: string, name: string) {
  const output = path.join(directory, name + '.tar.gz');
  await runFile('tar', ['-czf', output, '-C', source, '.']);
  return { url: pathToFileURL(output).href, sha256: await sha256(output) };
}
function clearNativeEnvironment(t: any) {
  const keys = ['HYPERFRAMES_FFMPEG_PATH', 'HYPERFRAMES_FFPROBE_PATH', 'HYPERFRAMES_BROWSER_PATH', 'MOTION_BROWSER_PATH', 'FFMPEG_PATH', 'FFPROBE_PATH'];
  const previous = keys.map(key => process.env[key]);
  for (const key of keys) delete process.env[key];
  t.after(() => keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }));
}
async function setupFixture(t: any) {
  const directory = await fixture(t), application = path.join(directory, 'source'), home = path.join(directory, 'install'), skillsDirectory = path.join(directory, 'skills');
  for (const name of ['scripts', 'shared', 'studio/build', 'skills/openmotion-production', 'docs', 'mcp-ui/template-recommendations']) await mkdir(path.join(application, name), { recursive: true });
  for (const name of ['mcp.ts', 'scripts/npm-runtime.mjs', 'studio/build/index.html', 'README.md', 'AGENTS.md', 'CLAUDE.md']) await writeFile(path.join(application, name), 'fixture');
  for (const file of ['docs/install.md', 'scripts/install-onboarding.mjs', 'scripts/inline-onboarding.mjs', 'scripts/codex-host-handoff.mjs', 'scripts/check-installed-mcp.mjs', 'shared/onboarding-templates.ts', 'scripts/runtime-assets.mjs', 'scripts/open-template-library.ts', 'shared/workspace-url.ts', 'shared/studio-catalog.ts', 'mcp-ui/template-recommendations/i18n.ts']) await cp(new URL('../' + file, import.meta.url), path.join(application, file));
  for (const file of ['shared/install-attribution.ts', 'tracking/node.ts', 'tracking/core.ts', 'tracking/host.ts', 'tracking/device.ts', 'tracking/events.ts', 'tracking/tool-fields.ts', 'tracking/studio-events.ts']) {
    await mkdir(path.join(application, path.dirname(file)), { recursive: true });
    await cp(new URL('../' + file, import.meta.url), path.join(application, file));
  }
  await writeFile(path.join(application, 'shared/tracking.ts'), 'export function trackingLocked(){return false} export function trackingPreference(){return true} export async function createAppTracking(){return {track(){}}} export async function closeTracking(){}');
  await writeFile(path.join(application, 'workspace.ts'), 'export class WorkspaceStore { constructor(directory = process.env.MOTION_DATA_DIR) { this.directory = directory; } }');
  await writeFile(path.join(application, 'preview.ts'), `export async function ensureService(store) { if (store.directory !== process.env.MOTION_DATA_DIR) throw new Error('Wrong workspace'); return { previewUrl: 'http://127.0.0.1:4173' }; }`);
  await writeFile(path.join(application, 'skills/openmotion-production/SKILL.md'), '---\nname: openmotion-production\ndescription: fixture\n---\nFixture');
  await writeJSON(path.join(application, 'shared/template-config.json'), { environment: 'prod' });
  await cp(new URL('../shared/mcp-profiles.json', import.meta.url), path.join(application, 'shared/mcp-profiles.json'));
  await writeJSON(path.join(application, 'package.json'), { name: 'motion-fixture', version: '1.2.3', private: true });
  await writeJSON(path.join(application, 'package-lock.json'), { name: 'motion-fixture', version: '1.2.3', lockfileVersion: 3, packages: { '': { name: 'motion-fixture', version: '1.2.3' } } });
  const manifest = path.join(directory, 'release.json');
  await writeJSON(manifest, { schemaVersion: 1, version: '1.2.3', application: await archive(directory, application, 'application'), runtime: dummyRuntime() });
  const codex = path.join(directory, 'codex'), config = path.join(directory, 'codex.json');
  await writeJSON(config, { unrelated: { transport: { command: 'keep-this' } } });
  await writeFile(codex, `#!${process.execPath}\nimport fs from 'node:fs';\nconst file=${JSON.stringify(config)};\nconst state=JSON.parse(fs.readFileSync(file,'utf8'));\nconst args=process.argv.slice(2);\nif(args[1]==='get'){if(!state.openmotion){console.error(\"No MCP server named 'openmotion' found.\");process.exit(1);}console.log(JSON.stringify(state.openmotion));}\nelse if(args[1]==='add'){if(state.fail){console.error('registration failed');process.exit(1);}state.openmotion={transport:{type:'stdio',command:args[4],args:args.slice(5)}};fs.writeFileSync(file,JSON.stringify(state));}\n`, { mode: 0o755 });
  await chmod(codex, 0o755);
  return { directory, application, home, skillsDirectory, manifest, codex, config };
}

test('setup retains the welcome/card contract and project-free library without claiming chat activation', async t => {
  const options = await setupFixture(t);
  const installed = await setup(options);
  assert.equal(installed.onboarding.hostSessionVerified, false);
  assert.match(installed.onboarding.welcomeMarkdown, /open-source video creation partner/);
  assert.doesNotMatch(installed.onboarding.welcomeMarkdown, /👇|👆|three|cards/);
  assert.equal(installed.onboarding.welcomeMarkdown.split('\n\n').length, 3);
  assert.doesNotMatch(installed.onboarding.welcomeMarkdown, /https?:|\]\(|HOST_|MCP|receipt/);
  assert.deepEqual(installed.onboarding.directAccess.toolsArgs, [path.join(installed.appRoot, 'scripts/npm-installer.mjs'), 'tools', '--home', installed.launcher.replace(/[/\\]run-mcp.mjs$/, ''), '--host', 'codex', '--codex', options.codex]);
  const examples = [...installed.onboarding.instructions.matchAll(/```text\n([\s\S]*?)```/g)].map(([, text]) => text);
  assert.equal(examples.length, 2);
  const [cards, fallback] = examples;
  assert.equal(fallback.trim().split('\n\n').length, 3);
  assert.doesNotMatch(fallback, /👇|👆|这 3 个|https?:/);
  for (const raw of examples) {
    const example = raw.replaceAll('**', '');
    assert(example.startsWith('🎉 OpenMotion 安装好啦，右侧就是模板库！\n\n'));
    assert.doesNotMatch(example, /MCP|Skills?|prod|DEV|刷新|连接|新聊天|后台|开源免费/);
    assert.match(example, /我是你的开源视频创作搭档/);
    assert.doesNotMatch(example, /Motion.md|回复 1、2 或 3/);
    assert.doesNotMatch(example, /打开并编辑|要用这个模板/);
  }
  assert.doesNotMatch(cards, /1\. \*\*产品宣传片|2\. \*\*动态图表|3\. \*\*决策树动画/);
  assert.match(installed.onboarding.instructions, /onboarding:true/);
  assert.match(installed.onboarding.instructions, /welcome above the three cards/);
  assert.match(cards, /不想自己找？先看看我挑的这 3 个/);
  assert.match(cards, /👇/);
  assert.equal(JSON.parse(await readFile(installed.onboarding.detailsFile, 'utf8')).onboardingComplete, false);
  assert(Array.isArray(installed.onboarding.catalog.templates));
  assert.equal(installed.onboarding.preview.status, 'ready', installed.onboarding.preview.warning);
  assert.equal(installed.onboarding.preview.projectCreated, false);
  assert.equal(new URL(installed.onboarding.preview.previewUrl).searchParams.get('templates'), '1');
  assert.equal(installed.onboarding.preview.previewHandoff.nextAction.kind, 'host');
  assert.equal('onboarding' in JSON.parse(await readFile(path.join(options.home, 'install.json'), 'utf8')), false);
});

test('legacy setup returns prepared onboarding to the installing Agent without sending another user message', async t => {
  const options = await setupFixture(t);
  await writeFile(path.join(options.application, 'scripts/inline-onboarding.mjs'), `import fs from 'node:fs/promises'; import path from 'node:path'; import {createHash} from 'node:crypto';
export function onboardingPresentationInstructions() { return 'Fixture presentation'; }
export async function prepareInlineOnboarding({output}) { await fs.mkdir(path.dirname(output), {recursive:true}); await fs.writeFile(output, 'verified cards'); return {status:'prepared',path:output,sha256:createHash('sha256').update('verified cards').digest('hex')}; }`);
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  manifest.application = await archive(options.directory, options.application, 'prepared-onboarding');
  await writeJSON(options.manifest, manifest);
  const queueLog = path.join(options.directory, 'queue.log');
  const cli = await readFile(options.codex, 'utf8');
  await writeFile(options.codex, cli + `\nif(args[0]==='queue') {fs.writeFileSync(${JSON.stringify(queueLog)},JSON.stringify(args));console.log('Queued message 11111111-1111-4111-8111-111111111111 for thread '+args[2]+'.');}\n`);
  const installed = await setup(options);
  assert.equal(installed.onboarding.onboardingStatus, 'awaiting_host_delivery');
  assert.equal(installed.onboarding.hostHandoff.automaticActivation, 'blocked');
  assert.equal(installed.onboarding.callback, undefined);
  assert.equal(installed.onboarding.inlinePresentation.status, 'prepared');
  assert.equal(installed.onboarding.preview.status, 'ready');
  assert.equal(installed.onboarding.preview.projectCreated, false);
  assert.equal(installed.onboarding.onboardingComplete, false);
  await assert.rejects(readFile(queueLog), { code: 'ENOENT' });
  assert.equal(await readFile(installed.onboarding.inlinePresentation.path, 'utf8'), 'verified cards');
  assert.equal(JSON.parse(await readFile(options.config, 'utf8')).unrelated.transport.command, 'keep-this');
});

for (const host of ['workbuddy', 'claude', 'codex', 'deepseek']) {
  test(`${host} upgrades remove retired Skills while preserving projects and unrelated entries`, async t => {
    const options = await setupFixture(t);
    const configKey = host === 'claude' ? 'CLAUDE_CONFIG_DIR' : host === 'deepseek' ? 'DSH_HOME' : 'WORKBUDDY_CONFIG_DIR';
    const before = process.env[configKey];
    process.env[configKey] = path.join(options.directory, host);
    t.after(() => { if (before === undefined) delete process.env[configKey]; else process.env[configKey] = before; });
    const extra: any = {};
    if (host === 'claude' || host === 'deepseek') {
      const cli = path.join(options.directory, host + '-cli');
      const action = host === 'claude'
        ? `const f=path.join(process.env.CLAUDE_CONFIG_DIR,'.claude.json');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify({mcpServers:{openmotion:JSON.parse(a[5])}}));`
        : `const p=path.join(process.env.DSH_HOME,'profiles/web');fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'package.json'),JSON.stringify({dependencies:{'dsh-plugin-openmotion-local':'file:'+a[4]}}));`;
      await writeFile(cli, `#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';const a=process.argv.slice(2);${action}\n`, { mode: 0o755 });
      extra[host === 'claude' ? 'claude' : 'dsh'] = cli;
    }
    const installed = await setup({ ...options, ...extra, host });
    const flat = host === 'claude' || host === 'workbuddy';
    const root = flat ? options.skillsDirectory : path.join(host === 'codex' ? path.join(options.skillsDirectory, 'openmotion-workflows') : installed.hostInstallation.bundleDirectory, 'skills');
    const retired = ['motion-director', 'motion-production', 'motion-recreate', 'motion-template-to-video', 'motion-video-to-template', 'reference-video'];
    for (const name of retired) {
      const old = path.join(root, name); await mkdir(old);
      if (flat) await cp(path.join(root, 'openmotion-production/openmotion-install.json'), path.join(old, 'openmotion-install.json'));
      await writeFile(path.join(old, 'SKILL.md'), 'Retired workflow');
    }
    const foreign = path.join(options.skillsDirectory, 'user-owned');
    await mkdir(foreign, { recursive: true }); await writeFile(path.join(foreign, 'SKILL.md'), 'User workflow');
    if (flat) {
      const other = path.join(root, 'brandkit'); await mkdir(other);
      await writeJSON(path.join(other, 'openmotion-install.json'), { managedBy: '@openmotion/installer', installHome: options.home + '-other', host });
      await writeFile(path.join(other, 'SKILL.md'), 'Another installation');
    }
    await mkdir(installed.dataDirectory, { recursive: true });
    await writeFile(path.join(installed.dataDirectory, 'keep.txt'), 'Existing project data');
    const upgraded = await setup({ ...options, ...extra, host });
    assert.equal(upgraded.dataDirectory, installed.dataDirectory);
    assert.equal(await readFile(path.join(installed.dataDirectory, 'keep.txt'), 'utf8'), 'Existing project data');
    const upgradedRoot = host === 'deepseek' ? path.join(upgraded.hostInstallation.bundleDirectory, 'skills') : root;
    for (const name of retired) await assert.rejects(readdir(path.join(upgradedRoot, name)), { code: 'ENOENT' });
    await readFile(path.join(upgradedRoot, 'openmotion-production/SKILL.md'));
    if (host === 'deepseek') {
      assert.notEqual(upgradedRoot, root);
      await readFile(path.join(root, retired[0], 'SKILL.md')); // The running host's old bundle is untouched.
    }
    assert.equal(await readFile(path.join(foreign, 'SKILL.md'), 'utf8'), 'User workflow');
    if (flat) assert.equal(await readFile(path.join(root, 'brandkit/SKILL.md'), 'utf8'), 'Another installation');
  });
}

test('bundled CLI installs without a sidecar manifest, isolates DEV defaults and rejects a mixed-environment home', async t => {
  const options = await setupFixture(t), bundle = path.join(options.directory, 'bundle');
  await mkdir(path.join(bundle, 'scripts'), { recursive: true }); await mkdir(path.join(bundle, 'payload'));
  for (const file of ['npm-installer.mjs', 'npm-hosts.mjs', 'install-public-skill.ts', 'npm-runtime.mjs', 'runtime-assets.mjs', 'check-installed-mcp.mjs', 'mcp-client.mjs', 'diagnostics.mjs', 'diagnostic-redaction.mjs', 'zip.mjs']) {
    await cp(new URL('../scripts/' + file, import.meta.url), path.join(bundle, 'scripts', file));
  }
  await writeJSON(path.join(bundle, 'package.json'), { version: '1.2.3', type: 'module' });
  const metadata = JSON.parse(await readFile(options.manifest, 'utf8'));
  metadata.templateEnvironment = 'dev';
  await writeJSON(path.join(options.application, 'shared/template-config.json'), { environment: 'dev' });
  metadata.application = await archive(options.directory, options.application, 'dev-application');
  await cp(new URL(metadata.application.url), path.join(bundle, 'payload/application.tar.gz'));
  metadata.application.url = './application.tar.gz';
  await writeJSON(path.join(bundle, 'payload/release-npm.json'), metadata);
  const env = { ...process.env, HOME: options.directory, USERPROFILE: options.directory, LOCALAPPDATA: options.directory,
    WORKBUDDY_CONFIG_DIR: path.join(options.directory, 'buddy'), npm_config_cache: path.join(options.directory, 'npm-cache') };
  const cli = path.join(bundle, 'scripts/npm-installer.mjs');
  const command = [cli, 'setup', '--host', 'workbuddy', '--skills-dir', options.skillsDirectory];
  const first = JSON.parse(await runFile(process.execPath, command, { env }));
  assert.equal(path.basename(path.dirname(first.launcher)), 'openmotion-dev');
  assert.equal(first.templateEnvironment, 'dev');
  assert.equal((await runFile(process.execPath, command, { env })).includes(first.appRoot), true);
  const stateBefore = await readFile(path.join(path.dirname(first.launcher), 'install.json'), 'utf8');
  metadata.templateEnvironment = 'prod';
  await writeJSON(path.join(bundle, 'payload/release-npm.json'), metadata);
  await assert.rejects(runFile(process.execPath, [...command, '--home', path.dirname(first.launcher)], { env }), /another template environment/);
  assert.equal(await readFile(path.join(path.dirname(first.launcher), 'install.json'), 'utf8'), stateBefore);
  await assert.rejects(runFile(process.execPath, [cli, 'setup', '--host', 'workbuddy', '--home', path.join(options.directory, 'other-app'), '--skills-dir', path.join(options.directory, 'other-skills')], {
    env: { ...env, WORKBUDDY_CONFIG_DIR: path.join(options.directory, 'other-buddy') },
  }), /template environment does not match manifest/);
  await writeJSON(path.join(bundle, 'package.json'), { version: '9.9.9', type: 'module' });
  await assert.rejects(runFile(process.execPath, command, { env }), /match the npm package version/);
});

test('a library startup failure reports the limitation without undoing successful host registration', async t => {
  const options = await setupFixture(t);
  await writeFile(path.join(options.application, 'scripts/open-template-library.ts'), 'throw new Error("Preview unavailable");');
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  manifest.application = await archive(options.directory, options.application, 'failed-preview');
  await writeJSON(options.manifest, manifest);
  const installed = await setup(options);
  assert.equal(installed.onboarding.preview.status, 'unavailable');
  assert.equal(installed.onboarding.preview.projectCreated, false);
  assert.match(installed.onboarding.preview.warning, /Preview unavailable/);
  assert.equal(JSON.parse(await readFile(path.join(options.home, 'install.json'), 'utf8')).appRoot, installed.appRoot);
  assert.ok(JSON.parse(await readFile(options.config, 'utf8')).openmotion);
});

test('local assets require pinned checksums and preserve earlier cache after corruption', async t => {
  const dir = await fixture(t), source = path.join(dir, 'source'), destination = path.join(dir, 'cached');
  await writeFile(source, 'corrupted'); await writeFile(destination, 'keep');
  const asset = { url: pathToFileURL(source).href, sha256: 'a'.repeat(64) };
  await assert.rejects(obtainAsset(asset, destination), /explicitly supplied/);
  await assert.rejects(obtainAsset(asset, destination, true), /SHA256 mismatch/);
  assert.equal(await readFile(destination, 'utf8'), 'keep');
  assert.deepEqual((await readdir(dir)).sort(), ['cached', 'source']);
});

test('release manifests reject unpinned or unsafe URLs and paths', async t => {
  const dir = await fixture(t), filename = path.join(dir, 'release.json');
  const value = { schemaVersion: 1, version: '1.2.3', application: { url: 'http://example.invalid/a.tar.gz', sha256: 'a'.repeat(64) }, runtime: dummyRuntime() };
  await writeJSON(filename, value); await assert.rejects(localManifest(filename), /HTTPS/);
  value.application.url = 'https://user:password@example.invalid/a.tar.gz';
  await writeJSON(filename, value); await assert.rejects(localManifest(filename), /credentials/);
  value.application.url = './application.tar.gz'; value.application.sha256 = '';
  await writeJSON(filename, value); await assert.rejects(localManifest(filename), /SHA256/);
  for (const input of ['../escape', '/absolute', 'C:/Windows/test', 'path\\escape', 'x\n../escape']) assert.throws(() => relativePath(dir, input), /Unsafe/);
});

test('installation locks reject simultaneous mutation and release after an error', async t => {
  const dir = await fixture(t), filename = path.join(dir, 'install.lock');
  await withLock(filename, async () => {
    await assert.rejects(withLock(filename, async () => {}), /Another OpenMotion install/);
  });
  await assert.rejects(withLock(filename, async () => { throw new Error('failed operation'); }), /failed operation/);
  await withLock(filename, async () => {});
});

test('native preparation runs independent components together for separate and combined media archives', { skip: process.platform === 'win32', timeout: 20_000 }, async t => {
  for (const combined of [false, true]) await t.test(combined ? 'combined media' : 'separate media', async t => {
    clearNativeEnvironment(t);
    const dir = await fixture(t), root = path.join(dir, 'app'); await mkdir(root);
    const components = combined ? ['browser', 'media'] : ['browser', 'ffmpeg', 'ffprobe'];
    const assets: Record<string, any> = {};
    const downloads = new Map<string, Buffer>(), started: string[] = [];
    for (const component of components) {
      const source = path.join(dir, component); await mkdir(source);
      if (component === 'media') await mkdir(path.join(source, 'bin'));
      for (const tool of component === 'media' ? ['ffmpeg', 'ffprobe'] : [component]) {
        await writeFile(path.join(source, component === 'media' ? 'bin' : '', tool), '#!/bin/sh\necho fixture-version\n', { mode: 0o755 });
      }
      assets[component] = { ...await archive(dir, source, component), ...(component === 'media' ? { directory: '.' } : { executable: component }) };
      const bytes = await readFile(new URL(assets[component].url));
      assets[component].url = `https://example.invalid/${component}.tar.gz`;
      downloads.set(assets[component].url, bytes);
    }
    const gate = Promise.withResolvers<void>();
    const timeout = setTimeout(() => gate.reject(new Error('Independent downloads did not start together')), 5000);
    t.after(() => clearTimeout(timeout));
    t.mock.method(globalThis, 'fetch', async (url: URL) => {
      started.push(url.href);
      if (started.length === components.length) gate.resolve();
      await gate.promise;
      return new Response(downloads.get(url.href));
    });
    await writeJSON(path.join(root, '.npm-install.json'), { schemaVersion: 1, cacheDirectory: path.join(dir, 'cache'), allowLocalAssets: true,
      runtime: { targets: { fixture: { platform: process.platform, arch: process.arch, ...assets } } } });
    await ensureNativeRuntime(root);
    assert.deepEqual(started.sort(), [...downloads.keys()].sort());
    const native = await nativeConfiguration(root);
    assert.deepEqual((await readdir(native.cache)).filter(name => !name.endsWith('.status.json')).sort(), Object.entries(assets).map(([name, asset]: any) => name + '-' + asset.sha256).sort());
  });
});

test('separate ffmpeg and ffprobe archives validate independently and recover without replacing a ready tool', { skip: process.platform === 'win32' }, async t => {
  clearNativeEnvironment(t);
  const dir = await fixture(t), assets: Record<string, any> = {};
  for (const tool of ['browser', 'ffmpeg', 'ffprobe']) {
    const source = path.join(dir, tool); await mkdir(source);
    await writeFile(path.join(source, tool), '#!/bin/sh\necho fixture-version\n', { mode: 0o755 });
    assets[tool] = { ...await archive(dir, source, tool), executable: tool };
  }
  const probeArchive = path.join(dir, 'ffprobe.tar.gz'), original = await readFile(probeArchive);
  await writeFile(probeArchive, 'corrupted ffprobe');
  const root = path.join(dir, 'app'), cacheDirectory = path.join(dir, 'cache'); await mkdir(root);
  await writeJSON(path.join(root, '.npm-install.json'), { schemaVersion: 1, cacheDirectory, allowLocalAssets: true,
    runtime: { targets: { fixture: { platform: process.platform, arch: process.arch, ...assets } } } });
  await assert.rejects(ensureNativeRuntime(root), /SHA256 mismatch/);
  const native = await nativeConfiguration(root), ready = path.join(native.cache, 'ffmpeg-' + assets.ffmpeg.sha256, 'ready.json');
  const before = await readFile(ready, 'utf8');
  await assert.rejects(readFile(path.join(native.cache, 'ffprobe-' + assets.ffprobe.sha256, 'ready.json')), { code: 'ENOENT' });
  await writeFile(probeArchive, original);
  await ensureNativeRuntime(root); await ensureNativeRuntime(root);
  assert.equal(await readFile(ready, 'utf8'), before);
  for (const filename of Object.values(native.paths)) assert.match(await runFile(filename as string, ['-version']), /fixture-version/);
  const manifest = path.join(dir, 'release.json'), value = { schemaVersion: 1, version: '1.2.3', application: assets.ffmpeg,
    runtime: { targets: { fixture: { platform: process.platform, arch: process.arch, ...assets } } } };
  await writeJSON(manifest, value); await localManifest(manifest);
  value.runtime.targets.fixture.ffprobe.sha256 = '';
  await writeJSON(manifest, value); await assert.rejects(localManifest(manifest), /SHA256/);
});

test('CLI help and version cover every host without reading a manifest or changing an installation', async t => {
  const directory = await fixture(t), cli = fileURLToPath(new URL('../scripts/npm-installer.mjs', import.meta.url));
  const missing = path.join(directory, 'missing.json'), home = path.join(directory, 'app');
  for (const command of [['--help'], ['setup', '-h'], ['prepare', '--help'], ['diagnose', '--help']]) {
    const help = await runFile(process.execPath, [cli, ...command, '--manifest', missing, '--home', home]);
    for (const host of hosts) assert(help.includes(host), host);
    for (const option of ['--profile', '--skills-dir', '--codex', '--claude', '--dsh']) assert(help.includes(option), option);
  }
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal((await runFile(process.execPath, [cli, '--version', '--manifest', missing, '--home', home])).trim(), pkg.version);
  await assert.rejects(runFile(process.execPath, [cli, 'setup', '--unknown-option']), /openmotion --help/);
  assert.deepEqual(await readdir(directory), []);
});

test('npm bin symlink executes the CLI instead of silently exiting', { skip: process.platform === 'win32' }, async t => {
  const directory = await fixture(t), link = path.join(directory, 'openmotion');
  await symlink(fileURLToPath(new URL('../scripts/npm-installer.mjs', import.meta.url)), link);
  await assert.rejects(runFile(process.execPath, [link, 'prepare', '--home', directory]), /Run setup first/);
});

test('diagnose verifies each installed host without changing its configuration or projects', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t), installed = await setup(options);
  const expected = JSON.parse(await readFile(new URL('../shared/mcp-profiles.json', import.meta.url), 'utf8')).phase1.tools;
  await writeFile(installed.launcher, `import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){
 const q=JSON.parse(line);if(q.id===undefined)continue;
 const result=q.id===1?{serverInfo:{version:'1.2.3'}}:q.id===2?{tools:${JSON.stringify(expected)}.map(name=>({name}))}:{structuredContent:{dataDirectory:process.env.PROBE_DIRECTORY||${JSON.stringify(installed.dataDirectory)}}};
 console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
}`);
  await mkdir(installed.dataDirectory, { recursive: true });
  const project = path.join(installed.dataDirectory, 'keep.txt'); await writeFile(project, 'existing project');
  const stateFile = path.join(options.home, 'install.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const transport = { type: 'stdio', command: process.execPath, args: [installed.launcher] };
  const previous = Object.fromEntries(['CLAUDE_CONFIG_DIR', 'WORKBUDDY_CONFIG_DIR', 'DSH_HOME'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.CLAUDE_CONFIG_DIR = path.join(options.directory, 'claude');
  process.env.WORKBUDDY_CONFIG_DIR = path.join(options.directory, 'buddy');
  process.env.DSH_HOME = path.join(options.directory, 'dsh');
  const claude = path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
  const buddy = path.join(process.env.WORKBUDDY_CONFIG_DIR, 'mcp.json');
  const profile = path.join(process.env.DSH_HOME, 'profiles/custom/package.json');
  const bundle = path.join(options.home, 'hosts/deepseek');
  for (const directory of [path.dirname(claude), path.dirname(buddy), path.dirname(profile), bundle]) await mkdir(directory, { recursive: true });
  await writeJSON(claude, { mcpServers: { openmotion: transport } });
  await writeJSON(buddy, { mcpServers: { openmotion: transport } });
  await writeJSON(profile, { dependencies: { 'dsh-plugin-openmotion-local': 'file:' + bundle } });
  const patch = path.join(bundle, 'cordis.patch.yml');
  await writeJSON(patch, [{ insert: [{ id: 'mcp-openmotion', config: { ...transport, transport: 'stdio' } }] }]);
  state.hosts.claude = { configFile: await canonical(claude), skillsDirectory: options.skillsDirectory };
  state.hosts.workbuddy = { configFile: await canonical(buddy), skillsDirectory: options.skillsDirectory };
  state.hosts.deepseek = { configFile: await canonical(profile), profile: 'custom', skillsDirectory: path.join(bundle, 'skills') };
  await writeJSON(stateFile, state);
  const files = [options.config, claude, buddy, profile, patch, stateFile, project, installed.launcher];
  const before = await Promise.all(files.map(file => readFile(file, 'utf8')));
  for (const host of hosts) {
    const result = await diagnose({ home: options.home, host, codex: options.codex });
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.equal(result.hostSessionVerified, false, 'an independent process cannot confirm the active chat');
    assert.equal(result.dataDirectory, installed.dataDirectory);
    assert.deepEqual(result.tools, expected);
    assert.match(result.nextAction, /openmotion_get_project/);
  }
  assert.deepEqual(await Promise.all(files.map(file => readFile(file, 'utf8'))), before);
  const configured = JSON.parse(await readFile(options.config, 'utf8'));
  configured.openmotion.enabled = false; await writeJSON(options.config, configured);
  assert.equal((await diagnose({ home: options.home, host: 'codex', codex: options.codex })).code, 'MCP_DISABLED');
  delete configured.openmotion; await writeJSON(options.config, configured);
  const missing = await diagnose({ home: options.home, host: 'codex', codex: options.codex });
  assert.equal(missing.code, 'MCP_NOT_REGISTERED');
  assert.match(missing.nextAction, /do not create replacement/);
  const cli = fileURLToPath(new URL('../scripts/npm-installer.mjs', import.meta.url));
  await assert.rejects(runFile(process.execPath, [cli, 'diagnose', '--host', 'codex', '--codex', options.codex, '--home', options.home]), /MCP_NOT_REGISTERED/);
  assert.equal(await readFile(project, 'utf8'), 'existing project');
});

test('setup installs complete Skills and MCP without waiting for native downloads and preserves repeated-install data', { skip: process.platform === 'win32' }, async t => {
  clearNativeEnvironment(t);
  const options = await setupFixture(t);
  await mkdir(path.join(options.skillsDirectory, 'unrelated'), { recursive: true });
  await writeFile(path.join(options.skillsDirectory, 'unrelated/keep.txt'), 'keep');
  const first = await setup(options);
  assert.equal(first.nativeDependencies, 'background-preparation; status and retry available in Studio');
  const scope = JSON.parse(await readFile(path.join(options.skillsDirectory, 'openmotion-workflows/scope.json'), 'utf8'));
  assert.equal(scope.runtimeRoot, first.appRoot);
  assert.match(await readFile(path.join(options.skillsDirectory, 'openmotion-workflows/skills/openmotion-production/SKILL.md'), 'utf8'), /openmotion-production/);
  assert((await readdir(path.join(options.home, 'cache/native/fixture'))).includes('preparation.log'));
  await mkdir(first.dataDirectory, { recursive: true });
  await writeFile(path.join(first.dataDirectory, 'keep.txt'), 'user work');
  assert.equal((await setup(options)).appRoot, first.appRoot);
  assert.equal(await readFile(path.join(first.dataDirectory, 'keep.txt'), 'utf8'), 'user work');
  assert.equal(await readFile(path.join(options.skillsDirectory, 'unrelated/keep.txt'), 'utf8'), 'keep');
  assert.equal(JSON.parse(await readFile(options.config, 'utf8')).unrelated.transport.command, 'keep-this');
  await assert.rejects(setup({ ...options, dataDirectory: path.join(options.directory, 'different-data') }), /another data directory/);
});

test('setup refuses another owner MCP or Skills before downloading application', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t);
  await writeJSON(options.config, { openmotion: { transport: { command: 'someone-else' } } });
  await assert.rejects(setup(options), /not owned/);
  await assert.rejects(readdir(path.join(options.home, 'apps')), { code: 'ENOENT' });
  await writeJSON(options.config, {});
  await mkdir(path.join(options.skillsDirectory, 'openmotion-workflows'), { recursive: true });
  await writeFile(path.join(options.skillsDirectory, 'openmotion-workflows/keep.txt'), 'other owner');
  await assert.rejects(setup(options), /Skills are not owned/);
  assert.equal(await readFile(path.join(options.skillsDirectory, 'openmotion-workflows/keep.txt'), 'utf8'), 'other owner');
});

test('failed host registration rolls back Skills and install state while retaining checked application for retry', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t);
  await writeJSON(options.config, { fail: true });
  await assert.rejects(setup(options), /registration failed/);
  await assert.rejects(readFile(path.join(options.home, 'install.json')), { code: 'ENOENT' });
  await assert.rejects(readdir(path.join(options.skillsDirectory, 'openmotion-workflows')), { code: 'ENOENT' });
  await writeJSON(options.config, {});
  await setup(options);
});

test('native preparation is deferred, checks extracted programs and reuses cache without source files', { skip: process.platform === 'win32' }, async t => {
  clearNativeEnvironment(t);
  const dir = await fixture(t), source = path.join(dir, 'source'), application = path.join(dir, 'app');
  await mkdir(path.join(source, 'media/bin'), { recursive: true }); await mkdir(path.join(source, 'browser')); await mkdir(application);
  for (const file of ['media/bin/ffmpeg', 'media/bin/ffprobe', 'browser/chrome']) await writeFile(path.join(source, file), '#!/bin/sh\necho fixture-version\n', { mode: 0o755 });
  const asset = await archive(dir, source, 'native');
  await writeJSON(path.join(application, '.npm-install.json'), { schemaVersion: 1, cacheDirectory: path.join(dir, 'cache'), allowLocalAssets: true,
    runtime: { targets: { fixture: { platform: process.platform, arch: process.arch, browser: { ...asset, executable: 'browser/chrome' }, media: { ...asset, directory: 'media' } } } } });
  await configureNativeEnvironment(application);
  await assert.rejects(readdir(path.join(dir, 'cache')), { code: 'ENOENT' });
  await ensureNativeRuntime(application);
  const configuration = await nativeConfiguration(application);
  assert.match(await runFile(configuration.paths.HYPERFRAMES_FFMPEG_PATH, ['-version']), /fixture-version/);
  await rm(new URL(asset.url));
  await rm(path.join(dir, 'cache/downloads'), { recursive: true });
  await ensureNativeRuntime(application);
  assert.equal(await ensureNativeRuntime(path.join(dir, 'ordinary-plugin')), undefined);
});

test('WorkBuddy installs flat Skills and preserves other hosts and native MCP settings', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t), clientHome = path.join(options.directory, 'workbuddy');
  const previous = process.env.WORKBUDDY_CONFIG_DIR; process.env.WORKBUDDY_CONFIG_DIR = clientHome;
  t.after(() => { if (previous === undefined) delete process.env.WORKBUDDY_CONFIG_DIR; else process.env.WORKBUDDY_CONFIG_DIR = previous; });
  await mkdir(clientHome);
  await writeJSON(path.join(clientHome, 'mcp.json'), { settings: { keep: true }, mcpServers: { unrelated: { command: 'keep-me' } } });
  const codex = await setup(options);
  const buddy = await setup({ ...options, host: 'workbuddy', codex: '/missing-codex' });
  assert.equal(buddy.appRoot, codex.appRoot);
  assert.deepEqual(Object.keys(buddy.hosts).sort(), ['codex', 'workbuddy']);
  const config = JSON.parse(await readFile(path.join(clientHome, 'mcp.json'), 'utf8'));
  assert.equal(config.settings.keep, true); assert.equal(config.mcpServers.unrelated.command, 'keep-me');
  assert.equal(config.mcpServers.openmotion.args[0], buddy.launcher);
  const marker = JSON.parse(await readFile(path.join(options.skillsDirectory, 'openmotion-production/openmotion-install.json'), 'utf8'));
  assert.equal(marker.host, 'workbuddy'); assert.equal(marker.runtimeRoot, buddy.appRoot);
  assert.equal((await setup({ ...options, host: 'workbuddy' })).appRoot, buddy.appRoot);
  assert.equal((await readdir(path.join(options.home, 'apps'))).length, 1);
});

test('WorkBuddy refuses conflicting or malformed native configuration without altering it', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t), clientHome = path.join(options.directory, 'workbuddy');
  const previous = process.env.WORKBUDDY_CONFIG_DIR; process.env.WORKBUDDY_CONFIG_DIR = clientHome;
  t.after(() => { if (previous === undefined) delete process.env.WORKBUDDY_CONFIG_DIR; else process.env.WORKBUDDY_CONFIG_DIR = previous; });
  await mkdir(clientHome); const file = path.join(clientHome, 'mcp.json');
  await writeJSON(file, { mcpServers: { openmotion: { command: 'other-owner' } } });
  await assert.rejects(setup({ ...options, host: 'workbuddy' }), /not owned/);
  await assert.rejects(readdir(path.join(options.home, 'apps')), { code: 'ENOENT' });
  await writeFile(file, '{broken');
  await assert.rejects(setup({ ...options, host: 'workbuddy' }), SyntaxError);
  assert.equal(await readFile(file, 'utf8'), '{broken');
  await writeJSON(file, []);
  await assert.rejects(setup({ ...options, host: 'workbuddy' }), /Invalid WorkBuddy/);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
  for (const invalid of [false, 0, '', { mcpServers: false }]) {
    await writeJSON(file, invalid);
    await assert.rejects(setup({ ...options, host: 'workbuddy' }), /Invalid WorkBuddy/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), invalid);
  }
});

test('Claude flat Skills keep external document links and refuse an unowned skill', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t), clientHome = path.join(options.directory, 'claude');
  const previous = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = clientHome;
  t.after(() => { if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous; });
  await mkdir(clientHome);
  const claude = path.join(options.directory, 'claude-cli'), config = path.join(clientHome, '.claude.json');
  await writeJSON(config, { keep: true });
  await writeFile(claude, `#!${process.execPath}\nimport fs from 'node:fs';\nconst f=${JSON.stringify(config)},v=JSON.parse(fs.readFileSync(f,'utf8'));const a=process.argv.slice(2);v.mcpServers={...v.mcpServers,openmotion:JSON.parse(a[5])};fs.writeFileSync(f,JSON.stringify(v));\n`, { mode: 0o755 });
  await mkdir(path.join(options.application, 'skills/openmotion-production/references'));
  await writeFile(path.join(options.application, 'docs/model-gateway.md'), 'Shared gateway');
  await writeFile(path.join(options.application, 'skills/openmotion-production/references/production.md'), '[gateway](../../../docs/model-gateway.md)');
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  manifest.application = await archive(options.directory, options.application, 'with-links'); await writeJSON(options.manifest, manifest);
  const installed = await setup({ ...options, host: 'claude', claude });
  assert.equal(JSON.parse(await readFile(config, 'utf8')).keep, true);
  assert.match(await readFile(path.join(options.skillsDirectory, 'openmotion-production/references/production.md'), 'utf8'), /\]\(<.*apps\/.*docs\/model-gateway\.md>\)/);
  assert.equal((await setup({ ...options, host: 'claude', claude })).appRoot, installed.appRoot);
  const other = path.join(options.directory, 'unowned-skills/openmotion-production'); await mkdir(other, { recursive: true }); await writeFile(path.join(other, 'SKILL.md'), 'keep');
  await assert.rejects(setup({ ...options, host: 'claude', claude, skillsDirectory: path.dirname(other) }), /not owned/);
  assert.equal(await readFile(path.join(other, 'SKILL.md'), 'utf8'), 'keep');
  for (const invalid of [false, 0, '', { mcpServers: [] }]) {
    await writeJSON(config, invalid);
    await assert.rejects(setup({ ...options, host: 'claude', claude }), /Invalid Claude/);
    assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), invalid);
  }
});

test('Harness installs a bundle with its own direct Skill root and recognizes relative pnpm links on repeat', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t), dshHome = path.join(options.directory, 'dsh');
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = dshHome;
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; });
  const dsh = path.join(options.directory, 'dsh-cli'), profile = path.join(dshHome, 'profiles/web');
  await writeFile(dsh, `#!${process.execPath}\nimport fs from 'node:fs';import path from 'node:path';\nconst a=process.argv.slice(2),p=path.join(process.env.DSH_HOME,'profiles/web');fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'package.json'),JSON.stringify({dependencies:{'dsh-plugin-openmotion-local':'link:'+path.relative(p,a[4])}}));\n`, { mode: 0o755 });
  const first = await setup({ ...options, host: 'deepseek', dsh });
  const bundle = first.hostInstallation.bundleDirectory;
  const patch = JSON.parse(await readFile(path.join(bundle, 'cordis.patch.yml'), 'utf8'))[0].insert;
  assert.equal(patch[0].config.args[0], first.launcher);
  assert.deepEqual(patch[1].config.customSkillDirs, [path.join(bundle, 'skills')]);
  await readFile(path.join(bundle, 'skills/openmotion-production/SKILL.md'));
  assert.equal((await setup({ ...options, host: 'deepseek', dsh })).appRoot, first.appRoot);
  await assert.rejects(setup({ ...options, host: 'deepseek', dsh, profile: '../bad' }), /simple/);
  await writeJSON(path.join(profile, 'package.json'), false);
  await assert.rejects(setup({ ...options, host: 'deepseek', dsh }), /Invalid Harness package/);
});

test('a failed new host registration restores the shared install and earlier host Skills', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t), clientHome = path.join(options.directory, 'claude');
  const previous = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = clientHome;
  t.after(() => { if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous; });
  await mkdir(clientHome);
  const codex = await setup(options), before = await readFile(path.join(options.home, 'install.json'), 'utf8');
  await assert.rejects(setup({ ...options, host: 'claude', claude: '/missing-claude' }));
  assert.equal(await readFile(path.join(options.home, 'install.json'), 'utf8'), before);
  await readFile(path.join(options.skillsDirectory, 'openmotion-workflows/skills/openmotion-production/SKILL.md'));
  await assert.rejects(readdir(path.join(options.skillsDirectory, 'openmotion-production')), { code: 'ENOENT' });
  assert.equal(JSON.parse(before).appRoot, codex.appRoot);
});

test('user projects cannot be placed inside managed host bundles', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t);
  await assert.rejects(setup({ ...options, host: 'deepseek', dataDirectory: path.join(options.home, 'hosts/deepseek/skills') }), /separate/);
  await assert.rejects(readdir(path.join(options.home, 'hosts')), { code: 'ENOENT' });
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = path.join(options.home, 'hosts/deepseek');
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; });
  await assert.rejects(setup({ ...options, host: 'deepseek' }), /Keep host configuration outside managed/);
  await assert.rejects(readdir(path.join(options.home, 'apps')), { code: 'ENOENT' });
});

test('Codex registration can use its pinned JavaScript CLI on platforms without executable shell shims', async t => {
  const options = await setupFixture(t), codex = path.join(options.directory, 'codex.mjs');
  await writeFile(codex, await readFile(options.codex));
  const installed = await setup({ ...options, codex });
  assert.equal(JSON.parse(await readFile(options.config, 'utf8')).openmotion.transport.args[0], installed.launcher);
});

test('flat Skill upgrades remove only this host installation\'s obsolete entries', async t => {
  const options = await setupFixture(t), clientHome = path.join(options.directory, 'workbuddy');
  const previous = process.env.WORKBUDDY_CONFIG_DIR; process.env.WORKBUDDY_CONFIG_DIR = clientHome;
  t.after(() => { if (previous === undefined) delete process.env.WORKBUDDY_CONFIG_DIR; else process.env.WORKBUDDY_CONFIG_DIR = previous; });
  const first = await setup({ ...options, host: 'workbuddy' });
  for (const name of ['obsolete-entry', '.openmotion-backup', 'other-host']) {
    await mkdir(path.join(options.skillsDirectory, name));
    const marker = JSON.parse(await readFile(path.join(options.skillsDirectory, 'openmotion-production/openmotion-install.json'), 'utf8'));
    if (name === 'other-host') marker.host = 'claude';
    await writeJSON(path.join(options.skillsDirectory, name, 'openmotion-install.json'), marker);
  }
  await setup({ ...options, host: 'workbuddy' });
  await assert.rejects(readdir(path.join(options.skillsDirectory, 'obsolete-entry')), { code: 'ENOENT' });
  for (const name of ['.openmotion-backup', 'other-host', 'openmotion-production']) await readdir(path.join(options.skillsDirectory, name));
  assert.equal(JSON.parse(await readFile(path.join(options.home, 'install.json'), 'utf8')).appRoot, first.appRoot);
});

test('registration failure restores obsolete flat Skills, and malformed install state is never overwritten', async t => {
  const options = await setupFixture(t), clientHome = path.join(options.directory, 'claude');
  const previous = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = clientHome;
  t.after(() => { if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous; });
  await setup(options);
  const obsolete = path.join(options.skillsDirectory, 'motion-production'); await mkdir(obsolete);
  await writeJSON(path.join(obsolete, 'openmotion-install.json'), { managedBy: '@openmotion/installer', installHome: await (await import('../scripts/runtime-assets.mjs')).canonical(options.home), host: 'claude' });
  await assert.rejects(setup({ ...options, host: 'claude', claude: '/missing-claude' }));
  await readFile(path.join(obsolete, 'openmotion-install.json'));
  const state = path.join(options.home, 'install.json'); await writeJSON(state, false);
  await assert.rejects(setup(options), /belongs to another/);
  assert.equal(JSON.parse(await readFile(state, 'utf8')), false);
});


test('installed CLI uses the selected host transport and keeps failed tool results nonzero', async t => {
  const options = await setupFixture(t), installed = await setup(options);
  const tools = (JSON.parse(await readFile(path.join(installed.appRoot, 'shared/mcp-profiles.json'), 'utf8'))).phase1.tools;
  await writeFile(installed.launcher, `import { createInterface } from 'node:readline';
    for await (const line of createInterface({ input: process.stdin })) {
      const q=JSON.parse(line); if(q.id===undefined) continue;
      const result=q.method==='initialize'?{serverInfo:{version:'1.2.3'}}:q.method==='tools/list'?{tools:${JSON.stringify(tools.map(name => ({name,inputSchema:{type:'object'}})))}}:q.params.name==='openmotion_get_project'?{structuredContent:{dataDirectory:${JSON.stringify(installed.dataDirectory)}}}:{isError:true,structuredContent:{error:{code:'VERSION_CONFLICT',applied:false}}};
      console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
    }`);
  const cli = fileURLToPath(new URL('../scripts/npm-installer.mjs', import.meta.url));
  const flags = ['--home', options.home, '--host', 'codex', '--codex', options.codex];
  const listed = JSON.parse(await runFile(process.execPath, [cli, 'tools', ...flags]));
  assert.equal(listed.dataDirectory, installed.dataDirectory);
  assert.equal(listed.tools.length, tools.length);
  const argsFile=path.join(options.directory, 'arguments 中文.json'); await writeJSON(argsFile, {requestId:'stable-request'});
  await assert.rejects(runFile(process.execPath, [cli, 'call', 'openmotion_edit_project', '--args-file', argsFile, ...flags]), /VERSION_CONFLICT/);
  await writeFile(argsFile, '[]');
  await assert.rejects(runFile(process.execPath, [cli, 'call', 'openmotion_edit_project', '--args-file', argsFile, ...flags]), /JSON object/);
  const config=JSON.parse(await readFile(options.config,'utf8')); config.openmotion.enabled=false; await writeJSON(options.config,config);
  await assert.rejects(runFile(process.execPath, [cli, 'tools', ...flags]), /disabled/);
});

test('failed Harness upgrade preserves the registered bundle and removes its unused replacement', async t => {
  const options = await setupFixture(t), dshHome = path.join(options.directory, 'dsh');
  const before = process.env.DSH_HOME; process.env.DSH_HOME = dshHome;
  t.after(() => { if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before; });
  const cli = path.join(options.directory, 'dsh-cli.mjs'), fail = path.join(options.directory, 'fail');
  await writeFile(cli, `import fs from 'node:fs';import path from 'node:path';
    if(fs.existsSync(${JSON.stringify(fail)})) {console.error('registration failed');process.exit(1);}
    const p=path.join(process.env.DSH_HOME,'profiles/web');fs.mkdirSync(p,{recursive:true});
    fs.writeFileSync(path.join(p,'package.json'),JSON.stringify({dependencies:{'dsh-plugin-openmotion-local':'file:'+process.argv.slice(2)[4]}}));`);
  const installed = await setup({ ...options, host: 'deepseek', dsh: cli });
  const original = await readFile(path.join(options.home, 'install.json'), 'utf8');
  const bundles = await readdir(path.join(options.home, 'hosts'));
  await writeFile(fail, 'fail');
  await assert.rejects(setup({ ...options, host: 'deepseek', dsh: cli }), /registration failed/);
  assert.equal(await readFile(path.join(options.home, 'install.json'), 'utf8'), original);
  assert.deepEqual(await readdir(path.join(options.home, 'hosts')), bundles);
  await readFile(path.join(installed.hostInstallation.bundleDirectory, 'skills/openmotion-production/SKILL.md'));
});

async function harnessRecoveryFixture(t: any) {
  const options = await setupFixture(t), dshHome = path.join(options.directory, 'dsh');
  const before = process.env.DSH_HOME; process.env.DSH_HOME = dshHome;
  t.after(() => { if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before; });
  const cli = path.join(options.directory, 'dsh-recovery.mjs'), fail = path.join(options.directory, 'failure-mode');
  await writeFile(cli, `import fs from 'node:fs';import path from 'node:path';
    const bundle=process.argv.slice(2)[4],dir=path.join(process.env.DSH_HOME,'profiles/web');
    fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({dependencies:{'dsh-plugin-openmotion-local':'file:'+bundle}}));
    const scope=JSON.parse(fs.readFileSync(path.join(bundle,'scope.json'),'utf8'));
    const state=JSON.parse(fs.readFileSync(path.join(scope.installHome,'install.json'),'utf8'));
    if(state.hosts.deepseek.bundleDirectory!==bundle)throw new Error('Launcher state is not ready');
    const mode=fs.existsSync(${JSON.stringify(fail)})?fs.readFileSync(${JSON.stringify(fail)},'utf8'):'';
    if(mode==='register'){console.error('partial registration');process.exit(1);}
    if(mode==='onboarding'){const scope=JSON.parse(fs.readFileSync(path.join(bundle,'scope.json'),'utf8'));fs.writeFileSync(path.join(scope.runtimeRoot,'docs/install.md'),'invalid contract');}`);
  return { options: { ...options, host: 'deepseek', dsh: cli }, fail, config: path.join(dshHome, 'profiles/web/package.json') };
}

for (const mode of ['register', 'onboarding']) {
  test(`Harness keeps the registered bundle after ${mode} failure and setup can retry`, async t => {
    const { options, fail, config } = await harnessRecoveryFixture(t);
    const first = await setup(options);
    const guide = path.join(first.appRoot, 'docs/install.md'), originalGuide = await readFile(guide);
    await writeFile(fail, mode);
    await assert.rejects(setup(options), mode === 'register' ? /partial registration/ : /onboarding contract/);
    const state = JSON.parse(await readFile(path.join(options.home, 'install.json'), 'utf8'));
    const dependency = JSON.parse(await readFile(config, 'utf8')).dependencies['dsh-plugin-openmotion-local'];
    assert.equal(dependency, 'file:' + state.hosts.deepseek.bundleDirectory);
    assert.notEqual(state.hosts.deepseek.bundleDirectory, first.hostInstallation.bundleDirectory);
    await readFile(path.join(state.hosts.deepseek.bundleDirectory, 'scope.json'));
    assert(state.hosts.deepseek.retainedBundles.includes(first.hostInstallation.bundleDirectory));
    await rm(fail); await writeFile(guide, originalGuide);
    const retried = await setup(options);
    assert.equal(JSON.parse(await readFile(config, 'utf8')).dependencies['dsh-plugin-openmotion-local'], 'file:' + retried.hostInstallation.bundleDirectory);
  });
}

test('Harness reconciles interrupted profile/state divergence and inventories bundles for offline cleanup', async t => {
  const { options, config } = await harnessRecoveryFixture(t);
  const first = await setup(options), stateFile = path.join(options.home, 'install.json');
  const oldState = await readFile(stateFile);
  const second = await setup(options);
  const switched = JSON.parse(await readFile(config, 'utf8'));
  await writeJSON(config, { dependencies: { 'dsh-plugin-openmotion-local': 'file:' + first.hostInstallation.bundleDirectory } });
  const { hostPlan: inspectPlan } = await import('../scripts/npm-hosts.mjs');
  const pending = await inspectPlan(options, second.launcher.replace(/[/\\]run-mcp.mjs$/, ''), second.launcher, JSON.parse(await readFile(stateFile, 'utf8')));
  assert((await pending.readConnection())?.transport); // State committed before the profile changed.
  await writeJSON(config, switched);
  await writeFile(stateFile, oldState); // Also recover the reverse divergence from earlier rollback behavior.
  const { hostPlan } = await import('../scripts/npm-hosts.mjs');
  const plan = await hostPlan(options, first.launcher.replace(/[/\\]run-mcp.mjs$/, ''), first.launcher, JSON.parse(oldState.toString()));
  assert((await plan.readConnection())?.transport);
  const third = await setup(options);
  assert(third.hostInstallation.retainedBundles.includes(first.hostInstallation.bundleDirectory));
  assert(third.hostInstallation.retainedBundles.includes(second.hostInstallation.bundleDirectory));
  const { cleanupHarnessBundles } = await import('../scripts/cleanup-harness-bundles.mjs');
  const inspection = await cleanupHarnessBundles(options.home);
  assert.equal(inspection.status, 'inspection'); assert.equal(inspection.candidates.length, 2);
  await readFile(path.join(first.hostInstallation.bundleDirectory, 'scope.json'));
  const cleaned = await cleanupHarnessBundles(options.home, true);
  assert.equal(cleaned.status, 'cleaned'); assert.equal(cleaned.removed.length, 2);
  await readFile(path.join(third.hostInstallation.bundleDirectory, 'scope.json'));
  assert.equal(JSON.parse(await readFile(config, 'utf8')).dependencies['dsh-plugin-openmotion-local'], 'file:' + third.hostInstallation.bundleDirectory);
  assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')).hosts.deepseek.retainedBundles, []);
});

test('a partially registered first Harness installation retains its launcher and can retry', async t => {
  const { options, fail, config } = await harnessRecoveryFixture(t);
  await writeFile(fail, 'register');
  await assert.rejects(setup(options), /partial registration/);
  const state = JSON.parse(await readFile(path.join(options.home, 'install.json'), 'utf8'));
  assert.equal(JSON.parse(await readFile(config, 'utf8')).dependencies['dsh-plugin-openmotion-local'], 'file:' + state.hosts.deepseek.bundleDirectory);
  await readFile(state.launcher);
  await rm(fail);
  const retried = await setup(options);
  assert.equal(retried.dataDirectory, state.dataDirectory);
});

test('an Agent without an adapter gets the same application, launcher and Skills and registers MCP itself', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t);
  const codexConfig = await readFile(options.config, 'utf8');
  const installed: any = await setup({ ...options, host: 'opencode', codex: undefined });
  assert.equal(installed.host, 'opencode');
  assert.deepEqual(installed.hosts.opencode, { skillsDirectory: await canonical(options.skillsDirectory), layout: 'flat', registration: 'agent' });
  assert.deepEqual(installed.agentRegistration.transport, { type: 'stdio', command: process.execPath, args: [installed.launcher] });
  assert.equal(installed.agentRegistration.serverName, 'openmotion');
  assert.equal(installed.agentRegistration.skillsDirectory, await canonical(options.skillsDirectory));
  assert.match(installed.agentRegistration.instructions, /configuration was not changed/);
  assert.match(installed.agentRegistration.instructions, /openmotion_get_project/);
  assert.deepEqual(installed.onboarding.directAccess.toolsArgs.slice(-4), ['--home', installed.launcher.replace(/[/\\]run-mcp.mjs$/, ''), '--host', 'opencode']);
  assert.equal(await readFile(options.config, 'utf8'), codexConfig, 'no other host configuration is touched');
  const marker = JSON.parse(await readFile(path.join(options.skillsDirectory, 'openmotion-production/openmotion-install.json'), 'utf8'));
  assert.equal(marker.host, 'agents'); assert.equal(marker.runtimeRoot, installed.appRoot);
  // A second adapter-less Agent shares the same Skills root instead of being refused as a foreign owner.
  const cursor: any = await setup({ ...options, host: 'cursor-agent', codex: undefined });
  assert.equal(cursor.appRoot, installed.appRoot);
  assert.deepEqual(Object.keys(cursor.hosts).sort(), ['cursor-agent', 'opencode']);
  assert.equal((await readdir(path.join(options.home, 'apps'))).length, 1);
  // Adapter hosts keep their own ownership and still refuse Skills managed for other Agents.
  await assert.rejects(setup({ ...options, host: 'workbuddy' }), /not owned by this installation/);
});

test('invalid Agent names are rejected before any download or state change', async t => {
  const options = await setupFixture(t);
  for (const host of ['Open Code', '../opencode', 'OPENCODE', '-x', 'a'.repeat(33), 'constructor']) {
    await assert.rejects(setup({ ...options, host }), /current Agent name/, host);
  }
  await assert.rejects(readdir(path.join(options.home, 'apps')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(options.home, 'install.json')), { code: 'ENOENT' });
});

test('adapter-less Agents can diagnose and call the installed MCP directly', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t), installed: any = await setup({ ...options, host: 'opencode', codex: undefined });
  const tools = JSON.parse(await readFile(path.join(installed.appRoot, 'shared/mcp-profiles.json'), 'utf8')).phase1.tools;
  await writeFile(installed.launcher, `import { createInterface } from 'node:readline';
    for await (const line of createInterface({ input: process.stdin })) {
      const q=JSON.parse(line); if(q.id===undefined) continue;
      const result=q.method==='initialize'?{serverInfo:{version:'1.2.3'}}:q.method==='tools/list'?{tools:${JSON.stringify(tools.map((name: string) => ({ name, inputSchema: { type: 'object' } })))}}:{structuredContent:{dataDirectory:${JSON.stringify(installed.dataDirectory)}}};
      console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
    }`);
  const result = await diagnose({ home: options.home, host: 'opencode' });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.dataDirectory, installed.dataDirectory);
  const cli = fileURLToPath(new URL('../scripts/npm-installer.mjs', import.meta.url));
  const listed = JSON.parse(await runFile(process.execPath, [cli, 'tools', '--home', options.home, '--host', 'opencode']));
  assert.equal(listed.tools.length, tools.length);
  assert.equal((await diagnose({ home: options.home, host: 'gemini' })).status, 'failed', 'an Agent that was never set up is not reported as installed');
  await assert.rejects(runFile(process.execPath, [cli, 'tools', '--home', options.home, '--host', 'constructor']), /not registered/, 'an Object.prototype key is never an installed Agent');
  assert.match((await diagnose({ home: options.home, host: 'constructor' })).message, /not registered/);
});

test('Codex workflow bundle coexists with the standalone primary Skill', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t);
  await mkdir(path.join(options.skillsDirectory, 'openmotion'), { recursive: true });
  await writeFile(path.join(options.skillsDirectory, 'openmotion/SKILL.md'), 'standalone primary Skill');
  const result = await setup(options);
  assert.equal(await readFile(path.join(options.skillsDirectory, 'openmotion/SKILL.md'), 'utf8'), 'standalone primary Skill');
  assert.equal(result.publicSkill.status, 'skipped');
  assert.match(await readFile(path.join(options.skillsDirectory, 'openmotion-workflows/skills/openmotion-production/SKILL.md'), 'utf8'), /openmotion-production/);
});

test('legacy Codex bundle migration preserves the old bundle on failed registration', { skip: process.platform === 'win32' }, async t => {
  const options = await setupFixture(t);
  const installed = await setup(options);
  const target = path.join(options.skillsDirectory, 'openmotion-workflows');
  const legacy = path.join(options.skillsDirectory, 'openmotion');
  await rename(target, legacy);
  await writeFile(path.join(legacy, 'keep.txt'), 'old bundle');
  await writeJSON(options.config, { fail: true });
  await assert.rejects(setup(options), /registration failed/);
  assert.equal(await readFile(path.join(legacy, 'keep.txt'), 'utf8'), 'old bundle');
  await assert.rejects(readFile(path.join(target, 'scope.json')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(path.join(options.home, 'install.json'), 'utf8')).appRoot, installed.appRoot);
  await writeJSON(options.config, {});
  await setup(options);
  await assert.rejects(readFile(path.join(legacy, 'scope.json')), { code: 'ENOENT' });
  assert.match(await readFile(path.join(target, 'skills/openmotion-production/SKILL.md'), 'utf8'), /openmotion-production/);
});


test('setup records an explicit attribution source and preserves it on untagged upgrades', async t => {
  const options = await setupFixture(t);
  await setup({ ...options, utmSource: 'producthunt' });
  const read = async () => JSON.parse(await readFile(path.join(options.home, 'data/tracking/identity.json'), 'utf8'));
  const first = await read();
  assert.equal(first.utm_source, 'producthunt');
  await setup(options);
  assert.deepEqual(await read(), first);
  await setup({ ...options, utmSource: 'partner' });
  const updated = await read();
  assert.equal(updated.utm_source, 'partner');
  assert.equal(updated.installation_id, first.installation_id);
});
