// Run under browser-lock.sh with an isolated workspace; no generation or real model calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { WorkspaceStore } from '../../../workspace.ts';
import { handler } from '../../../server.ts';
import { AssetLibrary } from '../../../gateway/asset-library.ts';
import { execute } from '../../../hyperframes.ts';
import { verificationBinaries } from '../../../scripts/verify-export.ts';
import { resolveChromeExecutable } from './chrome-executable.mjs';
import { installWebMcpHost } from './webmcp-host.mjs';

assert.ok(process.env.D4_LANE, 'Acquire a shared browser lane first');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = process.env.EVIDENCE_DIR || await mkdtemp(path.join(tmpdir(), 'motion-assets-use-'));
await mkdir(output, { recursive: true });
const store = new WorkspaceStore(await mkdtemp(path.join(output, 'workspace-')));
await store.initialize(root);
const source = path.join(output, 'browser-source.png');
assert.equal((await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x48', '-frames:v', '1', '-y', source], root)).code, 0);
const library = new AssetLibrary(store), asset = await library.importFile(source, { requestId: 'browser-source', name: 'Browser read source' });
const before = await library.get(asset.id);
const server = createServer((req, res) => void handler(req, res, store, { runtimeRoot: root, nativeRoot: root, studio: null, ffmpeg: true }));
await new Promise(resolve => server.listen(Number(process.env.PLAYWRIGHT_WEB_PORT), '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, results = [];
let browser;
try {
  browser = await puppeteer.launch({ executablePath: resolveChromeExecutable(), headless: true });
  for (const [theme, width, language] of [['light', 1440, 'en'], ['dark', 1440, 'zh-CN'], ['light', 390, 'en'], ['dark', 390, 'zh-CN']]) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width, height: 960 });
    await page.evaluateOnNewDocument(installWebMcpHost, '__assetHost');
    await page.evaluateOnNewDocument((theme, language) => {
      localStorage.setItem('motion.studio.locale', language);
      localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ theme }));
    }, theme, language);
    await page.goto(`${origin}/?page=mcp`);
    await page.waitForSelector('.om-mcp-page');
    await page.waitForFunction(() => window.__assetHost?.has('openmotion_assets_use'));
    const result = await page.evaluate(async ({ assetId, versionId }) => {
      const host = window.__assetHost;
      const preferred = await host.call('openmotion_assets_use', { action: 'read', assetId, versionId });
      const old = await host.call('openmotion_assets', { action: 'get', assetId, versionId });
      const image = preferred.content.find(item => item.type === 'image');
      const size = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve([img.naturalWidth, img.naturalHeight]); img.onerror = reject; img.src = `data:${image.mimeType};base64,${image.data}`; });
      return { preferredId: preferred.structuredContent.versionId, oldId: old.version.id, size, names: host.names(), metadataHasData: JSON.stringify(preferred.structuredContent).includes('"data"') };
    }, { assetId: asset.id, versionId: asset.currentVersionId });
    assert.equal(result.preferredId, asset.currentVersionId); assert.equal(result.oldId, asset.currentVersionId);
    assert.deepEqual(result.size, [64, 48]); assert.equal(result.metadataHasData, false);
    await page.click('.om-mcp-tool-details summary');
    await page.waitForFunction(() => document.querySelector('.om-mcp-tool-list')?.innerText.includes('openmotion_assets_use'));
    const toolNames = await page.$$eval('.om-mcp-tool-list code', nodes => nodes.map(node => node.textContent));
    assert.equal(toolNames.length, 14); assert.ok(toolNames.includes('openmotion_assets'));
    const compatibility = await page.$$eval('.om-mcp-tool-list code', nodes => nodes.find(node => node.textContent === 'openmotion_assets').parentElement.textContent);
    assert.ok(compatibility.includes(language === 'zh-CN' ? '九项' : 'nine'), 'Onboarding must distinguish the original compatibility schema');
    await page.$eval('.om-mcp-tool-details', node => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(output, `${theme}-${width}-${language}.png`) });
    assert.equal(errors.length, 0, errors.join('\n'));
    results.push({ theme, width, language, ...result, toolNames, errors });
    await page.close();
  }
  assert.deepEqual(await library.get(asset.id), before);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ results, sourceSha256: asset.versions[0].sha256, libraryUnchanged: true }, null, 2));
  console.log(JSON.stringify({ passed: results.length, output }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
