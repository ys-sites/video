import type { Model } from '../../../shared/gateway';
import { isStandaloneSpaPath } from '../../../shared/spa-routes';
import { isWorkspaceSettingsPage } from '../../../shared/workspace-url';
import { creativeStudios, studioScenes, sceneDestination, modelDestination, mediaEditorDestination } from './creativeStudios';
import { expect, it } from 'vitest';
import { isLegacyWorkspaceHref, readWorkspacePage, settingsSections, workspacePageHref } from './workspacePageRouting';

it.each(settingsSections)('round-trips the %s destination without changing editor or host context', settings => {
  const source = 'http://localhost/editor/project?session=project&embed=1&tracking_context=11111111-1111-1111-1111-111111111111#project/project?v=1&t=12&tab=design&rc=0';
  const next = new URL(workspacePageHref(source, { settings }), source);
  expect(readWorkspacePage(next.search, next.hash, next.pathname).settings).toBe(settings);
  expect(next.hash).toBe(new URL(source).hash);
  for (const key of ['session', 'embed', 'tracking_context']) expect(next.searchParams.get(key)).toBe(new URL(source).searchParams.get(key));
  const editor = new URL(workspacePageHref(next.href, { settings: null }), source);
  expect(editor.href).toBe(source);
});

it('retains the library return page and selected detail, and clears page-specific options on exit', () => {
  const source = 'http://localhost/?page=mcp&host=claude&setup=manual';
  const library = new URL(workspacePageHref(source, { templates: true, template: 'film/a & b' }), source);
  expect(library.pathname).toBe('/mcp-setup');
  expect(readWorkspacePage(library.search, library.hash, library.pathname)).toMatchObject({ settings: 'mcp', templates: true, template: 'film/a & b', client: 'claude', setup: 'manual' });
  expect(workspacePageHref(library.href, { templates: false })).toBe('/mcp-setup?host=claude&setup=manual');
  const providers = new URL(workspacePageHref(library.href, { settings: 'providers', templates: false, provider: 'custom-a' }), source);
  expect(providers.pathname + providers.search).toBe('/settings/providers?provider=custom-a');
  expect(workspacePageHref(providers.href, { settings: 'general' })).toBe('/settings/general');
});

it('keeps MCP setup inside settings until a standalone destination is explicitly selected', () => {
  const source = 'http://localhost/?page=settings&section=local&entry_from=agent_media_signed_out';
  const mcp = new URL(workspacePageHref(source, { settings: 'mcp', mcpInSettings: true }), source);
  const setup = new URL(workspacePageHref(mcp.href, { client: 'claude', setup: 'manual' }), source);
  expect(setup.pathname).toBe('/settings/mcp');
  expect(setup.searchParams.has('page')).toBe(false);
  expect(setup.searchParams.has('section')).toBe(false);
  expect(setup.searchParams.get('entry_from')).toBe('agent_media_signed_out');
  expect(readWorkspacePage(setup.search, setup.hash, setup.pathname)).toMatchObject({ settings: 'mcp', mcpInSettings: true, client: 'claude', setup: 'manual' });
  const standalone = new URL(workspacePageHref(setup.href, { settings: 'mcp' }), source);
  expect(standalone.pathname + standalone.search).toBe('/mcp-setup?host=claude&setup=manual');
  expect(readWorkspacePage(standalone.search, standalone.hash, standalone.pathname).mcpInSettings).toBe(false);
});

it('round-trips the Black Friday collection and its selected Skill without leaking either into the regular library', () => {
  const origin = 'http://localhost/explore';
  const collection = new URL(workspacePageHref(origin, { templates: true, templateCollection: 'black-friday', skill: 'openmotion-sale-promo' }), origin);
  expect(readWorkspacePage(collection.search, collection.hash, collection.pathname)).toMatchObject({ explore: true, templates: true, templateCollection: 'black-friday', skill: 'openmotion-sale-promo' });
  expect(readWorkspacePage('?templates=1&collection=black-friday&skill=unknown').skill).toBeNull();
  expect(readWorkspacePage('?templates=1&view=creators&collection=black-friday').templateCollection).toBeNull();
  expect(workspacePageHref(collection.href, { templates: false })).toBe('/explore');
  expect(workspacePageHref(collection.href, { templateCollection: null, skill: null })).toBe('/explore?templates=1');
});

