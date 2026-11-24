import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildTemplatePublication, finalizeTemplateSnapshot, publishTemplateCatalog, releaseCatalogPromotion } from '../.github/scripts/publish-template-catalog.mjs';

const commit = 'a'.repeat(40);

test('prepared release snapshot becomes the pointer only after an exact candidate and digest match', async t => {
  const root = await fixture(t);
  const objects = new Map(), writes = [];
  const candidate = { version: '0.1.2', sourceCommit: commit, tgzSHA256: 'b'.repeat(64) };
  const storage = { endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases',
    run: async (_, args) => {
      if (args.includes('list-objects-v2')) return '{}';
      const key = args[args.indexOf('--key') + 1];
      writes.push(key);
      objects.set(key, await readFile(args[args.indexOf('--body') + 1]));
      return '{}';
    },
    fetcher: async url => {
      const body = objects.get(new URL(url).pathname.slice(1));
      return body ? new Response(body) : new Response('', { status: 404 });
    },
  };
  const staged = await publishTemplateCatalog(root, { ...storage, mode: 'release', version: candidate.version, commit, promote: false });
  const pointer = 'open-motion/templates/releases/catalog.json', before = writes.length;
  assert(!writes.includes(pointer));
  const receipt = { ...staged, tgzSHA256: candidate.tgzSHA256 };
  await assert.rejects(finalizeTemplateSnapshot(candidate, { ...receipt, tgzSHA256: '0'.repeat(64) }, { ...storage, promote: true }));
  await assert.rejects(finalizeTemplateSnapshot(candidate, { ...receipt, catalogSHA256: '0'.repeat(64) }, { ...storage, promote: true }), /bytes differ/);
  await finalizeTemplateSnapshot(candidate, receipt, { ...storage, promote: false });
  assert.equal(writes.length, before);
  const promoted = await finalizeTemplateSnapshot(candidate, receipt, { ...storage, promote: true });
  assert.equal(promoted.promoted, true);
  assert.deepEqual(writes.slice(before), [pointer]);
  assert.deepEqual(objects.get(pointer), objects.get(staged.snapshotKey + '/catalog.json'));
});

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'openmotion-template-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'library/templates/catalog/motion-fixture/source/assets');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(root, 'library/templates/catalog/catalog.json'), JSON.stringify({ schemaVersion: 1, publication: { resourceId: 'x', defaultLocale: 'en', locales: ['en'] }, templateIds: ['motion-fixture'], localeContent: { en: {} } }));
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/template.json'), JSON.stringify({ templateId: 'motion-fixture', entry: { templateId: 'motion-fixture', sortOrder: 1, original: { templateName: 'Fixture' }, files: [] }, locales: { en: {} } }));
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/TEMPLATE.md'), '# Fixture\n');
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/source/manifest.json'), JSON.stringify({ schema: 'motion-package-v1', files: [{ path: 'scene.motion', bytes: 12, sha256: 'placeholder' }] }));
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/source/scene.motion'), 'motion content');
  await writeFile(path.join(directory, 'data.bin'), Buffer.from([1, 2, 3, 4]));
  return root;
}

test('template publication mirrors arbitrary source files and reuses content-addressed objects', async t => {
  const root = await fixture(t);
  const built = await buildTemplatePublication(root, commit, { origin: 'https://cdn.example.com' });
  const keys = built.uploads.map(file => file.key);
  assert(keys.includes(`open-motion/templates/snapshots/${commit}/motion-fixture/source/manifest.json`));
  assert(keys.includes(`open-motion/templates/snapshots/${commit}/motion-fixture/hosted-files.json`));
  assert(!keys.some(key => key.includes('/source/scene.motion')));
  assert.equal(keys.filter(key => key.includes('/objects/')).length, 2);
  const sidecar = JSON.parse(await readFile(built.uploads.find(file => file.key.endsWith('/hosted-files.json')).body, 'utf8'));
  assert.deepEqual(sidecar.files.map(file => file.path), ['assets/data.bin', 'scene.motion']);
  await rm(built.staging, { recursive: true, force: true });

  const calls = [], pointerBodies = new Map();
  const run = async (command, args) => {
    assert.equal(command, 'aws');
    if (args.includes('list-objects-v2')) return JSON.stringify({ Contents: [{ Key: 'open-motion/templates/objects/' + sidecar.files[0].sha256 }] });
    const key = args[args.indexOf('--key') + 1];
    const body = args[args.indexOf('--body') + 1];
    calls.push(key);
    if (key === 'open-motion/templates/main/catalog.json') pointerBodies.set(key, body);
    return '{}';
  };
  const result = await publishTemplateCatalog(root, { mode: 'main', commit, endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases', origin: 'https://cdn.example.com', run,
    fetcher: async () => new Response(await readFile(pointerBodies.get('open-motion/templates/main/catalog.json'))) });
  assert.equal(result.reused, 1);
  assert.equal(result.pointerUrl, 'https://cdn.example.com/open-motion/templates/main/catalog.json');
  assert(calls.includes(result.snapshotKey + '/catalog.json'));
});

test('template publication rejects symlinks without restricting ordinary extensions', async t => {
  const root = await fixture(t);
  await symlink('/tmp', path.join(root, 'library/templates/catalog/motion-fixture/source/link'));
  await assert.rejects(buildTemplatePublication(root, commit), /symbolic links/);
});

