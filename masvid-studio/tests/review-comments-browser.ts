// Run after build:studio. Uses an isolated workspace and real browser/editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer, { type HTTPRequest, type Page } from 'puppeteer-core';
import { fixture } from './fixtures.ts';
import { startServer } from '../server.ts';
import { reviewComments } from '../review-comments.ts';

const output = path.join(tmpdir(), 'openmotion-review-comments-evidence');
async function button(page: Page, label: string) {
  await page.waitForFunction(label => [...document.querySelectorAll<HTMLButtonElement>('button')].some(button =>
    (button.getAttribute('aria-label') || button.textContent?.trim()) === label && button.checkVisibility() && !button.closest('[inert]') && !button.disabled), {}, label);
  const handle = await page.evaluateHandle(label => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    (button.getAttribute('aria-label') || button.textContent?.trim()) === label && button.checkVisibility() && !button.closest('[inert]') && !button.disabled), label);
  assert(handle.asElement(), `Button unavailable: ${label}`);
  await (handle.asElement() as any).asLocator().click(); await handle.dispose();
}
async function menuItem(page: Page, label: string) {
  await page.waitForFunction(label => [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].some(node => node.textContent?.trim() === label && node.checkVisibility()), {}, label);
  const handle = await page.evaluateHandle(label => [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].find(node => node.textContent?.trim() === label && node.checkVisibility()), label);
  assert(handle.asElement(), `Menu item unavailable: ${label}`);
  await (handle.asElement() as any).asLocator().click(); await handle.dispose();
  await page.waitForFunction(() => ![...document.querySelectorAll<HTMLElement>('[role="menu"]')].some(node => node.checkVisibility()));
}
async function previewGeometry(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    let last = '', stable = 0, frames = 0;
    const sample = () => {
      const rect = document.querySelector('[data-preview-pan-surface]')!.getBoundingClientRect();
      const value = [rect.x, rect.y, rect.width, rect.height].join(',');
      stable = value === last ? stable + 1 : 0; last = value;
      if (stable >= 8 || ++frames > 180) resolve(); else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  return page.$eval('[data-preview-pan-surface]', stage => [stage, ...stage.querySelectorAll('[data-testid="preview-zoom-stage"], iframe')].map(node => {
    const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].map(n => Math.round(n));
  }));
}
async function placeComment(page: Page, x = 0.15, y = 0.8) {
  await page.waitForSelector('[data-review-comment-canvas]', { visible: true });
  assert.equal(await page.$('textarea[aria-label="Comment"]'), null, 'Tool activation must not open a composer');
  const before = await previewGeometry(page);
  const box = await (await page.$('[data-review-comment-canvas]'))!.boundingBox(); assert(box);
  await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
  await assertCommentCanvasTransparent(page, 'hover before placing a comment');
  await page.mouse.down();
  await assertCommentCanvasTransparent(page, 'pointer held while placing a comment');
  await page.mouse.up();
  await page.waitForSelector('textarea[aria-label="Comment"]', { visible: true });
  await assertCommentCanvasTransparent(page, 'composer open over the frame');
  assert.deepEqual(await previewGeometry(page), before, 'Opening a comment must not move or resize the player');
  const contained = await page.$eval('[data-review-composer-overlay]', card => {
    const c = card.getBoundingClientRect(), p = card.parentElement!.getBoundingClientRect();
    return c.left >= p.left && c.right <= p.right + 1 && c.top >= p.top && c.bottom <= p.bottom + 1;
  });
  assert(contained, 'Floating composer must stay inside the preview at the viewport edge');
}
async function assertCommentCanvasTransparent(page: Page, state: string) {
  const surface = await page.$eval('[data-review-comment-canvas]', node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, image: style.backgroundImage };
  });
  assert.deepEqual(surface, { background: 'rgba(0, 0, 0, 0)', image: 'none' }, `The frame must remain visible: ${state}`);
}
async function waitText(page: Page, text: string) {
  await page.waitForFunction(text => document.querySelector('section[aria-label="Comments"]')?.textContent?.includes(text), { timeout: 15_000 }, text);
}

