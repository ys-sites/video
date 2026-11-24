import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { WorkspaceStore } from '../workspace.ts';
import { gatewayFor } from '../gateway/service.ts';
import { ProviderConnections } from '../gateway/connections.ts';
import { OpenDesignAccount } from '../gateway/account.ts';
import { startServer } from '../server.ts';
import { pluginRoot } from '../hyperframes.ts';

const output = process.argv[2];
assert(output && path.isAbsolute(output), 'Pass an absolute evidence directory');
await mkdir(output, { recursive: true });
await rm(path.join(output, 'result.json'), { force: true });
await rm(path.join(output, 'failure.png'), { force: true });
// Honor a host browser-lock lane when supplied; otherwise reserve a dedicated,
// exclusive headless lane. This test never connects to the user's browser profile.
const lane = process.env.D4_LANE || 'openmotion-settings-isolated';
const lock = path.join(tmpdir(), 'openmotion-settings-browser.lock');
await mkdir(lock);
const data = await mkdtemp(path.join(tmpdir(), 'motion-settings-browser-'));
const store = new WorkspaceStore(data), errors = [];
let browser, running, page;
try {
  await store.initialize(pluginRoot);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const fetcher = async (url, init = {}) => {
    assert.equal(String(url), 'https://fixture.example/v1/models');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-browser-key');
    return Response.json({ data: [{ id: 'image-one', architecture: { output_modalities: ['image'] } }, { id: 'language-one' }] });
  };
  gateway.connections = new ProviderConnections(store, fetcher);
  const binary = fileURLToPath(new URL('./fixtures/account-cli.mjs', import.meta.url)); await chmod(binary, 0o755);
  gateway.account = new OpenDesignAccount(data, { binary });
  let directoryGate;
  running = await startServer(store, Number(process.env.PLAYWRIGHT_WEB_PORT || 0), { editor: true, privateHandler: async (req, res) => {
    if (directoryGate && req.method === 'GET' && req.url === '/motion-api/settings/providers') {
      await directoryGate;
      res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Synthetic directory outage' })); return true;
    }
    return false;
  } });
  const origin = (await running.info()).previewUrl;
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    userDataDir: path.join(data, 'browser'), args: ['--no-first-run'] });
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => { localStorage.setItem('motion.studio.locale', 'en'); });
  await page.goto(new URL('/editor', origin).href, { waitUntil: 'domcontentloaded' });
  const clickText = async (selector, text) => {
    const handle = await page.waitForFunction((selector, text) => [...document.querySelectorAll(selector)].find(node => {
      const label = node.cloneNode(true);
      // Decorative avatars may contain initials that are not part of the control label.
      label.querySelectorAll('[aria-hidden="true"]').forEach(child => child.remove());
      const value = label.textContent.trim();
      return (value === text || selector === '[role=menuitem]' && value.startsWith(text)) && !node.disabled;
    }), {}, selector, text);
    // Select positions its selected item while opening. Let that finish before
    // scrolling another option into view, as a pointer user does after opening.
    await page.evaluate(async () => { await Promise.allSettled(document.getAnimations().filter(animation => { const timing = animation.effect?.getTiming(); return timing && timing.iterations !== Infinity && Number(timing.duration) < 1000; }).map(animation => animation.finished)); });
    await handle.asElement().evaluate(node => node.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const hit = await handle.asElement().evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { reachable: !!hit && node.contains(hit), hit: hit?.outerHTML.slice(0, 300) }; });
    assert(hit.reachable, `Control is covered: ${selector} ${text}: ${hit.hit}`);
    await handle.asElement().click(); await handle.dispose();
  };
  const shot = async name => {
    await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await Promise.allSettled(document.getAnimations().filter(animation => { const timing = animation.effect?.getTiming(); return timing && timing.iterations !== Infinity && Number(timing.duration) < 1000; }).map(animation => animation.finished)); });
    await page.screenshot({ path: path.join(output, name + '.png') });
  };
  const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.om-settings-main,.om-settings-dialog,.om-provider-detail')].filter(el => el.getClientRects().length).every(el => el.scrollWidth <= el.clientWidth + 1)), 'Settings must fit the viewport');
  const settings = async label => {
    if (await page.$eval('.om-settings-mobile-navigation', node => getComputedStyle(node).display !== 'none')) {
      await page.click('.om-settings-mobile-navigation button');
      await clickText('[role=option]', label);
    } else await clickText('.om-settings-sections button', label);
    await page.waitForFunction(label => document.querySelector('.om-settings-main')?.getAttribute('aria-label') === label, {}, label);
  };
  const directoryRecovery = async theme => {
    await settings('General');
    let release;
    directoryGate = new Promise(resolve => { release = resolve; });
    await settings('Model providers');
    await page.waitForSelector('.om-provider-detail .om-settings-loading', { visible: true }); await shot('settings-loading-' + theme);
    release();
    await page.waitForSelector('.om-provider-detail [role=alert]', { visible: true }); await shot('settings-error-' + theme);
    directoryGate = undefined;
    await clickText('.om-provider-detail button', 'Retry'); await page.waitForSelector('.om-provider-item');
  };
  const invalidProviderToast = async theme => {
    await page.type('.om-settings-dialog [aria-label="Provider name"]', 'Invalid endpoint');
    await page.type('.om-settings-dialog [aria-label="API base URL"]', 'http://127.0.0.1/v1');
    await clickText('.om-dialog-actions button', 'Add provider');
    await page.waitForSelector('[aria-label="Dismiss error"]', { visible: true }); await shot('dialog-error-toast-' + theme);
    // Error feedback must be reachable while the modal remains open.
    await page.click('[aria-label="Dismiss error"]'); await page.waitForSelector('[aria-label="Dismiss error"]', { hidden: true });
    assert(await page.$('.om-settings-dialog'));
    await clickText('.om-dialog-actions button', 'Cancel'); await page.waitForSelector('.om-settings-dialog', { hidden: true });
  };
  await page.waitForSelector('.om-app-header');
  await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { visible: true });
  await page.click('[data-studio-control="playback"]');
  await page.waitForFunction(() => document.querySelector('[data-studio-control="playback"]')?.getAttribute('aria-label') === 'Pause');
  await shot('workspace-light');
  await page.click('[aria-label="Account menu"]'); await page.waitForSelector('[role=menu]');
  await shot('account-menu-light');
  await clickText('[role=menuitem]', 'Settings');
  await page.waitForSelector('.om-settings-center'); await settings('Model providers');
  await page.waitForFunction(() => document.querySelector('[data-studio-control="playback"]')?.getAttribute('aria-label') === 'Play');
  await page.waitForSelector('.om-provider-item');
  const listedProviders = await page.evaluate(async () => {
    const { providers } = await (await fetch('/motion-api/settings/providers')).json();
    return providers.filter(provider => provider.kinds.some(kind => kind !== 'text')).map(provider => provider.id);
  });
  assert.equal(await page.$$eval('.om-provider-item', nodes => nodes.length), listedProviders.length);
  assert(listedProviders.includes('fal') && !listedProviders.includes('deepseek'));
  await directoryRecovery('light');
  await page.click('[aria-label="Filter providers"]'); await page.waitForSelector('[role=menu]');
  await shot('provider-filter-light'); await clickText('[role=menuitemradio]', 'Multimodal');
  await page.click('[aria-label="Clear filters"]');
  await clickText('.om-add-provider', 'Add provider'); await page.waitForSelector('.om-settings-dialog');
  await invalidProviderToast('light');
  await clickText('.om-add-provider', 'Add provider'); await page.waitForSelector('.om-settings-dialog');
  await page.type('.om-settings-dialog [aria-label="Provider name"]', 'Studio fixture');
  await page.type('.om-settings-dialog [aria-label="API key"]', 'synthetic-browser-key');
  await page.type('.om-settings-dialog [aria-label="API base URL"]', 'https://fixture.example/v1');
  await shot('custom-provider-light');
  await clickText('.om-dialog-actions button', 'Add provider');
  await page.waitForSelector('.om-settings-dialog', { hidden: true });
  await page.waitForFunction(() => document.querySelector('.om-provider-heading')?.textContent.includes('Studio fixture'));
  assert.equal(await page.$eval('[aria-label="Studio fixture API key"]', node => node.value), '');
  await page.waitForSelector('[role=status]'); await shot('saved-provider-toast');
  await clickText('.om-provider-detail button', 'Sync models');
  await page.waitForFunction(() => document.querySelectorAll('.om-model-row').length === 2);
  await page.click('[aria-label="Use image-one as default"]');
  await page.waitForFunction(() => document.querySelector('.om-model-row')?.textContent.includes('Default'));
  const directory = await page.evaluate(async () => (await fetch('/motion-api/settings/providers')).json());
  const customId = directory.providers.find(provider => provider.label === 'Studio fixture').id;
  assert.equal(directory.defaults.image, customId + ':image-one');
  assert(!JSON.stringify(directory).includes('synthetic-browser-key'));
  await shot('providers-light'); await noOverflow();
  await page.click('[aria-label="Add model"]');
  await page.type('.om-settings-dialog [aria-label="Model ID"]', 'manual-image');
  await clickText('.om-settings-dialog button', 'More settings');
  await clickText('.om-settings-dialog button', 'Image');
  await clickText('.om-dialog-actions button', 'Add model');
  await page.waitForSelector('.om-settings-dialog', { hidden: true });
  await page.waitForFunction(() => document.querySelectorAll('.om-model-row').length === 3);
  await settings('Default Agent & models'); await shot('default-models-light');
  await page.click('[aria-label="Select model"]'); await page.waitForSelector('.om-model-picker');
  await shot('model-picker-light'); await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.om-app-header');
  await page.keyboard.down('Control'); await page.keyboard.press(','); await page.keyboard.up('Control');
  // The shortcut replaces the URL-restored section; its old controls can still be mounted until navigation commits.
  await page.waitForSelector('.om-settings-main[aria-label="General"]', { visible: true });
  await settings('Model providers'); await page.waitForSelector('.om-provider-item');
  await page.type('[aria-label="Search providers"]', 'Studio fixture'); await page.click('.om-provider-item');
  await page.waitForFunction(() => document.querySelectorAll('.om-model-row').length === 3);
  assert.equal(await page.$eval('[aria-label="Studio fixture API key"]', node => node.value), '');
  assert(await page.$eval('.om-model-row', node => node.textContent.includes('Default')));
  await settings('Account'); await clickText('.om-plan-guide button', 'Sign in with OpenDesign');
  await page.waitForSelector('.om-account-code'); assert.equal(await page.$eval('.om-account-code', n => n.textContent), 'TEST-123');
  await shot('account-authorization-light');
  await writeFile(path.join(gateway.account.home, 'authorize'), 'yes');
  await page.waitForFunction(() => document.querySelector('.om-account-summary')?.textContent.includes('Connected to OpenDesign'));
  await page.waitForFunction(() => document.querySelector('.om-account-metrics')?.textContent.includes('12.50'));
  await shot('account-connected-light');
  await settings('Model providers');
  // The account catalogue holds five media rows (image, video, speech, the plain image model and music) and two language models.
  await page.waitForFunction(() => document.querySelectorAll('.om-model-row').length === 7);
  await shot('account-models-light');
  await settings('Default Agent & models');
  const chooseImage = async (provider, model) => {
    await page.waitForFunction(() => document.querySelectorAll('.om-preference-row [aria-label="Select model"]').length === 6);
    const controls = await page.$$('.om-preference-row [aria-label="Select model"]'); await controls[1].click();
    await page.waitForSelector('.om-model-picker'); await clickText('.om-model-picker button', 'All providers');
    await clickText('[role=menuitemradio]', provider);
    await page.waitForFunction(provider => [...document.querySelectorAll('.om-model-picker .om-provider-menu-label')].some(node => {
      const label = node.cloneNode(true);
      label.querySelectorAll('[aria-hidden="true"]').forEach(child => child.remove());
      return label.textContent.trim() === provider;
    }), {}, provider);
    await clickText('.om-model-choice-list strong', model);
    await page.waitForSelector('.om-model-picker', { hidden: true });
  };
  await chooseImage('OpenDesign', 'fixture-image');
  assert.equal((await gateway.config()).routes.image, 'account:fixture-image');
  await chooseImage('Studio fixture', 'image-one');
  assert.equal((await gateway.config()).routes.image, customId + ':image-one');
  await settings('Appearance'); await clickText('.om-theme-choice', 'Dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme !== 'paper');
  await directoryRecovery('dark'); await shot('providers-dark');
  await page.click('[aria-label="Filter providers"]'); await shot('provider-filter-dark'); await page.keyboard.press('Escape');
  await clickText('.om-add-provider', 'Add provider'); await shot('custom-provider-dark'); await invalidProviderToast('dark');
  await page.waitForSelector('.om-settings-dialog', { hidden: true });
  await settings('Account'); await shot('account-connected-dark');
  await clickText('.om-account-summary button', 'Sign out');
  await page.waitForFunction(() => document.querySelector('.om-plan-guide h2')?.textContent === 'Sign in to start multimodal generation');
  assert.equal((await gateway.account.summary()).state, 'signed-out');
  await settings('About OpenMotion'); await shot('about-dark');
  await page.setViewport({ width: 390, height: 844 });
  await settings('Model providers'); await page.waitForSelector('.om-provider-list');
  await shot('providers-mobile-dark'); await noOverflow();
  await page.type('[aria-label="Search providers"]', 'Studio fixture');
  await page.click('.om-provider-item');
  await page.waitForSelector('[aria-label="Studio fixture API key"]', { visible: true });
  await noOverflow(); await shot('provider-detail-mobile-dark');
  await clickText('.om-provider-detail button', 'Remove saved key');
  await page.waitForFunction(() => document.querySelector('.om-provider-detail .om-provider-status-badge')?.textContent.includes('Not configured'));
  await clickText('.om-provider-detail button', 'Delete provider');
  await noOverflow(); await shot('delete-provider-mobile-dark');
  await clickText('.om-settings-dialog button', 'Delete');
  await page.waitForSelector('.om-settings-dialog', { hidden: true });
  assert(!(await gateway.connections.list()).some(provider => provider.id === customId));
  await settings('Appearance'); await clickText('.om-theme-choice', 'Light');
  await settings('Account'); await noOverflow(); await shot('account-mobile-light');
  await page.click('[aria-label="Account menu"]'); await shot('account-menu-mobile-light'); await page.keyboard.press('Escape');
  await settings('Privacy & data'); await noOverflow(); await shot('privacy-mobile-light');
  await page.setViewport({ width: 1440, height: 1000 });
  await clickText('.om-app-header button', 'Back to home');
  await page.waitForSelector('.motion-workspace-content:not([hidden])'); await shot('workspace-returned');
  await page.keyboard.down('Control'); await page.keyboard.press(','); await page.keyboard.up('Control');
  await page.waitForSelector('.om-settings-center');
  await settings('General'); await page.click('[aria-label="Language"]'); await clickText('[role=option]', '简体中文');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await settings('模型供应商'); await page.waitForSelector('.om-provider-item'); await shot('providers-chinese-light');
  await page.setViewport({ width: 390, height: 844 }); await settings('账户'); await noOverflow(); await shot('account-chinese-mobile');
  // Real Assets UI with a synthetic Cloud catalogue; no generation endpoint is accepted.
  await gateway.configureProvider('opendesign', { apiKey: 'synthetic-cloud-key', baseUrl: 'https://cloud.fixture.example' });
  let edits;
  gateway.options.fetcher = async (url, init = {}) => {
    assert.equal(String(url), 'https://cloud.fixture.example/api/v1/media/models');
    assert.equal(init.method ?? 'GET', 'GET');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-cloud-key');
    return Response.json({ models: [{ model: 'cloud-image-fixture', kind: 'image', capabilities: edits === undefined ? {} : { edits, max_input_images: 2 } }] });
  };
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  await gateway.setRoute('image', 'opendesign:cloud-image-fixture');
  await page.setViewport({ width: 1440, height: 1000 });
  const assetsUrl = new URL('/assets', origin);
  await page.goto(assetsUrl.href, { waitUntil: 'domcontentloaded' });
  await clickText('.om-asset-actions button', 'AI Create');
  await page.waitForFunction(() => document.querySelector('.om-asset-composer')?.textContent.includes('Image editing capability is unknown'));
  assert.equal(await page.$eval('.om-asset-direct .om-creation-reference', node => node.disabled), true);
  await page.type('#asset-creation-prompt', 'Keep this draft while syncing');
  await shot('cloud-reference-unknown');
  edits = true;
  await clickText('.om-asset-composer button', 'Sync models');
  await page.waitForFunction(() => document.querySelector('.om-asset-direct .om-creation-reference')?.disabled === false);
  assert.equal(await page.$eval('#asset-creation-prompt', node => node.value), 'Keep this draft while syncing');
  await shot('cloud-reference-supported');
  assert.deepEqual(await gateway.listJobs(), []);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', lane, checks: ['persistent editor shell and paused background playback', 'account menu', 'provider and capability filters', 'custom provider CRUD', 'private saved credentials', 'live protocol fixture discovery', 'manual model', 'reload-persisted model and default', 'account/BYOK provider and model switching', 'real subprocess authorization fixture', 'billing and registered account models', 'sign out', 'both themes', 'English and Chinese', '390px responsive settings and dialogs', 'loading and error recovery in both themes', 'dismissible floating errors above dialogs', 'keyboard settings shortcut', 'Cloud unknown-to-supported reference sync preserves the draft without generation'], paidCalls: false, liveAccount: false }, null, 2));
  console.log('Settings browser end-to-end checks passed. No live account or paid provider was used.');
} catch (error) {
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'failed', lane, error: String(error), paidCalls: false, liveAccount: false }, null, 2));
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.error('Browser errors:', errors);
  throw error;
} finally { await browser?.close(); await running?.close(); await gatewayFor(store).close(); await rm(data, { recursive: true, force: true }); await rm(lock, { recursive: true, force: true }); }
