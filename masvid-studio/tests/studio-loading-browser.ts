// Run explicitly after build:studio:
// node --experimental-strip-types --test tests/studio-loading-browser.ts
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { fixture } from "./fixtures.ts";
import { startServer } from "../server.ts";

const output = process.env.OPENMOTION_BROWSER_EVIDENCE || path.join(tmpdir(), "openmotion-studio-loading-evidence");
assert(path.isAbsolute(output));

test("nested composition parsing and optional asset metadata in the real Studio", { timeout: 180_000 }, async () => {
  await mkdir(output, { recursive: true });
  const requests: string[] = [];
  const responses: { url: string; status: number; animationCount?: number }[] = [];
  const errors: string[] = [];
  const checks: string[] = [];
  await fixture(async store => {
    await mkdir(path.join(store.projectDirectory, "compositions"), { recursive: true });
    await writeFile(path.join(store.projectDirectory, "index.html"), `<!doctype html><html><head><title>Studio loading regression</title><script src="assets/gsap.min.js"></script></head><body style="margin:0">
<div id="main" data-composition-id="main" data-start="0" data-duration="4" data-width="640" data-height="360" data-fps="30" style="position:relative;width:640px;height:360px;background:#17382f">
<div id="scene" data-composition-id="nested" data-composition-src="compositions/clip.html" data-start="0" data-duration="4" data-track-index="0"></div></div>
<script>const tl=gsap.timeline({paused:true});tl.to('#scene',{opacity:1,duration:4});window.__timelines={main:tl};</script></body></html>`);
    await writeFile(path.join(store.projectDirectory, "compositions/clip.html"), `<template>
<div id="scene" data-composition-id="nested" data-start="0" data-duration="4" data-width="640" data-height="360" style="position:relative;width:640px;height:360px;background:#17382f"><h1 id="label" data-start="0" data-duration="4" style="color:white;font:40px sans-serif">NESTED ANIMATION</h1></div>
<script>(()=>{const tl=gsap.timeline({paused:true});tl.fromTo('#label',{x:0,opacity:0},{x:80,opacity:1,duration:2,ease:'none'});window.__timelines.nested=tl;})();</script></template>`);
    await writeFile(path.join(store.projectDirectory, "assets/picture.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="green"/></svg>');
    const running = await startServer(store, 0, { editor: true });
    const browser = await puppeteer.launch({
      executablePath: process.env.HYPERFRAMES_BROWSER_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    });
    const page = await browser.newPage();
    const origin = (await running.info()).previewUrl;
    // Exercise the absolute source shape produced by preview URL resolution,
    // independently of whether this player hydrates from messages or the DOM.
    const index = path.join(store.projectDirectory, "index.html");
    await writeFile(index, (await readFile(index, "utf8")).replace('data-composition-src="compositions/clip.html"', `data-composition-src="${origin}/api/projects/${store.projectId}/preview/compositions/clip.html"`));
    const manifestUrl = `/api/projects/${store.projectId}/preview/.media/manifest.jsonl`;
    let passed = false;
    try {
      await page.setViewport({ width: 1440, height: 1000 });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem("motion.studio.locale", "en");
      });
      page.on("request", request => { if (request.url().startsWith(origin)) requests.push(new URL(request.url()).pathname); });
      page.on("response", response => {
        const url = new URL(response.url()).pathname;
        if (!url.includes("gsap-animations/") && !url.endsWith("manifest.jsonl")) return;
        const record: typeof responses[number] = { url, status: response.status() };
        responses.push(record);
        if (url.includes("gsap-animations/") && response.ok()) {
          void response.json().then(data => { record.animationCount = data.animations?.length; }).catch(() => {});
        }
      });
      page.on("pageerror", error => errors.push(String(error)));
      await page.goto(`${origin}/#project/${store.projectId}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { timeout: 60_000 });
      await page.waitForFunction(() => Number(document.querySelector("[data-timeline-element-count]")?.getAttribute("data-timeline-element-count")) > 0);
      await waitFor(async () => {
        for (const frame of page.frames()) {
          if (await frame.evaluate(() => document.body?.textContent?.includes("NESTED ANIMATION")).catch(() => false)) return true;
        }
        return false;
      });
      await waitFor(() => responses.some(response => response.url.endsWith("gsap-animations/compositions%2Fclip.html") && (response.animationCount ?? 0) > 0));
      assert(!requests.some(url => /gsap-animations\/https?%3A/i.test(url)));
      assert(responses.filter(response => response.url.includes("gsap-animations/")).every(response => response.status === 200));
      checks.push("Real nested composition with an absolute preview source loads and parsed GSAP response contains animation data; no encoded absolute-URL requests");
      await clickButton(page, "Panels and layout");
      await clickText(page, "Restore default layout");
      await page.keyboard.press("Escape");
      await clickButton(page, "Play");
      await waitFor(async () => {
        for (const frame of page.frames()) {
          if (await frame.$eval("#label", element => Number(getComputedStyle(element).opacity) > 0.3).catch(() => false)) return true;
        }
        return false;
      });
      await clickButton(page, "Pause");
      checks.push("Real preview playback advances the nested GSAP animation");
      await clickText(page, "compositions/clip.html");
      await page.waitForSelector('button[aria-label^="Label,"]');
      await page.click('button[aria-label^="Label,"]');
      await page.waitForFunction(() => document.querySelector('[data-flat-group-open="true"]')?.textContent?.includes("Font"));
      // MVP intentionally hides Motion and timeline keyframe controls. Cache
      // identity/population are covered by usePopulateKeyframeCacheForFile tests.
      checks.push("Opening the nested composition and selecting its text loads the real text inspector");
      await page.screenshot({ path: path.join(output, "nested-animation.png") });
      await writeFile(path.join(output, "initial-ui.json"), JSON.stringify(await inspect(page), null, 2));
      await clickText(page, "Assets");
      await page.waitForSelector("[data-assets-list]");
      await page.waitForSelector('[data-assets-list] img[src*="/assets/picture.svg"]', { visible: true });
      for (let i = 0; i < 2; i++) {
        await clickText(page, "Compositions");
        await clickText(page, "Assets");
        await page.waitForSelector("[data-assets-list]");
      }
      assert(!requests.includes(manifestUrl));
      checks.push("My assets lists real project files and repeated panel switching never requests an absent manifest");
      await page.screenshot({ path: path.join(output, "assets-without-manifest.png") });
      await mkdir(path.join(store.projectDirectory, ".media"), { recursive: true });
      await writeFile(path.join(store.projectDirectory, ".media/manifest.jsonl"), '{"path":"assets/picture.svg","description":"unique metadata"}\n');
      const listing = await (await fetch(`${origin}/api/projects/${store.projectId}`)).json();
      assert(listing.files.includes(".media/manifest.jsonl"), "Native file listing must include optional hidden metadata");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-studio-control="playback"]:not(:disabled)', { timeout: 60_000 });
      await clickText(page, "Assets");
      await page.waitForSelector("[data-assets-list]");
      await waitFor(() => responses.some(response => response.url === manifestUrl && response.status === 200));
      await page.type('input[aria-label="Search assets"]', "unique metadata");
      await page.waitForSelector('[data-assets-list] img[src*="/assets/picture.svg"]', { visible: true });
      checks.push("Native listing exposes a newly added project manifest; reloaded Studio fetches it and metadata search finds its asset");
      await page.screenshot({ path: path.join(output, "assets-with-metadata.png") });
      assert.deepEqual(errors, []);
      assert(!requests.some(url => /gsap-animations\/https?%3A/i.test(url)));
      await Promise.all(["failure.png", "failure-ui.json"].map(file => rm(path.join(output, file), { force: true })));
      passed = true;
    } finally {
      if (!passed) {
        await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
        await writeFile(path.join(output, "failure-ui.json"), JSON.stringify(await inspect(page), null, 2));
      }
      await writeFile(path.join(output, "result.json"), JSON.stringify({ passed, checks, requests, responses, errors }, null, 2));
      await browser.close();
      await running.close();
    }
  });
});

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!await check()) {
    assert(Date.now() < deadline, "Expected request/response was not observed");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function clickButton(page: Page, label: string): Promise<void> {
  await page.locator(`button[aria-label="${label}"]`).click();
}

async function clickText(page: Page, label: string): Promise<void> {
  await page.locator(`::-p-text(${label})`).click();
}

async function inspect(page: Page) {
  return page.evaluate(() => ({
    text: document.body.innerText,
    buttons: [...document.querySelectorAll("button")].map(button => ({ text: button.textContent, label: button.getAttribute("aria-label"), title: button.title })),
    frames: [...document.querySelectorAll("iframe")].map(frame => frame.src),
  }));
}
