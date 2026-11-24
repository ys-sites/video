import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brandWebsite, fetchBrandResource } from './brand-network.ts';
import { brandCoverRevision } from '../shared/brand-catalog.ts';

type Cover = { body: Buffer; mime: string; source: string };
type Receipt = { checkedAt: number; source?: string; mime?: string; hash?: string; revision?: number };
const successAge = 7 * 24 * 60 * 60 * 1000;
const failureAge = 60 * 60 * 1000;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const entities = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, key: string) => {
  if (key.startsWith('#')) {
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }
  return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<string, string>)[key.toLowerCase()] ?? entity;
});

/** Metadata is inert input. Resolve relative URLs, then apply the same public-HTTPS boundary as capture. */
function brandMetadata(html: string, pageUrl: string) {
  const document = html.replace(/<!--[\s\S]*?-->|<(script|style|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const tags = [...document.matchAll(/<(\/?)([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
    .filter(tag => /^(meta|base|link|picture|source|img)$/i.test(tag[2])).map(tag => {
      const attributes: Record<string, string> = {};
      for (const match of tag[0].matchAll(/([^\s=<>/'"]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
        attributes[match[1].toLowerCase()] = entities(match[2] ?? match[3] ?? match[4] ?? '');
      return { name: (tag[1] + tag[2]).toLowerCase(), attributes };
    });
  let base = pageUrl;
  for (const tag of tags) {
    if (tag.name === 'base' && tag.attributes.href) {
      try { base = brandWebsite(new URL(tag.attributes.href, pageUrl).href); } catch { /* Ignore unsafe bases. */ }
      break;
    }
  }
  return { tags, base };
}
type BrandMetadata = ReturnType<typeof brandMetadata>;
const imageUrl = (raw: string, base: string) => {
  try { return raw.trim() ? brandWebsite(new URL(raw, base).href) : undefined; }
  catch { return undefined; }
};
function socialImages({ tags, base }: BrandMetadata): string[] {
  const images: { priority: number; url: string }[] = [];
  for (const { name, attributes } of tags) {
    if (name === 'meta') {
      const property = (attributes.property || attributes.name || attributes.itemprop || '').toLowerCase();
      const priority = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image'].indexOf(property);
      if (priority < 0 || !attributes.content) continue;
      const url = imageUrl(attributes.content, base);
      if (url) images.push({ priority, url });
    } else if (name === 'link' && attributes.href && (attributes.rel || '').toLowerCase().split(/\s+/).includes('image_src')) {
      const url = imageUrl(attributes.href, base);
      if (url) images.push({ priority: 6, url });
    }
  }
  return [...new Set(images.sort((a, b) => a.priority - b.priority).map(image => image.url))].slice(0, 6);
}
export function brandSocialImages(html: string, pageUrl: string): string[] {
  return socialImages(brandMetadata(html, pageUrl));
}

function responsiveImage(set: string) {
  const variants = set.split(/,(?=\s|\S+\s+(?:\d+w|[\d.]+x)(?:,|$))/).flatMap(item => {
    const [url, size] = item.trim().split(/\s+/);
    return url && !url.startsWith('data:') ? [{ url, distance: size?.endsWith('w') ? Math.abs(parseInt(size) - 960) : Math.abs((parseFloat(size) || 1) - 1.5) }] : [];
  });
  return variants.sort((a, b) => a.distance - b.distance)[0]?.url;
}

/** Look at source markup in document order, without loading or running the page. */
function pageImages({ tags, base }: BrandMetadata): string[] {
  const urls = new Set<string>();
  const append = (raw?: string) => {
    const url = raw && imageUrl(raw, base);
    if (url && !/\.(?:svgz?|ico)$/i.test(new URL(url).pathname)) urls.add(url);
  };
  let sources: string[] | undefined;
  for (const { name, attributes: a } of tags) {
    if (name === 'link' && (a.rel || '').toLowerCase().split(/\s+/).includes('preload') && (a.as || '').toLowerCase() === 'image') {
      const preloaded = (a.imagesrcset && responsiveImage(a.imagesrcset)) || a.href;
      if (preloaded && !/\b(?:logo|logos|icon|icons|avatar|badge|pixel|tracking|spacer|favicon)\b/i.test(preloaded)) append(preloaded);
      if (urls.size >= 8) break;
      continue;
    }
    if (name === 'picture') { sources = []; continue; }
    if (name === '/picture') { sources = undefined; continue; }
    if (name === 'source' && sources && a.type !== 'image/svg+xml') {
      const best = responsiveImage(a['data-srcset'] || a.srcset || '');
      if (best && sources.length < 2) sources.push(best);
    }
    if (name !== 'img') continue;
    const label = [a.alt, a.id, a.class].filter(Boolean).join(' ');
    const tooSmall = [a.width, a.height].some(value => /^\d+(?:px)?$/i.test(value || '') && parseInt(value) < 96);
    if (tooSmall || 'hidden' in a || /\b(?:logo|logos|icon|icons|avatar|badge|pixel|tracking|spacer)\b/i.test(label)) continue;
    const set = a['data-srcset'] || a.srcset;
    const preferred = (set && responsiveImage(set)) || a['data-src'] || a['data-lazy-src'] || a['data-original'];
    append(preferred);
    for (const source of sources || []) append(source);
    append(a.src);
    if (urls.size >= 8) break;
  }
  return [...urls].slice(0, 8);
}

/** Check intrinsic dimensions before using an ordinary page image as artwork. */
function coverDimensions(body: Buffer, mime: string): [number, number] | undefined {
  if (mime === 'image/png' && body.length >= 24 && body.toString('ascii', 12, 16) === 'IHDR')
    return [body.readUInt32BE(16), body.readUInt32BE(20)];
  if (mime === 'image/gif') return [body.readUInt16LE(6), body.readUInt16LE(8)];
  if (mime === 'image/jpeg') {
    for (let offset = 2; offset + 9 <= body.length && body[offset++] === 255;) {
      while (body[offset] === 255) offset++;
      const marker = body[offset++];
      if (marker === 0xda || offset + 7 > body.length) break;
      const size = body.readUInt16BE(offset);
      if (size < 2 || offset + size > body.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 7)
        return [body.readUInt16BE(offset + 5), body.readUInt16BE(offset + 3)];
      offset += size;
    }
  }
  if (mime === 'image/webp' && body.length >= 30) {
    const variant = body.toString('ascii', 12, 16);
    if (variant === 'VP8X') return [1 + body.readUIntLE(24, 3), 1 + body.readUIntLE(27, 3)];
    if (variant === 'VP8L' && body[20] === 0x2f) {
      const size = body.readUInt32LE(21);
      return [1 + (size & 0x3fff), 1 + ((size >>> 14) & 0x3fff)];
    }
    if (variant === 'VP8 ' && body.readUIntBE(23, 3) === 0x9d012a)
      return [body.readUInt16LE(26) & 0x3fff, body.readUInt16LE(28) & 0x3fff];
  }
  if (mime === 'image/avif') {
    // Image Spatial Extents is an AVIF metadata property, before the image data.
    const offset = body.subarray(0, 65_536).indexOf('ispe', 16);
    if (offset >= 16 && offset + 16 <= body.length && body.readUInt32BE(offset - 4) === 20)
      return [body.readUInt32BE(offset + 8), body.readUInt32BE(offset + 12)];
  }
}

/** Use the website's own icon declarations; never substitute a third-party favicon service. */
export function brandFavicons(html: string, pageUrl: string): string[] {
  const { tags, base } = brandMetadata(html, pageUrl);
  const icons: { priority: number; size: number; url: string }[] = [];
  for (const { name, attributes } of tags) {
    const rel = (attributes.rel || '').toLowerCase().split(/\s+/);
    if (name !== 'link' || !attributes.href || !rel.some(value => ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'].includes(value))) continue;
    try { icons.push({ priority: rel.includes('icon') ? 0 : 1, size: Math.max(0, ...[...(attributes.sizes || '').matchAll(/(\d+)x\d+/g)].map(match => Number(match[1]))), url: brandWebsite(new URL(attributes.href, base).href) }); } catch { /* Ignore unsafe icon URLs. */ }
  }
  const candidates = icons.sort((a, b) => a.priority - b.priority || b.size - a.size).map(icon => icon.url);
  candidates.push(brandWebsite(new URL('/favicon.ico', pageUrl).href));
  return [...new Set(candidates)].slice(0, 8);
}

/** Only raster signatures can be served as cover images, regardless of remote Content-Type. */
export function brandCoverMime(body: Buffer): string | undefined {
  if (body.length < 16) return;
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (body[0] === 255 && body[1] === 216 && body[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(body.toString('ascii', 0, 6))) return 'image/gif';
  if (body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (body.toString('ascii', 4, 8) === 'ftyp') {
    const brand = body.toString('ascii', 8, 12);
    if (/^(avif|avis)$/.test(brand) || (brand === 'mif1' && body.subarray(16, Math.min(body.length, 64)).includes('avif')))
      return 'image/avif';
  }
}

export function brandFaviconMime(body: Buffer): string | undefined {
  const raster = brandCoverMime(body);
  if (raster) return raster;
  if (body.length <= 65_536) {
    const svg = body.toString('utf8').replace(/^\uFEFF?\s*(?:<\?xml\s+[^?]*\?>\s*)?/, '');
    // Served only as an image under a scriptless opaque-origin CSP.
    if (/^\s*<svg(?:\s|>)/i.test(svg) && /<\/svg>\s*$/i.test(svg) &&
      !/<!\s*(?:doctype|entity)|<\?|<(?:[a-z]+:)?(?:script|foreignObject|a)(?:\s|\/|>)|\s(?:on\w+\s*=|[\w:]*href\s*=\s*(?:"(?!#)|'(?!#)|[^"'#\s]))/i.test(svg))
      return 'image/svg+xml';
  }
  if (body.length < 22 || body.readUInt32LE(0) !== 0x00010000) return;
  const count = body.readUInt16LE(4);
  if (!count || count > 256 || body.length < 6 + count * 16) return;
  for (let index = 0; index < count; index++) {
    const offset = 6 + index * 16, length = body.readUInt32LE(offset + 8), start = body.readUInt32LE(offset + 12);
    if (!length || start < 6 + count * 16 || start + length > body.length) return;
  }
  return 'image/vnd.microsoft.icon';
}

export function sameBrandSite(website: string, candidate: string) {
  try {
    const a = new URL(website), b = new URL(candidate);
    if (a.protocol !== 'https:' || b.protocol !== 'https:') return false;
    const base = a.hostname.toLowerCase().replace(/^www\./, '');
    const target = b.hostname.toLowerCase();
    return target === base || target.endsWith('.' + base);
  } catch { return false; }
}

/** Deduplicate GitHub tree/blob paths so catalogue entries share one favicon and repo OG fetch. */
function normalizeArtworkUrl(url: string, kind: 'cover' | 'favicon', hasDirectCover: boolean, hasCoverPage: boolean) {
  if (hasCoverPage) return url;
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== 'github.com') return url;
  if (kind === 'favicon') return 'https://github.com/';
  if (!hasDirectCover) {
    const repo = parsed.pathname.match(/^\/([^/]+\/[^/]+)\/(?:tree|blob)\//);
    if (repo) return `https://github.com/${repo[1]}`;
  }
  return url;
}

/** Optional discovery artwork, cached outside both the checkout and the reusable Motion Package. */
export class BrandCoverCache {
  private pending = new Map<string, Promise<Cover | undefined>>();
  private running = 0;
  private waiting: (() => void)[] = [];
  private directory: string;
  private fetchResource: typeof fetchBrandResource;
  private now: () => number;
  constructor(directory: string, fetchResource = fetchBrandResource, now = Date.now) {
    this.directory = directory; this.fetchResource = fetchResource; this.now = now;
  }

  get(website: string, capturedImage?: string, coverPage?: string): Promise<Cover | undefined> {
    return this.request(website, 'cover', capturedImage, coverPage);
  }
  favicon(website: string, coverPage?: string): Promise<Cover | undefined> {
    return this.request(website, 'favicon', undefined, coverPage);
  }
  private request(website: string, kind: 'cover' | 'favicon', capturedImage?: string, coverPage?: string): Promise<Cover | undefined> {
    let url: string;
    try { url = brandWebsite(website); } catch { return Promise.resolve(undefined); }
    if (coverPage) {
      coverPage = imageUrl(coverPage, url);
      if (coverPage && (!sameBrandSite(url, coverPage) || coverPage === url)) coverPage = undefined;
    }
    url = normalizeArtworkUrl(url, kind, Boolean(capturedImage), Boolean(coverPage));
    const key = digest(url + '\n' + (kind === 'favicon' ? 'favicon' : capturedImage || '') + (coverPage ? '\n' + coverPage : ''));
    const existing = this.pending.get(key);
    if (existing) return existing;
    const result = this.readOrFetch(key, url, kind, capturedImage, coverPage).catch(() => undefined).finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result;
  }

  private async readOrFetch(key: string, website: string, kind: 'cover' | 'favicon', capturedImage?: string, coverPage?: string): Promise<Cover | undefined> {
    const imageMime = kind === 'favicon' ? brandFaviconMime : brandCoverMime;
    const file = path.join(this.directory, key + '.json');
    const receipt: Receipt | undefined = await readFile(file, 'utf8').then(JSON.parse, () => undefined);
    let previous: Cover | undefined;
    if (receipt?.hash && /^[a-f0-9]{64}$/.test(receipt.hash)) {
      const body = await readFile(path.join(this.directory, receipt.hash + '.image')).catch(() => undefined);
      if (body && digest(body) === receipt.hash && imageMime(body) === receipt.mime && receipt.source)
        previous = { body, mime: receipt.mime!, source: receipt.source };
    }
    if (receipt && (previous || (!receipt.hash && receipt.revision === brandCoverRevision)) &&
      this.now() - receipt.checkedAt < (previous ? successAge : failureAge)) return previous;
    // Lazy card loads share a bounded worker budget, including requests from several galleries.
    if (this.running >= 6) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.running++;
    let cover: Cover | undefined;
    try {
      const signal = AbortSignal.timeout(25_000);
      const fetch = async (input: string, timeout: number) => {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
        let url = brandWebsite(input);
        for (let hop = 0; hop < 5; hop++) {
          deadline.throwIfAborted();
          const response = await this.fetchResource(url, deadline);
          if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
            url = brandWebsite(new URL(response.headers.location, url).href);
            continue;
          }
          if (response.status !== 200) throw new Error('Cover resource is unavailable');
          return { ...response, url };
        }
        throw new Error('Too many cover redirects');
      };
      const seen = new Set<string>();
      let smallSocial: Cover | undefined;
      const image = async (url: string, fromPage = false) => {
        if (seen.has(url)) return;
        seen.add(url);
        const response = await fetch(url, kind === 'cover' ? 8000 : 6000);
        const mime = imageMime(response.body);
        if (!mime) throw new Error('Cover is not a raster image');
        if (kind === 'cover') {
          const size = coverDimensions(response.body, mime);
          if (size && size[0] * size[1] > 32_000_000) throw new Error('Image does not fit a gallery cover');
          if (!size && fromPage) throw new Error('Image does not fit a gallery cover');
          if (size && (size[0] < 240 || size[1] < 135 || (fromPage && size[0] / size[1] > 3.5))) {
            // Keep compact explicit OG/Twitter images (e.g. 180x180 or 200x200) as a fallback if no larger cover exists.
            if (!fromPage && !smallSocial && size[0] >= 120 && size[1] >= 120)
              smallSocial = { body: response.body, source: response.url, mime };
            throw new Error('Image does not fit a gallery cover');
          }
        }
        return { body: response.body, source: response.url, mime };
      };
      if (capturedImage) {
        try { cover = await image(new URL(capturedImage, website).href); } catch { /* Fall back to current page metadata. */ }
      }
      for (const url of coverPage ? [website, coverPage] : [website]) {
        if (cover) break;
        const page = await fetch(url, 10_000).catch(() => undefined);
        const html = /(?:text\/html|application\/xhtml\+xml)/i.test(page?.headers['content-type'] || '') ? page!.body.toString('utf8') : '';
        const pageUrl = page?.url || url;
        const first = async (urls: string[], fromPage = false) => {
          for (const candidate of urls) {
            try {
              const match = await image(candidate, fromPage);
              if (match) return match;
            } catch { signal.throwIfAborted(); }
          }
        };
        if (kind === 'favicon') {
          const fallbackIcons = ['/apple-touch-icon.png', '/favicon.png', '/favicon.svg']
            .map(pathname => { try { return brandWebsite(new URL(pathname, pageUrl).href); } catch { return ''; } })
            .filter(Boolean);
          cover = await first(brandFavicons(html, pageUrl)) ?? await first(fallbackIcons);
        } else {
          const metadata = brandMetadata(html, pageUrl);
          cover = await first(socialImages(metadata)) ?? await first(pageImages(metadata), true);
        }
      }
      cover ??= smallSocial;
    } catch { /* Optional metadata must never block browsing, extraction or playback. */ }
    finally {
      const next = this.waiting.shift();
      if (next) next(); else this.running--;
    }
    cover ??= previous;
    const record: Receipt = { checkedAt: this.now(), revision: brandCoverRevision };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (cover) {
      record.hash = digest(cover.body); record.mime = cover.mime; record.source = cover.source;
      await writeFile(path.join(this.directory, record.hash + '.image'), cover.body, { mode: 0o600 });
    }
    const temporary = file + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, file);
    return cover;
  }
}

const caches = new Map<string, BrandCoverCache>();
export function brandCoversFor(directory: string) {
  let cache = caches.get(directory);
  if (!cache) { cache = new BrandCoverCache(path.join(directory, 'brand-cover-cache')); caches.set(directory, cache); }
  return cache;
}
