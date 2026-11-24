import { ToolInputError } from './shared/tool-input-error.ts';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceStore, Conflict, projectPath, validateProjectTitle } from './workspace.ts';
import { atomicJson, jsonFile } from './phase1-versions.ts';
import { inspectProject, nativeProjectConfig, ensureRuntime } from './hyperframes.ts';
import { zip } from './scripts/zip.mjs';
import { readProjectZip } from './shared/project-zip.ts';
import { PROJECT_ARCHIVE_LIMITS as limits, PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE, type ProjectArchiveInput } from './shared/project-archive.ts';
import { withProcessLock } from './shared/process-lock.ts';

const format = 'openmotion.project-archive', manifestName = 'openmotion-projects.json';
const exportValidationVersion = 1;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const metadata = new Set(['motion-project.json', 'motion-assets.json']);
const extensions = new Set('html htm css js mjs cjs ts tsx jsx json csv xml yaml yml bin glb gltf obj mtl hdr exr cube lottie webmanifest map svg png jpg jpeg webp gif avif ico bmp tif tiff heic pdf mp4 mov webm m4v mkv wav mp3 m4a aac ogg opus flac aiff woff woff2 ttf otf ttc txt md vtt srt glsl vert frag wasm'.split(' '));
const studioFiles = new Set(['.hyperframes/studio-manual-edits.json', '.hyperframes/studio-motion.json']);
type PackedProject = { title: string; files: Map<string, Buffer> };
export function portableProjectFile(name: string) {
  if (studioFiles.has(name)) return true;
  if (name.split('/').some(p => p.startsWith('.') || ['node_modules', 'renders', 'dist', 'output', '__MACOSX'].includes(p)) || metadata.has(name)) return false;
  return extensions.has(path.extname(name).slice(1).toLowerCase()) || /^(license|notice|copying)(\.|$)/i.test(path.basename(name));
}
function checkedPath(name: string) {
  try { projectPath(name); } catch { throw new Error('INVALID_PROJECT_ARCHIVE: Unsafe project path'); }
  if (!portableProjectFile(name)) throw new Error('INVALID_PROJECT_ARCHIVE: Unsupported project file: ' + name);
  return name;
}
async function readBounded(filename: string, maximum: number = limits.bytes): Promise<Buffer> {
  // The path comes from the caller. A FIFO or device node must fail fast instead of
  // blocking the single serialized tool queue until a writer appears.
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('INVALID_PROJECT_ARCHIVE: Source must be a regular file');
    if (info.size > maximum) throw new Error('PROJECT_ARCHIVE_TOO_LARGE: File exceeds the archive limit');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length; if (size > maximum) throw new Error('PROJECT_ARCHIVE_TOO_LARGE'); chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}
