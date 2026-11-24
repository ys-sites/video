import { knownMessageDeltas, legacyZhReverse } from 'virtual:openmotion-i18n/meta';
import {
  NON_ENGLISH_LOCALES,
  hashMessageKey,
  isLocale,
  languages,
  type Locale,
  type Message,
  type MessageValues,
  type NonEnglishLocale,
  type Translate,
} from './manifest';

export { languages, isLocale, NON_ENGLISH_LOCALES };
export type { Locale, NonEnglishLocale, MessageValues, Translate };

const knownKeyHashSet = (() => {
  const set = new Set<number>();
  let acc = 0;
  for (let i = 0; i < knownMessageDeltas.length; i++) {
    acc += knownMessageDeltas[i];
    set.add(acc);
  }
  return set;
})();
const loadedDictionaries: Partial<Record<NonEnglishLocale, Readonly<Record<string, Message>>>> = {};
const pendingLoads = new Map<NonEnglishLocale, Promise<void>>();
const reverseIndexes: Partial<Record<NonEnglishLocale, Map<string, string>>> = {};

async function importLocaleChunk(locale: NonEnglishLocale): Promise<Readonly<Record<string, Message>>> {
  switch (locale) {
    case 'zh-CN': return (await import('virtual:openmotion-i18n/locale/zh-CN')).default;
    case 'ja': return (await import('virtual:openmotion-i18n/locale/ja')).default;
    case 'ko': return (await import('virtual:openmotion-i18n/locale/ko')).default;
    case 'de': return (await import('virtual:openmotion-i18n/locale/de')).default;
    case 'fr': return (await import('virtual:openmotion-i18n/locale/fr')).default;
    case 'ru': return (await import('virtual:openmotion-i18n/locale/ru')).default;
    case 'es': return (await import('virtual:openmotion-i18n/locale/es')).default;
    case 'pt-BR': return (await import('virtual:openmotion-i18n/locale/pt-BR')).default;
    case 'it': return (await import('virtual:openmotion-i18n/locale/it')).default;
    case 'tr': return (await import('virtual:openmotion-i18n/locale/tr')).default;
  }
}

export function isLocaleLoaded(locale: Locale): boolean {
  return locale === 'en' || Boolean(loadedDictionaries[locale]);
}

export function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (locale === 'en' || loadedDictionaries[locale]) return Promise.resolve();
  let pending = pendingLoads.get(locale);
  if (!pending) {
    pending = importLocaleChunk(locale)
      .then(dictionary => {
        loadedDictionaries[locale] = dictionary;
        delete reverseIndexes[locale];
      })
      .finally(() => {
        pendingLoads.delete(locale);
      });
    pendingLoads.set(locale, pending);
  }
  return pending;
}

/** Preload all non-English locale dictionaries (used in unit/DOM test setup). */
export async function preloadAllLocales(): Promise<void> {
  await Promise.all(NON_ENGLISH_LOCALES.map(locale => ensureLocaleLoaded(locale)));
}

/** Clear cached locale dictionaries so tests can exercise cold lazy-loading paths. */
export function resetLoadedLocalesForTest(): void {
  for (const locale of NON_ENGLISH_LOCALES) {
    delete loadedDictionaries[locale];
    delete reverseIndexes[locale];
  }
  pendingLoads.clear();
}

function getReverseIndex(locale: Locale): Map<string, string> | undefined {
  if (locale === 'en') return undefined;
  const cached = reverseIndexes[locale];
  if (cached) return cached;
  const dictionary = loadedDictionaries[locale];
  if (!dictionary) return undefined;
  const index = new Map<string, string>();
  for (const [source, value] of Object.entries(dictionary)) {
    const texts = typeof value === 'string' ? [value] : Object.values(value);
    for (const text of texts) {
      if (text) index.set(text, source);
    }
  }
  reverseIndexes[locale] = index;
  return index;
}

const singular: Record<string, string> = {
  '{count} renders': '{count} render', '{count} layers': '{count} layer',
  '{count} works': '{count} work',
  '{count} effects': '{count} effect', '{count} elements': '{count} element',
  '{count} errors': '{count} error', '{count} warnings': '{count} warning',
  ' and its {count} slides': ' and its {count} slide', '{count} lint findings': '{count} lint finding',
  '{description} ({count} effects)': '{description} ({count} effect)', '{count} files': '{count} file',
  '{count} tools': '{count} tool', '{count} elements selected': '{count} element selected',
  '{count} active effects': '{count} active effect', '{count} tracks': '{count} track',
};
const pluralRules = Object.fromEntries(languages.map(({ locale }) => [locale, new Intl.PluralRules(locale)]));

export const isKnownMessage = (message: string): boolean => {
  const zh = loadedDictionaries['zh-CN'];
  if (zh) return Object.hasOwn(zh, message);
  return knownKeyHashSet.has(hashMessageKey(message));
};

/** Accept legacy Chinese labels and already-localized built-in labels. */
export function sourceMessage(message: string, locale: Locale = 'zh-CN'): string {
  if (isKnownMessage(message)) return message;
  const fromRequested = getReverseIndex(locale)?.get(message);
  if (fromRequested) return fromRequested;
  if (Object.hasOwn(legacyZhReverse, message)) return legacyZhReverse[message];
  const fromZh = locale !== 'zh-CN' ? getReverseIndex('zh-CN')?.get(message) : undefined;
  if (fromZh) return fromZh;
  for (const loadedLocale of NON_ENGLISH_LOCALES) {
    if (loadedLocale === locale || loadedLocale === 'zh-CN' || !loadedDictionaries[loadedLocale]) continue;
    const match = getReverseIndex(loadedLocale)?.get(message);
    if (match) return match;
  }
  return message;
}

export function translate(locale: Locale, message: string, values: MessageValues = {}): string {
  // Prism returns a legacy Chinese warning followed by an untouched diagnostic.
  const warningPrefix = '模板更新失败，使用已缓存目录：';
  if (message.startsWith(warningPrefix)) return translate(locale, 'Template update failed; using cached catalogue: {message}', { message: message.slice(warningPrefix.length) });
  message = sourceMessage(message, locale);
  const value = locale === 'en' ? undefined : loadedDictionaries[locale]?.[message];
  const category = typeof values.count === 'number' ? pluralRules[locale].select(values.count) : 'other';
  let text = typeof value === 'string' ? value : value?.[category] ?? value?.other ?? message;
  if (locale === 'en' && category === 'one') text = singular[message] ?? text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key]));
}
