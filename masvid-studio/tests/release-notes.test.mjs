import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { candidateFixture } from './release-fixture.mjs';
import { publishReleaseNotes, prepareCandidateNotes } from '../.github/scripts/motion-release-notes.mjs';
import { sha256 } from '../scripts/runtime-assets.mjs';

async function fixture(t, version = '0.6.8') {
  const f = await candidateFixture(t, 'main', { version });
  await writeFile(path.join(f.directory, 'release-attempt.json'), JSON.stringify({ version, runId: f.env.GITHUB_RUN_ID, stage: `${f.inputs.channel}-entry-verified` }));
  let release, tagSource;
  const writes = [], env = { ...f.env, GH_TOKEN: 'fixture', MOTION_EXPECTED_SHA256: f.candidate.tgzSHA256, MOTION_INSTALL_PUBLIC_ORIGIN: 'https://download.example.invalid' };
  const fetcher = async (url, init) => {
    assert(String(url).startsWith('https://api.github.com/repos/nexu-io/openmotion/'));
    assert.equal(init.headers.Authorization, 'Bearer fixture');
    const route = new URL(url).pathname.split('/openmotion')[1], data = init.body && JSON.parse(init.body);
    if (init.method !== 'GET') writes.push({ route, method: init.method, data });
    if (route.startsWith('/git/ref/')) return tagSource ? Response.json({ object: { type: 'commit', sha: tagSource } }) : new Response('', { status: 404 });
    if (route === '/releases' && init.method === 'GET') return Response.json([...(release ? [release] : []), { draft: false, prerelease: false, tag_name: 'v0.6.7' }]);
    if (route === '/releases/generate-notes') return Response.json({ body: '## Changes\n\n* Fix installation (#1)' });
    if (route === '/releases' && init.method === 'POST') { release = { ...data, id: 7, html_url: 'https://github.com/nexu-io/openmotion/releases/tag/v' + version }; return Response.json(release); }
    if (route === '/releases/7' && init.method === 'PATCH') { release = { ...release, ...data }; tagSource = f.candidate.sourceCommit; return Response.json(release); }
    throw Error('Unexpected GitHub request: ' + init.method + ' ' + route);
  };
  return { ...f, env, fetcher, writes, getRelease: () => release, changeRelease: patch => { release = { ...release, ...patch }; }, setTag: sha => { tagSource = sha; } };
}

for (const [version, prefix, prerelease] of [['0.6.8', 'open-motion', false], ['0.6.8-test.14', 'open-motion/dev', true]]) {
  test(`${version} notes publish an exact-source draft only after verified npm/snapshots`, async t => {
    const f = await fixture(t, version);
    const record = await publishReleaseNotes(f.directory, f);
    assert.equal(record.status, 'published'); assert.equal(record.sourceCommit, f.candidate.sourceCommit);
    const create = f.writes.find(w => w.route === '/releases' && w.method === 'POST').data;
    assert.equal(create.target_commitish, f.candidate.sourceCommit); assert.equal(create.draft, true); assert.equal(create.prerelease, prerelease);
    assert(create.body.includes(`/${prefix}/${version}/install.md`) && create.body.includes(f.candidate.tgzSHA256));
    assert(create.body.includes('real Agent creation and human audiovisual acceptance are separate'));
    assert(!f.writes.some(w => w.route === '/releases/generate-notes'), 'New candidates reuse their frozen draft');
    assert(create.body.includes('Frozen candidate changes'));
    const original = await readFile(path.join(f.directory, 'release-notes.md'), 'utf8');
    assert.equal(f.writes.at(-1).data.make_latest, prerelease ? 'false' : 'true');
    const count = f.writes.length;
    f.changeRelease({ body: f.getRelease().body + '\nMaintainer edit\n' });
    await publishReleaseNotes(f.directory, f);
    assert.equal(f.writes.length, count, 'Published releases are not overwritten on retry');
    assert.equal(await readFile(path.join(f.directory, 'release-notes.md'), 'utf8'), original, 'Sealed notes remain immutable across publication and retries');
    assert((await readFile(path.join(f.directory, 'github-release-notes.md'), 'utf8')).includes('Maintainer edit'));
  });
}

