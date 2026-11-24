import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { repairCodeExtrudeMaterial } from '../shared/registry-material-compat.ts';

const template = readFileSync(new URL('../library/skills/openmotion-design-remix/assets/code-3d-extrude/index.html', import.meta.url), 'utf8');
const original = `          var edgeMat = new THREE.MeshStandardMaterial({
            color: 0x141d2b,
            roughness: 0.3,
            metalness: 0.4,
          });
`;

test('catalog repair is idempotent and preserves unrelated/custom materials', () => {
  const fixed = repairCodeExtrudeMaterial(original);
  assert.notEqual(fixed, original);
  assert.equal(repairCodeExtrudeMaterial(fixed), fixed);
  const custom = original.replace('0.3', '0.8');
  assert.equal(repairCodeExtrudeMaterial(custom), custom);
  assert.equal(repairCodeExtrudeMaterial('<main>Other composition</main>'), '<main>Other composition</main>');
});

test('the shipped and repaired bevels never request derivatives, including after context restoration', () => {
  for (const source of [repairCodeExtrudeMaterial(original), template]) {
    const start = source.indexOf('var edgeMat =');
    const end = source.indexOf('});', start) + 3;
    const script = source.slice(start, end) + '\nedgeMat;';
    for (const phase of ['initial WebGL2', 'WebGL1 without derivatives', 'restored context']) {
      const material = runInNewContext(script, {
        THREE: {
          MeshStandardMaterial: function () { assert.fail('Bevel must not compile a derivative-dependent shader: ' + phase); },
          MeshPhongMaterial: function (options: object) { return { type: 'phong', options }; },
        },
        renderer: new Proxy({}, { get() { assert.fail('Bevel must not rely on cached context capabilities'); } }),
      });
      assert.equal(material.type, 'phong');
      assert.equal(material.options.color, 0x141d2b);
      assert.equal(material.options.shininess, 30);
    }
  }
});
