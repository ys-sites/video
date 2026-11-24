import { describe, expect, it } from 'vitest';
import { languages, translate, isKnownMessage, sourceMessage } from './messages';
import { dictionaries, mvpMessages } from './sourceCatalog';
import mvpUi from './mvp-ui.json';
import errorUi from './error-ui.json';
import settingsUi from './settings-ui.json';
import templateUi from './template-ui.json';
import mcpUi from './mcp-ui.json';
import studioNavigationUi from './studio-navigation-ui.json';
import { mcpFaq } from '../motion/mcpCapabilities';
import { creativeStudios } from '../../../shared/studio-catalog';
import { errorNoticeMessage } from '../components/ui/errorNoticeMessage';
import { historyEntryLabel } from './historyMessages';

describe('editor language resources', () => {
  it('keeps Studio navigation and handbook messages complete in each supported locale', () => {
    const keys = Object.keys(studioNavigationUi['zh-CN']).sort();
    for (const { locale } of languages) {
      if (locale === 'en') continue;
      const entries = studioNavigationUi[locale];
      expect(Object.keys(entries).sort(), locale).toEqual(keys);
      for (const [message, translation] of Object.entries(entries)) {
        expect(translation.trim(), `${locale}: ${message}`).not.toBe('');
        expect(translation.match(/openmotion_\w+/g) ?? []).toEqual(message.match(/openmotion_\w+/g) ?? []);
        const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
        expect(placeholders(translation), `${locale}: ${message}`).toEqual(placeholders(message));
      }
      for (const label of [...creativeStudios.map(studio => studio.title), 'More Studio']) {
        const translated = translate(locale, label);
        expect(translated.trim(), `${locale}: ${label}`).not.toBe('');
        expect(translated, `${locale}: ${label}`).not.toBe(label);
      }
    }
  });

  it('keeps studio-navigation-ui free of untranslated English placeholders, clobbered base keys, and superseded playstyle keys', () => {
    // Only true brand terms and verified target-language cognates may match the English source key.
    const allowedIdentical: Record<string, Set<string>> = {
      '*': new Set(['OpenDesign API Key']),
      de: new Set(['Studios', 'Transparent', 'Details', 'Workflows', 'Inpaint']),
      fr: new Set(['Studios', 'Transparent']),
      es: new Set(['Popular', 'Roles']),
      'pt-BR': new Set(['Popular', 'Zoom 100%']),
    };
    const supersededKeys = [
      'Text to image', 'Character consistency', 'Multi-shot narrative', 'Extend video',
      'Shot reference', 'Multi-image fusion', 'Inpainting', '4K Upscale',
      'Batch set', 'Lipsync', '4K video upscale', 'Keyframes',
    ];
    for (const { locale } of languages) {
      if (locale === 'en') continue;
      const entries = studioNavigationUi[locale];
      const base = dictionaries[locale];
      for (const dead of supersededKeys) {
        expect(Object.hasOwn(entries, dead), `${locale}: superseded key ${dead}`).toBe(false);
      }
      for (const [message, translation] of Object.entries(entries)) {
        const permitted = allowedIdentical['*'].has(message) || Boolean(allowedIdentical[locale]?.has(message));
        if (!permitted) {
          expect(translation, `${locale}: untranslated "${message}"`).not.toBe(message);
        }
        // Never allow an untranslated English placeholder to overwrite a translated base dictionary entry.
        const baseValue = base[message];
        if (typeof baseValue === 'string' && baseValue !== message) {
          expect(translation, `${locale}: clobbered base "${message}"`).not.toBe(message);
        }
      }
      // Verify prompt-only history action resolves to studio-navigation-ui rather than a dead Sound Studio override.
      expect(translate(locale, 'Reuse prompt'), `${locale}: Reuse prompt`).toBe(entries['Reuse prompt']);
    }
  });

  it('translates the current recreation FAQ without retaining its superseded answer', () => {
    const answer = mcpFaq.find(([question]) => question === 'Can I recreate a reference video?')![1];
    for (const { locale } of languages.filter(language => language.locale !== 'en')) {
      const messages = mcpUi[locale as keyof typeof mcpUi] as Record<string, string>;
      expect(Object.keys(messages).filter(key => key.startsWith('Yes. Give your Agent the reference and your brand.')), locale).toEqual([answer]);
      expect(messages[answer]?.trim(), locale).toBeTruthy();
      expect(translate(locale, answer), locale).toBe(messages[answer]);
      expect(translate(locale, answer), locale).not.toBe(answer);
    }
  });

  it('localizes the storyboard review FAQ in every supported non-English locale', () => {
    const entry = mcpFaq.find(([question]) => question === 'How do I review a storyboard or creative direction?')!;
    for (const { locale } of languages.filter(language => language.locale !== 'en')) {
      for (const message of entry) expect(translate(locale, message), locale).not.toBe(message);
    }
  });

  it('offers the eleven requested languages and a complete vocabulary in each dictionary', () => {
    expect(languages.map(language => language.locale)).toEqual(['en', 'zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr']);
    const keys = Object.keys(dictionaries['zh-CN']).sort();
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      expect(Object.keys(dictionary).sort(), locale).toEqual(keys);
      for (const [source, value] of Object.entries(dictionary)) {
        const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
        for (const message of typeof value === 'string' ? [value] : Object.values(value)) {
          expect(message?.trim(), `${locale}: ${source}`).toBeTruthy();
          expect(placeholders(message!), `${locale}: ${source}`).toEqual(placeholders(source));
        }
      }
    }
  });

  it('selects Russian and German plural forms, including zero and fractional counts', () => {
    expect(translate('ru', '{count} files', { count: 1 })).toBe('1 файл');
    expect(translate('ru', '{count} files', { count: 2 })).toBe('2 файла');
    expect(translate('ru', '{count} files', { count: 5 })).toBe('5 файлов');
    expect(translate('ru', '{count} files', { count: 21 })).toBe('21 файл');
    expect(translate('ru', '{count} files', { count: 0 })).toBe('0 файлов');
    expect(translate('ru', '{count} files', { count: 1.5 })).toBe('1.5 файла');
    expect(translate('de', '{count} files', { count: 1 })).toBe('1 Datei');
    expect(translate('de', '{count} files', { count: 2 })).toBe('2 Dateien');
  });

  it('preserves authored interpolation values and unknown diagnostics across languages', () => {
    for (const { locale } of languages) {
      expect(translate(locale, 'Download {value0}', { value0: 'Preview.mp4' }), locale).toContain('Preview.mp4');
      expect(translate(locale, 'Unrecognized provider diagnostic: /assets/原稿.png')).toBe('Unrecognized provider diagnostic: /assets/原稿.png');
    }
  });

  it('localizes Prism cache warnings while retaining the original failure diagnostic', () => {
    for (const { locale } of languages) {
      const diagnostic = 'HTTP 503: /templates/原稿';
      expect(translate(locale, `模板更新失败，使用已缓存目录：${diagnostic}`)).toBe(translate(locale, 'Template update failed; using cached catalogue: {message}', { message: diagnostic }));
      expect(translate(locale, '模板缓存不可用，重新下载')).toBe(translate(locale, 'Template cache unavailable; downloading again'));
    }
  });
});

