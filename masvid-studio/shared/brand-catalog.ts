import { brandKitShowcase, type BrandSample } from './brand-kit.ts';

export type BrandCatalogEntry = {
  id: string;
  name: string;
  category: string;
  description: string;
  appearance: 'Light' | 'Dark';
  colors: string[];
  tags: string[];
  sourceUrl: string;
  websiteUrl?: string;
  coverPage?: string;
  coverImage?: string;
  sample: BrandSample;
  files: { path: string; sha256: string }[];
};
export type BrandCatalog = {
  schemaVersion: 1;
  repository: string;
  revision: string;
  entries: BrandCatalogEntry[];
};
export const brandCoverRevision = 5;
const brandCatalogShowcaseRevision = 3;
export const brandCatalogArtworkUrl = (entry: Pick<BrandCatalogEntry, 'websiteUrl' | 'sourceUrl'>) =>
  entry.websiteUrl || entry.sourceUrl;
export const brandCatalogFile = (id: string, file: 'poster.svg' | 'style-cover.svg' | 'showcase' | 'cover' | 'favicon') =>
  `/motion-api/brand-kits/catalog/${encodeURIComponent(id)}/${file}?v=${file === 'showcase' ? brandCatalogShowcaseRevision : file === 'poster.svg' ? brandKitShowcase.revision : brandCoverRevision}`;