it('opens retired API links in the usual workspace and drops their tool on navigation', () => {
  const link = 'http://localhost/?page=api&tool=openmotion_media_use';
  expect(readWorkspacePage(new URL(link).search).explore).toBe(true);
  const project = new URL(link + '&project=film#project/film');
  expect(readWorkspacePage(project.search, project.hash)).toEqual(readWorkspacePage('?project=film', project.hash));
  expect(workspacePageHref(project.href, { motion: true })).toBe('/motion?project=film#project/film');
});

it('keeps legacy editor and template URLs and safely defaults unknown options', () => {
  expect(readWorkspacePage('?templates=1').templates).toBe(true);
  expect(readWorkspacePage('?project=project').settings).toBeNull();
  expect(readWorkspacePage('?page=unknown').settings).toBeNull();
  expect(readWorkspacePage('?page=settings&section=unknown').settings).toBe('general');
  expect(readWorkspacePage('?page=mcp&host=unknown&setup=unknown')).toMatchObject({ settings: 'mcp', client: 'codex', setup: 'agent' });
  // Leaving /editor/:id without a project hash preserves ?project=:id so returning restores the editor path.
  const withoutHash = new URL(workspacePageHref('http://localhost/editor/film?session=s1', { settings: 'general' }), 'http://localhost');
  expect(withoutHash.pathname + withoutHash.search).toBe('/settings/general?session=s1&project=film');
  expect(workspacePageHref(withoutHash.href, { settings: null })).toBe('/editor/film?session=s1#project/film');
});


it('round-trips Assets with editor context and preserves it underneath the template library', () => {
  const source = 'http://localhost/editor/project?embed=1#project/project?t=12';
  const assets = new URL(workspacePageHref(source, { assets: true }), source);
  expect(assets.pathname).toBe('/assets');
  expect(readWorkspacePage(assets.search, assets.hash, assets.pathname)).toMatchObject({ assets: true, settings: null });
  expect(assets.hash).toBe(new URL(source).hash);
  const library = new URL(workspacePageHref(assets.href, { templates: true }), source);
  expect(workspacePageHref(library.href, { templates: false })).toBe(assets.pathname + assets.search + assets.hash);
  const settings = new URL(workspacePageHref(assets.href, { settings: 'providers' }), source);
  expect(readWorkspacePage(settings.search, settings.hash, settings.pathname)).toMatchObject({ assets: false, settings: 'providers' });
  expect(workspacePageHref(assets.href, { assets: false })).toBe(new URL(source).pathname + new URL(source).search + new URL(source).hash);
});

it('preserves a Brand Kit selection behind template browsing and clears it when leaving', () => {
  const source = 'http://localhost/?page=brand-kit&kit=one&embed=1#project/retained';
  expect(readWorkspacePage(new URL(source).search)).toMatchObject({ settings: 'brand-kit', brandKit: 'one' });
  const next = new URL(workspacePageHref(source, { templates: true }), source);
  expect(next.pathname).toBe('/brand-kit/one');
  expect(readWorkspacePage(next.search, next.hash, next.pathname)).toMatchObject({ settings: 'brand-kit', brandKit: 'one', templates: true });
  expect(workspacePageHref(next.href, { settings: null, templates: false })).toBe('/editor/retained?embed=1#project/retained');
});

