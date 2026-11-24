import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const manifestName = 'motion-package.json';
const schema = JSON.parse(await readFile(new URL('./schema.json', import.meta.url), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const own = (object, key) => Object.hasOwn(object, key);

// Evaluates only the keywords used by our bundled schema, never a caller's $schema URL.
function shape(value, rule, at = '$') {
  if (rule.$ref) return shape(value, schema.$defs[rule.$ref.split('/').at(-1)], at);
  if (own(rule, 'const') && value !== rule.const) fail(`${at}: expected ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) fail(`${at}: unsupported value`);
  if (rule.type) {
    const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (type !== rule.type) fail(`${at}: expected ${rule.type}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (length < (rule.minLength ?? 0) || length > (rule.maxLength ?? Infinity)) fail(`${at}: invalid length`);
    if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) fail(`${at}: invalid format`);
  }
  if (Array.isArray(value)) {
    if (value.length < (rule.minItems ?? 0)) fail(`${at}: too few items`);
    if (rule.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail(`${at}: duplicate item`);
    value.forEach((item, i) => shape(item, rule.items, `${at}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const key of rule.required ?? []) if (!own(value, key)) fail(`${at}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (rule.propertyNames) shape(key, rule.propertyNames, `${at} key`);
      if (own(rule.properties ?? {}, key)) shape(item, rule.properties[key], `${at}.${key}`);
      else if (rule.additionalProperties === false) fail(`${at}.${key}: unknown field`);
    }
  }
}

function portablePath(value) {
  shape(value, schema.$defs.path, 'path');
  for (const part of value.split('/')) {
    if (!part || /[<>"|*\x00-\x1f\x7f]/.test(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) fail(`Non-portable path: ${value}`);
  }
}

async function fileBytes(root, relative) {
  portablePath(relative);
  let current = root;
  const parts = relative.split('/');
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) {
      fail(`Expected an ordinary package file: ${relative}`);
    }
  }
  return readFile(current);
}

/** Checks declarations and local bytes only; never imports package code or fetches URLs. */
export async function inspectPackage(directory, { verifyHashes = true } = {}) {
  const root = await realpath(directory);
  const manifestBytes = await fileBytes(root, manifestName);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  shape(manifest, schema);
  const entries = new Map();
  const portableNames = new Map([[manifestName, manifestName]]);
  for (const file of manifest.files) {
    portablePath(file.path);
    // Check directory segments too: Assets/a and assets/b collide on common hosts.
    const parts = file.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      const key = prefix.normalize('NFC').toLowerCase();
      const previous = portableNames.get(key);
      if (previous && (previous !== prefix || i === parts.length)) fail(`Duplicate/colliding path: ${file.path}`);
      portableNames.set(key, prefix);
    }
    const bytes = await fileBytes(root, file.path);
    const sha256 = digest(bytes);
    if (verifyHashes && sha256 !== file.sha256) fail(`Hash mismatch: ${file.path}`);
    entries.set(file.path, { ...file, bytes, sha256 });
  }
  const requireFile = (name, role) => {
    if (!entries.has(name)) fail(`Unlisted reference: ${name}`);
    if (role && entries.get(name).role !== role) fail(`Expected ${role} role: ${name}`);
  };
  requireFile(manifest.motion, 'motion');
  requireFile(manifest.design.path, 'design');
  requireFile(manifest.licenseFile, 'license');
  if (manifest.skill) {
    requireFile(manifest.skill, 'skill');
    if (path.posix.basename(manifest.skill) !== 'SKILL.md') fail('Skill entry must be named SKILL.md');
  }
  if (manifest.inputs) requireFile(manifest.inputs, 'inputs');
  if (manifest.design.format === 'design-md' && !manifest.design.specVersion) fail('design-md requires an upstream specVersion');
  for (const reference of manifest.extends ?? []) {
    requireFile(reference, 'reference');
    if (reference === manifest.motion) fail('A motion document cannot extend itself');
  }
  const dependencies = new Set();
  for (const dependency of manifest.dependencies ?? []) {
    if (dependencies.has(dependency.name)) fail(`Duplicate dependency: ${dependency.name}`);
    dependencies.add(dependency.name);
    if (dependency.path) requireFile(dependency.path);
    if (dependency.kind === 'motion-package' && !dependency.path) fail(`Motion dependency needs a local entry: ${dependency.name}`);
  }
  return { root, manifest, manifestBytes, entries };
}

/** Refreshes only the explicitly listed file hashes after an intentional author edit. */
export async function lockPackage(directory) {
  const result = await inspectPackage(directory, { verifyHashes: false });
  for (const file of result.manifest.files) file.sha256 = result.entries.get(file.path).sha256;
  const current = await fileBytes(result.root, manifestName);
  if (!current.equals(result.manifestBytes)) fail('Manifest changed while locking; retry after editing finishes');
  const temporary = path.join(result.root, `.motion-package-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, path.join(result.root, manifestName));
  } finally {
    await rm(temporary, { force: true });
  }
  return { name: result.manifest.name, version: result.manifest.version, files: result.entries.size };
}

/** Copies the verified inventory into a new directory, retaining exactly the checked bytes. */
export async function packPackage(directory, destination) {
  const result = await inspectPackage(directory);
  const requested = path.resolve(destination);
  const parent = await realpath(path.dirname(requested));
  const target = path.join(parent, path.basename(requested));
  const relative = path.relative(result.root, target);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    fail('Destination must be outside the source package');
  }
  await mkdir(target); // EEXIST preserves directories, files and symlinks owned by the user.
  try {
    for (const [name, { bytes }] of result.entries) {
      const output = path.join(target, name);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, bytes, { flag: 'wx' });
    }
    await writeFile(path.join(target, manifestName), result.manifestBytes, { flag: 'wx' });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  return { destination: target, name: result.manifest.name, version: result.manifest.version, files: result.entries.size + 1 };
}