async function assertReviewToolStates(page: Page, theme: string) {
  const group = '[data-review-player]';
  for (const label of ['Comment here', 'Draw a comment', 'Review list', 'More review options']) {
    const selector = `${group} button[aria-label="${label}"]`;
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.hover(selector);
    await page.waitForFunction(selector => {
      const button = document.querySelector(selector)!;
      const background = getComputedStyle(button).backgroundColor;
      return background !== 'rgba(0, 0, 0, 0)' && background !== getComputedStyle(button.closest('[data-review-player]')!).backgroundColor;
    }, { timeout: 2000 }, selector);
  }
  await page.screenshot({ path: path.join(output, `review-tool-hover-${theme}.png`) });
  for (const label of ['Comment here', 'Draw a comment']) {
    await button(page, label);
    await page.waitForFunction(label => {
      const button = document.querySelector(`[data-review-player] button[aria-label="${label}"]`)!;
      const group = button.closest('[data-review-player]')!;
      return button.getAttribute('aria-pressed') === 'true' && !button.hasAttribute('disabled')
        && getComputedStyle(button).color !== getComputedStyle(group).color
        && getComputedStyle(button).backgroundColor !== getComputedStyle(group).backgroundColor;
    }, { timeout: 2000 }, label);
    await page.hover(`${group} button[aria-label="${label}"]`);
    await page.screenshot({ path: path.join(output, `review-tool-active-${label === 'Comment here' ? 'comment' : 'pen'}-${theme}.png`) });
    if (label === 'Comment here') {
      // Keyboard users must see the same frame, with a boundary focus indicator.
      await page.keyboard.press('Tab');
      await page.focus('[data-review-comment-canvas]');
      await assertCommentCanvasTransparent(page, `${theme} keyboard focus`);
      assert(await page.$eval('[data-review-comment-canvas]', node => node.matches(':focus-visible')
        && getComputedStyle(node).outlineStyle !== 'none' && parseFloat(getComputedStyle(node).outlineWidth) > 0));
      await page.keyboard.press('Enter');
      await page.waitForSelector('textarea[aria-label="Comment"]', { visible: true });
      await assertCommentCanvasTransparent(page, `${theme} keyboard composer`);
      await button(page, 'Cancel');
      await button(page, 'Comment here');
      await placeComment(page);
      await page.screenshot({ path: path.join(output, `comment-frame-visible-${theme}.png`) });
    }
    await button(page, 'Cancel');
  }
}

async function assertHeaderLayout(page: Page) {
  const issues = await page.evaluate(() => {
    const header = document.querySelector('.motion-studio-header')!;
    const bounds = header.getBoundingClientRect();
    const controls = [...header.querySelectorAll<HTMLElement>('button, input')].filter(node => node.checkVisibility());
    const issues: string[] = [];
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      const label = control.getAttribute('aria-label') || control.textContent;
      if (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom) issues.push(`Clipped: ${label}`);
    }
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push(`Overlapping: ${controls[i].getAttribute('aria-label')} / ${controls[j].getAttribute('aria-label')}`);
    }
    const actions = [...header.querySelectorAll('.motion-header-project-actions button')].map(node => node.getBoundingClientRect());
    if (new Set(actions.map(rect => Math.round(rect.top))).size !== 1) issues.push('Project actions wrap to another row');
    if (header.querySelector('button[aria-label="Comments"]')) issues.push('Review creation must stay in the player');
    return issues;
  });
  assert.deepEqual(issues, [], `Header layout at ${page.viewport()?.width}px`);
}

