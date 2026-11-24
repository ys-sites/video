import { blackFridayReference } from './shared/black-friday-collection.ts';
import { loadLibrarySkills, assertSkillIds, skillUsage, skillNextStep } from './shared/library-skill-catalog.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isShortFormTemplate, templatePage, templateWorkflow, type GalleryTemplate } from './shared/catalog.ts';
import { catalogLocale } from './shared/template-locale.ts';
import { templateConfig } from './shared/template-config.ts';
import { libraryTemplates, templateRecipe } from './template-catalog.ts';
import { copyTemplate } from './template-library.ts';
import { loadRepositoryCatalog, lfsPointer, maxLfsAssetBytes, maxTemplateAssetBytes, readRepositoryFile, repositoryCatalogRoot } from './shared/repository-template-catalog.ts';
import { loadHostedCatalog, restoreHostedCatalog, serializeHostedCatalog, type HostedRepositoryCatalog, type HostedSourceManifest } from './shared/hosted-template-catalog.ts';
import { boundedMediaBody, downloadMedia, validateMediaLock } from './shared/repository-media.ts';

type TemplateFile = { path: string; url?: string; bytes: number; sha256: string };
type PrismTemplate = {
  templateId: string; sortOrder: number; original: Record<string, string>;
  indexUrl: string; previewUrl: string; coverUrl: string; files: TemplateFile[];
  conversionStatus?: string; conversionNotes?: string;
  motionDocumentUrl?: string; motionGuideUrl?: string; projectFileUrl?: string; authorAvatarUrl?: string;
  brand?: string; creationModels?: string[]; colors?: string[]; industries?: string[];
  width?: number; height?: number; featuredOrder?: number | null;
};
type Publication = {
  resourceId: string; environment: string; channel: string; publicationId: string;
  defaultLocale: string; content: Record<string, { templates: PrismTemplate[]; brands?: { name: string; logoUrl: string }[] }>;
};
type Snapshot = { etag: string | null; publication: Publication; repository?: Awaited<ReturnType<typeof loadRepositoryCatalog>>; hosted?: HostedRepositoryCatalog };
export type EditableTemplate = GalleryTemplate & { files?: TemplateFile[]; catalogVersion?: string; conversionStatus?: string; conversionNotes?: string };
const splitTags = (value = '') => value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
const builtinTemplates = libraryTemplates.filter(template => template.kind === 'builtin');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function atomicWrite(filename: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + '.' + randomUUID();
  await writeFile(temporary, content);
  await rename(temporary, filename);
}

/** One disk-backed catalog shared by the gallery and Agent tools. */
export class TemplateCatalog {
  private snapshot?: Snapshot;
  private checkedAt = 0;
  private pending?: Promise<Snapshot>;
  private warning?: string;
  readonly environment: string;
  readonly resourceId: string;
  readonly locale: string;
  readonly url: string;
  readonly directory: string;
  readonly source: 'repository' | 'hosted' | 'cms';
  readonly repositoryRoot: string;
  private readonly request: typeof fetch;

  constructor(dataDirectory: string, options: { environment?: string; resourceId?: string; locale?: string; fetch?: typeof fetch; source?: 'repository' | 'hosted' | 'cms'; repositoryRoot?: string } = {}) {
    const config = templateConfig();
    this.environment = options.environment ?? config.environment;
    if (!['dev', 'prod'].includes(this.environment)) throw new Error('MOTION_TEMPLATE_ENV must be dev or prod');
    this.resourceId = options.resourceId ?? config.resourceId;
    this.locale = options.locale ?? config.locale;
    this.source = options.source ?? config.source;
    this.repositoryRoot = options.repositoryRoot ?? repositoryCatalogRoot;
    const origin = this.environment === 'dev' ? 'https://r.powerformer.net' : 'https://r.open-design.ai';
    this.url = `${origin}/resources/${encodeURIComponent(this.resourceId)}/channels/default/main.json`;
    this.directory = path.resolve(dataDirectory, 'template-cache', hash(this.source + ':' + this.url + this.locale).slice(0, 16));
    this.request = options.fetch ?? fetch;
  }

