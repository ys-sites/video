import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validateMediaManifest } from '../shared/repository-media.ts';

const source = fileURLToPath(new URL('../library/skills/', import.meta.url));
// Frozen fingerprints identify only the retired, unmodified forwarding folders.
// Standalone installs have no ownership marker; never remove a folder by name alone.
const retired = {
  'openmotion-brandkit': { name: 'brandkit', files: {
    'SKILL.md': 'baa4d65961044ca2270046e370612283d3506b8f4edd40d3389403f3b3f9b2d7',
    [path.join('agents', 'openai.yaml')]: '6e52c9f977f57f04230ed5d626813b089dee5bac66a415875c96b574ef849e66',
  } },
  'openmotion-presenter-story': { name: 'presenter-story', files: {
    'SKILL.md': '0013c1a3b460aafc740313dcfa9fcb2655b5221ca951d482163de1ef623f9fdf',
    [path.join('agents', 'openai.yaml')]: '48c3e961a7d04c901bf8d8f00b2dd6fe36ee8ed24bbb6751d450d38e4cb9d292',
  } },
  'openmotion-design-remix': { name: 'motion-design-remix', files: {
    'SKILL.md': 'cd3be67e615d05fa097166709ffabb932ab929cc685b852660c09f70da3f91ba',
    [path.join('agents', 'openai.yaml')]: '53ba8d5b90b65f9b163607acb68367c7f0355e7315175bb6ff2aad864c3cfe1e',
  } },
};
// Library Skills that never shipped a retired forwarding folder.
const current = ['openmotion-ad-script', 'openmotion-adaptive-layout', 'openmotion-ai-assistant-tour', 'openmotion-archive-collage', 'openmotion-article-illustrations', 'openmotion-aurora-gradient', 'openmotion-before-after', 'openmotion-bilingual-captions', 'openmotion-bold-type-poster', 'openmotion-bubble-field', 'openmotion-caption-styling', 'openmotion-card-carousel', 'openmotion-cards-and-text', 'openmotion-chalk-blueprint', 'openmotion-cinematic-logo', 'openmotion-clay-explainer', 'openmotion-color-pop-poster', 'openmotion-content-cover', 'openmotion-coral-title-cards', 'openmotion-corner-frames', 'openmotion-dark-premium-poster', 'openmotion-design-styles', 'openmotion-doc-promo', 'openmotion-echo-stack-type', 'openmotion-edit-to-script', 'openmotion-editorial-explainer', 'openmotion-editorial-poster', 'openmotion-editorial-webinar', 'openmotion-electric-impact-type', 'openmotion-felt-stop-motion', 'openmotion-flat-beat', 'openmotion-flat-card-explainer', 'openmotion-flat-lay-product', 'openmotion-folder-pop', 'openmotion-footage-to-handpainted', 'openmotion-giant-flip-type', 'openmotion-glitch-logo-sting', 'openmotion-growth-teardown', 'openmotion-hand-drawn-explainer', 'openmotion-hidden-feature-demo', 'openmotion-highlighter-notes', 'openmotion-in-hand-product', 'openmotion-ink-ribbon', 'openmotion-isometric-card-flight', 'openmotion-juicy-splash-poster', 'openmotion-light-shadow-product', 'openmotion-liquid-blob', 'openmotion-liquid-glass-logo', 'openmotion-liquid-logo', 'openmotion-livestream-clips', 'openmotion-magnet-particles', 'openmotion-manifesto-pop', 'openmotion-monochrome-magazine', 'openmotion-motion-graphic-placement', 'openmotion-multi-clips-to-reels', 'openmotion-multicam-edit', 'openmotion-mystery-box-reveal', 'openmotion-neon-outline-type', 'openmotion-nova-intro', 'openmotion-one-bit-dither', 'openmotion-orange-unfiltered', 'openmotion-paper-collage-explainer', 'openmotion-paper-diorama', 'openmotion-paper-map-journey', 'openmotion-paper-stop-motion', 'openmotion-pastel-flat-2d', 'openmotion-pixel-art-explainer', 'openmotion-pop-style', 'openmotion-premium-halo', 'openmotion-push-in-type', 'openmotion-quantum-particles', 'openmotion-red-pen-archive', 'openmotion-relight-reveal', 'openmotion-retro-flat-scene', 'openmotion-retro-print-poster', 'openmotion-ring-mask-reveal', 'openmotion-runway-rebel', 'openmotion-sale-carousel', 'openmotion-sale-countdown', 'openmotion-sale-promo', 'openmotion-shortlist-shorts', 'openmotion-shot-breakdown', 'openmotion-shutter-bands', 'openmotion-smooth-wipes', 'openmotion-spec-sheet', 'openmotion-splash-float-product', 'openmotion-split-slot-type', 'openmotion-step-by-step-tutorial', 'openmotion-sticker-bounce', 'openmotion-sticker-peel', 'openmotion-storyboard-to-motion', 'openmotion-storybook-myth', 'openmotion-surreal-3d-poster', 'openmotion-talking-head-recreation', 'openmotion-time-freeze', 'openmotion-translucent-glass', 'openmotion-velocity-lines', 'openmotion-website-launch', 'openmotion-whiteboard-doodle', 'openmotion-whiteboard-marker', 'openmotion-wireframe-style'];
async function snapshot(directory, relative = '') {
  const files = {};
  for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, item.name);
    assert(!item.isSymbolicLink(), 'Skill installation requires regular files: ' + name);
    if (item.isDirectory()) Object.assign(files, await snapshot(directory, name));
    else {
      assert(item.isFile(), 'Unsupported Skill entry: ' + name);
      const bytes = await readFile(path.join(directory, name));
      assert(!bytes.subarray(0, 128).toString().startsWith('version https://git-lfs.github.com/spec/v1'),
        'Skill media is not downloaded. Run git lfs pull --include="library/skills/**" --exclude="" before installing a Library Skill.');
      files[name] = createHash('sha256').update(bytes).digest('hex');
    }
  }
  return files;
}

