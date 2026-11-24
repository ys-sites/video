import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import type { BrandLogo } from '../shared/brand-kit.ts';

export type CapturedBrandImage = { data: Buffer; mime: string };

/** Capture visible brand marks as pixels; never publish arbitrary remote SVG/HTML. */
export async function captureBrandLogos(page: Page, directory: string, brandName = "", images = new Map<string, CapturedBrandImage>()): Promise<BrandLogo[]> {
  const handles = (await page.$$('img, svg')).slice(0, 160);
  const ranked = [];
  for (const handle of handles) {
    const evidence = await handle.evaluate((el, brandName) => {
      const box = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || box.width < 16 || box.height < 12 || box.width > 600 || box.height > 250) return null;
      if (el.closest('[class*="partner" i], [class*="customer" i], [class*="marquee" i], [class*="social" i], button')) return null;
      const label = el.getAttribute('alt') || el.getAttribute('aria-label') || el.querySelector('title')?.textContent || '';
      const hints = label + ' ' + el.getAttribute('class') + ' ' + el.id;
      const link = el.closest('a');
      const home = link && link.origin === location.origin && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/?)?$/i.test(link.pathname);
      const header = !!el.closest('header, nav, [role="banner"], [role="navigation"]');
      const explicit = /logo|brand|wordmark/i.test(hints);
      if (!explicit && !(header && home)) return null;
      const name = brandName.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const identity = (label + ' ' + (el instanceof HTMLImageElement && el.currentSrc ? new URL(el.currentSrc, location.href).pathname : '')).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const ownRegion = header || !!el.closest('footer');
      if (!(header && home) && (!name || !identity.includes(name)) && !(ownRegion && /^(logo|brand logo|wordmark)$/i.test(label.trim()))) return null;
      if (!ownRegion && (box.height > 140 || label.length > 80)) return null;
      if (el.tagName.toLowerCase() === 'div' && el.querySelector('img,svg')) return null;
      if (s.visibility === 'hidden') return null;
      return { label: label.slice(0, 100) || 'Logo', source: el instanceof HTMLImageElement ? el.currentSrc : location.href,
        width: Math.round(box.width), height: Math.round(box.height), score: Number(home) * 5 + Number(header) * 3 + Number(explicit) * 2 };
    }, brandName);
    if (evidence) ranked.push({ handle, evidence });
  }
  const logos: BrandLogo[] = [], hashes = new Set<string>();
  const raster = await page.browser().newPage();
  await raster.setJavaScriptEnabled(false);
  await raster.setRequestInterception(true);
  raster.on('request', request => void (request.url().startsWith('data:image/') ? request.continue() : request.abort()).catch(() => {}));
  try {
  for (const { handle, evidence } of ranked.sort((a, b) => b.evidence.score - a.evidence.score).slice(0, 12)) {
    if (logos.length >= 6) break;
    try {
      let image = images.get(evidence.source);
      if (!image) {
        const svg = await handle.evaluate(el => {
          if (el.tagName.toLowerCase() !== 'svg') return null;
          const copy = el.cloneNode(true) as SVGElement;
          const original = [el, ...el.querySelectorAll('*')];
          const children = [copy, ...copy.querySelectorAll('*')];
          original.slice(0, 500).forEach((node, i) => {
            const style = getComputedStyle(node);
            for (const key of ['fill','stroke','stroke-width','opacity','color','font-family','font-size'])
              (children[i] as SVGElement).style.setProperty(key, style.getPropertyValue(key));
          });
          copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
          return copy.outerHTML.length <= 500_000 ? copy.outerHTML : null;
        });
        if (!svg) continue;
        image = { data: Buffer.from(svg), mime: 'image/svg+xml' };
      }
      // Render the asset by itself: page overlays, sticky headers and autoplay media cannot contaminate its pixels.
      const dataUrl = `data:${image.mime};base64,${image.data.toString('base64')}`;
      await raster.setViewport({ width: evidence.width, height: evidence.height, deviceScaleFactor: 2 });
      await raster.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{margin:0}img{display:block;width:100vw;height:100vh;object-fit:contain}</style><img src="${dataUrl}">`, { waitUntil:'load', timeout:5000 });
      const valid = await raster.evaluate(() => { const img = document.querySelector('img')!; return img.complete && img.naturalWidth > 0; });
      if (!valid) continue;
      const bytes = await raster.screenshot({ type: 'png', omitBackground: true });
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      const relative = logos.length ? `assets/logo-${logos.length + 1}.png` : 'assets/logo.png';
      await writeFile(path.join(directory, relative), bytes);
      const { score: _score, ...metadata } = evidence;
      logos.push({ ...metadata, source: /^https:\/\//.test(metadata.source) ? metadata.source : page.url(), path: relative });
    } catch { /* A replaced or offscreen candidate is not a captured asset. */ }
  }
  } finally { await raster.close(); await Promise.all(handles.map(handle => handle.dispose())); }
  await page.evaluate(() => window.scrollTo(0, 0));
  return logos;
}
