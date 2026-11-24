// Run after build:studio with node --experimental-strip-types --test tests/studio-responsive-browser.ts.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import puppeteer, { type Page } from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { scenarioRunsFor } from '../gateway/scenario-runs.ts';
import { gatewayFor } from '../gateway/service.ts';
import { startServer } from '../server.ts';
import { editorProjectIdFromPath } from '../shared/spa-routes.ts';
import { fixture } from './fixtures.ts';
import { mediaBytes } from './media-fixtures.ts';

async function checkCreator(page: Page, stacked: boolean) {
  const geometry = await page.$eval('.om-creator-pane', pane => {
    const button = pane.querySelector<HTMLButtonElement>('.om-asset-direct > button.om-button')!;
    const range = document.createRange();
    range.selectNodeContents(button);
    const bounds = button.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(button).paddingInline);
    const lines = Array.from(range.getClientRects());
    const [provider, model] = Array.from(pane.querySelectorAll('.om-generation-picker [role="combobox"]'), el => el.getBoundingClientRect());
    return {
      textFits: lines.length > 0 && lines.every(line => line.left >= bounds.left + padding - 1 && line.right <= bounds.right - padding + 1 && line.top >= bounds.top && line.bottom <= bounds.bottom),
      stacked: model.top >= provider.bottom && Math.abs(model.left - provider.left) < 1,
      aligned: model.left >= provider.right && Math.abs(model.bottom - provider.bottom) < 1,
    };
  });
  assert.ok(geometry.textFits, 'Every line of the provider setup action fits inside the button');
  assert.ok(stacked ? geometry.stacked : geometry.aligned, 'The model controls respond to the width of the creator pane');
}

test('Explore is home and project navigation stays in the workspace', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('motion.studio.locale', 'en');
        localStorage.setItem('motion.workspace.navigation.v1', 'collapsed');
        localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme: 'system' }));
      });
      const origin = (await running.info()).previewUrl;
      await page.goto(new URL('/', origin).href, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.om-explore-host:not([hidden])');
      await page.waitForFunction(() => location.pathname === '/explore');
      assert.equal(editorProjectIdFromPath(new URL(page.url()).pathname), null);
      for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
        await page.setViewport({ width, height: 800 });
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
        await page.waitForFunction(theme => (document.documentElement.dataset.theme === 'paper') === (theme === 'light'), {}, theme);
        assert.equal(await page.$('.om-project-navigation'), null);
        const trigger = await page.waitForSelector('.om-app-header-actions .om-account-trigger', { visible: true });
        const anchor = (await trigger!.boundingBox())!;
        assert.ok(anchor.x + anchor.width <= width && anchor.x > width - 80);
        await trigger!.click();
        const popup = await page.waitForSelector('.om-account-menu', { visible: true });
        const bounds = (await popup!.boundingBox())!;
        assert.ok(bounds.y >= anchor.y + anchor.height - 1 && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.om-account-menu', { hidden: true });
        const galleryTitleStyles = [];
        for (const [name, closeSelector, titleSelector] of [
          ['Templates', '[data-workspace-gallery] button[aria-label="Close template library"]', '[data-workspace-gallery] .om-gallery-page-label'],
          ['Skills', '.om-skills-heading-actions button[aria-label="Close"]', '.om-skills-intro h1'],
        ]) {
          const shortcut = await page.waitForSelector(`.om-explore-nav ::-p-text(${name})`, { visible: true });
          const shortcutBounds = (await shortcut!.boundingBox())!;
          assert.ok(shortcutBounds.x >= 0 && shortcutBounds.x + shortcutBounds.width <= width);
          assert.equal(await shortcut!.evaluate(element => getComputedStyle(element).borderTopWidth), '0px');
          await shortcut!.focus();
          await page.keyboard.press('Enter');
          const close = await page.waitForSelector(closeSelector, { visible: true });
          if (name === 'Templates') assert.equal(await page.$('[data-workspace-gallery] .om-gallery-header-actions a[href*="github.com"]'), null);
          galleryTitleStyles.push(await page.$eval(titleSelector, element => {
            const { color, fontFamily, fontSize, fontWeight, letterSpacing, lineHeight } = getComputedStyle(element);
            return { color, fontFamily, fontSize, fontWeight, letterSpacing, lineHeight };
          }));
          const closeBounds = (await close!.boundingBox())!;
          assert.ok(closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= width);
          await close!.focus();
          await page.keyboard.press('Enter');
          await page.waitForSelector('.om-explore-nav', { visible: true });
          assert.ok(await shortcut!.evaluate(element => element === document.activeElement));
        }
        assert.deepEqual(galleryTitleStyles[0], galleryTitleStyles[1]);
      }
      await page.setViewport({ width: 1440, height: 800 });
      await page.click('.om-app-header [aria-label="Motion Studio"]');
      await page.waitForSelector('main[aria-label="Motion templates"]', { visible: true });
      assert.equal(await page.$('.om-project-navigation'), null);
      const openEditor = await page.waitForSelector('.om-studio-landing-hero button:not(:disabled)', { visible: true });
      await openEditor!.click();
      await page.waitForSelector('.motion-timeline-icon-controls', { visible: true });
      await page.waitForSelector('.om-project-navigation:not([inert])', { visible: true });
      const editorUrl = page.url();
      await page.click('.om-app-brand');
      await page.waitForSelector('.om-explore-host:not([hidden])');
      assert.equal(await page.$('.om-project-navigation'), null);
      await page.goBack();
      await page.waitForSelector('.motion-timeline-icon-controls', { visible: true });
      assert.equal(
        editorProjectIdFromPath(new URL(page.url()).pathname),
        editorProjectIdFromPath(new URL(editorUrl).pathname),
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.motion-timeline-icon-controls', { visible: true });
      assert.ok(await page.waitForSelector('.om-project-navigation:not([inert])', { visible: true }));
    } finally { await browser.close(); await running.close(); }
  });
});