it('keeps Chinese additions interpolated and preserves fallback for unexposed advanced controls', () => {
  for (const [source, translated] of Object.entries(mvpMessages['zh-CN']!)) {
    expect(isKnownMessage(source)).toBe(true);
    expect(typeof translated).toBe('string');
    const values = Object.fromEntries([...source.matchAll(/\{(\w+)\}/g)].map(match => [match[1], 'sample']));
    expect(translate('zh-CN', source, values)).not.toMatch(/\{\w+\}/);
    for (const { locale } of languages.filter(language => language.locale !== 'zh-CN')) {
      const additions: Record<string, string> = { ...errorUi[locale as keyof typeof errorUi], ...templateUi[locale as keyof typeof templateUi], ...settingsUi[locale as keyof typeof settingsUi] };
      if (!additions[source] && !mvpMessages[locale]?.[source] && (locale === 'en' || !dictionaries[locale]?.[source])) expect(translate(locale, source, values)).toBe(translate('en', source, values));
    }
  }
});

it('covers phase-one additions in all nine other languages without losing placeholders', () => {
  const keys = Object.keys(mvpUi.de).sort();
  expect(Object.keys(mvpUi).sort()).toEqual(languages.map(l => l.locale).filter(l => l !== 'en' && l !== 'zh-CN').sort());
  for (const [locale, messages] of Object.entries(mvpUi)) {
    expect(Object.keys(messages).sort(), locale).toEqual(keys);
    for (const [source, value] of Object.entries(messages)) {
      expect(value.trim(), `${locale}: ${source}`).toBeTruthy();
      const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
      expect(placeholders(value), `${locale}: ${source}`).toEqual(placeholders(source));
    }
  }
});