it('keeps entry_from while switching settings sections and clears it when leaving settings', () => {
  const source = 'http://localhost/?page=settings&section=providers&provider=account&entry_from=agent_media_upgrade_go&embed=1';
  expect(readWorkspacePage(new URL(source).search)).toMatchObject({ settings: 'providers', provider: 'account' });
  const account = new URL(workspacePageHref(source, { settings: 'account' }), source);
  expect(account.pathname).toBe('/settings/account');
  expect(account.searchParams.has('provider')).toBe(false);
  expect(account.searchParams.has('section')).toBe(false);
  expect(account.searchParams.get('entry_from')).toBe('agent_media_upgrade_go');
  const subscription = new URL(workspacePageHref(account.href, { settings: 'subscription' }), source);
  expect(subscription.pathname).toBe('/settings/subscription');
  expect(subscription.searchParams.get('entry_from')).toBe('agent_media_upgrade_go');
  const brandKit = new URL(workspacePageHref(subscription.href, { settings: 'brand-kit' }), source);
  expect(brandKit.searchParams.has('entry_from')).toBe(false);
  expect(new URL(workspacePageHref(brandKit.href, { settings: 'account' }), source).searchParams.has('entry_from')).toBe(false);
  const mcp = new URL(workspacePageHref(subscription.href, { settings: 'mcp' }), source);
  expect(mcp.searchParams.has('entry_from')).toBe(false);
  expect(new URL(workspacePageHref(mcp.href, { settings: 'account' }), source).searchParams.has('entry_from')).toBe(false);
  const assets = new URL(workspacePageHref(subscription.href, { assets: true }), source);
  expect(assets.searchParams.has('entry_from')).toBe(false);
  const skills = new URL(workspacePageHref(subscription.href, { skills: true }), source);
  expect(skills.searchParams.has('entry_from')).toBe(false);
  const closed = new URL(workspacePageHref(subscription.href, { settings: null }), source);
  expect(closed.searchParams.has('entry_from')).toBe(false);
});

it('round-trips studio scenes and provider-qualified models while preserving the project and template overlay', () => {
  const base = 'http://localhost/?page=cinema&scene=image-to-video&model=cloud%3Afilm%2Fv2&embed=1#project/film?t=8';
  const current = readWorkspacePage(new URL(base).search);
  expect(current.studio).toMatchObject({ scene: { id: 'image-to-video', modality: 'video' }, model: 'cloud:film/v2' });
  const overlay = new URL(workspacePageHref(base, { templates: true }), base);
  expect(overlay.pathname).toBe('/cinema/image-to-video');
  expect(readWorkspacePage(overlay.search, overlay.hash, overlay.pathname)).toMatchObject({ studio: current.studio, templates: true });
  expect(workspacePageHref(overlay.href, { templates: false })).toContain('model=cloud%3Afilm%2Fv2');
  expect(workspacePageHref(base, { studio: null })).toBe('/editor/film?embed=1#project/film?t=8');
  expect(workspacePageHref(base, { assets: true })).toBe('/assets?embed=1#project/film?t=8');
  expect(readWorkspacePage('?page=sound&scene=image-edit').studio?.scene.id).toBe('music');
  for (const [tab, backing] of [['sfx', 'music'], ['voice-clone', 'speech'], ['voice-changer', 'speech'], ['dubbing', 'speech'], ['stems', 'music']] as const) {
    const parsed = readWorkspacePage(`?page=sound&scene=${tab}`);
    expect(parsed.soundTab).toBe(tab);
    expect(parsed.studio?.scene.id).toBe(backing);
    expect(parsed.studio?.mediaTab).toBeUndefined();
    const roundTrip = workspacePageHref('http://localhost/?page=explore', { studio: parsed.studio, soundTab: tab });
    expect(roundTrip).toBe(`/sound/${tab}`);
    const soundUrl = new URL(roundTrip, 'http://localhost');
    expect(readWorkspacePage(soundUrl.search, soundUrl.hash, soundUrl.pathname)).toMatchObject({ soundTab: tab, studio: { studio: { id: 'sound' }, scene: { id: backing } } });

    const audioParsed = readWorkspacePage(`?page=audio&scene=${tab}`);
    expect(isWorkspaceSettingsPage(`?page=audio&scene=${tab}`)).toBe(true);
    expect(audioParsed.soundTab).toBe(tab);
    expect(audioParsed.studio?.scene.id).toBe(backing);
    expect(audioParsed.studio?.mediaTab).toBe(true);
    const audioRoundTrip = workspacePageHref('http://localhost/?page=explore', { studio: audioParsed.studio, soundTab: tab });
    expect(audioRoundTrip).toBe(`/audio/${tab}`);
    const audioUrl = new URL(audioRoundTrip, 'http://localhost');
    expect(isStandaloneSpaPath(audioUrl.pathname, audioUrl.search, audioUrl.hash)).toBe(true);
    expect(readWorkspacePage(audioUrl.search, audioUrl.hash, audioUrl.pathname)).toMatchObject({ soundTab: tab, studio: { studio: { id: 'sound' }, scene: { id: backing }, mediaTab: true } });
  }
  const audioMusic = readWorkspacePage('?page=audio&scene=music');
  expect(audioMusic.studio).toMatchObject({ studio: { id: 'sound' }, scene: { id: 'music' }, mediaTab: true });
  expect(workspacePageHref('http://localhost/?page=explore', { studio: audioMusic.studio })).toBe('/audio/music');
  const soundHome = readWorkspacePage('?page=sound&home=1');
  expect(soundHome.studio).toMatchObject({ studio: { id: 'sound' }, scene: { id: 'music' }, home: true });
  expect(workspacePageHref('http://localhost/?page=explore', { studio: soundHome.studio })).toBe('/sound');
  expect(readWorkspacePage('', '', '/sound').studio).toMatchObject({ studio: { id: 'sound' }, scene: { id: 'music' }, home: true });
});

