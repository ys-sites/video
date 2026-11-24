import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { readProjectAssetNames } from '../project-asset-names.ts';
import { startWorkspaceStudio } from '../shared/workspace-studio.ts';

const api = (store: any) => new Phase1Service(store, pluginRoot, {
  origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {},
});

test('project naming language and metadata-only asset renames survive reads, retries and conflicts', () => fixture(async store => {
  const service = api(store);
  const project = await service.call('openmotion_create_project', {
    requestId: 'naming-project', projectType: 'natural_language', title: 'Dia', requirements: '制作中文介绍', namingLanguage: 'zh-CN',
  });
  assert.equal(project.namingLanguage, 'zh-CN');
  const scoped = store.forProject(project.projectId);
  const assetPath = 'assets/94dcfb95-f8f9-455d-bca3-382788fa3943.m4a';
  await mkdir(path.join(scoped.projectDirectory, 'assets'), { recursive: true });
  await writeFile(path.join(scoped.projectDirectory, assetPath), 'unchanged audio bytes');
  await writeFile(path.join(scoped.projectDirectory, 'motion-assets.json'), JSON.stringify([
    { path: assetPath, assetId: 'original-id', name: 'original-audio.m4a' },
  ]));
  const before = await service.call('openmotion_get_project', { projectId: project.projectId });
  assert.equal(before.assetNames[assetPath], 'original-audio');
  const input = { projectId: project.projectId, requestId: 'rename-audio', expectedRevision: before.revision,
    expectedVersionId: before.currentVersionId, files: [], assetNames: [{ path: assetPath, name: 'Dia 参考视频－原声' }] };
  const saved = await service.call('openmotion_edit_project', input);
  assert.equal(saved.assetNames[assetPath], 'Dia 参考视频－原声');
  const replay = await service.call('openmotion_edit_project', input);
  assert.equal(replay.version.versionId, saved.version.versionId);
  assert.deepEqual(replay.assetNames, JSON.parse(JSON.stringify(saved.assetNames)));
  const after = await api(store).call('openmotion_get_project', { projectId: project.projectId });
  assert.equal(after.namingLanguage, 'zh-CN');
  assert.equal(after.assets[0].assetId, 'original-id');
  assert.equal(after.assets[0].originalName, 'original-audio.m4a');
  assert.equal(await readFile(path.join(scoped.projectDirectory, assetPath), 'utf8'), 'unchanged audio bytes');
  assert.equal(after.assetNames[assetPath], 'Dia 参考视频－原声');
  await assert.rejects(service.call('openmotion_edit_project', { ...input, requestId: 'stale', namingLanguage: 'en' }), /VERSION_CONFLICT/);
  assert.equal((await service.call('openmotion_get_project', { projectId: project.projectId })).namingLanguage, 'zh-CN');
}, false));

test('anonymous and duplicate captions keep their allocation across additions, removals and fresh readers', () => fixture(async store => {
  const service = api(store);
  const project = await service.call('openmotion_create_project', { requestId: 'stable', projectType: 'natural_language', title: 'Names', requirements: 'x', namingLanguage: 'zh-CN' });
  const scoped = store.forProject(project.projectId);
  const oldPath = 'assets/ffffffff-ffff-4fff-8fff-ffffffffffff.svg';
  const addedPath = 'assets/00000000-0000-4000-8000-000000000000.svg';
  await mkdir(path.join(scoped.projectDirectory, 'assets'), { recursive: true });
  await writeFile(await scoped.safePath(oldPath), '<svg/>');
  const first = await readProjectAssetNames(scoped);
  assert.equal(first.assetNames[oldPath], '图片 1');
  await writeFile(await scoped.safePath(addedPath), '<svg/>');
  const revision = (await scoped.get()).revision;
  const concurrent = await Promise.all([readProjectAssetNames(scoped), readProjectAssetNames(store.forProject(project.projectId))]);
  const second = concurrent[0];
  assert.deepEqual(second, concurrent[1]);
  assert.equal(second.assetNames[oldPath], '图片 1');
  assert.equal(second.assetNames[addedPath], '图片 2');
  assert.equal((await scoped.get()).revision, revision, 'Presentation allocation must not change source revisions');
  const records = [{ path: oldPath, name: 'Cover' }, { path: addedPath, name: 'Cover' }];
  await writeFile(await scoped.safePath('motion-assets.json'), JSON.stringify([records[0]]));
  assert.equal((await readProjectAssetNames(scoped)).assetNames[oldPath], 'Cover');
  await writeFile(await scoped.safePath('motion-assets.json'), JSON.stringify(records));
  const duplicates = await readProjectAssetNames(scoped);
  assert.equal(duplicates.assetNames[oldPath], 'Cover');
  assert.equal(duplicates.assetNames[addedPath], 'Cover (2)');
  const { rm } = await import('node:fs/promises');
  await rm(await scoped.safePath(oldPath));
  assert.equal((await readProjectAssetNames(scoped)).assetNames[addedPath], 'Cover (2)');
}, false));

