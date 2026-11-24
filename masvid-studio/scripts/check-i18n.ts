import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../shared/entry.ts';
import {
  I18N_EXTENSION_SOURCES,
  NON_ENGLISH_LOCALES,
  type Message,
  type NonEnglishLocale,
} from '../studio/src/i18n/manifest.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Legacy multi-locale UI JSON files that predate the strict 10-locale
 * completeness requirement. Any new `*-ui.json` file must provide all 10
 * non-English locales with identical key sets; remove files from this list
 * once their remaining translations are backfilled.
 */
const LEGACY_PARTIAL_UI_FILES = new Set<string>([
  'studio/src/i18n/assets-ui.json',
  'studio/src/i18n/brand-kit-ui.json',
  'studio/src/i18n/design-ui.json',
  'studio/src/i18n/mcp-ui.json',
  'studio/src/i18n/model-hub-ui.json',
  'studio/src/i18n/platform-export-ui.json',
  'studio/src/i18n/settings-ui.json',
  'studio/src/i18n/template-ui.json',
  'studio/src/i18n/transcript-ui.json',
]);

/**
 * Legacy zh-CN keys whose values already differed across multiple `*-ui.json`
 * modules before the cross-file conflict gate was added. New keys must never
 * silently redefine an existing key with a different translation.
 */
const LEGACY_CONFLICTING_ZH_KEYS = new Set<string>([
  'Adapt the full video',
  'All categories',
  'Aspect ratio',
  'Coming soon',
  'Copy command',
  'Create',
  'Explainers',
  'In progress',
  'Model default',
  'Move to trash',
  'No matching models',
  'No matching providers',
  'Off',
  'On',
  'Reload preview',
  'Save version',
  'Sign in',
  'Tension riser',
  '{count} generating',
]);

