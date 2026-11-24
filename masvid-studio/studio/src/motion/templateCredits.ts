import type { GalleryTemplate } from '../../../shared/catalog';

/** A catalogue credit or the publisher of a linked post. Brand names alone do not identify a creator. */
export function templateCredit(item: GalleryTemplate) {
  const name = item.authorName?.trim() || item.author?.trim();
  if (name) return { id: 'credit/' + name.normalize('NFC'), name, source: 'Catalogue credit' };
  if (!item.sourceUrl) return;
  try {
    const url = new URL(item.sourceUrl);
    if (url.protocol !== 'https:' || !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname)) return;
    const handle = /^\/([\w]{1,15})\/status\/\d+\/?$/.exec(url.pathname)?.[1];
    if (handle && handle.toLowerCase() !== 'i') return { id: 'x/' + handle.toLowerCase(), name: '@' + handle, source: 'Source account on X' };
  } catch { /* Old catalogue rows may lack a usable source URL. */ }
}

export function templateCreators(catalog: GalleryTemplate[], locale: string) {
  const entries = new Map<string, NonNullable<ReturnType<typeof templateCredit>> & { work: GalleryTemplate; count: number }>();
  for (const work of catalog) {
    const credit = templateCredit(work);
    if (!credit) continue;
    const group = entries.get(credit.id);
    if (group) group.count++;
    else entries.set(credit.id, { ...credit, work, count: 1 });
  }
  return [...entries.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, locale));
}