it('round-trips every registered studio scene and resolves models in the current studio', () => {
  const registered = new Set<string>();
  for (const studio of creativeStudios) {
    for (const scene of studio.scenes) {
      const target = readWorkspacePage('?page=' + studio.id + '&scene=' + scene).studio!;
      expect([target.studio.id, target.scene.id]).toEqual([studio.id, scene]);
      const url = new URL(workspacePageHref('http://localhost/?page=explore', { studio: target }), 'http://localhost');
      expect(readWorkspacePage(url.search, url.hash, url.pathname).studio).toEqual(target);
      registered.add(scene);
    }
  }
  expect(registered).toEqual(new Set(studioScenes.map(scene => scene.id)));
  const model: Model = { id: 'image:still', provider: 'image', modelId: 'still', label: 'Still', modality: 'image', mode: 'text-to-image', source: 'custom' };
  expect(modelDestination(model, readWorkspacePage('?page=cinema&scene=text-to-video').studio)).toMatchObject({ studio: { id: 'design' }, scene: { id: 'text-to-image' } });
  expect(modelDestination(model)).toMatchObject({ studio: { id: 'design' }, scene: { id: 'text-to-image' } });
});

it('carries the originating community through a standalone studio, direct reload and return', () => {
  const source = 'http://localhost/explore?community=3d-motion&medium=video#project/film?t=8';
  const specialty = readWorkspacePage('?page=3d').specialty!;
  const next = new URL(workspacePageHref(source, { specialty, skill: 'three-js' }), source);
  expect(next.pathname).toBe('/studios/3d');
  expect(readWorkspacePage(next.search, next.hash, next.pathname)).toMatchObject({ specialty, skill: 'three-js', community: '3d-motion', medium: 'video' });
  expect(new URL(workspacePageHref(next.href, { explore: true }), source).href).toBe(source);
  expect(readWorkspacePage('?page=3d&skill=unregistered&community=unknown&medium=text')).toMatchObject({ specialty, skill: null, community: null, medium: null });
});

