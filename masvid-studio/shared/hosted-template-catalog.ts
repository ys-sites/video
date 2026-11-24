import type { LibrarySkill } from './library-skill-catalog.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { boundedMediaBody } from './repository-media.ts';
import type { PublishedTemplate, TemplatePublication } from './repository-template-catalog.ts';

export const hostedCatalogUrl = 'https://releases.open-design.ai/open-motion/templates/main/catalog.json';
const maxJsonBytes = 1024 * 1024;
// The main catalog embeds library Skill instructions; per-file reads keep the 1 MB cap.
const maxCatalogBytes = 16 * 1024 * 1024;

type Request = typeof fetch;
type TemplateRecord = { templateId: string; entry: Record<string, any>; locales: Record<string, Record<string, any>>; [key: string]: any };
type SourceFile = { path: string; bytes?: number; sha256?: string };
export type HostedSourceManifest = { files: SourceFile[]; [key: string]: any };

export type HostedRepositoryCatalog = {
  skills?: LibrarySkill[];
  commit: string;
  baseUrl: string;
  objectBaseUrl: string;
  publication: TemplatePublication;
  records: Map<string, TemplateRecord>;
  version: string;
  warning?: string;
  fetchFile: (templateId: string, name: string, limit?: number) => Promise<Buffer>;
};

type HostedRepositoryCatalogSnapshot = {
  skills?: LibrarySkill[];
  commit: string;
  baseUrl: string;
  objectBaseUrl: string;
  publication: TemplatePublication;
  records: [string, TemplateRecord][];
  warning?: string;
};

