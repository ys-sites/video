import localizedLabels from './asset-name-ui.json' with { type: 'json' };

export const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|svg|avif|ico)$/i;
export const VIDEO_EXT = /\.(?:mp4|mov|webm|mkv|m4v)$/i;
export const AUDIO_EXT = /\.(?:mp3|wav|m4a|aac|ogg|flac|aiff?)$/i;
export const FONT_EXT = /\.(?:ttf|otf|ttc|woff2?|eot)$/i;
export const MEDIA_EXT = new RegExp([IMAGE_EXT, VIDEO_EXT, AUDIO_EXT].map(pattern => pattern.source).join('|'), 'i');
const kinds = ['Image', 'Video', 'Audio', 'Font'] as const;
export const projectAssetKind = (assetPath: string) => [IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, FONT_EXT].findIndex(pattern => pattern.test(assetPath));
export type AssetNameAllocations = Record<string, { basis: string; name: string; sequence?: number }>;
/** Display metadata is independent of the immutable path used by compositions. */
export interface ProjectAssetName {
  path: string;
  name?: string;
  originalName?: string;
  nameSource?: 'user' | 'agent' | 'source';
  font?: { family?: string; style?: string; weight?: number | string };
}

export function namingLanguage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 50) throw new Error('INVALID_NAMING_LANGUAGE: Use a BCP 47 language tag');
  try {
    const language = Intl.getCanonicalLocales(value)[0];
    if (!language) throw new Error();
    return language;
  }
  catch { throw new Error('INVALID_NAMING_LANGUAGE: Use a BCP 47 language tag'); }
}

export function displayStem(value: string): string {
  return projectAssetKind(value) < 0 ? value : value.slice(0, value.lastIndexOf('.'));
}

export function meaningfulAssetName(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  const stem = displayStem(value.trim());
  return !/^(?:[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}(?:-\d+)?|[a-f\d]{24,}|\d{10,}|(?:untitled|unnamed|temp|tmp|file|asset|image|audio|video|font|download)(?:[ _-]?\d+)?)$/i.test(stem);
}

export const ASSET_NAME_ERROR = 'Use 1–200 characters without line breaks or control characters.';

export function validateAssetDisplayName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('INVALID_ASSET_NAME: ' + ASSET_NAME_ERROR);
  }
  return value.trim();
}

export function projectAssetNames(paths: readonly string[], records: readonly ProjectAssetName[], language = 'en',
  fonts: readonly (NonNullable<ProjectAssetName['font']> & { path: string })[] = []): Record<string, string> {
  return allocateProjectAssetNames(paths, records, language, fonts).names;
}

/** Persist allocations outside source history; reads must not create source edits. */
export function allocateProjectAssetNames(paths: readonly string[], records: readonly ProjectAssetName[], language: string,
  fonts: readonly (NonNullable<ProjectAssetName['font']> & { path: string })[] = [], previous: AssetNameAllocations = {}) {
  const names: Record<string, string> = Object.create(null);
  const allocations: AssetNameAllocations = { ...previous };
  const byPath = new Map(records.map(record => [record.path, record]));
  const fontByPath = new Map(fonts.map(font => [font.path, font]));
  const locale = Object.keys(localizedLabels).find(locale => locale.toLowerCase() === language.toLowerCase())
    ?? Object.keys(localizedLabels).find(locale => locale.split('-')[0] === language.split('-')[0]);
  const labels = localizedLabels[(locale ?? 'en') as keyof typeof localizedLabels];
  const counts = kinds.map((_, kind) => Object.values(previous).reduce((maximum, item) =>
    item.basis === `fallback:${language}:${kind}` ? Math.max(maximum, item.sequence ?? 0) : maximum, 0));
  const used = new Set<string>();
  const entries = [...new Set(paths)].sort().flatMap(assetPath => {
    const kind = projectAssetKind(assetPath);
    if (kind < 0) return [];
    const record = byPath.get(assetPath);
    const source = assetPath.split('/').at(-1)!;
    const font = record?.font ?? fontByPath.get(assetPath);
    const base = record?.nameSource === 'user' && record.name ? displayStem(record.name)
      : meaningfulAssetName(record?.name) ? displayStem(record.name.trim())
      : meaningfulAssetName(source) ? displayStem(source)
      : font?.family ? [font.family, font.weight, font.style === 'normal' ? undefined : font.style].filter(Boolean).join(' ')
      : null;
    const basis = base === null ? `fallback:${language}:${kind}` : `name:${base}`;
    const prior = previous[assetPath]?.basis === basis ? previous[assetPath] : undefined;
    return [{ assetPath, kind, base, basis, prior }];
  });
  // Reserve existing captions before newly discovered paths, even earlier-sorting ones.
  entries.sort((a, b) => Number(!a.prior) - Number(!b.prior));
  for (const { assetPath, kind, base: preferred, basis, prior } of entries) {
    let sequence = prior?.sequence;
    let base = prior?.name ?? preferred;
    if (base === null) {
      do { sequence = ++counts[kind]; base = `${labels[kinds.at(kind)!]} ${sequence}`; }
      while (used.has(base.toLocaleLowerCase('en')));
    }
    let name = base;
    for (let suffix = 2; used.has(name.toLocaleLowerCase('en')); suffix++) name = `${base} (${suffix})`;
    used.add(name.toLocaleLowerCase('en'));
    names[assetPath] = name;
    allocations[assetPath] = { basis, name, ...(sequence === undefined ? {} : { sequence }) };
  }
  return { names, allocations };
}

/** Shared copyable request for the MCP handbook. */
export const assetNamingInstruction = "Use openmotion_get_project to read my saved project and its namingLanguage. Preserve meaningful existing names. Name only unnamed or newly generated assets by content and optional purpose. If no naming language is saved, choose the initial brief’s primary language, then the interface language, and save it. Use guarded openmotion_edit_project assetNames metadata to repair existing names without moving files. Confirm the saved names; reread after version conflicts.";
