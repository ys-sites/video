import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// Isolate downloads, dependency commands and Codex writes from the user's machine.
async function fixture(run: (context: { directory: string; destination: string; log: string; env: NodeJS.ProcessEnv }) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-bootstrap-'));
  try {
    const bin = path.join(directory, 'bin');
    const source = path.join(directory, 'source');
    const destination = path.join(directory, 'new user', 'open-motion');
    const log = path.join(directory, 'commands.log');
    await mkdir(bin);
    for (const file of ['scripts/install-motion.command', 'scripts/install-public-skill.ts', 'scripts/source-build-state.mjs', 'scripts/inline-onboarding.mjs', 'scripts/source-marketplace.mjs', 'scripts/install-onboarding.mjs', 'scripts/codex-host-handoff.mjs', 'scripts/check-installed-mcp.mjs', 'shared/onboarding-templates.ts', 'scripts/runtime-assets.mjs',
      'docs/install.md', 'shared/template-config.json', 'marketplace.example.json', 'mcp-ui/template-recommendations/i18n.ts']) {
      await mkdir(path.dirname(path.join(source, file)), { recursive: true });
      await copyFile(path.join(root, file), path.join(source, file));
    }
    await writeFile(path.join(source, 'scripts/open-template-library.ts'), `import fs from 'node:fs'; fs.appendFileSync(process.env.MOTION_TEST_LOG, 'Template library prepared' + String.fromCharCode(10)); console.log(JSON.stringify({target:'templates',projectCreated:false,previewUrl:'http://127.0.0.1:4173/?templates=1&embed=1'}));`);
    await writeFile(path.join(source, 'workspace.ts'), `export class WorkspaceStore { directory = '/isolated/test-workspace'; }`);
    await writeFile(path.join(source, 'package-lock.json'), '{}');
    await writeFile(path.join(source, 'package.json'), JSON.stringify({ type: 'module', version: '0.0.1' }));
    // No remote catalog or template assets in this isolated checkout: exercise the unavailable-catalog boundary.
    const commands = {
      git: 'echo "git $*" >> "$MOTION_TEST_LOG"\n[ "${MOTION_TEST_DOWNLOAD_FAIL:-0}" = 0 ] || exit 8\nwhile [ "$1" = -c ]; do shift 2; done\n[ "$1" = clone ] || exit 0\nfor destination; do :; done\nmkdir -p "$destination"\ncp -R "$MOTION_TEST_SOURCE/." "$destination/"',
      npm: 'echo "npm $*" >> "$MOTION_TEST_LOG"\nif [ "$1" = ci ]; then [ "${MOTION_TEST_DEPENDENCY_FAIL:-0}" = 0 ] || exit 9; fi\nif [ "$*" = "run build:studio" ]; then [ "${MOTION_TEST_BUILD_FAIL:-0}" = 0 ] || exit 9; mkdir -p studio/build; touch studio/build/index.html; fi',
      codex: '[ "$*" != "plugin list --marketplace openmotion-local --available --json" ] || { printf \'{"installed":[],"available":[]}\\n\'; exit 0; }\n' + 'echo "codex $*" >> "$MOTION_TEST_LOG"\n[ "${MOTION_TEST_OLD_CODEX:-0}" = 0 ] || exit 10',
      node: 'case "${1:-}" in\n  */check-installed-mcp.mjs) echo "MCP check" >> "$MOTION_TEST_LOG"; exit "${MOTION_TEST_MCP_FAIL:-0}" ;;\nesac\nexec "$MOTION_TEST_NODE" "$@"',
    };
    for (const [name, command] of Object.entries(commands)) {
      await writeFile(path.join(bin, name), '#!/bin/bash\nset -eu\n' + command + '\n', { mode: 0o755 });
    }
    await run({ directory, destination, log, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      OPENMOTION_SKIP_PUBLIC_SKILL: '1', OPENMOTION_INSTALL_DIR: destination, OPENMOTION_REF: 'test-ref', MOTION_TEST_SOURCE: source,
      // Exercise a known calling chat without inheriting a developer's real
      // session or relying on CI to provide one. The control socket is absent.
      CODEX_THREAD_ID: '11111111-1111-4111-8111-111111111111', CODEX_SESSION_ID: '',
      OPENMOTION_CODEX_SOCKET: path.join(directory, 'absent-host.sock'),
      MOTION_TEST_NODE: process.execPath, MOTION_TEST_LOG: log } });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('remote entry point builds a fresh checkout before registering and checking the plugin', async () => {
  await fixture(async ({ destination, log, env }) => {
    const result = spawnSync('bash', [path.join(root, 'install.sh')], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    await access(path.join(destination, 'studio/build/index.html'));
    const commands = await readFile(log, 'utf8');
    assert.match(commands, /git .*clone --depth 1 --single-branch --branch test-ref -- https:\/\/github\.com\/nexu-io\/openmotion\.git/);
    assert.ok(commands.indexOf('npm ci --include=dev') < commands.indexOf('npm run build:studio'));
    assert.ok(commands.indexOf('npm run build:studio') < commands.indexOf('codex plugin marketplace add'));
    assert.match(commands, /codex plugin add openmotion@openmotion-local\ncodex plugin list --marketplace openmotion-local\nMCP check/);
    assert.match(result.stderr, /MCP_ACTIVATION: blocked.*HOST_CONTROL_UNAVAILABLE/);
    const onboarding = JSON.parse(result.stdout.slice(result.stdout.indexOf('\n{\n') + 1).split('\n[OpenMotion]')[0]);
    assert.equal(onboarding.hostSessionVerified, false);
    assert.equal(onboarding.hostHandoff.status, 'host_action_required');
    assert.equal(onboarding.hostHandoff.presentationVerified, false);
    assert.equal(onboarding.installationStatus, 'installed');
    assert.equal(onboarding.onboardingStatus, 'awaiting_host_delivery');
    assert.equal(onboarding.instructions, undefined);
    assert.match(await readFile(onboarding.detailsFile, 'utf8'), /Installation-success reply/);
    assert.equal(JSON.parse(await readFile(onboarding.detailsFile, 'utf8')).catalog.source, 'unavailable');
    assert.equal(onboarding.preview.status, 'ready');
    assert.ok(result.stdout.length < 7000, 'terminal summary must not include the full success contract');
    const phases = (await readFile(path.join(destination, '.artifacts/install/timings.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(phases.map(phase => phase.phase), ['source-download', 'source-preflight', 'dependencies', 'studio-build', 'marketplace', 'plugin', 'mcp-preflight', 'public-skill', 'onboarding']);
    assert(phases.every(phase => Number.isInteger(phase.seconds) && phase.seconds >= 0));
    assert.ok(commands.indexOf('MCP check') < commands.indexOf('Template library prepared'));
  });
});

test('source setup without a calling chat reports that boundary without invoking host control', async () => {
  await fixture(async ({ log, env }) => {
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
      env: { ...env, CODEX_THREAD_ID: '', CODEX_SESSION_ID: '' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /MCP_ACTIVATION: blocked.*CURRENT_CHAT_UNKNOWN/);
    const onboarding = JSON.parse(result.stdout.slice(result.stdout.indexOf('\n{\n') + 1).split('\n[OpenMotion]')[0]);
    assert.equal(onboarding.installationStatus, 'installed');
    assert.equal(onboarding.hostHandoff.reason, 'CURRENT_CHAT_UNKNOWN');
    assert.equal(onboarding.hostHandoff.hostSessionVerified, false);
    assert.equal(onboarding.hostHandoff.presentationVerified, false);
    assert.doesNotMatch(await readFile(log, 'utf8'), /codex (?:queue|app-server)/);
  });
});

for (const threadId of ['', '11111111-1111-4111-8111-111111111111']) test('prepared onboarding stays in the installing turn with chat ' + (threadId || 'unknown'), async () => {
  await fixture(async ({ log, env }) => {
    // Exercise the prepared-but-undelivered protocol without rendering a widget,
    // starting a real preview or sending any message to the developer's chat.
    await writeFile(path.join(env.MOTION_TEST_SOURCE!, 'scripts/inline-onboarding.mjs'), `import fs from 'node:fs/promises'; import path from 'node:path'; import {createHash} from 'node:crypto';
export { onboardingPresentationInstructions } from ${JSON.stringify(path.join(root, 'scripts/inline-onboarding.mjs'))};
export async function prepareInlineOnboarding({output, language}) { await fs.mkdir(path.dirname(output), {recursive:true}); await fs.writeFile(output, 'verified cards'); return {status:'prepared', path:output, sha256:createHash('sha256').update('verified cards').digest('hex'), language}; }`);
    const result = spawnSync('bash', [path.join(root, 'install.sh')], {
      env: { ...env, MOTION_DATA_DIR: path.join(env.MOTION_TEST_SOURCE!, 'data'), CODEX_THREAD_ID: threadId, CODEX_SESSION_ID: '' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(await readFile(log, 'utf8'), /codex queue/);
    assert.match(result.stderr, /same installation turn/);
    assert.match(result.stderr, /[Pp]ublish.*permitted visualization directory/);
    const onboarding = JSON.parse(result.stdout.slice(result.stdout.indexOf('\n{\n') + 1).split('\n[OpenMotion]')[0]);
    assert.equal(onboarding.inlinePresentation.status, 'prepared');
    assert.equal(onboarding.onboardingComplete, false);
    assert.equal(onboarding.onboardingStatus, 'awaiting_host_delivery', 'Presentation acceptance must remain separate from current-chat activation');
    assert.equal(onboarding.hostHandoff.automaticActivation, 'blocked');
    assert.equal(onboarding.callback, undefined);
    assert.equal(onboarding.preview.status, 'ready');
  });
});

for (const kind of ['directory', 'symlink']) {
  test(`existing ${kind} is protected without downloading or registering`, async () => {
    await fixture(async ({ directory, destination, log, env }) => {
      const marker = path.join(destination, 'user-work.txt');
      await mkdir(path.dirname(destination), { recursive: true });
      if (kind === 'directory') {
        await mkdir(destination);
        await writeFile(marker, 'keep');
      } else {
        await symlink(path.join(directory, 'missing'), destination);
      }
      const result = spawnSync('bash', [path.join(root, 'install.sh')], { env, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /安装目录已存在，未覆盖/);
      if (kind === 'directory') assert.equal(await readFile(marker, 'utf8'), 'keep');
      assert.doesNotMatch(await readFile(log, 'utf8'), /git clone|marketplace add/);
    });
  });
}

test('a prebuilt distribution skips dependency installation and editor build', async () => {
  await fixture(async ({ log, env }) => {
    const build = path.join(env.MOTION_TEST_SOURCE!, 'studio/build');
    await mkdir(build, { recursive: true });
    await writeFile(path.join(build, 'index.html'), 'prebuilt');
    const result = spawnSync('bash', [path.join(root, 'install.sh')], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(await readFile(log, 'utf8'), /npm /);
  });
});

test('repeat source setup reuses the build and preserves earlier diagnostic evidence', async () => {
  await fixture(async ({ destination, log, env }) => {
    const first = spawnSync('bash', [path.join(root, 'install.sh')], { env, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const directory = path.join(destination, '.artifacts/install');
    const before = await readFile(path.join(directory, 'timings.jsonl'), 'utf8');
    const summary = JSON.parse(first.stdout.slice(first.stdout.indexOf('\n{\n') + 1).split('\n[OpenMotion]')[0]);
    const originalDetails = await readFile(summary.detailsFile, 'utf8');
    const second = spawnSync('bash', [path.join(destination, 'scripts/install-motion.command')], { env, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    assert.equal((await readFile(log, 'utf8')).match(/npm ci/g)?.length, 1);
    assert((await readFile(path.join(directory, 'timings.jsonl'), 'utf8')).startsWith(before));
    assert.equal(await readFile(summary.detailsFile, 'utf8'), originalDetails);
  });
});

for (const [failure, expected] of [
  ['MOTION_TEST_OLD_CODEX', /不支持插件安装/],
  ['MOTION_TEST_DOWNLOAD_FAIL', null],
  ['MOTION_TEST_DEPENDENCY_FAIL', null],
  ['MOTION_TEST_BUILD_FAIL', null],
] as const) {
  test(`${failure} stops before plugin registration and never claims success`, async () => {
    await fixture(async ({ log, env }) => {
      const result = spawnSync('bash', [path.join(root, 'install.sh')], { env: { ...env, [failure]: '1' }, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      if (expected) assert.match(result.stderr, expected);
      assert.doesNotMatch(await readFile(log, 'utf8'), /marketplace add|plugin add openmotion@/);
      assert.doesNotMatch(result.stdout, /preflight succeeded|Installation-success reply/);
    });
  });
}

test('MCP verification failure is reported even after plugin registration', async () => {
  await fixture(async ({ log, env }) => {
    const result = spawnSync('bash', [path.join(root, 'install.sh')], { env: { ...env, MOTION_TEST_MCP_FAIL: '1' }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(await readFile(log, 'utf8'), /plugin add openmotion@openmotion-local/);
    assert.doesNotMatch(result.stdout, /preflight succeeded|Installation-success reply/);
    const phases = (await readFile(path.join(env.OPENMOTION_INSTALL_DIR!, '.artifacts/install/timings.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line));
    assert.equal(phases.at(-1).phase, 'mcp-preflight');
    assert.equal(phases.at(-1).exitCode, 1, 'a failed phase must retain its actual failure status');
  });
});

test('a missing onboarding contract stops before plugin registration', async () => {
  await fixture(async ({ log, env }) => {
    await rm(path.join(env.MOTION_TEST_SOURCE!, 'docs/install.md'));
    const result = spawnSync('bash', [path.join(root, 'install.sh')], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /install\.md/);
    assert.doesNotMatch(await readFile(log, 'utf8'), /marketplace add|plugin add openmotion@/);
    assert.doesNotMatch(result.stdout, /preflight succeeded|Installation-success reply/);
  });
});

test('the onboarding entry runs through a symlinked checkout path', async () => {
  await fixture(async ({ directory, env }) => {
    const linked = path.join(directory, 'linked source');
    await symlink(env.MOTION_TEST_SOURCE!, linked, 'junction');
    const result = spawnSync(process.execPath, [path.join(linked, 'scripts/install-onboarding.mjs'), linked], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const onboarding = JSON.parse(result.stdout);
    assert.equal(onboarding.hostSessionVerified, false);
    assert.match(onboarding.instructions, /OpenMotion 安装好啦/);
    assert.equal(onboarding.catalog.source, 'unavailable');
    assert.deepEqual(onboarding.catalog.templates, []);
    assert.equal(onboarding.catalog.recommendedTemplateId, null);
  });
});

test('the source entry overrides broken global LFS filters without downloading optional media', async () => {
  await fixture(async ({ log, env }) => {
    const git = path.join(env.PATH!.split(path.delimiter)[0], 'git');
    const original = await readFile(git, 'utf8');
    await writeFile(git, original.replace('while [ "$1" = -c ]; do shift 2; done',
      '[ "$1" = -c ] || { echo "git-lfs: command not found" >&2; exit 128; }\nwhile [ "$1" = -c ]; do shift 2; done\nwhile [ "$1" = -c ]; do shift 2; done\n[ "$1" = clone ] || exit 0'));
    const result = spawnSync('bash', [path.join(root, 'install.sh')], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(log, 'utf8'), /filter\.lfs\.process= .*filter\.lfs\.required=false/);
    assert.match(result.stdout, /source-download.*seconds/);
  });
});

test('an optional public Skill failure does not block the installed plugin or onboarding', async () => {
  await fixture(async ({ env }) => {
    await writeFile(path.join(env.MOTION_TEST_SOURCE!, 'scripts/install-public-skill.ts'), 'console.error("Public Skill fixture offline"); process.exitCode = 1;');
    const result = spawnSync('bash', [path.join(root, 'install.sh')], { env: { ...env, OPENMOTION_SKIP_PUBLIC_SKILL: '' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Public Skill fixture offline/);
    const phases = (await readFile(path.join(env.OPENMOTION_INSTALL_DIR!, '.artifacts/install/timings.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line));
    assert.equal(phases.find(phase => phase.phase === 'public-skill').exitCode, 1);
    assert.equal(phases.at(-1).phase, 'onboarding');
    assert.equal(phases.at(-1).exitCode, 0);
  });
});