test('wrong tags, incomplete snapshots, recovery and a changed candidate cannot create release notes', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'release-attempt.json'), JSON.stringify({ version: f.candidate.version, runId: f.env.GITHUB_RUN_ID, stage: 'archive-started' }));
  await assert.rejects(publishReleaseNotes(f.directory, f), /verify snapshots/); assert.equal(f.writes.length, 0);
  await writeFile(path.join(f.directory, 'release-attempt.json'), JSON.stringify({ version: f.candidate.version, runId: f.env.GITHUB_RUN_ID, stage: 'archived-superseded' }));
  f.setTag('f'.repeat(40));
  await assert.rejects(publishReleaseNotes(f.directory, f), /another source/); assert.equal(f.writes.length, 0);
  f.setTag(undefined);
  await publishReleaseNotes(f.directory, f);
  assert.equal(f.writes.at(-1).data.make_latest, 'false', 'An older completion cannot replace the latest GitHub release');
  f.changeRelease({ body: 'Unrelated manual release' });
  const count = f.writes.length;
  await assert.rejects(publishReleaseNotes(f.directory, f), /another candidate/); assert.equal(f.writes.length, count);
  await assert.rejects(publishReleaseNotes(f.directory, { ...f, env: { ...f.env, MOTION_RELEASE_ACTION: 'archive-only' } }), /recovery/);
  await writeFile(path.join(f.directory, 'candidate-install.md'), 'changed');
  await assert.rejects(publishReleaseNotes(f.directory, f), /Candidate file changed/);
});

test('a failed final publish resumes the matching draft without generating or creating it twice', async t => {
  const f = await fixture(t);
  const fetcher = async (url, init) => init.method === 'PATCH' ? new Response('', { status: 503 }) : f.fetcher(url, init);
  await assert.rejects(publishReleaseNotes(f.directory, { ...f, fetcher }), /HTTP 503/);
  assert.equal(f.getRelease().draft, true);
  const count = f.writes.length;
  await publishReleaseNotes(f.directory, f);
  assert.equal(f.writes.length, count + 1);
  assert.equal(f.writes.at(-1).method, 'PATCH');
  assert.equal(f.getRelease().draft, false);
});

test('GitHub Release writing is isolated from npm/R2 and never runs for archive-only recovery', async () => {
  const workflow = await readFile(new URL('../.github/workflows/motion-publish-test.yml', import.meta.url), 'utf8');
  const [before, notes] = workflow.split('\n  release-notes:\n');
  assert(notes.includes('needs: [verify, snapshot, stable-snapshot]') && notes.includes('inputs.archive_only != true'));
  assert(notes.includes("needs.snapshot.result == 'success'") && notes.includes("needs.stable-snapshot.result == 'success'"));
  assert(notes.includes('contents: write') && notes.includes('continue-on-error: true'));
  assert(!before.includes('contents: write'));
  assert(!/id-token:|secrets\.|secrets:|npm publish|dist-tag add/.test(notes));
  assert(notes.includes('artifact-ids: ${{ needs.verify.outputs.artifact_id }}'));
  assert(notes.includes('needs.snapshot.outputs.artifact_id || needs.stable-snapshot.outputs.artifact_id'));
  const recovery = await readFile(new URL('../.github/workflows/motion-publication-recovery.yml', import.meta.url), 'utf8');
  assert(recovery.includes('contents: write') && recovery.includes('archive_only: true'), 'The reusable caller must permit the conditional Release job without running it');
});

