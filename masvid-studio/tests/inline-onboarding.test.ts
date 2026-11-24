import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { renderInlineOnboarding, prepareInlineOnboarding, publishInlineOnboarding } from '../scripts/inline-onboarding.mjs';
import { prepareInstallationOnboarding } from '../scripts/install-onboarding.mjs';
import { languages, welcomeMarkdown } from '../mcp-ui/template-recommendations/i18n.ts';
import { runFile } from '../scripts/runtime-assets.mjs';

import { onboardingTemplateIds, builtinRecommendationIds } from '../shared/onboarding-templates.ts';
import { loadTemplatePresentation, loadInlineProjectPreviews } from '../shared/mcp-template-recommendations.ts';

function assertSelection(ids: string[]) {
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3);
  assert(ids.every(id => (onboardingTemplateIds as readonly string[]).includes(id)));
}

const appRoot = fileURLToPath(new URL('../', import.meta.url));
test('curated project previews are self-contained without native MCP activation', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-curated-inline-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const templateIds = ['motion-a28f0e5d-aa8b-45a7-87f9-9afcac65a09b',
    'motion-0ad92fd0-b2fb-4885-957c-b71152df15fd', 'motion-664184d9-593e-4984-b473-701248b69cfe'];
  const result = await renderInlineOnboarding({ appRoot, output: path.join(directory, 'cards.html'), language: 'zh', templateIds });
  assert.equal(result.status, 'prepared');
  assert.equal(result.nativeMcpSessionVerified, false);
  assert.deepEqual(result.templateIds, templateIds);
  assert.equal(result.previewSource, 'project');
  const fragment = await readFile(result.path, 'utf8');
  assert.doesNotMatch(fragment, /https:\/\/r\.open-design\.ai/);
  const window = new Window();
  t.after(() => window.happyDOM.abort());
  const videoTypes: string[] = [];
  window.URL.createObjectURL = blob => { videoTypes.push(blob.type); return 'blob:project-preview'; };
  window.URL.revokeObjectURL = () => {};
  window.document.body.innerHTML = fragment;
  for (const script of window.document.querySelectorAll('script')) window.eval(script.textContent!);
  assert.equal(window.document.querySelectorAll('.omtc-card').length, 3);
  assert.equal(window.document.querySelectorAll('.omtc-card video[src^="blob:"]').length, 3);
  assert.deepEqual(videoTypes, ['video/webm', 'video/webm', 'video/webm']);
  assert.match(window.document.querySelector('.omtc-description')!.textContent!, /^简介：/);
  assert.doesNotMatch(window.document.body.textContent!, /工程预览（静音）/);
});
test('HTML project-card summaries use localized introduction labels in every supported language', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-inline-summary-locales-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prefixes = { zh: '简介：', en: 'Summary: ', ja: '概要：', ko: '소개: ',
    fr: 'Présentation : ', es: 'Resumen: ', pt: 'Resumo: ' };
  assert.deepEqual(Object.keys(prefixes), [...languages], 'Every supported language needs an explicit summary label');
  await Promise.all(languages.map(async language => {
    const templateIds = [...onboardingTemplateIds].slice(0, 3);
    const result = await renderInlineOnboarding({ appRoot, output: path.join(directory, language + '.html'), language, templateIds });
    const window = new Window();
    try {
      window.URL.createObjectURL = () => 'blob:summary-locale-test';
      window.URL.revokeObjectURL = () => {};
      window.document.body.innerHTML = await readFile(result.path, 'utf8');
      for (const script of window.document.querySelectorAll('script')) window.eval(script.textContent!);
      const descriptions = [...window.document.querySelectorAll('.omtc-description')].map(node => node.textContent!);
      assert.equal(descriptions.length, 3);
      for (const description of descriptions) {
        assert(description.startsWith(prefixes[language]), `${language}: ${description}`);
        assert(description.slice(prefixes[language].length).trim(), 'Keep the localized summary after its label');
        assert.equal(description.indexOf(prefixes[language], prefixes[language].length), -1, 'Do not duplicate the summary label');
      }
    } finally { await window.happyDOM.abort(); }
  }));
});
test('onboarding locale tags normalize to a supported language and other languages fall back to English', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-onboarding-language-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [language, expected] of [['zh-CN', 'zh'], ['FR-ca', 'fr'], ['ja_JP', 'ja'], ['ko', 'ko'], ['es', 'es'], ['pt-BR', 'pt'], ['de', 'en'], ['it', 'en']]) {
    const result = await prepareInlineOnboarding({ appRoot, output: path.join(directory, language + '.html'), language });
    assert.equal(result.status, 'prepared');
    assert.equal(result.language, expected);
    assert.equal(typeof result.welcomeMarkdown, 'string');
    assert.match(result.welcomeMarkdown, /👇/);
    assert.doesNotMatch(result.welcomeMarkdown, /👆/);
    assertSelection(result.templateIds);
  }
});
test('default installation prepares all three production cards in its own workspace without presentation flags', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-default-onboarding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await prepareInstallationOnboarding({ appRoot, dataDirectory: directory, templateEnvironment: 'prod', language: 'zh' });
  assert.equal(result.inlinePresentation?.status, 'prepared');
  assertSelection(result.inlinePresentation.templateIds);
  assert.deepEqual(result.catalog.templates.map((item: any) => item.templateId), result.inlinePresentation.templateIds);
  assert.equal(result.inlinePresentation.language, 'zh');
  assert.equal(typeof result.inlinePresentation.path, 'string');
  assert.equal(result.inlinePresentation.previewSource, 'project');
  assert.equal(result.hostSessionVerified, false, 'Preparing content is not a host delivery acknowledgment');
});
test('the inline renderer returns a streaming welcome separately from three real media cards', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-inline-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'welcome.html');
  const result = await renderInlineOnboarding({ appRoot, output, language: 'zh', templateIds: [...builtinRecommendationIds] });
  assert.equal(result.nativeMcpSessionVerified, false);
  assert.deepEqual(result.templateIds, [...builtinRecommendationIds]);
  assert(result.bytes < 1_000_000);
  const fragment = await readFile(output, 'utf8');
  assert.doesNotMatch(fragment, /<!doctype|<html[ >]|<head[ >]|<body[ >]/i);
  assert.doesNotMatch(fragment, /__OPENMOTION_INLINE_/);
  const window = new Window();
  t.after(() => window.happyDOM.abort());
  const videoTypes: string[] = [];
  window.URL.createObjectURL = blob => { videoTypes.push(blob.type); return 'blob:verified-template'; };
  window.URL.revokeObjectURL = () => {};
  window.document.body.innerHTML = fragment;
  for (const script of window.document.querySelectorAll('script')) window.eval(script.textContent!);
  assert.equal(window.document.querySelectorAll('.omtc-card').length, 3);
  assert.equal(window.document.querySelector('.omtc-welcome'), null);
  assert.match(result.welcomeMarkdown, /我是你的开源视频创作搭档/);
  assert.equal(window.document.querySelectorAll('.omtc-card video[src^="blob:"]').length, 3);
  assert.deepEqual(videoTypes, ['video/mp4', 'video/mp4', 'video/mp4']);
  let copied = '';
  Object.defineProperty(window.navigator, 'clipboard', {value: {writeText: async (text: string) => {copied = text;}}});
  (window.document.querySelector('.omtc-card .omtc-clone') as any).click();
  await new Promise(resolve => setImmediate(resolve));
  assert(copied.includes(builtinRecommendationIds[0]));
  assert.match(copied, /我的要求/);
  assert.equal(window.document.querySelector('textarea'), null);
  await assert.rejects(renderInlineOnboarding({ appRoot, output, language: 'zh', templateIds: [...builtinRecommendationIds] }), /EEXIST/);
  assert.equal(await readFile(output, 'utf8'), fragment);
});