test('Narrow workflows keep rounded card corners and scroll the full form', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('motion.studio.locale', 'zh-CN');
        localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme: 'system' }));
      });
      const url = new URL('/?page=scenario&scenario=motion-full-chain', (await running.info()).previewUrl);
      for (const [width, height, theme] of [[390, 740, 'light'], [695, 763, 'dark'], [899, 730, 'light']] as const) {
        await page.setViewport({ width, height });
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.om-scenario-card-footer', { visible: true });
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.$eval('.om-scenario-workbench', card => {
          const { left, right, top } = card.getBoundingClientRect();
          return [left + 2, right - 2].every(x => !card.contains(document.elementFromPoint(x, top + 2)));
        }), `The card header stays inside the rounded corners at ${width}px`);
        assert.ok(await page.evaluate(() => {
          const form = document.querySelector('.om-scenario-step-frame')!.getBoundingClientRect();
          const footer = document.querySelector('.om-scenario-card-footer')!.getBoundingClientRect();
          return form.bottom <= footer.top + 1;
        }), `The footer follows the entire form at ${width}px`);

        await page.mouse.move(width - 30, height - 60);
        await page.mouse.wheel({ deltaY: height * 2 });
        await page.waitForFunction(() => {
          const body = document.querySelector('.om-scenario-body')!;
          const footer = document.querySelector('.om-scenario-card-footer')!;
          return body.scrollTop > 0 && footer.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom;
        }, { timeout: 5_000 });
        await page.click('.om-scenario-primary-cta');
        await page.waitForSelector('[data-step-frame="storyboard"]');
      }
    } finally { await browser.close(); await running.close(); }
  });
});