it('opens a pinned asset without carrying its version or a studio scene into unrelated destinations', () => {
  const source = 'http://localhost/?embed=1&page=cinema&scene=image-to-video&model=registered#project/film';
  const next = new URL(workspacePageHref(source, { assets: true, assetId: 'my-asset', assetVersion: 'older-version' }), source);
  expect(next.pathname).toBe('/assets/my-asset');
  expect(readWorkspacePage(next.search, next.hash, next.pathname)).toMatchObject({ assets: true, assetId: 'my-asset', assetVersion: 'older-version', studio: null });
  expect(next.searchParams.has('scene')).toBe(false);
  const settings = new URL(workspacePageHref(next.href, { settings: 'account' }), source);
  expect(settings.pathname).toBe('/settings/account');
  expect(settings.searchParams.has('version')).toBe(false);
  expect(settings.searchParams.has('asset')).toBe(false);
  expect(settings.hash).toBe('#project/film');
  expect(readWorkspacePage('?page=assets&version=orphan').assetVersion).toBeNull();
});

it('opens every scene on its registered surface and round-trips the selected model and Explore collection', () => {
  const base = 'http://localhost/explore?community=product-films&medium=image&embed=1#project/film?t=8';
  for (const scene of studioScenes) {
    const destination = sceneDestination(scene, null, 'provider:model/name');
    const url = new URL(workspacePageHref(base, { studio: destination }), base);
    expect(url.pathname).toBe(scene.entry === 'landing' ? `/create/${scene.id}` : `/${destination.studio.id}/${scene.id}`);
    expect(isStandaloneSpaPath(url.pathname, url.search, url.hash)).toBe(true);
    expect(readWorkspacePage(url.search, url.hash, url.pathname).studio).toEqual(destination);
    expect(workspacePageHref(url.href, { explore: true })).toBe('/explore?embed=1&community=product-films&medium=image#project/film?t=8');
  }
  expect(isWorkspaceSettingsPage('?page=create&scene=missing')).toBe(false);
  expect(isStandaloneSpaPath('/create/missing')).toBe(false);
  expect(readWorkspacePage('?page=create&scene=missing').studio).toBeNull();
  expect(readWorkspacePage('?page=create&scene=shot-image').studio).toMatchObject({ studio: { id: 'design' }, scene: { id: 'text-to-image' }, landing: true });
  expect(readWorkspacePage('?page=create&scene=video-native-audio').studio).toMatchObject({ studio: { id: 'cinema' }, scene: { id: 'text-to-video' }, landing: true });
  expect(workspacePageHref('http://localhost/?page=create&scene=bad&model=bad', { assets: true })).toBe('/assets');
  expect(workspacePageHref('http://localhost/create/bad?model=bad', { assets: true })).toBe('/assets');
});

it('restores each specialty brief, model overview and nested creator preview from their URLs', () => {
  const origin = 'http://localhost/explore?community=short-form#project/film';
  const open = (url: string, patch: Parameters<typeof workspacePageHref>[1]) => new URL(workspacePageHref(url, patch), origin);
  for (const entry of creativeStudios) {
    if (entry.surface !== 'techniques') continue;
    const href = open(origin, { specialty: entry, skill: entry.techniques[0] });
    expect(href.pathname).toBe(`/studios/${entry.id}`);
    expect(isStandaloneSpaPath(href.pathname, href.search, href.hash)).toBe(true);
    expect(readWorkspacePage(href.search, href.hash, href.pathname)).toMatchObject({ specialty: entry, skill: entry.techniques[0], community: 'short-form' });
  }
  // Leaving Game Studio drops its ?game=<id> selection while preserving it inside Game Studio.
  expect(workspacePageHref('http://localhost/studios/game?game=done', {})).toBe('/studios/game?game=done');
  expect(workspacePageHref('http://localhost/studios/game?game=done', { assets: true })).toBe('/assets');
  const model = open(origin, { modelOverview: 'custom:provider/model' });
  expect(model.pathname).toBe('/models/custom%3Aprovider%2Fmodel');
  expect(isStandaloneSpaPath(model.pathname, model.search, model.hash)).toBe(true);
  expect(readWorkspacePage(model.search, model.hash, model.pathname).modelOverview).toBe('custom:provider/model');
  expect(open(model.href, { explore: true }).href).toBe(origin);
  // A model hub is a standalone page, so a session's first artifact must not pull the viewer away from it.
  const hub = open(origin, { modelHub: 'gemini-4' });
  expect(hub.pathname).toBe('/model-hub/gemini-4');
  expect(isStandaloneSpaPath(hub.pathname, hub.search, hub.hash)).toBe(true);
  expect(readWorkspacePage(hub.search, hub.hash, hub.pathname).modelHub).toBe('gemini-4');
  expect(isWorkspaceSettingsPage('?page=model-hub')).toBe(false);
  expect(isStandaloneSpaPath('/model-hub')).toBe(false);
  expect(open(hub.href, { explore: true }).href).toBe(origin);
  const directory = open(origin, { templates: true, creators: true });
  const profile = open(directory.href, { creator: 'credit/Jane & Co' });
  const detail = open(profile.href, { template: 'work-1' });
  expect(readWorkspacePage(detail.search, detail.hash, detail.pathname)).toMatchObject({ explore: true, creators: true, creator: 'credit/Jane & Co', template: 'work-1' });
  expect(open(detail.href, { template: null }).href).toBe(profile.href);
  expect(open(profile.href, { templates: false }).href).toBe(origin);
});

