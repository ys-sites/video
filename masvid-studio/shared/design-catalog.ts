/**
 * Read-only catalogue of the Design Studio library under library/design: scenario guides,
 * starter templates, design systems, design Skills and craft references. Ported from
 * Open Design (Apache-2.0, see library/design/NOTICE.md). Node-only; synchronous reads
 * are cached in memory per library root.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  designRoutes, designScenarios, isDesignScenario,
  type DesignScenarioId, type DesignSkillSummary, type DesignSystemSummary, type DesignTemplateSummary,
} from './design-project.ts';

export const designLibraryRoot = fileURLToPath(new URL('../library/design', import.meta.url));

export const DESIGN_CATALOG_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
export const isDesignCatalogId = (value: unknown): value is string => typeof value === 'string' && DESIGN_CATALOG_ID.test(value) && !value.includes('..');

type TemplateRecord = Omit<DesignTemplateSummary, 'previewUrl'>;
type SystemRecord = Omit<DesignSystemSummary, 'previewUrl'> & { preview?: string | null };
type SkillRecord = DesignSkillSummary;
type CatalogFile<K extends string, T> = { schemaVersion: number } & { [key in K]: T[] };

export type DesignScenarioGuide = (typeof designScenarios)[number] & { guide: string };
export type DesignTemplateDetail = DesignTemplateSummary & { dir: string; files: string[]; readme: string | null };
export type DesignSystemDetail = DesignSystemSummary & { designMd: string; tokensCss: string | null };
export type DesignSkillDetail = DesignSkillSummary & { content: string; references: string[] };
export type DesignTemplateQuery = { scenario?: string; q?: string; limit?: number; cursor?: string };

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 48;
const TEXT_REFERENCE = /\.(md|markdown|txt|json|html?|css|js|mjs|svg|py|ts|ya?ml)$/i;

function readText(file: string): string | null {
  try { return readFileSync(file, 'utf8'); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null;
    throw error;
  }
}

function readJson<T>(file: string, fallback: T): T {
  const text = readText(file);
  return text === null ? fallback : JSON.parse(text) as T;
}

/** Resolve a catalogue-relative path and refuse anything that escapes `base`. */
function inside(base: string, relative: string): string | null {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) return null;
  const resolved = path.resolve(base, relative);
  const rel = path.relative(base, resolved);
  return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : resolved;
}

