import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { WorkspaceStore } from '../workspace.ts';
import { pluginRoot, execute } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { startServer } from '../server.ts';
import { configureNativeEnvironment } from '../scripts/npm-runtime.mjs';
import { transcriptsFor } from '../gateway/transcription.ts';
import { gatewayFor } from '../gateway/service.ts';

const output = process.argv[2]; assert(output && path.isAbsolute(output), 'Pass an absolute evidence directory'); await mkdir(output, { recursive: true });
await configureNativeEnvironment(pluginRoot);
const lock = path.join(tmpdir(), 'openmotion-transcript-browser.lock'); await mkdir(lock);
const data = await mkdtemp(path.join(tmpdir(), 'motion-transcript-browser-'));
const basicOnly = process.argv.includes('--basic-only');
const uiOnly = process.argv.includes('--ui-only') || basicOnly;
const store = new WorkspaceStore(data), errors = [], exports = [];
let releaseRecognition; const recognitionGate = new Promise(resolve => { releaseRecognition = resolve; }); let running, browser, page, paidCalls = 0;
try {
  await store.initialize(pluginRoot);
  const source = path.join(data, 'speech.wav'), video = path.join(data, 'video.mp4');
  const { ffmpeg } = verificationBinaries();
  assert.equal((await execute(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-y', source], data, 30000)).code, 0);
  assert.equal((await execute(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24', '-i', source, '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', video], data, 30000)).code, 0);
  gatewayFor(store).options.detect = async () => [];
  const asr = transcriptsFor(store, { fetcher: async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/audio/transcriptions'); const form = await new Request(url, init).formData(); assert.equal(form.get('model'), 'fixture-asr'); paidCalls++;
    if (paidCalls === 1) await recognitionGate;
    return Response.json({ segments: [{ text: 'Hello world.', start: 0.1, end: 0.8 }], words: [{ word: 'Hello', start: 0.1, end: 0.4 }, { word: 'world.', start: 0.4, end: 0.8 }] });
  } });
  await asr.connections.configure('openai', { apiKey: 'synthetic-browser-key', enabled: true });
  await asr.connections.saveModel('openai', { modelId: 'fixture-asr', label: 'Fixture transcription', kind: 'transcription' }); await asr.connections.setDefault('transcription', 'openai:fixture-asr');
  running = await startServer(store, 0, { editor: true });
  const origin = (await running.info()).previewUrl;
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: path.join(data, 'browser'), args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${source}`] });
  await browser.defaultBrowserContext().overridePermissions(new URL(origin).origin, ['microphone']);
  page = await browser.newPage();
  const capture = async options => {
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.race([Promise.all(document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))), new Promise(resolve => setTimeout(resolve, 500))]);
    });
    await page.screenshot(options);
  }; page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => { if (response.url().includes('/upload') || response.status() >= 400 && response.url().includes('/motion-api/')) console.log('HTTP', response.status(), response.url(), (await response.text().catch(() => '')).slice(0,1200)); });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('motion.studio.locale', 'en');
    // Deterministic input stream; real MediaRecorder, Blob, upload and FFmpeg remain exercised.
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(), tone = context.createOscillator(), destination = context.createMediaStreamDestination();
      tone.frequency.value = 440; tone.connect(destination); tone.start(); await context.resume();
      for (const track of destination.stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { stop(); if (context.state !== 'closed') { tone.disconnect(); void context.close(); } }; }
      return destination.stream;
    };
  });
  if (basicOnly) releaseRecognition();
  let failSources = uiOnly && !basicOnly;
  await page.setRequestInterception(true);
  page.on('request', request => {
    const input = request.postData();
    if (failSources && request.url().endsWith('/phase1/call') && input) {
      const command = JSON.parse(input);
      if (command.arguments?.transcript?.command === 'sources') return void request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture service unavailable' }) });
    }
    void request.continue();
  });
  await page.goto(`${origin}/#project/${store.projectId}`, { waitUntil: 'domcontentloaded' });
  const click = async (selector, text) => {
    await page.bringToFront();
    console.log('Click:', text);
    if (['Edit text', 'Done editing', 'Caption styles', 'Import SRT / VTT', 'Show pauses'].includes(text)) {
      const overflow = await page.$('section[aria-label="Transcript"] button[aria-label="More transcript tools"]');
      if (overflow && await overflow.evaluate(n => n.getBoundingClientRect().width > 0)) {
        await click('button', 'More transcript tools'); selector = '[role=menuitem]';
      }
    }
    const handle = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden' && (node.getAttribute('aria-label') === text || node.textContent.trim() === text) && !node.disabled), { timeout: 30000, polling: 100 }, selector, text);
    await handle.asElement().evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    // Dock resize and floating-position transitions must settle before real pointer input.
    await handle.asElement().evaluate(async node => {
      let previous = '', stable = 0;
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(requestAnimationFrame);
        const r = node.getBoundingClientRect(), box = [r.x, r.y, r.width, r.height].join(',');
        stable = box === previous && !node.disabled && node.getAttribute('aria-disabled') !== 'true' ? stable + 1 : 0; previous = box;
        if (stable >= 4) return;
      }
      throw new Error('Control did not settle before clicking');
    });
    const point = await page.waitForFunction(node => {
      if (node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
      const r = node.getBoundingClientRect(), y = r.y + r.height / 2;
      const center = r.x + r.width / 2;
      if (node.contains(document.elementFromPoint(center, y))) return { x: center, y };
      for (let x = Math.max(1, r.x + 2); x < Math.min(innerWidth, r.right); x += 5) if (node.contains(document.elementFromPoint(x, y))) return { x, y };
      return false;
    }, { polling: 100, timeout: 10000 }, handle);
    const { x, y } = await point.jsonValue(); await page.mouse.click(x, y); await handle.dispose(); await point.dispose();
  };
  await page.waitForSelector('button[aria-label="Expand left panel"]');
  await page.$eval('button[aria-label="Expand left panel"]', node => node.click());
  console.log('Expand action sent');
  await page.waitForSelector('button[aria-label="Collapse left panel"]');
  const columnGeometry = () => page.evaluate(async () => {
    const measure = () => ['left', 'center', 'right'].map(zone => {
      const group = document.querySelector(`.hf-dock-tab[data-panel-zone="${zone}"]`).closest('.dv-groupview');
      const { x, width } = group.getBoundingClientRect(); return { x, width };
    });
    let previous = '', stable = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(requestAnimationFrame);
      const next = measure(), serialized = JSON.stringify(next);
      stable = previous === serialized ? stable + 1 : 0; previous = serialized;
      if (stable >= 4) return next;
    }
    throw new Error('Dock column geometry did not settle');
  });
  const resizeLeft = async width => {
    const [left] = await columnGeometry();
    const sash = await page.evaluate(edge => [...document.querySelectorAll('.dv-sash[aria-orientation="vertical"]')].map(n => n.getBoundingClientRect()).find(r => r.height > 0 && Math.abs(r.x + r.width / 2 - edge) < 8)?.toJSON(), left.x + left.width);
    assert(sash, 'Left column divider is available');
    const x = sash.x + sash.width / 2, y = sash.y + sash.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + width - left.width, y, { steps: 12 }); await page.mouse.up();
    assert(Math.abs((await columnGeometry())[0].width - width) <= 1, 'The divider respects the requested width');
  };
  const tabWidths = [];
  const checkTabWidths = async context => {
    const before = await columnGeometry();
    for (const tab of ['Captions', 'Transcript', 'Captions', 'Transcript']) {
      await click('.hf-dock-tab-label', tab);
      assert.deepEqual(await columnGeometry(), before, `${context}: ${tab} must preserve all column positions and widths`);
    }
    tabWidths.push({ context, columns: before });
  };
  await checkTabWidths('First activation');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { if (theme === 'light') document.documentElement.dataset.theme = 'paper'; else delete document.documentElement.dataset.theme; }, theme);
    for (const width of [280, 420]) {
      await resizeLeft(width);
      await checkTabWidths(`${theme}, user width ${width}`);
      await capture({ path: path.join(output, `stable-transcript-${width}-${theme}.png`) });
    }
    await page.setViewport({ width: 860, height: 900 });
    await checkTabWidths(`${theme}, narrow window`);
    assert((await columnGeometry())[1].width >= 240, 'Narrow layouts preserve the preview minimum');
    await page.setViewport({ width: 1440, height: 1000 });
  }
  await writeFile(path.join(output, 'tab-widths.json'), JSON.stringify(tabWidths, null, 2));
  await click('.hf-dock-tab-label', 'Transcript');
  await page.waitForFunction(() => document.querySelector('section[aria-label="Transcript"]')?.getBoundingClientRect().width > 150);
  console.log('Transcript panel opened');
  const panel = 'section[aria-label="Transcript"]';
  const captionPanel = 'section[aria-label="Captions"]';
  if (uiOnly && !basicOnly) {
    await page.waitForFunction(() => document.querySelector('section[aria-label="Transcript"]')?.textContent.includes('Could not load transcripts'));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { if (theme === 'light') document.documentElement.dataset.theme = 'paper'; else delete document.documentElement.dataset.theme; }, theme);
      await capture({ path: path.join(output, `transcript-load-error-${theme}.png`) });
    }
    failSources = false; await click(`${panel} button`, 'Retry');
    await page.waitForFunction(() => !document.querySelector('section[aria-label="Transcript"]')?.textContent.includes('Could not load transcripts'));
  }
  await capture({ path: path.join(output, 'transcript-empty.png') });
  const upload = await page.$(`${panel} input[type=file][multiple]`); await upload.uploadFile(source, video);
  await page.waitForFunction(() => document.querySelector('section[aria-label="Transcript"] [aria-label="Source media"]')?.textContent.includes('speech.wav'));
  if (!basicOnly) {
  await click(`${panel} button`, 'Media actions');
  await click('[role=menuitem]', 'Add to timeline');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { if (theme === 'light') document.documentElement.dataset.theme = 'paper'; else delete document.documentElement.dataset.theme; }, theme);
    await capture({ path: path.join(output, `transcript-ready-${theme}.png`) });
    await click(`${panel} button`, 'Recognition settings');
    await page.waitForSelector('[aria-label="Spoken language"]');
    await capture({ path: path.join(output, `transcript-settings-${theme}.png`) });
    await page.keyboard.press('Escape');
    await click(`${panel} button`, 'Media actions');
    await page.waitForSelector('[role=menuitem]');
    await capture({ path: path.join(output, `transcript-source-menu-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
  console.log('Submitting transcription');
  await click(`${panel} button`, 'Transcribe');
  await page.waitForSelector('[aria-label="Transcription progress"]');
  await capture({ path: path.join(output, 'transcription-progress.png') });
  releaseRecognition();
  await page.waitForSelector('[data-testid="transcript-editor"]'); console.log('Transcript available'); await capture({ path: path.join(output, 'transcript-open.png') });
  await click(`${panel} button`, 'Edit text');
  await page.$eval('[aria-label="Segment text"]', node => { node.focus(); node.select(); }); await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control'); await page.keyboard.press('A'); await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control'); await page.keyboard.type('Reviewed speech.');
  await click(`${panel} button`, 'Save transcript');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].find(n => n.getAttribute('aria-label') === 'Save transcript')?.disabled);
  // Imports and timeline placement use the native project upload/edit paths.
  await click(`${panel} button`, 'Add captions to video');
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(node => node.textContent.includes('Editable captions added'))).catch(async () => {
    assert.match(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /openmotion-transcript:/);
  });
  // Styles preserve native edits and visibility changes are shared with export.
  await page.waitForFunction(() => document.querySelector('section[aria-label="Captions"]')?.getBoundingClientRect().width > 150);
  await click(`${captionPanel} button`, 'Paper card');
  await click(`${captionPanel} button`, 'Caption position'); await click('[role=option]', 'Top');
  await page.waitForFunction(() => document.querySelector('section[aria-label="Captions"] button[aria-label="Caption position"]')?.textContent.includes('Top'));
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(n => n.textContent.includes('Captions updated')));
  let styledSource = await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8');
  assert.match(styledSource, /data-caption-preset="card"/); assert.match(styledSource, /data-caption-position="top"/); assert.match(styledSource, /Reviewed speech/);
  for (const label of ['Record voiceover', 'Open transcript']) {
    const icon = await page.$(`button[aria-label="${label}"]`);
    assert.equal(await icon.evaluate(n => n.textContent.trim()), '');
    assert(await icon.evaluate(n => n.getBoundingClientRect().width <= 36));
  }
  const captionControl = await page.$('button[aria-label="Caption visibility"]');
  assert.equal(await captionControl.evaluate(n => n.textContent.trim()), 'On');
  assert(await captionControl.evaluate(n => {
    const rect = n.getBoundingClientRect(), label = n.querySelector('span').getBoundingClientRect();
    return rect.width > 36 && n.scrollWidth <= n.clientWidth && label.left >= rect.left && label.right <= rect.right;
  }), 'The CC label fits in the status control');
  await click('button', 'Caption visibility');
  await (await page.waitForSelector('button[aria-label^="Hide C1 ·"]')).click();
  await page.waitForSelector('button[aria-label^="Show C1 ·"]');
  assert.equal(await captionControl.evaluate(n => n.textContent.trim()), 'Off');
  assert.match(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /data-hidden/);
  await (await page.waitForSelector('button[aria-label^="Show C1 ·"]')).click();
  await page.waitForSelector('button[aria-label^="Hide C1 ·"]');
  assert.equal(await captionControl.evaluate(n => n.textContent.trim()), 'On');
  await page.keyboard.press('Escape');
  assert.doesNotMatch(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /data-hidden/);
  await page.waitForFunction(() => [...document.querySelectorAll('.motion-track-badge')].some(n => n.textContent === 'C1'));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { if (theme === 'light') document.documentElement.dataset.theme = 'paper'; else delete document.documentElement.dataset.theme; }, theme);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme === 'paper' ? 'light' : 'dark'), theme);
    await click('.hf-dock-tab-label', 'Captions');
    await page.$eval(`${captionPanel} [data-testid="caption-controls"]`, node => node.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction(() => [...document.querySelectorAll('section[aria-label="Captions"] button')].some(n => n.getAttribute('aria-label') === 'Paper card' && !n.disabled));
    await page.waitForFunction(() => ![...document.querySelectorAll('[role=status]')].some(n => n.textContent.includes('Captions updated') || n.textContent.includes('Editable captions added') || n.textContent.includes('Transcript saved')));
    await capture({ path: path.join(output, `captions-${theme}.png`) });
    await click(`${captionPanel} button`, 'Caption track');
    await page.waitForSelector('[role=option]');
    await capture({ path: path.join(output, `caption-tracks-${theme}.png`) });
    await page.keyboard.press('Escape');
    await click('button', 'Caption visibility');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(n => n.textContent.includes('C1 ·') && n.getBoundingClientRect().width > 0));
    await capture({ path: path.join(output, `cc-menu-${theme}.png`) });
    await page.keyboard.press('Escape');
    await click('.hf-dock-tab-label', 'Transcript');
    await page.$eval(panel, node => node.scrollTo({ top: 0, behavior: 'instant' }));
    await capture({ path: path.join(output, `transcript-${theme}.png`) });
    const compactTools = await page.$(`${panel} button[aria-label="More transcript tools"]`);
    if (compactTools && await compactTools.evaluate(n => n.getBoundingClientRect().width > 0)) {
      await click(`${panel} button`, 'More transcript tools');
      await page.waitForSelector('[role=menuitem]');
      await capture({ path: path.join(output, `transcript-tools-${theme}.png`) });
      await page.keyboard.press('Escape');
    }
    await click(`${panel} button`, 'More transcript actions');
    await page.waitForFunction(() => {
      const menu = document.querySelector('[role=menu][aria-label="Transcript actions"]');
      return menu && getComputedStyle(menu).opacity === '1';
    });
    await capture({ path: path.join(output, `caption-menu-${theme}.png`) });
    await page.keyboard.press('Escape');
    await click('button', 'Record voiceover');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(n => n.textContent === 'Start recording' && n.getBoundingClientRect().width > 0));
    await capture({ path: path.join(output, `recording-popover-${theme}.png`) });
    await page.keyboard.press('Escape');
    await click(`${panel} button`, 'Translate or create versions');
    await page.waitForSelector('[data-testid="transcript-workflow"]');
    await capture({ path: path.join(output, `workflow-${theme}.png`) });
    await click(`${panel} button`, 'Translate or create versions');
  }
  await page.setViewport({ width: 860, height: 900 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await capture({ path: path.join(output, 'transcript-narrow.png') });
  await page.setViewport({ width: 1440, height: 1000 });
  await click(`${panel} button`, 'Media actions');
  await click('[role=menuitem]', 'New transcript');
  await page.setViewport({ width: 508, height: 852 });
  await click('button', 'Open transcript');
  await page.waitForFunction(() => document.querySelector('[aria-label="Transcript source"]')?.getBoundingClientRect().width > 0);
  await capture({ path: path.join(output, 'transcript-setup-narrow.png') });
  await click('button', 'Caption visibility'); await click('button', 'C1 · speech.wav');
  assert(await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="caption-visibility-bar"]');
    const label = bar.querySelector('label').getBoundingClientRect(), actions = bar.querySelector('div').getBoundingClientRect();
    return label.bottom <= actions.top + 1;
  }), 'Narrow caption visibility controls must not overlap');
  await capture({ path: path.join(output, 'captions-narrow.png') });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.setViewport({ width: 1440, height: 1000 });
  await click('button', 'Record voiceover'); await click('button', 'Start recording');
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(n => n.textContent === '00:01'));
  await capture({ path: path.join(output, 'recording-active.png') });
  await click('button', 'Stop recording'); await click('button', 'Add and transcribe');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Record voiceover"]')?.getAttribute('aria-expanded') === 'false');
  await page.waitForFunction(() => document.querySelector('[data-testid="transcript-editor"]')?.getBoundingClientRect().width > 0);
  assert.equal(paidCalls, 2);
  // Create word-highlight captions from the unedited recording document.
  await click(`${panel} button`, 'Caption styles');
  await click(`${captionPanel} button`, 'Word highlight');
  await click(`${captionPanel} button`, 'Add captions to video');
  await page.waitForFunction(() => [...document.querySelectorAll('.motion-track-badge')].some(n => n.textContent === 'C2'));
  await page.waitForFunction(() => document.querySelector('section[aria-label="Captions"] button[aria-label="Caption track"]')?.textContent.includes('recording-'));
  assert.match(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /data-caption-pacing="word"/);
  await capture({ path: path.join(output, 'captions-word-highlight.png') });
  // Pacing stages a reversible draft; native cues change only on explicit recreation.
  await click(`${captionPanel} button`, 'By sentence');
  assert.match(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /data-caption-pacing="word"/);
  await click(`${captionPanel} button`, 'Cancel');
  await click(`${captionPanel} button`, 'By sentence');
  await click(`${captionPanel} button`, 'Recreate captions');
  await page.waitForFunction(() => { const checkbox = document.querySelector('[data-testid="caption-visibility-bar"] [role="checkbox"]'); return checkbox && !checkbox.disabled; });
  assert.doesNotMatch(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /data-caption-pacing="word"/);
  await click(`${captionPanel} button`, 'Word highlight');
  await click(`${captionPanel} button`, 'Recreate captions');
  await page.waitForFunction(() => { const checkbox = document.querySelector('[data-testid="caption-visibility-bar"] [role="checkbox"]'); return checkbox && !checkbox.disabled; });
  assert.match(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /data-caption-pacing="word"/);

  // Public MCP-equivalent calls exercise language/version handoff and actual rendering.
  const call = async (name, args) => { const response = await fetch(`${origin}/motion-api/phase1/call`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin }, body: JSON.stringify({ name, arguments: args }) }); const body = await response.json(); assert(response.ok, body.error); return body; };
  const list = await call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'list', projectId: store.projectId } });
  const original = (await call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'get', projectId: store.projectId, transcriptId: list.documents.find(doc => doc.source.path.endsWith('speech.wav')).id } })).document;
  for (const [language, width, height, text] of (uiOnly ? [] : [['en', 320, 180, 'Reviewed speech.'], ['fr', 180, 320, 'Texte relu.']])) {
    const detail = await call('openmotion_get_project', { projectId: store.projectId });
    const copy = await call('openmotion_manage_project', { action: 'duplicate', projectId: store.projectId, expectedRevision: detail.revision, requestId: `copy-${language}`, title: `Fixture ${language}` });
    const pid = copy.projectId ?? copy.project?.id; assert(pid, JSON.stringify(copy));
    let current = await call('openmotion_get_project', { projectId: pid });
    const html = `<!doctype html><html><head><script src="assets/gsap.min.js"></script></head><body style="margin:0"><div id="main" data-composition-id="main" data-width="${width}" data-height="${height}" data-duration="1" style="position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#164577"><audio class="clip" id="voice" src="${original.source.path}" data-start="0" data-duration="1" data-track-index="0"></audio></div><script>window.__timelines={main:gsap.timeline({paused:true}).to({}, {duration:1})};</script></body></html>`;
    await call('openmotion_edit_project', { projectId: pid, requestId: `edit-${language}`, expectedRevision: current.revision, expectedVersionId: current.currentVersionId, files: [{ path: 'index.html', content: html }] });
    const translated = (await call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'import', projectId: pid, sourcePath: original.source.path, language, requestId: `language-${language}`, segments: original.segments.map(s => ({ id: s.id, text, start: s.start, end: s.end, ...(language === 'fr' ? { words: [{ text: 'Texte', start: 0.1, end: 0.4 }, { text: 'relu.', start: 0.4, end: 0.8 }] } : {}) })) } })).document;
    current = await call('openmotion_get_project', { projectId: pid });
    await call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'captions', projectId: pid, transcriptId: translated.id, expectedTranscriptRevision: 1, requestId: `caption-${language}`, captionSettings: { preset: 'bar', pacing: language === 'fr' ? 'word' : 'sentence' }, compositionPath: 'index.html', timelineStart: 0, sourceStart: 0, sourceEnd: 1, playbackRate: 1, expectedRevision: current.revision, expectedVersionId: current.currentVersionId } });
    const subtitles = await call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'export', projectId: pid, transcriptId: translated.id, format: 'srt', sourceStart: 0, sourceEnd: 1, timelineStart: 0, playbackRate: 1 } });
    assert.match(subtitles.content, /00:00:00,100 --> 00:00:00,800/); await writeFile(path.join(output, `${language}.srt`), subtitles.content);
    current = await call('openmotion_get_project', { projectId: pid });
    const submitted = await call('openmotion_export_request', { projectId: pid, versionId: current.currentVersionId, expectedRevision: current.revision, requestId: `export-${language}`, audio: 'required' });
    let final;
    for (let i = 0; i < 240; i++) { final = await call('openmotion_get_project', { projectId: pid, exportJobId: submitted.job.id }); const job = final.exportJob ?? final.job; if (['completed', 'failed', 'cancelled'].includes(job?.status ?? job?.state)) break; await new Promise(resolve => setTimeout(resolve, 250)); }
    const job = final.exportJob ?? final.job;
    assert.equal(job?.state, 'completed', JSON.stringify(job)); assert.equal(job.verification?.status, 'passed', JSON.stringify(job.verification));
    const bytes = Buffer.from(await (await fetch(job.downloadUrl)).arrayBuffer());
    assert.deepEqual(bytes, await readFile(job.path)); await copyFile(job.path, path.join(output, `${language}.mp4`));
    for (const [frame, time] of [['before', '0'], ['caption', '0.4'], ['after', '0.9']]) {
      assert.equal((await execute(ffmpeg, ['-v', 'error', '-ss', time, '-i', job.path, '-frames:v', '1', '-y', path.join(output, `${language}-${frame}.png`)], data, 30000)).code, 0);
    }
    assert.notDeepEqual(await readFile(path.join(output, `${language}-before.png`)), await readFile(path.join(output, `${language}-caption.png`)), 'Timed captions must change rendered pixels');
    const playback = await browser.newPage(); await playback.setContent('<video controls id="result"></video>'); await playback.bringToFront();
    const media = await playback.evaluate(async base64 => {
      const video = document.querySelector('video');
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
      const context = new AudioContext(), analyser = context.createAnalyser(); context.createMediaElementSource(video).connect(analyser); analyser.connect(context.destination); await context.resume(); await video.play();
      await new Promise((resolve, reject) => { const deadline = performance.now() + 10000; const timer = setInterval(() => { if (video.currentTime > 0.3) { clearInterval(timer); resolve(); } else if (performance.now() > deadline) { clearInterval(timer); reject(new Error('Playback stalled')); } }, 30); });
      const samples = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(samples); const energy = Math.max(...samples);
      video.pause(); const sought = new Promise(resolve => video.addEventListener('seeked', resolve, { once: true })); video.currentTime = 0.5; await sought;
      const seek = video.currentTime, frames = video.getVideoPlaybackQuality().totalVideoFrames;
      video.currentTime = 0; await video.play(); await new Promise(resolve => video.addEventListener('ended', resolve, { once: true }));
      await context.close(); return { width: video.videoWidth, height: video.videoHeight, frames, energy, seek, ended: video.ended, error: video.error };
    }, bytes.toString('base64'));
    assert(media.frames > 0 && media.energy > 0 && media.ended && !media.error && Math.abs(media.seek - 0.5) < 0.05, JSON.stringify(media));
    assert.equal(media.width, width); assert.equal(media.height, height);
    await playback.screenshot({ path: path.join(output, `${language}-playback.png`) }); await playback.close();
    exports.push({ projectId: pid, language, jobId: job.id, verification: job.verification, media });
  }
  // A long imported transcript verifies the reading layout independently of ASR.
  await page.bringToFront();
  await click('button', 'Open transcript');
  const longSrt = path.join(data, 'layout.srt');
  await writeFile(longSrt, Array.from({ length: 25 }, (_, i) => `${i + 1}\n00:00:00,${String(i * 30).padStart(3, '0')} --> 00:00:00,${String(i * 30 + 20).padStart(3, '0')}\nSentence ${i + 1}. Review speech in context, with the words and timing visible in one place.\n`).join('\n'));
  const chooser = page.waitForFileChooser();
  await click(`${panel} button`, 'Import SRT / VTT');
  await (await chooser).accept([longSrt]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="transcript-editor"] article').length === 25);
  const reading = `${panel} [data-testid="transcript-reading-area"]`;
  const toolbarY = await page.$eval(`${panel} [data-testid="transcript-toolbar"]`, n => n.getBoundingClientRect().top);
  await page.$eval(reading, n => n.scrollTop = n.scrollHeight);
  assert.equal(await page.$eval(`${panel} [data-testid="transcript-toolbar"]`, n => n.getBoundingClientRect().top), toolbarY);
  assert(await page.$eval(reading, n => n.scrollTop > 0 && n.scrollHeight > n.clientHeight));
  await capture({ path: path.join(output, 'transcript-scrolled.png') });
  await page.$eval(reading, n => n.scrollTop = 0);
  await page.setViewport({ width: 1920, height: 1080 });
  await resizeLeft(560);
  await page.waitForFunction(() => document.querySelector('section[aria-label="Transcript"]').getBoundingClientRect().width >= 520);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { if (theme === 'light') document.documentElement.dataset.theme = 'paper'; else delete document.documentElement.dataset.theme; }, theme);
    await capture({ path: path.join(output, `transcript-reading-wide-${theme}.png`) });
    assert(await page.$eval('section[aria-label="Transcript"]', n => n.getBoundingClientRect().width >= 520), 'Reading width survives theme changes');
    await click(`${panel} button`, 'Transcript view');
    await page.waitForSelector('[role=option]');
    await capture({ path: path.join(output, `transcript-view-menu-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
  }
  // Basic editing: real pointer gestures and persisted native text, not mocked UI actions.
  await click('button', 'Manual captions');
  await page.waitForSelector('section[aria-label="Manual captions"] textarea');
  await click('section[aria-label="Manual captions"] textarea', 'Caption text');
  await page.keyboard.type('Manual title');
  await click('section[aria-label="Manual captions"] button', 'Add captions');
  await page.waitForFunction(() => document.querySelector('section[aria-label="Captions"] [role=tab][aria-selected="true"]')?.textContent === 'Style');
  const sceneStarts = async () => page.evaluate(html => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-composition-src]')].map(node => [node.id, node.dataset.start]), await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'));
  const beforeScenes = await sceneStarts();
  const manualId = await page.evaluate(html => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-caption-track]')].find(n => n.textContent === 'Manual title')?.dataset.captionTrack, await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'));
  assert(manualId, 'Manual creation persists an identifiable caption track');
  const textClip = `[data-clip][data-el-id*="${manualId}"]`;
  await page.waitForSelector(textClip);
  const nativeText = async () => {
    const html = await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8');
    return page.evaluate(({html, manualId}) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-caption-track]')].filter(n => n.dataset.captionTrack === manualId).map(n => ({ id: n.id, start: Number(n.dataset.start), duration: Number(n.dataset.duration), text: n.textContent })), {html, manualId});
  };
  const waitNative = async predicate => { for (let i = 0; i < 100; i++) { const result = await nativeText(); if (predicate(result)) return result; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Native text edit did not persist'); };
  await waitNative(rows => rows.length === 1);
  const clipHandle = await page.$(textClip); await clipHandle.evaluate(n => n.scrollIntoView({ block: 'center', inline: 'center' }));
  await clipHandle.click();
  let box = await clipHandle.boundingBox(), initial = (await nativeText())[0];
  const pixelsPerSecond = box.width / initial.duration;
  // Hold Control after pickup to test a free move independently of nearby snap targets.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.keyboard.down('Control');
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 12 });
  await page.waitForFunction(x => {
    const actor = document.querySelector('[data-timeline-gesture-actor]');
    const landing = document.querySelector('[data-testid="timeline-drag-landing"]');
    return actor && landing && Math.abs(actor.getBoundingClientRect().left - x) < 2 &&
      Math.abs(landing.getBoundingClientRect().left - x) < 2;
  }, {}, box.x + 40);
  await page.mouse.up();
  await page.keyboard.up('Control');
  const moved = (await waitNative(rows => rows[0]?.start > initial.start + 0.1))[0];
  assert(Math.abs((moved.start - initial.start) * pixelsPerSecond - 40) < 2, 'Free drag persists at the displayed landing');
  await page.waitForFunction((selector, start) => Math.abs(Number(document.querySelector(selector)?.dataset.clipStart) - start) < .02, {}, textClip, moved.start);
  await click(textClip, await page.$eval(textClip, n => n.getAttribute('aria-label'))); box = await (await page.$(textClip)).boundingBox();
  const trim = await page.$(`${textClip} [data-trim-edge="end"]`); const edge = await trim.boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await page.mouse.down(); await page.mouse.move(edge.x + edge.width / 2 - 24, edge.y + edge.height / 2, { steps: 10 }); await page.mouse.up();
  const trimmed = (await waitNative(rows => rows[0]?.duration < moved.duration - .1))[0];
  await page.waitForFunction((selector, duration) => Math.abs(Number(document.querySelector(selector)?.dataset.clipEnd) - Number(document.querySelector(selector)?.dataset.clipStart) - duration) < .02, {}, textClip, trimmed.duration);
  box = await (await page.$(textClip)).boundingBox();
  const ruler = await (await page.$('[data-timeline-ruler]')).boundingBox();
  await page.mouse.click(box.x + box.width / 2, ruler.y + ruler.height / 2);
  await click('button', 'Split');
  await waitNative(rows => rows.length === 2);
  assert.deepEqual(await sceneStarts(), beforeScenes, 'Moving and trimming text must never carry underlying video clips');
  console.log('PASS manual text, pointer drag, trim and split with durable native source');
  await click('button', 'Add music');
  const musicPicker = await page.$('input[type=file][accept="audio/*"]'); await musicPicker.uploadFile(source);
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(n => n.textContent.includes('Music added to the timeline')));
  await click('.hf-dock-tab-label', 'Captions'); await click(`${captionPanel} [role=tab]`, 'Auto captions');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { if (theme === 'light') document.documentElement.dataset.theme = 'paper'; else delete document.documentElement.dataset.theme; }, theme);
    await capture({ path: path.join(output, `auto-captions-${theme}.png`) });
    await click(`${captionPanel} button`, 'Spoken language'); await page.waitForSelector('[role=option]');
    await capture({ path: path.join(output, `auto-language-${theme}.png`) }); await page.keyboard.press('Escape');
  }
  await click(`${captionPanel} button`, 'Source media'); await click('[role=option]', 'video.mp4');
  const callsBeforeAuto = paidCalls;
  await click(`${captionPanel} button`, 'Generate captions');
  await page.waitForFunction(() => document.querySelector('section[aria-label="Captions"] [role=tab][aria-selected="true"]')?.textContent === 'Style', { timeout: 45000 });
  assert.equal(paidCalls, callsBeforeAuto + 1);
  assert.match(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /data-caption-label="video.mp4"/);
  await click(`${captionPanel} [role=tab]`, 'Add captions');
  await click('section[aria-label="Manual captions"] textarea', 'Caption text');
  await page.keyboard.type('First manual caption\nSecond manual caption');
  await click('section[aria-label="Manual captions"] button', 'Add captions');
  await page.waitForFunction(() => document.querySelector('section[aria-label="Captions"] [role=tab][aria-selected="true"]')?.textContent === 'Style');
  assert.match(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /Second manual caption/);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { if (theme === 'light') document.documentElement.dataset.theme = 'paper'; else delete document.documentElement.dataset.theme; }, theme);
    await capture({ path: path.join(output, `manual-captions-${theme}.png`) });
  }
  await click(`${captionPanel} [role=tab]`, 'Auto captions');
  const directSrt = path.join(data, 'manual.srt'); await writeFile(directSrt, '1\n00:00:00,000 --> 00:00:01,000\nDirect SRT import\n');
  const directPicker = page.waitForFileChooser(); await click(`${captionPanel} button`, 'Import SRT / VTT'); await (await directPicker).accept([directSrt]);
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(n => n.textContent.includes('Captions added to the video')));
  for (let i = 0; i < 100 && !(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8')).includes('Direct SRT import'); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /Direct SRT import/);
  await page.setViewport({ width: 700, height: 850 });
  await capture({ path: path.join(output, 'auto-captions-narrow.png') });
  assert.deepEqual(errors, []);
  console.log(uiOnly ? 'PASS transcript layout, imports, review, captions and recording UI' : 'PASS transcript import, review, captions, recording and two-language native exports with playback');
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ scope: uiOnly ? 'UI regression' : 'UI and native exports with playback', browser: 'isolated Chromium', provider: 'synthetic ASR response; real FFmpeg extraction', microphone: 'synthetic Web Audio capture through real MediaRecorder; real hardware microphone unverified', paidCalls, exports, errors }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.log('Captured browser failure', errors);
  await writeFile(path.join(output, 'dom.json'), JSON.stringify(await page?.evaluate(() => ({ buttons: [...document.querySelectorAll('button')].map(b=>({label:b.getAttribute('aria-label'),text:b.textContent,disabled:b.disabled})), transcript: document.querySelector('section[aria-label="Transcript"]')?.outerHTML, captions: document.querySelector('section[aria-label="Captions"]')?.outerHTML, alerts: [...document.querySelectorAll('[role=status],[role=alert]')].map(n=>n.textContent) })).catch(() => ({})) || {}, null, 2));
  await writeFile(path.join(output, 'failure.txt'), String(error.stack)); throw error;
} finally { releaseRecognition(); await browser?.close(); await running?.close(); await rm(data, { recursive: true, force: true, maxRetries: 5 }); await rm(lock, { recursive: true, force: true }); }
