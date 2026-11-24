import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_BACKEND_PREFIXES,
  SPA_ROUTE_PREFIXES,
  editorProjectIdFromPath,
  isReservedBackendPath,
  isSpaRoutePath,
  isStandaloneSpaPath,
  spaPathnameToSearch,
} from '../shared/spa-routes.ts';

test('SPA route prefixes never collide with reserved backend or cloud prefixes', () => {
  for (const spa of SPA_ROUTE_PREFIXES) {
    if (spa === '/') continue;
    assert.equal(isReservedBackendPath(spa), false, `SPA prefix "${spa}" collides with reserved backend prefix`);
    for (const reserved of RESERVED_BACKEND_PREFIXES) {
      assert.notEqual(spa, reserved, `Exact collision on "${spa}"`);
      assert.equal(spa.startsWith(reserved + '/'), false, `SPA prefix "${spa}" nests under "${reserved}"`);
      assert.equal(reserved.startsWith(spa + '/'), false, `Reserved prefix "${reserved}" nests under "${spa}"`);
    }
  }
  // Explicitly guard /mcp (cloud Streamable HTTP MCP) vs /mcp-setup (frontend page).
  assert.equal(isReservedBackendPath('/mcp'), true);
  assert.equal(isReservedBackendPath('/mcp/stream'), true);
  assert.equal(isSpaRoutePath('/mcp'), false);
  assert.equal(isSpaRoutePath('/mcp/stream'), false);
  assert.equal(isSpaRoutePath('/mcp-setup'), true);
  assert.equal(isSpaRoutePath('/mcp-setup/claude'), true);
});

test('whitelisted SPA routes match while backend, missing asset, and source paths are rejected', () => {
  const allowed = [
    '/',
    '/explore',
    '/explore/',
    '/explore/film',
    '/create/text-to-image',
    '/motion',
    '/cinema',
    '/cinema/text-to-video',
    '/design/prototype',
    '/design/projects/demo-1',
    '/sound/speech',
    '/audio',
    '/audio/sfx',
    '/studios/3d',
    '/studios/3d/text-to-video',
    '/studios/game',
    '/scenarios',
    '/scenarios/product-launch',
    '/game',
    '/skills',
    '/skills/kinetic-type',
    '/models/gemini-4.0',
    '/models/fal%3Afal-ai%2Fsuno%2Fv4',
    '/model-hub/gemini-4',
    '/models/hub/gemini-4',
    '/assets',
    '/assets/asset-1',
    '/brand-kit',
    '/brand-kit/mine',
    '/settings',
    '/settings/providers',
    '/mcp-setup',
    '/templates',
    '/editor/project',
    '/editor/project.v2',
  ];
  for (const route of allowed) {
    assert.equal(isSpaRoutePath(route), true, `expected SPA route: ${route}`);
  }

  const rejected = [
    '/api',
    '/api/unknown',
    '/motion-api/projects',
    '/design-api/sessions',
    '/mcp',
    '/mcp/tools',
    '/mcp-ui/card',
    '/connect/config',
    '/sessions/abc',
    '/editor-assets/missing.js',
    '/guide-assets/viewer.js',
    '/design-system',
    '/web/app.ts',
    '/.well-known/oauth-protected-resource',
    '/__hyperframes_config',
    '/workspace.ts',
    '/studio/src/main.tsx',
    '/explore/chunk.js',
    '/settings/style.css',
    '/unknown-page',
  ];
  for (const route of rejected) {
    assert.equal(isSpaRoutePath(route), false, `must not match SPA fallback: ${route}`);
  }
});