function extractPlaceholders(text: string): string {
  return [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
}

function validateEntries(file: string, locale: string, entries: Record<string, Message>): void {
  for (const [source, value] of Object.entries(entries)) {
    const texts = typeof value === 'string' ? [value] : Object.values(value ?? {});
    assert.ok(texts.length > 0, `${file} [${locale}] "${source}" has no translation values`);
    const expectedPlaceholders = extractPlaceholders(source);
    for (const text of texts) {
      assert.equal(typeof text, 'string', `${file} [${locale}] "${source}" must be a string`);
      assert.ok(text.trim().length > 0, `${file} [${locale}] "${source}" cannot be empty`);
      assert.equal(
        extractPlaceholders(text),
        expectedPlaceholders,
        `${file} [${locale}] "${source}" has mismatched {var} placeholders in "${text}"`,
      );
    }
  }
}

async function readJson<T>(relativePath: string): Promise<T> {
  const fullPath = path.resolve(root, relativePath);
  return JSON.parse(await readFile(fullPath, 'utf8')) as T;
}

export async function checkI18n(): Promise<void> {
  const supported = new Set<string>(NON_ENGLISH_LOCALES);

  // 1. Manifest <-> disk file parity for studio/src/i18n/*.json and skill-library/*.json
  const registeredPaths = new Set<string>(NON_ENGLISH_LOCALES.map(locale => `studio/src/i18n/${locale}.json`));
  for (const source of I18N_EXTENSION_SOURCES) {
    if (source.kind === 'multi-locale-json') {
      registeredPaths.add(source.path);
    } else if (source.kind === 'mvp-split') {
      registeredPaths.add(source.zhPath);
      registeredPaths.add(source.othersPath);
    } else if (source.kind === 'per-locale-dir') {
      for (const locale of NON_ENGLISH_LOCALES) registeredPaths.add(`${source.dir}/${locale}.json`);
    }
  }

  for (const entry of await readdir(path.join(root, 'studio/src/i18n'))) {
    if (!entry.endsWith('.json')) continue;
    const rel = `studio/src/i18n/${entry}`;
    assert.ok(
      registeredPaths.has(rel),
      `Unregistered i18n JSON file "${rel}". Add it to I18N_EXTENSION_SOURCES in studio/src/i18n/manifest.ts.`,
    );
  }
  for (const entry of await readdir(path.join(root, 'studio/src/i18n/skill-library'))) {
    if (!entry.endsWith('.json')) continue;
    const rel = `studio/src/i18n/skill-library/${entry}`;
    assert.ok(
      registeredPaths.has(rel),
      `Unregistered skill-library locale file "${rel}".`,
    );
  }

  // 2. Validate per-locale base dictionaries and skill-library dictionaries (strict 10-locale parity)
  for (const dir of ['studio/src/i18n', 'studio/src/i18n/skill-library']) {
    const zhRef = await readJson<Record<string, Message>>(`${dir}/zh-CN.json`);
    const refKeys = Object.keys(zhRef).sort();
    for (const locale of NON_ENGLISH_LOCALES) {
      const file = `${dir}/${locale}.json`;
      const entries = await readJson<Record<string, Message>>(file);
      const keys = Object.keys(entries).sort();
      assert.deepEqual(keys, refKeys, `${file} keys diverge from ${dir}/zh-CN.json`);
      validateEntries(file, locale, entries);
    }
  }

  // 3. Validate all extension sources, placeholder parity, 10-locale ratchet, and cross-file conflicts
  const zhKeyOrigins = new Map<string, Map<string, string>>();

  for (const source of I18N_EXTENSION_SOURCES) {
    if (source.kind === 'per-locale-dir') continue;

    if (source.kind === 'mvp-split') {
      const zhEntries = await readJson<Record<string, Message>>(source.zhPath);
      validateEntries(source.zhPath, 'zh-CN', zhEntries);
      const others = await readJson<Record<string, Record<string, Message>>>(source.othersPath);
      const expectedLocales = NON_ENGLISH_LOCALES.filter(locale => locale !== 'zh-CN');
      assert.deepEqual(Object.keys(others).sort(), [...expectedLocales].sort(), `${source.othersPath} locales mismatch`);
      const refKeys = Object.keys(others[expectedLocales[0]]).sort();
      for (const locale of expectedLocales) {
        assert.deepEqual(Object.keys(others[locale]).sort(), refKeys, `${source.othersPath} [${locale}] keys mismatch`);
        validateEntries(source.othersPath, locale, others[locale]);
      }
      continue;
    }

    const file = source.path;
    const data = await readJson<Record<string, Record<string, Message>>>(file);
    const allowEn = file === 'shared/asset-name-ui.json';
    for (const locale of Object.keys(data)) {
      if (allowEn && locale === 'en') continue;
      assert.ok(supported.has(locale), `${file} contains unsupported locale key "${locale}"`);
      validateEntries(file, locale, data[locale]);
    }

    const isLegacyPartial = LEGACY_PARTIAL_UI_FILES.has(file);
    if (!isLegacyPartial) {
      for (const locale of NON_ENGLISH_LOCALES) {
        assert.ok(Object.hasOwn(data, locale), `${file} is missing required locale "${locale}"`);
      }
      const refKeys = Object.keys(data['zh-CN']).sort();
      for (const locale of NON_ENGLISH_LOCALES) {
        assert.deepEqual(
          Object.keys(data[locale]).sort(),
          refKeys,
          `${file} [${locale}] keys must match zh-CN keys`,
        );
      }
    }

    const zhEntries = data['zh-CN'];
    if (zhEntries) {
      for (const [key, value] of Object.entries(zhEntries)) {
        const serialized = JSON.stringify(value);
        let origins = zhKeyOrigins.get(key);
        if (!origins) {
          origins = new Map();
          zhKeyOrigins.set(key, origins);
        }
        origins.set(file, serialized);
      }
    }
  }

  for (const [key, origins] of zhKeyOrigins) {
    if (origins.size <= 1) continue;
    const distinctValues = new Set(origins.values());
    if (distinctValues.size > 1 && !LEGACY_CONFLICTING_ZH_KEYS.has(key)) {
      const files = [...origins.keys()].join(', ');
      assert.fail(
        `Conflicting zh-CN translations for key "${key}" across multiple UI JSON files (${files}). ` +
        `Consolidate the shared key into one module or align the translation.`,
      );
    }
  }
}

if (isMain(import.meta.url)) {
  await checkI18n();
  console.log('Studio i18n manifest, completeness, placeholder parity and conflict checks passed.');
}
