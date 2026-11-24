import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commitCleanup, finalizeMediaCleanup, prepareMediaCleanup, preparePullRequest, publishMedia, type TreeFile } from '../scripts/prepare-pr-media.ts';
import { pullMedia } from '../scripts/repository-media.ts';
import { downloadMedia, mediaDigest, mediaKey, mediaOrigin, validateMediaManifest, type MediaLock } from '../shared/repository-media.ts';
import { refreshManifest } from '../scripts/template-library.ts';
import { mergePreparedPullRequest, preparedMergeStatus } from '../scripts/merge-prepared-pr.ts';
import { checkRepositoryStorage } from '../scripts/check-repository-storage.ts';

const sourceSHA = 'a'.repeat(40), prefix = 'library/templates/catalog/motion-demo/';
function fixture(mediaBytes = 128) {
  const bytes = Buffer.alloc(mediaBytes, 42), video = prefix + 'source/assets/reference.mp4';
  const record = { templateId: 'motion-demo', entry: { templateId: 'motion-demo', original: { templateName: 'Demo' }, files: [] }, locales: { en: {} }, localMedia: { preview: 'assets/reference.mp4' } };
  const contents = new Map<string, Buffer>([
    [video, bytes],
    [prefix + 'source/motion.md', Buffer.from('# Demo\n[Reference](assets/reference.mp4)\n')],
    [prefix + 'source/preview.html', Buffer.from('<video src="assets/reference.mp4"></video>')],
    [prefix + 'TEMPLATE.md', Buffer.from('# Usage')],
    [prefix + 'template.json', Buffer.from(JSON.stringify(record))],
    ['library/templates/catalog/catalog.json', Buffer.from(JSON.stringify({ schemaVersion: 1, publication: { defaultLocale: 'en', locales: ['en'] }, templateIds: ['motion-demo'] }))],
    ['repository-media.json', Buffer.from('{"schemaVersion":1,"files":[]}')],
    ['.gitignore', Buffer.from('.artifacts/\n')],
  ]);
  contents.set(prefix + 'source/manifest.json', Buffer.from(JSON.stringify({ files: [...contents].filter(([name]) => name.startsWith(prefix + 'source/')).map(([name, bytes]) => ({ path: name.slice((prefix + 'source/').length), bytes: bytes.length, sha256: mediaDigest(bytes) })) })));
  const tree = (): TreeFile[] => [...contents].map(([name, bytes]) => ({ path: name, type: 'blob', mode: '100644', sha: createHash('sha1').update(bytes).digest('hex'), size: bytes.length }));
  const read = async (file: TreeFile) => contents.get(file.path)!;
  const inputs = () => ({ head: tree(), base: [], sourceSHA, pullNumber: 42 });
  return { bytes, video, contents, tree, read, inputs };
}

