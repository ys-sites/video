// Network integration: production MCP App resource, real curated media, and a
// minimal test host implementing the SDK handshake. Not a native-host receipt.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { loadTemplatePresentation, showTemplateRecommendations } from '../shared/mcp-template-recommendations.ts';
import { onboardingTemplateIds } from '../shared/onboarding-templates.ts';

const output = process.argv[2];
assert(output && path.isAbsolute(output), 'Pass an absolute evidence directory');
await mkdir(output, { recursive: true });
const presentation = loadTemplatePresentation();
const origin = presentation.content._meta.ui.csp.resourceDomains.filter(value => value.startsWith('https://')).join(' ');
const csp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: ${origin}; media-src data: blob: ${origin}; connect-src 'none'`;
const groups = Array.from({ length: 3 }, (_, index) => onboardingTemplateIds.slice(index * 3, index * 3 + 3));
const result = { resourceUri: presentation.uri, groups: [], errors: [], protocol: [], passed: false };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/resource') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': csp });
    res.end(presentation.content.text); return;
  }
  const ids = groups[Number(url.searchParams.get('group'))];
  if (!ids) { res.writeHead(404); res.end(); return; }
  const shown = showTemplateRecommendations(presentation, { templateIds: ids, language: 'zh', onboarding: false });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><body><iframe id="app" src="/resource" style="width:100%;height:520px;border:0" sandbox="allow-scripts allow-same-origin"></iframe><script>
    const frame=document.getElementById('app');
    window.addEventListener('message',event=>{
      if(event.source!==frame.contentWindow)return;
      const message=event.data;
      if(message.method==='ui/initialize') event.source.postMessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,hostInfo:{name:'OpenMotion integration test',version:'1'},hostCapabilities:{},hostContext:{locale:'zh',theme:'dark'}}},location.origin);
      else if(message.method==='ui/notifications/initialized') event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[],structuredContent:${JSON.stringify(shown).replaceAll('<', '\\u003c')}}},location.origin);
      else if(message.id!==undefined) event.source.postMessage({jsonrpc:'2.0',id:message.id,result:{}},location.origin);
    });
  </script></body></html>`);
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath: process.env.HYPERFRAMES_BROWSER_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  page.on('console', message => { if (message.text().includes('message')) result.protocol.push(message.text().slice(0, 250)); });
  for (let index = 0; index < groups.length; index++) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?group=${index}`, { waitUntil: 'domcontentloaded' });
    const frame = await (await page.$('#app')).contentFrame();
    try { await frame.waitForSelector('.omtc-card', { timeout: 15000 }); }
    catch (error) {
      result.failureText = await frame.$eval('body', element => element.innerText);
      result.diagnostic = await frame.evaluate(value => ({ version: window.__OPENMOTION_TEMPLATE_CARDS__?.resourceVersion,
        ids: window.__OPENMOTION_TEMPLATE_CARDS__?.templates.map(item => item.id),
        directValidation: Boolean(window.OpenMotionTemplateCards?.readRecommendation(value, window.__OPENMOTION_TEMPLATE_CARDS__)) }),
        showTemplateRecommendations(presentation, { templateIds: groups[index], language: 'zh', onboarding: false }));
      await page.screenshot({ path: path.join(output, 'native-host-failure.png') }); throw error;
    }
    await frame.waitForFunction(() => [...document.querySelectorAll('.omtc-card img')].length === 3
      && [...document.querySelectorAll('.omtc-card img')].every(image => image.complete && image.naturalWidth > 0)
      && [...document.querySelectorAll('.omtc-card video')].every(video => video.readyState >= 2 && video.currentTime > 0.2 && !video.paused && !video.error), { timeout: 60000 });
    const read = () => frame.$$eval('.omtc-card', cards => cards.map(card => {
      const image = card.querySelector('img'), video = card.querySelector('video');
      return { templateId: card.dataset.templateId, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight,
        duration: video.duration, time: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames, error: video.error?.code ?? null };
    }));
    assert.equal(await frame.$$eval('.omtc-welcome', items => items.length), 0, 'Welcome belongs to the streamed final reply');
    const initial = await read();
    await frame.waitForFunction(times => [...document.querySelectorAll('.omtc-card video')].every((video, position) => video.currentTime > times[position] + 0.2), {}, initial.map(item => item.time));
    const advanced = await read();
    assert.deepEqual(advanced.map(item => item.templateId), groups[index]);
    advanced.forEach((item, position) => assert(item.frames > initial[position].frames));
    result.groups.push({ initial, advanced });
    await page.screenshot({ path: path.join(output, `pool-group-${index + 1}.png`) });
  }
  assert.equal(result.groups.flatMap(group => group.advanced).length, 9);
  assert.deepEqual(result.errors, []);
  result.passed = true;
  console.log('PASS all nine candidates: decoded posters, loaded full video duration, advancing time and frames through the production native App SDK handshake; zero CSP/runtime errors');
} finally {
  await writeFile(path.join(output, 'nine-candidate-media.json'), JSON.stringify(result, null, 2));
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve()));
}
