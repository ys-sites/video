// Real Studio + stdio MCP + rendering. Editorial decisions use confirmed fixture
// timecodes, not a model; this test is not evidence of semantic clip selection.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { Client } from './shared-editor-client.mjs';
import { closeFixtureEditor } from './fixtures.ts';
import { configureNativeEnvironment } from '../scripts/npm-runtime.mjs';
import { pluginRoot } from '../hyperframes.ts';

const out = process.argv[2]; assert(out && path.isAbsolute(out), 'Pass an absolute evidence directory');
await mkdir(out, { recursive: true });
process.env.OPENMOTION_TELEMETRY = '0';
await configureNativeEnvironment(pluginRoot);
const data = await mkdtemp(path.join(tmpdir(), 'openmotion-platform-export-'));
const client = new Client(data);
const result = { passed: false, scope: 'real browser and stdio MCP; confirmed synthetic edit; no model or platform upload', checks: [] };
const check = (name, evidence = {}) => { result.checks.push({ name, ...evidence }); console.log('PASS ' + name); };
let browser, page;
const clickText = async (text, scope = 'button') => {
  // A closing select remains mounted during its exit animation. Wait for the
  // requested choice, rather than mistaking the previous menu for the new one.
  await page.waitForFunction((value, selector) => [...document.querySelectorAll(selector)].some(node => node.textContent.trim() === value), {}, text, scope);
  const nodes = await page.$$(scope);
  for (const node of nodes) if (await node.evaluate((el, value) => el.textContent.trim() === value, text)) {
    await node.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForFunction(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }, {}, node);
    await node.click(); return;
  }
  throw new Error(`Button missing: ${text}`);
};
const settle = () => page.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(animation => {
  const timing = animation.effect?.getTiming(); return timing && timing.iterations !== Infinity && Number(timing.duration) < 1000;
}).map(animation => animation.finished)); });
const panel = '[data-testid=platform-export-panel]';
const exportGeometry = () => page.evaluate(() => {
  const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
  const scroller = document.querySelector('[data-testid=platform-export-scroll]');
  return {
    popup: rect('[data-testid=export-dialog]'), tabs: rect('[data-testid=export-dialog] [role=tablist]'),
    footer: rect('[data-testid=platform-export-actions]'), body: scroller.getBoundingClientRect().toJSON(),
    scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
    pageScroll: window.scrollY,
    actionsReachable: [...document.querySelectorAll('[data-testid=platform-export-actions] button')].every(button => {
      const r = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  };
});
const assertStableChrome = (before, after) => {
  for (const part of ['popup', 'tabs', 'footer']) for (const dimension of ['top', 'bottom', 'height']) {
    assert(Math.abs(before[part][dimension] - after[part][dimension]) < 1, `${part}.${dimension} moved when content changed or scrolled`);
  }
  assert(after.actionsReachable, 'Copy and connection actions must remain visible and clickable');
  assert(after.body.bottom <= after.footer.top + 1, 'Form must not overlap the action footer');
  assert.equal(after.pageScroll, before.pageScroll, 'Scrolling the form must not scroll the page');
};
const verifyMiddleScroll = async () => {
  await settle();
  await page.$eval('[data-testid=platform-export-scroll]', el => { el.scrollTop = 0; });
  const before = await exportGeometry();
  assert(before.scrollHeight > before.clientHeight, 'Long form must have its own scroll area');
  assert(before.popup.height <= 641 && before.popup.bottom <= page.viewport().height - 11, 'Popup must fit the available height');
  await page.mouse.move(before.body.x + before.body.width / 2, before.body.y + before.body.height / 2);
  await page.mouse.wheel({ deltaY: 1000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=platform-export-scroll]').scrollTop > 0);
  const after = await exportGeometry();
  assertStableChrome(before, after);
  return after;
};
const waitForPreview = async () => {
  await page.waitForFunction(() => Number(document.querySelector('[data-timeline-element-count]')?.getAttribute('data-timeline-element-count')) > 0);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (await frame.evaluate(() => document.body?.textContent.includes('Confirmed opening')).catch(() => false)) return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Native preview did not show the fixture');
};
const openExport = async () => {
  await waitForPreview(); await settle();
  await page.waitForSelector('[data-testid=header-export][aria-haspopup=dialog]');
  await page.waitForFunction(() => { const el = document.querySelector('[data-testid=header-export]'); if (!el) return false; const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
  await page.click('[data-testid=header-export][aria-haspopup=dialog]');
  await page.waitForSelector('[data-testid=export-dialog]');
};
const film = (audio, portrait = false) => {
  const w = portrait ? 1080 : 1920, h = portrait ? 1920 : 1080, duration = portrait ? 2 : 6;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Platform fixture</title><script src="assets/gsap.min.js"></script><style>body{margin:0}#main{position:relative;width:${w}px;height:${h}px;background:#18382f;color:white;font:700 64px sans-serif;overflow:hidden}h1{position:absolute;left:80px;top:160px;width:${w-160}px}</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${w}" data-height="${h}" data-fps="10"><h1 id="caption" data-start="0" data-duration="${duration}" data-track-index="0">Confirmed opening</h1><audio id="tone" src="${audio}" data-start="0" data-duration="${duration}" data-track-index="1"></audio></div><script>window.__timelines={main:gsap.timeline({paused:true}).fromTo('#caption',{y:0},{y:100,duration:${duration},ease:'none'})};</script></body></html>`;
};
try {
  // A six-second tone is generated locally; no external assets, keys or paid calls.
  const rate = 44100, samples = rate * 6, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 9000), 44 + i * 2);
  await writeFile(path.join(data, 'source.wav'), wav);
  await client.initialize();
  const created = await client.call('openmotion_create_project', { projectType: 'natural_language', title: 'Platform export fixture', requirements: 'Use confirmed opening 0–2 seconds. Retain tone audio.', requestId: 'create' });
  const sourceId = created.projectId;
  const imported = await client.call('openmotion_import_assets', { projectId: sourceId, requestId: 'audio', items: [{ itemId: 'tone', sourcePath: path.join(data, 'source.wav') }] });
  assert.equal(imported.items[0].status, 'completed', JSON.stringify(imported));
  const audio = imported.items[0].path;
  let current = await client.call('openmotion_get_project', { projectId: sourceId });
  await client.call('openmotion_edit_project', { projectId: sourceId, requestId: 'source', expectedRevision: current.revision, expectedVersionId: current.currentVersionId, files: [{ path: 'index.html', content: film(audio) }] });
  current = await client.call('openmotion_get_project', { projectId: sourceId });
  await client.call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'caption_add', projectId: sourceId, compositionPath: 'index.html', requestId: 'manual-caption', expectedRevision: current.revision, expectedVersionId: current.currentVersionId, segments: [{ id: 'cue', text: 'Saved timeline subtitle', start: 1, end: 3 }] } });
  const preview = await client.call('openmotion_open_preview', { projectId: sourceId });
  const origin = new URL(preview.previewUrl).origin;
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  page = await browser.newPage(); page.setDefaultTimeout(30_000);
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
  page.on('pageerror', error => console.error('PAGE ERROR', error.message));
  let integrationMode = 'normal', held;
  const integration = await (await fetch(origin + '/motion-api/integration')).json();
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/motion-api/integration' && integrationMode === 'hold') { held = request; return; }
    if (url.pathname === '/motion-api/integration' && integrationMode === 'fail') { void request.respond({ status: 503, body: '{}' }); return; }
    if (url.pathname.startsWith('/motion-api/template-catalog')) { void request.respond({ contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, next: null }) }); return; }
    void (url.origin === origin || ['data:', 'blob:'].includes(url.protocol) ? request.continue() : request.abort());
  });
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    const script = await page.evaluateOnNewDocument(theme => {
      localStorage.setItem('motion.studio.locale', 'en');
      localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme }));
    }, theme);
    await page.goto(preview.previewUrl, { waitUntil: 'domcontentloaded' });
    await openExport();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme === 'paper' ? 'light' : 'dark'), theme);
    assert.equal(await page.$eval('[data-tab-id=file]', el => el.getAttribute('aria-selected')), 'true');
    await page.waitForFunction(() => { const el = document.querySelector('[data-testid=export-dialog]'); return Math.abs(el.getBoundingClientRect().height - el.offsetHeight) < 0.05; });
    const videoHeight = await page.$eval('[data-testid=export-dialog]', node => node.getBoundingClientRect().height);
    await clickText('Captions', '[data-testid=export-dialog] [role=tab]');
    await page.waitForSelector('[data-testid=caption-export-panel] [role=radio]');
    await clickText('Download SRT');
    await page.waitForFunction(() => document.querySelector('.motion-feedback-layer')?.textContent.includes('Subtitle download started'));
    const subtitleFile = path.join(out, 'index-captions.srt');
    let subtitleBytes;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { subtitleBytes = await readFile(subtitleFile, 'utf8'); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    const subtitleMcp = await client.call('openmotion_assets_use', { action: 'transcript', transcript: { command: 'caption_export', projectId: sourceId, compositionPath: 'index.html', format: 'srt' } });
    assert.equal(subtitleBytes, subtitleMcp.content);
    assert(subtitleBytes.includes('00:00:01,000 --> 00:00:03,000\nSaved timeline subtitle'));
    await rm(subtitleFile);
    await page.waitForFunction(() => { const el = document.querySelector('[data-testid=export-dialog]'); return Math.abs(el.getBoundingClientRect().height - el.offsetHeight) < 0.05; });
    assert(Math.abs(await page.$eval('[data-testid=export-dialog]', node => node.getBoundingClientRect().height) - videoHeight) < 1);
    await page.screenshot({ path: path.join(out, `${theme}-${width}-subtitle-download.png`) });
    check(`timeline subtitle download matches public MCP: ${theme}, ${width}px`);
    await clickText('Platform export', '[role=tab]'); await page.waitForSelector(`${panel} [role=radio]`);
    await settle();
    const initialLayout = await exportGeometry();
    assert.equal(Math.round(initialLayout.popup.height), 640, 'Platform export should use a fixed height in a tall viewport');
    await page.click(`${panel} button[aria-label=Goal]`); await page.waitForSelector('[role=option]'); await settle();
    const menu = await page.$eval('[role=listbox]', el => {
      const rect = el.getBoundingClientRect(), option = el.querySelector('[role=option]'), r = option.getBoundingClientRect();
      return { rect: rect.toJSON(), reachable: option.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    assert(menu.reachable, 'Opened select must layer above the export popup');
    assert(menu.rect.left >= 0 && menu.rect.right <= width, 'Menu must fit narrow viewport');
    await page.screenshot({ path: path.join(out, `${theme}-${width}-menu.png`) });
    await clickText('Make a short version', '[role=option] .om-select-option-copy > :first-child');
    const platformRadio = await page.$(`${panel} [role=radio][aria-label=\"YouTube Shorts\"]`);
    await platformRadio.click();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.$eval(`${panel} [role=radio][aria-label=\"Instagram Reels\"]`, el => el.getAttribute('aria-checked')), 'true');
    await page.keyboard.press('ArrowRight');
    assert.equal(await platformRadio.evaluate(el => el.getAttribute('aria-checked')), 'true');
    assert.equal(await page.$$eval(`${panel} .om-platform-icon img`, images => images.filter(image => image.complete && image.naturalWidth > 0).length), 7);
    await clickText('Customize version', `${panel} summary`);
    await page.click(`${panel} button[aria-label=Duration]`); await page.waitForFunction(() => [...document.querySelectorAll('[role=option]')].some(el => el.textContent.includes('15–30 seconds')));
    await clickText('15–30 seconds', '[role=option] .om-select-option-copy > :first-child');
    await page.click(`${panel} button[aria-label=Captions]`); await page.waitForSelector('[role=option]');
    await clickText('Add editable captions', '[role=option] .om-select-option-copy > :first-child');
    await clickText('Additional requirements (optional)', `${panel} summary`);
    await page.type(`${panel} textarea`, 'Keep only the confirmed opening, 0–2 seconds, with its audio.');
    assertStableChrome(initialLayout, await exportGeometry());
    const scrolled = await verifyMiddleScroll();
    await clickText('Copy for Agent');
    await page.waitForFunction(() => document.querySelector('.motion-feedback-layer')?.textContent.includes('Copied. Paste into your Agent.'));
    const instruction = await page.evaluate(() => navigator.clipboard.readText());
    assert(instruction.includes(`Project ID: ${sourceId}`)); assert(instruction.includes(data));
    assert(instruction.includes('0–2 seconds, with its audio.'));
    assert(instruction.includes('15–30 second short')); assert(instruction.includes('add editable captions'));
    const feedback = await page.$eval('.motion-feedback-layer', el => {
      const child = el.querySelector('[role=status], [role=alert]') || el.firstElementChild, r = child.getBoundingClientRect();
      return { hidden: Boolean(el.closest('[aria-hidden=true], [inert]')), rect: r.toJSON() };
    });
    assert(!feedback.hidden, 'Toast must remain accessible under the modal popover');
    const bounds = await page.$eval('[data-testid=export-dialog]', el => el.getBoundingClientRect().toJSON());
    assert(bounds.left >= 0 && bounds.right <= width && bounds.bottom <= 900, JSON.stringify(bounds));
    await page.screenshot({ path: path.join(out, `${theme}-${width}-copied.png`) });
    await writeFile(path.join(out, 'copied-instruction.txt'), instruction);
    check(`export choices, fixed actions, scrolling and clipboard toast: ${theme}, ${width}px`, { bounds, feedback, scrolled });
    await clickText('Connection help'); await page.waitForSelector('#mcp-title');
    const card = await page.$('.om-mcp-capability-grid article.om-mcp-feature[data-mcp-scenario="platform-export"]');
    assert((await card.evaluate(el => el.textContent)).includes('Prepare a platform version'));
    await card.$eval('button', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await settle();
    assert(await card.$eval('button', el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'Handbook copy action must be reachable');
    await (await card.$('button')).click();
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('ask me to identify the source project'));
    const example = await page.evaluate(() => navigator.clipboard.readText());
    assert(example.includes('ask me to identify the source project')); assert(example.includes('openmotion_manage_project'));
    await page.screenshot({ path: path.join(out, `${theme}-${width}-handbook.png`) });
    await page.removeScriptToEvaluateOnNewDocument(script.identifier);
  }
  // Loading, error recovery and manual-copy fallback in the real opened popup.
  for (const theme of ['light', 'dark']) {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await page.setViewport({ width: 390, height: 844 });
  integrationMode = 'hold';
  const recoveryUrl = new URL(preview.previewUrl); recoveryUrl.searchParams.set('platform-export-recovery', theme);
  await page.goto(recoveryUrl.href, { waitUntil: 'domcontentloaded' });
  await openExport(); await clickText('Platform export', '[role=tab]');
  await page.waitForSelector(`${panel} [role=status]`); await page.screenshot({ path: path.join(out, `${theme}-integration-loading.png`) });
  assert(held); integrationMode = 'fail'; await held.respond({ status: 503, body: '{}' });
  await page.waitForSelector(`${panel} [role=alert]`); await page.screenshot({ path: path.join(out, `${theme}-integration-error.png`) });
  integrationMode = 'normal'; await clickText('Retry');
  await page.waitForFunction(selector => !document.querySelector(`${selector} [role=alert]`) && !document.querySelector(`${selector} [role=status]`), {}, panel);
  const beforeRecovery = await exportGeometry();
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Fixture clipboard denial'); }; });
  await clickText('Copy for Agent'); await page.waitForSelector('textarea[aria-label="Platform export instruction"]');
  assert((await page.$eval('textarea[aria-label="Platform export instruction"]', el => el.value)).includes(`Project ID: ${sourceId}`));
  assertStableChrome(beforeRecovery, await exportGeometry());
  await verifyMiddleScroll();
  await page.screenshot({ path: path.join(out, `${theme}-clipboard-recovery.png`) });
  check(`integration loading, failure/retry and manual clipboard recovery: ${theme}`);
  await page.setViewport({ width: 390, height: 600 });
  await page.waitForFunction(() => document.querySelector('[data-testid=export-dialog]').getBoundingClientRect().bottom <= innerHeight - 11);
  await clickText('Customize version', `${panel} summary`);
  await clickText('Additional requirements (optional)', `${panel} summary`);
  await page.type('textarea[aria-label="Additional requirements (optional)"]', 'Keep the confirmed opening.\n'.repeat(30));
  // Editing notes invalidates the prior instruction; request the new fallback.
  await clickText('Copy for Agent');
  await page.waitForSelector('textarea[aria-label="Platform export instruction"]');
  const shortLayout = await verifyMiddleScroll();
  await page.focus('textarea[aria-label="Platform export instruction"]');
  assertStableChrome(shortLayout, await exportGeometry());
  await page.screenshot({ path: path.join(out, `${theme}-390-600-scroll.png`) });
  check(`short viewport with expanded notes and manual-copy text: ${theme}`, shortLayout);
  }

  // An external Agent's deterministic execution of the copied brief.
  const copied = await readFile(path.join(out, 'copied-instruction.txt'), 'utf8');
  const projectId = copied.match(/^Project ID: (.+)$/m)[1]; assert.equal(projectId, sourceId);
  const before = await client.call('openmotion_get_project', { projectId });
  const sourceFile = await client.call('openmotion_get_project', { projectId, file: { path: 'index.html' } });
  const duplicateArgs = { action: 'duplicate', projectId, expectedRevision: before.revision, title: 'YouTube Shorts · confirmed opening', requestId: 'platform-copy' };
  const duplicate = await client.call('openmotion_manage_project', duplicateArgs);
  assert.equal((await client.call('openmotion_manage_project', duplicateArgs)).projectId, duplicate.projectId);
  current = await client.call('openmotion_get_project', { projectId: duplicate.projectId });
  const edit = { projectId: duplicate.projectId, expectedRevision: current.revision, expectedVersionId: current.currentVersionId, requestId: 'platform-edit', files: [{ path: 'index.html', content: film(audio) }, { path: 'compositions/outro.html', content: film('../' + audio, true).replace('src="assets/gsap.min.js"', 'src="../assets/gsap.min.js"') }] };
  await client.call('openmotion_edit_project', edit);
  await assert.rejects(client.call('openmotion_edit_project', { ...edit, requestId: 'stale-edit' }), /revision|conflict/i);
  const adaptedPreview = await client.call('openmotion_open_preview', { projectId: duplicate.projectId });
  await page.goto(adaptedPreview.previewUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Number(document.querySelector('[data-timeline-element-count]')?.getAttribute('data-timeline-element-count')) > 0);
  await waitForPreview();
  await page.screenshot({ path: path.join(out, 'adapted-preview.png') });
  current = await client.call('openmotion_get_project', { projectId: duplicate.projectId });
  const exportArgs = { projectId: duplicate.projectId, versionId: current.currentVersionId, expectedRevision: current.revision, requestId: 'platform-render', audio: 'required', compositionPath: 'compositions/outro.html' };
  const queued = await client.call('openmotion_export_request', exportArgs);
  assert.equal((await client.call('openmotion_export_request', exportArgs)).job.id, queued.job.id);
  let completed; const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const { exportJob } = await client.call('openmotion_get_project', { projectId: duplicate.projectId, exportJobId: queued.job.id });
    assert.notEqual(exportJob.state, 'failed', JSON.stringify(exportJob));
    if (exportJob.state === 'completed') { completed = exportJob; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(completed, 'Render must finish'); assert.equal(completed.verification.status, 'passed');
  assert.equal(completed.compositionPath, 'compositions/outro.html'); assert.equal(completed.expected.width, 1080); assert.equal(completed.expected.height, 1920); assert.equal(completed.expected.duration, 2);
  const downloaded = await fetch(completed.downloadUrl); assert.equal(downloaded.status, 200);
  const deliveredBytes = Buffer.from(await downloaded.arrayBuffer());
  assert.deepEqual(deliveredBytes, await readFile(completed.path));
  await copyFile(completed.path, path.join(out, 'platform-short.mp4'));
  const after = await client.call('openmotion_get_project', { projectId }); assert.equal(after.revision, before.revision); assert.equal(after.currentVersionId, before.currentVersionId);
  assert.deepEqual((await client.call('openmotion_get_project', { projectId, file: { path: 'index.html' } })).file, sourceFile.file);
  check('stdio MCP duplicate/edit/conflict/preview/render/retry/download; source unchanged', { jobId: completed.id, verification: completed.verification });
  const playback = await browser.newPage();
  // Play the exact downloaded file. The download endpoint is an attachment route, not a seekable streaming API.
  await playback.setContent('<video controls style="height:80vh" id="result"></video>');
  const media = await playback.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const video = document.querySelector('video'); video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const context = new AudioContext(), analyser = context.createAnalyser();
    context.createMediaElementSource(video).connect(analyser); analyser.connect(context.destination); await context.resume();
    await video.play();
    await new Promise((resolve, reject) => { const end = performance.now() + 10000; const tick = () => video.currentTime > 0.5 ? resolve() : performance.now() > end ? reject(new Error('Playback stalled')) : requestAnimationFrame(tick); tick(); });
    const samples = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(samples);
    const energy = Math.max(...samples), frames = video.getVideoPlaybackQuality().totalVideoFrames;
    video.pause(); video.currentTime = 1.5; await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
    const seek = video.currentTime; video.currentTime = 0; await video.play();
    await new Promise(resolve => video.addEventListener('ended', resolve, { once: true }));
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, frames, energy, seek, ended: video.ended, error: video.error };
  }, deliveredBytes.toString('base64'));
  result.playback = media;
  assert(media.frames > 0 && media.energy > 0 && media.ended && !media.error && Math.abs(media.seek - 1.5) < 0.1, JSON.stringify(media));
  await playback.screenshot({ path: path.join(out, 'final-playback.png') });
  check('actual MP4 decoded frames, audible signal, seek and replay', media);
  result.passed = true;
} catch (error) {
  result.error = error.stack;
  result.clipboard = await page?.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  result.page = await page?.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(-8000) })).catch(() => null);
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); throw error;
} finally {
  result.trace = client.trace; result.stderr = client.stderr;
  await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  await browser?.close(); await client.close(); await closeFixtureEditor(data);
  await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
