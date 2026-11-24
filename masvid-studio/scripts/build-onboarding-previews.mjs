// Maintainer-only build: render the editable catalog projects, never download
// their original reference films. Installation reads the committed WebM/JPEGs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { onboardingTemplateIds } from '../shared/onboarding-templates.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'mcp-ui/template-recommendations/project-previews');
const scratch = path.join(root, '.artifacts/onboarding-preview-build');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
const records = [];
// Keep the reviewed three-card quality; reserve space for the 43-second film
// when it is selected alongside the 61-second film and another full preview.
const videoBitrates = {
  'motion-664184d9-593e-4984-b473-701248b69cfe': 28_000,
  'motion-f6f244d1-c549-4081-8a5d-f0e1e3660044': 46_000,
  'motion-0ad92fd0-b2fb-4885-957c-b71152df15fd': 48_000,
  'motion-a28f0e5d-aa8b-45a7-87f9-9afcac65a09b': 48_000,
};
await mkdir(output, { recursive: true });
await mkdir(scratch, { recursive: true });
async function render(id) {
  const catalog = path.join(root, 'library/templates/catalog', id);
  const record = JSON.parse(await readFile(path.join(catalog, 'template.json'), 'utf8'));
  const project = path.join(scratch, id);
  await cp(path.join(catalog, 'source'), project, { recursive: true });
  for (const file of record.entry.files) {
    if (file.mimeType.startsWith('audio/')) continue;
    let bytes = await readFile(path.join(project, file.path));
    // Optional font hydration only, with the catalog's content hash. No video
    // or audio URL is fetched, and the checked-in source remains untouched.
    if (sha256(bytes) !== file.sha256 && file.mimeType.startsWith('font/') && process.argv.includes('--hydrate-fonts')) {
      assert.equal(file.url, 'https://r.open-design.ai/files/' + file.sha256);
      const response = await fetch(file.url);
      assert(response.ok, 'Font download failed: ' + file.path);
      bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(sha256(bytes), file.sha256);
      await writeFile(path.join(project, file.path), bytes);
    }
    assert.equal(sha256(bytes), file.sha256, 'Missing or changed project asset: ' + id + '/' + file.path);
  }
  for (const file of record.entry.files.filter(file => file.path.endsWith('.html'))) {
    const htmlPath = path.join(project, file.path);
    const html = await readFile(htmlPath, 'utf8');
    await writeFile(htmlPath, html.replace(/<audio\b[^>]*(?:\/>|>[\s\S]*?<\/audio\s*>)/gi, ''));
  }
  const raw = path.join(scratch, id + '.mp4');
  const captureIdentity = sha256(JSON.stringify({ files: record.entry.files, fps: 12, silent: true,
    hyperframes: '0.9.7', crf: 16, fastCapture: false }));
  const cachePath = raw + '.json';
  const cached = await readFile(cachePath, 'utf8').then(JSON.parse).catch(() => null);
  const cacheValid = cached?.captureIdentity === captureIdentity
    && cached.sha256 === await readFile(raw).then(sha256).catch(() => null);
  try {
    if (!cacheValid) {
      await run(path.join(root, 'node_modules/.bin/hyperframes'), ['render', project, '--output', raw,
        '--fps', '12', '--workers', '1', '--crf', '16', '--experimental-fast-capture=false', '--quiet'],
      { cwd: root, env: { ...process.env, OPENMOTION_TELEMETRY: '0' }, maxBuffer: 16 * 1024 * 1024 });
      await writeFile(cachePath, JSON.stringify({ captureIdentity, sha256: sha256(await readFile(raw)) }));
    }
  } catch (error) {
    await writeFile(path.join(scratch, id + '.log'), String(error.stdout) + String(error.stderr));
    throw new Error('Project render failed; see .artifacts/onboarding-preview-build/' + id + '.log', { cause: error });
  }
  const videoPath = path.join(output, id + '.webm'), posterPath = path.join(output, id + '.jpg');
  // Share the document budget by duration instead of shrinking long films to 144p.
  // Two-pass VP9 keeps complete 12 fps previews at up to 512 px without upscaling.
  const encoding = ['-y', '-v', 'error', '-i', raw, '-an', '-vf', 'scale=min(512\\,iw):-2',
    '-c:v', 'libvpx-vp9', '-b:v', String(videoBitrates[id]), '-threads', '3', '-row-mt', '1',
    '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-passlogfile', path.join(scratch, id + '-vp9')];
  await run('ffmpeg', [...encoding, '-pass', '1', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null']);
  await run('ffmpeg', [...encoding, '-pass', '2', videoPath]);
  await run('ffmpeg', ['-y', '-v', 'error', '-ss', '1', '-i', raw, '-vf', 'scale=min(512\\,iw):-2', '-frames:v', '1', '-q:v', '3', posterPath]);
  assert((await stat(videoPath)).size + (await stat(posterPath)).size < 400_000, 'Preview exceeds its media budget: ' + id);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', videoPath]);
  const probe = JSON.parse(stdout);
  const asset = async (filename, mimeType) => {
    const bytes = await readFile(filename);
    return { path: 'project-previews/' + path.basename(filename), bytes: bytes.length, sha256: sha256(bytes), mimeType };
  };
  const result = { id, sourceFilesSha256: sha256(JSON.stringify(record.entry.files)),
    durationSeconds: Number(probe.format.duration), width: probe.streams[0].width, height: probe.streams[0].height, targetBitrate: videoBitrates[id],
    video: await asset(videoPath, 'video/webm'), poster: await asset(posterPath, 'image/jpeg') };
  records.push(result);
  console.log(JSON.stringify({ id, durationSeconds: result.durationSeconds, bytes: result.video.bytes }));
}
const queue = [...onboardingTemplateIds];
await Promise.all(Array.from({ length: 2 }, async () => { while (queue.length) await render(queue.shift()); }));
const largestThree = records.map(item => item.video.bytes + item.poster.bytes).sort((a, b) => b - a).slice(0, 3);
assert(largestThree.reduce((sum, bytes) => sum + bytes, 0) < 680_000,
  'Largest three previews exceed the inline budget; leave room for base64, metadata and the component');
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, previewSource: 'project',
  silent: true, fps: 12, runtime: { hyperframes: '0.9.7' },
  templates: onboardingTemplateIds.map(id => records.find(item => item.id === id)) }, null, 2) + '\n');
