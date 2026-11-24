import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Exercise installed public tools and the real Studio page without model calls. */
export async function checkTemplateRuntime({ call, appRoot, browserPath, output, expectedSource = 'hosted' }) {
  await mkdir(output, { recursive: true });
  const result = { status: 'running', source: expectedSource, checks: [] };
  const check = (name, evidence = {}) => { result.checks.push({ name, ...evidence }); console.log('PASS ' + name); };
  let browser, page;
  const errors = [], failedSources = [], browserEvents = [];
  try {
    const index = await call('openmotion_list_templates');
    assert.equal(index.source, expectedSource);
    assert(!index.warning, 'Catalog must load successfully, not fall back: ' + index.warning);
    const rows = (await readFile(index.indexPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, index.total, 'Template count must match the index');
    assert(rows.every(row => row.kind !== 'skill'), 'Template index must not contain Skill rows');
    const skills = await call('openmotion_list_skills');
    assert.equal(skills.source, expectedSource);
    assert(!skills.warning, 'Skill catalog must load successfully, not fall back: ' + skills.warning);
    const skillRows = (await readFile(skills.indexPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(skillRows.length, skills.total, 'Skill count must match the index');
    const reference = rows.find(row => row.kind !== 'builtin');
    assert(reference, 'The live catalog must contain a non-builtin template');
    const detail = await call('openmotion_get_template', { templateId: reference.templateId });
    assert.equal(detail.id, reference.templateId);
    assert(detail.instructions?.length && detail.motionDocument?.content?.length);
    if (expectedSource === 'hosted') assert.equal(detail.localSource, undefined);
    check('public MCP lists the catalog and reads a non-builtin guide', { total: index.total, skillTotal: skills.total, catalogVersion: index.catalogVersion, templateId: reference.templateId });
    const opened = await call('openmotion_open_preview', { target: 'templates' });
    const origin = new URL(opened.previewUrl).origin;
    assert.equal(opened.projectCreated, false);
    const require = createRequire(path.join(appRoot, 'package.json'));
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-first-run'] });
    page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warn'].includes(message.type())) browserEvents.push(message.text()); });
    page.on('response', response => {
      if (response.url().startsWith(origin + '/api/template-source/') && response.status() >= 400) failedSources.push({ url: response.url(), status: response.status() });
    });
    const library = 'dialog[aria-label="Template library"]';
    const preview = 'dialog[aria-label="Template preview"]';
    for (const [theme, width, height] of [['light', 1440, 1000], ['dark', 1440, 1000], ['dark', 390, 844]]) {
      await page.setViewport({ width, height });
      const init = await page.evaluateOnNewDocument(theme => {
        localStorage.setItem('motion.studio.locale', 'en');
        localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme }));
      }, theme);
      await page.goto(opened.previewUrl, { waitUntil: 'domcontentloaded' });
      await page.removeScriptToEvaluateOnNewDocument(init.identifier);
      await page.waitForSelector(`${library}[open] [data-template-id]`, { visible: true });
      const gallery = await page.evaluate(async () => (await fetch('/motion-api/template-catalog?category=all&locale=en')).json());
      assert.equal(gallery.source, expectedSource); assert.equal(gallery.catalogVersion, index.catalogVersion);
      await page.screenshot({ path: path.join(output, `${theme}-${width}-library.png`) });
      await page.locator(`${library} input[aria-label="Search templates"]`).fill(reference.templateId);
      await page.waitForFunction(id => document.querySelectorAll('main [data-template-id]').length === 1 && document.querySelector('main [data-template-id]')?.getAttribute('data-template-id') === id, {}, reference.templateId);
      await page.click(`${library} [data-template-id="${reference.templateId}"] button`);
      await page.waitForSelector(`${preview}[open] h2`, { visible: true });
      const localized = gallery.items.find(item => item.id === reference.templateId);
      assert(localized, 'The selected template must be present in the localized gallery');
      assert.equal(await page.$eval(`${preview} h2`, node => node.textContent), localized.title);
      await page.waitForFunction(selector => Boolean(document.querySelector(selector)
        ?.querySelector('[aria-label="Template instruction"] p, [aria-label="Template recreation instruction"] p')?.textContent?.trim()), {}, preview);
      if (theme === 'light') {
        await page.waitForFunction(selector => {
          const video = document.querySelector(selector + ' video');
          return video && video.readyState >= 2 && video.currentTime > 0;
        }, { timeout: 60_000 }, preview);
        check('reference video loads and its playback clock advances');
      }
      const guide = await page.waitForFunction(selector => {
        const detail = document.querySelector(selector);
        return detail?.querySelector('button[aria-label="View motion.md guide"]')
          ?? [...detail?.querySelectorAll('details summary') ?? []].find(node => node.textContent.trim() === 'Motion guide');
      }, {}, preview);
      await guide.asElement().click();
      const frameElement = await page.waitForSelector(`${preview} :is(iframe[title="Motion guide"], iframe[title="Interactive walkthrough"])`);
      await frameElement.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const frame = await frameElement.contentFrame();
      await frame.waitForFunction(() => document.body?.innerText.trim().length > 10);
      assert.equal(await frame.evaluate(() => window.origin), 'null', 'Adapted guides must keep an opaque sandbox origin');
      await page.screenshot({ path: path.join(output, `${theme}-${width}-detail-guide.png`) });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The page must fit the viewport');
      check('gallery search, detail and HTML guide render', { theme, width, height });
    }
    await page.setViewport({ width: 1440, height: 1000 });
    const builtin = new URL(opened.previewUrl); builtin.searchParams.set('template', 'product-promo');
    await page.goto(builtin.href, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${preview}[open] h2`, { visible: true });
    const action = await page.waitForFunction(selector => [...document.querySelectorAll(selector + ' button')].find(node => node.textContent.trim() === 'Open and edit' && !node.disabled), {}, preview);
    await action.asElement().click();
    await page.waitForFunction(() => Number(document.querySelector('[data-timeline-element-count]')?.getAttribute('data-timeline-element-count')) > 0, { timeout: 90_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('hyperframes-player')].some(player => player.ready && player.painted && player.iframeElement?.contentDocument?.querySelector('[data-composition-id]')), { timeout: 60_000 });
    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="Play"]');
      return button && !button.disabled && !button.closest('[inert]');
    });
    await page.click('button[aria-label="Play"]');
    await page.waitForSelector('button[aria-label="Pause"]');
    await page.waitForFunction(() => [...document.querySelectorAll('hyperframes-player')].some(player => player.currentTime >= 4 && player.iframeElement?.contentDocument?.body?.innerText.includes('Design without limits')), { timeout: 30_000 });
    await page.click('button[aria-label="Pause"]');
    const projectId = new URL(page.url()).searchParams.get('project');
    assert(projectId && projectId !== 'project', 'Open and edit must create an independent project');
    const project = await call('openmotion_get_project', { projectId });
    assert.equal(project.projectId, projectId);
    await page.screenshot({ path: path.join(output, 'opened-editable-template.png') });
    const playbackSeconds = await page.$eval('hyperframes-player', player => player.currentTime);
    check('Open and edit creates an independent project with real playback and a populated timeline', { projectId, playbackSeconds });
    assert.deepEqual(failedSources, []);
    assert.deepEqual(errors, []);
    result.status = 'passed';
    return result;
  } catch (error) {
    result.status = 'failed'; result.error = error.stack;
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
      result.page = await page.evaluate(() => ({ url: location.href, text: document.body.innerText,
        players: [...document.querySelectorAll('hyperframes-player')].map(player => ({ ready: player.ready, painted: player.painted, src: player.iframeElement?.src, text: player.iframeElement?.contentDocument?.body?.innerText })) })).catch(() => null);
      result.frames = page.frames().map(frame => frame.url());
    }
    throw error;
  } finally {
    result.errors = errors; result.failedSources = failedSources; result.browserEvents = browserEvents;
    await browser?.close();
    await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  }
}
