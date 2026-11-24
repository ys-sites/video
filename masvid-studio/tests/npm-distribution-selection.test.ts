import { onboardingTemplateIds, onboardingSourceFiles, builtinRecommendationIds } from '../shared/onboarding-templates.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { distributionFiles, isLocalOnlyPath, selectDistributionFiles } from '../scripts/distribution.ts';

test('platform export ships its shared prompt and user guide in both profiles', async () => {
  const expected = ['docs/product/platform-export.md', 'shared/platform-export.ts', 'shared/project-agent-prompt.ts'];
  for (const profile of ['phase1', 'legacy']) {
    assert.deepEqual(await distributionFiles(profile, file => expected.includes(file)), expected);
  }
});
import { prepareInlineOnboarding, publishInlineOnboarding } from '../scripts/inline-onboarding.mjs';
import { runFile } from '../scripts/runtime-assets.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));

test('application selection validates only its selected positive-list files', async () => {
  assert.deepEqual(await distributionFiles('phase1', file => file === '.codex-plugin/plugin.json'), ['.codex-plugin/plugin.json']);
});

test('an empty application selection does not require optional showcase downloads', async () => {
  assert.deepEqual(await distributionFiles('phase1', () => false), []);
});

test('the onboarding distribution keeps the in-turn renderer without the retired queue scheduler', async () => {
  const files = await distributionFiles('phase1', file => /^scripts\/(?:install-onboarding|inline-onboarding|onboarding-callback)\.mjs$/.test(file));
  assert.deepEqual(files.sort(), ['scripts/inline-onboarding.mjs', 'scripts/install-onboarding.mjs']);
});

test('an installed storyboard renderer can produce a card using only its shipped files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-packaged-storyboard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expected = ['mcp-ui/storyboard/inline.css', 'mcp-ui/storyboard/inline.js',
    'packages/design-system/tokens.css', 'scripts/inline-storyboard.mjs'];
  const manifest = path.join(directory, 'storyboard.json');
  await writeFile(path.join(directory, 'still.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(manifest, JSON.stringify({
    title: 'Storyboard', openLabel: 'Enlarge', backLabel: 'Back',
    frames: [{ image: 'still.png', title: 'Opening', time: '00:00', alt: 'Opening frame' }],
  }));
  for (const profile of ['phase1', 'legacy']) {
    const installedRoot = path.join(directory, profile);
    const files = await distributionFiles(profile, file => expected.includes(file));
    assert.deepEqual(files, expected);
    for (const file of files) {
      const target = path.join(installedRoot, file);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(appRoot, file), target);
    }
    const output = path.join(directory, profile + '.html');
    const result = JSON.parse(await runFile(process.execPath,
      [path.join(installedRoot, 'scripts/inline-storyboard.mjs'), '--manifest', manifest, '--output', output]));
    assert.equal(result.frameCount, 1);
    assert.match(await readFile(output, 'utf8'), /data:image\/png;base64,/);
  }
});

