import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installLibrarySkill } from '../scripts/install-library-skill.mjs';

const pairs = { brandkit: 'openmotion-brandkit', 'presenter-story': 'openmotion-presenter-story', 'motion-design-remix': 'openmotion-design-remix' };
// Original published forwarding bytes, retained only as migration test data.
const aliases = JSON.parse(await readFile(new URL('./legacy-library-aliases.json', import.meta.url), 'utf8'));
async function isolated(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'openmotion-library-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function legacyFixture(root, old) {
  const directory = path.join(root, old);
  for (const [file, content] of Object.entries(aliases[old])) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), content);
  }
  return directory;
}

for (const [old, canonical] of Object.entries(pairs)) {
  test(`standalone ${canonical} removes its unchanged retired entry and reuses one payload`, async t => {
    const root = await isolated(t), destination = path.join(root, 'skills');
    await legacyFixture(destination, old);
    const result = await installLibrarySkill(canonical, destination);
    assert.deepEqual(await readdir(destination), [canonical]);
    assert.equal(result.entry, path.join(destination, canonical, 'SKILL.md'));
    assert.deepEqual(result.removedLegacy, [old]);
    assert.deepEqual(result.preservedLegacy, []);
    assert.equal(await readFile(result.entry, 'utf8'), await readFile(`library/skills/${canonical}/SKILL.md`, 'utf8'));
    assert.deepEqual((await installLibrarySkill(canonical, destination)).installed, [canonical]);
    assert.deepEqual(await readdir(destination), [canonical]);
    if (old === 'presenter-story') {
      assert((await readFile(path.join(destination, canonical, 'references/workflow-demo/MOTION_DESIGN.md'), 'utf8')).length > 100);
      assert((await readFile(path.join(destination, canonical, 'assets/john-tagudin-capso-result.mp4'))).length > 1000);
    }
    if (old === 'motion-design-remix') {
      for (const id of ['ui-3d-reveal', 'wireframe-portal-title', 'canopy-part-title', 'code-3d-extrude', 'code-particle-assemble', 'liquid-glass-widgets']) {
        const output = path.join(root, id);
        const invoked = spawnSync(process.execPath, [path.join(destination, canonical, 'scripts/materialize.mjs'), id, 'remix', output], { cwd: root, encoding: 'utf8' });
        assert.equal(invoked.status, 0, invoked.stderr);
        assert((await readFile(path.join(output, 'index.html'), 'utf8')).length > 100);
        assert((await readFile(path.join(output, 'vendor/manifest.json'), 'utf8')).length > 100);
      }
    }
    await assert.rejects(installLibrarySkill(old, destination), /Unknown Library Skill/);
  });
}