test('standalone SPA paths skip native Studio pre-launch while editor paths extract project IDs', () => {
  assert.equal(isStandaloneSpaPath('/explore'), true);
  assert.equal(isStandaloneSpaPath('/cinema/text-to-video'), true);
  assert.equal(isStandaloneSpaPath('/design/prototype'), true);
  assert.equal(isStandaloneSpaPath('/settings/providers', '?project=project'), true);
  assert.equal(isStandaloneSpaPath('/mcp-setup', '?project=project'), true);
  assert.equal(isStandaloneSpaPath('/model-hub/gemini-4', '?session=conversation'), true);
  assert.equal(isStandaloneSpaPath('/models/veo-3', '?session=conversation'), true);
  assert.equal(isStandaloneSpaPath('/model-hub', '?session=conversation'), false);
  assert.equal(isStandaloneSpaPath('/models', '?session=conversation'), false);
  assert.equal(isStandaloneSpaPath('/audio/sfx', '?session=conversation'), true);
  assert.equal(isStandaloneSpaPath('/sound', '?session=conversation'), true);
  assert.equal(isStandaloneSpaPath('/studios/3d', '?session=conversation'), true);
  assert.equal(isStandaloneSpaPath('/studios/3d/text-to-video', '?session=conversation'), true);
  assert.equal(isStandaloneSpaPath('/studios/game', '?session=conversation&game=done'), true);
  assert.equal(isStandaloneSpaPath('/studios', '?session=conversation'), false);
  assert.equal(isStandaloneSpaPath('/studios/unknown', '?session=conversation'), false);
  assert.equal(isStandaloneSpaPath('/create/text-to-image', '?session=conversation'), true);
  assert.equal(isStandaloneSpaPath('/create/missing', '?session=conversation'), false);
  assert.equal(isStandaloneSpaPath('/create', '?session=conversation'), false);
  assert.equal(isStandaloneSpaPath('/', '?page=settings&section=providers'), true);

  assert.equal(isStandaloneSpaPath('/', '?project=project'), false);
  assert.equal(isStandaloneSpaPath('/editor/project'), false);
  assert.equal(editorProjectIdFromPath('/editor/my%20proj'), 'my proj');
  assert.equal(editorProjectIdFromPath('/explore'), null);
});

test('spaPathnameToSearch maps semantic SPA pathnames to workspace query parameters', () => {
  assert.equal(spaPathnameToSearch('/settings/providers'), '?page=settings&section=providers');
  assert.equal(spaPathnameToSearch('/cinema/text-to-video'), '?page=cinema&scene=text-to-video');
  assert.equal(spaPathnameToSearch('/design/projects/d-1'), '?page=design&scene=projects&designProject=d-1');
  assert.equal(spaPathnameToSearch('/mcp-setup/claude', '?setup=manual'), '?setup=manual&page=mcp&host=claude');
  assert.equal(spaPathnameToSearch('/model-hub/gemini-4'), '?page=model-hub&hub=gemini-4');
  assert.equal(spaPathnameToSearch('/models/hub/gemini-4'), '?page=model-hub&hub=gemini-4');
  assert.equal(spaPathnameToSearch('/models/veo-3'), '?page=model&model=veo-3');
  assert.equal(spaPathnameToSearch('/models/fal:fal-ai/suno/v4'), '?page=model&model=fal%3Afal-ai%2Fsuno%2Fv4');
  assert.equal(spaPathnameToSearch('/models/fal%3Afal-ai%2Fsuno%2Fv4'), '?page=model&model=fal%3Afal-ai%2Fsuno%2Fv4');
  assert.equal(spaPathnameToSearch('/sound'), '?page=sound&home=1');
  assert.equal(spaPathnameToSearch('/sound/speech'), '?page=sound&scene=speech');
  assert.equal(spaPathnameToSearch('/audio'), '?page=audio');
  assert.equal(spaPathnameToSearch('/audio/sfx'), '?page=audio&scene=sfx');
  assert.equal(spaPathnameToSearch('/studios/3d'), '?page=3d');
  assert.equal(spaPathnameToSearch('/studios/3d/text-to-video'), '?page=3d&scene=text-to-video');
  assert.equal(spaPathnameToSearch('/studios/game', '?game=done'), '?game=done&page=game');
  assert.equal(spaPathnameToSearch('/studios'), '?page=studios');
  assert.equal(spaPathnameToSearch('/templates'), '?templates=1');
  assert.equal(spaPathnameToSearch('/editor/proj-1'), '?page=editor&project=proj-1');
  assert.equal(spaPathnameToSearch('/', '?page=assets'), '?page=assets');
});
