#!/usr/bin/env node
// Run under the shared browser-lock lane. All project reads/writes use the page's registered WebMCP tools.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore } from '../../../workspace.ts';
import { pluginRoot } from '../../../hyperframes.ts';
import { startServer } from '../../../server.ts';
import { launchStudioChrome } from './chrome-executable.mjs';
import { installWebMcpHost } from './webmcp-host.mjs';

// The browser uses a fake same-origin collector; never report fixtures to the real collector.
process.env.OPENMOTION_TELEMETRY = '0';
const evidence = process.env.WEBMCP_E2E_EVIDENCE_DIR || await mkdtemp(path.join(tmpdir(), 'motion-webmcp-evidence-'));
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(path.join(tmpdir(), 'motion-webmcp-source-edit-'));
process.env.HYPERFRAMES_HISTORY_ROOT = path.join(directory, 'native-history');
const store = new WorkspaceStore(directory);
let server, browser;
const results = {};
try {
  await store.initialize(pluginRoot);
  const projectId = store.projectId;
  const index = path.join(store.projectDirectory, 'index.html');
  const before = `<!doctype html><html><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script>
<style>html,body{margin:0;width:1920px;height:1080px;background:#101418;color:white;font-family:Arial}#main{width:1920px;height:1080px;display:grid;place-items:center}h1{font-size:100px}</style></head>
<body><div data-hf-id="hf-main" id="main" data-composition-id="main" data-width="1920" data-height="1080" data-duration="4"><h1 data-hf-id="hf-titl" id="title">Source edit fixture</h1></div>
<script>window.__timelines={main:gsap.timeline({paused:true}).from('#title',{opacity:0,y:80,duration:1.4}).to({}, {duration:2.6})};</script></body></html>`;
  await writeFile(index, before);
  server = await startServer(store, Number(process.env.D4_LANE_PREVIEW_PORT || 0));
  const url = (await server.info()).studioUrl;
  ({ browser } = await launchStudioChrome());
  const page = await browser.newPage();
  const telemetry = [], previous = { calls: [], registrations: [] };
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/motion-api/tracking') {
      if (request.method() === 'POST') telemetry.push(...JSON.parse(request.postData()).events);
      void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true }) });
    } else void request.continue();
  });
  const checkTracking = async () => {
    const activity = await page.evaluate(() => window.__webMcpSource.activity());
    const expected = { calls: [...previous.calls, ...activity.calls], registrations: [...previous.registrations, ...activity.registrations] };
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && telemetry.filter(event => event.event === 'webmcp_tool_finished').length < expected.calls.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    for (const [name, names] of [['webmcp_tool_started', expected.calls], ['webmcp_tool_finished', expected.calls], ['webmcp_registration_result', expected.registrations]]) {
      const rows = telemetry.filter(event => event.event === name);
      assert.deepEqual(rows.map(event => event.properties.tool_name).sort(), [...names].sort());
      assert.ok(rows.every(event => event.entrypoint === 'studio' && event.properties.transport === 'webmcp'));
    }
    const starts = telemetry.filter(event => event.event === 'webmcp_tool_started');
    const finishes = telemetry.filter(event => event.event === 'webmcp_tool_finished');
    assert.equal(new Set(starts.map(event => event.properties.call_id)).size, expected.calls.length);
    assert.deepEqual(starts.map(event => event.properties.call_id).sort(), finishes.map(event => event.properties.call_id).sort());
    assert.ok(finishes.every(event => Number.isInteger(event.properties.duration_ms) && event.properties.duration_ms >= 0));
    return expected;
  };
  await page.setViewport({ width: 1600, height: 1000 });
  await page.evaluateOnNewDocument(installWebMcpHost, '__webMcpSource');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__webMcpSource?.has('openmotion_get_project') && window.__webMcpSource.has('openmotion_studio_look'), { timeout: 90_000 });
  const call = (name, input) => page.evaluate((name, input) => window.__webMcpSource.call(name, input), name, input);
  results.tools = await page.evaluate(() => window.__webMcpSource.names());
  assert.equal(results.tools.length, 17);
  assert.deepEqual(results.tools.filter(name => name.startsWith('openmotion_studio_')).sort(), [
    'openmotion_studio_look', 'openmotion_studio_select', 'openmotion_studio_seek', 'openmotion_studio_frame', 'openmotion_studio_inspect',
  ].sort());
  for (const action of ['set_text', 'set_style', 'transform', 'add_animation', 'update_animation', 'add_keyframe', 'delete_animation']) {
    await assert.rejects(call(`openmotion_studio_${action}`, {}), /not registered/);
  }

  const current = await call('openmotion_get_project', { projectId, file: { path: 'index.html' } });
  assert.equal(current.file.content, await readFile(index, 'utf8'));
  assert.ok(current.file.content.includes('Source edit fixture'));
  const content = current.file.content.replace('Source edit fixture', 'WebMCP 测试成功');
  results.saved = await call('openmotion_edit_project', {
    projectId, requestId: 'webmcp-source-title', expectedRevision: current.revision,
    expectedVersionId: current.version.versionId, files: [{ path: 'index.html', content }], summary: 'Edit title through WebMCP source files',
  });
  assert.equal(results.saved.changed, true, JSON.stringify(results.saved));
  assert.equal(await readFile(index, 'utf8'), content);
  results.stale = await call('openmotion_edit_project', {
    projectId, requestId: 'webmcp-stale-title', expectedRevision: current.revision,
    expectedVersionId: current.version.versionId, files: [{ path: 'index.html', content: before }],
  });
  assert.equal(results.stale.error.code, 'VERSION_CONFLICT');
  assert.equal(await readFile(index, 'utf8'), content);
  Object.assign(previous, await checkTracking());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const iframe = document.querySelector('hyperframes-player')?.shadowRoot?.querySelector('iframe');
    return iframe?.contentDocument?.getElementById('title')?.textContent === 'WebMCP 测试成功';
  }, { timeout: 90_000 });
  await page.waitForFunction(async () => (await window.__webMcpSource.call('openmotion_studio_look', {})).duration === 4, { timeout: 30_000 });
  results.seek = await call('openmotion_studio_seek', { time: 0.9 });
  assert.equal(results.seek.ok, true, JSON.stringify(results.seek));
  assert.ok(Math.abs(results.seek.playhead - 0.9) < 0.01);
  results.animation = await page.evaluate(() => {
    const iframe = document.querySelector('hyperframes-player').shadowRoot.querySelector('iframe');
    return { duration: iframe.contentWindow.__timelines.main.duration(),
      time: iframe.contentWindow.__timelines.main.time() };
  });
  assert.equal(results.animation.duration, 4);
  assert.ok(Math.abs(results.animation.time - 0.9) < 0.05);
  await page.screenshot({ path: path.join(evidence, 'webmcp-source-title.png') });
  const disabled = await browser.newPage();
  await disabled.evaluateOnNewDocument(installWebMcpHost, '__webMcpSource');
  await disabled.evaluateOnNewDocument(() => localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ agentToolsEnabled: false })));
  await disabled.goto(url, { waitUntil: 'domcontentloaded' });
  await disabled.waitForSelector('hyperframes-player', { timeout: 90_000 });
  assert.deepEqual(await disabled.evaluate(() => window.__webMcpSource.names()), []);
  results.disabledPreference = true;
  const activity = await checkTracking();
  assert.ok(telemetry.filter(event => event.event === 'webmcp_tool_finished').some(event => event.properties.outcome === 'failure'));
  const measured = telemetry.filter(event => event.event.startsWith('webmcp_tool_') || event.event === 'webmcp_registration_result');
  assert.ok(!JSON.stringify(measured).includes('WebMCP 测试成功'));
  await writeFile(path.join(evidence, 'tracking-events.json'), JSON.stringify(measured, null, 2));
  results.tracking = { calls: activity.calls.length, registrations: activity.registrations.length, events: measured.length };
  await writeFile(path.join(evidence, 'browser-result.json'), JSON.stringify({ status: 'PASS', results }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', evidence, results }, null, 2));
} catch (error) {
  await writeFile(path.join(evidence, 'browser-result.json'), JSON.stringify({ status: 'FAIL', error: error.stack, results }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await rm(directory, { recursive: true, force: true });
}
