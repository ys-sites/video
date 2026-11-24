import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import test from 'node:test';
import {
  applyImageToHtml,
  briefMarkdown,
  draftSocialPosts,
  listHtmlImageTargets,
  runReadme,
  scenarioStarterPage,
  scriptOutline,
  socialPostsMarkdown,
} from '../shared/scenario-content.ts';
import { localizedScenarioMediaLabel } from '../shared/scenario-media-names.ts';
import { resolveScenarioStepPrompt, scenarioStepPrompt } from '../shared/scenario-prompts.ts';
import type { PoolItem, ScenarioRun } from '../shared/scenario-runs.ts';
import {
  scenarioConcisePrompt,
  scenarioSkills,
  fillScenarioTemplate,
  findScenario,
  scenarioAgentPrompt,
  scenarioDefinitions,
  scenarioRecipeTools,
  scenarioRunAgentPrompt,
  socialPlatforms,
  type PageRecipeId,
  type ScenarioSkillRef,
  type ScenarioWorkspaceMode,
} from '../shared/scenarios.ts';
import { workflowResources } from '../shared/workflow.ts';

test('existing generated media labels follow the interface locale and retain their original versions', () => {
  const scenario = findScenario('motion-full-chain')!;
  const audio: PoolItem = {
    id: 'audio', kind: 'audio', ref: { type: 'asset', assetId: 'audio-asset', versionId: 'audio-version' },
    source: 'generated', stepId: 'soundtrack', label: 'Idea to Motion Film · 2026-11-21 · Soundtrack v3',
    tags: [], pinned: false, addedAt: 0,
  };
  const video: PoolItem = {
    ...audio, id: 'video', kind: 'video', stepId: 'motion-film', label: 'Launch · Summer · Motion film v4',
  };
  const stepState = (item: PoolItem, modality: 'audio' | 'video', number: number): ScenarioRun['steps'][string] => ({
    stepId: item.stepId!, status: 'done', activeIterationId: null, bindings: {}, draft: {}, links: {},
    iterations: [{
      id: item.id, source: 'generated', createdAt: 0, number, inputs: [],
      job: { jobId: item.id, state: 'completed', modality, model: 'fixture:model' },
      outputs: [{ type: 'pool', poolItemId: item.id }],
    }],
  });
  const run = { steps: { soundtrack: stepState(audio, 'audio', 3), 'motion-film': stepState(video, 'video', 4) } };
  const zh = localizedScenarioMediaLabel(audio, run, scenario, 'zh-CN');
  assert.equal(zh, '创意到动效短片 · 2026-11-21 · 配乐与音频 v3');
  assert.equal(localizedScenarioMediaLabel({ ...audio, label: zh }, run, scenario, 'en'), audio.label);
  assert.equal(localizedScenarioMediaLabel(video, run, scenario, 'zh-CN'), 'Launch · Summer · 动效影片 v4');
  assert.equal(localizedScenarioMediaLabel({ ...audio, id: 'unlinked' }, run, scenario, 'zh-CN'), audio.label);
  assert.equal(localizedScenarioMediaLabel({ ...audio, source: 'upload' }, run, scenario, 'zh-CN'), audio.label);
  assert.equal(localizedScenarioMediaLabel({ ...audio, label: '夏日钢琴配乐' }, run, scenario, 'zh-CN'), '夏日钢琴配乐');
  assert.equal(audio.label, 'Idea to Motion Film · 2026-11-21 · Soundtrack v3');
});