  private entries(publication: Publication, requested = this.locale): PrismTemplate[] {
    if (this.source === 'cms' && (publication.resourceId !== this.resourceId || publication.environment !== this.environment || publication.channel !== 'default' || !publication.publicationId)) {
      throw new Error('模板目录的发布身份不匹配');
    }
    const locale = catalogLocale(Object.keys(publication.content ?? {}), requested, publication.defaultLocale);
    const entries = publication.content?.[locale]?.templates;
    if (!Array.isArray(entries) || entries.some(item => !item.templateId || !item.original?.templateName || !Array.isArray(item.files))) {
      throw new Error(`模板目录缺少 ${locale} 模板数据`);
    }
    return entries;
  }

  async refresh(): Promise<Snapshot> {
    if (this.pending) return this.pending;
    if (this.source === 'repository') {
      this.pending = loadRepositoryCatalog(this.repositoryRoot).then(repository => ({ publication: repository.publication as Publication, etag: null, repository }))
        .finally(() => { this.pending = undefined; });
      return this.pending;
    }
    if (this.source === 'hosted') {
      if (this.snapshot && Date.now() - this.checkedAt < 300_000) return this.snapshot;
      this.pending = (async () => {
        if (!this.snapshot) {
          try {
            const cached = restoreHostedCatalog(JSON.parse(await readFile(path.join(this.directory, 'hosted-snapshot.json'), 'utf8')), this.request);
            this.snapshot = { publication: cached.publication as Publication, etag: null, hosted: cached };
            this.warning = cached.warning;
          } catch {}
        }
        try {
          const hosted = await loadHostedCatalog(this.request);
          const snapshot = { publication: hosted.publication as Publication, etag: null, hosted };
          await atomicWrite(path.join(this.directory, 'hosted-snapshot.json'), serializeHostedCatalog(hosted));
          this.snapshot = snapshot;
          this.warning = hosted.warning;
          this.checkedAt = Date.now();
          return snapshot;
        } catch (error) {
          if (!this.snapshot) {
            this.snapshot = { etag: null, publication: { resourceId: 'hosted', environment: this.environment, channel: 'default', publicationId: 'hosted-builtin-fallback', defaultLocale: 'en', content: { en: { templates: [] } } } };
            this.warning = `Hosted 模板目录不可用，使用内置模板：${(error as Error).message}`;
            this.checkedAt = Date.now();
            return this.snapshot;
          }
          this.warning = `Hosted 模板更新失败，使用上次目录：${(error as Error).message}`;
          this.checkedAt = Date.now();
          return this.snapshot;
        }
      })().finally(() => { this.pending = undefined; });
      return this.pending;
    }
    const interval = this.environment === 'dev' ? 2_000 : 60_000;
    if (this.snapshot && Date.now() - this.checkedAt < interval) return this.snapshot;
    this.pending = this.download().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async download(): Promise<Snapshot> {
    const filename = path.join(this.directory, 'catalog.json');
    if (!this.snapshot) {
      try {
        const cached: Snapshot = JSON.parse(await readFile(filename, 'utf8'));
        this.entries(cached.publication);
        this.snapshot = cached;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warning = '模板缓存不可用，重新下载';
      }
    }
    try {
      const response = await this.request(this.url, {
        headers: this.snapshot?.etag ? { 'If-None-Match': this.snapshot.etag } : {},
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 304 || !this.snapshot) {
        if (!response.ok) throw new Error(`模板目录下载失败（HTTP ${response.status}）`);
        const publication: Publication = await response.json();
        this.entries(publication);
        const candidate = { publication, etag: response.headers.get('etag') };
        await atomicWrite(filename, JSON.stringify(candidate));
        this.snapshot = candidate;
      }
      this.warning = undefined;
    } catch (error) {
      if (!this.snapshot) throw error;
      this.warning = `模板更新失败，使用已缓存目录：${(error as Error).message}`;
    }
    this.checkedAt = Date.now();
    return this.snapshot!;
  }

  private templates(snapshot: Snapshot, requested = this.locale): EditableTemplate[] {
    const locale = catalogLocale(Object.keys(snapshot.publication.content), requested, snapshot.publication.defaultLocale);
    const brands = new Map([
      ...(snapshot.publication.content.en?.brands ?? []),
      ...(snapshot.publication.content[locale]?.brands ?? []),
    ].map(brand => [brand.name, brand.logoUrl]));
    const remote: EditableTemplate[] = [...this.entries(snapshot.publication, requested)].sort((a, b) => a.sortOrder - b.sortOrder).map(item => {
      const record = snapshot.repository?.records.get(item.templateId) ?? snapshot.hosted?.records.get(item.templateId);
      const localMedia = record?.localMedia;
      const localUrl = (name: string) => {
        const remote = record.remoteAssets?.find((asset: { source: { path: string } }) => asset.source.path === name);
        if (remote) { validateMediaLock({ path: name, ...remote }); return remote.url; }
        return `/api/template-source/${item.templateId}/${name.split('/').map(encodeURIComponent).join('/')}`;
      };
      return {
        id: item.templateId, title: item.original.templateName, subtitle: item.original.category || 'Motion',
        description: item.original.summary || '', kind: 'prism' as const, collection: 'example' as const,
        tags: [item.original.promotionalUseCases, item.original.visualPresentation, item.original.motionTags].filter(Boolean).flatMap(value => value.split(/[,，·]/).map(tag => tag.trim()).filter(Boolean)),
        duration: Number(item.original.durationSeconds) || undefined,
        author: item.original.author || item.original.attributionNickname || '',
        sourceUrl: item.original.sourceUrl, previewUrl: localMedia?.preview ? localUrl(localMedia.preview) : item.previewUrl,
        posterUrl: localMedia?.poster ? localUrl(localMedia.poster) : item.coverUrl,
        files: item.files, catalogVersion: snapshot.repository?.version ?? snapshot.hosted?.version ?? snapshot.publication.publicationId,
        conversionStatus: item.conversionStatus, conversionNotes: item.conversionNotes,
        motionDocumentUrl: snapshot.repository || snapshot.hosted ? `/api/template-source/${item.templateId}/motion.md` : item.motionDocumentUrl,
        motionGuideUrl: snapshot.repository || snapshot.hosted ? `/api/template-source/${item.templateId}/preview.html` : item.motionGuideUrl,
        ...(snapshot.repository ? { localSource: snapshot.repository.sources.get(item.templateId) } : {}),
        projectFileUrl: item.projectFileUrl, authorAvatarUrl: item.authorAvatarUrl,
        styleDescription: item.original.styleDescription, reviewFocus: item.original.reviewFocus,
        brand: item.brand, brandLogoUrl: brands.get(item.brand ?? ''), uses: splitTags(item.original.promotionalUseCases), styles: splitTags(item.original.visualPresentation),
        industries: item.industries ?? [], creationModels: item.creationModels ?? [], colors: item.colors ?? [],
        width: item.width, height: item.height, sortOrder: item.sortOrder, featuredOrder: item.featuredOrder ?? null,
        hasHtmlProject: item.files.some(file => file.path === 'index.html'),
      };
    });
    return [...remote, ...builtinTemplates];
  }

  private async skills(snapshot: Snapshot) {
    // CMS publishes templates only; Skills come from the library/skills shipped with this application.
    const skills = this.source === 'hosted' ? snapshot.hosted?.skills ?? [] : await loadLibrarySkills();
    assertSkillIds(skills, this.templates(snapshot).map(item => item.id));
    return skills;
  }

  // CMS Skill reads never wait on (or fail with) a template publication download.
  private async skillSource() {
    if (this.source === 'cms') return { skills: await loadLibrarySkills(), snapshot: undefined };
    const snapshot = await this.refresh();
    return { skills: await this.skills(snapshot), snapshot };
  }

  async index() {
    const snapshot = await this.refresh();
    const items = this.templates(snapshot);
    const catalogVersion = snapshot.repository?.version ?? snapshot.hosted?.version ?? snapshot.publication.publicationId;
    const indexPath = path.join(this.directory, `templates.${hash('short-form-v1:' + catalogVersion).slice(0, 16)}.index.jsonl`);
    const lines = items.map(item => JSON.stringify({ templateId: item.id, name: item.title, summary: item.description,
      category: item.subtitle, tags: item.tags, durationSeconds: item.duration, shortForm: isShortFormTemplate(item) || undefined, kind: item.kind, localSource: item.localSource })).join('\n') + '\n';
    await atomicWrite(indexPath, lines);
    return { indexPath, total: items.length, catalogVersion, source: this.source, warning: this.warning };
  }

  // Library Skills have their own index and detail tools; they share only the hosted publication and object store.
  async skillIndex() {
    const { skills } = await this.skillSource();
    const skillVersion = hash(JSON.stringify(skills));
    const indexPath = path.join(this.directory, `skills.${skillVersion.slice(0, 16)}.index.jsonl`);
    const lines = skills.map(({ instructions: _instructions, files: _files, objects: _objects, ...skill }) => JSON.stringify({ ...skill, skillId: skill.id })).join('\n');
    await atomicWrite(indexPath, lines ? lines + '\n' : '');
    return { indexPath, total: skills.length, skillVersion, source: this.source,
      ...(this.source !== 'cms' && this.warning ? { warning: this.warning } : {}) };
  }

  async skillDetail(id: string) {
    const { skills, snapshot } = await this.skillSource();
    const skill = skills.find(item => item.id === id);
    if (!skill) throw new Error('Skill 不存在，请先调用 openmotion_list_skills 获取 Skill 目录');
    // Hosted/npm installs have no library files; publish them as hash-verified objects like template sources.
    const objects = skill.localSource ? undefined : skill.objects?.map(file => ({ ...file, url: `${snapshot!.hosted!.objectBaseUrl}/${file.sha256}` }));
    return { ...skill, ...(objects ? { objects } : {}), skillId: skill.id, motionDocument: { path: skill.localSource ? path.join(skill.localSource, 'SKILL.md') : 'SKILL.md', content: skill.instructions }, source: this.source,
      workflowGuide: { workflow: 'skill', nextStep: objects ? skillNextStep + ' Supporting files are not installed locally: download only the ones SKILL.md references from objects[].url into your working directory at objects[].path, and check bytes and sha256 before running scripts or reading references.' : skillNextStep } };
  }

  async page(options: Parameters<typeof templatePage>[1] & { covered?: boolean; locale?: string } = {}) {
    const snapshot = await this.refresh();
    const items = this.templates(snapshot, options.locale).map(({ files: _files, ...item }) => item);
    const visible = options.covered ? items.filter(item => item.posterUrl) : items;
    return { ...templatePage(visible, options), catalogTotal: items.length, catalogVersion: snapshot.repository?.version ?? snapshot.hosted?.version ?? snapshot.publication.publicationId, source: this.source, warning: this.warning };
  }

  async get(id: string): Promise<EditableTemplate> {
    if (this.source === 'repository' && (await loadLibrarySkills()).some(item => item.id === id)) throw new Error(skillUsage);
    const builtin = builtinTemplates.find(item => item.id === id);
    if (builtin) return builtin;
    const snapshot = await this.refresh();
    if ((await this.skills(snapshot)).some(item => item.id === id)) throw new Error(skillUsage);
    const template = this.templates(snapshot).find(item => item.id === id) ?? blackFridayReference(id, this.locale);
    if (!template) throw new Error('模板不存在，请重新获取模板目录');
    return template;
  }

  async detail(id: string) {
    const builtin = builtinTemplates.find(item => item.id === id);
    if (builtin) return { ...builtin, instructions: templateRecipe(builtin), source: this.source,
      workflowGuide: { workflow: 'template', section: 'start', status: 'ready' }, warning: this.warning };
    const snapshot = await this.refresh();
    if ((await this.skills(snapshot)).some(item => item.id === id)) throw new Error(skillUsage);
    const template = this.templates(snapshot).find(item => item.id === id);
    if (!template) {
      const reference = blackFridayReference(id, this.locale);
      if (!reference) throw new Error('模板不存在，请重新获取模板目录');
      return { ...reference, instructions: templateRecipe(reference), source: this.source,
        workflowGuide: { workflow: 'recreate', section: 'start', status: 'ready' }, warning: this.warning };
    }
    if (template.localSource) {
      const instructions = (await readRepositoryFile(this.repositoryRoot, id + '/TEMPLATE.md')).toString('utf8');
      const content = (await readRepositoryFile(this.repositoryRoot, id + '/source/motion.md')).toString('utf8');
      return { ...template, instructions, motionDocument: { path: template.localSource.motionPath, content }, source: this.source,
        workflowGuide: { workflow: templateWorkflow(template), section: 'start', status: 'ready' } };
    }
    if (snapshot.hosted && template.kind !== 'builtin') {
      const instructions = (await this.hostedFile(snapshot, id, 'TEMPLATE.md')).toString('utf8');
      const content = (await this.sourceFile(id, 'motion.md')).toString('utf8');
      return { ...template, instructions, motionDocument: { path: `/api/template-source/${id}/motion.md`, content }, source: this.source,
        workflowGuide: { workflow: templateWorkflow(template), section: 'start', status: 'ready' }, warning: this.warning };
    }
    const guide = template.files?.find(file => file.path === 'TEMPLATE.md');
    const instructions = guide ? (await this.downloadFile(id, guide)).toString('utf8') : templateRecipe(template);
    return { ...template, instructions, workflowGuide: { workflow: templateWorkflow(template), section: 'start', status: 'ready' }, warning: this.warning };
  }

  async sourceFile(id: string, name: string): Promise<Buffer> {
    if (this.source === 'hosted') {
      const snapshot = await this.refresh();
      const record = snapshot.hosted?.records.get(id);
      if (!record) throw new Error('hosted template not found');
      const { manifest, bytes: manifestBytes } = await this.hostedManifest(snapshot, id);
      if (name === 'manifest.json') return manifestBytes;
      const expected = manifest.files.find(file => file.path === name);
      if (!expected) throw new Error('hosted template source file not found');
      const remote = record.remoteAssets?.find((asset: { source: { path: string } }) => asset.source.path === name);
      if (remote) {
        const lock = { path: name, ...remote };
        if (expected.bytes !== lock.bytes || expected.sha256 !== lock.sha256) throw new Error('Transferred media does not match its source manifest');
        return this.hostedFile(snapshot, id, name, maxLfsAssetBytes, bytes => {
          if (bytes.length !== lock.bytes || hash(bytes) !== lock.sha256) throw new Error('Transferred media does not match its source manifest');
        }, async () => downloadMedia(lock, this.request));
      }
      const bytes = await this.hostedFile(snapshot, id, 'source/' + name, maxTemplateAssetBytes, value => {
        if (lfsPointer(value)) return;
        if (expected.bytes !== undefined && (expected.bytes !== value.length || expected.sha256 !== hash(value))) throw new Error('Template media does not match its source manifest');
      });
      if (lfsPointer(bytes)) throw Object.assign(new Error(`Template media is not downloaded. Fetch the Git LFS asset for ${id}.`), { code: 'TEMPLATE_LFS_NOT_FETCHED' });
      return bytes;
    }
    if (this.source !== 'repository') throw new Error('Repository template source is unavailable');
    const catalog = JSON.parse((await readRepositoryFile(this.repositoryRoot, 'catalog.json')).toString());
    if (!/^[a-z][a-z0-9-]+$/.test(id) || !catalog.templateIds.includes(id)) throw new Error('Repository template not found');
    const manifest = JSON.parse((await readRepositoryFile(this.repositoryRoot, id + '/source/manifest.json')).toString());
    if (name !== 'manifest.json' && !manifest.files.some((file: { path: string }) => file.path === name)) throw new Error('Repository template source file not found');
    const record = JSON.parse((await readRepositoryFile(this.repositoryRoot, id + '/template.json')).toString());
    const remote = record.remoteAssets?.find((asset: { source: { path: string } }) => asset.source.path === name);
    if (remote) {
      const lock = { path: name, ...remote };
      const expected = manifest.files.find((file: { path: string }) => file.path === name);
      if (expected.bytes !== lock.bytes || expected.sha256 !== lock.sha256) throw new Error('Transferred media does not match its source manifest');
      return downloadMedia(lock, this.request);
    }
    const bytes = await readRepositoryFile(this.repositoryRoot, id + '/source/' + name, maxTemplateAssetBytes);
    const expected = manifest.files.find((file: { path: string }) => file.path === name);
    const pointer = lfsPointer(bytes);
    if (pointer) {
      const published = record.entry?.files?.find((file: TemplateFile) => file.path === name) as TemplateFile | undefined;
      if (published?.url) {
        assert(pointer.bytes <= maxLfsAssetBytes && expected?.bytes === pointer.bytes && expected.sha256 === pointer.sha256 &&
          published.bytes === pointer.bytes && published.sha256 === pointer.sha256, 'Template LFS pointer does not match its metadata');
        assert.equal(published.url, `https://r.open-design.ai/files/${pointer.sha256}`, 'Template LFS download URL must match its SHA-256');
        return this.downloadPublishedFile(published);
      }
      throw Object.assign(new Error(`Template media is not downloaded. Run git lfs pull --include="library/templates/catalog/${id}/source/assets/lfs/**" --exclude="" from the checkout.`), { code: 'TEMPLATE_LFS_NOT_FETCHED' });
    }
    if (expected?.bytes !== undefined && (expected.bytes !== bytes.length || expected.sha256 !== hash(bytes))) throw new Error('Template source file does not match its source manifest');
    return bytes;
  }

  private async downloadFile(templateId: string, file: TemplateFile): Promise<Buffer> {
    if (this.source === 'hosted' || this.source === 'repository') {
      const bytes = await this.sourceFile(templateId, file.path);
      assert(bytes.length === file.bytes && hash(bytes) === file.sha256, 'Template project file does not match its metadata');
      return bytes;
    }
    return this.downloadPublishedFile(file);
  }

  private async downloadPublishedFile(file: TemplateFile): Promise<Buffer> {
    assert(file.url, 'Template file has no download URL');
    const url = new URL(file.url);
    if (url.protocol !== 'https:' || url.hostname !== 'r.open-design.ai' || !url.pathname.startsWith('/files/')) throw new Error('模板文件地址无效');
    const cachedPath = path.join(this.directory, 'files', hash(file.url));
    const matches = (bytes: Buffer) => bytes.length === file.bytes && hash(bytes) === file.sha256;
    try {
      const cached = await readFile(cachedPath);
      if (matches(cached)) return cached;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const response = await this.request(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`模板文件下载失败：${file.path}（HTTP ${response.status}）`);
    const bytes = await boundedMediaBody(response, file.bytes);
    if (!matches(bytes)) throw new Error(`模板文件校验失败：${file.path}`);
    await atomicWrite(cachedPath, bytes);
    return bytes;
  }

  private hostedCachePath(snapshot: Snapshot, templateId: string, name: string): string {
    return path.join(this.directory, 'hosted-files', hash(`${snapshot.hosted!.commit}:${templateId}:${name}`));
  }

  private async hostedFile(snapshot: Snapshot, templateId: string, name: string, limit = 1024 * 1024, validate?: (bytes: Buffer) => void, download?: () => Promise<Buffer>): Promise<Buffer> {
    const filename = this.hostedCachePath(snapshot, templateId, name);
    try {
      const cached = await readFile(filename);
      try {
        assert(cached.length <= limit, 'hosted template file exceeds its size limit');
        validate?.(cached);
        return cached;
      } catch {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const bytes = download ? await download() : await snapshot.hosted!.fetchFile(templateId, name, limit);
    assert(bytes.length <= limit, 'hosted template file exceeds its size limit');
    validate?.(bytes);
    await atomicWrite(filename, bytes);
    return bytes;
  }

  private async hostedManifest(snapshot: Snapshot, templateId: string): Promise<{ manifest: HostedSourceManifest; bytes: Buffer }> {
    const bytes = await this.hostedFile(snapshot, templateId, 'source/manifest.json', 1024 * 1024, value => {
      const manifest = JSON.parse(value.toString('utf8')) as HostedSourceManifest;
      assert(Array.isArray(manifest.files), 'Invalid hosted template source manifest');
    });
    const manifest = JSON.parse(bytes.toString('utf8')) as HostedSourceManifest;
    assert(Array.isArray(manifest.files), 'Invalid hosted template source manifest');
    return { manifest, bytes };
  }

  async copy(template: EditableTemplate, directory: string, runtimeRoot: string): Promise<void> {
    if (template.kind === 'builtin') return copyTemplate(template.id, directory, runtimeRoot);
    if (!template.files?.some(file => file.path === 'index.html')) throw new Error('模板缺少 index.html');
    for (const file of template.files) {
      if (!file.path || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('模板文件路径无效');
    }
    const files = template.files.values();
    const workers = await Promise.allSettled(Array.from({ length: Math.min(4, template.files.length) }, async () => {
      for (const file of files) {
        const bytes = await this.downloadFile(template.id, file);
        const target = path.join(directory, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx' });
      }
    }));
    // Settle all writes before the caller removes a failed project directory.
    const failed = workers.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

const catalogs = new Map<string, TemplateCatalog>();
export function templateCatalogFor(dataDirectory: string): TemplateCatalog {
  const key = path.resolve(dataDirectory);
  let catalog = catalogs.get(key);
  if (!catalog) { catalog = new TemplateCatalog(key); catalogs.set(key, catalog); }
  return catalog;
}
