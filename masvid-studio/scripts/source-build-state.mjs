// Source installers reuse a build only while its inputs and output bytes match.
// Prebuilt distributions have no .git entry and keep their sealed build.
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const inputs = ['package.json', 'package-lock.json', 'studio', 'shared', 'tracking', 'packages/design-system', 'packages/open-design-ui', 'mcp-ui', 'web',
  'scripts/diagnostic-redaction.mjs',
  'scripts/build-inline-ui.mjs', 'scripts/build-template-cards.mjs', 'scripts/source-build-state.mjs'];
const outputs = ['studio/build', 'mcp-ui/template-recommendations/build', 'web/inline-video.html'];
const receipt = '.artifacts/install/source-build.json';
const dependenciesReceipt = '.artifacts/install/source-dependencies.sha256';
const digest = value => createHash('sha256').update(value).digest('hex');

async function fingerprint(root, names, excludeBuild = false) {
  const hash = createHash('sha256');
  async function visit(name) {
    const filename = path.join(root, name);
    const info = await lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    hash.update(JSON.stringify(name));
    if (!info) { hash.update('missing'); return; }
    if (info.isSymbolicLink()) { hash.update(JSON.stringify(await readlink(filename))); return; }
    if (info.isDirectory()) {
      for (const child of (await readdir(filename)).sort()) {
        if (child === 'node_modules' || child === '.git' || excludeBuild && (child === 'build'
          || (name === 'packages/open-design-ui' && child === 'dist')
          || path.posix.join(name, child) === 'web/inline-video.html')) continue;
        await visit(path.posix.join(name, child));
      }
    } else hash.update(digest(await readFile(filename)));
  }
  for (const name of names) await visit(name);
  return hash.digest('hex');
}

async function readOptional(filename) {
  return readFile(filename, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
}

export async function dependenciesCurrent(root, { inspectInstalledLock = false } = {}) {
  const [recorded, lock, installed] = await Promise.all([
    readOptional(path.join(root, dependenciesReceipt)), readOptional(path.join(root, 'package-lock.json')),
    readOptional(path.join(root, 'node_modules/.package-lock.json')),
  ]);
  if (!lock || !installed) return false;
  if (recorded === digest(lock)) return true;
  if (!inspectInstalledLock) return false;
  // A checkout installed outside our bootstrap can still reuse npm's locked tree.
  // Optional packages omitted for this platform are not missing dependencies.
  const wanted = JSON.parse(lock).packages, actual = JSON.parse(installed).packages;
  if (!wanted || !actual || !Object.keys(wanted).some(name => name)) return false;
  for (const [name, entry] of Object.entries(wanted)) {
    if (!name || entry.optional) continue;
    const present = actual[name];
    if (!present || present.version !== entry.version || present.integrity !== entry.integrity
      || !await lstat(path.join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) return false;
  }
  return true;
}

export async function recordDependencies(root) {
  await mkdir(path.join(root, '.artifacts/install'), { recursive: true });
  await writeFile(path.join(root, dependenciesReceipt), digest(await readFile(path.join(root, 'package-lock.json'))));
}

export async function sourceBuildCurrent(root) {
  const stored = await readOptional(path.join(root, receipt));
  if (!stored || !await readOptional(path.join(root, 'studio/build/index.html'))) return false;
  let saved;
  try { saved = JSON.parse(stored); } catch { return false; }
  return saved.inputs === await fingerprint(root, inputs, true) && saved.outputs === await fingerprint(root, outputs);
}

export async function recordSourceBuild(root) {
  await mkdir(path.join(root, '.artifacts/install'), { recursive: true });
  await writeFile(path.join(root, receipt), JSON.stringify({
    inputs: await fingerprint(root, inputs, true), outputs: await fingerprint(root, outputs),
  }) + '\n');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const mode = process.argv[2];
  if (mode === '--record') await recordSourceBuild(root);
  else if (mode === '--record-dependencies') await recordDependencies(root);
  else if (mode === '--check') process.exitCode = await sourceBuildCurrent(root) ? 0 : 1;
  else if (mode === '--dependencies-current') process.exitCode = await dependenciesCurrent(root) ? 0 : 1;
  else throw new Error('Use --check, --record, --dependencies-current or --record-dependencies');
}
