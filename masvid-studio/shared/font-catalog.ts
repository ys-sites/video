import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type FontFile = { name: string; url: string; sha256: string; size: number; family: string; weight: string; style: 'normal' | 'italic'; postscriptName: string; coverage: { codepoints: number; sample: string; missing: string[] } };
export type CatalogFont = {
  id: string; family: string; category: string; languages: string[]; roles: string[]; moods: string[];
  bestFor: string[]; limitations: string[]; pairings: Array<{ id: string; reason: string; when: string; avoidWhen: string }>;
  brandFit: { traits: string[]; useWhen: string[]; mismatchRisks: string[] };
  readability: { readingUse: 'reading' | 'conditional' | 'display'; risks: string[]; adjustment: string };
  usage: { hierarchy: string; spacing: string; locale: string }; source: { repository: string; commit: string; directory: string };
  license: { spdx: string; url: string; sha256: string; size: number }; files: FontFile[];
};
export async function loadFontCatalog(): Promise<{ version: string; fonts: CatalogFont[] }> {
  const source = await readFile(new URL('../skills/openmotion-production/fonts/catalog.json', import.meta.url), 'utf8');
  const catalog = JSON.parse(source);
  return { version: createHash('sha256').update(source).digest('hex'), fonts: catalog.fonts };
}
export async function fontCatalogResource(uri: string) {
  const match = /^(?:openmotion|motion):\/\/fonts\/(index|[a-z][a-z0-9-]*)$/.exec(uri);
  if (!match) throw new Error('INVALID_FONT_RESOURCE_URI');
  const { version, fonts } = await loadFontCatalog();
  if (match[1] === 'index') return { catalogVersion: version, total: fonts.length, fonts: fonts.map(({ id, family, category, languages, roles, moods, brandFit, readability }) =>
    ({ id, family, category, languages, roles, moods, character: brandFit.traits, readingUse: readability.readingUse, uri: `openmotion://fonts/${id}` })), readNext: 'Resolve the applicable brand/brief first, then filter by actual language, construction and text role and read only candidate URIs. Character and readingUse are editorial guidance, not measured scores. A pairing is optional; check required copy at the intended phone display size using the typography guide.' };
  const font = fonts.find(font => font.id === match[1]);
  if (!font) throw new Error('UNKNOWN_FONT_ID');
  return { catalogVersion: version, ...font, prepare: { command: [process.execPath, '--experimental-strip-types', fileURLToPath(new URL('../scripts/prepare-font.ts', import.meta.url)), font.id],
    effect: 'Downloads hash-pinned fonts and license to a user cache only; does not modify a project. Import returned local paths using openmotion_import_assets, then use its actual metadata/CSS and reread the project version before editing.' } };
}
