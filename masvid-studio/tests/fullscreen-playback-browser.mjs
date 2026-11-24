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
const data = await mkdtemp(path.join(tmpdir(), 'openmotion-fullscreen-')), client = new Client(data);
const results = [], errors = [];
let browser, page;
const check = name => { results.push(name); console.log('PASS', name); };
const click = async (selector, text) => {
  const node = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(el => el.getBoundingClientRect().width && (!text || el.textContent.trim() === text) && !el.disabled), {}, selector, text);
  await node.asElement().evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, {}, node);
  await node.asElement().click(); await node.dispose();
};
const capture = async name => {
  await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime < 1000).map(a => a.finished)); });
  await page.screenshot({ path: path.join(out, name + '.png') });
};
const seek = async time => {
  await page.$eval('input[aria-label="Seek preview"]', (input, time) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(time));
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, time);
};
const clock = () => page.$eval('input[aria-label="Seek preview"]', input => input.valueAsNumber);
try {
  await client.initialize();
  const { projectId } = await client.call('openmotion_create_project', { projectType: 'natural_language', title: 'Fullscreen playback verification', requirements: 'Local deterministic playback fixture.', requestId: 'create' });
  const current = await client.call('openmotion_get_project', { projectId });
  await client.call('openmotion_edit_project', { projectId, requestId: 'fixture', expectedRevision: current.revision, expectedVersionId: current.currentVersionId, files: [
    { path: 'assets/gsap.min.js', content: await readFile(path.join(pluginRoot, 'node_modules/gsap/dist/gsap.min.js'), 'utf8') },
    { path: 'index.html', content: '<!doctype html><html><head><script src="assets/gsap.min.js"></script><style>body{margin:0}#main{position:relative;width:1280px;height:720px;background:#153746;color:white;font:56px sans-serif}h1{position:absolute;left:100px;top:190px;margin:0}#dot{position:absolute;top:400px;left:100px;width:80px;height:80px;background:#c5eddf;border-radius:50%}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="20" data-width="1280" data-height="720"><h1 id="title" data-start="0" data-duration="20" data-track-index="0">Fullscreen playback</h1><div id="dot" data-start="0" data-duration="20" data-track-index="1"></div></div><script>window.__timelines={main:gsap.timeline({paused:true}).to("#dot",{x:700,duration:20,ease:"none"})};</script></body></html>' },
  ] });
  const preview = await client.call('openmotion_open_preview', { projectId });
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
  await page.setViewport({ width: 1440, height: 900 }); await page.goto(preview.previewUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const el = document.querySelector('button[aria-label="Enter fullscreen"]'), r = el?.getBoundingClientRect(); return r?.width && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
  await click('[data-clip]');
  await click('[data-testid=preview-zoom-menu]'); await click('[role=menuitemradio]', '200%');
  await page.waitForFunction(() => document.querySelector('[data-testid=preview-zoom-stage]')?.style.transform.includes('scale(2)'));
  const before = await client.call('openmotion_get_project', { projectId });
  const selected = await page.$$eval('[data-clip][aria-pressed=true]', nodes => nodes.map(el => el.getAttribute('data-el-id')));
  let frame;
  for (const candidate of page.frames()) if (await candidate.evaluate(() => Boolean(document.querySelector('#dot'))).catch(() => false)) frame = candidate;
  assert(frame); await frame.evaluate(() => { window.__fullscreenTest = 'same live player'; });
  for (const [theme, width] of [['light', 1440], ['dark', 1440], ['dark', 390]]) {
    await page.setViewport({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme === 'light' ? 'paper' : 'dark', theme);
    await seek(2); await click('button[aria-label="Enter fullscreen"]');
    await page.waitForFunction(() => document.fullscreenElement?.hasAttribute('data-studio-fullscreen-target'));
    await page.waitForFunction(() => document.querySelector('[data-testid=preview-zoom-stage]')?.style.transform.includes('scale(1)'));
    const layout = await page.evaluate(() => {
      const fs = document.fullscreenElement, rect = fs.getBoundingClientRect(), stage = fs.querySelector('[data-testid=preview-zoom-stage]').getBoundingClientRect();
      return { width: rect.width, height: rect.height, viewport: [innerWidth, innerHeight], stage: [stage.x, stage.y, stage.width, stage.height], hasEditor: Boolean(fs.querySelector('[data-studio-timeline], [data-testid=preview-zoom-menu]')) };
    });
    assert.deepEqual([layout.width, layout.height], layout.viewport); assert.equal(layout.hasEditor, false);
    assert(Math.abs(layout.stage[2] / layout.stage[3] - 16 / 9) < 0.01); assert(layout.stage[0] >= -1 && layout.stage[1] >= -1);
    assert.equal(await frame.evaluate(() => window.__fullscreenTest), 'same live player');
    assert(await page.$eval('[data-fullscreen-playback-surface]', el => document.activeElement === el));
    const entryTime = await clock();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(time => Number(document.querySelector('input[aria-label="Seek preview"]').value) > time, {}, entryTime);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(time => Math.abs(Number(document.querySelector('input[aria-label="Seek preview"]').value) - time) < .01, {}, entryTime);
    await page.keyboard.press('m');
    assert.equal(await page.$eval('[data-studio-control=mute]', el => el.getAttribute('aria-pressed')), 'true');
    await page.keyboard.press('m');
    const loopBefore = await page.$eval('button[aria-label$="loop playback"]', el => el.getAttribute('aria-pressed'));
    await page.keyboard.down('Shift'); await page.keyboard.press('l'); await page.keyboard.up('Shift');
    assert.notEqual(await page.$eval('button[aria-label$="loop playback"]', el => el.getAttribute('aria-pressed')), loopBefore);
    await page.keyboard.down('Shift'); await page.keyboard.press('l'); await page.keyboard.up('Shift');
    await page.keyboard.press('l');
    await page.waitForFunction(time => Number(document.querySelector('input[aria-label="Seek preview"]').value) > time + .1, {}, entryTime);
    await page.keyboard.press('k'); const shuttleTime = await clock();
    await page.keyboard.press('j');
    await page.waitForFunction(time => Number(document.querySelector('input[aria-label="Seek preview"]').value) < time - .1, {}, shuttleTime);
    await page.keyboard.press('k');
    const mute = await page.$('[data-studio-control=mute]');
    await mute.hover();
    const volume = await page.waitForSelector('input[aria-label="Preview volume"]', { visible: true });
    assert(await volume.evaluate(el => document.fullscreenElement.contains(el)));
    await volume.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('input[aria-label="Preview volume"]')?.value === '1');
    await page.keyboard.press('End');
    await click('[data-studio-control=mute]');
    assert.equal(await mute.evaluate(el => el.getAttribute('aria-pressed')), 'true');
    await click('[data-studio-control=mute]');
    assert.equal(await mute.evaluate(el => el.getAttribute('aria-pressed')), 'false');
    await page.focus('[data-fullscreen-playback-surface]'); await page.mouse.move(15, 15);
    await page.waitForSelector('input[aria-label="Preview volume"]', { hidden: true });
    await click('button[aria-label="Playback speed"]');
    await page.waitForSelector('[role=menuitemradio]');
    assert(await page.$eval('[role=menu]', el => document.fullscreenElement.contains(el)));
    await capture(`fullscreen-${theme}-${width}-menu`);
    await click('[role=menuitemradio]', '1.5x');
    await click('[data-studio-control=playback]'); await page.mouse.move(15, 15);
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Seek preview"]')?.value) > 3);
    await page.waitForSelector('[data-studio-fullscreen-target][data-controls-hidden]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-preview-transport]')).opacity === '0');
    await capture(`fullscreen-${theme}-${width}-playing`);
    await page.mouse.move(200, 200); await page.waitForFunction(() => !document.fullscreenElement.hasAttribute('data-controls-hidden'));
    await click('[data-studio-control=playback]'); await seek(7);
    const paused = await clock(); assert(Math.abs(paused - 7) < 0.1);
    await click('button[aria-label="Exit fullscreen"]'); await page.waitForFunction(() => !document.fullscreenElement);
    assert(Math.abs(await clock() - paused) < 0.1);
    assert(await page.$eval('[data-testid=preview-zoom-stage]', el => el.style.transform.includes('scale(2)')));
    assert.deepEqual(await page.$$eval('[data-clip][aria-pressed=true]', nodes => nodes.map(el => el.getAttribute('data-el-id'))), selected);
    check(`Native fullscreen, playback shortcuts, menus, idle controls and restoration: ${theme} ${width}px`);
  }
  await page.focus('[aria-label="Composition preview"]'); await page.keyboard.press('f');
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.keyboard.press('f'); await page.waitForFunction(() => !document.fullscreenElement);
  check('F enters and exits the same fullscreen player');
  await page.keyboard.press('f'); await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.fullscreenElement);
  check('Escape returns to editing');
  // Permissions-policy rejection must keep the editor usable and report shared floating feedback.
  await page.evaluate(() => { document.querySelector('[data-studio-fullscreen-target]').requestFullscreen = () => Promise.reject(new Error('Blocked by host')); });
  await click('button[aria-label="Enter fullscreen"]');
  await page.waitForFunction(() => document.body.textContent.includes('Fullscreen is unavailable in this window.'));
  await page.screenshot({ path: path.join(out, 'fullscreen-unavailable-toast.png') });
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
  const after = await client.call('openmotion_get_project', { projectId }); assert.equal(after.revision, before.revision);
  check('Rejected permission shows a Toast; playback never edits project source');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  await writeFile(path.join(out, 'failure.txt'), String(error.stack)); throw error;
} finally { await browser?.close(); await client.close(); await closeFixtureEditor(data); await rm(data, { recursive: true, force: true, maxRetries: 5 }); }