test('Workflow asset cards keep audio controls inside the thumbnail', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const source = path.join(store.directory, 'track.mp3');
    await writeFile(source, await mediaBytes('audio'));
    const asset = await new AssetLibrary(store).importFile(source, { requestId: 'audio-card-asset', name: 'Track' });
    const { run } = await scenarioRunsFor(store).create({ requestId: 'audio-card-run', scenarioId: 'motion-full-chain' });
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const origin = (await running.info()).previewUrl;
      const response = await fetch(new URL('/motion-api/phase1/call', origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: new URL(origin).origin },
        body: JSON.stringify({
          name: 'openmotion_assets_use',
          arguments: {
            action: 'scenario',
            scenario: {
              command: 'add_pool',
              runId: run.id,
              expectedRevision: run.revision,
              requestId: 'audio-card-pool',
              items: [{ ref: { type: 'asset', assetId: asset.id, versionId: asset.currentVersionId }, source: 'upload' }],
            },
          },
        }),
      });
      assert.equal(response.status, 200, await response.text());
      const page = await browser.newPage();
      const url = new URL(`/?page=scenario&scenario=motion-full-chain&run=${run.id}`, origin);
      for (const [width, theme] of [[390, 'light'], [761, 'dark'], [1440, 'dark']] as const) {
        await page.setViewport({ width, height: 760 });
        await page.emulateMediaFeatures([
          { name: 'prefers-color-scheme', value: theme },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ]);
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        const toggleSelector = width >= 1100 ? '.om-scenario-pool-desktop-toggle' : '.om-scenario-pool-toggle';
        const toggle = await page.waitForSelector(toggleSelector, { visible: true, timeout: 5000 });
        if (await toggle!.evaluate(button => button.getAttribute('aria-expanded')) === 'false') await toggle!.click();
        await page.waitForSelector('.om-scenario-thumb--audio audio', { visible: true });
        await page.waitForFunction(() => {
          const audio = document.querySelector<HTMLAudioElement>('.om-scenario-thumb--audio audio');
          return audio && Number.isFinite(audio.duration);
        });
        assert.ok(await page.$eval('.om-scenario-pool-card[data-kind="audio"]', card => {
          const player = card.querySelector<HTMLAudioElement>('audio')!;
          const bounds = player.getBoundingClientRect();
          const preview = card.querySelector('.om-scenario-thumb--audio')!.getBoundingClientRect();
          const details = card.querySelector('.om-scenario-pool-card-body')!.getBoundingClientRect();
          return player.controls && bounds.height > 0 && bounds.top >= preview.top
            && bounds.left >= preview.left && bounds.right <= preview.right
            && bounds.bottom <= preview.bottom && bounds.bottom <= details.top;
        }), `The player and timestamps fit inside the audio card at ${width}px`);
      }
    } finally { await browser.close(); await running.close(); }
  });
});

test('Design template details keep the project tooltip and clipboard fallback inside the dialog', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('motion.studio.locale', 'en');
        localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme: 'system' }));
        navigator.clipboard.writeText = async text => {
          document.documentElement.dataset.copyAttempt = text;
          throw new Error('Clipboard access denied');
        };
      });
      const scene = new URL('/design/prototype', (await running.info()).previewUrl).href;
      const dialog = '.om-design-tpl-detail-popup';
      const remix = `${dialog} button[aria-label="Remix into project"]`;
      const recreate = `${dialog} .om-media-detail-action-row button[data-primary]`;
      const tooltip = `${dialog} [role="tooltip"]`;
      const manualCopy = `${dialog} textarea[aria-label="Content to copy"]`;
      const title = `${dialog} .om-media-detail-title`;

      for (const [theme, width] of [['dark', 1400], ['light', 600]] as const) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
        await page.setViewport({ width, height: 900 });
        await page.goto(scene, { waitUntil: 'domcontentloaded' });
        await page.locator('.om-design-gallery-card .om-design-card-open').setTimeout(5000).click();
        const selectedTemplate = await page.$eval(title, heading => heading.textContent);

        await page.locator(remix).setTimeout(5000).hover();
        await page.waitForSelector(tooltip, { visible: true, timeout: 5000 });
        assert.equal(await page.$eval(tooltip, hint => hint.textContent), 'Remix into project');
        await page.mouse.move(8, 8);
        await page.waitForSelector(tooltip, { hidden: true, timeout: 5000 });
        await page.focus(recreate);
        await page.keyboard.press('Tab');
        await page.waitForFunction(selector => document.activeElement?.matches(selector), { timeout: 5000 }, remix);
        await page.waitForSelector(tooltip, { visible: true, timeout: 5000 });

        await page.locator(recreate).setTimeout(5000).click();
        await page.waitForSelector(manualCopy, { visible: true, timeout: 5000 });
        assert.ok(await page.$eval(manualCopy, field => field.readOnly
          && field.value === document.documentElement.dataset.copyAttempt
          && field.value.includes('velar-luxury-real-estate')));
        await page.waitForFunction(selector => {
          const field = document.querySelector<HTMLTextAreaElement>(selector);
          return field && field === document.activeElement && field.selectionEnd > field.selectionStart;
        }, { timeout: 5000 }, manualCopy);
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.$eval(title, heading => heading.textContent), selectedTemplate);
        const firstLine = await page.$eval(manualCopy, field => {
          const { left, top } = field.getBoundingClientRect();
          const style = getComputedStyle(field);
          return { x: left + field.clientLeft + parseFloat(style.paddingLeft) + 2,
            y: top + field.clientTop + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 };
        });
        await page.mouse.move(firstLine.x, firstLine.y);
        await page.mouse.down();
        await page.mouse.move(firstLine.x + 60, firstLine.y, { steps: 6 });
        await page.mouse.up();
        assert.ok(await page.$eval(manualCopy, field => document.activeElement === field && field.selectionEnd > field.selectionStart));
        await page.waitForSelector(`${dialog} [role="alert"]`, { visible: true, timeout: 5000 });
        assert.equal(page.url(), scene);

        await page.evaluate(() => { navigator.clipboard.writeText = async () => {}; });
        await page.focus(recreate);
        await page.keyboard.press('Enter');
        await page.waitForSelector(manualCopy, { hidden: true, timeout: 5000 });
        await page.waitForSelector(`${dialog} [role="status"]`, { visible: true, timeout: 5000 });
        assert.equal(await page.$eval(title, heading => heading.textContent), selectedTemplate);
      }
    } finally { await browser.close(); await running.close(); }
  });
});

