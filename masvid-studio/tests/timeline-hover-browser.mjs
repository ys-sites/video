import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { Client } from './shared-editor-client.mjs';
import { closeFixtureEditor } from './fixtures.ts';
import { pluginRoot } from '../hyperframes.ts';
import { configureNativeEnvironment } from '../scripts/npm-runtime.mjs';

const out = process.argv[2]; assert(out && path.isAbsolute(out)); await mkdir(out, { recursive: true });
await configureNativeEnvironment(pluginRoot);
const data = await mkdtemp(path.join(tmpdir(), 'openmotion-hover-')), client = new Client(data);
let browser, page;
const results = [], errors = [];
const check = name => { results.push(name); console.log('PASS', name); };
const hover = async time => {
    await page.evaluate(() => { window.__hoverGeometry = null; });
    // Wait for the dock's animated resize and fit-zoom geometry to settle.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-timeline-scroll-viewport]');
      const width = el.clientWidth, pps = parseFloat(el.querySelector('[data-timeline-time-layer]').style.width);
      const expected = (width - Number(el.dataset.timelineContentOrigin)) / 12;
      const rect = el.getBoundingClientRect();
      const key = [rect.x, rect.width, pps].join(':');
      if (window.__hoverGeometry?.key !== key) { window.__hoverGeometry = { key, at: performance.now() }; return false; }
      return rect.right <= innerWidth && performance.now() - window.__hoverGeometry.at > 250 && pps > 0 && pps <= expected && pps > expected * 0.7;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const point = await page.$eval('[data-timeline-scroll-viewport]', (el, time) => {
    const r = el.getBoundingClientRect();
    const pps = parseFloat(el.querySelector('[data-timeline-time-layer]').style.width);
    return { x: r.left + Number(el.dataset.timelineContentOrigin) + time * pps - el.scrollLeft, y: r.top + 12 };
  }, time);
  await page.mouse.move(point.x, point.y);
  await page.waitForSelector('[data-hover-preview-status=ready]', { timeout: 15000 });
  await page.waitForFunction(time => {
    const p = document.querySelector('[data-testid=timeline-hover-preview] hyperframes-player');
    return p && Math.abs(p.currentTime - time) < 0.06;
  }, {}, time);
  return point;
};
const sample = () => page.evaluate(() => {
  const main = document.querySelector('[data-testid=preview-zoom-stage] hyperframes-player');
  const hover = document.querySelector('[data-testid=timeline-hover-preview] hyperframes-player');
  const read = p => ({ time: p.iframeElement.contentWindow.__player.getTime(),
    transform: p.iframeElement.contentWindow.getComputedStyle(p.iframeElement.contentDocument.querySelector('#dot')).transform });
  return { main: read(main), hover: hover && read(hover), silent: hover?.muted && hover?.audioLocked,
    selected: [...document.querySelectorAll('[data-clip][aria-pressed=true]')].map(el => el.dataset.elId) };
});
try {
  await client.initialize();
  const { projectId } = await client.call('openmotion_create_project', { projectType: 'natural_language', title: 'Frame inspection verification', requirements: 'Local deterministic hover fixture.', requestId: 'create' });
  const initial = await client.call('openmotion_get_project', { projectId });
  await client.call('openmotion_edit_project', { projectId, requestId: 'fixture', expectedRevision: initial.revision, expectedVersionId: initial.currentVersionId, files: [
    { path: 'assets/gsap.min.js', content: await readFile(path.join(pluginRoot, 'node_modules/gsap/dist/gsap.min.js'), 'utf8') },
    { path: 'index.html', content: '<!doctype html><html><head><script src="assets/gsap.min.js"></script><style>body{margin:0}#main{position:relative;width:1280px;height:720px;background:#153746;color:white;font:56px sans-serif}h1{position:absolute;left:100px;top:190px;margin:0}#dot{position:absolute;top:400px;left:100px;width:80px;height:80px;background:#c5eddf;border-radius:50%}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="12" data-width="1280" data-height="720"><h1 id="first" data-start="0" data-duration="6" data-track-index="0">First scene</h1><h1 id="second" data-start="6" data-duration="6" data-track-index="0">Second scene</h1><div id="dot" data-start="0" data-duration="12" data-track-index="1"></div></div><script>window.__timelines={main:gsap.timeline({paused:true}).to("#dot",{x:700,duration:12,ease:"none"})};</script></body></html>' },
  ] });
  const preview = await client.call('openmotion_open_preview', { projectId });
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
  await page.setViewport({ width: 1440, height: 950 }); await page.goto(preview.previewUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-timeline-scroll-viewport] [data-clip]');
  await page.click('[data-clip]');
  const before = await client.call('openmotion_get_project', { projectId });
  for (const [theme, width] of [['paper', 1440], ['dark', 1440], ['paper', 700], ['dark', 700]]) {
    await page.mouse.move(5, 5); await page.setViewport({ width, height: 950 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const start = await sample();
    await hover(2); const a = await sample();
    await hover(8); const b = await sample();
    assert.deepEqual(a.main, start.main); assert.deepEqual(b.main, start.main);
    assert.deepEqual(b.selected, start.selected); assert(b.silent);
    assert.notEqual(a.hover.transform, b.hover.transform);
    const box = await page.$eval('[data-testid=timeline-hover-preview]', el => {
      const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
      return { inside: r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom, pointer: getComputedStyle(el).pointerEvents };
    });
    assert(box.inside); assert.equal(box.pointer, 'none');
    await page.screenshot({ path: path.join(out, `hover-${theme}-${width}.png`) });
    check(`Independent moving frames, muted preview, stable playhead/selection, contained overlay: ${theme} ${width}px`);
    await page.mouse.move(5, 5); await page.waitForSelector('[data-testid=timeline-hover-preview]', { hidden: true });
    assert.equal(await page.$$eval('hyperframes-player', nodes => nodes.length), 1);
  }
  await page.setViewport({ width: 1440, height: 950 });
  const point = await hover(5);
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('[data-testid=timeline-hover-preview]', { hidden: true });
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('input[aria-label="Seek preview"]').value) - 5) < 0.08);
  check('Ruler click commits the inspected time and dismisses hover');
  await hover(8); await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid=timeline-hover-preview]', { hidden: true });
  await page.click('[data-studio-control=playback]');
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Seek preview"]').value) > 5.5);
  assert.equal(await page.$('[data-testid=timeline-hover-preview]'), null);
  await page.click('[data-studio-control=playback]');
  check('Escape dismisses; playback suppresses hover');
  // A failed secondary document must stop loading, preserve the main player and recover.
  await page.mouse.move(5, 5);
  await page.setRequestInterception(true);
  const blockHover = request => request.isNavigationRequest() && request.url().includes('/preview')
    ? request.abort('failed') : request.continue();
  page.on('request', blockHover);
  const unchanged = (await sample()).main;
  await page.mouse.move(point.x, point.y);
  await page.waitForSelector('[data-hover-preview-status=loading]');
  await page.screenshot({ path: path.join(out, 'hover-loading.png') });
  await page.waitForSelector('[data-hover-preview-status=error]', { timeout: 15000 });
  await page.screenshot({ path: path.join(out, 'hover-error.png') });
  assert.deepEqual((await sample()).main, unchanged);
  await page.mouse.move(5, 5);
  page.off('request', blockHover); await page.setRequestInterception(false);
  await hover(8);
  check('Loading reserves geometry; failed preview releases its runtime and recovers on re-hover');
  const after = await client.call('openmotion_get_project', { projectId }); assert.equal(after.revision, before.revision);
  await page.setViewport({ width: 700, height: 800 });
  for (const [ratio, width, height] of [['9:16', 1080, 1920], ['1:1', 1080, 1080], ['4:3', 1440, 1080], ['3:4', 1080, 1440], ['16:9', 1920, 1080]]) {
    await page.mouse.move(5, 5);
    const current = await client.call('openmotion_get_project', { projectId });
    await client.call('openmotion_edit_project', { projectId, requestId: `hover-${ratio}`, expectedRevision: current.revision, expectedVersionId: current.currentVersionId, canvas: { compositionPath: 'index.html', ratio, fit: 'contain' } });
    await page.waitForFunction(ratio => document.querySelector('button[aria-label="Aspect ratio"]')?.textContent === ratio, {}, ratio);
    await hover(2);
    const geometry = await page.$eval('[data-testid=timeline-hover-preview]', el => {
      const frame = el.querySelector('.motion-timeline-hover-frame').getBoundingClientRect(), player = el.querySelector('hyperframes-player');
      const box = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
      return { ratio: frame.width / frame.height, width: player.getAttribute('width'), height: player.getAttribute('height'), contained: box.top >= parent.top && box.bottom <= parent.bottom && box.left >= parent.left && box.right <= parent.right };
    });
    assert(Math.abs(geometry.ratio - width / height) < .01);
    assert.deepEqual([geometry.width, geometry.height], [String(width), String(height)]);
    assert(geometry.contained, `The ${ratio} frame and caption fit inside the preview`);
    await page.screenshot({ path: path.join(out, `hover-ratio-${ratio.replace(':', '-')}.png`) });
  }
  check('All five hover frame ratios match their native canvas and fit the narrow preview');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  console.log(JSON.stringify(await page?.evaluate(() => ({ hover:document.querySelector('[data-testid=timeline-hover-preview]')?.outerHTML, line:document.querySelector('[data-timeline-hover-time]')?.outerHTML, changing:document.documentElement.hasAttribute('data-preview-changing'), hidden:document.hidden, menus:[...document.querySelectorAll('[role=menu],[role=dialog]')].map(el=>({tag:el.tagName,cls:el.className,rect:el.getBoundingClientRect().toJSON(),vis:getComputedStyle(el).visibility,display:getComputedStyle(el).display,opacity:getComputedStyle(el).opacity,rects:el.getClientRects().length})), hovered:[...document.querySelectorAll(':hover')].map(el=>el.tagName+'.'+String(el.className).slice(0,100)).slice(-5) })), null, 2));

  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  await writeFile(path.join(out, 'failure.txt'), String(error.stack)); throw error;
} finally { await browser?.close(); await client.close(); await closeFixtureEditor(data); await rm(data, { recursive: true, force: true, maxRetries: 5 }); }
