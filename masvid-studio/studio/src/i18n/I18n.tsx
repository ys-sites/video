import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ensureLocaleLoaded, isLocale, isLocaleLoaded, languages, translate, type Locale, type MessageValues } from './messages';
import { pageMetadata } from '../../../packages/design-system/metadata.js';
export { languages, isLocale, isLocaleLoaded, ensureLocaleLoaded, translate, sourceMessage } from './messages';
export type { Locale, MessageValues, Translate } from './messages';
export const LOCALE_STORAGE_KEY = 'motion.studio.locale';

function browserLocale(): Locale | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const value of preferred) {
    if (!value) continue;
    const normalized = value.replaceAll('_', '-').toLowerCase();
    const exact = languages.find(language => language.locale.toLowerCase() === normalized);
    if (exact) return exact.locale;
    const primary = normalized.split('-')[0];
    const match = languages.find(language => language.locale.toLowerCase().split('-')[0] === primary);
    if (match) return match.locale;
  }
  return undefined;
}

export function readLocale(): Locale {
  try { const saved = localStorage.getItem(LOCALE_STORAGE_KEY); if (isLocale(saved)) return saved; } catch { /* Private browsing can deny storage. */ }
  return browserLocale() ?? 'zh-CN';
}

function languageTools(locale: Locale) {
  return {
    locale,
    t: (message: string, values?: MessageValues) => translate(locale, message, values),
    formatDate: (date: number | Date, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date),
    formatNumber: (number: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(number),
  };
}

// Standalone upstream components keep English unless a product host provides a locale.
const I18nContext = createContext({ ...languageTools('en'), setLocale: (_locale: Locale) => {} });
export const useI18n = () => useContext(I18nContext);

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, updateLocale] = useState<Locale>(() => initialLocale ?? readLocale());
  const [loadedVersion, setLoadedVersion] = useState(0);
  const requestSeq = useRef(0);

  const applyLocale = useCallback((next: Locale) => {
    const seq = ++requestSeq.current;
    if (isLocaleLoaded(next)) {
      updateLocale(next);
      return;
    }
    // Keep the currently rendered locale painted while the target locale chunk
    // downloads so switching languages never flashes raw English fallback copy.
    void ensureLocaleLoaded(next)
      .then(() => {
        if (requestSeq.current !== seq) return;
        updateLocale(next);
        setLoadedVersion(version => version + 1);
      })
      .catch(() => { /* Keep the active locale intact if chunk loading fails. */ });
  }, []);

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    try { localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Switching still works without persistence. */ }
    applyLocale(next);
  }, [applyLocale]);

  useEffect(() => {
    if (isLocaleLoaded(locale)) return;
    let cancelled = false;
    void ensureLocaleLoaded(locale)
      .then(() => {
        if (!cancelled) setLoadedVersion(version => version + 1);
      })
      .catch(() => { /* Fallback to English source keys if the initial chunk fails. */ });
    return () => { cancelled = true; };
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    const metadata = pageMetadata(locale);
    document.title = metadata.title;
    for (const attribute of ['name', 'property'] as const) {
      for (const [key, value] of Object.entries(metadata[attribute])) {
        let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
        if (!element) {
          element = document.createElement('meta');
          element.setAttribute(attribute, key);
          document.head.append(element);
        }
        element.content = value;
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
        applyLocale(isLocale(event.newValue) ? event.newValue : browserLocale() ?? 'zh-CN');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [locale, applyLocale]);

  const value = useMemo(() => ({ ...languageTools(locale), setLocale }), [locale, setLocale, loadedVersion]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