function decodePackage(entries: Map<string, Buffer>): PackedProject[] {
  // Finder may add system metadata or put a re-compressed download inside one
  // enclosing folder. Recognize the manifest before trying native discovery.
  const files = new Map([...entries].filter(([name]) => !name.split('/').some(part => part === '__MACOSX' || part === '.DS_Store')));
  const root = files.keys().next().value?.split('/')[0];
  const prefix = root && files.has(root + '/' + manifestName) && [...files.keys()].every(name => name.startsWith(root + '/')) ? root + '/' : '';
  entries = prefix ? new Map([...files].map(([name, data]) => [name.slice(prefix.length), data])) : files;
  const manifest = entries.get(manifestName);
  if (manifest) {
    if (manifest.length > 4 * 1024 * 1024) throw new Error('INVALID_PROJECT_ARCHIVE: Manifest too large');
    const value = JSON.parse(manifest.toString('utf8'));
    if (value.format !== format || value.version !== 1 || !Array.isArray(value.projects) || !value.projects.length || value.projects.length > limits.projects) throw new Error('INVALID_PROJECT_ARCHIVE: Unsupported manifest');
    const used = new Set([manifestName]);
    const projects = value.projects.map((project: any) => {
      if (!/^projects\/[a-f0-9-]{36}$/.test(project.root) || !Array.isArray(project.files) || !project.files.length) throw new Error('INVALID_PROJECT_ARCHIVE: Invalid project manifest');
      const files = new Map<string, Buffer>();
      for (const file of project.files) {
        const name = checkedPath(file.path), key = project.root + '/' + name, data = entries.get(key);
        if (!data || used.has(key) || data.length !== file.bytes || hash(data) !== file.sha256) throw new Error('INVALID_PROJECT_ARCHIVE: File checksum mismatch');
        used.add(key); files.set(name, data);
      }
      return { title: validateProjectTitle(project.title), files };
    });
    if (used.size !== entries.size) throw new Error('INVALID_PROJECT_ARCHIVE: Unlisted archive files');
    return projects;
  }
  // Accept a native project at the ZIP root or in one enclosing folder.
  let nativePrefix = '';
  if (!entries.has('index.html')) {
    const folders = new Set([...entries.keys()].map(name => name.split('/')[0]));
    if (folders.size !== 1) throw new Error('INVALID_PROJECT_ARCHIVE: Expected one HyperFrames project folder');
    nativePrefix = [...folders][0] + '/';
  }
  const relative = new Map([...entries].map(([name, bytes]) => [name.slice(nativePrefix.length), bytes]));
  // HyperFrames uses two related discovery rules: `isHyperframesProject` looks
  // for index.html plus a marker, while `isCompositionFolder` intentionally
  // accepts an index.html-only folder so a composition can be opened before
  // `hyperframes init` has written a config. Import follows the latter rule and
  // validateProject supplies the native defaults when no marker exists.
  if (!relative.has('index.html')) throw new Error('INVALID_PROJECT_ARCHIVE: A HyperFrames composition must contain index.html');
  const portable = new Map([...relative].filter(([name]) => portableProjectFile(name)));
  for (const name of portable.keys()) checkedPath(name);
  return [{ title: validateProjectTitle(nativePrefix.slice(0, -1) || 'Imported project'), files: portable }];
}
function archiveError(error: unknown) {
  const message = (error as Error).message;
  return message.startsWith('PROJECT_ARCHIVE_TOO_LARGE') || message.startsWith('INVALID_PROJECT_ARCHIVE')
    ? error : new Error('INVALID_PROJECT_ARCHIVE: ' + message);
}
function decodeArchive(bytes: Buffer) {
  try { return decodePackage(readProjectZip(bytes)); }
  catch (error) { throw archiveError(error); }
}
async function validateProject(project: PackedProject, directory: string, runtimeRoot: string) {
  if (!project.files.has('index.html')) throw new Error('INVALID_PROJECT_ARCHIVE: Missing index.html');
  if (!project.files.has('hyperframes.json')) project.files.set('hyperframes.json', Buffer.from(JSON.stringify(nativeProjectConfig)));
  let config;
  try { config = JSON.parse(project.files.get('hyperframes.json')!.toString()); }
  catch { throw new Error('INVALID_PROJECT_ARCHIVE: hyperframes.json is not valid JSON'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('INVALID_PROJECT_ARCHIVE: Invalid hyperframes.json');
  if (config.paths !== undefined && (!config.paths || typeof config.paths !== 'object' || Array.isArray(config.paths))) throw new Error('INVALID_PROJECT_ARCHIVE: Invalid project paths');
  // Native configuration paths must stay inside the imported project.
  for (const value of Object.values(config.paths ?? {})) if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f]/.test(value) || value.split(/[\\/]/).some(p => p === '..') || value.includes(':')) throw new Error('INVALID_PROJECT_ARCHIVE: Project paths must be relative');
  for (const [name, data] of project.files) {
    checkedPath(name); const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, data, { mode: 0o600, flag: 'wx' });
  }
  const report = await inspectProject(runtimeRoot, directory, 'lint').catch(error => {
    throw new Error(PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE + ': The HyperFrames validator could not run. Try again when the local runtime is ready.', { cause: error });
  });
  if (report.exitCode) {
    const detail = report.result.findings?.find((finding: { severity?: string }) => finding.severity === 'error');
    throw new Error('INVALID_PROJECT_ARCHIVE: Native composition validation failed' + (detail?.message ? ': ' + String(detail.message).slice(0, 160) : ''));
  }
}
async function validatePackedProject(project: PackedProject, directory: string, runtimeRoot: string) {
  try { await validateProject(project, directory, runtimeRoot); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('INVALID_PROJECT_ARCHIVE:')) {
      throw new Error('INVALID_PROJECT_ARCHIVE: ' + project.title + ' — ' + error.message.slice('INVALID_PROJECT_ARCHIVE: '.length), { cause: error });
    }
    throw error;
  }
}