it('round-trips scenario hub, scenario workspace, run/step overlay patches and safe fallbacks', () => {
  const origin = 'http://localhost/explore?community=product-films#project/film';
  const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const hub = new URL(workspacePageHref(origin, { scenarioHub: true, scenarioCategory: 'campaign' }), origin);
  expect(hub.pathname + hub.search).toBe('/scenarios?category=campaign&community=product-films');
  expect(hub.hash).toBe('#project/film');
  expect(isStandaloneSpaPath(hub.pathname, hub.search, hub.hash)).toBe(true);
  expect(readWorkspacePage(hub.search, hub.hash, hub.pathname)).toMatchObject({ scenarioHub: true, scenarioCategory: 'campaign', scenario: null, scenarioRun: null, scenarioStep: null, community: 'product-films' });

  // Overlay category update retains scenarioHub.
  const roleHub = new URL(workspacePageHref(hub.href, { scenarioCategory: 'role' }), origin);
  expect(roleHub.pathname + roleHub.search).toBe('/scenarios?category=role&community=product-films');
  expect(readWorkspacePage(roleHub.search, roleHub.hash, roleHub.pathname)).toMatchObject({ scenarioHub: true, scenarioCategory: 'role' });

  // Scenario destination with run and step.
  const workspace = new URL(workspacePageHref(hub.href, { scenario: 'black-friday', scenarioRun: runId, scenarioStep: 'sales-film' }), origin);
  expect(workspace.pathname + workspace.search).toBe(`/scenarios/black-friday?run=${runId}&step=sales-film&community=product-films`);
  expect(isStandaloneSpaPath(workspace.pathname, workspace.search, workspace.hash)).toBe(true);
  expect(readWorkspacePage(workspace.search, workspace.hash, workspace.pathname)).toMatchObject({
    scenarioHub: false,
    scenarioCategory: null,
    scenario: 'black-friday',
    scenarioRun: runId,
    scenarioStep: 'sales-film',
  });

  // Overlay step/run patch retains parent scenario.
  const nextStep = new URL(workspacePageHref(workspace.href, { scenarioStep: 'social' }), origin);
  expect(readWorkspacePage(nextStep.search, nextStep.hash, nextStep.pathname)).toMatchObject({ scenario: 'black-friday', scenarioRun: runId, scenarioStep: 'social', scenarioMode: null });

  // Mode round-trips for 'agent', omits 'mode' for 'manual'/null, and clears when leaving.
  const agentMode = new URL(workspacePageHref(nextStep.href, { scenarioMode: 'agent' }), origin);
  expect(agentMode.pathname + agentMode.search).toBe(`/scenarios/black-friday?run=${runId}&step=social&mode=agent&community=product-films`);
  expect(readWorkspacePage(agentMode.search, agentMode.hash, agentMode.pathname)).toMatchObject({
    scenario: 'black-friday',
    scenarioRun: runId,
    scenarioStep: 'social',
    scenarioMode: 'agent',
  });
  const directAgent = new URL(workspacePageHref(origin, { scenario: 'black-friday', scenarioMode: 'agent' }), origin);
  expect(directAgent.pathname + directAgent.search).toBe('/scenarios/black-friday?mode=agent&community=product-films');
  expect(readWorkspacePage(directAgent.search, directAgent.hash, directAgent.pathname).scenarioMode).toBe('agent');

  const manualOverlay = new URL(workspacePageHref(agentMode.href, { scenarioMode: 'manual' }), origin);
  expect(manualOverlay.searchParams.has('mode')).toBe(false);
  expect(readWorkspacePage(manualOverlay.search, manualOverlay.hash, manualOverlay.pathname)).toMatchObject({
    scenario: 'black-friday',
    scenarioRun: runId,
    scenarioStep: 'social',
    scenarioMode: null,
  });
  expect(readWorkspacePage('?page=scenario&scenario=black-friday&mode=manual').scenarioMode).toBe('manual');
  expect(readWorkspacePage('?page=scenario&scenario=black-friday&mode=unknown').scenarioMode).toBeNull();
  expect(readWorkspacePage('?page=explore&mode=agent').scenarioMode).toBeNull();

  // Switching scenarios clears mode unless explicitly set.
  const switched = new URL(workspacePageHref(agentMode.href, { scenario: 'ai-influencer' }), origin);
  expect(switched.pathname).toBe('/scenarios/ai-influencer');
  expect(switched.searchParams.has('mode')).toBe(false);
  expect(readWorkspacePage(switched.search, switched.hash, switched.pathname)).toMatchObject({ scenario: 'ai-influencer', scenarioMode: null });

  // Leaving scenario clears scenario, run, step, mode and category.
  const returned = new URL(workspacePageHref(agentMode.href, { explore: true }), origin);
  expect(returned.href).toBe(origin);
  expect(returned.searchParams.has('scenario')).toBe(false);
  expect(returned.searchParams.has('run')).toBe(false);
  expect(returned.searchParams.has('step')).toBe(false);
  expect(returned.searchParams.has('mode')).toBe(false);
  expect(returned.searchParams.has('category')).toBe(false);

  // Unknown scenario falls back to scenarioHub; invalid run UUID and unknown step are ignored.
  expect(readWorkspacePage('?page=scenario&scenario=does-not-exist&mode=agent')).toMatchObject({
    scenarioHub: true,
    scenario: null,
    scenarioRun: null,
    scenarioStep: null,
    scenarioMode: null,
  });
  expect(readWorkspacePage('?page=scenario&scenario=black-friday&run=not-a-uuid&step=unknown-step')).toMatchObject({
    scenarioHub: false,
    scenario: 'black-friday',
    scenarioRun: null,
    scenarioStep: null,
  });
  expect(isWorkspaceSettingsPage('?page=scenario&scenario=black-friday')).toBe(true);
  expect(isWorkspaceSettingsPage('?page=scenarios')).toBe(true);
});

