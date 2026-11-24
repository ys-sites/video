// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  I18nProvider,
  LOCALE_STORAGE_KEY,
  ensureLocaleLoaded,
  isLocaleLoaded,
  readLocale,
  sourceMessage,
  translate,
  useI18n,
} from './I18n';
import {
  NON_ENGLISH_LOCALES,
  isKnownMessage,
  preloadAllLocales,
  resetLoadedLocalesForTest,
} from './messages';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function flushAsync() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('per-locale lazy i18n loading', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    resetLoadedLocalesForTest();
    localStorage.clear();
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await preloadAllLocales();
  });

  it('requires zero locale chunks for English and still resolves isKnownMessage and legacy Chinese backend strings', async () => {
    for (const locale of NON_ENGLISH_LOCALES) {
      expect(isLocaleLoaded(locale)).toBe(false);
    }
    expect(isLocaleLoaded('en')).toBe(true);
    await ensureLocaleLoaded('en');
    for (const locale of NON_ENGLISH_LOCALES) {
      expect(isLocaleLoaded(locale)).toBe(false);
    }

    // Known keys work without loading any locale chunk.
    expect(isKnownMessage('Preview')).toBe(true);
    expect(isKnownMessage('Please wait 30 seconds before exporting diagnostics again.')).toBe(true);
    expect(isKnownMessage('Not a real authored product key 12345')).toBe(false);

    // Legacy Chinese backend errors and Prism warnings still map to English source keys in `en` mode.
    expect(sourceMessage('模板缓存不可用，重新下载', 'en')).toBe('Template cache unavailable; downloading again');
    expect(sourceMessage('该产物不属于此会话', 'en')).toBe('This artifact does not belong to this session');
    expect(sourceMessage('会话不存在', 'en')).toBe('Session not found');
    expect(sourceMessage('产品宣传', 'en')).toBe('Product promotion');
    expect(translate('en', '模板更新失败，使用已缓存目录：HTTP 503')).toBe(
      'Template update failed; using cached catalogue: HTTP 503',
    );
    expect(translate('en', '{count} files', { count: 1 })).toBe('1 file');
  });

  it('loads only the requested locale chunk on startup and dynamically loads another locale on switch without unmounting state', async () => {
    await ensureLocaleLoaded('zh-CN');
    expect(isLocaleLoaded('zh-CN')).toBe(true);
    for (const other of NON_ENGLISH_LOCALES.filter(l => l !== 'zh-CN')) {
      expect(isLocaleLoaded(other), `${other} should stay unloaded`).toBe(false);
    }

    function Harness() {
      const { t, locale, setLocale } = useI18n();
      const [draft, setDraft] = useState('keep-me');
      return (
        <div>
          <span data-testid="locale">{locale}</span>
          <h1 data-testid="heading">{t('Preview')}</h1>
          <input value={draft} onChange={e => setDraft(e.target.value)} />
          <button data-testid="to-ja" onClick={() => setLocale('ja')}>ja</button>
          <button data-testid="to-en" onClick={() => setLocale('en')}>en</button>
        </div>
      );
    }

    act(() => root.render(<I18nProvider initialLocale="zh-CN"><Harness /></I18nProvider>));
    const input = host.querySelector('input')!;
    expect(host.querySelector('[data-testid="heading"]')?.textContent).toBe('预览');
    expect(isLocaleLoaded('ja')).toBe(false);

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="to-ja"]')!.click());
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
    expect(readLocale()).toBe('ja');
    await flushAsync();

    expect(isLocaleLoaded('ja')).toBe(true);
    expect(isLocaleLoaded('de')).toBe(false);
    expect(isLocaleLoaded('fr')).toBe(false);
    expect(host.querySelector('[data-testid="locale"]')?.textContent).toBe('ja');
    expect(host.querySelector('[data-testid="heading"]')?.textContent).toBe('プレビュー');
    expect(host.querySelector('input')).toBe(input);
    expect(input.value).toBe('keep-me');

    // Legacy Chinese backend errors also localize properly into Japanese without needing other locales.
    expect(translate('ja', '模板缓存不可用，重新下载')).toBe(
      translate('ja', 'Template cache unavailable; downloading again'),
    );

    // Switching to English is immediate and keeps DOM identity.
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="to-en"]')!.click());
    expect(host.querySelector('[data-testid="locale"]')?.textContent).toBe('en');
    expect(host.querySelector('[data-testid="heading"]')?.textContent).toBe('Preview');
    expect(host.querySelector('input')).toBe(input);
  });

  it('hydrates an initially unloaded non-English locale passed straight to I18nProvider', async () => {
    expect(isLocaleLoaded('de')).toBe(false);
    function View() {
      const { t } = useI18n();
      return <p>{t('Undo')}</p>;
    }
    act(() => root.render(<I18nProvider initialLocale="de"><View /></I18nProvider>));
    await flushAsync();
    expect(isLocaleLoaded('de')).toBe(true);
    expect(host.querySelector('p')?.textContent).toBe('Rückgängig');
  });
});