/** Validate the exact bytes handed to the recipient, in the same clean folder layout as import. */
async function validateExport(store: WorkspaceStore, bytes: Buffer, root: string, runtimeRoot?: string) {
  const projects = decodeArchive(bytes);
  const engineRoot = runtimeRoot ?? await ensureRuntime(store.directory, false);
  const staging = path.join(root, 'staging', randomUUID());
  try {
    for (let index = 0; index < projects.length; index++) {
      await validatePackedProject(projects[index], path.join(staging, String(index)), engineRoot);
    }
  } finally { await rm(staging, { recursive: true, force: true }); }
}

/** Shared domain operation for public MCP and browser transports. No source or active selection changes on export. */
export async function projectArchive(store: WorkspaceStore, input: ProjectArchiveInput, runtimeRoot?: string) {
  if (!/^[\w-]{1,100}$/.test(input.requestId)) throw new ToolInputError('Stable requestId required', 'requestId', 'invalid_format');
  if (input.action === 'export') {
    if (input.sourcePath || Boolean(input.all) === Boolean(input.projectIds?.length)) throw new ToolInputError('Choose projectIds or all', input.sourcePath ? 'sourcePath' : 'projectIds', 'invalid_combination');
    return exportProjects(store, input, runtimeRoot);
  }
  const message = 'Import requires an absolute ZIP sourcePath';
  if (!input.sourcePath) throw new ToolInputError(message, 'sourcePath', 'missing');
  if (!path.isAbsolute(input.sourcePath)) throw new ToolInputError(message, 'sourcePath', 'invalid_format');
  const unsupported = input.action !== 'import' ? 'action' : (['all', 'projectIds', 'expectedRevisions'] as const).find(field => input[field] !== undefined);
  if (unsupported) throw new ToolInputError(message, unsupported, 'invalid_combination');
  const bytes = await readBounded(input.sourcePath);
  return importProjects(store, input.requestId, bytes, runtimeRoot);
}
async function exportProjects(store: WorkspaceStore, input: ProjectArchiveInput, runtimeRoot?: string) {
  const root = path.join(store.directory, 'project-archives'), key = hash(input.requestId);
  const receiptPath = path.join(root, 'exports', key + '.json');
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Serialize the same request across processes without holding up other workspace writes.
  return withProcessLock(receiptPath + '.lock', async () => {
    const inputHash = hash(JSON.stringify({ projectIds: input.projectIds, all: input.all, expectedRevisions: input.expectedRevisions }));
    const previous = await jsonFile<any>(receiptPath, null);
    if (previous) {
      if (previous.inputHash !== inputHash) throw new Error('REQUEST_ID_CONFLICT');
      const bytes = await readBounded(previous.result.archivePath);
      if (hash(bytes) !== previous.result.sha256) throw new Error('PROJECT_ARCHIVE_UNAVAILABLE: The saved ZIP checksum has changed');
      if (previous.validationVersion !== exportValidationVersion) {
        await validateExport(store, bytes, root, runtimeRoot);
        await atomicJson(receiptPath, { ...previous, validationVersion: exportValidationVersion });
      }
      return { ...previous.result, replayed: true };
    }
    const { entries, projects, revisions, skippedProjectIds } = await store.lock(() => snapshotProjects(store, input));
    const manifest = Buffer.from(JSON.stringify({ format, version: 1, projects }));
    entries.unshift({ name: manifestName, data: manifest });
    const bytes = zip(entries);
    if (bytes.length > limits.bytes) throw new Error('PROJECT_ARCHIVE_TOO_LARGE');
    await validateExport(store, bytes, root, runtimeRoot);
    const archiveId = randomUUID(), archivePath = path.join(root, 'files', archiveId + '.zip');
    await mkdir(path.dirname(archivePath), { recursive: true, mode: 0o700 });
    await writeFile(archivePath, bytes, { mode: 0o600, flag: 'wx' });
    const filename = projects.length === 1 ? projects[0].title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) + '.zip' : 'OpenMotion-projects.zip';
    await atomicJson(path.join(root, 'files', archiveId + '.json'), { filename });
    const result = { archiveId, archivePath, filename, bytes: bytes.length, sha256: hash(bytes), skippedProjectIds, projects: Object.keys(revisions).map(id => ({ projectId: id, revision: revisions[id] })), downloadUrl: '/motion-api/project-archives/' + archiveId + '/file' };
    await atomicJson(receiptPath, { inputHash, result, validationVersion: exportValidationVersion }); return result;
  });
}