it.each([
  ['text-to-image', '/create/text-to-image'],
  ['image-edit', '/create/image-edit'],
  ['text-to-video', '/create/text-to-video'],
  ['image-to-video', '/create/image-to-video'],
  ['music', '/audio/music'],
  ['speech', '/audio/speech'],
] as const)('routes the %s media editor destination to the unified top-tab editor', (scene, href) => {
  const destination = mediaEditorDestination(scene);
  expect(workspacePageHref('http://localhost/?page=explore', { studio: destination })).toBe(href);
  const parsed = new URL(href, 'http://localhost');
  expect(readWorkspacePage(parsed.search, parsed.hash, parsed.pathname).studio).toMatchObject({ scene: { id: scene } });
  expect(mediaEditorDestination(studioScenes.find(item => item.id === scene)!, 'p:m')).toMatchObject({ scene: { id: scene }, model: 'p:m' });
});

it('keeps a Cinema template on the unified video editor and on legacy Cinema links', () => {
  const create = workspacePageHref('http://localhost/?page=cinema', { studio: mediaEditorDestination('text-to-video'), cinemaTemplate: 'drink-splash-slow-motion' });
  expect(create).toBe('/create/text-to-video?cinemaTemplate=drink-splash-slow-motion');
  const parsedCreate = new URL(create, 'http://localhost');
  expect(readWorkspacePage(parsedCreate.search, parsedCreate.hash, parsedCreate.pathname)).toMatchObject({ cinemaTemplate: 'drink-splash-slow-motion', studio: { landing: true, scene: { id: 'text-to-video' } } });
  expect(readWorkspacePage('?page=cinema&scene=text-to-video&cinemaTemplate=drink-splash-slow-motion'))
    .toMatchObject({ cinemaTemplate: 'drink-splash-slow-motion', studio: { studio: { id: 'cinema' }, scene: { id: 'text-to-video' } } });
  expect(readWorkspacePage('?page=create&scene=image-to-video&cinemaTemplate=drink-splash-slow-motion').cinemaTemplate).toBeUndefined();
  expect(workspacePageHref('http://localhost/', { studio: mediaEditorDestination('image-to-video'), cinemaTemplate: 'drink-splash-slow-motion' })).toBe('/create/image-to-video');
});

