/** Map verified public source/website URLs, cover subpages and preview images onto library/brand-kits/catalog.json. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandWebsite } from '../gateway/brand-network.ts';
import { sameBrandSite } from '../gateway/brand-cover.ts';
import type { BrandCatalog } from '../shared/brand-catalog.ts';

type WebsitesManifest = {
  source: string;
  license: string;
  additionalSources?: Record<string, string>;
  websites: Record<string, string>;
  coverPages?: Record<string, string>;
  coverImages?: Record<string, string>;
};

const root = fileURLToPath(new URL('../', import.meta.url));
const brandRoot = path.join(root, 'library/brand-kits');
const websitesPath = path.join(brandRoot, 'websites.json');
const catalogPath = path.join(brandRoot, 'catalog.json');

const BERGSIDE_REPO = 'https://github.com/bergside/awesome-design-skills';
const BERGSIDE_RAW = 'https://raw.githubusercontent.com/bergside/awesome-design-skills';
const BERGSIDE_REVISION = 'f631a09b4fcc0166f2e2c1a8c81906ef680c57e8';
const BERGSIDE_RENAMES: Record<string, string> = { simple: 'geometric' };
const BERGSIDE_IDS = [
  'agentic', 'artistic', 'bento', 'bold', 'brutalism', 'cafe', 'claymorphism',
  'clean', 'colorful', 'contemporary', 'corporate', 'cosmic', 'creative',
  'dithered', 'doodle', 'dramatic', 'editorial', 'enterprise', 'expressive',
  'fantasy', 'flat', 'friendly', 'futuristic', 'glassmorphism', 'gradient',
  'levels', 'minimal', 'modern', 'mono', 'neobrutalism', 'neon', 'neumorphism',
  'pacman', 'paper', 'perspective', 'premium', 'professional', 'refined',
  'retro', 'simple', 'skeumorphism', 'sleek', 'spacious', 'storytelling',
  'tetris', 'vibrant', 'vintage',
] as const;

const EXTRA_WEBSITES: Record<string, string> = {
  claude: 'https://claude.com/',
  kami: 'https://kami.tw93.fun/',
  'tom-modern': 'https://github.com/Tom-Opencart/tom-modern-html-style-rule',
};

const EXTRA_COVER_PAGES: Record<string, string> = {
  bugatti: 'https://newsroom.bugatti.com/',
  canva: 'https://status.canva.com/',
  coinbase: 'https://cds.coinbase.com/',
  lovable: 'https://docs.lovable.dev/',
  openai: 'https://openai.com/brand/',
  playstation: 'https://www.playstation.com/en-us/',
  spacex: 'https://shop.spacex.com/',
};

function sortRecord(record: Record<string, string>) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

const args = new Set(process.argv.slice(2));
const applyMappings = args.has('--apply-upstream');

const manifest = JSON.parse(await readFile(websitesPath, 'utf8')) as WebsitesManifest;
const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as BrandCatalog;
const catalogIds = new Set(catalog.entries.map(entry => entry.id));

const websites: Record<string, string> = { ...manifest.websites };
const coverPages: Record<string, string> = { ...(manifest.coverPages || {}) };
const coverImages: Record<string, string> = { ...(manifest.coverImages || {}) };

if (applyMappings) {
  for (const [id, url] of Object.entries(EXTRA_WEBSITES)) websites[id] = url;
  for (const [id, url] of Object.entries(EXTRA_COVER_PAGES)) coverPages[id] = url;
  for (const id of BERGSIDE_IDS) {
    const skillId = BERGSIDE_RENAMES[id] ?? id;
    websites[id] = `${BERGSIDE_REPO}/tree/${BERGSIDE_REVISION}/skills/${skillId}`;
    coverImages[id] = `${BERGSIDE_RAW}/${BERGSIDE_REVISION}/registry-examples/${skillId}-marketing.png`;
  }
  manifest.additionalSources = {
    ...(manifest.additionalSources || {}),
    'bergside/awesome-design-skills': `${BERGSIDE_REPO}/tree/${BERGSIDE_REVISION}`,
    kami: 'https://github.com/tw93/Kami',
    'tom-modern': 'https://github.com/Tom-Opencart/tom-modern-html-style-rule',
  };
  manifest.websites = sortRecord(websites);
  manifest.coverPages = sortRecord(coverPages);
  manifest.coverImages = sortRecord(coverImages);
  await writeFile(websitesPath, JSON.stringify(manifest, null, 2) + '\n');
}

for (const [id, url] of Object.entries(manifest.websites)) {
  if (!catalogIds.has(id)) throw new Error(`Unknown website catalog ID: ${id}`);
  brandWebsite(url);
}
for (const [id, url] of Object.entries(manifest.coverPages || {})) {
  if (!catalogIds.has(id)) throw new Error(`Unknown coverPage catalog ID: ${id}`);
  const website = manifest.websites[id];
  if (!website || !sameBrandSite(website, brandWebsite(url)))
    throw new Error(`coverPage for ${id} must belong to the same site as websiteUrl`);
}
for (const [id, url] of Object.entries(manifest.coverImages || {})) {
  if (!catalogIds.has(id)) throw new Error(`Unknown coverImage catalog ID: ${id}`);
  brandWebsite(url);
}

let withWebsite = 0, withCoverPage = 0, withCoverImage = 0;
for (const entry of catalog.entries) {
  const websiteUrl = manifest.websites[entry.id];
  const coverPage = manifest.coverPages?.[entry.id];
  const coverImage = manifest.coverImages?.[entry.id];
  if (websiteUrl) { entry.websiteUrl = websiteUrl; withWebsite++; } else delete entry.websiteUrl;
  if (coverPage) { entry.coverPage = coverPage; withCoverPage++; } else delete entry.coverPage;
  if (coverImage) { entry.coverImage = coverImage; withCoverImage++; } else delete entry.coverImage;
}

await writeFile(catalogPath, JSON.stringify(catalog) + '\n');
console.log(
  `Synced ${catalog.entries.length} Brand Kits: ${withWebsite} websiteUrl, ${withCoverPage} coverPage, ${withCoverImage} coverImage`,
);
