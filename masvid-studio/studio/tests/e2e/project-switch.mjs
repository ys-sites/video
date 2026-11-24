// Run under browser-lock.sh; delay native preparation without replacing responses.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { WorkspaceStore, createBlankProject } from '../../../workspace.ts';
import { handler } from '../../../server.ts';
import { startWorkspaceStudio } from '../../../shared/workspace-studio.ts';
import { resolveChromeExecutable } from './chrome-executable.mjs';

assert.ok(process.env.D4_LANE, 'Acquire a shared browser lane first');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = process.env.EVIDENCE_DIR || await mkdtemp(path.join(tmpdir(), 'motion-project-switch-'));
await mkdir(output, { recursive: true });
process.env.HYPERFRAMES_HISTORY_ROOT = path.join(output, 'history');
const store = new WorkspaceStore(await mkdtemp(path.join(output, 'workspace-')));
await store.initialize(root);
const first = store.projectId, second = crypto.randomUUID();
await createBlankProject(store.projectDirectoryFor(second), root, 'Second project');
for (const [id, label] of [[first, 'first'], [second, 'second']]) {
  await writeFile(path.join(store.projectDirectoryFor(id), 'index.html'), `<!doctype html><html><head><script src="assets/gsap.min.js"></script></head><body style="margin:0"><div id="main" data-composition-id="main" data-start="0" data-duration="5" data-width="640" data-height="360" style="position:relative;width:640px;height:360px;background:#eee"><div id="${label}" data-start="0" data-duration="5" data-track-index="0">${label}</div></div><script>window.__timelines={main:gsap.timeline({paused:true})};</script></body></html>`);
}
await store.selectProject(second, { id: second, title: 'Second project', createdAt: Date.now() });
const native = await startWorkspaceStudio(root, store.directory, store.projectDirectory, Number(process.env.D4_LANE_API_PORT));
const studio = { url: native.origin, alive: () => true, projectDirectory: store.projectDirectory,
  openProject: async id => { const response = await fetch(`${native.origin}/api/projects/${id}`); assert.ok(response.ok); } };
