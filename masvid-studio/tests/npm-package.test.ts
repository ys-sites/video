import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildTemplatePublication } from '../.github/scripts/publish-template-catalog.mjs';
import { pathToFileURL } from 'node:url';
import { checkReleaseLocks, packageNpm } from '../scripts/package-npm.mjs';
import { extractArchive, runFile, sha256 } from '../scripts/runtime-assets.mjs';
import { protocolClient } from '../scripts/smoke-test-package.mjs';
import { packagedSkills } from '../shared/workflow.ts';
import { mcpRegistry } from '../mcp.ts';
import { nativeReports } from '../.github/scripts/motion-release.mjs';
import { onboardingSourceFiles, onboardingTemplateIds } from '../shared/onboarding-templates.ts';

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
async function verifyTrackingPolicy(application: string, mode: 'test' | 'stable' | 'local') {
  await symlink(path.resolve('node_modules'), path.join(application, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = JSON.parse(await runFile(process.execPath, ['--experimental-strip-types', path.resolve('tests/tracking-package.ts'), application, mode]));
  assert.equal(result.passed, true); assert.equal(result.external_requests, 0);
}

async function verifyHostedTemplates(application: string, commit: string) {
  const built = await buildTemplatePublication(path.resolve('.'), commit);
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-npm-hosted-'));
  try {
    const hook = path.join(directory, 'hosted.mjs');
    const files = built.uploads.map(file => ['https://releases.open-design.ai/' + file.key, file.body]);
    files.push(['https://releases.open-design.ai/open-motion/templates/main/catalog.json', built.uploads.find(file => file.key.endsWith('/catalog.json'))!.body]);
    await writeFile(hook, `import {readFile} from 'node:fs/promises';
const files = new Map(${JSON.stringify(files)}), original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
 const url = String(input), filename = files.get(url);
 if (filename) return new Response(await readFile(filename));
 if (url.startsWith('http://127.0.0.1:')) return original(input, init);
 throw new Error('Unexpected network request: ' + url);
};`);
    const env = { ...process.env, MOTION_DATA_DIR: path.join(directory, 'data'), OPENMOTION_TELEMETRY: '0' };
    delete env.MOTION_TEMPLATE_SOURCE;
    const firstId = built.catalog.templateIds[0];
    const messages = ['openmotion_list_templates', 'openmotion_get_template'].map((name, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name, arguments: index ? { templateId: firstId } : {} } }));
    const replies = execFileSync(process.execPath, ['--import', hook, path.join(application, 'mcp.ts')], { cwd: directory, env, input: messages.map(value => JSON.stringify(value)).join('\n') + '\n', encoding: 'utf8', timeout: 30_000 }).trim().split('\n').map(line => JSON.parse(line));
    for (const reply of replies) assert.equal(reply.result.isError, undefined, JSON.stringify(reply));
    const index = replies[0].result.structuredContent, detail = replies[1].result.structuredContent;
    assert.equal(index.source, 'hosted');
    assert.equal(index.total, built.catalog.templateIds.length + 4);
    const rows = (await readFile(index.indexPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(rows.slice(0, built.catalog.templateIds.length).map(row => row.templateId).sort(), [...built.catalog.templateIds].sort());
    assert.equal(detail.id, firstId); assert.equal(detail.localSource, undefined);
    assert.equal(detail.motionDocument.content, await readFile(path.join('library/templates/catalog', firstId, 'source/motion.md'), 'utf8'));
    const script = path.join(directory, 'http.mjs');
    const url = file => JSON.stringify(pathToFileURL(path.join(application, file)).href);
    await writeFile(script, `import {createServer} from 'node:http';
import {handler} from ${url('server.ts')};
import {WorkspaceStore} from ${url('workspace.ts')};
const store = new WorkspaceStore(process.env.MOTION_DATA_DIR);
const server = createServer((req,res) => handler(req,res,store,{}));
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
try {
 const origin='http://127.0.0.1:'+server.address().port;
 const response = await fetch(origin+'/motion-api/template-catalog?category=all&locale=en&limit=60');
 const page = await response.json();
 const guide = await fetch(origin+page.items[0].motionGuideUrl);
 const css = await fetch(origin+'/api/template-source/${firstId}/manifest.json');
 console.log(JSON.stringify({status:response.status,source:page.source,total:page.catalogTotal,version:page.catalogVersion,guide:guide.status,manifest:css.status}));
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }`);
    const http = JSON.parse(await runFile(process.execPath, ['--import', hook, script], { cwd: directory, env }));
    assert.equal(http.status, 200); assert.equal(http.source, 'hosted');
    assert.equal(http.total, index.total); assert.equal(http.version, index.catalogVersion);
    assert.equal(http.guide, 200); assert.equal(http.manifest, 200);
  } finally {
    await rm(built.staging, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyBundledTemplates(application: string) {
  const { copyTemplate, templates } = await import(pathToFileURL(path.join(application, 'template-library.ts')).href);
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-bundled-templates-'));
  try {
    for (const template of templates) {
      const project = path.join(directory, template.id);
      await copyTemplate(template.id, project, application);
      // Match MCP preview preflight before Studio can rewrite the copied source.
      const checked = JSON.parse(await runFile(process.execPath, [path.join(application, 'scripts/lint-project.mjs'), application, project]));
      assert.equal(checked.errorCount, 0, `${template.id}: ${JSON.stringify(checked.findings)}`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('shared Agent instructions keep source-default, optional npm and release controls synchronized', async () => {
  const section = async file => {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    return text.split('## Candidate and publication controls\n')[1].split('\n## ')[0].trim();
  };
  const shared = await section('AGENTS.md');
  assert(shared.includes('New repository installations use the source bootstrap in docs/install.md'));
  assert(shared.includes('Published npm application installation is optional') && shared.includes('explicit user choice'));
  assert(shared.includes('Never silently substitute npm for source or mix installations'));
  assert(shared.includes('Require both macOS and Windows candidate installs') && shared.includes('before publishing npm'));
  assert(shared.includes('Test uploads under `candidate` and stable under `stage`'));
  assert(shared.includes('Verify the public tarball hash before advancing'));
  assert(shared.includes('npm publication and release snapshot recovery require separate manual authorization'));
  assert(shared.includes('Main-branch template synchronization is explicitly authorized to run automatically'));
  assert(shared.includes('scoped in the workflow to the final upload step'));
  assert(shared.includes('These are shared bucket credentials, not template-only credentials'));
  assert(shared.includes('Consumer jobs receive neither npm OIDC nor R2 credentials'));
  assert(shared.includes('Preserve existing installations, projects, credentials'));
  assert(shared.includes('npm remains the source dependency/build tool'));
  assert.equal(await section('CLAUDE.md'), shared, 'CLAUDE.md must mirror the AGENTS.md release controls');
});

test('release packaging rejects floating npm versions, lock drift, unpinned native assets and a mismatched browser', async () => {
  const pkg = await json('package.json'), lock = await json('package-lock.json'), runtime = await json('scripts/runtime-lock.json');
  checkReleaseLocks(pkg, lock, runtime);
  assert.equal(runtime.targets['mac-arm64'].minimumOS, undefined);
  const missingCPU = structuredClone(runtime); missingCPU.targets['mac-arm64'].arch = '';
  assert.throws(() => checkReleaseLocks(pkg, lock, missingCPU), /OS\/CPU/);
  const missingWindowsMinimum = structuredClone(runtime); missingWindowsMinimum.targets['win-x64'].minimumOS = '';
  assert.throws(() => checkReleaseLocks(pkg, lock, missingWindowsMinimum), /minimum system version/);
  const floating = structuredClone(pkg); floating.dependencies.gsap = '^' + pkg.dependencies.gsap;
  const floatingLock = structuredClone(lock); floatingLock.packages[''].dependencies = floating.dependencies;
  assert.throws(() => checkReleaseLocks(floating, floatingLock, runtime), /exact npm/);
  const drift = structuredClone(lock); drift.packages['node_modules/gsap'].version = '0.0.1';
  assert.throws(() => checkReleaseLocks(pkg, drift, runtime), /Resolved npm/);
  const unpinned = structuredClone(runtime); unpinned.targets['mac-arm64'].ffprobe.sha256 = '';
  assert.throws(() => checkReleaseLocks(pkg, lock, unpinned), /SHA256/);
  const browser = structuredClone(runtime); browser.chromium = '1.2.3.4';
  assert.throws(() => checkReleaseLocks(pkg, lock, browser), /Browser must match/);
});

test('test npm artifacts contain their application, locked manifest and no bundled native runtime', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-npm-pack-'));
  const before = await readFile('package.json', 'utf8');
  // Sentinels must be names that cannot exist in a contributor checkout: the suite writes
  // them and deletes them again, so reusing a real local-only file name would destroy it.
  const unapproved = ['docs/private-sentinel.md', 'scripts/private-sentinel.mjs', 'private-sentinel.ts',
    'AGENTS_PR_RULE.local-sentinel.md', 'PR_SKILLS.local-sentinel.md', 'PRE-PR.local-sentinel.md', '.env.private-sentinel',
    // shared is recursively walked and JSON is admitted, so dropping the hidden-file
    // exclusion would leak this sentinel instead of leaving this assertion vacuous.
    'shared/.env.private-sentinel.json'];
  for (const file of unapproved) await writeFile(file, 'must not ship');
  try {
    const version = '0.6.4-test.42812345678.1', output = path.join(directory, 'build');
    const built = await packageNpm(output, version), release = await json(built.manifest);
    assert.equal(release.version, version); assert.equal(release.installer.version, version); assert.equal(release.format, 'npm');
    assert.equal(release.templateEnvironment, 'dev');
    assert.equal(release.runtime.targets['mac-arm64'].minimumOS, undefined);
    assert.equal(release.runtime.targets['win-x64'].minimumOS, 'Windows 11');
    assert.equal(release.mcp.profile, 'phase1'); assert.deepEqual(release.mcp.tools, mcpRegistry().tools.map(tool => tool.name));
    assert.deepEqual(release.skills, [...packagedSkills].sort());
    assert.equal(release.installer.sha256, await sha256(built.installer)); assert.equal(release.application.sha256, await sha256(built.application));
    assert.match(release.commit, /^[a-f0-9]{40}$/);
    const application = path.join(directory, 'app'), installer = path.join(directory, 'installer');
    await extractArchive(built.application, application); await extractArchive(built.installer, installer);
    const sourceEnv = { ...process.env }; delete sourceEnv.MOTION_TEMPLATE_SOURCE;
    const sourceMode = await runFile(process.execPath, ['--input-type=module', '-e', `import {templateConfig} from ${JSON.stringify(pathToFileURL(path.join(application, 'shared/template-config.ts')).href)}; process.stdout.write(templateConfig().source);`], { env: sourceEnv });
    assert.equal(sourceMode, 'hosted', 'An npm application without repository templates must read the latest hosted catalog');
    await assert.rejects(readFile(path.join(application, 'library/templates/catalog/catalog.json')), { code: 'ENOENT' });
    for (const file of onboardingSourceFiles) assert.equal(await sha256(path.join(application, file)), await sha256(file));
    const cards = JSON.parse(await runFile(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
      `import {loadTemplatePresentation,showTemplateRecommendations} from ${JSON.stringify(pathToFileURL(path.join(application, 'shared/mcp-template-recommendations.ts')).href)}; console.log(JSON.stringify(showTemplateRecommendations(loadTemplatePresentation(),{templateIds:${JSON.stringify(onboardingTemplateIds.slice(-3))}})));`]));
    assert.deepEqual(cards.cards.map((card: any) => card.templateId), onboardingTemplateIds.slice(-3));
    assert(cards.cards.every((card: any) => card.templateKind === 'reference' && !card.createArgs));
    const readme = await readFile(path.join(installer, 'package/README.md'), 'utf8');
    const media = new Map<string, string>((await json('repository-media.json')).files.map((file: { path: string; url: string }) => [file.path, file.url]));
    const hero = media.get('docs/readme/brand-hero.jpg');
    const mobileHero = media.get('docs/readme/brand-hero.mobile.jpg');
    const studioCapture = `https://raw.githubusercontent.com/nexu-io/openmotion/${release.commit}/docs/readme/live-product/editor.en.jpg`;
    assert(hero && mobileHero, 'Public README covers must retain registered media identities');
    assert(readme.includes('The open-source Claude Motion &amp; CapCut alternative'));
    assert(readme.includes(`srcset="https://raw.githubusercontent.com/nexu-io/openmotion/${release.commit}/docs/readme/capcut-claude-motion-cover.webp"`));
    assert(readme.includes(hero));
    assert(readme.includes(`src="https://raw.githubusercontent.com/nexu-io/openmotion/${release.commit}/docs/readme/openmotion-logo.svg"`));
    assert(readme.includes(`https://github.com/nexu-io/openmotion/blob/${release.commit}/docs/motion-md.md`));
    assert(readme.includes('](#choose-agent)'));
    assert(readme.includes('href="https://open-design.ai/motion/'));
    assert(readme.includes(`srcset="${mobileHero}"`));
    assert(readme.includes(`href="https://github.com/nexu-io/openmotion/blob/${release.commit}/LICENSE"`));
    assert(readme.includes(`src="${studioCapture}"`));
    assert(readme.includes('href="https://open-design.ai/templates/notion-custom-agents-motion-design/"'));
    assert(!readme.includes('](docs/') && !readme.includes('](template-library/'));
    assert(!readme.startsWith('# Motion application npm package'));
    const embeddedReadme = await readFile(path.join(application, 'README.md'), 'utf8');
    assert(embeddedReadme.includes('](docs/motion-md.md)'), 'Installed documentation keeps local links to shipped guides');
    assert(embeddedReadme.includes(`srcset="https://raw.githubusercontent.com/nexu-io/openmotion/${release.commit}/docs/readme/capcut-claude-motion-cover.webp"`));
    assert(embeddedReadme.includes(`srcset="${mobileHero}"`));
    assert(embeddedReadme.includes(`src="${studioCapture}"`));
    await assert.rejects(readdir(path.join(application, 'docs/readme/media')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(application, 'scripts/install-library-skill.mjs')), { code: 'ENOENT' });
    assert.equal((await json(path.join(application, 'package.json'))).version, version);
    await verifyTrackingPolicy(application, 'test');
    await verifyHostedTemplates(application, release.commit);
    await verifyBundledTemplates(application);
    assert.equal((await json(path.join(application, 'shared/template-config.json'))).environment, 'dev');
    assert.equal((await json(path.join(application, '.codex-plugin/plugin.json'))).version, version);
    assert.equal((await json(path.join(application, '.codex-plugin/plugin.json'))).description,
      (await json('.codex-plugin/plugin.json')).description);
    const pluginInterface = (await json(path.join(application, '.codex-plugin/plugin.json'))).interface;
    for (const field of ['logo', 'logoDark', 'composerIcon', 'composerIconDark']) {
      const filename = pluginInterface[field];
      assert.equal(await readFile(path.join(application, filename), 'utf8'), await readFile(filename, 'utf8'));
    }
    assert.equal((await json(path.join(application, 'package-lock.json'))).packages[''].version, version);
    const installedLock = await json(path.join(application, 'package-lock.json'));
    for (const name of ['@phosphor-icons/react', '@base-ui/react', '@codemirror/view', 'dockview-react', 'mediabunny']) {
      assert.equal(installedLock.packages['node_modules/' + name].dev, true,
        'Prebuilt Studio must not redownload its build-only dependency at setup: ' + name);
    }
    for (const name of ['hyperframes', '@hyperframes/core', '@hyperframes/studio-server', 'gsap', 'puppeteer-core', 'fontkit']) {
      assert.notEqual(installedLock.packages['node_modules/' + name].dev, true,
        'Editing/export runtime must remain installable in production: ' + name);
    }
    assert.equal((await json(path.join(installer, 'package/package.json'))).version, version);
    assert.equal((await json(path.join(installer, 'package/package.json'))).private, false);
    const bundled = path.join(installer, 'package/payload');
    const embedded = await json(path.join(bundled, 'release-npm.json'));
    assert.equal(embedded.installer, undefined, 'The containing archive cannot include its own hash');
    assert.equal(embedded.version, version);
    assert.equal(await sha256(path.join(bundled, embedded.application.url)), release.application.sha256);
    const metadata = await json(path.join(installer, 'package/package.json'));
    assert.equal(metadata.name, (await json('packages/npm/package.json')).name);
    assert.equal(metadata.publishConfig.tag, 'candidate'); assert.equal(metadata.publishConfig.access, 'public');
    assert.equal(metadata.bin.openmotion, 'scripts/npm-installer.mjs');
    const cli = path.join(installer, 'package', metadata.bin.openmotion);
    assert.equal((await runFile(process.execPath, [cli, '--version'])).trim(), version);
    const installedPackage = path.join(directory, 'node_modules/@openmotion/app');
    await mkdir(path.join(installedPackage, 'scripts'), { recursive: true });
    await cp(path.join(installer, 'package/scripts'), path.join(installedPackage, 'scripts'), { recursive: true });
    await cp(path.join(installer, 'package/package.json'), path.join(installedPackage, 'package.json'));
    assert.equal((await runFile(process.execPath, [path.join(installedPackage, 'scripts/npm-installer.mjs'), '--version'])).trim(), version,
      'The outer npm entry must execute inside node_modules without TypeScript stripping');

    const help = await runFile(process.execPath, [cli, 'setup', '--help']);
    assert(help.includes('--onboarding-output'), 'The prebuilt installer must expose the no-reload presentation route');
    for (const host of ['codex', 'claude', 'deepseek', 'workbuddy']) assert(help.includes(host), host);
    await readFile(path.join(installer, 'package/LICENSE'));
    assert.deepEqual((await readdir(path.join(application, 'skills'))).sort(), [...packagedSkills].sort());
    assert.equal(release.skills.length, packagedSkills.length);
    assert(release.skills.every((name: string) => name.startsWith('openmotion-')));
    assert.match(await readFile(path.join(application, 'skills/openmotion-production/agents/openai.yaml'), 'utf8'), /OpenMotion Production/);
    assert.match(await readFile(path.join(application, 'skills/openmotion-media/agents/openai.yaml'), 'utf8'), /OpenMotion Media/);
    for (const document of ['skills/openmotion-director/SKILL.md', 'skills/openmotion-media/SKILL.md', 'skills/openmotion-production/references/context.md', 'skills/openmotion-production/references/native.md', 'skills/openmotion-production/references/typography.md', 'skills/openmotion-production/references/fonts.md', 'skills/openmotion-production/fonts/catalog.json', 'scripts/prepare-font.ts', 'scripts/font-specimen.ts', 'skills/openmotion-production/references/verification.md', 'skills/openmotion-recreate/SKILL.md', 'phase1.ts', 'shared/phase1-tools.ts', 'shared/mcp-profiles.json']) {
      assert.equal(await readFile(path.join(application, document), 'utf8'), await readFile(document, 'utf8'));
    }
    assert.equal(await sha256(path.join(application, 'package-lock.json')), release.locks.npm);
    assert.equal(await sha256(path.join(application, 'scripts/runtime-lock.json')), release.locks.native);
    const entries = await runFile('tar', ['-tf', built.application]);
    assert(!/\/(node_modules|runtime)\//.test(entries));
    assert(entries.includes('skills/openmotion-production/SKILL.md'));
    for (const file of ['shared/provider-registry.ts', 'gateway/connections.ts', 'gateway/media-use.ts', 'gateway/opendesign.ts', 'skills/openmotion-media/references/providers/fal.md', 'skills/openmotion-media/references/providers/opendesign.md', 'skills/openmotion-media/references/providers/atlascloud.md', 'skills/openmotion-media/references/providers/wavespeed.md']) assert(entries.includes(file), 'BYOK runtime and guidance must ship: ' + file);
    assert(!entries.includes('skills/openmotion-debug-media/'), 'Removed debugging Skill must not ship');
    const entryNames = entries.trim().split('\n').map(file => file.replace(/^\.\//, ''));
    for (const file of unapproved) assert(!entryNames.includes(file), 'Unapproved file shipped: ' + file);
    // Check complete path segments, including nested support folders and tar's ./ prefix.
    const entryPaths = entryNames.map(file => file.split('/'));
    for (const local of ['AGENTS_PR_RULE.md', 'PR_SKILLS.md', 'PRE-PR.md', 'codex-security', 'superpowers', 'humanizer', 'AUDIT_PR']) {
      assert(!entryPaths.some(parts => parts.includes(local)), 'Local agent support must not ship: ' + local);
    }
    assert(!entryPaths.some(parts => parts.some(part => part.startsWith('.env'))), 'Environment files must not ship');
    assert(!entryPaths.some(parts => parts.includes('.motion-data')), 'Workspace data must not ship');
    assert(!/\/(tests|src)\//.test(entries), 'Development sources and fixtures must not ship');
    for (const script of ['measure_frame.mjs', 'register_motion.py', 'measure_motion.py', 'observe_marks.py', 'vision-tools.mjs']) {
      const filename = 'skills/openmotion-recreate/scripts/' + script;
      assert(entries.includes(filename), 'Missing recreation helper: ' + script);
      assert.equal(await readFile(path.join(application, filename), 'utf8'), await readFile(filename, 'utf8'));
    }
    for (const file of ['rebuild.md', 'reconstruction.md', 'rendering.md', 'verify.md']) assert(entries.includes('skills/openmotion-recreate/references/' + file), 'Missing recreation reference: ' + file);
    assert(entries.includes('skills/openmotion-recreate/assets/reconstruction.js'));
    assert(entries.includes('studio/build/index.html'));
    assert.doesNotMatch(entries, /studio\/build\/editor-assets\/three-js-.*\.webp/);
    assert.doesNotMatch(entries, /studio\/build\/.*\.(?:mp4|webm|gif)$/m);
    assert(entries.includes('studio/skill-cover-attribution.md'));
    assert(entries.includes('scripts/inline-onboarding.mjs'));
    assert(entries.includes('mcp-ui/template-recommendations/inline.fragment.html'));
    assert(entries.includes('shared/editor-launch.pl'), 'macOS shared editor launcher must ship');
    for (const script of ['vision-runtime.mjs', 'lint-project.mjs', 'recover-workspace-lock.ts', 'cleanup-harness-bundles.mjs', 'npm-installer.mjs', 'npm-hosts.mjs', 'check-installed-mcp.mjs', 'mcp-client.mjs', 'diagnostics.mjs', 'zip.mjs', 'diagnostic-redaction.mjs', 'install-onboarding.mjs', 'onboarding-catalog.ts', 'open-template-library.ts']) assert(entries.includes('scripts/' + script), 'Runtime diagnostic and lint entry must ship: ' + script);
    await readFile(path.join(installer, 'package/scripts/check-installed-mcp.mjs'));
    const diagnosticFile = path.join(directory, 'packaged-diagnostics.zip');
    await runFile(process.execPath, [cli, 'diagnostics', '--home', path.join(directory, 'not-installed'), '--output', diagnosticFile]);
    assert.match(await runFile('unzip', ['-p', diagnosticFile, 'metadata.json']), new RegExp(version.replaceAll('.', '\\.')));
    assert.equal((await json(path.join(application, 'shared/build-info.json'))).commit, release.commit);
    assert(entries.includes('shared/workflow-entry.js'), 'Workflow discovery must ship with the packaged Skills');
    assert(!entries.split('\n').some(file => file.split('/').some(part => part.startsWith('._'))), 'Do not distribute macOS file metadata');
    assert(entries.includes('template-library/NOTICE.md'));
    assert(!entries.includes('studio/build/index.html.map'));
    await assert.rejects(packageNpm(output, version), /immutable/);
    await assert.rejects(packageNpm(path.join(directory, 'invalid'), 'latest'), /MAJOR.MINOR.PATCH/);
    assert.equal(await readFile('package.json', 'utf8'), before, 'Packaging must not bump the checkout');
  } finally {
    for (const file of unapproved) await rm(file, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('DEV npm packages carry their catalog environment without changing the checkout', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-npm-dev-'));
  try {
    const before = await readFile('shared/template-config.json', 'utf8');
    const built = await packageNpm(path.join(directory, 'build'), '0.6.4-test.2', 'dev');
    assert.equal((await json(built.manifest)).templateEnvironment, 'dev');
    const unpacked = path.join(directory, 'npm'); await extractArchive(built.installer, unpacked);
    assert.equal((await json(path.join(unpacked, 'package/package.json'))).private, false);
    assert.equal((await json(built.manifest)).installer.version, (await json(built.manifest)).version);
    assert.match(built.application, /-dev\.tar\.gz$/);
    const application = path.join(directory, 'app');
    await extractArchive(built.application, application);
    assert.equal((await json(path.join(application, 'shared/template-config.json'))).environment, 'dev');
    assert.equal(await readFile('shared/template-config.json', 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('stable artifacts stage publication instead of replacing latest and retain source publish guards', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-npm-stable-'));
  try {
    const built = await packageNpm(path.join(directory, 'build'), '0.6.4');
    await extractArchive(built.installer, path.join(directory, 'npm'));
    const metadata = await json(path.join(directory, 'npm/package/package.json'));
    const release = await json(built.manifest);
    assert.equal(release.templateEnvironment, 'prod');
    const identity = { version: release.version, sourceCommit: release.commit, tgzSHA256: release.installer.sha256 };
    for (const platform of ['darwin-arm64', 'win32-x64']) await writeFile(path.join(path.dirname(built.manifest), `registry-${platform}.json`), JSON.stringify({
      ...identity, platform, status: 'passed', templateEnvironment: release.templateEnvironment,
      registryColdInstall: 'passed', nativePreparation: 'passed', repeatSetup: 'passed', resources: 'passed',
      mcpTools: release.mcp.tools.length, skills: release.skills.length,
    }));
    assert.equal((await nativeReports(path.dirname(built.manifest), identity, 'registryColdInstall')).length, 2);
    const application = path.join(directory, 'app'); await extractArchive(built.application, application);
    const diagnosticFile = path.join(directory, 'stable-diagnostics.zip');
    await runFile(process.execPath, [path.join(application, 'scripts/diagnostics.mjs'), '--data-dir', path.join(directory, 'missing-data'), '--output', diagnosticFile]);
    assert.match(await runFile('unzip', ['-p', diagnosticFile, 'metadata.json']), /"version": "0\.6\.4"/);
    await verifyTrackingPolicy(application, 'stable');
    await verifyBundledTemplates(application);
    assert.equal(metadata.version, '0.6.4'); assert.equal(metadata.private, false); assert.equal(metadata.publishConfig.tag, 'stage');
    assert.equal((await json('package.json')).private, true);
    assert.equal((await json('packages/npm/package.json')).private, true);
    for (const [version, environment] of [['0.6.4-test.3', 'prod'], ['0.6.4', 'dev']]) {
      const alternate = await packageNpm(path.join(directory, version + '-' + environment), version, environment);
      const unpacked = path.join(directory, version + '-' + environment + '-npm');
      await extractArchive(alternate.installer, unpacked);
      assert.equal((await json(path.join(unpacked, 'package/package.json'))).private, true, 'Non-channel environment builds stay private');
    }
    const local = await packageNpm(path.join(directory, 'local'));
    await extractArchive(local.installer, path.join(directory, 'local-npm'));
    const localPkg = await json(path.join(directory, 'local-npm/package/package.json'));
    assert.equal(localPkg.private, true); assert.match(localPkg.version, /-local\.1$/);
    assert.equal((await json(local.manifest)).version, localPkg.version);
    const localApplication = path.join(directory, 'local-app'); await extractArchive(local.application, localApplication);
    await verifyTrackingPolicy(localApplication, 'local');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the actual dispatch validation permits unpublished npm and backup ZIP, and rejects npm publication', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const step = workflow.split('      - name: Validate manual package selection\n')[1].split('      - name:')[0];
  const script = step.split('        run: |\n')[1].replace(/^ {10}/gm, '');
  for (const [format, publish] of [['npm', 'false'], ['full', 'false']]) await runFile('bash', ['-c', script], { env: { ...process.env, PACKAGE_FORMAT: format, PUBLISH: publish } });
  await assert.rejects(runFile('bash', ['-c', script], { env: { ...process.env, PACKAGE_FORMAT: 'npm', PUBLISH: 'true' } }), /publishing is disabled/);
  await assert.rejects(runFile('bash', ['-c', script], { env: { ...process.env, PACKAGE_FORMAT: 'full', PUBLISH: 'true' } }), /publishing is disabled/);
  await assert.rejects(runFile('bash', ['-c', script], { env: { ...process.env, PACKAGE_FORMAT: 'unknown', PUBLISH: 'false' } }), /Unknown package/);
});

test('the shared native acceptance client propagates a child failure instead of reporting a successful check', async () => {
  const client = protocolClient({ command: process.execPath, args: ['-e', 'console.error("fixture startup failed"); process.exit(1)'] }, process.env);
  try { await assert.rejects(client.rpc('initialize', {}), /MCP exited 1.*fixture startup failed/); }
  finally { client.child.kill('SIGTERM'); }
});

test('manual CI passes the selected template environment to both package formats', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-dispatch-'));
  try {
    const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const step = workflow.split('      - name: Build immutable standalone artifacts\n')[1].split('      - name:')[0];
    const script = step.split('        run: |\n')[1].replace(/^ {10}/gm, '');
    const calls = path.join(directory, 'calls.txt');
    const summary = path.join(directory, 'summary.md');
    const fakeNode = [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$MOTION_PACKAGE_CALLS"',
      'if [ "$2" = version ]; then echo 0.6.4-test.42.1; fi',
      'if [ "$1" = scripts/package-npm.mjs ]; then mkdir -p "$2"; printf pkg > "$2/openmotion-app-$3.tgz"; fi',
    ].join('\n');
    await writeFile(path.join(directory, 'node'), fakeNode + '\n', { mode: 0o755 });
    for (const format of ['npm', 'full']) for (const environment of ['prod', 'dev']) {
      await writeFile(calls, '');
      await writeFile(summary, '');
      await runFile('bash', ['-c', script], { cwd: directory, env: { ...process.env,
        PATH: directory + path.delimiter + process.env.PATH, MOTION_PACKAGE_CALLS: calls,
        GITHUB_STEP_SUMMARY: summary,
        PACKAGE_FORMAT: format, TEMPLATE_ENVIRONMENT: environment, GITHUB_RUN_NUMBER: '42', GITHUB_RUN_ATTEMPT: '1',
      } });
      const commands = (await readFile(calls, 'utf8')).trim().split('\n');
      assert.deepEqual(commands, ['scripts/test-package.mjs version 42 1', ...(format === 'npm'
        ? [`scripts/package-npm.mjs dist/0.6.4-test.42.1 0.6.4-test.42.1 --template-env=${environment}`]
        : ['mac-arm64', 'win-x64'].flatMap(target => [
          `scripts/test-package.mjs prepare ${target}`,
          `scripts/test-package.mjs build ${target} 0.6.4-test.42.1 --template-env=${environment}`,
        ]))]);
      assert.equal((await readFile(summary, 'utf8')).includes('Compressed size: 3 bytes'), format === 'npm');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