test('Studio controls fit their resizable generator and timeline panes', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [];
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('motion.studio.locale', 'en');
        localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme: 'system' }));
      });
      await page.setViewport({ width: 1280, height: 800 });
      const url = new URL('/cinema/text-to-video', (await running.info()).previewUrl);
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.om-creator-pane .om-asset-direct > button.om-button', { visible: true });
      await page.evaluate(() => document.fonts.ready);
      for (const menuLabel of ['Image · Scenes', 'Video · Scenes', 'Audio · Scenes', 'Generate with Open Design MCP']) {
        const split = '.om-creative-split:has(> [aria-label="' + menuLabel + '"])';
        const popup = '[role="dialog"][aria-label="' + menuLabel + '"]';
        await page.hover(split + ' > .om-nav-row-link');
        await page.waitForSelector(popup, { visible: true });
        await page.hover(split + ' > .om-nav-row-action');
        await page.hover(split + ' > .om-nav-row-link');
        await page.hover(popup + ' button');
        assert.ok(await page.$eval(popup, el => el.matches(':hover')), 'The menu stays open when moving from the label into it');
      }
      await page.mouse.move(5, 750);
      await page.waitForSelector('.om-creative-client-menu', { hidden: true });
      assert.equal(new URL(page.url()).pathname, '/cinema/text-to-video', 'Hovering a destination preserves the current Studio');
      const divider = await page.waitForSelector('.om-creator-pane [role="separator"]');
      for (const [key, width] of [['Home', 310], ['End', 650]] as const) {
        await divider!.press(key);
        await page.waitForFunction(width => document.querySelector('.om-creator-pane [role="separator"]')?.getAttribute('aria-valuenow') === String(width), {}, width);
        await checkCreator(page, key === 'Home');
      }
      await page.setViewport({ width: 320, height: 690 });
      await page.waitForFunction(() => document.querySelector('.om-creator-pane')!.getBoundingClientRect().width <= innerWidth);
      await checkCreator(page, true);
      assert.ok(await page.$eval('.om-studio-bar', bar => {
        const back = bar.querySelector('.om-studio-back')!.getBoundingClientRect();
        const scenes = bar.querySelector('nav')!.getBoundingClientRect();
        return back.bottom <= scenes.top;
      }), 'The mobile Studio header keeps its return action above the scenes');
      const imageNav = '.om-creative-strip > [data-nav-slot]:not([data-stowed]) .om-creative-split:has(> [aria-label="Image · Scenes"])';
      await page.waitForSelector('.om-creative-navigation[data-compact-actions]');
      for (const scheme of ['dark', 'light'] as const) {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
        await page.waitForSelector(imageNav + ' > .om-nav-row-link', { visible: true });
        await page.click(imageNav + ' > .om-nav-row-link');
        await page.waitForFunction(() => location.pathname === '/create/text-to-image');
        await page.waitForSelector('.om-creative-menu', { hidden: true });
        await page.waitForSelector('.om-generation-pickers [aria-label="Generation model"]', { visible: true });
        await page.mouse.move(5, 675);
        await page.focus(imageNav + ' > .om-nav-row-link');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Image · Scenes');
        await page.keyboard.press('Enter');
        const menu = await page.waitForSelector('.om-creative-menu', { visible: true });
        assert.ok(await menu!.evaluate(el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth));
        await page.keyboard.press('Escape');
        await page.waitForSelector('.om-creative-menu', { hidden: true });
        await page.goBack();
        await page.waitForFunction(() => location.pathname === '/cinema/text-to-video');
      }
      const more = await page.waitForSelector('::-p-aria([name="More Studio"][role="button"])', { visible: true });
      await more!.focus();
      await page.keyboard.press('Enter');
      const folder = await page.waitForSelector('.om-nav-more-panel [aria-label="Workspace assets"]', { visible: true });
      assert.ok(await folder!.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      }), 'The assets shortcut fits inside the narrow navigation menu');
      await folder!.click();
      await page.waitForFunction(() => location.pathname === '/assets');
      await page.goBack();
      await page.waitForFunction(() => location.pathname === '/cinema/text-to-video');
      await page.setViewport({ width: 320, height: 690, hasTouch: true });
      await page.waitForSelector(imageNav);
      await page.tap(imageNav + ' > .om-nav-row-action');
      await page.waitForSelector('.om-creative-menu', { visible: true });
      await page.tap(imageNav + ' > .om-nav-row-link');
      await page.waitForFunction(() => location.pathname === '/create/text-to-image');
      await page.waitForSelector('.om-creative-menu', { hidden: true });
      await page.goto(new URL('/editor', url).href, { waitUntil: 'domcontentloaded' });
      const toolbar = await page.waitForSelector('.motion-timeline-icon-controls', { visible: true });
      assert.ok(await toolbar!.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll('button, input')).filter(control => control.getClientRects().length).every(control => {
          const box = control.getBoundingClientRect();
          return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
        });
      }), 'All timeline controls fit at the narrowest viewport');
    } finally {
      await browser.close();
      await running.close();
      await gateway.close();
    }
  });
});

