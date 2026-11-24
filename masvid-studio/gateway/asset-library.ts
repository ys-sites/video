import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { WorkspaceStore } from '../workspace.ts';
import { MAX_ASSET_BYTES } from '../shared/asset-limits.ts';
import { AUDIO_KINDS, classifyAudioKind, isAudioKind } from '../shared/audio-kind.ts';
import { knownSpeechVoiceName } from '../shared/generation-options.ts';
import { assetVersion, type AssetListInput, type AssetReference, type AssetVersion, type LibraryAsset, type LibraryGeneration } from '../shared/asset-library.ts';
import { probeLibraryMedia } from './asset-probe.ts';

export const libraryId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const assetHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function atomicAssetJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
export function assetName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f]/.test(value)) throw new Error('Asset name must contain 1–200 characters');
  return value.trim();
}
export class AssetLibrary {
  readonly store: WorkspaceStore;
  readonly root: string;
  constructor(store: WorkspaceStore) { this.store = store.workspaceStore ?? store; this.root = path.join(this.store.directory, 'asset-library'); }
  private async file(relative: string) { return this.store.safePath(relative, this.root); }
  async get(id: string): Promise<LibraryAsset> {
    if (!libraryId(id)) throw new Error('ASSET_NOT_FOUND');
    try { return JSON.parse(await readFile(await this.file(`records/${id}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('ASSET_NOT_FOUND'); throw error; }
  }
  async list(input: AssetListInput = {}) {
    const { offset = 0, limit = 60 } = input;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid asset pagination');
    if (input.modality && !['image', 'video', 'audio'].includes(input.modality)
      || input.audioKind && !AUDIO_KINDS.includes(input.audioKind)
      || input.source && !['upload', 'generated'].includes(input.source)
      || input.sort && !['newest', 'oldest', 'name'].includes(input.sort) || input.query && (typeof input.query !== 'string' || input.query.length > 200)) throw new Error('Invalid asset filter');
    const names = await readdir(await this.file('records')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    const query = input.query?.trim().toLocaleLowerCase();
    const all = (await Promise.all(names.filter(name => name.endsWith('.json') && libraryId(name.slice(0, -5))).map(name => this.get(name.slice(0, -5)))))
      .filter(asset => {
        const current = assetVersion(asset);
        if (Boolean(asset.trashedAt) !== Boolean(input.trash)) return false;
        if (input.modality && asset.modality !== input.modality) return false;
        if (input.audioKind) {
          const resolvedKind = isAudioKind(current?.audioKind)
            ? current.audioKind
            : classifyAudioKind(current?.model, undefined, current?.source);
          if (asset.modality !== 'audio' || resolvedKind !== input.audioKind) return false;
        }
        if (input.source && current?.source !== input.source) return false;
        if (query) {
          const haystack = `${asset.name} ${asset.versions.map(v => `${v.prompt ?? ''} ${v.model ?? ''} ${typeof v.parameters?.voice === 'string' ? v.parameters.voice : ''} ${knownSpeechVoiceName(v.parameters?.voice) ?? ''}`).join(' ')}`.toLocaleLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => input.sort === 'name' ? a.name.localeCompare(b.name) : input.sort === 'oldest' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt);
    return { assets: all.slice(offset, offset + limit), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
  }
  async resolve(reference: AssetReference, allowTrash = false) {
    const asset = await this.get(reference.assetId);
    const version = assetVersion(asset, reference.versionId);
    if (!version || !libraryId(reference.versionId) || asset.trashedAt && !allowTrash) throw new Error('ASSET_VERSION_UNAVAILABLE');
    const filename = await this.file(`files/${asset.id}/${version.id}/${version.filename}`);
    return { asset, version, filename };
  }
  async validateGeneration(input: LibraryGeneration) {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['assetId', 'title', 'parentVersionId', 'references', 'conversationId'].includes(key))) throw new Error('Invalid asset generation destination');
    if (input.title !== undefined) assetName(input.title);
    if (input.conversationId !== undefined && !libraryId(input.conversationId)) throw new Error('Invalid asset conversation');
    if (input.parentVersionId && !input.assetId) throw new Error('Choose an asset before editing a version');
    if (input.assetId) {
      const asset = await this.get(input.assetId);
      if (asset.trashedAt || input.parentVersionId && !assetVersion(asset, input.parentVersionId)) throw new Error('ASSET_VERSION_UNAVAILABLE');
    }
    if (input.references !== undefined && !Array.isArray(input.references)) throw new Error('Asset references must be an array');
    for (const reference of input.references ?? []) {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference) || Object.keys(reference).some(key => !['assetId', 'versionId'].includes(key))
        || !libraryId(reference.assetId) || !libraryId(reference.versionId)) throw new Error('Invalid asset reference');
      await this.resolve(reference);
    }
  }
  /** Snapshot untrusted local input before decoding, hashing or taking the metadata lock. */
  async prepare(sourcePath: string) {
    const staging = await this.file(`staging/${randomUUID()}`);
    await mkdir(path.dirname(staging), { recursive: true, mode: 0o700 });
    const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await source.stat();
      if (!info.isFile() || !info.size || info.size > MAX_ASSET_BYTES) throw new Error('Asset must be a file of at most 500 MB');
      const digest = createHash('sha256'); let bytes = 0;
      await pipeline(source.createReadStream({ autoClose: false }), new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length; digest.update(chunk);
        callback(bytes > MAX_ASSET_BYTES ? new Error('Asset exceeds 500 MB') : null, chunk);
      } }), (await open(staging, 'wx', 0o600)).createWriteStream());
      const media = await probeLibraryMedia(staging);
      return { file: staging, media, bytes, sha256: digest.digest('hex') };
    } catch (error) { await rm(staging, { force: true }); throw error; }
    finally { await source.close(); }
  }
  /** Caller owns the workspace lock. Prepared files are private immutable snapshots. */
  async addLocked(prepared: Awaited<ReturnType<AssetLibrary['prepare']>>, input: { assetId?: string; createId?: string; name: string; version: Omit<AssetVersion, 'id' | 'createdAt' | 'filename' | 'bytes' | 'sha256' | 'mimeType'>; expectedModality?: string }) {
    const { media, bytes, sha256 } = prepared;
    if (input.expectedModality && input.expectedModality !== media.modality) throw new Error('Generated media type does not match the request');
    const existing = input.assetId ? await this.get(input.assetId) : undefined;
    if (existing?.trashedAt && input.version.source !== 'generated') throw new Error('Restore this asset before adding a version');
    if (existing && existing.modality !== media.modality) throw new Error('Asset versions must have the same media type');
    if (input.version.parentVersionId && !existing?.versions.some(v => v.id === input.version.parentVersionId)) throw new Error('ASSET_VERSION_UNAVAILABLE');
    const prior = existing?.versions.find(version => input.version.requestId && version.requestId === input.version.requestId);
    if (prior) { if (prior.requestHash !== input.version.requestHash) throw new Error('REQUEST_ID_CONFLICT'); return existing!; }
    if (input.createId && !libraryId(input.createId)) throw new Error('Invalid asset identity');
    const id = existing?.id ?? input.createId ?? randomUUID(), versionId = randomUUID();
    const filename = `media.${media.extension}`, target = await this.file(`files/${id}/${versionId}/${filename}`);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      await rename(prepared.file, target);
      const now = Date.now();
      const resolvedAudioKind = media.modality === 'audio'
        ? (isAudioKind(input.version.audioKind)
          ? input.version.audioKind
          : classifyAudioKind(input.version.model, undefined, input.version.source))
        : undefined;
      const version: AssetVersion = { ...input.version, id: versionId, createdAt: now, filename, name: input.name, mimeType: media.mimeType, bytes, sha256,
        ...(media.width ? { width: media.width, height: media.height } : {}), ...(media.duration ? { duration: media.duration } : {}), ...(media.waveform ? { waveform: media.waveform } : {}),
        ...(resolvedAudioKind ? { audioKind: resolvedAudioKind } : {}) };
      const asset: LibraryAsset = existing ?? { id, name: assetName(input.name), modality: media.modality, createdAt: now, updatedAt: now, currentVersionId: versionId, versions: [] };
      asset.versions.push(version); asset.currentVersionId = versionId; asset.updatedAt = now;
      await atomicAssetJson(await this.file(`records/${id}.json`), asset);
      return asset;
    } catch (error) { await rm(path.dirname(target), { recursive: true, force: true }); throw error; }
  }
  async importFile(sourcePath: string, input: { requestId: string; name: string; assetId?: string; parentVersionId?: string; expectedModality?: LibraryAsset['modality'] }) {
    if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new Error('A real absolute local file path is required');
    if (typeof input.requestId !== 'string' || !/^[\w-]{1,100}$/.test(input.requestId)) throw new Error('A stable requestId is required');
    assetName(input.name);
    await this.validateGeneration({ assetId: input.assetId, parentVersionId: input.parentVersionId });
    const prepared = await this.prepare(sourcePath);
    const requestHash = assetHash({ sha256: prepared.sha256, ...input });
    try {
      if (input.expectedModality && prepared.media.modality !== input.expectedModality) throw new Error('Unsupported media type');
      return await this.store.lock(async () => {
        const receipt = await this.file(`requests/${assetHash(input.requestId)}.json`);
        const previous = await readFile(receipt, 'utf8').then(value => JSON.parse(value), (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
        if (previous) {
          if (previous.requestHash !== requestHash) throw new Error('REQUEST_ID_CONFLICT');
          try { const saved = await this.get(previous.assetId); if (saved.versions.some(v => v.requestId === input.requestId)) return saved; }
          catch (error) { if ((error as Error).message !== 'ASSET_NOT_FOUND') throw error; }
        }
        const id = previous?.assetId ?? input.assetId ?? randomUUID();
        // Reserve the identity before committing bytes: an interrupted retry cannot duplicate an asset.
        await atomicAssetJson(receipt, { requestHash, assetId: id });
        return this.addLocked(prepared, { assetId: input.assetId, createId: id, name: input.name,
          version: { source: 'upload', references: [], parentVersionId: input.parentVersionId, requestId: input.requestId, requestHash } });
      });
    } finally { await rm(prepared.file, { force: true }); }
  }
  async update(id: string, input: { name?: string; trashed?: boolean; currentVersionId?: string }) {
    if (!input || Object.keys(input).some(key => !['name', 'trashed', 'currentVersionId'].includes(key))) throw new Error('Invalid asset update');
    if (input.name !== undefined) assetName(input.name);
    if (input.trashed !== undefined && typeof input.trashed !== 'boolean') throw new Error('Invalid trash state');
    return this.store.lock(async () => {
      const asset = await this.get(id);
      if (input.name !== undefined) asset.name = input.name.trim();
      if (input.trashed === true) asset.trashedAt ??= Date.now();
      if (input.trashed === false) delete asset.trashedAt;
      if (input.currentVersionId !== undefined) {
        if (!assetVersion(asset, input.currentVersionId)) throw new Error('ASSET_VERSION_UNAVAILABLE');
        asset.currentVersionId = input.currentVersionId;
      }
      asset.updatedAt = Date.now(); await atomicAssetJson(await this.file(`records/${id}.json`), asset); return asset;
    });
  }
}