async function snapshotProjects(store: WorkspaceStore, input: ProjectArchiveInput) {
  const catalog = store.projectCatalog(), ids = input.all ? catalog.projects.filter(p => !p.trashedAt).map(p => p.id) : input.projectIds!;
  if (!ids.length || ids.length > limits.projects || new Set(ids).size !== ids.length) throw new ToolInputError('Choose 1–100 distinct projects', 'projectIds', 'invalid_combination');
  if (input.expectedRevisions && Object.keys(input.expectedRevisions).some(id => !ids.includes(id))) throw new ToolInputError('Unexpected project revision', 'expectedRevisions', 'invalid_combination');
  const skippedProjectIds: string[] = [];
  const entries: { name: string; data: Buffer }[] = [], projects = [], revisions: Record<string, string> = {}; let total = 0;
  for (const id of ids) {
    const scoped = store.forProject(id), current = await scoped.get();
    if (!current.project && input.all && id === 'project') { skippedProjectIds.push(id); continue; }
    if (!current.project) throw new Error('PROJECT_NOT_READY: Open the project once before exporting');
    if (input.expectedRevisions?.[id] && current.revision !== input.expectedRevisions[id]) throw new Conflict();
    revisions[id] = current.revision;
    const projectRoot = 'projects/' + randomUUID(), files = [];
    for (const file of current.project.files.filter(file => portableProjectFile(file.path))) {
      total += file.size;
      if (total > limits.bytes || entries.length >= limits.files - 1) throw new Error('PROJECT_ARCHIVE_TOO_LARGE: Export fewer projects (500 MB / 5000 files maximum)');
      const data = await readBounded(await scoped.safePath(file.path), limits.bytes - (total - file.size));
      if (data.length !== file.size || hash(data) !== file.hash) throw new Conflict();
      entries.push({ name: projectRoot + '/' + file.path, data });
      files.push({ path: file.path, bytes: data.length, sha256: file.hash });
    }
    projects.push({ title: catalog.projects.find(p => p.id === id)!.title, root: projectRoot, revision: current.revision, files });
  }
  if (!projects.length) throw new Error('PROJECT_NOT_READY: No initialized projects to export');
  for (const id of Object.keys(revisions)) if ((await store.forProject(id).get()).revision !== revisions[id]) throw new Conflict();
  return { entries, projects, revisions, skippedProjectIds };
}
export async function duplicateProject(store: WorkspaceStore, input: { projectId: string; requestId: string; title?: string; expectedRevision?: string }, runtimeRoot?: string) {
  const title = input.title === undefined ? undefined : validateProjectTitle(input.title);
  const requestId = 'duplicate-' + hash(input.requestId);
  const snapshot = await exportProjects(store, { action: 'export', requestId, projectIds: [input.projectId],
    expectedRevisions: input.expectedRevision ? { [input.projectId]: input.expectedRevision } : undefined }, runtimeRoot);
  const result = await importProjects(store, requestId, await readBounded(snapshot.archivePath), runtimeRoot, { title });
  return { ...result.projects[0], sourceProjectId: input.projectId, sourceRevision: snapshot.projects[0].revision, replayed: result.replayed };
}