test('Explore fills every gallery row and plays the featured artwork in place', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [];
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
      const items = Array.from({ length: 10 }, (_, i) => ({ id: 'work-' + i, title: 'Work ' + i, description: 'A product reveal.', kind: 'builtin', tags: [], uses: ['Product launch', 'Partnership announcement'], industries: ['AI & technology', 'Design tools'] }));
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (new URL(request.url()).pathname.endsWith('/template-catalog')) {
          void request.respond({ contentType: 'application/json', body: JSON.stringify({ offset: 0, items, next: null }) });
        } else void request.continue();
      });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      const url = new URL('/explore', (await running.info()).previewUrl);
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.om-feed-group [data-template-id]');
      await page.evaluate(() => document.fonts.ready);
      for (const [width, expectedCards] of [[1512, 8], [1280, 8], [1060, 6], [760, 4], [320, 2]]) {
        await page.setViewport({ width, height: 850 });
        const rowsFill = await page.$eval('.om-feed-group', feed => {
          const bounds = feed.getBoundingClientRect();
          const cards = Array.from(feed.children, card => card.getBoundingClientRect());
          if (getComputedStyle(feed).overflowX === 'auto') {
            return feed.scrollWidth > feed.clientWidth && cards.every(card => card.top === cards[0].top);
          }
          return cards.every((card, index) => {
            const previous = cards[index - 1], next = cards[index + 1];
            const startsRow = !previous || previous.top !== card.top;
            const endsRow = !next || next.top !== card.top;
            return (!startsRow || Math.abs(card.left - bounds.left) < 1) && (!endsRow || Math.abs(card.right - bounds.right) < 1);
          });
        });
        assert.ok(rowsFill, 'Gallery rows follow reading order and fill the available width at ' + width);
        const shelves = await page.$$eval('.om-explore-shelf .om-explore-preview-grid', grids => grids.map(grid => {
          const bounds = grid.getBoundingClientRect();
          const cards = Array.from(grid.children).filter(card => card.getClientRects().length).map(card => card.getBoundingClientRect());
          const rows = new Map<number, DOMRect[]>();
          for (const card of cards) {
            const key = [...rows.keys()].find(top => Math.abs(top - card.top) < 2) ?? card.top;
            rows.set(key, [...(rows.get(key) ?? []), card]);
          }
          const full = [...rows.values()].every(row => Math.abs(row[0].left - bounds.left) < 2 && Math.abs(row.at(-1)!.right - bounds.right) < 2);
          return { count: cards.length, rows: rows.size, full };
        }));
        assert.deepEqual(shelves, [
          { count: expectedCards, rows: 2, full: true },
          { count: expectedCards, rows: 2, full: true },
        ], 'Template and Skill previews fit two complete rows at ' + width);
        const studios = await page.$$eval('.om-studio-collection', sections => sections.map(section => {
          const grid = section.querySelector<HTMLElement>('.om-studio-collection-cards')!;
          const bounds = grid.getBoundingClientRect();
          const cards = Array.from(grid.children).filter(card => card.getClientRects().length).map(card => card.getBoundingClientRect());
          if (getComputedStyle(grid).overflowX === 'auto') {
            return { studio: section.getAttribute('data-studio'), rail: true, full: cards.length > 0 && cards.every(card => Math.abs(card.top - cards[0].top) < 2) };
          }
          const rows = new Map<number, DOMRect[]>();
          for (const card of cards) {
            const key = [...rows.keys()].find(top => Math.abs(top - card.top) < 2) ?? card.top;
            rows.set(key, [...(rows.get(key) ?? []), card]);
          }
          const rowLists = [...rows.values()];
          const full = rowLists.every(row => row.length === rowLists[0].length && Math.abs(row[0].left - bounds.left) < 2 && Math.abs(row.at(-1)!.right - bounds.right) < 2);
          return { studio: section.getAttribute('data-studio'), count: cards.length, rows: rowLists.length, full };
        }));
        assert.ok(studios.length === 8 && studios.every(item => item.full), 'Every Studio collection renders complete rows at ' + width + ': ' + JSON.stringify(studios));
        const toolbarGeometry = await page.$eval('.om-explore-shelf[aria-label="Templates"]', section => {
          const submit = section.querySelector<HTMLAnchorElement>('header a[href*="CONTRIBUTING.md"]');
          const dropdown = section.querySelector<HTMLButtonElement>('.om-shelf-toolbar .om-gallery-dropdown');
          const strip = section.querySelector<HTMLElement>('.om-shelf-toolbar .om-category-strip');
          const dr = dropdown?.getBoundingClientRect();
          const sr = strip?.getBoundingClientRect();
          return {
            hasSubmit: Boolean(submit),
            dropdownSingleLine: Boolean(dr && dr.height <= 40 && dr.right <= innerWidth + 1 && dropdown!.scrollWidth <= dropdown!.clientWidth + 1),
            noHorizontalOverflow: document.querySelector('.om-explore')!.scrollWidth <= document.querySelector('.om-explore')!.clientWidth + 1,
            stripFits: Boolean(sr && sr.left >= 0 && sr.right <= innerWidth + 1),
          };
        });
        assert.deepEqual(toolbarGeometry, { hasSubmit: true, dropdownSingleLine: true, noHorizontalOverflow: true, stripFits: true }, 'Template shelf controls fit on one line at ' + width);
        if (width === 320) {
          const strip = '.om-explore-shelf[aria-label="Templates"] .om-category-strip';
          await page.waitForSelector(strip + ' button[aria-label^="Next"]:enabled');
          assert.equal(await page.$(strip + ' [data-edge="left"]'), null);
          assert.equal(await page.$eval(strip + '-viewport', list => getComputedStyle(list).scrollbarWidth), 'none');
          await page.click(strip + ' button[aria-label^="Next"]');
          await page.waitForFunction(selector => document.querySelector(selector)!.scrollLeft > 0, {}, strip + '-viewport');
          await page.waitForSelector(strip + ' button[aria-label^="Previous"]:enabled');
          await page.$eval(strip + '-viewport', list => { list.scrollLeft = list.scrollWidth; });
          await page.waitForSelector(strip + ' [data-edge="right"]', { hidden: true });
          await page.click(strip + ' [data-edge="left"]');
          await page.waitForSelector(strip + ' [data-edge="right"]');
        }
        const hero = (await page.$('.om-feature-carousel'))!;
        const initialHeight = await hero.evaluate(element => element.getBoundingClientRect().height);
        for (const indicator of await hero.$$('.om-media-segments button')) {
          await indicator.click();
          assert.equal(await hero.evaluate(element => element.getBoundingClientRect().height), initialHeight);
        }
      }
      const rail = '.om-highlights';
      const next = rail + ' [data-edge="right"]', previous = rail + ' [data-edge="left"]';
      await page.waitForSelector(next);
      assert.equal(await page.$(previous), null);
      assert.equal(await page.$eval('.om-stories-rail', list => getComputedStyle(list).scrollbarWidth), 'none');
      await page.click(next);
      await page.waitForSelector(previous);
      assert.ok(await page.$(next), 'Both directions are available between the ends');
      await page.$eval('.om-stories-rail', list => { list.scrollLeft = list.scrollWidth; });
      await page.waitForSelector(next, { hidden: true });
      await page.click(previous);
      await page.waitForSelector(next);
      const artwork = '.om-feature-slide[aria-hidden="false"] .om-feature-camera';
      const cameraState = () => page.$eval(artwork, camera => getComputedStyle(camera).animationPlayState);
      assert.equal(await cameraState(), 'paused', 'Reduced motion starts with a still frame');
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      const segments = await page.$$('.om-media-segments button');
      for (const segment of segments) {
        await segment.click();
        await segment.evaluate(element => (element as HTMLButtonElement).blur());
        const start = await page.$eval(artwork, camera => getComputedStyle(camera).transform);
        await page.waitForFunction((selector, start) => getComputedStyle(document.querySelector(selector)!).transform !== start, {}, artwork, start);
        const scene = await page.$eval('.om-feature-carousel', hero => hero.getAttribute('data-scene'));
        if (scene !== 'black-friday' && scene !== 'hub-gemini-4') {
          await page.waitForFunction(selector => (document.querySelector(selector)?.querySelector('video')?.currentTime ?? 0) > 0.1, {}, artwork);
        }
      }
      await page.focus('.om-media-segments [aria-current]');
      assert.equal(await cameraState(), 'paused');
      assert.ok(await page.$eval(artwork + ' video', video => (video as HTMLVideoElement).paused));
    } finally {
      await browser.close();
      await running.close();
      await gateway.close();
    }
  });
});