test('real review workflow preserves element context, clipboard fallback and Agent status across themes and reload', { timeout: 180_000 }, async () => fixture(async store => {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(store.projectDirectory, 'index.html'), `<!doctype html><html><head><script src="assets/gsap.min.js"></script></head><body style="margin:0">
<div id="main" data-composition-id="main" data-start="0" data-duration="6" data-width="640" data-height="360" style="position:relative;width:640px;height:360px;background:#17382f">
<h1 id="heading" data-label="Review heading" data-start="0" data-duration="6" data-track-index="0" style="position:absolute;left:50px;top:90px;color:white;font:48px sans-serif">Make every frame count</h1>
</div><script>const tl=gsap.timeline({paused:true});tl.to('#heading',{x:20,duration:6,ease:'none'});window.__timelines={main:tl};</script></body></html>`);
  const running = await startServer(store, 0, { editor: true });
  const browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  let listRequestCount = 0;
  let commentReads: 'pass' | 'hold' | 'fail' = 'pass';
  const heldReads: HTTPRequest[] = [];
  const readFailure = { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Review service unavailable' }) };
  await page.setRequestInterception(true);
  page.on('request', request => {
    const input = request.url().includes('/phase1/call') && request.postData() ? JSON.parse(request.postData()!) : null;
    if (input?.arguments?.action === 'comments' && input.arguments.operation === 'list') {
      listRequestCount++;
      if (commentReads === 'hold') { heldReads.push(request); return; }
      if (commentReads === 'fail') { void request.respond(readFailure).catch(() => {}); return; }
    }
    void request.continue().catch(() => {});
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('motion.studio.locale', 'en');
      if (!localStorage.getItem('hf-studio-ui-preferences')) localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme: 'light' }));
    });
    const origin = (await running.info()).previewUrl;
    await page.goto(`${origin}/#project/project`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { timeout: 60_000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-timeline-element-count]')?.getAttribute('data-timeline-element-count')) > 0);
    // The header must contain every action, even with a project sidebar and narrow CSS viewport.
    for (const width of [1920, 1440, 1024, 840, 640, 480]) {
      await page.setViewport({ width, height: 900 });
      await assertHeaderLayout(page);
    }
    await page.setViewport({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(output, 'player-entry-light.png') });
    await assertReviewToolStates(page, 'light');
    assert.equal(await page.evaluate(() => document.querySelector<HTMLElement>('section[aria-label="Comments"]')?.checkVisibility() ?? false), false);
    assert(listRequestCount > 0, 'An idle player must load its initial comment badge');
    const idleReads = listRequestCount;
    await new Promise(resolve => setTimeout(resolve, 5500));
    assert.equal(listRequestCount, idleReads, 'An idle preview must not keep scanning the project for comments');
    await button(page, 'Play');
    await new Promise(resolve => setTimeout(resolve, 1200));
    await button(page, 'Pause');
    const beforeComment = await previewGeometry(page);
    await button(page, 'Comment here');
    await placeComment(page);
    assert.deepEqual(await previewGeometry(page), beforeComment);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Comment');
    await page.type('textarea[aria-label="Comment"]', 'Hold this frame a little longer.');
    assert.equal(await page.$eval('textarea[aria-label="Comment"]', el => Boolean(el.closest('[data-review-overlay]'))), true);
    await page.screenshot({ path: path.join(output, 'player-comment-light.png') });
    await button(page, 'Save comment');
    await button(page, 'Review list');
    await waitText(page, 'Hold this frame a little longer.');
    const first = (await reviewComments(store, { action: 'comments', operation: 'list', projectId: 'project' })).comments[0];
    assert(first.anchor.time! > 0.5);

    // Select a real authored timeline element while Comments remains active.
    await page.waitForSelector('button[data-clip="true"]');
    await page.click('button[data-clip="true"]');
    const beforeComment1 = await previewGeometry(page);
    await button(page, 'Comment here');
    await placeComment(page, 0.5, 0.4);
    assert.deepEqual(await previewGeometry(page), beforeComment1);
    await page.type('textarea[aria-label="Comment"]', 'Increase the heading size.');
    await button(page, 'Save comment');
    await waitText(page, 'Increase the heading size.');
    const records = (await reviewComments(store, { action: 'comments', operation: 'list', projectId: 'project' })).comments;
    assert.equal(records.length, 2);
    assert.equal(records[1].anchor.scope, 'element');
    assert.equal(records[1].anchor.element?.domId, 'heading');
    assert.equal(records[1].anchor.element?.sourceFile, 'index.html');
    assert.match(records[1].anchor.element?.text ?? '', /Make every frame count/);
    assert(records[1].anchor.element?.box?.width! > 0);

    await button(page, 'More review options');
    await menuItem(page, 'Comment on the whole video');
    await page.waitForSelector('textarea[aria-label="Comment"]');
    await page.type('textarea[aria-label="Comment"]', 'Keep the overall pacing calm.');
    await button(page, 'Save comment');
    await waitText(page, 'Keep the overall pacing calm.');
    await button(page, 'Choose comments'); await button(page, 'Select all shown');
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard denied'); } } }); });
    await button(page, 'Copy for Agent (3)');
    await page.waitForSelector('textarea[aria-label="Review instruction"]');
    const prompt = await page.$eval('textarea[aria-label="Review instruction"]', el => (el as HTMLTextAreaElement).value);
    assert(prompt.includes(records[1].id) && prompt.includes('expectedCommentRevision'));
    await page.screenshot({ path: path.join(output, 'comments-light.png') });
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { document.documentElement.dataset.copiedReview = text; } } }); });
    await button(page, 'Copy for Agent (3)');
    await page.waitForFunction(() => Boolean(document.documentElement.dataset.copiedReview));
    assert((await page.$eval('html', el => (el as HTMLElement).dataset.copiedReview)).includes(records[1].id));
    await page.waitForFunction(() => document.querySelector('.motion-feedback-layer')?.textContent?.includes('Copied. Paste into your Agent.'));
    await reviewComments(store, { action: 'comments', operation: 'update', projectId: 'project', commentId: first.id, expectedCommentRevision: 1, status: 'resolved', requestId: 'agent-complete' });
    await page.waitForFunction(() => ![...document.querySelectorAll('section[aria-label="Comments"] article')].some(el => el.textContent?.includes('Hold this frame')), { timeout: 12_000 });
    await button(page, 'Filter comments'); await menuItem(page, 'Completed');
    await waitText(page, 'Hold this frame');
    await button(page, 'Reopen');
    await page.waitForFunction(() => ![...document.querySelectorAll('section[aria-label="Comments"] article')].some(el => el.textContent?.includes('Hold this frame')));
    assert.equal((await reviewComments(store, { action: 'comments', operation: 'list', projectId: 'project' })).comments.find(comment => comment.id === first.id)?.status, 'open');
    await button(page, 'Filter comments'); await menuItem(page, 'All');
    await waitText(page, 'Hold this frame');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { timeout: 60_000 });
    await button(page, 'Review list');
    await waitText(page, 'Increase the heading size.');
    // Theme uses the real preference and reload; content keeps its own styling.
    await page.evaluate(() => localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme: 'dark' })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { timeout: 60_000 });
    await assertReviewToolStates(page, 'dark');
    await button(page, 'Review list'); await waitText(page, 'Increase the heading size.');
    // Locate the saved element after a fresh preview load and verify real selection.
    await page.evaluate(id => {
      const articles = [...document.querySelectorAll('section[aria-label="Comments"] article')];
      (articles.find(el => el.textContent?.includes(id))?.querySelector('button.om-text-link') as HTMLButtonElement).click();
    }, 'Increase the heading size.');
    await page.waitForFunction(() => document.querySelector('button[data-clip="true"]')?.getAttribute('aria-pressed') === 'true');
    await page.screenshot({ path: path.join(output, 'comments-dark.png') });
    await page.setViewport({ width: 840, height: 900 });
    await button(page, 'Review list'); await waitText(page, 'Increase the heading size.');
    assert.equal(await page.$eval('section[aria-label="Comments"]', el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.screenshot({ path: path.join(output, 'comments-narrow.png') });
    // The composer stays in the player while the sidebar retains its own footer.
    await page.setViewport({ width: 840, height: 600 });
    const beforeComment2 = await previewGeometry(page);
    await button(page, 'Comment here');
    await placeComment(page);
    assert.deepEqual(await previewGeometry(page), beforeComment2);
    await page.type('textarea[aria-label="Comment"]', 'Draft kept while resizing the review panel.');
    const geometry = await page.$eval('section[aria-label="Comments"]', panel => {
      const bounds = panel.getBoundingClientRect();
      const footer = panel.querySelector('[data-review-footer]')!.getBoundingClientRect();
      return { contained: footer.top >= bounds.top && footer.bottom <= bounds.bottom + 1, composerInPlayer: Boolean(document.querySelector('[data-review-overlay] textarea[aria-label="Comment"]')), overflow: panel.scrollWidth > panel.clientWidth + 1 };
    });
    assert.deepEqual(geometry, { contained: true, composerInPlayer: true, overflow: false });
    await page.screenshot({ path: path.join(output, 'comments-short-draft.png') });
    await button(page, 'Cancel');
    await page.setViewport({ width: 840, height: 900 });
    await page.click('section[aria-label="Comments"] article button[aria-label="Comment options"]');
    await menuItem(page, 'Delete comment');
    await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Comments"] article').length === 2);
    assert.equal((await reviewComments(store, { action: 'comments', operation: 'list', projectId: 'project' })).comments.length, 2);

    // Reserved loading geometry and recoverable failures in both themes.
    await page.setViewport({ width: 1440, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme })), theme);
      commentReads = 'hold';
      await page.reload({ waitUntil: 'domcontentloaded' });
      await button(page, 'Review list');
      await page.waitForSelector('[aria-label="Loading comments…"]', { visible: true });
      await page.screenshot({ path: path.join(output, `loading-${theme}.png`) });
      commentReads = 'fail';
      await Promise.all(heldReads.splice(0).map(request => request.respond(readFailure).catch(() => {})));
      await waitText(page, 'Could not load comments');
      assert.equal(await page.$eval('section[aria-label="Comments"]', el => el.textContent?.includes('No comments here yet')), false);
      await page.screenshot({ path: path.join(output, `error-${theme}.png`) });
      commentReads = 'pass';
      await button(page, 'Retry'); await waitText(page, 'Increase the heading size.');
    }

    // Drawing is a review operation: pointer gestures and drawing shortcuts must not edit video source.
    await page.click('button[data-clip="true"]');
    const sourceBeforeDrawing = (await store.get()).revision;
    const beforeDrawing = await previewGeometry(page);
    await button(page, 'Draw a comment');
    assert.equal(await page.$('textarea[aria-label="Comment"]'), null);
    await page.waitForSelector('[data-review-annotation-canvas]', { visible: true });
    const draw = async (tool: string, from: [number, number], to: [number, number]) => {
      if (await page.$('textarea[aria-label="Comment"]')) { await button(page, 'More annotation tools'); await menuItem(page, tool); }
      const rect = await (await page.$('[data-review-annotation-canvas]'))!.boundingBox(); assert(rect);
      await page.mouse.move(rect.x + rect.width * from[0], rect.y + rect.height * from[1]);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width * to[0], rect.y + rect.height * to[1], { steps: 8 });
      await page.mouse.up();
      await page.waitForSelector('textarea[aria-label="Comment"]', { visible: true });
    };
    await draw('Freehand pen', [0.15, 0.3], [0.35, 0.6]);
    assert.deepEqual(await previewGeometry(page), beforeDrawing, 'Drawing and composing must not change player geometry');
    await page.$eval('[data-review-annotation-canvas]', el => (el as SVGSVGElement).focus());
    const undoModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(undoModifier); await page.keyboard.press('z'); await page.keyboard.up(undoModifier);
    await page.waitForFunction(() => !document.querySelector('[data-review-annotation-canvas] path'));
    await button(page, 'More annotation tools'); await menuItem(page, 'Redo annotation');
    await draw('Rectangle', [0.1, 0.2], [0.8, 0.7]);
    await page.setViewport({ width: 840, height: 900 });
    await draw('Arrow', [0.8, 0.85], [0.5, 0.5]);
    await draw('Ellipse', [0.3, 0.25], [0.65, 0.6]);
    await page.keyboard.press('Delete'); await page.keyboard.press('ArrowRight');
    assert.equal(await page.$$eval('button[data-clip="true"]', nodes => nodes.length), 1);
    await button(page, 'More annotation tools'); await menuItem(page, 'Text label'); await page.type('input[aria-label="Annotation label"]', 'Move title here'); await button(page, 'Place label');
    const box = await (await page.$('[data-review-annotation-canvas]'))!.boundingBox(); assert(box);
    await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.1);
    await page.type('textarea[aria-label="Comment"]', 'Use these marks to revise the title layout.');
    await page.screenshot({ path: path.join(output, 'annotation-draft-narrow.png') });
    await button(page, 'Save comment'); await waitText(page, 'Use these marks to revise the title layout.');
    const annotated = (await reviewComments(store, { action: 'comments', operation: 'list', projectId: 'project' })).comments.find(comment => comment.anchor.annotation)!;
    assert(annotated); assert.equal(annotated.anchor.annotation!.marks.length, 5);
    const arrow = annotated.anchor.annotation!.marks.find(mark => mark.kind === 'arrow')!;
    assert(Math.abs(arrow.points[0].x - 0.8) < 0.01 && Math.abs(arrow.points[1].y - 0.5) < 0.01);
    assert.equal(annotated.anchor.annotation!.width, 640); assert.equal(annotated.anchor.annotation!.height, 360);
    assert.equal((await store.get()).revision, sourceBeforeDrawing);
    await button(page, 'Play');
    await page.waitForFunction(() => !document.querySelector('[data-review-annotation-canvas]'));
    await new Promise(resolve => setTimeout(resolve, 300)); await button(page, 'Pause');
    const locateAnnotation = async () => {
      const target = await page.evaluateHandle(() => [...document.querySelectorAll('section[aria-label="Comments"] article')]
        .find(article => article.textContent?.includes('Use these marks'))?.querySelector('button.om-text-link'));
      assert(target.asElement()); await (target.asElement() as any).click(); await target.dispose();
      await page.waitForSelector('[data-review-annotation-canvas]', { visible: true });
    };
    await locateAnnotation();
    for (const theme of ['light', 'dark']) {
      await page.setViewport({ width: 1440, height: 1000 });
      await page.evaluate(theme => localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme })), theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await button(page, 'Review list'); await waitText(page, 'Use these marks'); await locateAnnotation();
      await page.screenshot({ path: path.join(output, `annotations-${theme}.png`) });
    }
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { document.documentElement.dataset.copiedReview = text; } } }); });
    await button(page, 'Choose comments'); await button(page, 'Select all shown'); await button(page, 'Copy for Agent (3)');
    await page.waitForFunction(() => document.documentElement.dataset.copiedReview?.includes('Move title here'));
    const copiedAnnotations = await page.$eval('html', el => (el as HTMLElement).dataset.copiedReview!);
    assert(copiedAnnotations.includes('normalized') && copiedAnnotations.includes(annotated.id));
    const copiedRecords = JSON.parse(copiedAnnotations.split('Selected review records (JSON):\n')[1]);
    assert.deepEqual(copiedRecords.find((record: { id: string }) => record.id === annotated.id).anchor.annotation, annotated.anchor.annotation);
    for (const token of [store.directory, 'Project ID: project', 'file.nextOffset', 'currentVersionId', 'expectedCommentRevision=latestComment.revision']) assert(copiedAnnotations.includes(token));
    // A completion from an Agent removes its visible overlay on the next shared-state refresh.
    await reviewComments(store, { action: 'comments', operation: 'update', projectId: 'project', commentId: annotated.id, expectedCommentRevision: 1, status: 'resolved', requestId: 'annotation-done' });
    await page.waitForFunction(() => !document.querySelector('[data-review-annotation-canvas]'), { timeout: 12000 });
    await reviewComments(store, { action: 'comments', operation: 'delete', projectId: 'project', commentId: annotated.id, expectedCommentRevision: 2, requestId: 'annotation-cleanup' });
    await page.locator('.motion-project-agent-trigger[aria-label="MCP"]').click();
    await button(page, 'Connection help');
    await page.waitForSelector('#mcp-capabilities');
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { document.documentElement.dataset.copiedReview = text; } } }); });
    const example = await page.evaluateHandle(() => [...document.querySelectorAll('#mcp-capabilities article')]
      .find(article => article.querySelector('h3')?.textContent === 'Review a video with comments')?.querySelector('button'));
    assert(example.asElement());
    await (example.asElement() as any).click(); await example.dispose();
    await page.waitForFunction(() => document.documentElement.dataset.copiedReview?.includes('operation="list"'));
    assert((await page.$eval('html', el => (el as HTMLElement).dataset.copiedReview)).includes(store.directory));
    const handbook = await page.$eval('html', el => (el as HTMLElement).dataset.copiedReview!);
    assert(handbook.includes('Project ID: project') && handbook.includes('file.nextOffset'));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme })), theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-review-guide] summary');
      await page.locator('[data-review-guide] summary').click();
      await page.waitForFunction(() => document.querySelector<HTMLDetailsElement>('[data-review-guide]')?.open === true);
      for (const width of [1440, 480]) {
        await page.setViewport({ width, height: 1000 });
        await page.$eval('[data-review-guide]', element => element.scrollIntoView({ block: 'center' }));
        assert(await page.$eval('[data-mcp-scenario="review-comments"]', card => card.scrollWidth <= card.clientWidth + 1));
        await page.screenshot({ path: path.join(output, `mcp-review-guide-${theme}-${width}.png`) });
      }
      await page.setViewport({ width: 1440, height: 1000 });
    }

    // Inspect the user's language through the actual locale preference.
    await page.evaluate(() => localStorage.setItem('motion.studio.locale', 'zh-CN'));
    await page.evaluateOnNewDocument(() => localStorage.setItem('motion.studio.locale', 'zh-CN'));
    await page.goto(`${origin}/#project/project`, { waitUntil: 'domcontentloaded' });
    await button(page, '评论清单');
    await page.waitForFunction(() => document.querySelector('section[aria-label="评论"]')?.textContent?.includes('Increase the heading size.'));
    await assertHeaderLayout(page);
    await page.screenshot({ path: path.join(output, 'comments-zh-CN.png') });
    assert.deepEqual(errors, []);
    await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: ['frame time', 'element metadata', 'whole video', 'clipboard fallback and success Toast', 'Agent status polling', 'reopen', 'reload persistence', 'saved element selection', 'light/dark/narrow', 'delete', 'light/dark loading/error/retry', 'five annotation tools', 'annotation undo/redo and keyboard isolation', 'annotation coordinates after resize', 'annotation playback and saved-frame navigation', 'Agent annotation handoff and completion', 'MCP handbook handoff', 'Chinese interface'] }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    await writeFile(path.join(output, 'failure.txt'), `${String(error)}\n${await page.evaluate(() => document.body.innerText)}\n${errors.join('\n')}`);
    throw error;
  } finally { await browser.close(); await running.close(); }
}));
