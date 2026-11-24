import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInputs, verifyDownloaded, repository, releaseChannel, candidateNoteIdentity } from './motion-release.mjs';
import { sha256 } from '../../scripts/runtime-assets.mjs';
import { comparePublicationVersions } from '../../scripts/release-version.mjs';

function githubApi(env, fetcher) {
  return async (route, method = 'GET', data, allowMissing = false) => {
    const response = await fetcher(`https://api.github.com/repos/${repository}${route}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/vnd.github+json', ...(env.GH_TOKEN ? { Authorization: `Bearer ${env.GH_TOKEN}` } : {}), 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    if (allowMissing && response.status === 404) return null;
    assert(response.ok, `GitHub release ${method} ${route} failed: HTTP ${response.status}`);
    return response.json();
  };
}

async function listReleases(api) {
  const releases = [];
  for (let page = 1; ; page++) {
    assert(page <= 100, 'GitHub release history exceeds the bounded lookup');
    const batch = await api(`/releases?per_page=100&page=${page}`);
    assert(Array.isArray(batch), 'Invalid GitHub release list');
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return releases;
}

function previousRelease(releases, version, prerelease) {
  return releases.filter(r => !r.draft && r.prerelease === prerelease && /^v\d+\.\d+\.\d+(?:-test\.[1-9]\d*(?:\.[1-9]\d*)*)?$/.test(r.tag_name))
    .filter(r => comparePublicationVersions(r.tag_name.slice(1), version) < 0)
    .sort((a, b) => comparePublicationVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
}

export async function prepareCandidateNotes(directory, { env = process.env, fetcher = fetch } = {}) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'release-npm.json'), 'utf8'));
  const channel = releaseChannel(manifest.version), source = manifest.commit;
  assert.equal(manifest.version, env.MOTION_VERSION); assert.equal(source, env.MOTION_SOURCE_SHA);
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.equal(manifest.installer.url, `./openmotion-app-${manifest.version}.tgz`);
  assert.equal(await sha256(path.join(directory, manifest.installer.url)), manifest.installer.sha256);
  const api = githubApi(env, fetcher);
  const save = async content => {
    const body = `# OpenMotion ${manifest.version}\n\nChannel: ${channel}; templates: ${manifest.templateEnvironment}.\nSource: [${source}](https://github.com/${repository}/commit/${source}).\n\n${content}\n\n${candidateNoteIdentity({ version: manifest.version, sourceCommit: source, tgzSHA256: manifest.installer.sha256 })}\n`;
    assert(Buffer.byteLength(body) <= 1024 * 1024, 'Candidate notes exceed 1 MiB');
    await writeFile(path.join(directory, 'release-notes.md'), body, { flag: 'wx' });
    return body;
  };
  if (channel === 'stable') {
    const locales = ['en', 'zh-CN'];
    const entries = await Promise.all(locales.map(async locale => {
      const filename = `docs/CHANGELOG/v${manifest.version}/${locale}.md`;
      const file = await api(`/contents/${filename}?ref=${source}`, 'GET', undefined, true);
      if (!file) return null;
      assert(file.type === 'file' && file.path === filename && file.encoding === 'base64', 'Invalid stable release note file: ' + filename);
      assert(Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 512 * 1024, 'Stable release note exceeds 512 KiB: ' + filename);
      const bytes = Buffer.from(file.content, 'base64');
      assert.equal(bytes.length, file.size, 'Stable release note size mismatch');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
      assert.equal(text.split(/\r?\n/, 1)[0], `# OpenMotion ${manifest.version}`, 'Stable release note heading must match its exact version');
      const content = text.slice(text.indexOf('\n') + 1).trim();
      assert(text.includes('\n') && content, 'Stable release note body is empty');
      return `## ${locale === 'en' ? 'English' : '简体中文'}\n\n[Source](https://github.com/${repository}/blob/${source}/${filename})\n\n${content}`;
    }));
    assert(entries[0] || !entries[1], 'Stable release notes require en.md when zh-CN.md is provided');
    if (!entries[0] || !entries[1]) console.warn(`::warning title=Stable release notes missing::${!entries[0] ? 'No exact-version stable notes; using an automatic draft.' : 'zh-CN.md is missing; using the English notes only.'}`);
    if (entries[0]) return save(entries.filter(Boolean).join('\n\n') + (!entries[1] ? '\n\n> Simplified Chinese release notes have not been provided.' : ''));
  }
  const previous = previousRelease(await listReleases(api), manifest.version, channel === 'test');
  let base, commits, link, warning = '';
  if (previous) {
    let object = (await api(`/git/ref/tags/${previous.tag_name}`)).object;
    for (let depth = 0; object.type === 'tag' && depth < 5; depth++) object = (await api(`/git/tags/${object.sha}`)).object;
    assert.equal(object.type, 'commit'); assert.match(object.sha, /^[a-f0-9]{40}$/); base = object.sha;
    link = `https://github.com/${repository}/compare/${base}...${source}`;
    commits = [];
    const seen = new Set();
    let total = 0, truncated = false;
    for (let page = 1; page <= 10; page++) {
      const compared = await api(`/compare/${base}...${source}?per_page=100&page=${page}`);
      assert(['ahead', 'identical'].includes(compared.status), 'Published baseline must be an ancestor of the selected source');
      assert(Array.isArray(compared.commits) && Number.isSafeInteger(compared.total_commits) && compared.total_commits >= 0, 'Invalid comparison metadata');
      total = compared.total_commits;
      const fresh = compared.commits.filter(commit => {
        if (seen.has(commit.sha)) return false;
        seen.add(commit.sha); return true;
      });
      commits.push(...fresh);
      if (commits.length >= total) break;
      // A short or repeated page is incomplete evidence, not a candidate-build failure.
      truncated = compared.commits.length < 100 || fresh.length !== compared.commits.length || page === 10;
      if (truncated) break;
    }
    if (truncated) warning = `Only the first ${commits.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} compared commits are shown; inspect the full comparison.`;
  } else {
    // First-channel history is bounded; use the full-history link for older changes.
    commits = await api(`/commits?sha=${source}&per_page=100`);
    link = `https://github.com/${repository}/commits/${source}`;
    warning = 'No earlier GitHub Release exists in this channel. Showing up to 100 recent commits; this is not a complete release delta.';
  }
  assert(Array.isArray(commits));
  const escape = text => text.replace(/[\\`*_[\]<>]/g, '\\$&');
  const rows = commits.map(commit => {
    assert.match(commit.sha, /^[a-f0-9]{40}$/); assert.equal(typeof commit.commit?.message, 'string');
    const title = escape(commit.commit.message.split(/\r?\n/, 1)[0]);
    return `- ${title} ([${commit.sha.slice(0, 7)}](https://github.com/${repository}/commit/${commit.sha}))`;
  });
  return save(`${channel === 'stable' ? '> Maintainer-authored notes for this exact stable version are missing. This is an automatic draft.\n\n' : ''}Baseline: ${previous ? `${previous.tag_name} (${base})` : 'not available'}.\n\n## Changes\n\n${warning ? warning + '\n\n' : ''}${rows.join('\n') || (previous && !warning ? 'No source commits since the baseline.' : 'No complete commit list is available; inspect the full history/comparison.')}\n\n[Full source comparison/history](${link})\n\n## Acceptance focus\n\nNOT PROVIDED — maintainers record the required checks and actual results in their private acceptance.md copy. No acceptance is implied.\n\n## Known issues\n\nNOT PROVIDED — review before distribution; this does not mean there are no known issues. Maintainers may edit the published GitHub Release prose.`);
}

export async function publishReleaseNotes(directory, { env = process.env, fetcher = fetch } = {}) {
  const inputs = releaseInputs(env);
  assert.notEqual(inputs.action, 'archive-only', 'Snapshot recovery must not create GitHub releases');
  const candidate = await verifyDownloaded(directory, inputs.expectedSHA256, inputs.version);
  const attempt = JSON.parse(await readFile(path.join(directory, 'release-attempt.json'), 'utf8'));
  assert.equal(attempt.version, candidate.version); assert.equal(String(attempt.runId), env.GITHUB_RUN_ID);
  assert([`${inputs.channel}-entry-verified`, 'archived-superseded'].includes(attempt.stage), 'Publish npm and verify snapshots before release notes');
  assert(env.GH_TOKEN, 'Missing scoped GitHub release token');
  const origin = new URL(env.MOTION_INSTALL_PUBLIC_ORIGIN);
  assert(origin.protocol === 'https:' && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash);
  const api = githubApi(env, fetcher);
  const tag = 'v' + candidate.version, prerelease = inputs.channel === 'test';
  const marker = `<!-- openmotion source=${candidate.sourceCommit} sha256=${candidate.tgzSHA256} -->`;
  // Refuse an existing tag pointing at other bytes; never force or move a tag.
  const ref = await api(`/git/ref/tags/${tag}`, 'GET', undefined, true);
  if (ref) {
    let object = ref.object;
    for (let depth = 0; object.type === 'tag' && depth < 5; depth++) object = (await api(`/git/tags/${object.sha}`)).object;
    assert.equal(object.type, 'commit'); assert.equal(object.sha, candidate.sourceCommit, 'Release tag already identifies another source');
  }
  const releases = await listReleases(api);
  let release = releases.find(r => r.tag_name === tag);
  if (!release) {
    let changes;
    if (candidate.schemaVersion >= 3) changes = await readFile(path.join(directory, 'release-notes.md'), 'utf8');
    else {
      // Older sealed candidates have no draft; retain their existing publication behavior.
      const previous = previousRelease(releases, candidate.version, prerelease);
      const generated = await api('/releases/generate-notes', 'POST', {
        tag_name: tag, target_commitish: candidate.sourceCommit, ...(previous ? { previous_tag_name: previous.tag_name } : {}),
      });
      assert.equal(typeof generated.body, 'string', 'Missing generated release notes');
      changes = `${previous ? '' : 'This is the first GitHub Release in this channel; the generated changes may include earlier repository history.\n\n'}${generated.body}`;
    }
    const prefix = prerelease ? 'open-motion/dev' : 'open-motion';
    const body = `## Installation\n\n- [Exact ${candidate.version} installation](${origin.origin}/${prefix}/${candidate.version}/install.md)\n- [Current ${inputs.channel} installation](${origin.origin}/${prefix}/install.md)\n- npm: \`${candidate.packageName}@${candidate.version}\`; templates: **${prerelease ? 'DEV' : 'prod'}**.\n\n## Release identity\n\n- Source: [\`${candidate.sourceCommit}\`](https://github.com/${repository}/commit/${candidate.sourceCommit})\n- npm tgz SHA256: \`${candidate.tgzSHA256}\`\n- [Publication and verification](https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID})\n\n${prerelease ? 'Test installation checks run separately and may still be pending.' : 'Both exact-version macOS ARM64 and Windows x64 installation checks passed.'} Live templates, real Agent creation and human audiovisual acceptance are separate checks.\n\n${changes}\n\n${marker}\n`;
    await writeFile(path.join(directory, 'github-release-notes.md'), body);
    release = await api('/releases', 'POST', { tag_name: tag, target_commitish: candidate.sourceCommit, name: `OpenMotion ${candidate.version}`, body, draft: true, prerelease });
  }
  assert.equal(release.tag_name, tag); assert.equal(release.prerelease, prerelease);
  assert(release.body?.includes(marker), 'Existing release belongs to another candidate; preserve manual content');
  if (release.draft) {
    assert.equal(release.target_commitish, candidate.sourceCommit, 'Draft release targets another source');
    release = await api(`/releases/${release.id}`, 'PATCH', { draft: false,
      make_latest: !prerelease && attempt.stage !== 'archived-superseded' ? 'true' : 'false' });
  }
  assert.equal(release.draft, false); assert.equal(release.tag_name, tag); assert.equal(release.prerelease, prerelease);
  await writeFile(path.join(directory, 'github-release-notes.md'), release.body);
  const record = { version: candidate.version, sourceCommit: candidate.sourceCommit, tgzSHA256: candidate.tgzSHA256,
    publicationRun: env.GITHUB_RUN_ID, releaseId: release.id, url: release.html_url, tag, prerelease, status: 'published' };
  await writeFile(path.join(directory, 'github-release.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prepare = process.argv[2] === 'prepare';
  assert.equal(process.argv.length, prepare ? 4 : 3, 'Usage: motion-release-notes.mjs [prepare] <directory>');
  const result = prepare ? await prepareCandidateNotes(path.resolve(process.argv[3])) : await publishReleaseNotes(path.resolve(process.argv[2]));
  if (!prepare) console.log(JSON.stringify(result, null, 2));
}