for (const version of ['0.6.8', '0.6.8-test.14']) test(`${version} candidate notes use read-only exact-source history and the same-channel baseline`, async t => {
  const f = await fixture(t, version), source = f.candidate.sourceCommit, base = 'a'.repeat(40);
  await rm(path.join(f.build, 'release-notes.md'));
  const previous = version.includes('-test.') ? 'v0.6.8-test.13' : 'v0.6.7';
  const calls = [];
  const commits = Array.from({ length: 101 }, (_, i) => ({ sha: (i + 1).toString(16).padStart(40, '0'), commit: { message: i === 0 ? 'Fix ![external](https://bad.invalid) <script> (#447)\nprivate body is excluded' : `Change ${i}` } }));
  const body = await prepareCandidateNotes(f.build, { env: { MOTION_VERSION: version, MOTION_SOURCE_SHA: source }, fetcher: async (url, init) => {
    assert.equal(init.method, 'GET'); assert(!init.headers.Authorization); calls.push(String(url));
    if (url.includes('/contents/')) return new Response('', { status: 404 });
    if (url.includes('/releases?')) return Response.json([
      { tag_name: 'v0.6.8-test.13', prerelease: true, draft: false }, { tag_name: 'v0.6.7', prerelease: false, draft: false },
      { tag_name: 'v0.6.8-test.99', prerelease: true, draft: true }, { tag_name: 'v0.6.9', prerelease: false, draft: false }]);
    if (url.includes('/git/ref/')) { assert(url.endsWith(previous)); return Response.json({ object: { type: 'tag', sha: 'c'.repeat(40) } }); }
    if (url.includes('/git/tags/')) return Response.json({ object: { type: 'commit', sha: base } });
    assert(url.includes(`/compare/${base}...${source}?`));
    return Response.json({ status: 'ahead', total_commits: 101, commits: new URL(url).searchParams.get('page') === '1' ? commits.slice(0, 100) : commits.slice(100) });
  } });
  assert(body.includes(`Baseline: ${previous} (${base})`)); assert(body.includes('Change 100'));
  assert(!body.includes('private body is excluded') && !body.includes('![external]') && !body.includes('<script>'));
  assert(body.includes('NOT PROVIDED') && body.includes(f.candidate.tgzSHA256));
  assert.equal(calls.filter(url => url.includes('/compare/')).length, 2);
  await assert.rejects(prepareCandidateNotes(f.build, { env: { MOTION_VERSION: '0.6.9', MOTION_SOURCE_SHA: source } }), /strictly equal/);
});