it.each(['text-to-image', 'image-edit', 'remove-background', 'relight', 'character'] as const)('opens a bookmarked Design Studio %s link in the unified Image editor', scene => {
  const page = readWorkspacePage(`?page=design&scene=${scene}&model=p%3Am`);
  expect(page).toMatchObject({ studio: { landing: true, scene: { id: scene }, model: 'p:m' } });
  expect(page.designScene).toBeUndefined();
  expect(isLegacyWorkspaceHref(`?page=design&scene=${scene}`, page)).toBe(true);
  expect(isLegacyWorkspaceHref('', page, `/design/${scene}`)).toBe(true);
  expect(workspacePageHref(`http://localhost/?page=design&scene=${scene}&model=p%3Am`, { studio: page.studio })).toBe(`/create/${scene}?model=p%3Am`);
});

it.each(['prototype', 'deck', 'document', 'web-clone', 'projects'])('keeps the Design Studio %s page for HTML design work', scene => {
  const page = readWorkspacePage(`?page=design&scene=${scene}`);
  expect(page).toMatchObject({ designScene: scene, studio: null });
  expect(isLegacyWorkspaceHref(`?page=design&scene=${scene}`, page)).toBe(false);
  expect(isLegacyWorkspaceHref('', page, `/design/${scene}`)).toBe(false);
});

it('restores a Skill brief in the unified editor and ignores unknown Skills there', () => {
  const href = workspacePageHref('http://localhost/?page=marketing&skill=openmotion-ad-script', { studio: mediaEditorDestination('text-to-video') });
  expect(href).toBe('/create/text-to-video?skill=openmotion-ad-script');
  const parsed = new URL(href, 'http://localhost');
  expect(readWorkspacePage(parsed.search, parsed.hash, parsed.pathname)).toMatchObject({ skill: 'openmotion-ad-script', studio: { landing: true } });
  expect(readWorkspacePage('?page=create&scene=text-to-video&skill=unknown').skill).toBeNull();
});

it('still parses bookmarked legacy Studio scene links', () => {
  expect(readWorkspacePage('?page=cinema&scene=text-to-video').studio).toMatchObject({ studio: { id: 'cinema' }, scene: { id: 'text-to-video' } });
  expect(readWorkspacePage('?page=sound&scene=music').studio).toMatchObject({ studio: { id: 'sound' }, scene: { id: 'music' } });
});