test('scenarioStarterPage escapes untrusted brief content, includes slots and valid structure for every recipe', () => {
  const recipes: PageRecipeId[] = ['landing', 'sale', 'link-in-bio', 'code-animation'];
  const hostile = '<script>alert("xss")</script>Nova & Co';
  const brief = {
    productName: hostile,
    brandName: hostile,
    personaName: hostile,
    concept: hostile,
    idea: 'Launch fast with <img src=x onerror=alert(1)> safety',
    valueProps: ['Fast <b>setup</b>', 'Zero lock-in'],
    originalPrice: '$199',
    salePrice: '$99',
    promoCode: 'BF50',
    saleWindow: 'Nov 27 – Dec 1',
    pageUrl: 'javascript:alert(1)',
    cta: 'Buy now',
  };

  for (const recipe of recipes) {
    const files = scenarioStarterPage(recipe, brief, 'en');
    const html = files.find(f => f.path === 'index.html')?.content ?? '';
    const css = files.find(f => f.path === 'styles.css')?.content ?? '';
    assert.ok(html.length > 200, `${recipe} produces index.html`);
    assert.ok(css.length > 200, `${recipe} produces styles.css`);
    assert.ok(html.includes('<!DOCTYPE html>'), `${recipe} has doctype`);
    assert.ok(html.includes('</html>') && html.includes('</body>') && html.includes('</head>'), `${recipe} has closing tags`);
    assert.ok(html.includes('data-om-slot="hero"'), `${recipe} includes hero slot`);
    assert.ok(html.includes('data-om-slot="gallery"'), `${recipe} includes gallery slot`);
    assert.ok(!html.includes('<script>alert("xss")</script>'), `${recipe} escapes hostile script tag`);
    assert.ok(!html.includes('<img src=x'), `${recipe} escapes hostile img tag`);
    assert.ok(!html.includes('javascript:alert(1)'), `${recipe} blocks javascript: URL`);
    assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;Nova &amp; Co'), `${recipe} preserves escaped text`);
  }

  const saleHtml = scenarioStarterPage('sale', brief, 'en').find(f => f.path === 'index.html')!.content;
  assert.ok(saleHtml.includes('$99') && saleHtml.includes('$199') && saleHtml.includes('BF50'));
  assert.ok(saleHtml.includes('data-om-slot="product"'));

  const bioHtml = scenarioStarterPage('link-in-bio', brief, 'en').find(f => f.path === 'index.html')!.content;
  assert.ok(bioHtml.includes('data-om-slot="avatar"'));

  const landingWithUrl = scenarioStarterPage('landing', { ...brief, pageUrl: 'https://example.com/launch' }, 'en').find(f => f.path === 'index.html')!.content;
  assert.ok(landingWithUrl.includes('href="https://example.com/launch"'));
});

test('listHtmlImageTargets finds slots and img tags across starter and template HTML', () => {
  const starterHtml = scenarioStarterPage('sale', { productName: 'Tote' }, 'en').find(f => f.path === 'index.html')!.content;
  const starterTargets = listHtmlImageTargets(starterHtml);
  const slotNames = starterTargets.filter(t => t.kind === 'slot').map(t => t.slot);
  assert.deepEqual(slotNames, ['hero', 'product', 'gallery']);

  const templateHtml = '<html><body><section data-om-slot="banner" data-om-label="Top Banner"><img src="./hero.png" alt="Hero" /><img src="./sub.jpg" alt="Detail" /></section></body></html>';
  const targets = listHtmlImageTargets(templateHtml);
  assert.deepEqual(targets, [
    { kind: 'slot', slot: 'banner', label: 'Top Banner' },
    { kind: 'img', index: 0, src: './hero.png', alt: 'Hero' },
    { kind: 'img', index: 1, src: './sub.jpg', alt: 'Detail' },
  ]);
});