test('the Node CLI renderer works from the installed runtime without development dependencies', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-inline-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'welcome.html');
  const result = await prepareInlineOnboarding({ appRoot, output, language: 'fr' });
  assert.equal(result.status, 'prepared'); assert.equal(result.language, 'fr');
  assert.equal(result.publicationRequired, true);
  assert.equal(result.contentReference, undefined, 'A runtime path is not a host-authorized visualization reference');
  assert.equal(result.path, output);
});

test('host publication verifies and copies the real component to an explicitly supplied readable directory', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-publish-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prepared = await renderInlineOnboarding({ appRoot, output: path.join(directory, 'runtime/welcome.html'), language: 'zh', templateIds: [...builtinRecommendationIds] });
  const hostDirectory = path.join(directory, 'host-thread-visualizations');
  const published = await publishInlineOnboarding({ source: prepared.path, expectedSHA256: prepared.sha256, hostDirectory });
  assert.equal(published.status, 'published');
  assert.equal(published.sha256, prepared.sha256);
  assert.match(published.contentReference, /visualize/);
  assert.equal(JSON.parse(published.contentReference.split('\ue202')[1].split('\ue201')[0]).path, published.path);
  assert(published.path.startsWith(hostDirectory + path.sep));
  assert.equal(await readFile(published.path, 'utf8'), await readFile(prepared.path, 'utf8'));
  await assert.rejects(publishInlineOnboarding({ source: prepared.path, expectedSHA256: '0'.repeat(64), hostDirectory }), /SHA256/);
  await writeFile(published.path, 'existing unrelated content');
  await assert.rejects(publishInlineOnboarding({ source: prepared.path, expectedSHA256: prepared.sha256, hostDirectory }), /Refusing to overwrite/);
  assert.equal(await readFile(published.path, 'utf8'), 'existing unrelated content');
});