async function isolated(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'openmotion-media-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function git(directory: string, args: string[], input?: string): string {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: directory, input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}

test('final preparation keeps the PR, original media identity and roles while replacing guide links', async () => {
  const f = fixture();
  const plan = await prepareMediaCleanup(f.inputs(), f.read);
  assert.equal(plan.pullNumber, 42); assert.equal(plan.sourceSHA, sourceSHA); assert.equal(plan.media.length, 1);
  assert.equal(plan.changes.find(change => change.path === f.video)!.content, null);
  const value = (name: string) => Buffer.from(plan.changes.find(change => change.path === name)!.content!, 'base64').toString();
  const record = JSON.parse(value(prefix + 'template.json'));
  assert.equal(record.localMedia.preview, 'assets/reference.mp4');
  assert.deepEqual(record.remoteAssets[0].source, { path: 'assets/reference.mp4', bytes: f.bytes.length, sha256: mediaDigest(f.bytes) });
  assert(value(prefix + 'source/preview.html').includes(plan.media[0].url));
  const manifest = JSON.parse(value(prefix + 'source/manifest.json'));
  assert.equal(manifest.files.find((file: any) => file.path === 'preview.html').sha256, mediaDigest(Buffer.from(value(prefix + 'source/preview.html'))));
  assert(f.contents.has(f.video), 'Planning never changes the original files');
  assert.equal((await prepareMediaCleanup({ ...f.inputs(), base: f.tree() }, f.read)).media.length, 0, 'Unchanged media is not reuploaded');
});

test('cleanup accepts LFS as an input and records legacy paths for verified optional downloads', async () => {
  const f = fixture(), name = 'docs/readme/demo.mp4';
  f.contents.set(name, Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${mediaDigest(f.bytes)}\nsize ${f.bytes.length}\n`));
  const plan = await prepareMediaCleanup(f.inputs(), f.read);
  const manifest = validateMediaManifest(JSON.parse(Buffer.from(plan.changes.find(change => change.path === 'repository-media.json')!.content!, 'base64').toString()));
  assert.equal(manifest.files[0].path, name); assert.equal(manifest.files[0].sha256, mediaDigest(f.bytes));
  assert(Buffer.from(plan.changes.find(change => change.path === '.gitignore')!.content!, 'base64').toString().includes('/' + name));
});

test('prepares Skill preview animations and WebP posters for the hosted workflow', async t => {
  const f = fixture(), name = 'studio/src/motion/skill-covers/animated-card.gif';
  const poster = 'studio/src/motion/skill-covers/animated-card.webp';
  const posterBytes = Buffer.from('poster');
  const base = f.tree();
  f.contents.set(name, f.bytes); f.contents.set(poster, posterBytes);
  const plan = await prepareMediaCleanup({ ...f.inputs(), base }, f.read);
  assert.deepEqual(plan.media.map(file => file.path), [name, poster]);
  assert.equal(plan.changes.find(change => change.path === name)?.content, null);
  assert.equal(plan.changes.find(change => change.path === poster)?.content, null);
  const directory = await isolated(t);
  git(directory, ['init']);
  for (const filename of [name, poster]) {
    const file = path.join(directory, filename);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, f.contents.get(filename)!);
  }
  git(directory, ['add', '.']);
  const storageErrors = checkRepositoryStorage(directory).errors.join('\n');
  assert.match(storageErrors, /animated-card\.gif: Skill previews are hosted/);
  assert.match(storageErrors, /animated-card\.webp: Skill previews are hosted/);
  for (const change of plan.changes) {
    const file = path.join(directory, change.path);
    if (change.content === null) await rm(file);
    else await writeFile(file, Buffer.from(change.content, 'base64'));
  }
  git(directory, ['add', '.']);
  assert.deepEqual(checkRepositoryStorage(directory).errors, []);
  const byUrl = new Map(plan.media.map(file => [file.url, f.contents.get(file.path)!]));
  const fetcher = async (input: string | URL | Request) => new Response(new Uint8Array(byUrl.get(String(input))!));
  assert.deepEqual(await pullMedia(directory, undefined, fetcher), { selected: 0 });
  assert.deepEqual(await pullMedia(directory, 'studio/src/motion/skill-covers', fetcher), { selected: 2 });
  assert.deepEqual(await readFile(path.join(directory, name)), f.bytes);
  assert.deepEqual(await readFile(path.join(directory, poster)), posterBytes);
});

test('encoded filenames and a later revision of prepared media retain working references', async t => {
  const f = fixture(), name = prefix + 'source/assets/ref one.mp4';
  f.contents.set(name, f.bytes);
  f.contents.set(prefix + 'source/preview.html', Buffer.from('<video src="assets/ref%20one.mp4"></video>'));
  const first = await prepareMediaCleanup(f.inputs(), f.read);
  for (const change of first.changes) {
    if (change.content === null) f.contents.delete(change.path);
    else f.contents.set(change.path, Buffer.from(change.content, 'base64'));
  }
  const before = f.tree(), oldURL = first.media.find(file => file.path === name)!.url;
  assert(f.contents.get(prefix + 'source/preview.html')!.toString().includes(oldURL));
  const revised = Buffer.alloc(129, 43); f.contents.set(name, revised);
  const directory = await isolated(t);
  for (const [file, bytes] of f.contents) { await mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await writeFile(path.join(directory, file), bytes); }
  await refreshManifest('motion-demo', path.join(directory, 'library/templates/catalog'));
  const manifest = JSON.parse(await readFile(path.join(directory, prefix + 'source/manifest.json'), 'utf8'));
  assert.equal(manifest.files.filter((file: any) => file.path === 'assets/ref one.mp4').length, 1);
  assert.equal(manifest.files.find((file: any) => file.path === 'assets/ref one.mp4').sha256, mediaDigest(revised));
  const next = await prepareMediaCleanup({ ...f.inputs(), base: before }, f.read);
  const guide = Buffer.from(next.changes.find(change => change.path === prefix + 'source/preview.html')!.content!, 'base64').toString();
  assert(!guide.includes(oldURL)); assert(guide.includes(next.media[0].url));
});

test('invalid input and a failed transfer cannot publish cleanup or mutate the input', async () => {
  const f = fixture(); let uploaded = false;
  const bad = f.inputs(); bad.head.find(file => file.path === f.video)!.mode = '120000';
  await assert.rejects(prepareMediaCleanup(bad, f.read, async () => { uploaded = true; })); assert.equal(uploaded, false);
  const tooLarge = f.inputs(); tooLarge.head.find(file => file.path === f.video)!.size = 50 * 1024 * 1024 + 1;
  await assert.rejects(prepareMediaCleanup(tooLarge, f.read, async () => { uploaded = true; }), /50 MiB/); assert.equal(uploaded, false);
  await assert.rejects(prepareMediaCleanup(f.inputs(), f.read, async () => { throw Error('Upload failed'); }), /Upload failed/);
  assert(f.contents.has(f.video));
});

test('failed upload, changed PR head and rejected write never report a completed PR update', async () => {
  const f = fixture(), plan = await prepareMediaCleanup(f.inputs(), f.read); let pushed = false;
  const push = async () => { pushed = true; };
  await assert.rejects(finalizeMediaCleanup(plan, async () => { throw Error('Upload failed'); }, async () => sourceSHA, push), /Upload failed/);
  assert.equal(pushed, false);
  await assert.rejects(finalizeMediaCleanup(plan, async () => {}, async () => 'b'.repeat(40), push), /PR changed/);
  assert.equal(pushed, false);
  await assert.rejects(finalizeMediaCleanup(plan, async () => {}, async () => sourceSHA, async () => { throw Error('Write access denied'); }), /Write access denied/);
  await finalizeMediaCleanup(plan, async () => {}, async () => sourceSHA, push); assert.equal(pushed, true);
});

test('public writes are conditional, confined to the media prefix and verified before success', async () => {
  const f = fixture(), lock = (await prepareMediaCleanup(f.inputs(), f.read)).media[0]; let stored = false, puts = 0;
  const fetcher = async (_: any, options?: any) => new Response(options?.method === 'HEAD' ? null : new Uint8Array(f.bytes), { status: stored ? 200 : 404 });
  const options = { endpoint: 'https://example.r2.cloudflarestorage.com', bucket: 'test-media', fetcher: fetcher as typeof fetch, run: async (args: string[]) => {
    assert.equal(args[args.indexOf('--key') + 1], mediaKey(lock.sha256, lock.path));
    assert.equal(args[args.indexOf('--if-none-match') + 1], '*');
    assert.equal(mediaDigest(await readFile(args[args.indexOf('--body') + 1])), lock.sha256);
    puts++; stored = true;
  } };
  await publishMedia(lock, f.bytes, options); assert.equal(puts, 1);
  await publishMedia(lock, f.bytes, options); assert.equal(puts, 1);
  await assert.rejects(publishMedia(lock, Buffer.alloc(f.bytes.length), options), /Assertion/);
  await assert.rejects(publishMedia(lock, f.bytes, { ...options, fetcher: (async () => new Response(new Uint8Array(Buffer.alloc(lock.bytes)), { status: 200 })) as typeof fetch }), /SHA-256 mismatch/);
});

test('interrupted media streams retry from a fresh response and retain exact-byte verification', async () => {
  const bytes = Buffer.alloc(128, 42), sha256 = mediaDigest(bytes);
  const lock: MediaLock = { path: 'docs/readme/retry.webm', bytes: bytes.length, sha256, url: mediaOrigin + '/' + mediaKey(sha256, 'retry.webm') };
  let requests = 0;
  const fetcher = (async () => {
    if (++requests > 1) return new Response(new Uint8Array(bytes));
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(bytes.subarray(0, 8))); },
      pull(controller) { controller.error(new TypeError('terminated', { cause: { code: 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH' } })); },
    }));
  }) as typeof fetch;
  assert.deepEqual(await downloadMedia(lock, fetcher), bytes);
  assert.equal(requests, 2);
  requests = 0;
  await assert.rejects(downloadMedia(lock, (async () => {
    requests++;
    throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
  }) as typeof fetch), /docs\/readme\/retry.webm/);
  assert.equal(requests, 3, 'An unavailable object cannot retry indefinitely');
});

test('media retries never accept or repeat HTTP failures, over-budget bodies or corrupt complete objects', async () => {
  const bytes = Buffer.alloc(128, 42), sha256 = mediaDigest(bytes);
  const lock: MediaLock = { path: 'docs/readme/retry.webm', bytes: bytes.length, sha256, url: mediaOrigin + '/' + mediaKey(sha256, 'retry.webm') };
  for (const response of [new Response(null, { status: 404 }), new Response(new Uint8Array(129)), new Response(new Uint8Array(128))]) {
    let requests = 0;
    await assert.rejects(downloadMedia(lock, (async () => { requests++; return response; }) as typeof fetch));
    assert.equal(requests, 1);
  }
});

test('optional media pulls restore exact bytes, reuse valid files and reject corrupt bodies and symlinks', async t => {
  const directory = await isolated(t), bytes = Buffer.alloc(128, 42), sha256 = mediaDigest(bytes);
  const lock: MediaLock = { path: 'docs/readme/demo.mp4', bytes: bytes.length, sha256, url: mediaOrigin + '/' + mediaKey(sha256, 'demo.mp4') };
  await writeFile(path.join(directory, 'repository-media.json'), JSON.stringify({ schemaVersion: 1, files: [lock] }));
  let requests = 0;
  const fetcher = (async () => { requests++; return new Response(new Uint8Array(bytes)); }) as typeof fetch;
  assert.deepEqual(await pullMedia(directory, 'docs/readme', fetcher), { selected: 1 });
  await pullMedia(directory, undefined, fetcher); assert.equal(requests, 1);
  assert.deepEqual(await readFile(path.join(directory, lock.path)), bytes);
  await assert.rejects(downloadMedia(lock, (async () => new Response(new Uint8Array(Buffer.alloc(129)))) as typeof fetch), /exceeds/);
  await assert.rejects(downloadMedia(lock, (async () => new Response(new Uint8Array(Buffer.alloc(128)))) as typeof fetch), /SHA-256/);
  await rm(path.join(directory, lock.path));
  await symlink(path.join(directory, 'repository-media.json'), path.join(directory, lock.path));
  await assert.rejects(pullMedia(directory, undefined, fetcher), /symlinks/);
});

for (const oversized of [false, true]) test(`a real cleanup commit passes policy and Squash excludes raw media (over-budget base: ${oversized})`, async t => {
  const directory = await isolated(t), f = fixture(16 * 1024);
  git(directory, ['-c', 'init.templateDir=', 'init', '-b', 'main']);
  git(directory, ['config', 'user.name', 'Contributor']); git(directory, ['config', 'user.email', 'contributor@example.invalid']);
  const write = async (name: string, bytes: Buffer) => { await mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await writeFile(path.join(directory, name), bytes); };
  // The base already has the template; the contributor adds its final media in the PR.
  for (const [name, bytes] of f.contents) if (name !== f.video) await write(name, bytes);
  git(directory, ['add', '.']);
  if (oversized) {
    await write('obsolete.txt', Buffer.alloc(16 * 1024, 43)); git(directory, ['add', 'obsolete.txt']);
    await write('shared.bin', Buffer.alloc(1024 * 1024, 42)); git(directory, ['add', 'shared.bin']);
    const oid = git(directory, ['rev-parse', ':shared.bin']);
    for (let index = 0; index < 128; index++)
      git(directory, ['update-index', '--add', '--cacheinfo', '100644', oid, `copy-${index}.bin`]);
  }
  git(directory, ['commit', '-qm', 'Template source']);
  const base = git(directory, ['rev-parse', 'HEAD']);
  git(directory, ['checkout', '-qb', 'contribution']);
  if (oversized) git(directory, ['rm', 'obsolete.txt']);
  await write(f.video, f.bytes); git(directory, ['add', f.video]); git(directory, ['commit', '-qm', 'Add reviewed reference']);
  const original = git(directory, ['rev-parse', 'HEAD']), rawOID = git(directory, ['rev-parse', 'HEAD:' + f.video]);
  const plan = await prepareMediaCleanup({ ...f.inputs(), sourceSHA: original }, f.read);
  const commit = await commitCleanup(plan, async (args, input) => git(directory, args, input), directory, { login: 'Maintainer', id: 123 }, base);
  const storage = checkRepositoryStorage(directory, base, { finalTreeOnly: true });
  assert.deepEqual(storage.errors, []);
  if (oversized) assert(storage.gitBytes > 128 * 1024 * 1024);
  assert.equal(git(directory, ['rev-parse', commit + '^']), original);
  git(directory, ['update-ref', 'refs/heads/contribution', commit]);
  git(directory, ['reset', '--hard', commit]);
  git(directory, ['checkout', 'main']); git(directory, ['merge', '--squash', 'contribution']); git(directory, ['commit', '-qm', 'Accept original contribution']);
  assert.equal(git(directory, ['rev-parse', 'HEAD^']), base);
  assert(!git(directory, ['rev-list', '--objects', 'main']).split('\n').some(line => line.startsWith(rawOID)), 'Raw PR media must not be reachable from main');
  assert.equal(git(directory, ['show', original + ':library/templates/catalog/motion-demo/template.json']).includes('Demo'), true);
});

test('cleanup accepts a large final checkout with an advisory size warning', async t => {
  const directory = await isolated(t), f = fixture(16 * 1024);
  git(directory, ['-c', 'init.templateDir=', 'init', '-b', 'main']);
  git(directory, ['config', 'user.name', 'Contributor']); git(directory, ['config', 'user.email', 'contributor@example.invalid']);
  for (const [name, bytes] of f.contents) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    if (name !== f.video) await writeFile(path.join(directory, name), bytes);
  }
  git(directory, ['add', '.']); git(directory, ['commit', '-qm', 'Template source']);
  const base = git(directory, ['rev-parse', 'HEAD']);
  await writeFile(path.join(directory, f.video), f.bytes);
  await writeFile(path.join(directory, 'shared.bin'), Buffer.alloc(1024 * 1024, 42));
  git(directory, ['add', f.video, 'shared.bin']);
  const oid = git(directory, ['rev-parse', ':shared.bin']);
  for (let index = 0; index < 128; index++)
    git(directory, ['update-index', '--add', '--cacheinfo', '100644', oid, `copy-${index}.bin`]);
  git(directory, ['commit', '-qm', 'Add media and ordinary files']);
  const original = git(directory, ['rev-parse', 'HEAD']);
  const plan = await prepareMediaCleanup({ ...f.inputs(), sourceSHA: original }, f.read);
  let created = false;
  const commit = await commitCleanup(plan, async (args, input) => {
    if (args.includes('commit-tree')) created = true;
    return git(directory, args, input);
  }, directory, { login: 'Maintainer', id: 123 }, base);
  assert.equal(created, true);
  assert.equal(git(directory, ['rev-parse', commit + '^']), original);
  const storage = checkRepositoryStorage(directory, base, { finalTreeOnly: true });
  assert.deepEqual(storage.errors, []);
  assert.match(storage.warnings.join('\n'), /checkout exceeds 128 MiB/);
});

test('fork write access and workflow trust are checked before any media transfer', async t => {
  const oldActions = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'false';
  t.after(() => { if (oldActions === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = oldActions; });
  const old = process.env.OPENMOTION_MEDIA_MAINTAINER_TOKEN;
  process.env.OPENMOTION_MEDIA_MAINTAINER_TOKEN = 'test-token';
  t.after(() => { if (old === undefined) delete process.env.OPENMOTION_MEDIA_MAINTAINER_TOKEN; else process.env.OPENMOTION_MEDIA_MAINTAINER_TOKEN = old; });
  const f = fixture();
  t.mock.method(globalThis, 'fetch', async input => {
    const url = String(input);
    if (url.endsWith('/pulls/42')) return Response.json({ state: 'open', draft: false, base: { ref: 'main', sha: 'b'.repeat(40) }, head: { sha: sourceSHA, repo: { full_name: 'contributor/fork' } }, maintainer_can_modify: false });
    if (url.endsWith('/openmotion')) return Response.json({ permissions: { push: true }, allow_squash_merge: true });
    if (url.includes('/git/trees/')) return Response.json({ tree: url.includes(sourceSHA) ? f.tree() : [] });
    const file = f.tree().find(file => url.endsWith('/git/blobs/' + file.sha));
    assert(file, 'No storage or other API call is allowed before fork authorization: ' + url);
    return new Response(new Uint8Array(await f.read(file)));
  });
  await assert.rejects(preparePullRequest(42, true), /Allow edits by maintainers/);
});

test('ordinary fork PRs skip uploads and cleanup without requiring contributor edit permission', async t => {
  const directory = await isolated(t), output = path.join(directory, 'output');
  await writeFile(output, '');
  const before = { actions: process.env.GITHUB_ACTIONS, token: process.env.OPENMOTION_MEDIA_MAINTAINER_TOKEN, output: process.env.GITHUB_OUTPUT };
  process.env.GITHUB_ACTIONS = 'false';
  process.env.OPENMOTION_MEDIA_MAINTAINER_TOKEN = 'test-token';
  process.env.GITHUB_OUTPUT = output;
  t.after(() => {
    for (const [key, value] of Object.entries({ GITHUB_ACTIONS: before.actions, OPENMOTION_MEDIA_MAINTAINER_TOKEN: before.token, GITHUB_OUTPUT: before.output })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  t.mock.method(globalThis, 'fetch', async input => {
    const url = String(input);
    if (url.endsWith('/pulls/42')) return Response.json({ state: 'open', draft: false, base: { ref: 'main', sha: 'b'.repeat(40) }, head: { sha: sourceSHA, repo: { full_name: 'contributor/fork' } }, maintainer_can_modify: false });
    if (url.endsWith('/openmotion')) return Response.json({ permissions: { push: true }, allow_squash_merge: true });
    assert(url.includes('/git/trees/'), 'No media download, upload or cleanup write is allowed: ' + url);
    return Response.json({ tree: url.includes(sourceSHA) ? [{ path: 'server.ts', mode: '100644', sha: 'c'.repeat(40), size: 100, type: 'blob' }] : [] });
  });
  const plan = await preparePullRequest(42, true);
  assert.equal(plan.media.length, 0);
  assert.equal(plan.changes.length, 0);
  assert.equal(await readFile(output, 'utf8'), `head_sha=${sourceSHA}\n`);
});

function mergeState() {
  const page = (nodes: any[]) => ({ nodes, pageInfo: { hasNextPage: false } });
  return { state: 'OPEN', isDraft: false, baseRefName: 'main', headRefOid: sourceSHA, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED',
    labels: page([]), latestReviews: page([{ state: 'APPROVED' }]), reviewThreads: page([]),
    commits: { nodes: [{ commit: { oid: sourceSHA, statusCheckRollup: { contexts: page([
      { name: 'standalone', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'controls', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ]) } } }] } };
}

test('the merge entry waits for new-head CI and then sends only a SHA-guarded Squash merge', async () => {
  let polls = 0, merges = 0, waits = 0;
  await mergePreparedPullRequest(42, sourceSHA, { token: 'test-token', wait: async () => { waits++; },
    request: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/graphql')) {
        const pr = mergeState();
        if (++polls === 1) pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes.pop();
        return Response.json({ data: { repository: { pullRequest: pr } } });
      }
      assert.equal(url, 'https://api.github.com/repos/nexu-io/openmotion/pulls/42/merge');
      assert.equal(init?.method, 'PUT');
      assert.deepEqual(JSON.parse(String(init.body)), { merge_method: 'squash', sha: sourceSHA });
      merges++;
      return Response.json({ merged: true });
    },
  });
  assert.equal(polls, 2); assert.equal(waits, 1); assert.equal(merges, 1);
});

test('merge guards stop changed PRs, failed checks, requested changes, conflicts and holds without any merge write', async () => {
  const scenarios: [string, (pr: any) => void, RegExp][] = [
    ['contributor push', pr => { pr.headRefOid = 'b'.repeat(40); }, /changed after preparation/],
    ['wrong check SHA', pr => { pr.commits.nodes[0].commit.oid = 'b'.repeat(40); }, /prepared commit/],
    ['CI failure', pr => { pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].conclusion = 'FAILURE'; }, /CI failed/],
    ['change request', pr => { pr.latestReviews.nodes = [{ state: 'CHANGES_REQUESTED' }]; }, /requested changes/],
    ['conflict', pr => { pr.mergeable = 'CONFLICTING'; }, /conflicts/],
    ['hold', pr => { pr.labels.nodes = [{ name: 'do-not-merge' }]; }, /hold/],
    ['closed', pr => { pr.state = 'CLOSED'; }, /no longer open/],
  ];
  for (const [name, change, expected] of scenarios) {
    const pr = mergeState(); change(pr);
    await assert.rejects(mergePreparedPullRequest(42, sourceSHA, { token: 'test-token', request: async input => {
      assert(String(input).endsWith('/graphql'), name + ' must not write');
      return Response.json({ data: { repository: { pullRequest: pr } } });
    } }), expected, name);
  }
});

test('unresolved threads and renewed review wait; timeout leaves the PR open', async () => {
  const pr = mergeState();
  pr.reviewThreads.nodes = [{ isResolved: false }];
  assert.equal(preparedMergeStatus(pr, sourceSHA), 'waiting');
  pr.reviewThreads.nodes = []; pr.reviewDecision = 'REVIEW_REQUIRED';
  assert.equal(preparedMergeStatus(pr, sourceSHA), 'waiting');
  let clock = 0;
  await assert.rejects(mergePreparedPullRequest(42, sourceSHA, { token: 'test-token', timeout: 20, now: () => clock,
    wait: async () => { clock += 25; }, request: async input => {
      assert(String(input).endsWith('/graphql'), 'Unreviewed PR must not merge');
      return Response.json({ data: { repository: { pullRequest: pr } } });
    },
  }), /Timed out/);
});

test('media preparation and merging are maintainer-dispatched and storage credentials never reach the merge job', async () => {
  const workflow = await readFile(new URL('../.github/workflows/prepare-pr-media.yml', import.meta.url), 'utf8');
  const triggers = workflow.split('\npermissions:')[0];
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /(?:^|\n)  (?:push|pull_request|pull_request_target|pull_request_review|merge_group):/);
  const merge = workflow.split('\n  merge:\n')[1];
  assert(merge.includes('needs: prepare') && merge.includes('needs.prepare.outputs.head_sha'));
  assert(!merge.includes('CLOUDFLARE_R2') && !merge.includes('AWS_'));
  assert(merge.includes("github.ref == 'refs/heads/main'"));
  assert(workflow.includes('ref: ${{ github.sha }}'));
  const result = spawnSync(process.execPath, ['scripts/merge-prepared-pr.ts', '42', sourceSHA], {
    encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /maintainer-started workflow/);
});