test('applyImageToHtml handles slot, img-index and append targets idempotently with escaped alt', () => {
  const starter = scenarioStarterPage('landing', { productName: 'Prism' }, 'en').find(f => f.path === 'index.html')!.content;
  const escapedAlt = 'Hero "quoted" <tag>';

  // Container slot + idempotency
  const once = applyImageToHtml(starter, { kind: 'slot', slot: 'hero' }, './assets/hero-12345678.png', escapedAlt);
  assert.ok(once.includes('src="./assets/hero-12345678.png"'));
  assert.ok(once.includes('alt="Hero &quot;quoted&quot; &lt;tag&gt;"'));
  const twice = applyImageToHtml(once, { kind: 'slot', slot: 'hero' }, './assets/hero-12345678.png', escapedAlt);
  assert.equal(twice.match(/hero-12345678\.png/g)?.length, 1);

  // Direct <img data-om-slot>
  const directImg = '<html><body><img data-om-slot="hero" src="./old.png" alt="Old" /></body></html>';
  const replacedSlotImg = applyImageToHtml(directImg, { kind: 'slot', slot: 'hero' }, './assets/new.png', 'Fresh');
  assert.ok(replacedSlotImg.includes('src="./assets/new.png"') && replacedSlotImg.includes('alt="Fresh"'));

  // img index replacement
  const twoImgs = '<html><body><img src="./a.png" alt="A" /><img src="./b.png" alt="B" /></body></html>';
  const replacedSecond = applyImageToHtml(twoImgs, { kind: 'img', index: 1 }, './assets/c.png', 'C & D');
  assert.ok(replacedSecond.includes('src="./a.png"'));
  assert.ok(replacedSecond.includes('src="./assets/c.png"') && replacedSecond.includes('alt="C &amp; D"'));

  // append on plain HTML without gallery slot (and idempotency)
  const plain = '<html><body><h1>Hello</h1></body></html>';
  const appended = applyImageToHtml(plain, { kind: 'append' }, './assets/gal.png', 'Gallery');
  assert.ok(appended.includes('data-om-slot="gallery"'));
  assert.ok(appended.includes('src="./assets/gal.png"'));
  const appendedAgain = applyImageToHtml(appended, { kind: 'append' }, './assets/gal.png', 'Gallery');
  assert.equal(appendedAgain.match(/gal\.png/g)?.length, 1);

  // Dollar replacement patterns ($1, $&, $') and data-src/data-alt attributes must be handled safely
  const lazyHtml = '<html><body><img data-src="./lazy.png" data-alt="Lazy alt" src="./real.png" alt="Real alt" /></body></html>';
  const dollarPatched = applyImageToHtml(
    lazyHtml,
    { kind: 'img', index: 0 },
    './assets/hero.png',
    "Save $1 off & $' deals",
  );
  assert.ok(dollarPatched.includes('data-src="./lazy.png"'), 'data-src must remain untouched');
  assert.ok(dollarPatched.includes('data-alt="Lazy alt"'), 'data-alt must remain untouched');
  assert.ok(dollarPatched.includes('src="./assets/hero.png"'), 'real src must be updated');
  assert.ok(dollarPatched.includes('alt="Save $1 off &amp; $&#39; deals"'), 'alt must preserve literal $1 and $\'');
});

test('draftSocialPosts enforces platform character, hashtag and title limits, rotates variants and localizes zh-CN', () => {
  const blackFriday = findScenario('black-friday')!;
  const longIdea = 'Ultra-durable travel weekender built for holiday getaways '.repeat(25);
  const brief = {
    productName: 'Nomad Holiday Weekender Tote Deluxe Edition',
    idea: longIdea,
    salePrice: '$79',
    originalPrice: '$149',
    promoCode: 'BF40',
    saleWindow: 'Nov 27 – Dec 1',
  };
  const allPlatforms = socialPlatforms.map(p => p.id);
  const v0 = draftSocialPosts(blackFriday, brief, allPlatforms, { tone: 'bold', variant: 0, locale: 'en' });
  const v1 = draftSocialPosts(blackFriday, brief, allPlatforms, { tone: 'bold', variant: 1, locale: 'en' });

  assert.equal(v0.length, allPlatforms.length);
  for (const post of v0) {
    const spec = socialPlatforms.find(p => p.id === post.platform)!;
    assert.ok(Array.from(post.text).length <= spec.maxChars, `${post.platform} respects maxChars`);
    assert.ok(post.hashtags.length <= spec.maxHashtags, `${post.platform} respects maxHashtags`);
    if ('maxTitleChars' in spec && spec.maxTitleChars) {
      assert.ok(post.title && Array.from(post.title).length <= spec.maxTitleChars, `${post.platform} respects maxTitleChars`);
    }
  }
  assert.notEqual(v0[0].text, v1[0].text, 'Variant rotation produces different hooks/CTAs');

  const zhPosts = draftSocialPosts(blackFriday, brief, ['xiaohongshu', 'douyin'], { locale: 'zh-CN', variant: 0 });
  assert.match(zhPosts[0].text, /[\u4e00-\u9fff]/, 'zh-CN draft uses Chinese phrasing');
  assert.ok(zhPosts[0].title && Array.from(zhPosts[0].title).length <= 20, 'Xiaohongshu zh-CN title <= 20 chars');

  const md = socialPostsMarkdown(v0);
  assert.ok(md.includes('# Social posts') && md.includes('## X (16:9)'));

  const scriptEn = scriptOutline({ personaName: 'Mina', topic: 'Batch filming' }, 'en');
  const scriptZh = scriptOutline({ personaName: 'Mina', topic: '批量拍摄' }, 'zh-CN');
  assert.ok(scriptEn.includes('[Hook') && scriptEn.includes('Mina'));
  assert.match(scriptZh, /开场 Hook/);
});