test('Sound Studio previews and seeks the welcome track in both wide and compact layouts', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [];
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('motion.studio.locale', 'en');
        localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme: 'system' }));
      });
      const url = new URL('/sound/music', (await running.info()).previewUrl);
      for (const [width, theme] of [[1280, 'dark'], [390, 'light']] as const) {
        await page.setViewport({ width, height: 800 });
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        if (width < 800) {
          const guide = '.om-assets-view-switch button:first-child';
          await page.waitForSelector(guide, { visible: true });
          await page.click(guide);
        }
        const player = '.om-scene-audio';
        await page.waitForSelector(player + ' input[type="range"]:enabled', { visible: true });
        assert.ok(await page.$eval(player, panel => panel.scrollWidth <= panel.clientWidth && panel.querySelector('audio')!.paused));
        await page.click(player + ' [aria-label="Play"]');
        await page.waitForFunction(() => (document.querySelector<HTMLAudioElement>('.om-scene-audio audio')?.currentTime ?? 0) > 0);
        await page.click(player + ' [aria-label="Pause"]');
        await page.click('.motion-waveform-seek input');
        await page.waitForFunction(() => {
          const audio = document.querySelector<HTMLAudioElement>('.om-scene-audio audio');
          return audio && audio.paused && audio.currentTime > audio.duration * 0.4;
        });
      }
    } finally {
      await browser.close();
      await running.close();
      await gateway.close();
    }
  });
});

