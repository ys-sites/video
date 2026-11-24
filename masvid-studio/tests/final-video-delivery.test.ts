import test from 'node:test';
import assert from 'node:assert/strict';
import { rpc, mcpRegistry } from '../mcp.ts';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { cancelExport } from '../server.ts';

const capabilities = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } };
test('only final video presentation mounts a chat component, never production or editor operations', () => fixture(async store => {
  const state: any = {};
  const call = (method: string, params: any = {}) => rpc({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }, store, mcpRegistry(), undefined, state) as Promise<any>;
  await call('initialize', { capabilities });
  const tools = (await call('tools/list')).result.tools;
  const final = tools.find((t: any) => t.name === 'openmotion_show_video');
  assert.ok(final, 'A final-only presentation entry must be discoverable');
  assert.match(final.description, /Optional fallback player/);
  assert.match(final.description, /Codex defaults to one final-reply video embed/);
  assert.match(final.description, /Never combine this player with a native embed/);
  const initialized = (await call('initialize', { capabilities })).result;
  assert.match(initialized.instructions, /without calling openmotion_show_video/);
  assert.match(initialized.instructions, /Never combine both previews for the same export/);
  assert.ok(final._meta.ui.resourceUri);
  assert.equal(final._meta.ui.resourceUri, 'ui://openmotion/inline-video/v2/player.html');
  const current = (await call('resources/read', { uri: final._meta.ui.resourceUri })).result.contents[0];
  const legacy = (await call('resources/read', { uri: 'ui://openmotion/inline-video/v1/player.html' })).result.contents[0];
  assert.equal(legacy.text, current.text, 'Existing chats retain a readable player resource');
  assert.equal(legacy.uri, 'ui://openmotion/inline-video/v1/player.html');
  for (const tool of tools.filter((t: any) => !['openmotion_show_video', 'openmotion_show_template_recommendations'].includes(t.name)))
    assert.equal(tool._meta?.ui?.resourceUri, undefined, tool.name + ' must not mount a chat preview');
  const plain = (await rpc({ jsonrpc: '2.0', id: 'plain', method: 'tools/list' }, store) as any).result.tools;
  assert.equal(plain.length, 22, 'Non-App clients retain their existing contract');
  await call('initialize', { capabilities: {} });
  assert.ok(!(await call('tools/list')).result.tools.some((tool: any) => tool.name === 'openmotion_show_video'), 'Reinitialization must clear the previous App capability');
}, false));

test('saving an active production round defers the editor until the film is ready', () => fixture(async store => {
  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
    openProject: async () => {}, mutation: async task => task(), cancel: (p, j) => cancelExport(store, p, j),
  });
  const p = await service.call('openmotion_create_project', { requestId: 'create', projectType: 'natural_language', title: 'Final delivery', requirements: 'Silent short film' });
  const begin = await service.call('openmotion_open_preview', { action: 'begin', projectId: p.projectId, requestId: 'begin', mode: 'create' });
  const saved = await service.call('openmotion_edit_project', { projectId: p.projectId, workId: begin.inlineWork.id,
    requestId: 'save', expectedRevision: p.revision, expectedVersionId: p.currentVersionId, files: [{ path: 'note.txt', content: 'Authoring in progress' }] });
  assert.equal(saved.previewHandoff.state, 'deferred');
  assert.equal(saved.previewHandoff.hostActionRequired, false);
  assert.equal(saved.previewHandoff.nextAction, null);
  assert.match(saved.previewHandoff.instructions, /ready|complete/i);
  assert.match(saved.previewHandoff.instructions, /host-native video preview first/);
  assert.match(saved.previewHandoff.instructions, /Only if native preview is unavailable/);
  assert.match(saved.previewHandoff.instructions, /never present the same export through both routes/);
}, false));