test('publication hands off the complete localized reply and suppresses only an already-delivered welcome', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-welcome-reply-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const language of ['zh', 'en', 'ja', 'ko', 'fr', 'es', 'pt'] as const) {
    const prepared = await renderInlineOnboarding({ appRoot, output: path.join(directory, 'runtime', language + '.html'), language });
    const options = { source: prepared.path, expectedSHA256: prepared.sha256, hostDirectory: path.join(directory, 'host') };
    const published = await publishInlineOnboarding(options);
    assert.equal(published.language, language);
    assert.equal(published.welcomeMarkdown, welcomeMarkdown(language));
    assert.equal(published.finalReplyMarkdown, `${prepared.welcomeMarkdown}\n\n${published.contentReference}`);
    assert.equal(published.nativeMcpSessionVerified, false);
    const recovered = await publishInlineOnboarding({ ...options, welcomeDelivered: true });
    assert.equal(recovered.welcomeMarkdown, '');
    assert.equal(recovered.finalReplyMarkdown, published.contentReference);
    assert.equal(await readFile(recovered.path, 'utf8'), await readFile(prepared.path, 'utf8'));
  }
});

test('publication CLI returns a complete reply from the frozen document language', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-welcome-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prepared = await renderInlineOnboarding({ appRoot, output: path.join(directory, 'runtime/cards.html'), language: 'zh' });
  const args = [path.join(appRoot, 'scripts/inline-onboarding.mjs'), '--publish-from', prepared.path,
    '--sha256', prepared.sha256, '--host-directory', path.join(directory, 'host')];
  const published = JSON.parse(await runFile(process.execPath, args, { env: { ...process.env, OPENMOTION_ONBOARDING_LANGUAGE: 'en' } }));
  assert.equal(published.finalReplyMarkdown, `${welcomeMarkdown('zh')}\n\n${published.contentReference}`);
  const recovered = JSON.parse(await runFile(process.execPath, [...args, '--welcome-delivered']));
  assert.equal(recovered.finalReplyMarkdown, published.contentReference);
});

test('every three-reference selection requires native cards with image and video origin permission', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-native-card-selection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const presentation = loadTemplatePresentation();
  assert.deepEqual(presentation.content._meta.ui.csp.resourceDomains, ['blob:', 'https://r.open-design.ai']);
  for (let start = 0; start <= onboardingTemplateIds.length - 3; start++) {
    const templateIds = onboardingTemplateIds.slice(start, start + 3);
    const result = await renderInlineOnboarding({ appRoot, output: path.join(directory, start + '.html'), language: 'zh', templateIds, previewSource: 'reference' });
    assert.equal(result.status, 'native_required');
    assert.equal(result.path, undefined);
    assert.deepEqual(result.presentation.arguments, { templateIds, language: 'zh', onboarding: true });
    assert.match(result.welcomeMarkdown, /我是你的开源视频创作搭档/);
    assert.match(result.instructions, /does not satisfy native delivery/);
  }
});

test('all four three-of-four selections fit the complete HTML budget in every supported language', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-all-project-previews-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const previews = loadInlineProjectPreviews([...onboardingTemplateIds]);
  for (const preview of previews) {
    assert(Buffer.from(preview.videoBase64, 'base64').length > 1000);
    assert(preview.durationSeconds > 10);
    assert.equal(preview.videoMimeType, 'video/webm');
  }
  let combinations = 0;
  let largestBytes = 0;
  for (let a = 0; a < onboardingTemplateIds.length - 2; a++) {
    for (let b = a + 1; b < onboardingTemplateIds.length - 1; b++) {
      for (let c = b + 1; c < onboardingTemplateIds.length; c++) {
        const templateIds = [onboardingTemplateIds[a], onboardingTemplateIds[b], onboardingTemplateIds[c]];
        combinations++;
        for (const language of ['zh', 'en', 'ja', 'ko', 'fr', 'es', 'pt']) {
          const result = await renderInlineOnboarding({ appRoot, templateIds, language,
            output: path.join(directory, `${a}-${b}-${c}-${language}.html`) });
          assert.equal(result.status, 'prepared');
          const fragment = await readFile(result.path);
          assert.equal(result.bytes, fragment.length);
          assert(fragment.length < 1_000_000, `${templateIds.join(',')} (${language}): ${fragment.length} bytes`);
          assert.doesNotMatch(fragment.toString('utf8'), /https:\/\/r\.open-design\.ai/);
          assert.deepEqual(result.templateIds, templateIds);
          largestBytes = Math.max(largestBytes, fragment.length);
        }
      }
    }
  }
  assert.equal(combinations, 4);
  t.diagnostic(`All 4 combinations × 7 languages fit; largest HTML: ${largestBytes} bytes`);
});

test('inline project previews reject changed media and source identities', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-project-identity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(path.join(appRoot, 'mcp-ui/template-recommendations/project-previews'), path.join(directory, 'project-previews'), { recursive: true });
  const manifestPath = path.join(directory, 'project-previews/manifest.json');
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original), id = manifest.templates[0].id;
  manifest.templates[0].sourceFilesSha256 = '0'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadInlineProjectPreviews([id], { directory }), /source identity differs/);
  await writeFile(manifestPath, original);
  await writeFile(path.join(directory, manifest.templates[0].video.path), 'invalid');
  assert.throws(() => loadInlineProjectPreviews([id], { directory }), /asset identity differs/);
});