test('Sound Studio home shows the banner and templates and plays a template without a creator', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [];
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
      const url = new URL('/sound', (await running.info()).previewUrl);
      for (const width of [1280, 390]) {
        await page.setViewport({ width, height: 800 });
        await page.goto(url.href, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.om-audio-landing .om-specialty-feature', { visible: true });
        assert.equal(await page.$('.om-studio-bar, .om-canvas-dock, .om-creator-pane'), null);
        assert.ok(await page.$$eval('.om-audio-card', cards => cards.length) >= 6);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.click('.om-audio-landing .om-specialty-feature');
        await page.waitForFunction(() => (document.querySelector<HTMLAudioElement>('.om-audio-landing audio')?.currentTime ?? 0) > 0);
        await page.click('.om-audio-landing .om-specialty-feature');
        await page.waitForFunction(() => document.querySelector<HTMLAudioElement>('.om-audio-landing audio')?.paused);
      }
    } finally {
      await browser.close();
      await running.close();
      await gateway.close();
    }
  });
});

test('the opt-in UI inspector outlines component roots, excludes its own controls and follows a modal', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      const url = new URL('/explore', (await running.info()).previewUrl);
      await page.goto(url.href);
      await page.waitForSelector('[data-odui-component="button"]');
      assert.equal(await page.$('.odui-inspector'), null);
      url.searchParams.set('debug', 'ui');
      await page.goto(url.href);
      await page.waitForSelector('.odui-inspector-launcher', { visible: true });
      await page.click('.odui-inspector-launcher');
      const row = '.odui-inspector-row';
      await page.click(row);
      assert.equal(await page.$eval('[data-odui-component="button"]:not(.odui-inspector *)', el => getComputedStyle(el).outlineStyle), 'solid');
      await page.waitForFunction(() =>
        Number(document.querySelector('.odui-inspector-row .odui-count')?.textContent) ===
        document.querySelectorAll('button[data-odui-component="button"]:not(.odui-inspector *)').length);
      await page.evaluate(() => {
        const dialog = document.createElement('dialog');
        dialog.id = 'inspector-test';
        dialog.innerHTML = '<button>Native</button><div data-odui-component="slider"><input type="range"></div>';
        document.body.append(dialog);
        dialog.showModal();
      });
      await page.waitForSelector('#inspector-test .odui-inspector:popover-open');
      await page.click(row + ':has(.native)');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#inspector-test > button')!).outlineStyle === 'dashed');
      await page.click(row + ':last-child');
      assert.notEqual(await page.$eval('#inspector-test input', el => getComputedStyle(el).outlineStyle), 'dashed');
      await page.click('.odui-inspector-bar button:last-child');
      assert.equal(await page.$('.odui-inspector'), null);
      assert.notEqual(await page.$eval('#inspector-test > button', el => getComputedStyle(el).outlineStyle), 'dashed');
    } finally { await browser.close(); await running.close(); }
  });
});

test('legacy query bookmarks redirect in place to canonical semantic paths and preserve orthogonal params', { timeout: 60_000 }, async () => {
  await fixture(async store => {
    const running = await startServer(store, 0, { editor: false });
    const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'en'));
      const origin = (await running.info()).previewUrl;
      const cases = [
        ['/?page=cinema&scene=text-to-video&embed=1', '/cinema/text-to-video', 'embed=1'],
        ['/?page=settings&section=providers&embed=1', '/settings/providers', 'embed=1'],
        ['/?page=mcp&host=claude&setup=manual', '/mcp-setup', 'host=claude'],
        ['/?page=assets&embed=1', '/assets', 'embed=1'],
        ['/?page=explore&community=product-films', '/explore', 'community=product-films'],
      ] as const;
      for (const [legacyHref, expectedPath, expectedQuery] of cases) {
        await page.goto(new URL(legacyHref, origin).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(path => location.pathname === path, { timeout: 15_000 }, expectedPath);
        const current = new URL(page.url());
        assert.equal(current.pathname, expectedPath);
        assert.ok(current.search.includes(expectedQuery), `expected ${current.href} to preserve ${expectedQuery}`);
      }
    } finally { await browser.close(); await running.close(); }
  });
});
