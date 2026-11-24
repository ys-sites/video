import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import {
  I18N_EXTENSION_SOURCES,
  LEGACY_ZH_EXTRA_SOURCE_KEYS,
  LEGACY_ZH_REVERSE_FILES,
  NON_ENGLISH_LOCALES,
  hashMessageKey,
  type Message,
  type NonEnglishLocale,
} from './src/i18n/manifest.ts';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const VIRTUAL_META_ID = 'virtual:openmotion-i18n/meta';
const RESOLVED_META_ID = '\0openmotion-i18n/meta.js';
const VIRTUAL_LOCALE_PREFIX = 'virtual:openmotion-i18n/locale/';
const RESOLVED_LOCALE_PREFIX = '\0openmotion-i18n/locale-';

function readJson<T = Record<string, unknown>>(relativePath: string): T {
  const fullPath = path.resolve(repoRoot, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf8')) as T;
}

function collectSourceFilesForLocale(locale: NonEnglishLocale): string[] {
  const files = [`studio/src/i18n/${locale}.json`];
  for (const source of I18N_EXTENSION_SOURCES) {
    if (source.kind === 'multi-locale-json') {
      files.push(source.path);
    } else if (source.kind === 'mvp-split') {
      files.push(locale === 'zh-CN' ? source.zhPath : source.othersPath);
    } else if (source.kind === 'per-locale-dir') {
      files.push(`${source.dir}/${locale}.json`);
    }
  }
  return files;
}

function buildLocaleDictionary(locale: NonEnglishLocale): Record<string, Message> {
  const merged: Record<string, Message> = {
    ...readJson<Record<string, Message>>(`studio/src/i18n/${locale}.json`),
  };
  for (const source of I18N_EXTENSION_SOURCES) {
    if (source.kind === 'multi-locale-json') {
      const data = readJson<Partial<Record<NonEnglishLocale, Record<string, Message>>>>(source.path);
      if (data[locale]) Object.assign(merged, data[locale]);
    } else if (source.kind === 'mvp-split') {
      if (locale === 'zh-CN') {
        Object.assign(merged, readJson<Record<string, Message>>(source.zhPath));
      } else {
        const data = readJson<Partial<Record<NonEnglishLocale, Record<string, Message>>>>(source.othersPath);
        if (data[locale]) Object.assign(merged, data[locale]);
      }
    } else if (source.kind === 'per-locale-dir') {
      Object.assign(merged, readJson<Record<string, Message>>(`${source.dir}/${locale}.json`));
    }
  }
  return merged;
}

function buildMetaModule(): { code: string; watchFiles: string[] } {
  const zhDictionary = buildLocaleDictionary('zh-CN');
  const knownKeys = Object.keys(zhDictionary);
  const hashSet = new Set<number>();
  const sortedHashes: number[] = [];
  for (const key of knownKeys) {
    const digest = hashMessageKey(key);
    if (hashSet.has(digest)) {
      throw new Error(`openmotion-i18n: hash collision detected while indexing message key "${key}"`);
    }
    hashSet.add(digest);
    sortedHashes.push(digest);
  }
  sortedHashes.sort((a, b) => a - b);
  const knownMessageDeltas: number[] = [];
  let prev = 0;
  for (const digest of sortedHashes) {
    knownMessageDeltas.push(digest - prev);
    prev = digest;
  }

  const legacyZhReverse: Record<string, string> = {};
  const recordReverse = (sourceKey: string, value: Message | undefined) => {
    if (!value) return;
    const texts = typeof value === 'string' ? [value] : Object.values(value);
    for (const text of texts) {
      if (text && text !== sourceKey) legacyZhReverse[text] = sourceKey;
    }
  };

  for (const file of LEGACY_ZH_REVERSE_FILES) {
    const data = readJson<Partial<Record<NonEnglishLocale, Record<string, Message>>>>(file);
    const zhEntries = data['zh-CN'];
    if (!zhEntries) continue;
    for (const [sourceKey, value] of Object.entries(zhEntries)) {
      recordReverse(sourceKey, value);
    }
  }
  for (const sourceKey of LEGACY_ZH_EXTRA_SOURCE_KEYS) {
    recordReverse(sourceKey, zhDictionary[sourceKey]);
  }

  const code = [
    `export const knownMessageDeltas = ${JSON.stringify(knownMessageDeltas)};`,
    `export const legacyZhReverse = ${JSON.stringify(legacyZhReverse)};`,
  ].join('\n');

  return {
    code,
    watchFiles: collectSourceFilesForLocale('zh-CN'),
  };
}

function isLocaleJsonFile(absolutePath: string): boolean {
  const relative = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
  return relative === 'shared/asset-name-ui.json' || (relative.startsWith('studio/src/i18n/') && relative.endsWith('.json'));
}

/**
 * Transposes module-split i18n JSON files into 10 independent per-locale lazy
 * chunks (`locale-zh-CN-*.js`, `locale-ja-*.js`, ...) plus a tiny eager metadata
 * module for `isKnownMessage()` and legacy Chinese backend reverse lookups.
 */
export function openmotionI18nPlugin(): Plugin {
  return {
    name: 'openmotion-i18n',
    resolveId(id) {
      if (id === VIRTUAL_META_ID) return RESOLVED_META_ID;
      if (id.startsWith(VIRTUAL_LOCALE_PREFIX)) {
        const locale = id.slice(VIRTUAL_LOCALE_PREFIX.length) as NonEnglishLocale;
        if (NON_ENGLISH_LOCALES.includes(locale)) {
          return `${RESOLVED_LOCALE_PREFIX}${locale}.js`;
        }
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_META_ID) {
        const { code, watchFiles } = buildMetaModule();
        for (const file of watchFiles) this.addWatchFile(path.resolve(repoRoot, file));
        return code;
      }
      if (id.startsWith(RESOLVED_LOCALE_PREFIX) && id.endsWith('.js')) {
        const locale = id.slice(RESOLVED_LOCALE_PREFIX.length, -3) as NonEnglishLocale;
        if (!NON_ENGLISH_LOCALES.includes(locale)) return null;
        for (const file of collectSourceFilesForLocale(locale)) {
          this.addWatchFile(path.resolve(repoRoot, file));
        }
        const dictionary = buildLocaleDictionary(locale);
        return `export default ${JSON.stringify(dictionary)};`;
      }
      return null;
    },
    handleHotUpdate(context) {
      if (!isLocaleJsonFile(context.file)) return;
      const invalidated = [];
      for (const id of [RESOLVED_META_ID, ...NON_ENGLISH_LOCALES.map(locale => `${RESOLVED_LOCALE_PREFIX}${locale}.js`)]) {
        const mod = context.server.moduleGraph.getModuleById(id);
        if (mod) {
          context.server.moduleGraph.invalidateModule(mod);
          invalidated.push(mod);
        }
      }
      return invalidated;
    },
  };
}