function safePath(value: string): void {
  assert(value && !/[\\\x00-\x1f:]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid hosted template path');
}

async function responseBytes(response: Response, limit: number): Promise<Buffer> {
  assert(response.ok, `Hosted template request failed (HTTP ${response.status})`);
  return boundedMediaBody(response, limit);
}

async function fetchFile(request: Request, baseUrl: string, relative: string, limit = maxJsonBytes): Promise<Buffer> {
  safePath(relative);
  return responseBytes(await request(`${baseUrl}/${relative.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { accept: 'application/octet-stream', 'user-agent': 'openmotion-template-catalog' },
    redirect: 'error', signal: AbortSignal.timeout(60_000),
  }), limit);
}

async function fetchJson(request: Request, url: string): Promise<any> {
  return JSON.parse((await responseBytes(await request(url, {
    headers: { accept: 'application/json', 'user-agent': 'openmotion-template-catalog' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  }), maxCatalogBytes)).toString('utf8'));
}

function createCatalog(manifest: any, publication: TemplatePublication, records: Map<string, TemplateRecord>, request: Request, warning?: string): HostedRepositoryCatalog {
  const commit = manifest.commit;
  const baseUrl = new URL(manifest.baseUrl || `./snapshots/${commit}`, hostedCatalogUrl).href.replace(/\/$/, '');
  const objectBaseUrl = new URL(manifest.objectBaseUrl || './objects', hostedCatalogUrl).href.replace(/\/$/, '');
  const sourceManifests = new Map<string, HostedSourceManifest>();
  const loadSourceManifest = async (templateId: string) => {
    let value = sourceManifests.get(templateId);
    if (value) return value;
    const bytes = await fetchFile(request, baseUrl, `${templateId}/hosted-files.json`);
    value = JSON.parse(bytes.toString('utf8')) as HostedSourceManifest;
    assert(Array.isArray(value.files), 'Invalid hosted template source manifest');
    sourceManifests.set(templateId, value);
    return value;
  };
  return {
    skills: manifest.skills ?? [], commit, baseUrl, objectBaseUrl, publication, records, warning, version: 'hosted:' + commit,
    fetchFile: async (templateId, name, limit = maxJsonBytes) => {
      assert(records.has(templateId), 'Hosted template not found');
      if (name === 'source/manifest.json' || name === 'TEMPLATE.md' || name === 'hosted-files.json') return fetchFile(request, baseUrl, `${templateId}/${name}`, limit);
      safePath(name);
      assert(name.startsWith('source/'), 'Hosted template file must be under source/');
      const relative = name.slice('source/'.length);
      const sourceManifest = await loadSourceManifest(templateId);
      const expected = sourceManifest.files.find(file => file.path === relative);
      assert(expected?.sha256 && /^[a-f0-9]{64}$/.test(expected.sha256), 'Hosted template source file has no content hash');
      const bytes = await fetchFile(request, objectBaseUrl, expected.sha256, limit);
      assert(bytes.length === expected.bytes && createHash('sha256').update(bytes).digest('hex') === expected.sha256, 'Hosted template source file does not match its content hash');
      return bytes;
    },
  };
}

export function serializeHostedCatalog(catalog: HostedRepositoryCatalog): string {
  return JSON.stringify({ skills: catalog.skills, commit: catalog.commit, baseUrl: catalog.baseUrl, objectBaseUrl: catalog.objectBaseUrl, publication: catalog.publication, records: [...catalog.records.entries()], warning: catalog.warning });
}

export function restoreHostedCatalog(value: unknown, request: Request = fetch): HostedRepositoryCatalog {
  assert(value && typeof value === 'object', 'Invalid cached hosted template catalog');
  const snapshot = value as Partial<HostedRepositoryCatalogSnapshot>;
  assert(typeof snapshot.commit === 'string' && /^[a-f0-9]{40}$/.test(snapshot.commit), 'Invalid cached hosted commit');
  assert(typeof snapshot.baseUrl === 'string' && typeof snapshot.objectBaseUrl === 'string' && snapshot.publication && typeof snapshot.publication === 'object' && Array.isArray(snapshot.records), 'Invalid cached hosted template catalog');
  const records = new Map<string, TemplateRecord>();
  for (const pair of snapshot.records) {
    assert(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && pair[1]?.templateId === pair[0], 'Invalid cached hosted template record');
    records.set(pair[0], pair[1]);
  }
  assert(records.size > 0, 'Cached hosted template catalog is empty');
  return createCatalog(snapshot, snapshot.publication as TemplatePublication, records, request, snapshot.warning);
}

/** Read the latest published main catalog from OpenMotion's own public CDN. */
export async function loadHostedCatalog(request: Request = fetch): Promise<HostedRepositoryCatalog> {
  const manifest = await fetchJson(request, hostedCatalogUrl);
  assert(manifest.schemaVersion === 1 && typeof manifest.commit === 'string' && /^[a-f0-9]{40}$/.test(manifest.commit), 'Invalid hosted template catalog identity');
  assert(Array.isArray(manifest.templateIds) && manifest.templateIds.length > 0, 'Invalid hosted template catalog');
  assert(new Set(manifest.templateIds).size === manifest.templateIds.length, 'Duplicate hosted template ID');
  const { locales, ...identity } = manifest.publication ?? {};
  assert(Array.isArray(locales) && locales.includes(identity.defaultLocale), 'Invalid hosted template locales');
  const publication: TemplatePublication = { ...identity, content: {} };
  for (const locale of locales) publication.content[locale] = { ...manifest.localeContent?.[locale], templates: [] };
  const records = new Map<string, TemplateRecord>();
  const failures: string[] = [];
  let cursor = 0;
  const baseUrl = new URL(manifest.baseUrl || `./snapshots/${manifest.commit}`, hostedCatalogUrl).href.replace(/\/$/, '');
  const worker = async () => {
    while (cursor < manifest.templateIds.length) {
      const id = manifest.templateIds[cursor++];
      assert(typeof id === 'string' && /^[a-z][a-z0-9-]+$/.test(id), 'Invalid hosted template ID');
      try {
        const record = JSON.parse((await fetchFile(request, baseUrl, `${id}/template.json`)).toString('utf8')) as TemplateRecord;
        assert(record.templateId === id && record.entry?.templateId === id, 'Hosted template identity mismatch');
        assert.deepEqual(Object.keys(record.locales ?? {}).sort(), [...locales].sort(), 'Hosted template locale mismatch');
        for (const locale of locales) {
          const entry = { ...record.entry, ...record.locales[locale] };
          assert(entry.templateId === id && entry.original?.templateName && Array.isArray(entry.files), 'Invalid hosted template metadata');
        }
        records.set(id, record);
      } catch (error) {
        failures.push(`${id}: ${(error as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, manifest.templateIds.length) }, () => worker()));
  assert(records.size > 0, failures.length ? `Hosted template metadata unavailable: ${failures[0]}` : 'Hosted template catalog is empty');
  // Preserve repository ordering independently of concurrent HTTP completion.
  for (const id of manifest.templateIds) {
    const record = records.get(id);
    if (!record) continue;
    for (const locale of locales) publication.content[locale].templates.push({ ...record.entry, ...record.locales[locale] } as PublishedTemplate);
  }
  const warning = failures.length ? `${failures.length} hosted template metadata entries unavailable: ${failures.slice(0, 3).join('; ')}` : undefined;
  return createCatalog({ ...manifest, baseUrl }, publication, records, request, warning);
}