export async function importProjects(store: WorkspaceStore, requestId: string, bytes: Buffer, runtimeRoot?: string, copy?: { title?: string }) {
  if (!/^[\w-]{1,100}$/.test(requestId)) throw new ToolInputError('Stable requestId required', 'requestId', 'invalid_format');
  const inputHash = copy ? hash(hash(bytes) + JSON.stringify(copy)) : hash(bytes), root = path.join(store.directory, 'project-archives'), receiptPath = path.join(root, 'imports', hash(requestId) + '.json');
  await mkdir(root, { recursive: true, mode: 0o700 });
  return withProcessLock(receiptPath + '.lock', async () => {
    const previous = await jsonFile<any>(receiptPath, null);
    if (previous && previous.inputHash !== inputHash) throw new Error('REQUEST_ID_CONFLICT');
    if (previous?.committed) return { projects: previous.projects, replayed: true };
    if (previous) {
      const known = new Set(store.projectCatalog().projects.map(project => project.id));
      if (previous.projects.every((p: any) => known.has(p.projectId))) return { projects: previous.projects, replayed: true };
      if (previous.projects.some((p: any) => known.has(p.projectId))) throw new Error('PROJECT_ARCHIVE_UNAVAILABLE: Some imported projects are missing');
      for (const p of previous.projects) await rm(store.projectDirectoryFor(p.projectId), { recursive: true, force: true });
    }
    const projects = decodeArchive(bytes);
    if (copy) {
      if (projects.length !== 1) throw new Error('INVALID_PROJECT_ARCHIVE: Duplicate requires exactly one project');
      projects[0].title = validateProjectTitle(copy.title ?? projects[0].title.slice(0, 93) + ' (copy)');
    }
    const engineRoot = runtimeRoot ?? await ensureRuntime(store.directory, false);
    const staging = path.join(root, 'staging', randomUUID());
    const results = projects.map(project => ({ projectId: randomUUID(), sessionId: randomUUID(), title: project.title }));
    try {
      for (let i = 0; i < projects.length; i++) await validatePackedProject(projects[i], path.join(staging, results[i].projectId), engineRoot);
      await store.lock(async () => {
        const catalog = store.projectCatalog();
        await atomicJson(receiptPath, { inputHash, projects: results });
        try {
          await mkdir(path.join(store.directory, 'projects'), { recursive: true, mode: 0o700 });
          for (const project of results) {
            await rename(path.join(staging, project.projectId), store.projectDirectoryFor(project.projectId));
            catalog.projects.unshift({ id: project.projectId, title: project.title, titleKey: null, createdAt: Date.now() });
            catalog.sessions!.unshift({ id: project.sessionId, title: project.title, mode: 'motion', createdAt: Date.now(), activeArtifactId: project.projectId,
              artifacts: [{ id: project.projectId, projectId: project.projectId, kind: 'motion-project', title: project.title }] });
          }
          await atomicJson(path.join(store.directory, 'projects.json'), catalog);
        } catch (error) {
          for (const project of results) await rm(store.projectDirectoryFor(project.projectId), { recursive: true, force: true });
          throw error;
        }
        await atomicJson(receiptPath, { inputHash, projects: results, committed: true });
      });
      return { projects: results, replayed: false };
    } finally { await rm(staging, { recursive: true, force: true }); }
  });
}
