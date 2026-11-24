import { onboardingSourceFiles } from '../shared/onboarding-templates.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../scripts/package.ts';
import { distributionFiles } from '../scripts/distribution.ts';
import { getWorkflow, workflowRegistry } from '../shared/workflow.ts';
import { designSystemDocuments, designSystemRuntimeFiles } from '../packages/design-system/index.js';
import { readFile, readdir, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('onboarding Skill is discoverable from the registered plugin roots', async () => {
  const manifest = JSON.parse(await readFile(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'));
  const entry = manifest.extensions['com.openai'].onboardingSkill.replace(/^\.\//, '');
  const skillRoots = (Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills])
    .map((root: string) => root.replace(/^\.\//, '').replace(/\/$/, ''));
  assert(skillRoots.some((root: string) => entry === root || entry.startsWith(root + '/')),
    'Codex plugin/read returns no onboardingSkill unless its entry is inside a registered Skill root');
});

test('plugin onboarding entry and its shared contract resolve inside every distribution', async () => {
  const manifest = JSON.parse(await readFile(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'));
  const entry = manifest.extensions['com.openai'].onboardingSkill.replace(/^\.\//, '');
  assert(!path.posix.isAbsolute(entry) && !entry.split('/').includes('..'));
  assert(!entry.startsWith('skills/'), 'Onboarding must not alter production Skill discovery');
  const skill = await readFile(new URL('../' + entry, import.meta.url), 'utf8');
  const reference = skill.match(/\]\(([^)]+#installation-success-reply)\)/)?.[1];
  assert(reference, 'Onboarding must reach the canonical installation-success contract');
  const contract = path.posix.normalize(path.posix.join(path.posix.dirname(entry), reference.split('#')[0]));
  assert.equal(contract, 'docs/install.md');
  for (const profile of ['phase1', 'legacy']) {
    const files = new Set(await distributionFiles(profile));
    assert(files.has(entry), 'The declared onboarding entry must ship');
    assert(files.has(contract), 'Its relative contract must ship');
    assert(files.has('scripts/codex-host-handoff.mjs'), 'CLI host handoff must ship with its onboarding caller');
  }
});

test('every distribution preserves public workflow dependencies and licenses while excluding development material', async () => {
  for (const profile of ['phase1', 'legacy']) {
    const files = new Set(await distributionFiles(profile));
    for (const file of ['AGENTS.md', 'CLAUDE.md', ...designSystemDocuments, ...designSystemRuntimeFiles.map(file => 'packages/design-system/' + file)]) {
      assert(files.has(file), 'Missing shared design system dependency: ' + file);
    }
    assert(![...files].some(file => file.startsWith('packages/design-system/workbench/')), 'Source-write server and workbench tests stay out of runtime distribution');
    assert(!files.has('packages/design-system/loading.ts'), 'Loading source is compiled into Studio');
    assert(![...files].some(file => file.startsWith('packages/design-system/react/')), 'React source is compiled into Studio');
    assert(files.has('docs/release-guide.md'), 'The public test/stable manual must ship');
    assert(files.has('docs/template-repository.md'), 'Repository guidance must ship');
    assert(![...files].some(file => (file.startsWith('library/templates/catalog/') && !onboardingSourceFiles.includes(file)) || /scripts\/(?:template-library|check-template-library)\.ts$/.test(file)), 'The source catalog and contribution tools must not inflate application packages');
    for (const file of ['docs/assets.md', 'docs/generation-options.md', 'gateway/asset-library.ts', 'gateway/account-media.ts', 'gateway/asset-chat.ts', 'gateway/asset-read.ts', 'shared/asset-tools.ts', 'shared/generation-options.ts']) assert(files.has(file), 'Missing asset runtime or guide: ' + file);
    for (const file of ['scripts/prepare-font.ts', 'scripts/font-specimen.ts', 'shared/font-catalog.ts', 'shared/import-font.ts', 'skills/openmotion-production/fonts/catalog.json']) assert(files.has(file), 'Missing font dependency: ' + file);
    for (const file of ['game-projects.ts', 'shared/game-contract.ts', 'shared/game-tools.ts', 'skills/openmotion-game/SKILL.md', 'skills/openmotion-game/LICENSE-HIGGSFIELD']) assert(files.has(file), 'Missing Game Studio dependency: ' + file);
    for (const file of ['scripts/game-glb-inspect.mjs', 'templates/game-kits/coop-3d/index.html', 'templates/game-kits/coop-3d/client.js', 'templates/game-kits/coop-3d/logic.js', 'templates/game-kits/coop-3d/style.css', 'templates/game-kits/vendor/three.module.min.js', 'templates/game-kits/vendor/GLTFLoader.js', 'templates/game-kits/vendor/SkeletonUtils.js', 'templates/game-kits/vendor/BufferGeometryUtils.js', 'templates/game-kits/characters/Mage.glb', 'templates/game-kits/characters/Knight.glb', 'templates/game-kits/characters/LICENSE-KayKit.txt']) assert(files.has(file), 'Missing offline game kit dependency: ' + file);
    const gameTemplates = await readdir(new URL('../templates/games/', import.meta.url), { recursive: true, withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of gameTemplates) if (entry.isFile()) {
      const relative = path.relative(fileURLToPath(new URL('../', import.meta.url)), path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
      assert(files.has(relative), 'Missing shipped game template file: ' + relative);
    }
    assert(files.has('shared/asset-limits.ts'), 'The shared asset import limit must ship');
    for (const file of ['docs/brand-kits.md', 'shared/brand-kit.ts', 'shared/brand-catalog.ts', 'gateway/brand-catalog.ts', 'library/brand-kits/catalog.json', 'library/brand-kits/OPENDESIGN-LICENSE.txt', 'library/brand-kits/THIRD-PARTY-NOTICES.txt', 'library/brand-kits/NOTICE.md', 'library/brand-kits/assets/gsap.min.js', 'gateway/brand-http.ts', 'gateway/brand-kits.ts', 'gateway/brand-network.ts', 'gateway/brand-extract.ts', 'gateway/brand-sampler.mjs', 'gateway/brand-assets.ts', 'gateway/brand-context.ts', 'shared/brand-capture.ts', 'gateway/brand-capture/design-style-extractor.mjs', 'gateway/brand-capture/token-extractor.mjs', 'gateway/brand-capture/browser-helpers.mjs', 'gateway/brand-capture/LICENSE', 'gateway/brand-capture/NOTICE.md', 'gateway/brand-package.ts', 'gateway/brand-showcase.ts']) assert(files.has(file), 'Missing Brand Kit runtime dependency: ' + file);
    assert.equal([...files].filter(file => /^library\/brand-kits\/sources\/[^/]+\/(DESIGN.md|tokens.css|manifest.json)$/.test(file)).length, 152 * 3);
    assert(files.has('library/brand-kits/websites.json'));
    assert(files.has('gateway/brand-cover.ts'));
    assert(files.has('shared/hyperframes-capture-fix.mjs'), 'The capture recovery preload must ship with every runtime');
    assert(files.has('shared/webmcp-tools.ts'), 'The shared WebMCP adapter must ship with its public tool definitions');
    for (const file of ['review-comments.ts', 'shared/review-comments.ts']) assert(files.has(file), 'Missing review comment runtime: ' + file);
    assert(files.has('tracking/device.ts'), 'The device identity runtime dependency must ship');
    for (const script of ['register_motion.py', 'measure_motion.py']) {
      assert(files.has('skills/openmotion-recreate/scripts/' + script), 'Missing recreation helper: ' + script);
    }
    for (const file of ['shared/provider-registry.ts', 'shared/provider-presets.json', 'shared/provider-registry-LICENSE.txt', 'shared/provider-registry-NOTICE.md', 'docs/provider-settings.md', 'gateway/account.ts', 'gateway/connections.ts', 'gateway/compatible.ts']) assert(files.has(file), 'Missing provider settings runtime or license: ' + file);
    assert(![...files].some(file => file.includes('@powerformer/vela-cli')), 'The optional account connector must not be redistributed');
    for (const file of ['studio/build/index.html', 'studio/LICENSE', 'template-library/LICENSE', 'template-library/NOTICE.md', 'packages/design-system/fonts/Albert-Sans-OFL.txt', 'scripts/distribution.ts', 'scripts/diagnostics.mjs', 'scripts/zip.mjs', 'project-archive.ts', 'shared/project-archive.ts', 'shared/project-zip.ts', 'gateway/project-archive-http.ts', 'docs/project-archives.md', 'scripts/diagnostic-redaction.mjs', 'shared/build-info.json', 'shared/editor-launch.pl', 'shared/workspace-studio.ts', 'shared/owned-studio.mjs', 'shared/workflow-entry.js', 'skills/openmotion-recreate/scripts/measure_frame.mjs']) assert(files.has(file), 'Missing runtime or license: ' + file);
    assert([...files].some(file => /^studio\/build\/editor-assets\/soundtrack-[\w-]+\.m4a$/.test(file)), 'The bundled Music scene soundtrack must ship');
    assert([...files].some(file => /^studio\/build\/editor-assets\/sfx-whoosh-[\w-]+\.m4a$/.test(file)), 'Sound Studio template previews must ship');
    assert(![...files].some(file => /^studio\/build\/editor-assets\/three-js-.*\.webp$/.test(file)), 'Skill posters are hosted and loaded on demand');
    assert(![...files].some(file => /^studio\/build\/.+\.(?:mp4|gif|webm)$/.test(file)), 'Skill preview animations are loaded on demand');
    assert(files.has('studio/skill-cover-attribution.md'));
    assert(![...files].some(file => /^(?:\.agents\/skills\/|tests\/|studio\/(?:src|tests)\/)|\.map$|publish-test-package|acceptance\.md$/.test(file)));
    for (const [workflow, definition] of Object.entries(workflowRegistry)) {
      for (const section of Object.keys(definition.sections)) {
        const document = await getWorkflow(section, workflow);
        assert(files.has(document.documentId), 'Missing workflow document: ' + document.documentId);
        for (const reference of document.references) assert(files.has(reference.documentId), 'Missing workflow reference: ' + reference.documentId);
      }
    }
    assert(files.has('skills/openmotion-video-to-template/SKILL.md'));
    for (const file of ['references/unchanged-export.md', 'scripts/delivery.mjs', 'scripts/playback.mjs']) {
      assert(files.has('skills/openmotion-template-to-video/' + file), 'Missing unchanged-delivery dependency: ' + file);
    }
  }
  await assert.rejects(distributionFiles('unknown'), /Unknown distribution/);
});
test('ZIP stores UTF-8 names and file sizes in local and central headers', () => {
  const archive = zip([{ name: 'motion/测试.txt', data: Buffer.from('editable project') }]);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(18), 16);
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  assert.equal(archive.readUInt16LE(end + 10), 1);
  assert.equal(archive.readUInt32LE(archive.readUInt32LE(end + 16)), 0x02014b50);
});

test('source and distribution expose only canonical Skill folders', async () => {
  const { readdir } = await import('node:fs/promises');
  const core = ['openmotion', 'openmotion-design', 'openmotion-director', 'openmotion-game', 'openmotion-media', 'openmotion-production', 'openmotion-recreate', 'openmotion-template-to-video', 'openmotion-video-to-template'];
  const library = ['openmotion-ad-script', 'openmotion-adaptive-layout', 'openmotion-ai-assistant-tour', 'openmotion-archive-collage', 'openmotion-article-illustrations', 'openmotion-aurora-gradient', 'openmotion-before-after', 'openmotion-bilingual-captions', 'openmotion-bold-type-poster', 'openmotion-brandkit', 'openmotion-bubble-field', 'openmotion-caption-styling', 'openmotion-card-carousel', 'openmotion-cards-and-text', 'openmotion-chalk-blueprint', 'openmotion-cinematic-logo', 'openmotion-clay-explainer', 'openmotion-color-pop-poster', 'openmotion-content-cover', 'openmotion-coral-title-cards', 'openmotion-corner-frames', 'openmotion-dark-premium-poster', 'openmotion-design-remix', 'openmotion-design-styles', 'openmotion-doc-promo', 'openmotion-echo-stack-type', 'openmotion-edit-to-script', 'openmotion-editorial-explainer', 'openmotion-editorial-poster', 'openmotion-editorial-webinar', 'openmotion-electric-impact-type', 'openmotion-felt-stop-motion', 'openmotion-flat-beat', 'openmotion-flat-card-explainer', 'openmotion-flat-lay-product', 'openmotion-folder-pop', 'openmotion-footage-to-handpainted', 'openmotion-giant-flip-type', 'openmotion-glitch-logo-sting', 'openmotion-growth-teardown', 'openmotion-hand-drawn-explainer', 'openmotion-hidden-feature-demo', 'openmotion-highlighter-notes', 'openmotion-in-hand-product', 'openmotion-ink-ribbon', 'openmotion-isometric-card-flight', 'openmotion-juicy-splash-poster', 'openmotion-light-shadow-product', 'openmotion-liquid-blob', 'openmotion-liquid-glass-logo', 'openmotion-liquid-logo', 'openmotion-livestream-clips', 'openmotion-magnet-particles', 'openmotion-manifesto-pop', 'openmotion-monochrome-magazine', 'openmotion-motion-graphic-placement', 'openmotion-multi-clips-to-reels', 'openmotion-multicam-edit', 'openmotion-mystery-box-reveal', 'openmotion-neon-outline-type', 'openmotion-nova-intro', 'openmotion-one-bit-dither', 'openmotion-orange-unfiltered', 'openmotion-paper-collage-explainer', 'openmotion-paper-diorama', 'openmotion-paper-map-journey', 'openmotion-paper-stop-motion', 'openmotion-pastel-flat-2d', 'openmotion-pixel-art-explainer', 'openmotion-pop-style', 'openmotion-premium-halo', 'openmotion-presenter-story', 'openmotion-push-in-type', 'openmotion-quantum-particles', 'openmotion-red-pen-archive', 'openmotion-relight-reveal', 'openmotion-retro-flat-scene', 'openmotion-retro-print-poster', 'openmotion-ring-mask-reveal', 'openmotion-runway-rebel', 'openmotion-sale-carousel', 'openmotion-sale-countdown', 'openmotion-sale-promo', 'openmotion-shortlist-shorts', 'openmotion-shot-breakdown', 'openmotion-shutter-bands', 'openmotion-smooth-wipes', 'openmotion-spec-sheet', 'openmotion-splash-float-product', 'openmotion-split-slot-type', 'openmotion-step-by-step-tutorial', 'openmotion-sticker-bounce', 'openmotion-sticker-peel', 'openmotion-storyboard-to-motion', 'openmotion-storybook-myth', 'openmotion-surreal-3d-poster', 'openmotion-talking-head-recreation', 'openmotion-time-freeze', 'openmotion-translucent-glass', 'openmotion-velocity-lines', 'openmotion-website-launch', 'openmotion-whiteboard-doodle', 'openmotion-whiteboard-marker', 'openmotion-wireframe-style'];
  assert.deepEqual((await readdir(new URL('../skills/', import.meta.url))).filter(name => !name.startsWith('.')).sort(), core);
  assert.deepEqual((await readdir(new URL('../library/skills/', import.meta.url))).sort(), library);
  for (const profile of ['phase1', 'legacy']) {
    const files = await distributionFiles(profile);
    const roots = [...new Set(files.filter(file => /^(?:library\/)?skills\//.test(file)).map(file => file.split('/').at(file.startsWith('library/') ? 2 : 1)))];
    assert(roots.length >= 8);
    assert(roots.every(name => name?.startsWith('openmotion-')), roots.join(', '));
  }
});

// Source snapshots intentionally omit optional showcase media. This checks the
// same positive distribution inventory for both profiles without fetching it.
test('unchanged export guidance and helpers survive lightweight distribution', async () => {
  for (const profile of ['phase1', 'legacy']) {
    const files = new Set(await distributionFiles(profile, file => /\.(?:md|mjs|ts|json|ya?ml)$/.test(file)));
    for (const file of ['references/unchanged-export.md', 'scripts/delivery.mjs', 'scripts/playback.mjs']) {
      assert(files.has('skills/openmotion-template-to-video/' + file), 'Missing delivery dependency: ' + file);
    }
    const route = await getWorkflow('unchanged', 'template');
    assert.equal(route.documentId, 'skills/openmotion-template-to-video/references/unchanged-export.md');
    assert(files.has(route.documentId));
    for (const reference of route.references) assert(files.has(reference.documentId));
  }
});

test('asset naming contracts and runtime dependencies survive lightweight distribution', async () => {
  for (const profile of ['phase1', 'legacy']) {
    const files = new Set(await distributionFiles(profile, file => /\.(?:md|mjs|ts|json|ya?ml)$/.test(file)));
    for (const file of ['project-asset-names.ts', 'shared/asset-names.ts', 'shared/asset-name-ui.json', 'skills/openmotion-production/references/materials.md']) assert.ok(files.has(file), file);
  }
});

test('review comments service and contract survive lightweight distribution', async () => {
  for (const profile of ['phase1', 'legacy']) {
    const files = new Set(await distributionFiles(profile, file => /\.(?:md|mjs|js|ts|json|ya?ml)$/.test(file)));
    for (const file of ['review-comments.ts', 'shared/review-comments.ts', 'shared/project-management.ts']) assert.ok(files.has(file), file);
  }
});

test('packaged server imports without local dependencies and captions use the separate native runtime', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const extracted = await mkdtemp(path.join(tmpdir(), 'motion-caption-package-'));
  try {
    const files = await distributionFiles('phase1', file => /\.(?:md|mjs|js|ts|json|ya?ml|txt|svg)$/.test(file));
    await Promise.all(files.map(async file => {
      const target = path.join(extracted, file);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(root, file), target);
    }));
    const script = `
      await import(${JSON.stringify(pathToFileURL(path.join(extracted, 'server.ts')).href)});
      const { loadCaptionSourceOperations } = await import(${JSON.stringify(pathToFileURL(path.join(extracted, 'shared/transcript-captions.ts')).href)});
      const { manualCaptionSource, captionTracks, toggleCaptionSource, parseHTML } = await loadCaptionSourceOperations(${JSON.stringify(root)});
      const result = manualCaptionSource('<div data-composition-id="main" data-duration="3"></div>', '11111111-1111-4111-8111-111111111111', { segments: [{ id: 'cue', text: 'Packaged caption', start: 0, end: 2 }] });
      if (captionTracks(result.content)[0]?.cueCount !== 1) throw new Error('Packaged caption operation failed');
      const { compositionCanvasSource } = await import(${JSON.stringify(pathToFileURL(path.join(extracted, 'shared/composition-canvas.ts')).href)});
      const { loadCanvasSourceOperations } = await import(${JSON.stringify(pathToFileURL(path.join(extracted, 'shared/composition-canvas-source.ts')).href)});
      const canvasParsers = await loadCanvasSourceOperations(${JSON.stringify(root)});
      const framed = compositionCanvasSource('<div data-composition-id="main" data-duration="3" data-width="640" data-height="360"></div>', canvasParsers, { ratio: '9:16', fit: 'cover' });
      if (framed.canvas.width !== 1080 || framed.canvas.height !== 1920) throw new Error('Packaged canvas operation failed');
      const enabled = toggleCaptionSource(framed.content, '22222222-2222-4222-8222-222222222222', true);
      if (captionTracks(enabled.content)[0]?.cueCount !== 0) throw new Error('Packaged empty caption lane failed');
    `;
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { cwd: extracted, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally { await rm(extracted, { recursive: true, force: true }); }
});

test('offline game kit, handbook, binary characters, inspector and licenses survive lightweight packaging', async () => {
  for (const profile of ['phase1', 'legacy']) {
    const files = new Set(await distributionFiles(profile, file => file.startsWith('templates/game-kits/') || file.startsWith('skills/openmotion-game/') || file === 'scripts/game-glb-inspect.mjs'));
    const entries = await readdir(new URL('../templates/game-kits/', import.meta.url), {recursive:true,withFileTypes:true});
    assert(files.has('scripts/game-glb-inspect.mjs'));
    assert(files.has('skills/openmotion-game/SKILL.md'));
    assert(files.has('skills/openmotion-game/LICENSE-HIGGSFIELD'));
    assert(files.has('skills/openmotion-game/PROVENANCE.md'));
    for (const section of Object.keys(workflowRegistry.game.sections)) {
      const document = await getWorkflow(section, 'game');
      assert(files.has(document.documentId), 'Missing game handbook resource: ' + document.documentId);
      for (const reference of document.references) assert(files.has(reference.documentId), 'Missing game handbook reference: ' + reference.documentId);
    }
    for (const entry of entries) if(entry.isFile()) {
      const relative = path.relative(fileURLToPath(new URL('../', import.meta.url)), path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
      assert(files.has(relative), 'Missing offline kit file: '+relative);
    }
  }
});

test('Codex plugin manifest and Skill catalog metadata stay in English', async () => {
  const { readdir } = await import('node:fs/promises');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  assert.doesNotMatch(manifest.description, /\p{Script=Han}/u, 'plugin.json description must stay in English');
  assert.doesNotMatch(manifest.interface.shortDescription, /\p{Script=Han}/u, 'plugin.json interface.shortDescription must stay in English');
  for (const entry of await readdir(path.join(root, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillDoc = await readFile(path.join(root, 'skills', entry.name, 'SKILL.md'), 'utf8');
    const frontmatter = skillDoc.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? '';
    assert.doesNotMatch(frontmatter, /\p{Script=Han}/u, `skills/${entry.name}/SKILL.md frontmatter must stay in English`);
    try {
      const openaiYaml = await readFile(path.join(root, 'skills', entry.name, 'agents/openai.yaml'), 'utf8');
      assert.doesNotMatch(openaiYaml, /\p{Script=Han}/u, `skills/${entry.name}/agents/openai.yaml must stay in English`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const onboardingDoc = await readFile(path.join(root, '.codex-plugin/onboarding/SKILL.md'), 'utf8');
  const onboardingFrontmatter = onboardingDoc.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? '';
  assert.doesNotMatch(onboardingFrontmatter, /\p{Script=Han}/u, '.codex-plugin/onboarding/SKILL.md frontmatter must stay in English');
});