test('packaged onboarding prepares and publishes real cards from the allowlist without dependencies', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-packaged-onboarding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtimeFiles = new Set(['package.json', 'template-library.ts', 'hyperframes.ts',
    'shared/export-spec.ts', 'shared/mcp-template-recommendations.ts', 'shared/onboarding-templates.ts', 'shared/tool-input-error.ts', ...onboardingSourceFiles,
    'scripts/inline-onboarding.mjs', 'scripts/runtime-assets.mjs', 'scripts/onboarding-catalog.ts',
    'shared/template-config.ts', 'shared/template-config.json']);
  for (const profile of ['phase1', 'legacy']) {
    const installedRoot = path.join(directory, profile);
    // Select only the renderer's runtime closure from the actual package allowlist.
    // Nothing is copied from the source tree unless distributionFiles ships it.
    const files = await distributionFiles(profile, file => runtimeFiles.has(file)
      || file.startsWith('mcp-ui/template-recommendations/')
      || /^template-library\/(?:product-promo\/|nyt-graph\/|decision-tree\/|LICENSE$|NOTICE\.md$)/.test(file));
    for (const file of files) {
      const target = path.join(installedRoot, file);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(appRoot, file), target);
    }
    const prepared = await prepareInlineOnboarding({ appRoot: installedRoot,
      output: path.join(directory, profile + '.html'), language: 'zh', templateIds: onboardingTemplateIds.slice(-3) });
    assert.equal(prepared.status, 'prepared');
    assert.equal(prepared.previewSource, 'project');
    assert.equal(typeof prepared.path, 'string');
    assert.deepEqual(prepared.templateIds, onboardingTemplateIds.slice(-3));
    const catalog = JSON.parse(await runFile(process.execPath, ['--experimental-strip-types',
      path.join(installedRoot, 'scripts/onboarding-catalog.ts'), '--template-ids', JSON.stringify(prepared.templateIds)], { cwd: directory }));
    assert.deepEqual(catalog.templates.map((item: any) => item.templateId), prepared.templateIds);
    assert.equal(catalog.recommendedTemplateId, prepared.templateIds[0]);
    assert(catalog.templates.every((item: any) => item.kind === 'reference'));
    assert.match(catalog.selectionGuide, /yes.*named recommendation/i);
    const projectPublished = JSON.parse(await runFile(process.execPath, [path.join(installedRoot, 'scripts/inline-onboarding.mjs'),
      '--publish-from', prepared.path, '--sha256', prepared.sha256, '--host-directory', path.join(directory, 'host')]));
    assert.equal(projectPublished.finalReplyMarkdown, `${prepared.welcomeMarkdown}\n\n${projectPublished.contentReference}`);
    const projectFragment = await readFile(projectPublished.path, 'utf8');
    assert.doesNotMatch(projectFragment, /https:\/\/r\.open-design\.ai/);
    assert(projectPublished.bytes < 1_000_000);
    const bundled = await prepareInlineOnboarding({ appRoot: installedRoot, output: path.join(directory, profile + '-bundled.html'),
      language: 'zh', templateIds: [...builtinRecommendationIds] });
    const published = await publishInlineOnboarding({ source: bundled.path,
      expectedSHA256: bundled.sha256, hostDirectory: path.join(directory, 'host') });
    assert.equal(published.status, 'published');
    assert.equal(published.finalReplyMarkdown, `${bundled.welcomeMarkdown}\n\n${published.contentReference}`);
    assert.equal(published.sha256, bundled.sha256);
    assert.equal(await readFile(published.path, 'utf8'), await readFile(bundled.path, 'utf8'));
  }
});


test('both distribution profiles include the complete project archive entry points', async () => {
  const required = ['project-management.ts', 'shared/project-management.ts', 'project-archive.ts', 'shared/project-archive.ts', 'shared/project-zip.ts', 'gateway/project-archive-http.ts', 'scripts/zip.mjs', 'docs/project-archives.md'];
  for (const profile of ['phase1', 'legacy']) {
    assert.deepEqual(await distributionFiles(profile, file => required.includes(file)), [...required].sort());
  }
});


test('platform artwork and its licenses ship with both runtime profiles', async () => {
  const { platformIconFiles } = await import('../packages/design-system/platform-icons.js');
  const required = ['platform-icons.js', ...platformIconFiles, 'platforms/sources.json', 'platforms/NOTICE.md', 'platforms/CC0-LICENSE.txt', 'platforms/remix-icon-LICENSE.txt'].map(file => 'packages/design-system/' + file);
  for (const profile of ['phase1', 'legacy']) assert.deepEqual(await distributionFiles(profile, file => required.includes(file)), [...required].sort());
});

test('local-only maintainer material is recognised and never selected for distribution', async () => {
  // The reserved names are root-anchored: a nested document with the same segment still ships.
  for (const file of ['AGENTS_PR_RULE.md', 'PR_SKILLS.md', 'PRE-PR.md', 'codex-security/notes.md',
    'superpowers/63976030/skills/brainstorming/SKILL.md', 'humanizer/SKILL.md', 'AUDIT_PR/round1/report.md']) {
    assert.equal(isLocalOnlyPath(file), true, 'Must be treated as local-only: ' + file);
  }
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'docs/superpowers/specs/2026-01-01-plan-design.md',
    'shared/workflow.ts', 'codex-security.md', 'humanizer.md']) {
    assert.equal(isLocalOnlyPath(file), false, 'Must remain distributable: ' + file);
  }
  // Wiring: a caller that accepts everything still cannot select reserved local-only material.
  assert.deepEqual(selectDistributionFiles(['AUDIT_PR/round1/report.md', 'superpowers/63976030/skills/x/SKILL.md',
    'AGENTS_PR_RULE.md', 'AGENTS.md', 'shared/workflow.ts'], () => true), ['AGENTS.md', 'shared/workflow.ts']);
  // Property: no profile may select a local-only path even when a caller accepts everything.
  for (const profile of ['phase1', 'legacy']) {
    const selected = await distributionFiles(profile, file => isLocalOnlyPath(file) || file === 'AGENTS.md');
    assert.deepEqual(selected, ['AGENTS.md'], profile + ' must still ship the shared agent entry');
    for (const file of selected) assert.equal(isLocalOnlyPath(file), false, 'Local-only material selected: ' + file);
  }
});
