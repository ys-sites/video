import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { WorkspaceStore } from '../workspace.ts';
import { handler } from '../server.ts';
import { pluginRoot } from '../hyperframes.ts';
import { gatewayFor } from '../gateway/service.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { mediaUse } from '../gateway/media-use.ts';

const output = process.argv[2];
assert(output && path.isAbsolute(output), 'Pass an absolute evidence directory');
assert(process.env.CI || process.env.D4_LANE && process.env.PLAYWRIGHT_WEB_PORT, 'Run with browser-lock.sh locally');
await mkdir(output, { recursive: true });
const data = await mkdtemp(path.join(tmpdir(), 'motion-save-browser-'));
const store = new WorkspaceStore(data), errors = [], results = [];
const gateway = gatewayFor(store);
const context = { nativeRoot: pluginRoot, runtimeRoot: pluginRoot };
const server = createServer((req, res) => void handler(req, res, store, context));
let browser, submissions = 0;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
try {
  await store.initialize(pluginRoot);
  gateway.options.detect = async () => [];
  gateway.options.download = async () => png;
  gateway.options.pollMs = 1;
  gateway.options.fetcher = async (_url, init = {}) => {
    if (init.method === 'POST') { submissions++; return Response.json({ request_id: 'remote', status_url: 'https://queue.fal.run/request/status', response_url: 'https://queue.fal.run/request/result' }); }
    return Response.json({ status: 'COMPLETED', images: [{ url: 'https://cdn.example/image.png' }] });
  };
  await gateway.configureProvider('fal', { apiKey: 'synthetic-private-key' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.PLAYWRIGHT_WEB_PORT || 0), '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: path.join(data, 'browser') });
  const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  for (const [theme, width] of [['dark', 1440], ['light', 1440], ['light', 390]]) {
    const title = `Save recovery ${theme} ${width}`;
    const { job: queued } = await mediaUse(store, { action: 'generate', projectId: store.projectId, provider: 'fal', model: 'vendor/image', modality: 'image', prompt: title, requestId: `browser-${theme}-${width}` });
    const target = path.join(store.projectDirectory, `assets/generated/${queued.id}-1.png`);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, 'Existing project content');
    await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
    assert.equal((await gateway.getJob(queued.id)).phase, 'save_failed');
    await page.setViewport({ width, height: 1000 });
    await page.evaluateOnNewDocument(theme => {
      localStorage.setItem('motion.studio.locale', 'en');
      localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme }));
    }, theme);
    await page.goto(`${origin}/assets`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button[aria-label="View tasks"]'); await page.click('button[aria-label="View tasks"]');
    await page.waitForFunction(title => [...document.querySelectorAll('.om-task-item')].some(node => node.textContent.includes(title)), {}, title);
    await page.evaluate(title => [...document.querySelectorAll('.om-task-item')].find(node => node.textContent.includes(title)).click(), title);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Retry saving'));
    const retry = await page.waitForFunction(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Retry saving'));
    await retry.evaluate(node => node.scrollIntoView({ block: 'center' }));
    const reachable = await retry.evaluate(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.x >= 0 && r.right <= innerWidth && node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    assert(reachable, 'Recovery button must be visible and reachable');
    assert(await page.evaluate(() => document.body.textContent.includes('Generated files are kept locally. Retry saving without generating again.')));
    if (theme === 'dark') await page.screenshot({ path: path.join(output, 'save-failure-dark.png') });
    await rm(target);
    const response = page.waitForResponse(response => response.url().endsWith('/motion-api/phase1/call') && response.request().postData()?.includes('retry_save'));
    await retry.evaluate(node => node.click());
    assert.equal((await response).status(), 200);
    await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
    await page.waitForFunction(() => document.querySelector('.om-creation-job[data-state="completed"]'));
    assert.equal((await gateway.getJob(queued.id)).state, 'completed');
    const asset = (await new AssetLibrary(store).list({ query: title })).assets[0];
    assert.equal(asset.versions.length, 1); assert.deepEqual(await readFile(target), png);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (theme === 'light') await page.screenshot({ path: path.join(output, `saved-light-${width}.png`) });
    results.push({ theme, width, jobId: queued.id, recovered: true, assetVersions: 1 });
  }
  const { job: unavailable } = await mediaUse(store, { action: 'generate', projectId: store.projectId, provider: 'fal', model: 'vendor/image', modality: 'image', prompt: 'Unavailable retained files', requestId: 'browser-unavailable' });
  const target = path.join(store.projectDirectory, `assets/generated/${unavailable.id}-1.png`);
  await writeFile(target, 'Project conflict');
  await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
  await page.goto(`${origin}/assets`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="View tasks"]'); await page.click('button[aria-label="View tasks"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.om-task-item')].some(node => node.textContent.includes('Unavailable retained files')));
  await page.evaluate(() => [...document.querySelectorAll('.om-task-item')].find(node => node.textContent.includes('Unavailable retained files')).click());
  const retry = await page.waitForFunction(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Retry saving'));
  await rm(path.join(gateway.root, 'work', unavailable.id, 'outputs.json'));
  const rejected = page.waitForResponse(response => response.url().endsWith('/motion-api/phase1/call') && response.request().postData()?.includes('retry_save'));
  await retry.evaluate(node => node.click()); assert.equal((await rejected).ok(), false);
  await page.waitForFunction(() => document.querySelector('.om-creation-job-error') && ![...document.querySelectorAll('.om-creation-job button')].some(node => node.textContent.includes('Retry saving')));
  await page.click('.om-creation-job-error summary');
  await page.waitForFunction(() => document.querySelector('.om-creation-job-error').textContent.includes('Saving cannot be retried'));
  assert.equal((await gateway.getJob(unavailable.id)).savePending, false);
  assert.deepEqual(await readFile(path.join(gateway.root, 'work', unavailable.id, `${unavailable.id}-1.png`)), png);
  await page.screenshot({ path: path.join(output, 'save-unavailable-light-390.png') });
  results.push({ unrecoverable: true, savePending: false, retainedBytesPreserved: true });
  assert.equal(submissions, 4); assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', lane: process.env.D4_LANE, checks: results, submissions, paidCalls: false, errors }, null, 2));
  console.log('Workspace asset save recovery passed in both themes and at 390px; no paid model calls.');
} catch (error) {
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'failed', error: String(error), errors }, null, 2));
  throw error;
} finally {
  await browser?.close(); await gateway.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(data, { recursive: true, force: true });
}
