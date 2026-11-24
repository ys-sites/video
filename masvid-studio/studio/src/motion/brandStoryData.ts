import type { GalleryTemplate } from '../../../shared/catalog';
import { discoveryPurposes } from './templateDiscoveryTaxonomy';
import insightData from './brandStoryInsights.json';
import dateData from './brandStoryDates.json';
import popularityData from './brandStoryPopularity.json';

export type BrandInsight = { videoInsight: string; evidenceTemplateIds: string[] };
/** Editorial observations of the linked catalogue samples, not a claim about every brand campaign. */
export const brandInsights: Record<string, BrandInsight> = insightData;
export type BrandSeries = { name: string; items: GalleryTemplate[]; purposes: string[]; videoInsight?: string; workClicks?: number; workExposures?: number; workQualifiedClicks?: number; workCtr?: number };
type WorkClickThrough = { exposed: number; clicked: number };
export const brandClickSnapshot = popularityData;
const clickCount = (value: number | undefined) => Number.isSafeInteger(value) && value! >= 0 ? value! : 0;
export const sampleBrands = ['Figma', 'Lovable', 'Notion'];
export const seriesNotes: Record<string, { title: string; description: string; focus: string }> = {
  Figma: { title: '新功能，怎么让人一眼看懂？', description: '从产品界面到品牌叙事，看看 Figma 如何把不同的发布讲成自己的故事。', focus: '借鉴真实界面、卖点展开和发布节奏。' },
  Lovable: { title: '下一次上新，开场怎么做？', description: '沿着一组发布作品，寻找产品功能、品牌态度与视觉节奏之间的连接。', focus: '从功能演示到品牌短片，找一个适合你的开场。' },
  Notion: { title: '复杂能力，怎么讲得简单？', description: '用产品画面、具体任务与清楚的节奏，让一个新能力更容易被理解。', focus: '从用户正在做的事出发，讲清一个新能力。' },
};

export function groupBrandSeries(items: GalleryTemplate[], clicks: Readonly<Record<string, number>> = brandClickSnapshot.counts,
  ctr: Readonly<Record<string, WorkClickThrough>> = brandClickSnapshot.ctrByTemplate): BrandSeries[] {
  const groups = new Map<string, GalleryTemplate[]>();
  for (const item of items) {
    const name = item.brand?.trim();
    if (!name) continue;
    const group = groups.get(name) ?? [];
    if (!group.some(existing => existing.id === item.id)) group.push(item);
    groups.set(name, group);
  }
  return [...groups].map(([name, group]) => {
    const samples = group.reduce((total, item) => {
      const sample = ctr[item.id];
      if (sample && Number.isSafeInteger(sample.exposed) && Number.isSafeInteger(sample.clicked) && sample.exposed >= 0 && sample.clicked >= 0 && sample.clicked <= sample.exposed) {
        total.exposed += sample.exposed; total.clicked += sample.clicked;
      }
      return total;
    }, { exposed: 0, clicked: 0 });
    return { name, items: group, purposes: [...new Set(group.flatMap(discoveryPurposes))], videoInsight: brandInsights[name]?.videoInsight,
      workClicks: group.reduce((total, item) => total + clickCount(clicks[item.id]), 0), workExposures: samples.exposed, workQualifiedClicks: samples.clicked,
      workCtr: samples.exposed ? samples.clicked / samples.exposed : undefined };
  })
    .sort((a, b) => {
      const rank = (name: string) => sampleBrands.includes(name) ? sampleBrands.indexOf(name) : sampleBrands.length;
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'en');
    });
}

/** A source post id gives its creation time, never a product-event date. */
export function inferredPostTime(item: Pick<GalleryTemplate, 'sourceUrl'>): number | undefined {
  try {
    const url = new URL(item.sourceUrl ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    const linkedin = ['linkedin.com', 'www.linkedin.com'].includes(url.hostname);
    const x = ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname);
    if (!linkedin && !x) return;
    const id = linkedin
      ? url.pathname.match(/(?:\/posts\/[^/]*-activity-|\/feed\/update\/urn:li:activity:)(\d{19})(?:[-/]|$)/)?.[1]
      : url.pathname.match(/\/status\/(\d{18,24})(?:\/|$)/)?.[1];
    if (!id) return;
    const milliseconds = Number((BigInt(id) >> 22n) + (linkedin ? 0n : 1288834974657n));
    if (milliseconds < 1288834974657 || milliseconds > Date.now()) return;
    return milliseconds;
  } catch { return; }
}