it('recognizes error additions before reverse lookup and preserves their specific guidance', () => {
  for (const [locale, messages] of Object.entries(errorUi)) for (const [source, value] of Object.entries(messages)) {
    expect(isKnownMessage(source), source).toBe(true);
    expect(sourceMessage(source), source).toBe(source);
    expect(translate('en', source), source).toBe(source);
    expect(translate(locale as keyof typeof errorUi, source), `${locale}: ${source}`).toBe(value);
    expect([...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort()).toEqual([...source.matchAll(/\{\w+\}/g)].map(m => m[0]).sort());
  }
  const guidance = 'Please wait 30 seconds before exporting diagnostics again.';
  expect(errorNoticeMessage(guidance)).toBe(guidance);
});

it('covers preparation and import feedback in every supported language', () => {
  const messages = [
    'Rendering component', 'Media components', 'Media processing', 'Media inspection',
    'Waiting to prepare', 'Waiting for shared download', 'Downloading', 'Verifying download',
    'Extracting', 'Checking component', 'Ready', 'Preparation failed',
    'Video components are not ready. Check preparation status.',
    'Media components are preparing. Selected files are kept for retry.',
    'Files waiting for import: {count}', 'Preparing video features', 'Video export is not ready',
    'You can keep editing', 'View progress', 'Video preparation', 'Technical details',
    'Preparation progress unavailable', 'Your files are ready to import', 'Continue import',
    'Download verification failed. Retry the download.',
    'Not enough disk space. Free some space and retry.',
    'Cannot write the preparation cache. Check folder permissions.',
    'This platform needs compatible video components.',
    'Download failed. Check your connection and retry.',
    'About {seconds}s remaining', 'Download attempt {attempt}/{total}',
    'Download timed out after automatic retries. Check your connection and retry.',
    'The component could not be prepared. Retry or inspect the details.',
    'Name cannot contain slashes or two consecutive dots.',
  ];
  for (const { locale } of languages.filter(l => l.locale !== 'en')) for (const message of messages) {
    expect(translate(locale, message), `${locale}: ${message}`).not.toBe(message);
  }
  expect(translate('en', '{count} active effects', { count: 1 })).toBe('1 active effect');
});

it('uses the current Chinese project terminology in every resource layer', () => {
  const messages = { ...dictionaries['zh-CN'], ...mvpMessages['zh-CN'], ...errorUi['zh-CN'] };
  for (const [source, value] of Object.entries(messages)) {
    for (const text of typeof value === 'string' ? [value] : Object.values(value)) expect(text, source).not.toContain('工程');
  }
});

it('uses editing actions rather than unrelated noun meanings for common controls', () => {
  expect(translate('de', 'Retry')).toBe('Erneut versuchen');
  expect(translate('ja', 'Apply')).toBe('適用');
  expect(translate('fr', 'Apply')).toBe('Appliquer');
  expect(translate('tr', 'Apply')).toBe('Uygula');
  expect(translate('ko', 'Fit')).toBe('화면에 맞추기');
  expect(translate('it', 'Draft')).toBe('Bozza');
  for (const key of ['Initializing', 'Preparing', 'Encoding', 'Play forward', 'Save project name', 'Rename project', 'Create project']) {
    expect(translate('de', key), key).not.toBe(key);
  }
});

it('localizes audited controls and history without translating authored names', () => {
  expect(translate('de', 'Undo')).toBe('Rückgängig');
  expect(translate('ru', 'Align left')).toBe('По левому краю');
  expect(translate('ja', 'Expand')).toBe('展開');
  for (const { locale } of languages.filter(l => l.locale !== 'en')) {
    const t = (message: string, values?: Record<string, string | number>) => translate(locale, message, values);
    for (const key of ['Expand left panel', 'Split', 'Import files', 'Took {value0}', 'Edit layer style', 'Move timeline clips']) {
      expect(t(key), `${locale}: ${key}`).not.toBe(key);
    }
    expect(historyEntryLabel('Hide track 2', t)).toContain('2');
    expect(historyEntryLabel('Hide track 2', t)).not.toBe('Hide track 2');
    expect(historyEntryLabel('Undid: Move timeline clips', t)).toContain(t('Move timeline clips'));
    expect(historyEntryLabel('Add block: My Custom Title', t)).toContain('My Custom Title');
    expect(historyEntryLabel('My authored version name', t)).toBe('My authored version name');
  }
});
