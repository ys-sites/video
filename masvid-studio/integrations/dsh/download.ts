import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const downloadOrigin = 'https://releases.open-design.ai';
export const downloadPrefix = 'open-motion/integrations/dsh';
export type PluginChannel = "main" | "test" | "stable";
export function downloadManifestUrl(channel: PluginChannel): string {
  assert(["main", "test", "stable"].includes(channel), "Choose the main, test or stable DSH channel");
  return `${downloadOrigin}/${downloadPrefix}/${channel}/latest.json`;
}
export const manifestUrl = downloadManifestUrl("stable");

export interface PluginDownload {
  schemaVersion: 1;
  name: 'openmotion-dsh';
  version: string;
  dshVersion: string;
  sourceCommit: string;
  sha256: string;
  bytes: number;
  tarballUrl: string;
}

export function validateDownload(value: PluginDownload): PluginDownload {
  assert(value.schemaVersion === 1 && value.name === 'openmotion-dsh', 'Invalid DSH plugin download');
  assert(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-test\.[1-9]\d*(?:\.[1-9]\d*)*)?$/.test(value.version) && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value.dshVersion), 'Invalid plugin/DSH versions');
  assert(/^[a-f0-9]{40}$/.test(value.sourceCommit) && /^[a-f0-9]{64}$/.test(value.sha256), 'Invalid plugin identity');
  assert(Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 10 * 1024 * 1024, 'Invalid plugin size');
  assert.equal(value.tarballUrl, `${downloadOrigin}/${downloadPrefix}/snapshots/${value.sourceCommit}/${value.sha256}/openmotion-dsh.tgz`, 'Unexpected plugin download URL');
  return value;
}

export async function downloadPlugin(destination: string, fetcher: typeof fetch = fetch, channel: PluginChannel = "stable") {
  const get = (url: string) => fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { 'cache-control': 'no-cache' } });
  const response = await get(downloadManifestUrl(channel));
  assert(response.ok, `DSH download manifest returned HTTP ${response.status}; use the source build if not yet published`);
  const manifest = validateDownload(await response.json() as PluginDownload);
  const archive = await get(manifest.tarballUrl);
  assert(archive.ok, `DSH plugin returned HTTP ${archive.status}`);
  const bytes = Buffer.from(await archive.arrayBuffer());
  assert.equal(bytes.length, manifest.bytes, 'DSH plugin size differs');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256, 'DSH plugin checksum differs');
  await mkdir(destination, { recursive: true });
  const filename = path.join(destination, `openmotion-dsh-${manifest.sourceCommit.slice(0, 12)}-${manifest.sha256.slice(0, 12)}.tgz`);
  await writeFile(filename, bytes, { flag: 'wx' });
  return { ...manifest, filename };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert(process.argv[2], 'Usage: node integrations/dsh/download.ts /absolute/download/directory [--channel=stable|test|main]');
  const channel = (process.argv[3] || "--channel=stable").replace(/^--channel=/, "") as PluginChannel;
  console.log(JSON.stringify(await downloadPlugin(path.resolve(process.argv[2]), fetch, channel), null, 2));
}
