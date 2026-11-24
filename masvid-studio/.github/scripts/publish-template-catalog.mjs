import { loadLibrarySkills, assertSkillIds } from '../../shared/library-skill-catalog.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFile } from '../../scripts/runtime-assets.mjs';

export const publicOrigin = 'https://releases.open-design.ai';
export const catalogRoot = 'open-motion/templates';
const commitPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-test\.[1-9]\d*(?:\.[1-9]\d*)*)?$/;
const contentTypes = { '.css': 'text/css; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function safeRelative(value) {
  assert(typeof value === 'string' && value && !/[\\\x00-\x1f:]/.test(value) && !value.startsWith('/') && !/^[a-z]:/i.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe template path: ' + value);
}

function contentType(filename) { return contentTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream'; }

async function walk(directory, relative = '') {
  assert((await lstat(directory)).isDirectory(), 'Template directories must not be symbolic links: ' + relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    safeRelative(childRelative);
    const child = path.join(directory, entry.name);
    const info = await lstat(child);
    assert(!info.isSymbolicLink(), 'Template files must not be symbolic links: ' + childRelative);
    if (info.isDirectory()) files.push(...await walk(child, childRelative));
    else {
      assert(info.isFile(), 'Template entries must be regular files: ' + childRelative);
      const bytes = await readFile(child);
      assert(!bytes.subarray(0, 100).toString().startsWith('version https://git-lfs.github.com/spec/v1'), 'Fetch Git LFS template bytes before publishing: ' + childRelative);
      files.push({ relative: childRelative, absolute: child, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  return files;
}

async function validateCatalog(root) {
  const catalogDirectory = path.join(root, 'library/templates/catalog');
  const manifest = JSON.parse(await readFile(path.join(catalogDirectory, 'catalog.json'), 'utf8'));
  assert(manifest.schemaVersion === 1 && Array.isArray(manifest.templateIds) && manifest.templateIds.length > 0, 'Invalid repository template catalog');
  assert(new Set(manifest.templateIds).size === manifest.templateIds.length, 'Duplicate repository template ID');
  return { catalogDirectory, manifest };
}

export async function buildTemplatePublication(root, commit, { origin = publicOrigin, snapshotKey } = {}) {
  assert(commitPattern.test(commit), 'Require the full source commit SHA');
  const { catalogDirectory, manifest: sourceCatalog } = await validateCatalog(root);
  const prefix = snapshotKey || `${catalogRoot}/snapshots/${commit}`;
  const baseUrl = `${origin}/${prefix}`;
  const objectBaseUrl = `${origin}/${catalogRoot}/objects`;
  const staging = await mkdtemp(path.join(os.tmpdir(), 'openmotion-template-publication-'));
  const uploads = [];
  const objectFiles = new Map();
  try {
    for (const id of sourceCatalog.templateIds) {
      assert(/^[a-z][a-z0-9-]+$/.test(id), 'Invalid repository template ID: ' + id);
      const directory = path.join(catalogDirectory, id);
      const files = await walk(directory);
      const sourceFiles = [];
      for (const file of files) {
        if (!file.relative.startsWith('source/') || file.relative === 'source/manifest.json') {
          const key = `${prefix}/${id}/${file.relative}`;
          uploads.push({ key, body: file.absolute, contentType: contentType(file.relative), cache: 'public, max-age=31536000, immutable', immutable: true });
        }
        if (file.relative.startsWith('source/') && file.relative !== 'source/manifest.json') {
          const relative = file.relative.slice('source/'.length);
          sourceFiles.push({ path: relative, bytes: file.bytes, sha256: file.sha256 });
          objectFiles.set(file.sha256, file.absolute);
        }
      }
      const hostedManifest = { schemaVersion: 1, templateId: id, files: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)) };
      const hostedManifestPath = path.join(staging, `${id}-hosted-files.json`);
      await writeFile(hostedManifestPath, jsonBytes(hostedManifest));
      uploads.push({ key: `${prefix}/${id}/hosted-files.json`, body: hostedManifestPath, contentType: 'application/json; charset=utf-8', cache: 'public, max-age=31536000, immutable', immutable: true });
    }
    const skills = await loadLibrarySkills(root, false);
    assertSkillIds(skills, sourceCatalog.templateIds);
    // Skill supporting files share the content-addressed object store used by template sources.
    for (const skill of skills) {
      const files = await walk(path.join(root, 'library/skills', skill.id));
      skill.objects = files.map(file => ({ path: file.relative, bytes: file.bytes, sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path));
      for (const file of files) objectFiles.set(file.sha256, file.absolute);
    }
    for (const [sha256, body] of objectFiles) uploads.push({ key: `${catalogRoot}/objects/${sha256}`, body, contentType: contentType(body), cache: 'public, max-age=31536000, immutable', immutable: true, object: true });
    const catalog = { ...sourceCatalog, skills, commit, baseUrl, objectBaseUrl, hosted: { schemaVersion: 1, commit, source: 'openmotion-r2', baseUrl, objectBaseUrl } };
    const catalogPath = path.join(staging, 'catalog.json');
    await writeFile(catalogPath, jsonBytes(catalog));
    uploads.push({ key: `${prefix}/catalog.json`, body: catalogPath, contentType: 'application/json; charset=utf-8', cache: 'public, max-age=31536000, immutable', immutable: true });
    return { catalog, uploads, staging };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function validateStorageConfig({ endpoint, bucket, origin = publicOrigin }) {
  const api = new URL(endpoint), publicUrl = new URL(origin);
  assert(api.protocol === 'https:' && api.hostname.endsWith('.r2.cloudflarestorage.com') && api.pathname === '/' && !api.port && !api.username && !api.password && !api.search && !api.hash, 'Require an R2 S3 HTTPS origin');
  assert(publicUrl.protocol === 'https:' && !publicUrl.username && !publicUrl.password && !publicUrl.search && !publicUrl.hash && publicUrl.pathname === '/', 'Require a plain HTTPS public origin');
  assert(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || ''), 'Require the configured R2 bucket');
  return { endpoint: api.origin, bucket, origin: publicUrl.origin };
}

async function existingObjectKeys(run, storage) {
  const output = await run('aws', ['--endpoint-url', storage.endpoint, '--region', 'auto', 's3api', 'list-objects-v2', '--bucket', storage.bucket, '--prefix', `${catalogRoot}/objects/`, '--output', 'json'], { env: { ...process.env, AWS_PAGER: '', AWS_EC2_METADATA_DISABLED: 'true' } });
  if (!output.trim()) return new Set();
  const value = JSON.parse(output), keys = new Set((value.Contents || []).map(item => item.Key).filter(Boolean));
  return keys;
}

async function putObject(run, storage, upload, { immutable = false } = {}) {
  const args = ['--endpoint-url', storage.endpoint, '--region', 'auto', 's3api', 'put-object', '--bucket', storage.bucket, '--key', upload.key, '--body', upload.body, '--content-type', upload.contentType, '--cache-control', upload.cache];
  if (immutable) args.push('--if-none-match', '*');
  try {
    await run('aws', args, { env: { ...process.env, AWS_PAGER: '', AWS_EC2_METADATA_DISABLED: 'true' } });
  } catch (error) {
    if (!(immutable && /PreconditionFailed|\(412\)/.test(String(error)))) throw error;
  }
}

async function verifyPublic(fetcher, url, expected) {
  const response = await fetcher(url, { redirect: 'error', headers: { 'cache-control': 'no-cache', 'user-agent': 'OpenMotion-template-publisher' }, signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Public template catalog returned HTTP ${response.status}`);
  const actual = Buffer.from(await response.arrayBuffer());
  assert(actual.equals(expected), 'Public template catalog bytes differ');
}

async function uploadBatch(uploads, upload) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < uploads.length) await upload(uploads[cursor++]);
  };
  // Let pending uploads settle before the caller removes staged files on failure.
  const results = await Promise.allSettled(Array.from({ length: Math.min(12, uploads.length) }, worker));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}

export function releaseCatalogPromotion(version, publication) {
  assert.equal(publication.version, version, 'Template publication must match the verified release');
  assert(['verified', 'version-verified', 'superseded'].includes(publication.phase), 'Require completed release archival');
  return publication.phase === 'verified';
}

export async function publishTemplateCatalog(root, { mode = 'main', version, commit = process.env.GITHUB_SHA, endpoint, bucket, origin = publicOrigin, promote = true, run = runFile, fetcher = fetch } = {}) {
  assert(mode === 'main' || mode === 'release', 'Unknown template publication mode');
  if (mode === 'release') assert(versionPattern.test(version || ''), 'Invalid release version');
  const storage = validateStorageConfig({ endpoint, bucket, origin });
  assert(commitPattern.test(commit || ''), 'Require GITHUB_SHA or --commit with a full source SHA');
  const snapshotKey = `${catalogRoot}/snapshots/${commit}`;
  const publication = await buildTemplatePublication(root, commit, { origin: storage.origin, snapshotKey });
  try {
    const existing = await existingObjectKeys(run, storage);
    let uploaded = 0, reused = 0;
    await uploadBatch(publication.uploads.filter(item => item.object), async upload => {
      if (existing.has(upload.key)) { reused++; return; }
      await putObject(run, storage, upload, { immutable: true }); uploaded++;
    });
    await uploadBatch(publication.uploads.filter(item => !item.object), async upload => {
      await putObject(run, storage, upload, { immutable: true }); uploaded++;
    });
    const catalogBytes = jsonBytes(publication.catalog);
    const updatePointer = mode === 'main' || promote;
    const pointerKey = updatePointer ? `${catalogRoot}/${mode === 'main' ? 'main' : 'releases'}/catalog.json` : `${snapshotKey}/catalog.json`;
    if (updatePointer) {
      const pointerPath = path.join(publication.staging, mode + '-pointer.json');
      await writeFile(pointerPath, catalogBytes);
      await putObject(run, storage, { key: pointerKey, body: pointerPath, contentType: 'application/json; charset=utf-8', cache: 'public, max-age=60, must-revalidate' });
    }
    const pointerUrl = `${storage.origin}/${pointerKey}`;
    await verifyPublic(fetcher, pointerUrl, catalogBytes);
    return { mode, version: version || null, commit, pointerKey, pointerUrl, snapshotKey, promoted: updatePointer, uploaded, reused,
      catalogSHA256: digest(catalogBytes), templateCount: publication.catalog.templateIds.length };
  } finally { await rm(publication.staging, { recursive: true, force: true }); }
}

export async function finalizeTemplateSnapshot(candidate, receipt, { endpoint, bucket, origin = publicOrigin, promote, run = runFile, fetcher = fetch }) {
  const storage = validateStorageConfig({ endpoint, bucket, origin });
  assert.equal(receipt.version, candidate.version);
  assert.equal(receipt.commit, candidate.sourceCommit);
  assert.equal(receipt.tgzSHA256, candidate.tgzSHA256);
  assert.equal(receipt.promoted, false);
  assert(commitPattern.test(candidate.sourceCommit));
  const snapshotKey = `${catalogRoot}/snapshots/${candidate.sourceCommit}`;
  assert.equal(receipt.snapshotKey, snapshotKey);
  const snapshotUrl = `${storage.origin}/${snapshotKey}/catalog.json`;
  const response = await fetcher(snapshotUrl, { redirect: 'error', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30_000) });
  assert(response.ok, `Prepared template catalog returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(digest(bytes), receipt.catalogSHA256, 'Prepared template catalog bytes differ');
  if (!promote) return receipt;
  const pointerKey = `${catalogRoot}/releases/catalog.json`;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-catalog-pointer-'));
  try {
    const body = path.join(directory, 'catalog.json');
    await writeFile(body, bytes);
    await putObject(run, storage, { key: pointerKey, body, contentType: 'application/json; charset=utf-8', cache: 'public, max-age=60, must-revalidate' });
    const pointerUrl = `${storage.origin}/${pointerKey}`;
    await verifyPublic(fetcher, pointerUrl, bytes);
    return { ...receipt, pointerKey, pointerUrl, promoted: true };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode = 'main', version, candidateDirectory] = process.argv.slice(2);
  assert(['main', 'release', 'stage', 'validate'].includes(mode), 'Unknown template operation');
  if (mode === 'stage') assert(['publish-test', 'publish-stable'].includes(process.env.MOTION_RELEASE_ACTION), 'Template staging requires a publication run');
  if (mode !== 'validate') {
    for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) assert(process.env[name], `Missing publication credential: ${name}`);
  }
  const config = { endpoint: process.env.MOTION_R2_ENDPOINT, bucket: process.env.MOTION_R2_BUCKET, origin: process.env.MOTION_INSTALL_PUBLIC_ORIGIN };
  const root = process.cwd();
  let source = root, commit = process.env.GITHUB_SHA, work;
  try {
    if (mode === 'main') {
      console.log(JSON.stringify(await publishTemplateCatalog(source, { ...config, mode, commit }), null, 2));
    } else {
      assert(candidateDirectory, 'Release publication requires the verified candidate directory');
      const candidate = JSON.parse(await readFile(path.join(candidateDirectory, 'candidate.json'), 'utf8'));
      assert(versionPattern.test(version) && candidate.version === version && commitPattern.test(candidate.sourceCommit), 'Release template source must match the verified candidate');
      commit = candidate.sourceCommit;
      const promote = mode === 'release' && releaseCatalogPromotion(version, JSON.parse(await readFile(path.join(candidateDirectory, 'publication.json'), 'utf8')));
      const receiptFile = path.join(candidateDirectory, 'template-preparation.json');
      if (mode === 'release' && process.env.MOTION_RELEASE_ACTION !== 'archive-only') {
        const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
        console.log(JSON.stringify(await finalizeTemplateSnapshot(candidate, receipt, { ...config, promote }), null, 2));
      } else {
        work = await mkdtemp(path.join(os.tmpdir(), 'openmotion-template-release-'));
        source = path.join(work, 'source');
        await runFile('git', ['worktree', 'add', '--detach', source, commit], { cwd: root, env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } });
        await runFile('git', ['lfs', 'pull', '--include=library/templates/catalog/**,library/skills/**', '--exclude='], { cwd: source });
        if (mode === 'validate') {
          const plan = await buildTemplatePublication(source, commit);
          await rm(plan.staging, { recursive: true, force: true });
          console.log(`Validated template and Skill snapshot for ${commit}`);
        } else {
          const result = await publishTemplateCatalog(source, { ...config, mode: 'release', version, commit, promote });
          if (mode === 'stage') await writeFile(receiptFile, jsonBytes({ ...result, tgzSHA256: candidate.tgzSHA256 }));
          console.log(JSON.stringify(result, null, 2));
        }
      }
    }
  } finally {
    if (work) {
      await runFile('git', ['worktree', 'remove', '--force', source], { cwd: root }).catch(() => {});
      await rm(work, { recursive: true, force: true });
    }
  }
}
