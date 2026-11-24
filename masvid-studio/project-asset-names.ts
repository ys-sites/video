import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceStore } from './workspace.ts';
import { atomicJson, jsonFile } from './phase1-versions.ts';
import { withProcessLock } from './shared/process-lock.ts';
import { fontFaces, loadFontParser, readFontFile } from './shared/studio-fonts.ts';
import { FONT_EXT, meaningfulAssetName, allocateProjectAssetNames, type AssetNameAllocations, type ProjectAssetName } from './shared/asset-names.ts';

const allocationFile = (store: WorkspaceStore) => path.join(store.directory, 'phase1', 'asset-names', store.projectId + '.json');

async function optionalJson(store: WorkspaceStore, file: string, fallback: any) {
  try { return JSON.parse(await readFile(await store.safePath(file), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}

/** Shared read model for MCP and Studio. Existing projects need no migration. */
export async function readProjectAssetNames(store: WorkspaceStore, paths?: readonly string[], fonts?: Parameters<typeof allocateProjectAssetNames>[3], runtimeRoot?: string) {
  const file = allocationFile(store);
  return withProcessLock(file + '.lock', async () => {
    const [meta, records] = await Promise.all([
      optionalJson(store, 'motion-project.json', {}), optionalJson(store, 'motion-assets.json', []),
    ]);
    if (!Array.isArray(records)) throw new Error('INVALID_ASSET_INDEX');
    const assetPaths = paths ?? (await store.files()).map(file => file.path);
    // Studio already inspected fonts for its editor picker. MCP lazily parses only
    // anonymous historical faces absent from the import index, using the same parser.
    if (!fonts && runtimeRoot) {
      const parsed: Array<NonNullable<ProjectAssetName['font']> & { path: string }> = [];
      for (const assetPath of assetPaths) {
        if (!FONT_EXT.test(assetPath) || meaningfulAssetName(assetPath.split('/').at(-1))
          || records.some(record => record.path === assetPath && (record.font?.family || meaningfulAssetName(record.name)))) continue;
        try {
          const face = fontFaces(await readFontFile(await store.safePath(assetPath)), loadFontParser(runtimeRoot))[0];
          if (face) parsed.push({ ...face, path: assetPath });
        } catch { /* Unreadable historical fonts receive the localized type fallback. */ }
      }
      fonts = parsed;
    }
    const language = typeof meta.namingLanguage === 'string' ? meta.namingLanguage : null;
    const previous = await jsonFile<AssetNameAllocations>(file, {});
    const { names, allocations } = allocateProjectAssetNames(assetPaths, records as ProjectAssetName[], language ?? 'en', fonts, previous);
    if (JSON.stringify(previous) !== JSON.stringify(allocations)) await atomicJson(file, allocations);
    return { namingLanguage: language, assetNames: names };
  });
}

/** Native deletion and metadata cleanup share the workspace authority used by Agent edits. */
export async function deleteProjectAsset(store: WorkspaceStore, assetPath: string, remove: () => Promise<Response>) {
  return store.lock(() => withProcessLock(allocationFile(store) + '.lock', async () => {
    const records = await optionalJson(store, 'motion-assets.json', []) as ProjectAssetName[];
    if (!Array.isArray(records)) throw new Error('INVALID_ASSET_INDEX');
    const response = await remove();
    if (!response.ok) return response;
    const deleted = (file: string) => file === assetPath || file.startsWith(assetPath + '/');
    const remaining = records.filter(record => !deleted(record.path));
    if (remaining.length !== records.length) await atomicJson(await store.safePath('motion-assets.json'), remaining);
    const allocations = await jsonFile<AssetNameAllocations>(allocationFile(store), {});
    const kept = Object.fromEntries(Object.entries(allocations).filter(([file]) => !deleted(file)));
    if (Object.keys(kept).length !== Object.keys(allocations).length) await atomicJson(allocationFile(store), kept);
    return response;
  }));
}
