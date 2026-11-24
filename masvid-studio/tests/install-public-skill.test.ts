import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installPublicSkill, skillsCliVersion } from '../scripts/install-public-skill.ts';

async function fixture(t: any) {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'openmotion-public-skill-'));
  t.after(() => rm(homeDirectory, { recursive: true, force: true }));
  const calls: { command: string; args: string[]; options: any }[] = [];
  return { homeDirectory, env: {}, calls, host: 'codex', run: async (command: string, args: string[], options: object) => { calls.push({ command, args, options }); } };
}

test('public Skill uses the pinned official CLI with the GitHub identity and only the selected host', async t => {
  const options = await fixture(t);
  const ref = 'a'.repeat(40);
  assert.equal((await installPublicSkill({ ...options, ref })).status, 'installed');
  assert.equal(options.calls.length, 1);
  const [call] = options.calls;
  assert.equal(call.command, process.execPath);
  assert.deepEqual(call.args.slice(1), ['exec', '--yes', '--package=skills@' + skillsCliVersion, '--', 'skills', 'add',
    'https://github.com/nexu-io/openmotion/tree/' + ref, '--skill', 'openmotion', '--global', '--agent', 'codex', '--copy', '--yes']);
  assert.equal(call.options.timeout, 120_000);
});

test('existing official entries are reused without an install event', async t => {
  const options = await fixture(t);
  const root = path.join(options.homeDirectory, '.agents');
  await mkdir(path.join(root, 'skills/openmotion'), { recursive: true });
  await writeFile(path.join(root, 'skills/openmotion/SKILL.md'), '---\nname: openmotion\ndescription: fixture\n---\n');
  await writeFile(path.join(root, '.skill-lock.json'), JSON.stringify({ version: 3, skills: { openmotion: { source: 'nexu-io/openmotion' } } }));
  assert.equal((await installPublicSkill(options)).status, 'present');
  assert.equal(options.calls.length, 0);
});

test('foreign entries and a stale lock over a runtime bundle never authorize overwriting files', async t => {
  const options = await fixture(t);
  const root = path.join(options.homeDirectory, '.agents');
  const directory = path.join(root, 'skills/openmotion');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'keep.txt'), 'foreign content');
  await assert.rejects(installPublicSkill(options), /not owned/);
  await writeFile(path.join(root, '.skill-lock.json'), JSON.stringify({ version: 3, skills: { openmotion: { source: 'nexu-io/openmotion' } } }));
  await assert.rejects(installPublicSkill(options), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(directory, 'keep.txt'), 'utf8'), 'foreign content');
  assert.equal(options.calls.length, 0);
});

test('custom profiles, unsupported hosts and explicit skip do not write global Skills', async t => {
  const options = await fixture(t);
  for (const variant of [{ env: { CODEX_HOME: '/custom/profile' } }, { host: 'claude', env: { CLAUDE_CONFIG_DIR: '/custom/profile' } },
    { host: 'deepseek' }, { env: { OPENMOTION_SKIP_PUBLIC_SKILL: '1' } }]) {
    assert.equal((await installPublicSkill({ ...options, ...variant })).status, 'skipped');
  }
  assert.equal(options.calls.length, 0);
});

test('Claude installs only its agent and preserves official telemetry opt-outs', async t => {
  const options = await fixture(t);
  const env = { DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' };
  await installPublicSkill({ ...options, host: 'claude', env });
  assert.equal(options.calls[0].args.at(-3), 'claude-code');
  assert.deepEqual(options.calls[0].options.env, env);
});

test('XDG state lock is reused and CLI errors are reported without a second invocation', async t => {
  const options = await fixture(t);
  const state = path.join(options.homeDirectory, 'state');
  await mkdir(path.join(state, 'skills'), { recursive: true });
  await mkdir(path.join(options.homeDirectory, '.agents/skills/openmotion'), { recursive: true });
  await writeFile(path.join(options.homeDirectory, '.agents/skills/openmotion/SKILL.md'), '---\nname: openmotion\n---\n');
  await writeFile(path.join(state, 'skills/.skill-lock.json'), JSON.stringify({ version: 3, skills: { openmotion: { source: 'nexu-io/openmotion' } } }));
  assert.equal((await installPublicSkill({ ...options, env: { XDG_STATE_HOME: state } })).status, 'present');
  await assert.rejects(installPublicSkill({ ...options, homeDirectory: path.join(options.homeDirectory, 'empty'), run: async () => { throw new Error('offline'); } }), /offline/);
});

test('the CLI runs through a symlinked checkout instead of silently succeeding', async t => {
  const options = await fixture(t);
  const checkout = path.join(options.homeDirectory, 'checkout');
  await symlink(fileURLToPath(new URL('../', import.meta.url)), checkout, 'junction');
  const result = spawnSync(process.execPath, [path.join(checkout, 'scripts/install-public-skill.ts'), 'codex'], {
    env: { ...process.env, OPENMOTION_SKIP_PUBLIC_SKILL: '1' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'skipped', reason: 'disabled' });
});

test('a legacy Codex bundle defers public Skill installation when adding Claude', async t => {
  const options = await fixture(t);
  const directory = path.join(options.homeDirectory, '.agents/skills/openmotion');
  await mkdir(directory, { recursive: true });
  const scope = JSON.stringify({ managedBy: '@openmotion/installer', host: 'codex', installHome: path.join(options.homeDirectory, 'runtime') });
  await writeFile(path.join(directory, 'scope.json'), scope);
  await writeFile(path.join(directory, 'keep.txt'), 'legacy workflow bundle');
  const result = await installPublicSkill({ ...options, host: 'claude' });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason!, /legacy Codex.*migrat/i);
  assert.equal(await readFile(path.join(directory, 'scope.json'), 'utf8'), scope);
  assert.equal(await readFile(path.join(directory, 'keep.txt'), 'utf8'), 'legacy workflow bundle');
  assert.equal(options.calls.length, 0);
});

test('DSH installs the official universal Skill in the selected profile without touching global entries', async t => {
  const options = await fixture(t);
  const projectDirectory = path.join(options.homeDirectory, 'dsh/profiles/trial');
  await mkdir(projectDirectory, { recursive: true });
  const scoped = { ...options, host: 'deepseek', projectDirectory };
  assert.equal((await installPublicSkill(scoped)).status, 'installed');
  assert.equal(options.calls.length, 1);
  assert(!options.calls[0].args.includes('--global'));
  assert.equal(options.calls[0].args.at(-3), 'universal');
  assert.equal(options.calls[0].options.cwd, projectDirectory);
  await mkdir(path.join(projectDirectory, '.agents/skills/openmotion'), { recursive: true });
  await writeFile(path.join(projectDirectory, '.agents/skills/openmotion/SKILL.md'), '---\nname: openmotion\n---\n');
  await writeFile(path.join(projectDirectory, 'skills-lock.json'), JSON.stringify({ version: 2, skills: { openmotion: { source: 'nexu-io/openmotion' } } }));
  assert.equal((await installPublicSkill(scoped)).status, 'present');
  assert.equal(options.calls.length, 1);
});
