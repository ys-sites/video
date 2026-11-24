import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { downloadOrigin, downloadPrefix, downloadManifestUrl, validateDownload, type PluginChannel } from './download.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const execute = promisify(execFile);
const run = async (command: string, args: string[]) => (await execute(command, args)).stdout;

export async function publishPlugin({
  commit, endpoint, bucket, archive, version, dshVersion, channel = 'main', promote = true,
}: { commit: string; endpoint: string; bucket: string; archive: string; version: string; dshVersion: string; channel?: PluginChannel; promote?: boolean },
{ execute = run, fetcher = fetch, currentCommit = async () => (await run('git', ['ls-remote', 'origin', 'refs/heads/main'])).split(/\s/)[0] } = {}) {
  const api = new URL(endpoint);
  const pointerUrl = downloadManifestUrl(channel);
  if (channel !== 'main') assert.equal(version.includes('-test.'), channel === 'test', 'Plugin version must match its release channel');
  assert(api.protocol === 'https:' && api.hostname.endsWith('.r2.cloudflarestorage.com') && api.href === `${api.origin}/`, 'Require an R2 S3 HTTPS origin');
  assert(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket), 'Require the configured R2 bucket');
  const bytes = await readFile(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `${downloadPrefix}/snapshots/${commit}/${sha256}/openmotion-dsh.tgz`;
  const manifest = validateDownload({ schemaVersion: 1, name: 'openmotion-dsh', version, dshVersion, sourceCommit: commit, sha256, bytes: bytes.length, tarballUrl: `${downloadOrigin}/${key}` });
  const staging = await mkdtemp(path.join(tmpdir(), 'openmotion-dsh-publish-'));
  const put = (key: string, body: string, contentType: string, cache: string, immutable = false) => execute('aws', [
    '--endpoint-url', api.origin, '--region', 'auto', 's3api', 'put-object', '--bucket', bucket, '--key', key,
    '--body', body, '--content-type', contentType, '--cache-control', cache, ...(immutable ? ['--if-none-match', '*'] : []),
  ]);
  const verify = async (url: string, expected: Buffer) => {
    const response = await fetcher(url, { redirect: 'error', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(60_000) });
    assert(response.ok && Buffer.from(await response.arrayBuffer()).equals(expected), `Public DSH download verification failed: ${url}`);
  };
  try {
    try { await put(key, archive, 'application/gzip', 'public, max-age=31536000, immutable', true); }
    catch (error) { if (!/PreconditionFailed|\(412\)/.test(String(error))) throw error; }
    // Never advertise an upload until its public bytes have been verified.
    await verify(manifest.tarballUrl, bytes);
    if (!promote) return manifest;
    if (channel === 'main') assert.equal(await currentCommit(), commit, 'Main advanced; refusing to promote a stale DSH plugin. Run the workflow on current main.');
    const metadata = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    const filename = path.join(staging, 'latest.json');
    await writeFile(filename, metadata);
    await put(`${downloadPrefix}/${channel}/latest.json`, filename, 'application/json; charset=utf-8', 'no-cache, max-age=0, must-revalidate');
    await verify(pointerUrl, metadata);
    return manifest;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert(process.env.GITHUB_REPOSITORY === 'nexu-io/openmotion' && process.env.GITHUB_REF === 'refs/heads/main' && ['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME || ''), 'Only trusted main may publish the DSH plugin');
  const pkg = JSON.parse(await readFile(path.join(directory, 'plugin/package.json'), 'utf8'));
  const host = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  console.log(JSON.stringify(await publishPlugin({
    commit: process.env.GITHUB_SHA || '', endpoint: process.env.MOTION_R2_ENDPOINT || '', bucket: process.env.MOTION_R2_BUCKET || '',
    archive: path.join(directory, `dist/openmotion-dsh-${pkg.version}.tgz`), version: pkg.version, dshVersion: host.dependencies['@deepseek-ai/dsh'],
  }), null, 2));
}
