import type { GalleryTemplate } from '../../../shared/catalog';
import type { Translate } from '../i18n/messages';
import { matchesGallerySearch } from './GalleryFilters';
import { facetValues, templateFacets } from './templateDiscovery';

export const normalizedTemplateQuery = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const taskPurposes = new Map([
  ['产品演示', 'Product demos & explainers'],
  ['功能演示', 'Product demos & explainers'],
  ['product demo', 'Product demos & explainers'],
  ['产品宣传', 'Product launch films'],
  ['product promo', 'Product launch films'],
]);

/** Task aliases describe verified resource metadata, never every brand campaign. */
export function matchesTemplateSearch(item: GalleryTemplate, query: string, t: Translate) {
  const task = normalizedTemplateQuery(query);
  const purpose = taskPurposes.get(task);
  if (purpose && (item.id === 'product-promo' || facetValues(item, 'uses').includes(purpose))) return true;

  const text = [item.id, item.title, item.description, item.authorName, item.author, ...item.tags,
    ...templateFacets.flatMap(([key]) => facetValues(item, key).flatMap(value => [value, t(value)]))].filter(Boolean).join(' ');
  // Short brand acronyms must be genuine words, not a fragment of “anything”.
  if (task === 'nyt') return /(?:^|[^a-z])nyt(?:$|[^a-z])/i.test(text);
  return matchesGallerySearch(task, text);
}

export function validReferenceLink(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value.trim()).protocol); } catch { return false; }
}

export { templateSearchBrief } from '../../../shared/template-search-brief.ts';