const context = { studio, runtimeRoot: root, nativeRoot: root, ffmpeg: true, ensureStudio: async () => studio };
const server = createServer((req, res) => {
  const forward = () => handler(req, res, store, context);
  if (req.url.startsWith('/motion-api/preview/open')) setTimeout(forward, 500);
  else if (req.url === '/motion-api/projects') setTimeout(forward, 1200);
  else void forward();
});
await new Promise(resolve => server.listen(Number(process.env.PLAYWRIGHT_WEB_PORT), '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
try {
  browser = await puppeteer.launch({ executablePath: resolveChromeExecutable(), headless: true });
  for (const [theme, width] of [['light', 1440], ['dark', 1440], ['light', 760]]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let documents = 0;
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
    await page.setViewport({ width, height: 960 });
    await page.evaluateOnNewDocument(theme => {
      localStorage.setItem('motion.studio.locale', 'en');
      localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme }));
    }, theme);
    await page.goto(`${origin}/?project=${first}#project/${first}`);
    if (width >= 1000) {
      await page.waitForSelector('[data-testid="project-list-skeleton"]');
      assert.equal(await page.$$eval('[data-testid="project-list-skeleton"]', rows => rows.length), 3);
      assert.equal(await page.$eval('.motion-session-list', list => list.innerText), '');
      assert.ok(await page.$$eval('[data-testid="project-list-skeleton"]', rows => rows.every(row => row.getBoundingClientRect().height === 38)));
      await page.screenshot({ path: path.join(output, `${theme}-${width}-project-skeleton.png`) });
    }
    await page.waitForSelector('[data-el-id="index.html#first"]', { timeout: 60000 });
    await page.waitForSelector('[data-editor-initializing="false"]', { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="timeline-loading-disabled-overlay"]'));
    const firstSource = await readFile(path.join(store.projectDirectoryFor(first), 'index.html'), 'utf8');
    if (width < 1000) {
      await page.click('.om-app-rail [aria-label="Home"]');
      await page.waitForSelector('[role="dialog"] .motion-session');
      await page.waitForFunction(() => document.querySelector('[role="dialog"] .motion-sidebar').getBoundingClientRect().x === 0);
    }
    await page.waitForFunction(() => [...document.querySelectorAll('button.motion-session')].some(button => button.title === 'Second project' && !button.disabled));
    await page.evaluate(() => {
      const selectors = ['.om-app-header', '.om-app-rail', '.motion-sidebar', '.motion-workspace-content'];
      window.__switchNodes = selectors.map(selector => document.querySelector(selector));
      window.__switchSamples = [];
      const sample = () => {
        const loading = document.querySelector('.motion-workspace-content .motion-loading');
        const mark = loading?.querySelector('.motion-loading-mark')?.getBoundingClientRect();
        window.__switchSamples.push({
          retained: selectors.every((selector, index) => document.querySelector(selector) === window.__switchNodes[index]),
          boxes: window.__switchNodes.map(node => { const box = node.getBoundingClientRect(); return [box.x, box.y, box.width, box.height]; }),
          loading: document.querySelectorAll('.motion-loading').length,
          listSkeletons: document.querySelectorAll('[data-testid="project-list-skeleton"]').length,
          listNotices: document.querySelectorAll('.motion-session-empty').length,
          initializing: document.querySelector('[data-editor-initializing]')?.getAttribute('data-editor-initializing'),
          placeholder: document.querySelector('.motion-editor-placeholder')?.getAttribute('style'),
          presentedProject: document.querySelector('[data-editor-initializing="false"] .motion-project-name-input')?.value,
          timeline: (() => { const box = document.querySelector('[data-studio-timeline]')?.getBoundingClientRect(); return box ? [box.x, box.y, box.width, box.height] : null; })(),
          controls: [...document.querySelectorAll('.motion-timeline-toolbar button[aria-label="Zoom in"], .motion-timeline-toolbar button[aria-label="Fit timeline to width"]')].map(button => ({ disabled: button.disabled, color: getComputedStyle(button).color })),
          mark: mark ? [mark.x, mark.y] : null,
        });
        window.__switchFrame = requestAnimationFrame(sample);
      };
      sample();
    });
    await page.evaluate(() => [...document.querySelectorAll('.motion-session')].find(button => button.title === 'Second project').click());
    await page.waitForSelector('.motion-workspace-content .motion-loading', { timeout: 10000 });
    await page.screenshot({ path: path.join(output, `${theme}-${width}-loading.png`) });
    await page.waitForSelector('[data-el-id="index.html#second"]', { timeout: 60000 });
    await page.waitForSelector('[data-editor-initializing="false"]', { timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 400));
    const samples = await page.evaluate(() => { cancelAnimationFrame(window.__switchFrame); return window.__switchSamples; });
    await writeFile(path.join(output, `${theme}-${width}-samples.json`), JSON.stringify(samples));
    assert.ok(samples.length > 2);
    assert.ok(samples.every(sample => sample.retained), 'Shell DOM identity must survive switching');
    assert.ok(samples.every(sample => JSON.stringify(sample.boxes) === JSON.stringify(samples[0].boxes)), 'Shell geometry must remain fixed');
    assert.ok(samples.every(sample => sample.loading <= 1), 'Only one workspace loading indicator');
    assert.ok(samples.every(sample => sample.listSkeletons === 0 && sample.listNotices === 0), 'Cached project rows must never be displaced by loading content');
    const presented = samples.filter(sample => sample.presentedProject === 'Second project');
    assert.ok(presented.length > 2);
    assert.ok(presented.every(sample => JSON.stringify(sample.timeline) === JSON.stringify(presented[0].timeline)), 'Target timeline geometry must settle before presentation');
    assert.ok(presented.every(sample => JSON.stringify(sample.controls) === JSON.stringify(presented[0].controls)), 'Initialization must not animate controls after presentation');
    const placeholders = samples.filter(sample => sample.placeholder).map(sample => sample.placeholder);
    assert.ok(placeholders.length > 0);
    assert.ok(placeholders.every(style => style === placeholders[0]), 'Retain the previous editor geometry throughout initialization');
    const marks = samples.filter(sample => sample.mark).map(sample => sample.mark);
    assert.ok(marks.length > 1);
    assert.ok(marks.every(mark => JSON.stringify(mark) === JSON.stringify(marks[0])), 'Loading artwork must not move');
    assert.equal(documents, 1, 'Switching must not navigate the top-level document');
    await page.screenshot({ path: path.join(output, `${theme}-${width}-ready.png`) });
    if (theme === 'light' && width === 1440) {
      await page.click('[data-el-id="index.html#second"]');
      await page.waitForSelector('button[aria-label="Zoom to selected clips"]:not([disabled])');
      await page.keyboard.press('Delete');
      await page.waitForFunction(() => !document.querySelector('[data-el-id="index.html#second"]'));
      assert.ok(!(await readFile(path.join(store.projectDirectoryFor(second), 'index.html'), 'utf8')).includes('id="second"'), 'Deleting a clip must save to the target project');
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.down(modifier); await page.keyboard.press('z'); await page.keyboard.up(modifier);
      await page.waitForSelector('[data-el-id="index.html#second"]');
      assert.ok((await readFile(path.join(store.projectDirectoryFor(second), 'index.html'), 'utf8')).includes('id="second"'), 'Undo must restore the saved target source');
      assert.equal(await readFile(path.join(store.projectDirectoryFor(first), 'index.html'), 'utf8'), firstSource, 'Editing and undo must leave the other project untouched');
    }
    await page.goBack();
    await page.waitForSelector('[data-el-id="index.html#first"]', { timeout: 60000 });
    await page.goForward();
    await page.waitForSelector('[data-el-id="index.html#second"]', { timeout: 60000 });
    assert.equal(documents, 1, 'History traversal must stay in the mounted workspace');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    results.push({ theme, width, frames: samples.length, loadingFrames: marks.length, documents, stableShell: true, stableLoading: true, history: true });
    await page.close();
  }
  await writeFile(path.join(output, 'browser-result.json'), JSON.stringify({ status: 'PASS', results }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', results }));
} catch (error) {
  const page = (await browser?.pages())?.at(-1);
  if (page) { await page.screenshot({ path: path.join(output, 'failure.png') }); await writeFile(path.join(output, 'failure-text.txt'), await page.evaluate(() => document.body.innerText)); }
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await native.close();
}