test('automatic step prompts localize instructions and options while preserving authored text', () => {
  const motion = findScenario('motion-full-chain')!;
  const storyboard = motion.steps.find(step => step.id === 'storyboard')!;
  const soundtrack = motion.steps.find(step => step.id === 'soundtrack')!;
  const brief = { concept: 'Learn to code.', visualStyle: '极简杂志风', aspect: '9:16', tone: 'premium', durationSeconds: '15' };
  const legacy = fillScenarioTemplate(storyboard.promptTemplate!, brief);

  const chinese = resolveScenarioStepPrompt(motion, storyboard, brief, { prompt: legacy }, 'zh-CN');
  assert.match(chinese, /^生成一张分镜画面。\n影片概念：Learn to code\.\n风格描述：极简杂志风\n.*9:16 竖屏$/);
  const musicPrompt = scenarioStepPrompt(motion, soundtrack, brief, 'zh-CN');
  assert.match(musicPrompt, /文案语气：高级质感/);
  assert.match(musicPrompt, /时长：15 秒/);
  assert.equal(scenarioStepPrompt(motion, storyboard, {}, 'ja-JP'), '絵コンテの1コマを作成してください。');
  assert.match(resolveScenarioStepPrompt(motion, storyboard, brief, { prompt: chinese, promptLocale: 'zh-CN' }, 'fr'), /^Créez une image de storyboard\./);
  assert.equal(resolveScenarioStepPrompt(motion, storyboard, brief, { prompt: legacy, promptEdited: true }, 'zh-CN'), legacy);
  assert.equal(resolveScenarioStepPrompt(motion, storyboard, brief, { prompt: 'Custom storyboard' }, 'zh-CN'), 'Custom storyboard');

  const blackFriday = findScenario('black-friday')!;
  const productImages = blackFriday.steps.find(step => step.id === 'product-images')!;
  assert.match(scenarioStepPrompt(blackFriday, productImages, { productDescription: '방수 소재' }, 'ko-KR'), /^제품 상세 정보: 방수 소재$/m);
});

test('empty saved motion-film prompts use the current brief and interface language', () => {
  const motion = findScenario('motion-full-chain')!;
  const film = motion.steps.find(step => step.id === 'motion-film')!;
  const brief = { concept: '秋季新品', visualStyle: '极简杂志风', aspect: '9:16', durationSeconds: '15' };
  const legacy = { prompt: 'Motion film sequence for : s' };
  const localized = { prompt: scenarioStepPrompt(motion, film, {}, 'zh-CN'), promptLocale: 'zh-CN' };

  assert.equal(resolveScenarioStepPrompt(motion, film, brief, legacy, 'zh-CN'), [
    '制作一段动效影片。',
    '影片概念：秋季新品',
    '风格描述：极简杂志风',
    '宽高比：9:16 竖屏',
    '时长：15 秒',
  ].join('\n'));
  assert.equal(
    resolveScenarioStepPrompt(motion, film, brief, localized, 'ja'),
    scenarioStepPrompt(motion, film, brief, 'ja'),
  );
  assert.equal(resolveScenarioStepPrompt(motion, film, {}, legacy, 'zh-CN'), '制作一段动效影片。');
  assert.equal(resolveScenarioStepPrompt(motion, film, brief, { ...legacy, promptEdited: true }, 'zh-CN'), legacy.prompt);
});

