import publication from './black-friday-references.json' with { type: 'json' };
import type { GalleryTemplate } from './catalog.ts';

export const blackFridayStages = [
  { id: 'tease', title: 'Before the sale', description: 'Build anticipation and show when the sale starts.' },
  { id: 'launch', title: 'Sale launch', description: 'Show the product and make the offer easy to understand.' },
  { id: 'close', title: 'Cyber Monday and last call', description: 'Make a Cyber Monday spot or remind shoppers when the sale ends.' },
] as const;

export type BlackFridayStageId = typeof blackFridayStages[number]['id'];
type Reference = Omit<GalleryTemplate, 'title' | 'description' | 'styles' | 'kind' | 'collection' | 'subtitle' | 'tags'> & {
  en: Pick<GalleryTemplate, 'title' | 'description' | 'styles'>;
  zh: Pick<GalleryTemplate, 'title' | 'description' | 'styles'>;
};

// Use the published references when the configured repository or hosted catalog has not imported them.
const references: Record<BlackFridayStageId, readonly Reference[]> = publication.stages;
const referencesById = new Map(Object.values(references).flatMap(stage => stage.map(reference => [reference.id, reference] as const)));

function localizedReference({ en, zh, ...media }: Reference, locale: string): GalleryTemplate {
  return { ...media, ...(locale.startsWith('zh') ? zh : en), kind: 'reference', collection: 'reference',
    subtitle: 'Black Friday', tags: ['black-friday'], hasHtmlProject: false };
}

export function blackFridayReference(id: string, locale: string): GalleryTemplate | undefined {
  const reference = referencesById.get(id);
  return reference && localizedReference(reference, locale);
}

export function blackFridayTemplates(catalog: readonly GalleryTemplate[], locale: string) {
  const available = new Map(catalog.map(item => [item.id, item]));
  return blackFridayStages.map(stage => ({
    ...stage,
    items: references[stage.id].map(reference => available.get(reference.id) ?? localizedReference(reference, locale)),
  }));
}

export const blackFridaySkillIds = ['openmotion-sale-countdown', 'openmotion-sale-promo', 'openmotion-sale-carousel'] as const;
