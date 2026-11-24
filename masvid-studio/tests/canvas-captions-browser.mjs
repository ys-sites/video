import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { Client } from './shared-editor-client.mjs';
import { closeFixtureEditor } from './fixtures.ts';
import { pluginRoot } from '../hyperframes.ts';
import { configureNativeEnvironment } from '../scripts/npm-runtime.mjs';
import { compositionCanvasSource } from '../shared/composition-canvas.ts';
import { loadCanvasSourceOperations } from '../shared/composition-canvas-source.ts';

const out = process.argv[2]; assert(out && path.isAbsolute(out)); await mkdir(out, { recursive: true });
await configureNativeEnvironment(pluginRoot);
const data = await mkdtemp(path.join(tmpdir(), 'openmotion-canvas-captions-')), client = new Client(data);
let browser, page;
const errors = [], results = [];
const check = name => { results.push(name); console.log('PASS', name); };
const click = async (selector, text) => {
  const handle = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(el => el.getBoundingClientRect().width && (!text || el.textContent.trim() === text) && !el.disabled), {}, selector, text);
  await handle.asElement().evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, {}, handle);
  await handle.asElement().click(); await handle.dispose();
};
const capture = async name => { await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime < 1000).map(a => a.finished)); }); await page.screenshot({ path: path.join(out, name + '.png') }); };
try {
  await client.initialize();
  const created = await client.call('openmotion_create_project', { projectType: 'natural_language', title: 'Canvas and captions fixture', requirements: 'Synthetic geometric framing and subtitle verification.', requestId: 'create' });
  const projectId = created.projectId;
  let current = await client.call('openmotion_get_project', { projectId });
  await client.call('openmotion_edit_project', { projectId, requestId: 'fixture', expectedRevision: current.revision, expectedVersionId: current.currentVersionId, files: [
    { path: 'assets/gsap.min.js', content: await readFile(path.join(pluginRoot, 'node_modules/gsap/dist/gsap.min.js'), 'utf8') },
    { path: 'index.html', content: '<!doctype html><html><head><script src="assets/gsap.min.js"></script><style>body{margin:0}#main{position:relative;width:640px;height:360px;background:#1b4b5a;color:white;font:32px sans-serif}#main>h1{position:absolute;left:80px;top:90px;margin:0;font-size:40px}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="2" data-width="640" data-height="360" data-fps="10"><h1 id="title" class="clip" data-start="0" data-duration="2" data-track-index="0">Canvas fixture</h1></div><script>window.__timelines={main:gsap.timeline({paused:true}).fromTo("#title",{x:0},{x:20,duration:2})};</script></body></html>' },
  ] });
  const preview = await client.call('openmotion_open_preview', { projectId });
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const parsers = await loadCanvasSourceOperations(pluginRoot);
  const sceneTemplate = await readFile(path.join(pluginRoot, 'template-library/decision-tree/compositions/decision_tree.html'), 'utf8');
  const scene = parsers.parseHTML(sceneTemplate).document.querySelector('template').innerHTML;
  const stylePage = await browser.newPage();
  await stylePage.setViewport({ width: 1080, height: 1920 });
  const inspectRoot = async (html, selector) => {
    const { document } = parsers.parseHTML(html);
    for (const script of document.querySelectorAll('script')) script.remove();
    await stylePage.setContent(document.toString());
    await stylePage.addStyleTag({ content: 'body { margin: 0 }' });
    return stylePage.$eval(selector, el => {
      const s = getComputedStyle(el);
      return { background: s.backgroundColor, image: s.backgroundImage, size: s.backgroundSize, position: s.position, font: s.fontFamily, overflow: s.overflow, width: s.width, height: s.height };
    });
  };
  const authored = await inspectRoot(scene, '[data-composition-id]');
  for (const fit of ['contain', 'cover']) {
    const framed = compositionCanvasSource(scene, parsers, { ratio: '9:16', fit }).content;
    assert.deepEqual(await inspectRoot(framed, '[data-canvas-content]'), authored);
    await stylePage.screenshot({ path: path.join(out, `decision-tree-${fit}.png`) });
  }
  await stylePage.close();
  check('Decision Tree retains its root attribute styles and dotted background in both fit modes');
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
  await page.setViewport({ width: 1440, height: 900 }); await page.goto(preview.previewUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('button[aria-label="Caption visibility"]')?.textContent === 'Off');
  const tracks = () => client.call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'caption_tracks', projectId, compositionPath: 'index.html' } });
  await click('button[aria-label="Caption visibility"]'); await click('[role=radio]', 'On');
  await page.waitForSelector('[data-testid=empty-caption-track]');
  assert.equal((await tracks()).tracks.length, 1); assert.equal((await tracks()).tracks[0].cueCount, 0);
  check('On persists one empty C1 track'); await capture('caption-on-empty');
  await click('[role=radio]', 'Off');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Caption visibility"]')?.textContent === 'Off'); await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('button[aria-label="Caption visibility"]')?.textContent === 'Off');
  assert.equal((await tracks()).tracks.length, 1); check('Off survives reload without deleting the lane');
  await click('button[aria-label="Caption visibility"]'); await click('[role=radio]', 'On');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Caption visibility"]')?.textContent === 'On'); await page.keyboard.press('Escape');
  assert.equal((await tracks()).tracks.length, 1);
  for (const theme of ['light', 'dark']) for (const width of [1440, 700, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme === 'light' ? 'paper' : 'dark'; }, theme);
    await click('button[aria-label="Aspect ratio"]');
    await page.waitForSelector('[role=radio]'); await capture(`aspect-menu-${theme}-${width}`);
    for (const option of await page.$$('[role=radio]')) assert(await option.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Every opened option is reachable');
    await page.keyboard.press('Escape'); await click('button[aria-label="Caption visibility"]'); await capture(`caption-menu-${theme}-${width}`); await page.keyboard.press('Escape');
  }
  check('Opened menus fit and remain clickable in both themes and narrow layout');
  await page.setViewport({ width: 1440, height: 900 });
  for (const ratio of ['9:16', '1:1', '4:3', '3:4', '16:9']) {
    await click('button[aria-label="Aspect ratio"]'); await click('[role=radio]', ratio);
    await page.waitForFunction(ratio => document.querySelector('button[aria-label="Aspect ratio"]')?.textContent === ratio, {}, ratio);
    check(`UI canvas ${ratio}`);
  }
  await click('button[aria-label="Aspect ratio"]'); await click('[role=radio]', '9:16');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Aspect ratio"]')?.textContent === '9:16');
  await capture('portrait-letterbox');
  await click('button[aria-label="Aspect ratio"]'); await click('[role=radio]', 'Crop');
  for (let attempt = 0; ; attempt++) {
    const ready = (await Promise.all(page.frames().map(frame => frame.evaluate(() => Boolean(document.querySelector('[data-canvas-fit="cover"]'))).catch(() => false)))).some(Boolean);
    if (ready) break;
    assert(attempt < 100, 'The live preview must update its content fit'); await new Promise(resolve => setTimeout(resolve, 100));
  }
  await capture('portrait-crop');
  await writeFile(path.join(out, 'saved-source.html'), (await client.call('openmotion_get_project', { projectId, file: { path: 'index.html' } })).file.content);
  current = await client.call('openmotion_get_project', { projectId });
  await client.call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'caption_add', projectId, compositionPath: 'index.html', requestId: 'fill-empty', expectedRevision: current.revision, expectedVersionId: current.currentVersionId, segments: [{ id: 'cue', text: 'A real caption', start: 0, end: 1 }] } });
  await page.waitForFunction(() => !document.querySelector('[data-testid=empty-caption-track]'));
  assert.equal((await tracks()).tracks.length, 1); assert.equal((await tracks()).tracks[0].cueCount, 1); check('MCP fills the same C1 lane and Studio refreshes');
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => document.querySelector('button[aria-label="Aspect ratio"]')?.textContent === '9:16');
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Aspect ratio"]'), rect = button?.getBoundingClientRect();
    return rect?.width && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  });
  await capture('saved-portrait-captions');
  assert.equal(await page.$$eval('[data-clip]', nodes => nodes.length), 2, 'Framing must not create a phantom content clip');
  const previewDocuments = await Promise.all(page.frames().map(frame => frame.evaluate(() => document.querySelector('[data-composition-id]')?.outerHTML).catch(() => null)));
  await writeFile(path.join(out, 'live-preview.json'), JSON.stringify(previewDocuments.filter(Boolean), null, 2));
  current = await client.call('openmotion_get_project', { projectId });
  const exportArgs = { projectId, versionId: current.currentVersionId, expectedRevision: current.revision, requestId: 'portrait-export', audio: 'silent' };
  const queued = await client.call('openmotion_export_request', exportArgs);
  assert.equal((await client.call('openmotion_export_request', exportArgs)).job.id, queued.job.id);
  let completed; const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const { exportJob } = await client.call('openmotion_get_project', { projectId, exportJobId: queued.job.id });
    assert.notEqual(exportJob.state, 'failed', JSON.stringify(exportJob));
    if (exportJob.state === 'completed') { completed = exportJob; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(completed, 'Export finishes'); assert.equal(completed.verification.status, 'passed');
  assert.equal(completed.expected.width, 1080); assert.equal(completed.expected.height, 1920); assert.equal(completed.expected.duration, 2);
  await copyFile(completed.path, path.join(out, 'portrait-captions.mp4'));
  const playback = await browser.newPage();
  await playback.setContent('<video controls style="height:80vh" id="result"></video>');
  const media = await playback.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const video = document.querySelector('video'); video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    await video.play();
    await new Promise((resolve, reject) => { const end = performance.now() + 10000; const tick = () => video.currentTime > 0.5 ? resolve() : performance.now() > end ? reject(new Error('Playback stalled')) : requestAnimationFrame(tick); tick(); });
    video.pause(); video.controls = false;
    return { width: video.videoWidth, height: video.videoHeight, frames: video.getVideoPlaybackQuality().totalVideoFrames, time: video.currentTime };
  }, (await readFile(completed.path)).toString('base64'));
  assert.equal(media.width, 1080); assert.equal(media.height, 1920); assert(media.frames > 1);
  await playback.screenshot({ path: path.join(out, 'export-playback.png') }); await playback.close();
  check('Native MP4 exports at 1080×1920 and plays real frames with captions');
  await writeFile(path.join(out, 'export-verification.json'), JSON.stringify({ verification: completed.verification, media }, null, 2));
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ results, errors, scope: 'real Studio and stdio MCP; synthetic local source; no model calls' }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  await writeFile(path.join(out, 'failure.txt'), String(error.stack)); throw error;
} finally { await browser?.close(); await client.close(); await closeFixtureEditor(data); await rm(data, { recursive: true, force: true, maxRetries: 5 }); }