function listFiles(base: string): string[] {
  const out: string[] = [];
  const walk = (relative: string) => {
    let entries;
    try { entries = readdirSync(path.join(base, relative), { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(child);
    }
  };
  walk('');
  return out;
}

const normalize = (value: string) => value.toLowerCase().normalize('NFKD');
function matches(query: string | undefined, fields: Array<string | null | undefined | string[]>) {
  const q = query?.trim();
  if (!q) return true;
  const haystack = normalize(fields.flat().filter(Boolean).join(' \u0000 '));
  return normalize(q).split(/\s+/).every(term => haystack.includes(term));
}

function createCatalog(root: string) {
  const templatesDir = path.join(root, 'templates');
  const systemsDir = path.join(root, 'systems');
  const skillsDir = path.join(root, 'skills');
  const craftDir = path.join(root, 'craft');
  const scenariosDir = path.join(root, 'scenarios');

  let templateRecords: TemplateRecord[] | undefined;
  let systemRecords: SystemRecord[] | undefined;
  let skillRecords: SkillRecord[] | undefined;
  let craftRecords: { id: string; title: string }[] | undefined;
  let scenarioGuides: DesignScenarioGuide[] | undefined;

  const loadTemplates = () => templateRecords ??= readJson<CatalogFile<'templates', TemplateRecord>>(path.join(templatesDir, 'catalog.json'), { schemaVersion: 1, templates: [] }).templates
    .filter(item => isDesignCatalogId(item.id) && isDesignScenario(item.scenario));
  const loadSystems = () => systemRecords ??= readJson<CatalogFile<'systems', SystemRecord>>(path.join(systemsDir, 'catalog.json'), { schemaVersion: 1, systems: [] }).systems
    .filter(item => isDesignCatalogId(item.id));
  const loadSkills = () => skillRecords ??= readJson<CatalogFile<'skills', SkillRecord>>(path.join(skillsDir, 'catalog.json'), { schemaVersion: 1, skills: [] }).skills
    .filter(item => isDesignCatalogId(item.id))
    .map(item => ({ ...item, scenario: isDesignScenario(item.scenario) ? item.scenario : null }));

  const templateSummary = (record: TemplateRecord): DesignTemplateSummary => ({ ...record, previewUrl: designRoutes.catalogTemplatePreview(record.id, record.entry) });
  const systemSummary = ({ preview, ...record }: SystemRecord): DesignSystemSummary => ({
    ...record,
    // Systems have no dedicated static route; a preview page, when shipped, is served by the catalog system route.
    previewUrl: preview ? `${designRoutes.catalogSystem(record.id)}/${preview}` : null,
  });

  return {
    scenarios(): DesignScenarioGuide[] {
      return scenarioGuides ??= designScenarios.map(scenario => ({ ...scenario, guide: readText(path.join(scenariosDir, `${scenario.id}.md`)) ?? '' }));
    },

    templates(opts: DesignTemplateQuery = {}): { items: DesignTemplateSummary[]; nextCursor: string | null } {
      const filtered = loadTemplates().filter(item => (!opts.scenario || item.scenario === opts.scenario)
        && matches(opts.q, [item.id, item.title, item.description, item.category, item.tags, item.scenario]));
      const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(opts.limit) || DEFAULT_LIMIT)));
      const start = /^\d+$/.test(opts.cursor ?? '') ? Number(opts.cursor) : 0;
      const items = filtered.slice(start, start + limit).map(templateSummary);
      return { items, nextCursor: start + limit < filtered.length ? String(start + limit) : null };
    },

    template(id: string): DesignTemplateDetail | null {
      if (!isDesignCatalogId(id)) return null;
      const record = loadTemplates().find(item => item.id === id);
      const dir = record && inside(templatesDir, id);
      if (!record || !dir || !existsSync(dir)) return null;
      return { ...templateSummary(record), dir, files: listFiles(dir), readme: readText(path.join(dir, 'README.md')) };
    },

    /** Absolute path of a template file for static preview serving, or null when missing or outside the template. */
    templateFile(id: string, relative: string): string | null {
      if (!isDesignCatalogId(id) || !loadTemplates().some(item => item.id === id)) return null;
      const dir = inside(templatesDir, id);
      const file = dir && inside(dir, relative);
      try { return file && statSync(file).isFile() ? file : null; } catch { return null; }
    },

    systems(opts: { q?: string; category?: string } = {}): DesignSystemSummary[] {
      return loadSystems().filter(item => (!opts.category || item.category === opts.category)
        && matches(opts.q, [item.id, item.title, item.description, item.category])).map(systemSummary);
    },

    system(id: string): DesignSystemDetail | null {
      if (!isDesignCatalogId(id)) return null;
      const record = loadSystems().find(item => item.id === id);
      const dir = record && inside(systemsDir, id);
      const designMd = dir ? readText(path.join(dir, 'DESIGN.md')) : null;
      if (!record || !dir || designMd === null) return null;
      return { ...systemSummary(record), designMd, tokensCss: readText(path.join(dir, 'tokens.css')) };
    },

    skills(opts: { scenario?: string; q?: string } = {}): DesignSkillSummary[] {
      return loadSkills().filter(item => (!opts.scenario || item.scenario === opts.scenario)
        && matches(opts.q, [item.id, item.title, item.description, item.category, item.scenario]));
    },

    skill(id: string): DesignSkillDetail | null {
      if (!isDesignCatalogId(id)) return null;
      const record = loadSkills().find(item => item.id === id);
      const dir = record && inside(skillsDir, id);
      const content = dir ? readText(path.join(dir, 'SKILL.md')) : null;
      if (!record || !dir || content === null) return null;
      return { ...record, content, references: listFiles(dir).filter(file => file !== 'SKILL.md' && TEXT_REFERENCE.test(file)) };
    },

    skillReference(id: string, relative: string): string | null {
      if (!isDesignCatalogId(id) || !loadSkills().some(item => item.id === id)) return null;
      const dir = inside(skillsDir, id);
      const file = dir && inside(dir, relative);
      return file && TEXT_REFERENCE.test(file) ? readText(file) : null;
    },

    craft(): { id: string; title: string }[] {
      return craftRecords ??= listFiles(craftDir)
        .filter(file => /^[a-z0-9][a-z0-9._-]*\.md$/.test(file) && file !== 'README.md')
        .map(file => {
          const id = file.slice(0, -3);
          const heading = /^#\s+(.+)$/m.exec(readText(path.join(craftDir, file)) ?? '')?.[1]?.trim();
          return { id, title: heading || id };
        });
    },

    craftDoc(id: string): string | null {
      if (!isDesignCatalogId(id) || id === 'README') return null;
      return readText(path.join(craftDir, `${id}.md`));
    },
  };
}

export type DesignCatalog = ReturnType<typeof createCatalog>;
const catalogs = new Map<string, DesignCatalog>();

export function designCatalog(root = designLibraryRoot): DesignCatalog {
  const key = path.resolve(root);
  let catalog = catalogs.get(key);
  if (!catalog) catalogs.set(key, catalog = createCatalog(key));
  return catalog;
}

/** Drop cached catalogue reads (tests and library maintenance scripts). */
export function resetDesignCatalogCache() { catalogs.clear(); }

export type { DesignScenarioId };