test('release publication uses its source snapshot and never changes the moving main pointer', async t => {
  const root = await fixture(t), uploads = new Map();
  const version = '0.7.0-test.1';
  const pointerKey = 'open-motion/templates/releases/catalog.json';
  let active = 0, maximumActive = 0;
  const result = await publishTemplateCatalog(root, { mode: 'release', version, commit,
    endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases',
    run: async (_, args) => {
      if (args.includes('list-objects-v2')) return '{}';
      const key = args[args.indexOf('--key') + 1];
      assert.equal(args.includes('--if-none-match'), key !== pointerKey, 'Only the shared release pointer may change');
      if (key === pointerKey) {
        assert.equal(args[args.indexOf('--cache-control') + 1], 'public, max-age=60, must-revalidate');
        assert.equal(active, 0, 'All snapshot uploads must finish before the pointer');
        assert(uploads.has(`open-motion/templates/snapshots/${commit}/catalog.json`));
      }
      active++; maximumActive = Math.max(maximumActive, active);
      try { uploads.set(key, await readFile(args[args.indexOf('--body') + 1])); }
      finally { active--; }
      return '{}';
    },
    fetcher: async url => {
      assert.equal(url, `https://releases.open-design.ai/${pointerKey}`);
      return new Response(uploads.get(pointerKey));
    },
  });
  assert.equal(result.commit, commit);
  assert.equal(JSON.parse(uploads.get(pointerKey)).commit, commit);
  assert(!uploads.has('open-motion/templates/main/catalog.json'));
  assert(maximumActive > 1 && maximumActive <= 12);
});

test('successive software releases update the same catalog URL while recovery and superseded releases preserve it', async t => {
  const root = await fixture(t), objects = new Map(), writes = [];
  const pointerKey = 'open-motion/templates/releases/catalog.json';
  const publish = (version, sourceCommit, phase = 'verified') => publishTemplateCatalog(root, {
    mode: 'release', version, commit: sourceCommit,
    promote: releaseCatalogPromotion(version, { version, phase }),
    endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases',
    run: async (_, args) => {
      if (args.includes('list-objects-v2')) return '{}';
      const key = args[args.indexOf('--key') + 1];
      writes.push(key);
      objects.set(key, await readFile(args[args.indexOf('--body') + 1]));
      return '{}';
    },
    fetcher: async url => new Response(objects.get(new URL(url).pathname.slice(1))),
  });
  const first = await publish('0.7.0-test.1', commit);
  const nextCommit = 'b'.repeat(40);
  const second = await publish('0.7.0', nextCommit);
  assert.equal(first.pointerUrl, 'https://releases.open-design.ai/' + pointerKey);
  assert.equal(second.pointerUrl, first.pointerUrl);
  assert.equal(JSON.parse(objects.get(pointerKey)).commit, nextCommit);
  const expected = objects.get(pointerKey);
  for (const phase of ['version-verified', 'superseded']) {
    const result = await publish('0.7.0-test.1', commit, phase);
    assert.equal(result.promoted, false);
    assert.equal(result.pointerKey, `open-motion/templates/snapshots/${commit}/catalog.json`);
    assert(objects.get(pointerKey).equals(expected));
  }
  assert.equal(writes.filter(key => key === pointerKey).length, 2);
  assert(!writes.some(key => key === 'open-motion/templates/main/catalog.json' || /\/releases\/[^/]+\//.test(key)));
  assert.throws(() => releaseCatalogPromotion('0.7.0', { version: '0.7.1', phase: 'verified' }), /match/);
  assert.throws(() => releaseCatalogPromotion('0.7.0', { version: '0.7.0', phase: 'fixed-write-attempted' }), /completed/);
});

test('failed snapshot uploads leave the main pointer untouched and remove staging after uploads settle', async t => {
  const root = await fixture(t), keys = [];
  let stagedFile;
  await assert.rejects(publishTemplateCatalog(root, { commit,
    endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases',
    run: async (_, args) => {
      if (args.includes('list-objects-v2')) return '{}';
      const key = args[args.indexOf('--key') + 1]; keys.push(key);
      if (key.endsWith('/hosted-files.json')) {
        stagedFile = args[args.indexOf('--body') + 1];
        await readFile(stagedFile);
      }
      if (key.endsWith('/template.json')) throw new Error('Storage unavailable');
      return '{}';
    },
    fetcher: async () => { throw new Error('Pointer must not be verified after an upload failure'); },
  }), /Storage unavailable/);
  assert(!keys.includes('open-motion/templates/main/catalog.json'));
  assert(stagedFile);
  await assert.rejects(readFile(stagedFile), { code: 'ENOENT' });
});

test('unfetched LFS pointers fail before publication starts', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'library/templates/catalog/motion-fixture/source/scene.motion'), `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 1234\n`);
  await assert.rejects(publishTemplateCatalog(root, { commit,
    endpoint: 'https://abc123.r2.cloudflarestorage.com', bucket: 'open-design-releases',
    run: async () => assert.fail('No storage writes may occur with missing LFS bytes'),
  }), /Fetch Git LFS template bytes/);
});