test('ICO and EOT display renames retain storage paths and bytes through the public contract', () => fixture(async store => {
  const service = api(store);
  const project = await service.call('openmotion_create_project', { requestId: 'formats', projectType: 'natural_language', title: 'Formats', requirements: 'x' });
  const scoped = store.forProject(project.projectId);
  await mkdir(path.join(scoped.projectDirectory, 'assets'), { recursive: true });
  for (const extension of ['ico', 'eot']) {
    const asset = `assets/source.${extension}`;
    await writeFile(await scoped.safePath(asset), 'naming-only fixture');
    const before = await service.call('openmotion_get_project', { projectId: project.projectId });
    assert.equal(before.assetNames[asset], 'source');
    const saved = await service.call('openmotion_edit_project', { projectId: project.projectId, requestId: extension,
      expectedRevision: before.revision, expectedVersionId: before.currentVersionId, files: [], assetNames: [{ path: asset, name: `Readable ${extension}` }] });
    assert.equal(saved.assetNames[asset], `Readable ${extension}`);
    assert.equal(await readFile(await scoped.safePath(asset), 'utf8'), 'naming-only fixture');
  }
}, false));

test('native deletion clears only deleted file or directory names before same-path reupload', () => fixture(async store => {
  const studio = await startWorkspaceStudio(pluginRoot, store.directory, store.projectDirectory, 0);
  const target = 'assets/replaceable.png';
  const index = await store.safePath('motion-assets.json');
  const upload = async (bytes: string) => {
    const form = new FormData(); form.append('file', new Blob([bytes]), 'replaceable.png');
    const response = await fetch(`${studio.origin}/api/projects/${store.projectId}/upload?dir=assets`, { method: 'POST', headers: { Origin: studio.origin }, body: form });
    assert.equal(response.status, 201);
  };
  const remove = (file: string) => fetch(`${studio.origin}/api/projects/${store.projectId}/files/${encodeURIComponent(file)}`, { method: 'DELETE', headers: { Origin: studio.origin } });
  try {
    await upload('old bytes');
    await writeFile(index, JSON.stringify([{ path: target, name: 'Old red cover', nameSource: 'user' }]));
    assert.equal((await readProjectAssetNames(store)).assetNames[target], 'Old red cover');
    assert.equal((await remove('../outside.svg')).status, 400);
    assert.equal((await remove('assets/missing.png')).status, 404);
    assert.equal(JSON.parse(await readFile(index, 'utf8'))[0].name, 'Old red cover');
    assert.equal((await remove(target)).status, 200);
    await upload('different blue bytes');
    assert.notEqual((await readProjectAssetNames(store)).assetNames[target], 'Old red cover');
    await mkdir(await store.safePath('assets/group'), { recursive: true });
    await writeFile(await store.safePath('assets/group/a.svg'), '<svg/>');
    const remaining = { path: target, name: 'Keep me' };
    await writeFile(index, JSON.stringify([{ path: 'assets/group/a.svg', name: 'Remove me' }, { path: 'assets/group-other.svg', name: 'Other prefix' }, remaining]));
    assert.equal((await remove('assets/group')).status, 200);
    assert.deepEqual(JSON.parse(await readFile(index, 'utf8')), [{ path: 'assets/group-other.svg', name: 'Other prefix' }, remaining]);
    const nested = 'assets/files/中文 名称.svg';
    await mkdir(await store.safePath('assets/files'), { recursive: true });
    await writeFile(await store.safePath(nested), '<svg/>');
    await writeFile(index, JSON.stringify([{ path: nested, name: 'Nested file' }, remaining]));
    assert.equal((await remove(nested)).status, 200);
    assert.deepEqual(JSON.parse(await readFile(index, 'utf8')), [remaining]);
  } finally { await studio.close(); }
}));

test('display names preserve meaningful sources, parse unnamed fonts and localize anonymous media', async () => {
  const { projectAssetNames } = await import('../shared/asset-names.ts');
  const uuid = '40da8f95-f670-4cbf-87cc-6f843570b7da';
  const records = [
    { path: `assets/${uuid}.woff2`, name: `${uuid}.woff2`, font: { family: 'Inter', weight: 700, style: 'italic' } },
    { path: 'assets/b.m4a', name: '产品介绍－旁白.m4a' },
    { path: 'assets/c.m4a', name: '产品介绍－旁白.m4a' },
    { path: `assets/${uuid}.m4a`, name: `${uuid}.m4a` },
  ];
  const paths = records.map(item => item.path);
  const names = projectAssetNames(paths, records, 'zh-CN');
  assert.equal(names[paths[0]], 'Inter 700 italic');
  assert.equal(names[paths[1]], '产品介绍－旁白');
  assert.equal(names[paths[2]], '产品介绍－旁白 (2)');
  assert.equal(names[paths[3]], '音频 1');
  assert.equal(projectAssetNames(paths, records, 'ja')[paths[3]], '音声 1');
  assert.equal(projectAssetNames(paths, records, 'pt-BR')[paths[3]], 'Áudio 1');
  assert.equal(records[0].name, `${uuid}.woff2`);
});

test('invalid language or asset-name batches leave metadata unchanged', () => fixture(async store => {
  const service = api(store);
  await assert.rejects(service.call('openmotion_create_project', {
    requestId: 'bad-lang', projectType: 'natural_language', title: 'x', requirements: 'x', namingLanguage: 'not a locale',
  }), /INVALID_NAMING_LANGUAGE/);
  const project = await service.call('openmotion_create_project', {
    requestId: 'legacy-language', projectType: 'natural_language', title: 'x', requirements: 'x',
  });
  assert.equal(project.namingLanguage, null);
  const input = { projectId: project.projectId, requestId: 'bad-name-batch', expectedRevision: project.revision,
    expectedVersionId: project.currentVersionId, files: [], namingLanguage: 'en', assetNames: [{ path: 'index.html', name: 'New name' }] };
  await assert.rejects(service.call('openmotion_edit_project', input), /INVALID_ASSET_PATH/);
  assert.equal((await service.call('openmotion_get_project', { projectId: project.projectId })).revision, project.revision);
}, false));
