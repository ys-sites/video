import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { attributeGuide } from '../workers/install-guide/index.ts';

const guide = '<!-- openmotion-utm-source-supported -->\n`openmotion setup --host codex`\n`openmotion setup --host deepseek --profile PROFILE`\n`openmotion prepare`';

test('install Worker keeps direct guides unchanged and annotates only supported setup commands', async () => {
  assert.equal(attributeGuide(guide, null), guide);
  assert.equal(attributeGuide(guide, '$(bad)'), guide);
  assert.equal(attributeGuide('openmotion setup --host codex', 'producthunt'), 'openmotion setup --host codex');
  const env = { RELEASES: { async get(key: string) {
    assert.equal(key, 'open-motion/dev/install.md');
    return { body: new Response(guide).body!, text: async () => guide, writeHttpMetadata() {} };
  } } };
  const direct = await worker.fetch(new Request('https://releases.open-design.ai/open-motion/dev/install.md'), env);
  const attributed = await worker.fetch(new Request('https://releases.open-design.ai/open-motion/dev/install.md?utm_source=producthunt'), env);
  assert.equal(direct.headers.get('cache-control'), 'no-store');
  assert.equal(attributed.headers.get('cache-control'), 'no-store');
  assert.equal(await direct.text(), guide);
  const text = await attributed.text();
  assert.match(text, /setup --host codex --utm-source producthunt/);
  assert.match(text, /setup --host deepseek --utm-source producthunt --profile PROFILE/);
  assert.match(text, /`openmotion prepare`/);
});

test('install Worker maps public guide hosts to their stable and test objects', async () => {
  const testHost = 'open-design' + '.powerformer.net';
  const requested: string[] = [];
  const env = { RELEASES: { async get(key: string) {
    requested.push(key);
    return { body: new Response(guide).body!, text: async () => guide, writeHttpMetadata() {} };
  } } };
  const stable = await worker.fetch(new Request('https://open-design.ai/motion/install.md'), env);
  const testGuide = await worker.fetch(new Request(`https://${testHost}/motion/install.md`), env);
  const unknown = await worker.fetch(new Request('https://unknown.example/motion/install.md'), env);
  assert.equal(stable.status, 200);
  assert.equal(testGuide.status, 200);
  assert.equal(unknown.status, 404);
  assert.deepEqual(requested, ['open-motion/install.md', 'open-motion/dev/install.md']);
});
