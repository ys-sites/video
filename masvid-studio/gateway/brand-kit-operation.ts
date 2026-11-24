import { brandCatalogFile } from '../shared/brand-catalog.ts';
import { brandKitInstruction } from '../shared/brand-kit.ts';
import { readBrandCatalog } from './brand-catalog.ts';
import type { BrandKitLibrary } from './brand-kits.ts';

/** MCP adapter; Studio's HTTP routes call the same library and workspace records. */
export async function brandKitOperation(library: BrandKitLibrary, command: Record<string, any>, origin: string) {
  const { operation, kitId, expectedUpdatedAt, catalogId, url, requestId, name, style, rules, file, remove } = command;
  switch (operation) {
    case 'catalog': {
      const { revision, entries } = await readBrandCatalog();
      const query = command.query?.trim().toLowerCase() || '';
      return { revision, entries: entries.filter(entry => `${entry.name} ${entry.category} ${entry.tags.join(' ')}`.toLowerCase().includes(query))
        .map(({ id, name, category, websiteUrl, sourceUrl }) => ({ id, name, category, websiteUrl, sourceUrl })) };
    }
    case 'list': return { kits: (await library.list()).map(({ id, name, state, updatedAt, catalogId }) => ({ id, name, state, updatedAt, catalogId })) };
    case 'get': return { kit: await library.get(kitId) };
    case 'create': return { kit: await library.create(url, requestId) };
    case 'import': return { kit: await library.importCatalog(catalogId) };
    case 'preview': {
      const kit = await library.get(kitId);
      const preview = new URL('/', origin);
      preview.searchParams.set('page', 'brand-kit');
      preview.searchParams.set('kit', kit.id);
      const originalCatalog = kit.catalogId && !kit.nameOverride && !Object.keys(kit.styleOverrides || {}).length;
      const media = originalCatalog ? brandCatalogFile(kit.catalogId!, 'showcase') : kit.state === 'ready' && kit.preview ?
        `/motion-api/brand-kits/${kit.id}/files/preview.mp4?v=${encodeURIComponent(kit.updatedAt)}` : undefined;
      return { kitId: kit.id, updatedAt: kit.updatedAt, state: kit.state, previewUrl: preview.href, ...(media ? { mediaUrl: new URL(media, origin).href } : {}) };
    }
    case 'package': {
      const { kit, packageZipPath } = await library.packageSnapshot(kitId, expectedUpdatedAt);
      return { kitId: kit.id, updatedAt: kit.updatedAt, packageZipPath, instruction: brandKitInstruction({ ...kit, packagePath: packageZipPath }) };
    }
    case 'retry': return { kit: await library.retry(kitId, undefined, expectedUpdatedAt) };
    case 'rescan': return { kit: await library.retry(kitId, { rescan: true }, expectedUpdatedAt) };
    case 'edit': {
      if (name === undefined && style === undefined) throw new Error('INVALID_ARGUMENT: Supply a name or style.');
      return { kit: await library.retry(kitId, { name, style }, expectedUpdatedAt) };
    }
    case 'context': {
      if (rules === undefined && file === undefined && remove === undefined) throw new Error('INVALID_ARGUMENT: Supply brand rules or a file change.');
      return { kit: await library.updateContext(kitId, { rules, file, remove }, expectedUpdatedAt) };
    }
    case 'cancel': return { kit: await library.cancel(kitId) };
    case 'remove':
      await library.remove(kitId, expectedUpdatedAt);
      return { kitId, removed: true };
    default: throw new Error('INVALID_ARGUMENT: Unknown Brand Kit operation.');
  }
}