// The destination is explicit; user-owned or different-version content is never overwritten.
export async function installLibrarySkill(name, destination) {
  assert(Object.hasOwn(retired, name) || current.includes(name), 'Unknown Library Skill: ' + name + '. Use an openmotion-* Library Skill name.');
  const canonical = name;
  assert(destination, 'An explicit destination skills directory is required');
  const media = validateMediaManifest(JSON.parse(await readFile(new URL('../repository-media.json', import.meta.url), 'utf8')));
  for (const file of media.files.filter(file => file.path.startsWith('library/skills/' + canonical + '/'))) {
    const bytes = await readFile(new URL('../' + file.path, import.meta.url)).catch(() => {
      throw new Error('Optional Skill media is missing. Run npm run media:pull -- library/skills/' + canonical);
    });
    assert(bytes.length === file.bytes && createHash('sha256').update(bytes).digest('hex') === file.sha256, 'Optional Skill media does not match repository-media.json');
  }
  const directory = path.resolve(destination), names = [canonical];
  await mkdir(directory, { recursive: true });
  const missing = [];
  for (const skill of names) {
    const target = path.join(directory, skill), expected = await snapshot(path.join(source, skill));
    const present = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (present) {
      assert(present.isDirectory() && !present.isSymbolicLink(), 'Skill destination must be a regular directory: ' + target);
      assert.deepEqual(await snapshot(target), expected, 'Existing Skill differs; preserve it and choose another destination: ' + target);
    } else missing.push(skill);
  }
  const legacy = retired[canonical] ?? null, legacyTarget = legacy && path.join(directory, legacy.name);
  const present = legacy && await lstat(legacyTarget).catch(error => { if (error.code !== 'ENOENT') throw error; });
  let removeLegacy = false;
  if (present?.isDirectory() && !present.isSymbolicLink()) {
    try { removeLegacy = isDeepStrictEqual(await snapshot(legacyTarget), legacy.files); }
    catch (error) { if (error.code !== 'ERR_ASSERTION') throw error; }
  }
  const staging = await mkdtemp(path.join(directory, '.openmotion-install-'));
  const backup = path.join(staging, 'retired');
  let movedLegacy = false, preserveBackup = false;
  try {
    for (const skill of missing) await cp(path.join(source, skill), path.join(staging, skill), { recursive: true, force: false, errorOnExist: true });
    if (removeLegacy) { await rename(legacyTarget, backup); movedLegacy = true; }
    for (const skill of missing) await rename(path.join(staging, skill), path.join(directory, skill));
  } catch (error) {
    if (movedLegacy) {
      try { await rename(backup, legacyTarget); }
      catch (restoreError) {
        preserveBackup = true;
        throw new AggregateError([error, restoreError], 'Legacy Skill backup retained at ' + backup);
      }
    }
    throw error;
  } finally { if (!preserveBackup) await rm(staging, { recursive: true, force: true }); }
  return { canonical, entry: path.join(directory, canonical, 'SKILL.md'), installed: names,
    removedLegacy: removeLegacy ? [legacy.name] : [], preservedLegacy: present && !removeLegacy ? [legacy.name] : [] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'Usage: node scripts/install-library-skill.mjs <skill-name> <destination-skills-directory>');
  console.log(JSON.stringify(await installLibrarySkill(process.argv[2], process.argv[3])));
}
