import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTemplateRuntime } from '../.github/scripts/template-runtime-check.mjs';
import { buildTemplatePublication } from '../.github/scripts/publish-template-catalog.mjs';
import { packageNpm } from '../scripts/package-npm.mjs';
import { extractArchive, runFile } from '../scripts/runtime-assets.mjs';
import { closeFixtureEditor } from './fixtures.ts';

const output = process.argv[2];
assert(output && path.isAbsolute(output), 'Pass an absolute evidence directory');
const lock = path.join(tmpdir(), 'openmotion-template-catalog-browser.lock');
await mkdir(lock);
const work = await mkdtemp(path.join(tmpdir(), 'openmotion-template-browser-'));
let publication;
async function scenario(appRoot, source, hook) {
  const data = path.join(work, source), env = { ...process.env, MOTION_DATA_DIR: data, OPENMOTION_TELEMETRY: '0', HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', HYPERFRAMES_FFMPEG_PATH: process.env.HYPERFRAMES_FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg', HYPERFRAMES_FFPROBE_PATH: process.env.HYPERFRAMES_FFPROBE_PATH || '/opt/homebrew/bin/ffprobe' };
  delete env.MOTION_TEMPLATE_SOURCE;
  if (hook) env.NODE_OPTIONS = '--import=' + hook;
  const child = spawn(process.execPath, ['--experimental-strip-types', path.join(appRoot, 'mcp.ts')], { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'exit');
  const pending = new Map(); let sequence = 0, stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const fail = error => { for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(error); } pending.clear(); };
  child.on('error', fail); child.on('exit', () => fail(new Error('MCP exited: ' + stderr)));
  createInterface({ input: child.stdout }).on('line', line => {
    try { const value = JSON.parse(line), waiting = pending.get(value.id); if (waiting) { pending.delete(value.id); clearTimeout(waiting.timer); value.error ? waiting.reject(new Error(JSON.stringify(value.error))) : waiting.resolve(value.result); } }
    catch (error) { fail(error); }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP timeout: ' + method + '; ' + stderr)); }, 120_000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'template-browser-check', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return await checkTemplateRuntime({ appRoot, browserPath: env.HYPERFRAMES_BROWSER_PATH, output: path.join(output, source), expectedSource: source,
      call: async (name, args = {}) => { const value = await rpc('tools/call', { name, arguments: args }); assert(!value.isError, JSON.stringify(value)); return value.structuredContent; } });
  } finally {
    child.stdin.end(); await closed; fail(new Error('Session closed'));
    await closeFixtureEditor(data);
  }
}
try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await scenario(root, 'repository');
  const built = await packageNpm(path.join(work, 'package'), '0.6.4-test.458');
  const app = path.join(work, 'application'); await extractArchive(built.application, app);
  // Exercise packaged application bytes; local dependency installation was verified separately.
  await symlink(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'dir');
  const commit = (await runFile('git', ['rev-parse', 'HEAD'], { cwd: root })).trim();
  publication = await buildTemplatePublication(root, commit);
  const files = publication.uploads.map(file => ['https://releases.open-design.ai/' + file.key, file.body]);
  files.push(['https://releases.open-design.ai/open-motion/templates/main/catalog.json', publication.uploads.find(file => file.key.endsWith('/catalog.json')).body]);
  const hook = path.join(work, 'hosted.mjs');
  await writeFile(hook, `import {readFile} from 'node:fs/promises';\nconst files=new Map(${JSON.stringify(files)}),original=globalThis.fetch;globalThis.fetch=async(input,init)=>{const file=files.get(String(input));return file?new Response(await readFile(file)):original(input,init);};`);
  await scenario(app, 'hosted', hook);
} finally {
  if (publication) await rm(publication.staging, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true }); await rm(lock, { recursive: true, force: true });
}
