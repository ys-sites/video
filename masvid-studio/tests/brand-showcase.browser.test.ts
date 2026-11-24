import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';
import { writeBrandProject } from '../gateway/brand-package.ts';
import { catalogCapture, readBrandCatalog } from '../gateway/brand-catalog.ts';
import { brandKitHttp } from '../gateway/brand-http.ts';

test('the served sandboxed catalogue showcases run GSAP and honor player commands', async t => {
  const executablePath = await browserExecutable().catch(() => undefined);
  if (!executablePath) return t.skip('Chrome is required to exercise the sandbox');
  const directory = await mkdtemp(path.join(tmpdir(), 'brand-showcase-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><script>
        addEventListener('message', event => {
          if (event.source === document.getElementById('detail')?.contentWindow
            && event.data?.type === 'openmotion:brand-preview-ready') document.body.dataset.readyOrigin = event.origin;
        });
        </script>
        <iframe id="hover" sandbox="allow-scripts" src="/motion-api/brand-kits/catalog/agentic/showcase"></iframe>
        <iframe id="detail" sandbox="allow-scripts" src="/motion-api/brand-kits/catalog/agentic/showcase?detail=1"></iframe>`);
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    url.pathname = url.pathname.replace(/^\/motion-api\//, '/api/');
    void brandKitHttp(req, res, url, directory, async () => { throw new Error('Unexpected request body'); })
      .then(handled => { if (!handled) { res.writeHead(404); res.end(); } });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const browser = await puppeteer.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + (server.address() as { port: number }).port);
  await page.waitForFunction(() => document.body.dataset.readyOrigin === 'null', { timeout: 5000 });
  const hover = await (await page.waitForSelector('#hover'))!.contentFrame();
  const detail = await (await page.waitForSelector('#detail'))!.contentFrame();
  await hover.waitForFunction(() => (window as any).__timelines?.main?.time() > .1, { timeout: 5000 });
  assert.equal(await detail.evaluate(() => (window as any).__timelines.main.paused()), true);
  const setPlaying = (playing: boolean) => page.$eval('#detail', (iframe: HTMLIFrameElement, playing) =>
    iframe.contentWindow!.postMessage({ type: 'openmotion:brand-playback', playing }, '*'), playing);
  await setPlaying(true);
  await detail.waitForFunction(() => (window as any).__timelines?.main?.time() > .1, { timeout: 5000 });
  await setPlaying(false);
  await detail.waitForFunction(() => (window as any).__timelines.main.paused(), { timeout: 5000 });
});

test('brand showcase keeps content centered and palette labels clear across fonts and corner shapes', async t => {
  const executablePath = await browserExecutable().catch(() => undefined);
  if (!executablePath) return t.skip('Chrome is required for showcase layout checks');
  const browser = await puppeteer.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const directory = await mkdtemp(path.join(tmpdir(), 'brand-showcase-layout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const capture = catalogCapture((await readBrandCatalog()).entries[0]);
  for (const [radius, font, name] of [
    ['0px', 'Arial, sans-serif', 'Square'],
    ['24px', 'Georgia, serif', 'Rounded'],
    ['999px', 'Arial, sans-serif', 'Pill'],
    ['50%', 'Courier New, monospace', 'Circle'],
    ['999px', 'Courier New, monospace', 'W'.repeat(100)],
  ]) {
    capture.sample.name = name;
    Object.assign(capture.sample.style, { radius, headingFont: font, bodyFont: font });
    await writeBrandProject(directory, capture, path.resolve('.'));
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
    await page.evaluate(() => document.fonts.ready);
    // Backward seeks catch stale animation transforms and overlapping scenes too.
    for (const time of [1.5, 4.5, 7.5, 10.5, 7.5, 1.5]) {
      const layout = await page.evaluate(time => {
        (window as any).__timelines.main.seek(time);
        const visible = [...document.querySelectorAll<HTMLElement>('.scene')].filter(element => getComputedStyle(element).visibility === 'visible');
        const scene = visible[0];
        const content = scene.querySelector<HTMLElement>('.content-stack, .card')!;
        const bounds = content.getBoundingClientRect();
        const textRects: DOMRect[] = [];
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          textRects.push(...range.getClientRects());
        }
        return {
          visible: visible.map(element => element.id),
          center: [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
          overflow: textRects.filter(rect => rect.left < 64 || rect.right > 1216 || rect.top < 128 || rect.bottom > 592).map(rect => rect.toJSON()),
          palette: [...scene.querySelectorAll('.swatch')].map(swatch => {
            const color = swatch.querySelector('.swatch-color')!.getBoundingClientRect();
            const label = swatch.querySelector('figcaption')!.getBoundingClientRect();
            return { gap: label.top - color.bottom, offset: label.x + label.width / 2 - color.x - color.width / 2 };
          }),
        };
      }, time);
      const context = `${radius}, ${font}, ${name.length} chars, ${time}s`;
      assert.deepEqual(layout.visible, [['title', 'type', 'palette', 'finish'][Math.floor(time / 3)]], context);
      assert(Math.abs(layout.center[0] - 640) < 1 && Math.abs(layout.center[1] - 360) < 1, `center: ${context}`);
      assert.deepEqual(layout.overflow, [], `text stays within safe area: ${context}`);
      for (const label of layout.palette) {
        assert(label.gap >= 12, `color labels must not overlap rounded swatches: ${context}`);
        assert(Math.abs(label.offset) < 1, `color labels are centered: ${context}`);
      }
    }
  }
});