test('standalone openmotion-growth-teardown installs without a retired entry', async t => {
  const root = await isolated(t), destination = path.join(root, 'skills');
  const result = await installLibrarySkill('openmotion-growth-teardown', destination);
  assert.deepEqual(await readdir(destination), ['openmotion-growth-teardown']);
  assert.deepEqual(result.removedLegacy, []);
  assert.deepEqual(result.preservedLegacy, []);
  const check = spawnSync(process.execPath, [path.join(destination, 'openmotion-growth-teardown/scripts/build.mjs'), '--check', 'tests/fixtures/growth-teardown.json'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

for (const [id, file, ok] of [
  ['openmotion-sale-promo', 'offer.json', /\$89 → \$53\.40 \(40% off, save \$35\.60\)/],
  ['openmotion-sale-countdown', 'countdown.json', /starts in 6 days/],
  ['openmotion-sale-carousel', 'carousel.json', /Court Sneaker \$95→\$66\.50/],
]) {
  test(`standalone ${id} --check computes the prices and dates it will show`, async t => {
    const root = await isolated(t), destination = path.join(root, 'skills');
    await installLibrarySkill(id, destination);
    const check = spawnSync(process.execPath, [path.join(destination, id, 'scripts/build.mjs'), '--check', `tests/fixtures/holiday-sale/${file}`], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, ok);
  });
}

test('sale prices are computed in whole cents', async t => {
  const root = await isolated(t), data = JSON.parse(await readFile('tests/fixtures/holiday-sale/offer.json', 'utf8'));
  data.product.was = 2.01; data.product.discount = { percent: 50 };
  const file = path.join(root, 'offer.json'); await writeFile(file, JSON.stringify(data));
  const check = spawnSync(process.execPath, [path.resolve('library/skills/openmotion-sale-promo/scripts/build.mjs'), '--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /\$2\.01 → \$1\.01 \(50% off, save \$1\)/);
});

test('the three holiday-sale Skills ship identical film.mjs helpers', async () => {
  const copies = await Promise.all(['promo', 'countdown', 'carousel'].map(name => readFile(`library/skills/openmotion-sale-${name}/scripts/film.mjs`, 'utf8')));
  assert.equal(copies[1], copies[0], 'openmotion-sale-countdown/scripts/film.mjs differs from the canonical openmotion-sale-promo copy');
  assert.equal(copies[2], copies[0], 'openmotion-sale-carousel/scripts/film.mjs differs from the canonical openmotion-sale-promo copy');
});

test('sale prices use each currency\'s own minor unit', async t => {
  const root = await isolated(t), base = JSON.parse(await readFile('tests/fixtures/holiday-sale/offer.json', 'utf8'));
  const cases = [
    ['KWD', d => { d.product.was = 1.005; d.product.now = 0.5; delete d.product.discount; }, /KWD\s?1\.005 → KWD\s?0\.5\d* \(50% off, save KWD\s?0\.505\)/],
    ['JPY', d => { d.product.was = 9800; d.product.discount = { percent: 30 }; }, /¥9,800 → ¥6,860 \(30% off, save ¥2,940\)/],
  ];
  for (const [currency, edit, expected] of cases) {
    const data = structuredClone(base); data.currency = currency; edit(data);
    const file = path.join(root, `offer-${currency}.json`); await writeFile(file, JSON.stringify(data));
    const check = spawnSync(process.execPath, [path.resolve('library/skills/openmotion-sale-promo/scripts/build.mjs'), '--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, expected);
  }
});

test('holiday-sale --check rejects offers that would show a wrong or impossible number', async t => {
  const root = await isolated(t);
  const cases = [
    ['openmotion-sale-promo', 'offer.json', 'exactly one of', d => { d.product.now = 50; }],
    ['openmotion-sale-promo', 'offer.json', 'must be above 0 and below was', d => { d.product.discount = { amount: 89 }; }],
    ['openmotion-sale-promo', 'offer.json', 'not after postDate', d => { d.postDate = '2026-12-02T00:00:00-05:00'; }],
    ['openmotion-sale-promo', 'offer.json', 'capital letters', d => { d.code = 'friday 40'; }],
    ['openmotion-sale-countdown', 'countdown.json', 'must be after postAt', d => { d.postAt = '2026-11-28T00:00:00-05:00'; }],
    ['openmotion-sale-countdown', 'countdown.json', 'too far out', d => { d.postAt = '2026-01-01T00:00:00-05:00'; }],
    ['openmotion-sale-carousel', 'carousel.json', 'use 3-7 products', d => { d.products = d.products.slice(0, 2); }],
    ['openmotion-sale-promo', 'offer.json', 'rounds to no discount', d => { d.product.was = 0.01; d.product.discount = { percent: 95 }; }],
    ['openmotion-sale-promo', 'offer.json', 'must be above 0 and below was', d => { d.product.discount = undefined; d.product.now = 88.999; }],
    ['openmotion-sale-countdown', 'countdown.json', 'target.date must be', d => { d.target.date = '2026-02-30T00:00:00Z'; }],
    ['openmotion-sale-carousel', 'carousel.json', 'was not found', d => { d.products[0].image = 'missing.jpg'; }],
  ];
  for (const [id, file, message, mutate] of cases) {
    const data = JSON.parse(await readFile(`tests/fixtures/holiday-sale/${file}`, 'utf8')); mutate(data);
    const dir = path.join(root, id); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'product.svg'), await readFile('tests/fixtures/holiday-sale/product.svg'));
    const target = path.join(dir, file); await writeFile(target, JSON.stringify(data));
    const check = spawnSync(process.execPath, [path.resolve(`library/skills/${id}/scripts/build.mjs`), '--check', target], { encoding: 'utf8' });
    assert.equal(check.status, 1, `${id} ${message}: ${check.stdout}${check.stderr}`);
    assert.match(check.stderr, new RegExp(message));
  }
});

test('growth-teardown --check rejects inputs the generator cannot render', async t => {
  const root = await isolated(t), fixture = JSON.parse(await readFile('tests/fixtures/growth-teardown.json', 'utf8'));
  const build = path.resolve('library/skills/openmotion-growth-teardown/scripts/build.mjs');
  const cases = {
    'needs 1-6 moves': d => { delete d.lanes[0].moves; },
    'must be a full http(s) URL': d => { d.lanes[0].moves[0].source.url = 'example.com/blog/free'; },
    'stat.value must be a number': d => { delete d.plays[0].stat; },
    'longer than 28 characters': d => { d.lanes[0].moves[0].label = 'x'.repeat(29); },
    'keep it under 220': d => { d.plays[0].instruction = 'x'.repeat(221); },
  };
  for (const [message, mutate] of Object.entries(cases)) {
    const data = structuredClone(fixture); mutate(data);
    const file = path.join(root, 'growth.json'); await writeFile(file, JSON.stringify(data));
    const check = spawnSync(process.execPath, [build, '--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 1, `${message}: ${check.stdout}${check.stderr}`);
    assert.match(check.stderr, new RegExp(message.replace(/[()]/g, '\\$&')));
    assert.doesNotMatch(check.stderr, /TypeError|ERR_INVALID_URL/);
  }
});

test('standalone openmotion-design-styles installs and its plan checker runs', async t => {
  const root = await isolated(t), destination = path.join(root, 'skills');
  await installLibrarySkill('openmotion-design-styles', destination);
  assert.deepEqual(await readdir(destination), ['openmotion-design-styles']);
  const script = path.join(destination, 'openmotion-design-styles/scripts/style.mjs');
  const list = spawnSync(process.execPath, [script, 'list'], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.equal(list.stdout.trim().split('\n').length, 23);
  const check = spawnSync(process.execPath, [script, 'check', 'tests/fixtures/design-styles.json'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('design-styles check rejects plans that would not read as the style', async t => {
  const root = await isolated(t), fixture = JSON.parse(await readFile('tests/fixtures/design-styles.json', 'utf8'));
  const script = path.resolve('library/skills/openmotion-design-styles/scripts/style.mjs');
  const cases = {
    'is not in the library': d => { d.style = 'vaporwave'; },
    'is not on the Swiss Style card': d => { d.colors.push('#00FF00'); },
    'keep it within 48': d => { d.scenes[1].headline = 'x'.repeat(49); },
    'move is required': d => { delete d.scenes[1].move; },
    'seconds must be a number between 1 and 12': d => { d.scenes[0].seconds = '2'; },
    'scenes add up to': d => { d.seconds = 30; },
    'OpenMotion end credit': d => { Object.assign(d.scenes.at(-1), { headline: 'Thanks', body: '', move: 'OpenMotion logo slides out' }); },
  };
  for (const [message, mutate] of Object.entries(cases)) {
    const data = structuredClone(fixture); mutate(data);
    const file = path.join(root, 'plan.json'); await writeFile(file, JSON.stringify(data));
    const check = spawnSync(process.execPath, [script, 'check', file], { encoding: 'utf8' });
    assert.equal(check.status, 1, `${message}: ${check.stdout}${check.stderr}`);
    assert.match(check.stderr, new RegExp(message));
  }
});

test('design-styles fonts leaves the project unchanged when a licence lookup fails', async t => {
  const root = await isolated(t);
  const script = path.resolve('library/skills/openmotion-design-styles/scripts/style.mjs');
  const project = path.join(root, 'project');
  await mkdir(project); await writeFile(path.join(project, 'fonts.css'), '/* existing */\n');
  // Font endpoints succeed; every google/fonts licence lookup 404s.
  const stub = path.join(root, 'stub-fetch.mjs');
  await writeFile(stub, `globalThis.fetch = async url => {
    const href = String(url);
    if (href.startsWith('https://fonts.googleapis.com/')) return new Response("@font-face{src:url(https://fonts.gstatic.com/x.woff2)}");
    if (href.startsWith('https://fonts.gstatic.com/')) return new Response(Buffer.from('wOF2stub'));
    return new Response('missing', { status: 404 });
  };\n`);
  const run = spawnSync(process.execPath, ['--import', stub, script, 'fonts', 'tests/fixtures/design-styles.json', project], { encoding: 'utf8' });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /licence text not found/);
  assert.equal(await readFile(path.join(project, 'fonts.css'), 'utf8'), '/* existing */\n');
  assert.deepEqual(await readdir(path.join(project, 'assets/fonts')).catch(() => []), []);
});

test('standalone cleanup preserves customized, extra-file and symlink legacy folders', async t => {
  const root = await isolated(t);
  for (const kind of ['customized', 'extra-file', 'symlink']) {
    const destination = path.join(root, kind), legacy = await legacyFixture(destination, 'brandkit');
    if (kind === 'customized') await writeFile(path.join(legacy, 'SKILL.md'), 'User-owned instructions');
    if (kind === 'extra-file') await writeFile(path.join(legacy, 'notes.md'), 'User notes');
    if (kind === 'symlink') {
      const original = path.join(root, 'original');
      await mkdir(original); await writeFile(path.join(original, 'SKILL.md'), 'User workflow');
      await rm(legacy, { recursive: true });
      await symlink(original, legacy, process.platform === 'win32' ? 'junction' : 'dir');
    }
    const before = await readFile(path.join(legacy, 'SKILL.md'), 'utf8');
    const result = await installLibrarySkill('openmotion-brandkit', destination);
    assert.deepEqual(result.removedLegacy, []);
    assert.deepEqual(result.preservedLegacy, ['brandkit']);
    assert.equal(await readFile(path.join(legacy, 'SKILL.md'), 'utf8'), before);
    if (kind === 'extra-file') assert.equal(await readFile(path.join(legacy, 'notes.md'), 'utf8'), 'User notes');
  }
});

test('installation preserves customized canonical content before attempting legacy cleanup', async t => {
  const root = await isolated(t);
  await installLibrarySkill('openmotion-brandkit', root);
  const legacy = await legacyFixture(root, 'brandkit');
  const file = path.join(root, 'openmotion-brandkit/SKILL.md');
  await writeFile(file, 'User-owned instructions');
  await assert.rejects(installLibrarySkill('openmotion-brandkit', root), /Existing Skill differs/);
  assert.equal(await readFile(file, 'utf8'), 'User-owned instructions');
  assert.equal(await readFile(path.join(legacy, 'SKILL.md'), 'utf8'), aliases.brandkit['SKILL.md']);
  await assert.rejects(installLibrarySkill('../foreign', root), /Unknown Library Skill/);
});

for (const canonical of ['openmotion-ad-script', 'openmotion-adaptive-layout', 'openmotion-ai-assistant-tour', 'openmotion-archive-collage', 'openmotion-article-illustrations', 'openmotion-aurora-gradient', 'openmotion-before-after', 'openmotion-bilingual-captions', 'openmotion-bold-type-poster', 'openmotion-bubble-field', 'openmotion-caption-styling', 'openmotion-card-carousel', 'openmotion-cards-and-text', 'openmotion-chalk-blueprint', 'openmotion-cinematic-logo', 'openmotion-clay-explainer', 'openmotion-color-pop-poster', 'openmotion-content-cover', 'openmotion-coral-title-cards', 'openmotion-corner-frames', 'openmotion-dark-premium-poster', 'openmotion-design-styles', 'openmotion-doc-promo', 'openmotion-echo-stack-type', 'openmotion-edit-to-script', 'openmotion-editorial-explainer', 'openmotion-editorial-poster', 'openmotion-editorial-webinar', 'openmotion-electric-impact-type', 'openmotion-felt-stop-motion', 'openmotion-flat-beat', 'openmotion-flat-card-explainer', 'openmotion-flat-lay-product', 'openmotion-folder-pop', 'openmotion-footage-to-handpainted', 'openmotion-giant-flip-type', 'openmotion-glitch-logo-sting', 'openmotion-growth-teardown', 'openmotion-hand-drawn-explainer', 'openmotion-hidden-feature-demo', 'openmotion-highlighter-notes', 'openmotion-in-hand-product', 'openmotion-ink-ribbon', 'openmotion-isometric-card-flight', 'openmotion-juicy-splash-poster', 'openmotion-light-shadow-product', 'openmotion-liquid-blob', 'openmotion-liquid-glass-logo', 'openmotion-liquid-logo', 'openmotion-livestream-clips', 'openmotion-magnet-particles', 'openmotion-manifesto-pop', 'openmotion-monochrome-magazine', 'openmotion-motion-graphic-placement', 'openmotion-multi-clips-to-reels', 'openmotion-multicam-edit', 'openmotion-mystery-box-reveal', 'openmotion-neon-outline-type', 'openmotion-nova-intro', 'openmotion-one-bit-dither', 'openmotion-orange-unfiltered', 'openmotion-paper-collage-explainer', 'openmotion-paper-diorama', 'openmotion-paper-map-journey', 'openmotion-paper-stop-motion', 'openmotion-pastel-flat-2d', 'openmotion-pixel-art-explainer', 'openmotion-pop-style', 'openmotion-premium-halo', 'openmotion-push-in-type', 'openmotion-quantum-particles', 'openmotion-red-pen-archive', 'openmotion-relight-reveal', 'openmotion-retro-flat-scene', 'openmotion-retro-print-poster', 'openmotion-ring-mask-reveal', 'openmotion-runway-rebel', 'openmotion-sale-carousel', 'openmotion-sale-countdown', 'openmotion-sale-promo', 'openmotion-shortlist-shorts', 'openmotion-shot-breakdown', 'openmotion-shutter-bands', 'openmotion-smooth-wipes', 'openmotion-spec-sheet', 'openmotion-splash-float-product', 'openmotion-split-slot-type', 'openmotion-step-by-step-tutorial', 'openmotion-sticker-bounce', 'openmotion-sticker-peel', 'openmotion-storyboard-to-motion', 'openmotion-storybook-myth', 'openmotion-surreal-3d-poster', 'openmotion-talking-head-recreation', 'openmotion-time-freeze', 'openmotion-translucent-glass', 'openmotion-velocity-lines', 'openmotion-website-launch', 'openmotion-whiteboard-doodle', 'openmotion-whiteboard-marker', 'openmotion-wireframe-style']) {
  test(`standalone ${canonical} installs without a retired entry`, async t => {
    const root = await isolated(t), destination = path.join(root, 'skills');
    const result = await installLibrarySkill(canonical, destination);
    assert.deepEqual(await readdir(destination), [canonical]);
    assert.deepEqual(result.removedLegacy, []);
    assert.deepEqual(result.preservedLegacy, []);
    assert.equal(await readFile(result.entry, 'utf8'), await readFile(`library/skills/${canonical}/SKILL.md`, 'utf8'));
    assert.deepEqual((await installLibrarySkill(canonical, destination)).installed, [canonical]);
  });
}