test('fillScenarioTemplate handles missing fields gracefully and prompt builders include every required tool', () => {
  const filledPartial = fillScenarioTemplate('Hero image for {productName}: {valueProps}, {visualStyle}', { productName: 'Nova' });
  assert.equal(filledPartial, 'Hero image for Nova');
  assert.ok(!filledPartial.includes('{'));

  // Preserves literal words like "code" and trailing punctuation in user values while cleaning empty `code {promoCode}`
  const preservedUserProse = fillScenarioTemplate('Storyboard frame for {concept}: {visualStyle}, {aspect} composition', {
    concept: 'Learn to code.',
    visualStyle: 'Minimal',
    aspect: '16:9',
  });
  assert.equal(preservedUserProse, 'Storyboard frame for Learn to code.: Minimal, 16:9 composition');

  const preservedTrailingColon = fillScenarioTemplate('Hero image for {productName}: {valueProps}, {visualStyle}', {
    productName: 'ACME:',
  });
  assert.equal(preservedTrailingColon, 'Hero image for ACME:');

  const cleanedEmptyPromoCode = fillScenarioTemplate(
    '30s Black Friday sales film for {productName}: {salePrice}, code {promoCode}, {saleWindow}',
    { productName: 'Holiday Tote', salePrice: '$79', promoCode: '', saleWindow: 'Nov 27' },
  );
  assert.equal(cleanedEmptyPromoCode, '30s Black Friday sales film for Holiday Tote: $79, Nov 27');

  const keptPromoCode = fillScenarioTemplate(
    '30s Black Friday sales film for {productName}: {salePrice}, code {promoCode}, {saleWindow}',
    { productName: 'Holiday Tote', salePrice: '$79', promoCode: 'BF40', saleWindow: 'Nov 27' },
  );
  assert.equal(keptPromoCode, '30s Black Friday sales film for Holiday Tote: $79, code BF40, Nov 27');

  const filledList = fillScenarioTemplate('Hero image for {productName}: {valueProps}, {visualStyle}', {
    productName: 'Nova',
    valueProps: ['Fast', 'Local'],
    visualStyle: 'Minimalist',
  });
  assert.equal(filledList, 'Hero image for Nova: Fast, Local, Minimalist');

  for (const scenario of scenarioDefinitions) {
    const prompt = scenarioAgentPrompt(scenario, { integration: { previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' } });
    for (const tool of scenarioRecipeTools) {
      assert.ok(prompt.includes(tool), `${scenario.id} prompt includes ${tool}`);
    }
    assert.ok(prompt.includes('openmotion_assets_use'));
    assert.ok(prompt.includes('command=export'));
    assert.ok(prompt.includes('/fixture/data'));
  }

  const bf = findScenario('black-friday')!;
  const runSummary = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Holiday Tote',
    revision: 3,
    brief: { productName: 'Holiday Tote' },
    activeStepId: 'detail-page',
    steps: {
      brief: { stepId: 'brief', status: 'done', activeIterationId: null, links: {} },
      'detail-page': { stepId: 'detail-page', status: 'in-progress', activeIterationId: null, links: { designProjectId: '22222222-2222-4222-8222-222222222222' } },
    },
    pool: [{
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'image' as const,
      label: 'Hero shot',
      stepId: 'product-images',
      pinned: true,
      ref: { type: 'asset' as const, assetId: '44444444-4444-4444-8444-444444444444', versionId: '55555555-5555-4555-8555-555555555555' },
    }],
  };
  const runPrompt = scenarioRunAgentPrompt(bf, runSummary, {
    stepId: 'detail-page',
    stepPrompt: 'Create a bold Black Friday landing page for Holiday Tote',
  });
  assert.ok(runPrompt.includes('11111111-1111-4111-8111-111111111111'));
  assert.ok(runPrompt.includes('expectedRevision: 3'));
  assert.ok(runPrompt.includes('44444444-4444-4444-8444-444444444444@55555555-5555-4555-8555-555555555555'));
  assert.ok(runPrompt.includes('22222222-2222-4222-8222-222222222222'));
  assert.ok(runPrompt.includes('Step write-back instructions:'));
  assert.ok(runPrompt.includes('Current step prompt: Create a bold Black Friday landing page for Holiday Tote'));
  assert.ok(runPrompt.includes('openmotion_assets_use(action="scenario", scenario={ command: "generate", runId: "11111111-1111-4111-8111-111111111111", expectedRevision: 3, stepId: "detail-page"'));
  assert.ok(runPrompt.includes('command: "add_pool"'));
  assert.ok(runPrompt.includes('command: "link_design"'));

  const briefStepPrompt = scenarioRunAgentPrompt(bf, runSummary, {
    stepId: 'brief',
    stepPrompt: 'Refine Holiday Tote offer brief',
  });
  assert.ok(briefStepPrompt.includes('Step write-back instructions:'));
  assert.ok(briefStepPrompt.includes('command: "update_brief" | "add_iteration"'));
  assert.ok(briefStepPrompt.includes('stepId: "brief"'));

  const videoStepPrompt = scenarioRunAgentPrompt(bf, runSummary, {
    stepId: 'sales-film',
    stepPrompt: '30s Holiday Tote reveal video',
  });
  assert.ok(videoStepPrompt.includes('command: "link_motion"'));
  assert.ok(videoStepPrompt.includes('stepId: "sales-film"'));

  const socialStepPrompt = scenarioRunAgentPrompt(bf, runSummary, {
    stepId: 'social',
    stepPrompt: 'Draft Black Friday social launch posts',
  });
  assert.ok(socialStepPrompt.includes('outputs: [{ type: "social", posts }]'));
  assert.ok(socialStepPrompt.includes('stepId: "social"'));

  assert.ok(briefMarkdown(bf, { productName: 'Tote' }).includes('## Product name'));
  const readme = runReadme(bf, {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Holiday Tote',
    revision: 3,
    brief: {},
    activeStepId: 'brief',
    steps: {},
    pool: [],
  }, { origin: 'http://127.0.0.1:4173' });
  assert.ok(readme.includes('# Holiday Tote') && readme.includes('manifest.json'));
});

test('every scenario step defines valid real Skills and scenarioSkills deduplicates in first-seen order', () => {
  const validWorkflowUris = new Set(workflowResources().map(resource => resource.uri));
  const modeCheck: ScenarioWorkspaceMode = 'agent';
  assert.equal(modeCheck, 'agent');

  for (const scenario of scenarioDefinitions) {
    const firstSeenIds: string[] = [];
    for (const step of scenario.steps) {
      assert.ok(step.skills && step.skills.length >= 1, `${scenario.id}/${step.id} defines at least one Skill`);
      for (const skill of step.skills as readonly ScenarioSkillRef[]) {
        assert.ok(skill.id.trim().length > 0, `${scenario.id}/${step.id} skill id`);
        assert.ok(skill.label.trim().length > 0, `${scenario.id}/${step.id} skill label`);
        assert.ok(skill.role.trim().length > 0, `${scenario.id}/${step.id} skill role`);
        if (skill.source === 'library') {
          const dirUrl = new URL(`../library/skills/${skill.id}`, import.meta.url);
          assert.ok(existsSync(dirUrl) && statSync(dirUrl).isDirectory(), `library skill directory exists: ${skill.id}`);
          assert.ok(existsSync(new URL(`../library/skills/${skill.id}/SKILL.md`, import.meta.url)), `SKILL.md exists: ${skill.id}`);
        } else {
          assert.equal(skill.source, 'workflow');
          assert.ok(skill.resourceUri && validWorkflowUris.has(skill.resourceUri), `valid workflow resourceUri: ${skill.resourceUri}`);
        }
        if (!firstSeenIds.includes(skill.id)) {
          firstSeenIds.push(skill.id);
        }
      }
    }

    const deduped = scenarioSkills(scenario);
    assert.deepEqual(deduped.map(skill => skill.id), firstSeenIds, `${scenario.id} preserves first-seen order`);
    assert.equal(new Set(deduped.map(skill => skill.id)).size, deduped.length, `${scenario.id} deduplicates skills`);
  }

  // Verify specific cross-step deduplication cases (e.g. openmotion-ad-script in black-friday appears in brief then social)
  const bfSkills = scenarioSkills(findScenario('black-friday')!);
  assert.equal(bfSkills[0].id, 'openmotion-ad-script');
  assert.equal(bfSkills[0].label, 'Campaign Script');
  assert.equal(bfSkills.filter(skill => skill.id === 'openmotion-ad-script').length, 1);
});

test('scenarioConcisePrompt stays under 35 lines with metadata, assets, skills pipeline and MCP instructions', () => {
  const bf = findScenario('black-friday')!;
  const runSummary = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Holiday Tote',
    revision: 3,
    brief: {
      idea: 'Limited-run canvas tote campaign',
      productName: 'Holiday Tote',
      salePrice: '$79',
      promoCode: 'BF40',
    },
    activeStepId: 'detail-page',
    steps: {
      brief: { stepId: 'brief', status: 'done', activeIterationId: null, links: {} },
      'detail-page': {
        stepId: 'detail-page',
        status: 'in-progress',
        activeIterationId: null,
        links: { designProjectId: '22222222-2222-4222-8222-222222222222' },
      },
    },
    pool: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        kind: 'image' as const,
        label: 'Secondary angle',
        stepId: 'product-images',
        pinned: false,
        ref: { type: 'asset' as const, assetId: '66666666-6666-4666-8666-666666666666', versionId: '77777777-7777-4777-8777-777777777777' },
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'image' as const,
        label: 'Hero shot',
        stepId: 'product-images',
        pinned: true,
        ref: { type: 'asset' as const, assetId: '44444444-4444-4444-8444-444444444444', versionId: '55555555-5555-4555-8555-555555555555' },
      },
    ],
  };

  const concise = scenarioConcisePrompt(bf, runSummary, {
    customPrompt: 'Create a high-contrast Black Friday tote campaign across page, video and social.',
    locale: 'en',
    integration: { previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' },
  });
  const lines = concise.split('\n');
  assert.ok(lines.length < 35, `Expected < 35 lines, got ${lines.length}`);
  assert.ok(concise.includes('workflow: black-friday'));
  assert.ok(concise.includes('runId: 11111111-1111-4111-8111-111111111111'));
  assert.ok(concise.includes('expectedRevision: 3'));
  assert.ok(concise.includes('workspace: /fixture/data'));
  assert.ok(concise.includes('studioUrl: http://127.0.0.1:4173'));
  assert.ok(concise.includes('locale: en'));
  assert.ok(concise.includes('linkedProjects: detail-page:design=22222222-2222-4222-8222-222222222222'));
  assert.ok(concise.includes('assets:'));
  // Pinned item must appear before unpinned item
  const heroIdx = concise.indexOf('asset:44444444-4444-4444-8444-444444444444@55555555-5555-4555-8555-555555555555 "Hero shot" (pinned)');
  const secondaryIdx = concise.indexOf('asset:66666666-6666-4666-8666-666666666666@77777777-7777-4777-8777-777777777777 "Secondary angle"');
  assert.ok(heroIdx > 0 && secondaryIdx > heroIdx, 'Pinned pool item comes first');
  assert.ok(concise.includes('openmotion_get_skill'));
  for (const tool of scenarioRecipeTools) {
    assert.ok(concise.includes(tool), `concise prompt includes ${tool}`);
  }
  assert.ok(concise.includes('library:openmotion-sale-countdown'));
  assert.ok(concise.includes('resource:openmotion://workflow/design/start'));
  assert.ok(concise.includes('Create a high-contrast Black Friday tote campaign across page, video and social.'));
  assert.ok(concise.includes('params: idea=Limited-run canvas tote campaign | productName=Holiday Tote | salePrice=$79 | promoCode=BF40'));

  // Without customPrompt, brief.idea becomes the main task and is excluded from params
  const briefMain = scenarioConcisePrompt(bf, runSummary);
  assert.ok(briefMain.includes('task: Limited-run canvas tote campaign'));
  assert.ok(briefMain.includes('params: productName=Holiday Tote | salePrice=$79 | promoCode=BF40'));
  assert.ok(!briefMain.includes('params: idea='));

  // Without run, all scenarios stay compact under 35 lines and use command=create
  for (const scenario of scenarioDefinitions) {
    const freshPrompt = scenarioConcisePrompt(scenario, null, {
      integration: { previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' },
    });
    assert.ok(freshPrompt.split('\n').length < 35, `${scenario.id} fresh concise prompt < 35 lines`);
    assert.ok(freshPrompt.includes('command=create') && freshPrompt.includes('assets: none'));
    assert.ok(freshPrompt.includes('command: "create"'));
  }
});