test('first-channel notes disclose their bounded history; API failures never write a misleading draft', async t => {
  const f = await fixture(t); await rm(path.join(f.build, 'release-notes.md'));
  const env = { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit };
  await assert.rejects(prepareCandidateNotes(f.build, { env, fetcher: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(readFile(path.join(f.build, 'release-notes.md')), { code: 'ENOENT' });
  const body = await prepareCandidateNotes(f.build, { env, fetcher: async (url, init) => {
    assert.equal(init.method, 'GET');
    if (url.includes('/contents/')) return new Response('', { status: 404 });
    if (url.includes('/releases?')) return Response.json([]);
    assert(url.includes(`sha=${f.candidate.sourceCommit}`)); return Response.json([]);
  } });
  assert(body.includes('not a complete release delta') && body.includes('Baseline: not available'));
  assert(!body.includes('No source commits since the baseline.'), 'No baseline is not proof of an empty release delta');
});

test('diverged or truncated comparison data is explicitly rejected or disclosed', async t => {
  const f = await fixture(t, '0.6.4-test.99'); await rm(path.join(f.build, 'release-notes.md'));
  const env = { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit };
  let status = 'diverged', pages = 0;
  const fetcher = async url => {
    if (url.includes('/releases?')) return Response.json([{ tag_name: 'v0.6.4-test.98', prerelease: true }]);
    if (url.includes('/git/ref/')) return Response.json({ object: { type: 'commit', sha: 'a'.repeat(40) } });
    pages++; return Response.json({ status, total_commits: 1001, commits: Array.from({ length: 100 }, (_, i) => ({ sha: (pages * 100 + i).toString(16).padStart(40, '0'), commit: { message: 'A change' } })) });
  };
  await assert.rejects(prepareCandidateNotes(f.build, { env, fetcher }), /ancestor/);
  status = 'ahead'; pages = 0;
  const truncated = await prepareCandidateNotes(f.build, { env, fetcher });
  assert(truncated.includes('first 1,000 of 1,001 compared commits'));
});

test('a comparison page the endpoint returns short is disclosed instead of failing the build', async t => {
  const f = await fixture(t, '0.6.4-test.99');
  const env = { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit }, base = 'a'.repeat(40);
  // Simulate unexpectedly short/empty pages despite a larger declared delta.
  for (const [available, total] of [[250, 300], [300, 350]]) {
    await rm(path.join(f.build, 'release-notes.md'), { force: true });
    const calls = [];
    const fetcher = async url => {
      if (url.includes('/releases?')) return Response.json([{ tag_name: 'v0.6.4-test.98', prerelease: true }]);
      if (url.includes('/git/ref/')) return Response.json({ object: { type: 'commit', sha: base } });
      const page = Number(new URL(url).searchParams.get('page')); calls.push(page);
      const first = (page - 1) * 100;
      return Response.json({ status: 'ahead', total_commits: total, commits: Array.from({ length: Math.max(0, Math.min(100, available - first)) },
        (_, i) => ({ sha: (first + i + 1).toString(16).padStart(40, '0'), commit: { message: `Change ${first + i}` } })) });
    };
    const body = await prepareCandidateNotes(f.build, { env, fetcher });
    assert(body.includes(`Only the first ${available} of ${total} compared commits are shown; inspect the full comparison.`));
    assert(body.includes(`[Full source comparison/history](https://github.com/nexu-io/openmotion/compare/${base}...${f.candidate.sourceCommit})`));
    assert.equal((body.match(/^- Change /gm) ?? []).length, available, 'Truncated ranges must not repeat rows');
    assert.equal(calls.length, Math.ceil(available / 100) + (available % 100 === 0 ? 1 : 0), 'Stop at the first page the endpoint cannot extend');
  }
});

test('older schema-2 candidates retain generated publication notes without inventing a sealed draft', async t => {
  const f = await fixture(t);
  f.candidate.schemaVersion = 2; delete f.candidate.files['release-notes.md'];
  await writeFile(path.join(f.directory, 'candidate.json'), JSON.stringify(f.candidate));
  await rm(path.join(f.directory, 'release-notes.md'));
  await publishReleaseNotes(f.directory, f);
  assert(f.writes.some(write => write.route === '/releases/generate-notes'));
  assert((await readFile(path.join(f.directory, 'github-release-notes.md'), 'utf8')).includes('Fix installation (#1)'));
});

test('notes are sealed before upload, displayed in the summary and never require candidate write permissions', async () => {
  const build = await readFile(new URL('../.github/workflows/motion-candidate.yml', import.meta.url), 'utf8');
  assert(build.includes('permissions:\n  contents: read') && !build.includes('contents: write') && !build.includes('id-token:'));
  const prepare = build.indexOf('motion-release-notes.mjs prepare'), seal = build.indexOf('motion-release.mjs seal');
  assert(prepare > build.indexOf('motion-scan.mjs package') && prepare < seal && seal < build.indexOf('actions/upload-artifact'));
  assert(build.includes("/candidate/release-notes.md") && build.includes('Candidate release notes (unpublished)'));
});

function noteResponse(filename, text) {
  const bytes = Buffer.from(text);
  return Response.json({ type: 'file', path: filename, encoding: 'base64', size: bytes.length, content: bytes.toString('base64') });
}

test('the prepared 0.0.1 descriptions are selected from the exact candidate source', async t => {
  const f = await fixture(t, '0.0.1'); await rm(path.join(f.build, 'release-notes.md'));
  const body = await prepareCandidateNotes(f.build, { env: { MOTION_VERSION: '0.0.1', MOTION_SOURCE_SHA: f.candidate.sourceCommit }, fetcher: async url => {
    const parsed = new URL(url), filename = parsed.pathname.split('/contents/')[1];
    assert.equal(parsed.searchParams.get('ref'), f.candidate.sourceCommit);
    assert(filename.startsWith('docs/CHANGELOG/v0.0.1/'));
    return noteResponse(filename, await readFile(new URL('../' + filename, import.meta.url), 'utf8'));
  } });
  assert(body.includes('# OpenMotion 0.0.1') && body.includes('templates: prod'));
  assert(body.includes('## English') && body.includes('## 简体中文'));
  assert(body.includes('@openmotion/app@0.0.1') && body.includes('0.6.x'));
  assert(body.includes(f.candidate.tgzSHA256));
});

for (const [version, previous] of [['0.0.1', 'v0.6.7'], ['0.0.2', 'v0.0.1']]) test(`${version} automatic notes select the previous publication series correctly`, async t => {
  const f = await fixture(t, version); await rm(path.join(f.build, 'release-notes.md'));
  const base = 'a'.repeat(40);
  const body = await prepareCandidateNotes(f.build, { env: { MOTION_VERSION: version, MOTION_SOURCE_SHA: f.candidate.sourceCommit }, fetcher: async url => {
    if (url.includes('/contents/')) return new Response('', { status: 404 });
    if (url.includes('/releases?')) return Response.json(['v0.6.7', 'v0.0.1', 'v0.0.3'].map(tag_name => ({ tag_name, prerelease: false, draft: false })));
    if (url.includes('/git/ref/')) { assert(url.endsWith(previous)); return Response.json({ object: { type: 'commit', sha: base } }); }
    assert(url.includes(`/compare/${base}...${f.candidate.sourceCommit}`));
    return Response.json({ status: 'ahead', total_commits: 0, commits: [] });
  } });
  assert(body.includes(`Baseline: ${previous} (${base})`));
});

test('stable candidates freeze exact-source bilingual notes and publication reuses them unchanged', async t => {
  const f = await fixture(t);
  await rm(path.join(f.build, 'release-notes.md'));
  const calls = [], env = { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit };
  const body = await prepareCandidateNotes(f.build, { env, fetcher: async (url, init) => {
    assert.equal(init.method, 'GET');
    const parsed = new URL(url), filename = parsed.pathname.split('/contents/')[1];
    assert.equal(parsed.searchParams.get('ref'), f.candidate.sourceCommit);
    assert(filename.startsWith('docs/CHANGELOG/v0.6.8/')); calls.push(filename);
    return noteResponse(filename, '# OpenMotion 0.6.8\n\n## ' + (filename.endsWith('/en.md') ? 'Fixed\n\n- Restore Windows installation.' : '修复\n\n- 恢复 Windows 安装。'));
  } });
  assert.deepEqual(calls.sort(), ['docs/CHANGELOG/v0.6.8/en.md', 'docs/CHANGELOG/v0.6.8/zh-CN.md']);
  assert(body.includes('## English') && body.includes('## 简体中文') && body.includes('恢复 Windows 安装'));
  assert(body.includes(f.candidate.sourceCommit) && body.includes(f.candidate.tgzSHA256));
  assert(!body.includes('NOT PROVIDED') && !body.includes('automatic draft'));
  await writeFile(path.join(f.directory, 'release-notes.md'), body);
  f.candidate.files['release-notes.md'] = await sha256(path.join(f.directory, 'release-notes.md'));
  await writeFile(path.join(f.directory, 'candidate.json'), JSON.stringify(f.candidate));
  await publishReleaseNotes(f.directory, f);
  assert(f.getRelease().body.includes(body), 'Publication adds delivery links around the exact frozen notes');
  f.changeRelease({ body: f.getRelease().body + '\nMaintainer correction\n' });
  const count = f.writes.length;
  await publishReleaseNotes(f.directory, f);
  assert.equal(f.writes.length, count);
  assert.equal(await readFile(path.join(f.directory, 'release-notes.md'), 'utf8'), body);
});

test('missing stable copy warns and keeps the automatic draft; English-only copy warns without blocking', async t => {
  const f = await fixture(t);
  const warnings = []; t.mock.method(console, 'warn', message => warnings.push(message));
  const env = { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit };
  for (const english of [false, true]) {
    await rm(path.join(f.build, 'release-notes.md'), { force: true });
    const body = await prepareCandidateNotes(f.build, { env, fetcher: async url => {
      if (url.includes('/contents/')) {
        const filename = new URL(url).pathname.split('/contents/')[1];
        return english && filename.endsWith('/en.md') ? noteResponse(filename, '# OpenMotion 0.6.8\n\n## Known issues\n\nTemplate acceptance is pending.') : new Response('', { status: 404 });
      }
      assert(!english, 'Authored copy does not depend on mutable Release history');
      if (url.includes('/releases?')) return Response.json([]);
      return Response.json([]);
    } });
    assert(body.includes(english ? 'Template acceptance is pending.' : 'This is an automatic draft.'));
    assert(body.includes(english ? 'Simplified Chinese release notes have not been provided.' : 'NOT PROVIDED'));
  }
  assert.equal(warnings.length, 2);
  assert(warnings.every(message => message.startsWith('::warning title=Stable release notes missing::')));
});

test('invalid authored stable copy fails before sealing instead of silently using different content', async t => {
  const f = await fixture(t);
  await rm(path.join(f.build, 'release-notes.md'));
  const env = { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit };
  for (const invalid of ['version', 'empty', 'utf8', 'size', 'symlink', 'default-locale']) {
    await assert.rejects(prepareCandidateNotes(f.build, { env, fetcher: async url => {
      const filename = new URL(url).pathname.split('/contents/')[1];
      if (filename.endsWith('/zh-CN.md')) return noteResponse(filename, '# OpenMotion 0.6.8\n\n## 修复\n\n- 安装修复。');
      if (invalid === 'default-locale') return new Response('', { status: 404 });
      if (invalid === 'version') return noteResponse(filename, '# OpenMotion 0.6.9\n\nWrong version.');
      if (invalid === 'empty') return noteResponse(filename, '# OpenMotion 0.6.8\n');
      if (invalid === 'utf8') return noteResponse(filename, Buffer.from([0xff]));
      if (invalid === 'size') return Response.json({ type: 'file', path: filename, encoding: 'base64', size: 512 * 1024 + 1 });
      return Response.json({ type: 'symlink', path: filename });
    } }), /version|empty|encoded data|512 KiB|Invalid stable|require en.md/);
    await assert.rejects(readFile(path.join(f.build, 'release-notes.md')), { code: 'ENOENT' });
  }
  await assert.rejects(prepareCandidateNotes(f.build, { env, fetcher: async () => new Response('', { status: 403 }) }), /HTTP 403/);
});

test('the maintained bilingual drafts can be archived for an exact version without changing application bytes', async t => {
  const f = await fixture(t);
  await rm(path.join(f.build, 'release-notes.md'));
  const body = await prepareCandidateNotes(f.build, {
    env: { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit },
    fetcher: async url => {
      const filename = new URL(url).pathname.split('/contents/')[1], locale = path.basename(filename);
      const draft = await readFile(new URL('../docs/CHANGELOG/unreleased/' + locale, import.meta.url), 'utf8');
      assert(draft.startsWith('# OpenMotion Unreleased\n'));
      return noteResponse(filename, draft.replace('# OpenMotion Unreleased', '# OpenMotion 0.6.8'));
    },
  });
  assert(body.includes('## Highlights') && body.includes('## 亮点'));
  assert(body.includes('Known issues') && body.includes('已知问题'));
  assert.equal(await sha256(path.join(f.build, f.candidate.tgz)), f.candidate.tgzSHA256);
});

test('combined bilingual copy must fit the sealed candidate limit', async t => {
  const f = await fixture(t);
  await rm(path.join(f.build, 'release-notes.md'));
  await assert.rejects(prepareCandidateNotes(f.build, {
    env: { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit },
    fetcher: async url => {
      const filename = new URL(url).pathname.split('/contents/')[1], heading = '# OpenMotion 0.6.8\n\n';
      return noteResponse(filename, heading + 'x'.repeat(512 * 1024 - heading.length));
    },
  }), /Candidate notes exceed 1 MiB/);
  await assert.rejects(readFile(path.join(f.build, 'release-notes.md')), { code: 'ENOENT' });
});

for (const scenario of ['full-300', 'empty-page', 'repeated-page']) test(`comparison ${scenario} never duplicates rows or invents an empty release delta`, async t => {
  const f = await fixture(t, '0.6.8-test.14'); await rm(path.join(f.build, 'release-notes.md'));
  const env = { MOTION_VERSION: f.candidate.version, MOTION_SOURCE_SHA: f.candidate.sourceCommit };
  const commits = Array.from({ length: 300 }, (_, i) => ({ sha: (i + 1).toString(16).padStart(40, '0'), commit: { message: `Unique change ${i}` } }));
  let pages = 0;
  const body = await prepareCandidateNotes(f.build, { env, fetcher: async url => {
    if (url.includes('/releases?')) return Response.json([{ tag_name: 'v0.6.8-test.13', prerelease: true }]);
    if (url.includes('/git/ref/')) return Response.json({ object: { type: 'commit', sha: 'a'.repeat(40) } });
    const page = Number(new URL(url).searchParams.get('page')); pages++;
    const start = scenario === 'repeated-page' ? 0 : (page - 1) * 100;
    return Response.json({ status: 'ahead', total_commits: 300, commits: scenario === 'empty-page' ? [] : commits.slice(start, start + 100) });
  } });
  const count = { 'full-300': 300, 'empty-page': 0, 'repeated-page': 100 }[scenario];
  assert.equal((body.match(/^- Unique change /gm) || []).length, count);
  if (scenario === 'full-300') assert(!body.includes('compared commits are shown'));
  else assert(body.includes(`Only the first ${count} of 300 compared commits are shown`) && body.includes('Full source comparison/history'));
  assert(!body.includes('No source commits since the baseline.'));
  assert.equal(pages, { 'full-300': 3, 'empty-page': 1, 'repeated-page': 2 }[scenario]);
});