export type BrandWorkDate = { value: string; precision: 'year' | 'month' | 'day' };
type AuthoredWorkDate = BrandWorkDate & { sourceUrl: string; basis: string; evidence: string };
/** Source-backed dates retain their precision; an absent day is never invented. */
export const brandSourceDates = dateData as Record<string, AuthoredWorkDate>;
export function brandWorkDate(item: Pick<GalleryTemplate, 'sourceUrl'>): BrandWorkDate | undefined {
  const authored = brandSourceDates[item.sourceUrl ?? ''];
  if (authored) return authored;
  const timestamp = inferredPostTime(item);
  return timestamp === undefined ? undefined : { value: new Date(timestamp).toISOString().slice(0, 10), precision: 'day' };
}
export function brandWorkTime(item: Pick<GalleryTemplate, 'sourceUrl'>): number | undefined {
  const date = brandWorkDate(item);
  if (!date) return;
  return Date.parse(date.value + (date.precision === 'year' ? '-01-01' : date.precision === 'month' ? '-01' : '') + 'T00:00:00Z');
}
export function formatBrandWorkDate(date: BrandWorkDate): string {
  return date.value.replaceAll('-', '/');
}
export function chronologicalItems(series: BrandSeries, oldestFirst = false): GalleryTemplate[] {
  return [...series.items].sort((a, b) => {
    const left = brandWorkTime(a), right = brandWorkTime(b);
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    return oldestFirst ? left - right : right - left;
  });
}

/** Work count contributes 59%, exposure-weighted CTR 41%; ties retain the seeded order. */
export function rankDiscoverySeries(selected: BrandSeries[], population: BrandSeries[] = selected): BrandSeries[] {
  const ctr = (group: BrandSeries) => Number.isFinite(group.workCtr) && group.workCtr! >= 0 && group.workCtr! <= 1 ? group.workCtr! : 0;
  const maxCtr = Math.max(0, ...population.map(ctr));
  const maxWorks = Math.max(1, ...population.map(group => group.items.length));
  const score = (group: BrandSeries) => .59 * Math.log1p(group.items.length) / Math.log1p(maxWorks)
    + .41 * (maxCtr ? ctr(group) / maxCtr : 0);
  return [...selected].sort((left, right) => score(right) - score(left));
}

/** Sample all brands, then rank that sample. A per-library seed keeps the result stable. */
export function discoveryInsertions(items: GalleryTemplate[], series: BrandSeries[], enabled: boolean, seed = 1): Map<number, BrandSeries> {
  const slots = new Map<number, BrandSeries>();
  if (!enabled) return slots;
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6d2b79f5) | 0; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  const candidates = [...new Map(series.filter(group => group.items.length).map(group => [group.name, group])).values()];
  for (let index = candidates.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [candidates[index], candidates[target]] = [candidates[target], candidates[index]];
  }
  let position = 6 + Math.floor(random() * 3);
  for (const group of candidates) {
    if (position >= items.length) break;
    slots.set(position, group);
    position += 10 + Math.floor(random() * 5);
  }
  const ranked = rankDiscoverySeries([...slots.values()], candidates);
  return new Map([...slots.keys()].map((position, index) => [position, ranked[index]]));
}

/** Review-only receipts, retained in this tab. The preview server blocks production analytics. */
export function recordBrandReview(event: string, fields: Record<string, string | number> = {}) {
  try {
    const key = 'openmotion-brand-story-review';
    const previous = JSON.parse(sessionStorage.getItem(key) || '[]');
    sessionStorage.setItem(key, JSON.stringify([...previous, { event, ...fields, at: new Date().toISOString() }].slice(-100)));
  } catch { /* Review telemetry must never interrupt browsing. */ }
}
