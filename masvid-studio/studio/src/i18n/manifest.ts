export const languages = [
  { locale: 'en', label: 'English' },
  { locale: 'zh-CN', label: '简体中文' },
  { locale: 'ja', label: '日本語' },
  { locale: 'ko', label: '한국어' },
  { locale: 'de', label: 'Deutsch' },
  { locale: 'fr', label: 'Français' },
  { locale: 'ru', label: 'Русский' },
  { locale: 'es', label: 'Español' },
  { locale: 'pt-BR', label: 'Português (BR)' },
  { locale: 'it', label: 'Italiano' },
  { locale: 'tr', label: 'Türkçe' },
] as const;

export type Locale = typeof languages[number]['locale'];
export type NonEnglishLocale = Exclude<Locale, 'en'>;
export type MessageValues = Record<string, string | number>;
export type Translate = (message: string, values?: MessageValues) => string;
export type Message = string | Partial<Record<Intl.LDMLPluralRule, string>>;

export const NON_ENGLISH_LOCALES: readonly NonEnglishLocale[] = [
  'zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr',
];

export const isLocale = (value: unknown): value is Locale =>
  languages.some(language => language.locale === value);

export type I18nExtensionSource =
  | { kind: 'multi-locale-json'; path: string }
  | { kind: 'mvp-split'; zhPath: string; othersPath: string }
  | { kind: 'per-locale-dir'; dir: string };

/**
 * Canonical override order for Studio localization resources.
 * Source files stay organized by feature module for easy editing; Vite
 * transposes them at build time into 10 independent per-locale lazy chunks.
 */
export const I18N_EXTENSION_SOURCES: readonly I18nExtensionSource[] = [
  { kind: 'multi-locale-json', path: 'studio/src/i18n/component-inspector-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/studio-navigation-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/review-ui.json' },
  { kind: 'multi-locale-json', path: 'shared/asset-name-ui.json' },
  { kind: 'mvp-split', zhPath: 'studio/src/i18n/mvp-zh-CN.json', othersPath: 'studio/src/i18n/mvp-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/error-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/template-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/template-search-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/settings-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/mcp-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/assets-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/skills-ui.json' },
  { kind: 'per-locale-dir', dir: 'studio/src/i18n/skill-library' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/brand-kit-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/project-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/transcript-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/export-recovery-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/import-recovery-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/platform-export-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/canvas-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/fullscreen-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/timeline-hover-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/model-hub-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/design-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/design-editor-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/sound-studio-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/audio-nav-menu-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/game-studio-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/campaign-ui.json' },
  { kind: 'multi-locale-json', path: 'studio/src/i18n/scenario-ui.json' },
  { kind: 'multi-locale-json', path: 'shared/scenario-media-titles.json' },
];

/**
 * Multi-locale JSON files whose zh-CN strings are indexed into the tiny eager
 * legacy reverse map so backend/catalog Chinese strings resolve to canonical
 * English source keys even before the zh-CN locale chunk is loaded.
 */
export const LEGACY_ZH_REVERSE_FILES: readonly string[] = [
  'studio/src/i18n/error-ui.json',
  'studio/src/i18n/template-ui.json',
  'studio/src/i18n/template-search-ui.json',
  'studio/src/i18n/export-recovery-ui.json',
  'studio/src/i18n/import-recovery-ui.json',
  'studio/src/i18n/project-ui.json',
];

/**
 * Additional canonical English keys whose zh-CN values may be emitted directly
 * by legacy backend/catalog code and therefore belong in the eager reverse map.
 */
export const LEGACY_ZH_EXTRA_SOURCE_KEYS: readonly string[] = [
  'This artifact does not belong to this session',
  'Template cache unavailable; downloading again',
  'Session not found',
  'Invalid project link',
  'Local Studio connection failed',
  'The active project changed. Refresh and try again.',
  'Use template',
  'Product promotion',
  'Explore multi-scene animation and captions, from an icon intro to team collaboration.',
  'Data storytelling',
  'Explore the rhythm of data, annotations, and shapes in a newspaper-style animated chart.',
  'Process animation',
  'Explore nodes, connections, and branches in a decision tree that unfolds step by step.',
  'OpenMotion Sample Video',
  'Featured templates',
  'Video reproduction',
  'Motion design',
  'Short-form video',
  'Complete reference',
  'Creative moment',
  'Motion template',
  'Motion component',
  'Video example',
  'Local template',
  'Talking head',
  'Opening',
  'Product showcase',
  'Transitions',
  'Climax',
  'Ending',
  'Motion graphics',
  'Use Codex desktop or CLI and let your Agent create the video.',
  'Create a first draft from a reference video in Claude Code, then refine it in conversation.',
  'Connect creative tools in DeepSeek Harness to work all the way to the final video.',
  'Start creating in your conversation. ChatGPT cloud requires a remote workspace.',
  'Connect your preferred MCP client, terminal or script.',
  'Try now',
  'Promo code',
  'Chinese',
  'Recommended',
];

/**
 * Deterministic 53-bit double-FNV-1a integer hash (exact JS safe integer).
 * Emitted as sorted delta-encoded numeric literals at build time for zero-bloat
 * `isKnownMessage()` lookups without embedding 7,600+ source strings or
 * alphanumeric tokens in the entry bundle.
 */
export function hashMessageKey(key: string): number {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x85ebca6b);
    h2 = (h2 << 13) | (h2 >>> 19);
  }
  return (h1 >>> 0) * 0x200000 + (h2 & 0x1fffff);
}
