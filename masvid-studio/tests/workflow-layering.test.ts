import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getWorkflow, readWorkflowResource, workflowDocumentAliases, workflowReferences } from '../shared/workflow.ts';

test('legacy director resources return the shared body while references use production identity', async () => {
  for (const [legacy, canonical] of Object.entries(workflowDocumentAliases)) {
    const section = canonical.endsWith('/review.md') ? 'review' : 'decisions';
    const current = await getWorkflow(section, 'production');
    const previous = JSON.parse((await readWorkflowResource(`openmotion://workflow/director/${section}`, '/unused')).text);
    assert.equal(previous.workflow, 'director');
    assert.equal(previous.section, section);
    assert.equal(previous.documentId, canonical);
    assert.equal(previous.content, current.content);
    assert.equal(previous.contentHash, current.contentHash);
    assert.deepEqual(previous.references, current.references);
    const linked = workflowReferences(`[legacy](../openmotion-director/references/${legacy.split('/').at(-1)})`, 'skills/openmotion-recreate/SKILL.md');
    assert.deepEqual(linked, [{ workflow: 'production', section, documentId: canonical }]);
    await assert.rejects(readFile(new URL('../' + legacy, import.meta.url), 'utf8'), { code: 'ENOENT' }, 'Old local paths must not keep a forwarding copy');
  }
});

test('provider guides belong to the media Skill while older production resources return the same bodies', async () => {
  for (const provider of ['account', 'compatible', 'fal', 'opendesign', 'atlascloud', 'wavespeed']) {
    const current = await getWorkflow(provider, 'media');
    const previous = JSON.parse((await readWorkflowResource(`openmotion://workflow/production/${provider}`, '/unused')).text);
    assert.equal(current.documentId, `skills/openmotion-media/references/providers/${provider}.md`);
    assert.equal(previous.documentId, current.documentId);
    assert.equal(previous.contentHash, current.contentHash);
    assert.deepEqual(workflowReferences(`[guide](references/providers/${provider}.md)`, 'skills/openmotion-media/SKILL.md'), [{ workflow: 'media', section: provider, documentId: current.documentId }]);
    assert.doesNotMatch(current.content, /```bash/, `${provider} templates must not use shell wire examples`);
    for (const block of current.content.matchAll(/```json\n([\s\S]*?)\n```/g)) {
      const input = JSON.parse(block[1]);
      assert.ok(!Object.hasOwn(input, 'projectId'), `${provider} generation must remain project-independent`);
      if (input.action === 'transcript' && input.transcript.command === 'submit') {
        assert.equal(input.transcript.projectId, 'PROJECT_ID', 'Transcription must identify the project-owned source');
        assert.ok(input.transcript.sourcePath);
      }
    }
  }
});

test('shared audio execution and review do not require original sound design or contributor evaluation', async () => {
  const sound = await getWorkflow('sound');
  const review = await getWorkflow('review');
  for (const document of [sound, review]) {
    assert.ok(!document.references.some(reference => reference.workflow === 'director'));
    assert.ok(!document.content.includes('## Skill 自身的行为验证'));
  }
  assert.match(sound.content, /锁定画面版本/);
  assert.match(sound.content, /实际使用的音频版本/);
  assert.match(sound.content, /正常速度声画体验/);
});

test('template orchestration depends on shared execution without reverse overrides', async () => {
  for (const section of ['context', 'native', 'production', 'templates', 'verification']) {
    const document = await getWorkflow(section);
    assert.ok(!document.references.some(reference => reference.workflow === 'template' || reference.workflow === 'recreate'), section);
  }
  const unchanged = await getWorkflow('unchanged', 'template');
  for (const section of ['native', 'production', 'verification']) {
    assert.ok(unchanged.references.some(reference => reference.workflow === 'production' && reference.section === section));
  }
  for (const section of ['firstuse', 'recipes']) {
    assert.equal((await getWorkflow(section, 'template')).workflow, 'template');
  }
  const catalog = await getWorkflow('templates');
  assert.ok(!catalog.content.includes('## First-run experience defaults'));
  assert.ok(!catalog.content.includes('## `product-proof`'));
});

test('shared delivery prefers native playback and forbids uncertain duplicate previews', async () => {
  const runtime = await getWorkflow('production');
  const verification = await getWorkflow('verification');
  const templates = await getWorkflow('templates');
  const template = await getWorkflow('start', 'template');
  assert.match(runtime.content, /In Codex, the default is one video embed in the final reply/);
  assert.match(runtime.content, /do not call `openmotion_show_video` on this route/);
  assert.match(runtime.content, /Only when native preview is unavailable and the connection exposes/);
  assert.match(runtime.content, /If neither route is usable, deliver an accessible verified file\/link/);
  assert.match(runtime.content, /mutually exclusive for the same completed export/);
  assert.match(runtime.content, /uncertain rendering result does not authorize another preview/);
  assert.match(runtime.content, /same SHA-256/);
  assert.match(runtime.content, /Never overwrite a path already embedded for an earlier version/);
  assert.match(runtime.content, /Use a plain link, not another video embed/);
  for (const document of [verification, templates]) {
    assert.ok(document.references.some(reference => reference.section === 'production'));
    assert.match(document.content, /production\.md#choose-one-final-video-preview/);
  }
  assert.match(template.content, /selects the final preview independently of download requests/);
  for (const route of ['production', 'director', 'template', 'recreate']) {
    const entry = await getWorkflow('start', route);
    assert.doesNotMatch(entry.content, /只有用户明确要 MP4|否则导出只用于自检|Do not copy, link or attach MP4s/);
    assert.match(entry.content, /choose-one-final-video-preview|shared final-video delivery workflow|shared delivery flow/);
  }
});

test('final presentation timeout preserves file verification and pending editor evidence', async () => {
  const runtime = await getWorkflow('production');
  const verification = await getWorkflow('verification');
  const native = await getWorkflow('native');
  assert.match(runtime.content, /openmotion_show_video` in its own host tool call/);
  assert.match(runtime.content, /about 60 seconds[\s\S]*already verified MP4's absolute file path and finish/);
  assert.match(runtime.content, /timeout cannot turn a pending\/hidden\/unavailable editor into confirmed delivery/);
  assert.match(verification.content, /Retain all actual-file playback checks above/);
  assert.match(verification.content, /Play from start to end/);
  assert.match(verification.content, /Replay from the beginning/);
  assert.match(native.content, /only a visible preview with the latest content actually inspected can be `confirmed`/);
});

test('recreation delivers the same final version once and limits file supplementation', async () => {
  const recreate = await getWorkflow('start', 'recreate');
  assert.match(recreate.content, /same version's verified final video once/);
  assert.match(recreate.content, /host-native embedding without a download request/);
  assert.match(recreate.content, /Playback recovery reuses the completed export/);
  const delivery = await getWorkflow('verification', 'recreate');
  assert.match(delivery.content, /openmotion_export_request\(\{projectId,workId,requestId,versionId,expectedRevision,audio\}\)/);
  assert.match(delivery.content, /same editor version and workId, presenting the final chat video once/);
});

test('cold-start scoped examples expose only the shared methods needed by each request', async () => {
  const context = await getWorkflow('context');
  const cases = [
    { request: '局部改字', sections: ['edit', 'production', 'native', 'review'] },
    { request: '换已选现成音乐', sections: ['edit', 'materials', 'production', 'sound', 'review', 'native'] },
    { request: '原样模板，明确要 HTML／工程文件', sections: ['production', 'native', 'verification'] },
    { request: '原样模板，明确要 MP4', sections: ['verification'] },
  ];
  for (const { request, sections } of cases) {
    const row = context.content.split('\n').find(line => line.startsWith(`| ${request}`));
    assert.ok(row, request);
    const references = workflowReferences(row, context.documentId);
    assert.deepEqual(references.map(reference => reference.section), sections, request);
    for (const reference of references) {
      assert.equal(reference.workflow, 'production');
      const response = JSON.parse((await readWorkflowResource(`openmotion://workflow/${reference.workflow}/${reference.section}`, '/unused')).text);
      assert.equal(response.documentId, reference.documentId);
      assert.ok(!response.references.some(target => target.workflow === 'director'), request);
    }
  }
  const unchanged = await getWorkflow('unchanged', 'template');
  assert.deepEqual(unchanged.references.map(reference => reference.section), ['production', 'verification', 'native']);
  assert.match(unchanged.content, /HTML\/project-only requests finish[\s\S]*without an export or MP4 playback task/);
  assert.match(unchanged.content, /Read the engine authoring guide, creative review, material selection and edit references when the task actually needs authoring or a detected defect/);
  assert.match(context.content, /`references` 是发现索引，不代表每个目标都必读/);
});

test('reference-video routes share one reading and measurement method and keep only their own rules', async () => {
  const shared = await getWorkflow('reference');
  assert.equal(shared.documentId, 'skills/openmotion-production/references/reference-video.md');
  assert.ok(!shared.references.some(reference => reference.workflow !== 'production'));
  assert.ok(!/openmotion-(recreate|video-to-template)|TEMPLATE\.md/.test(shared.content), 'Shared reading must not name a selecting entry or its record format');
  for (const phrase of ['never evidence of motion', 'measure probe', 'two consecutive fixes', 'Restore a missing original hard cut', 'distinctive lettering', 'runtime/media/bin']) {
    assert.ok(shared.content.includes(phrase), phrase);
  }
  const routes = [
    ['recreate', ['start', 'rebuild']],
    ['video-to-template', ['start', 'measure', 'rebuild']],
  ] as const;
  for (const [workflow, sections] of routes) {
    for (const section of sections) {
      const document = await getWorkflow(section, workflow);
      for (const phrase of ['navigation only', 'measure probe', 'Google Fonts', 'runtime/media/bin', 'one clip per object', 'mouse pointer with an inset', 'never claim to have watched', 'never as passed', 'two consecutive fixes']) {
        assert.ok(!document.content.includes(phrase), `${workflow}/${section} repeats shared method: ${phrase}`);
      }
    }
    const start = await getWorkflow('start', workflow);
    const rebuild = await getWorkflow('rebuild', workflow);
    assert.ok([...start.references, ...rebuild.references].some(reference => reference.workflow === 'production' && reference.section === 'reference'), workflow);
  }
  const context = await getWorkflow('context');
  for (const request of ['| 复刻视频', '| 明确要求视频转可复用模板']) {
    const row = context.content.split('\n').find(line => line.startsWith(request));
    assert.ok(row && workflowReferences(row, context.documentId).some(reference => reference.section === 'reference'), request);
  }
});

const skillRoot = new URL('../skills/', import.meta.url);
const creativeEntries = ['openmotion-director', 'openmotion-recreate', 'openmotion-template-to-video', 'openmotion-video-to-template'];

async function skillMarkdown() {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(skillRoot, { recursive: true })).filter(file => file.endsWith('.md')).map(file => file.split('\\').join('/')).sort();
  return Promise.all(files.map(async file => ({ file, text: await readFile(new URL(file, skillRoot), 'utf8') })));
}

const withoutCode = (text: string) => text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, ' ').replace(/`[^`\n]*`/g, ' ');

test('the media Skill serves every entry without naming any of them', async () => {
  for (const { file, text } of await skillMarkdown()) {
    if (!file.startsWith('openmotion-media/')) continue;
    assert.doesNotMatch(text, /openmotion-(?:director|recreate|template-to-video|video-to-template)\b|workflow\/(?:director|recreate|template|video-to-template)\//, file);
  }
});

test('an entry reaches another creative entry only through its SKILL.md', async () => {
  const crossings: string[] = [];
  for (const { file, text } of await skillMarkdown()) {
    for (const [, target] of withoutCode(text).matchAll(/\]\(<?([^)\s>#]+)/g)) {
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      const [owner] = file.split('/');
      const [entry, ...rest] = resolved.split('/');
      if (entry !== owner && creativeEntries.includes(entry) && rest.join('/') !== 'SKILL.md') crossings.push(`${file} -> ${resolved}`);
    }
  }
  assert.deepEqual(crossings, []);
});

test('non-media Skills reach openmotion-media only through its SKILL.md', async () => {
  const crossings: string[] = [];
  for (const { file, text } of await skillMarkdown()) {
    const [owner] = file.split('/');
    if (owner === 'openmotion-media') continue;
    for (const [, target] of withoutCode(text).matchAll(/\]\(<?([^)\s>#]+)/g)) {
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      const [entry, ...rest] = resolved.split('/');
      if (entry === 'openmotion-media' && rest.join('/') !== 'SKILL.md') crossings.push(`${file} -> ${resolved}`);
    }
  }
  assert.deepEqual(crossings, []);
});

test('entry routing tables in openmotion and openmotion-production cover every creative entry consistently', async () => {
  const bootstrap = await readFile(new URL('openmotion/SKILL.md', skillRoot), 'utf8');
  const production = await getWorkflow('start', 'production');
  for (const entry of creativeEntries) {
    assert.ok(bootstrap.includes(entry), `openmotion/SKILL.md missing ${entry}`);
    assert.ok(production.content.includes(`../${entry}/SKILL.md`), `openmotion-production/SKILL.md missing link to ${entry}`);
  }
  assert.ok(bootstrap.includes('openmotion-production'), 'openmotion/SKILL.md missing openmotion-production');
  assert.ok(bootstrap.includes('openmotion-media'), 'openmotion/SKILL.md missing openmotion-media');
});

test('no long sentence is copied between Skill files', async () => {
  // Chinese characters are paired so a twelve-token window covers a clause in either language.
  const tokens = (text: string) => (withoutCode(text).replace(/\]\([^)]*\)/g, ']').match(/\p{Script=Han}+|[A-Za-z0-9_]+/gu) ?? [])
    .flatMap(token => /\p{Script=Han}/u.test(token) ? token.match(/.{1,2}/gu)! : [token.toLowerCase()]);
  const width = 12;
  const seen = new Map<string, string>();
  const copies = new Set<string>();
  for (const { file, text } of await skillMarkdown()) {
    const words = tokens(text);
    for (let index = 0; index + width <= words.length; index++) {
      const shingle = words.slice(index, index + width).join(' ');
      const first = seen.get(shingle);
      // Each provider guide follows the same template and must stand alone.
      const providers = (name: string) => name.startsWith('openmotion-media/references/providers/');
      if (first && first !== file && !(providers(first) && providers(file))) copies.add(`${first} | ${file}: ${shingle}`);
      else if (!first) seen.set(shingle, file);
    }
  }
  assert.deepEqual([...copies], []);
});

test('each moved rule stays in its owner and entries link to it', async () => {
  const owners = [
    ['native', ['## Editable preview handoff', '### Continuing edits', '### Codex host calls', '## Project loop']],
    ['templates', ['## First-run delivery']],
    ['context', ['## 中途换入口', '## 工具连接', '## 共享质量，按职责应用']],
    ['reference', ['## Check fidelity and edit dependencies']],
  ] as const;
  for (const [section, headings] of owners) {
    const document = await getWorkflow(section);
    for (const heading of headings) assert.ok(document.content.split('\n').includes(heading), `${section}: ${heading}`);
  }
  const jobs = await getWorkflow('jobs', 'media');
  const providerGuides = (await readdir(new URL('../skills/openmotion-media/references/providers/', import.meta.url))).filter(name => name.endsWith('.md')).map(name => 'skills/openmotion-media/references/providers/' + name).sort();
  assert.deepEqual(jobs.references.filter(reference => reference.documentId.includes('/providers/')).map(reference => reference.documentId).sort(), providerGuides);
  const links = [
    ['recreate', 'templates', 'first-run-delivery'],
    ['template', 'templates', 'first-run-delivery'],
    ['recreate', 'native', 'editable-preview-handoff'],
    ['template', 'native', 'editable-preview-handoff'],
    ['director', 'native', 'editable-preview-handoff'],
    ['production', 'native', 'continuing-edits'],
  ] as const;
  for (const [workflow, section, anchor] of links) {
    assert.ok((await getWorkflow('start', workflow)).content.includes(`${section}.md#${anchor}`), `${workflow} -> ${section}#${anchor}`);
  }
  const planning = await getWorkflow('planning', 'media');
  assert.match(planning.content, /the calling entry decides how generated media serves the motion design/);
  assert.match((await getWorkflow('start', 'director')).content, /生成只升级动态影片，不替代它/);
  assert.match((await getWorkflow('start', 'recreate')).content, /Keep the reference's story, shot order, motion, holds and cuts around generated media/);
  assert.match((await getWorkflow('start', 'production')).content, /生成或替换的素材原位接替原素材/);
  assert.match((await getWorkflow('start', 'template')).content, /A generated or replacement asset takes the planned/);
});

test('narration and editable captions strategy stays in sound.md and routes link without duplicating it', async () => {
  const sound = await getWorkflow('sound');
  assert.match(sound.content, /## 配音与可编辑字幕协同/);
  assert.match(sound.content, /大字排版[\s\S]*不额外叠加/);
  assert.match(sound.content, /opendesign[\s\S]*account/);
  assert.match(sound.content, /job\.result[\s\S]*version\.result/);
  assert.match(sound.content, /alignment[\s\S]*sentences/);
  assert.match(sound.content, /silencedetect/);
  assert.match(sound.content, /caption_add[\s\S]*requestId/);
  assert.match(sound.content, /caption_update[\s\S]*transcriptId[\s\S]*captionSettings[\s\S]*remove:\s*true/);
  assert.match(sound.content, /document\.id[\s\S]*document\.revision[\s\S]*expectedTranscriptRevision/);
  assert.match(sound.content, /data-timeline-locked/);
  assert.match(sound.content, /captionSettings:\s*\{\s*pacing:\s*"word"\s*\}/);
  assert.match(sound.content, /caption_tracks[\s\S]*kind:\s*"caption"[\s\S]*cueCount > 0/);
  assert.ok(sound.references.some(reference => reference.workflow === 'production' && reference.section === 'transcripts'));

  for (const [workflow, section] of [
    ['production', 'materials'],
    ['production', 'context'],
    ['director', 'start'],
    ['director', 'actions'],
    ['recreate', 'start'],
    ['template', 'start'],
  ] as const) {
    const doc = await getWorkflow(section, workflow);
    const expectsAnchor = !(workflow === 'production' && section === 'context');
    assert.ok(doc.content.includes(expectsAnchor ? 'sound.md#配音与可编辑字幕协同' : 'sound.md'), `${workflow}/${section} must link to shared sound/caption sync`);
    assert.ok(doc.references.some(reference => reference.workflow === 'production' && reference.section === 'sound'), `${workflow}/${section}`);
  }

  const verification = await getWorkflow('verification');
  assert.match(verification.content, /caption_tracks/);
  const recreateVerification = await getWorkflow('verification', 'recreate');
  assert.match(recreateVerification.content, /caption_tracks/);
  const planning = await getWorkflow('planning', 'media');
  const inspection = await getWorkflow('inspection', 'media');
  assert.match(planning.content, /opendesign[\s\S]*job\.result[\s\S]*account/);
  assert.match(inspection.content, /opendesign[\s\S]*job\.result[\s\S]*versionId[\s\S]*version\.result/);
});

test('OPEND-5424 generation timing, cross-shot consistency and mixed-media boundaries stay single-sourced in materials.md', async () => {
  const materials = await getWorkflow('materials');
  assert.match(materials.content, /### Generation timing ladder/);
  assert.match(materials.content, /## Cross-shot consistency/);
  assert.match(materials.content, /## Mixed-media recreation boundaries/);
  assert.match(materials.content, /image-to-video \(I2V\)/);
  assert.match(materials.content, /Lock one visual anchor first/);
  assert.match(materials.content, /continuation cut/);
  assert.match(materials.content, /angle\/scene change/);
  assert.match(materials.content, /action-ready before I2V/);

  for (const [workflow, section, anchors] of [
    ['director', 'start', ['#generation-timing-ladder', '#cross-shot-consistency']],
    ['recreate', 'start', ['#generation-timing-ladder', '#cross-shot-consistency', '#mixed-media-recreation-boundaries']],
    ['template', 'start', ['#generation-timing-ladder', '#cross-shot-consistency']],
    ['video-to-template', 'rebuild', ['#generation-timing-ladder', '#cross-shot-consistency', '#mixed-media-recreation-boundaries']],
    ['media', 'planning', ['#generation-timing-ladder', '#cross-shot-consistency']],
  ] as const) {
    const doc = await getWorkflow(section, workflow);
    for (const anchor of anchors) {
      assert.ok(doc.content.includes(`materials.md${anchor}`), `${workflow}/${section} must link to materials.md${anchor}`);
    }
  }

  const jobs = await getWorkflow('jobs', 'media');
  assert.match(jobs.content, /dependent cross-shot chains/i);
  assert.match(jobs.content, /unapproved extra paid image-edit jobs/i);
  const inspection = await getWorkflow('inspection', 'media');
  assert.match(inspection.content, /beginning pose/);
  assert.match(inspection.content, /side-by-side against the anchor/);

  const reference = await getWorkflow('reference');
  assert.match(reference.content, /cut audit[\s\S]*measure cuts[\s\S]*three frames/);
  const v2tVerify = await getWorkflow('verification', 'video-to-template');
  assert.ok(v2tVerify.content.includes('reference-video.md#check-fidelity-and-edit-dependencies'));
  assert.doesNotMatch(v2tVerify.content, /no fixed number of permitted rounds/);
});

test('surgical editing, readable source formatting and template adaptation stay decoupled in their single owners', async () => {
  const edit = await getWorkflow('edit');
  assert.ok(edit.content.split('\n').includes('### 大文件原地修改与保存前结构核对'));
  assert.match(edit.content, /data-composition-src[\s\S]*data-hf-id[\s\S]*90%[\s\S]*70%/);
  assert.match(edit.content, /最多重做 1 次/);

  const native = await getWorkflow('native');
  assert.ok(native.content.split('\n').includes('### Readable multi-line source'));

  const reference = await getWorkflow('reference');
  assert.ok(reference.content.includes('native.md#readable-multi-line-source'));
  assert.ok(reference.references.some(ref => ref.workflow === 'production' && ref.section === 'native'));

  const v2tVerify = await getWorkflow('verification', 'video-to-template');
  assert.ok(v2tVerify.content.includes('native.md#readable-multi-line-source'));
  const recreateVerify = await getWorkflow('verification', 'recreate');
  assert.ok(recreateVerify.content.includes('native.md#readable-multi-line-source'));

  const templateStart = await getWorkflow('start', 'template');
  assert.ok(templateStart.content.includes('edit.md#大文件原地修改与保存前结构核对'));
  assert.ok(templateStart.content.includes('references/adaptation.md'));
  assert.ok(templateStart.content.includes('fonts.md#use-the-normal-project-write-boundary'));
  assert.ok(templateStart.references.some(ref => ref.workflow === 'template' && ref.section === 'adaptation'));
  assert.ok(templateStart.references.some(ref => ref.workflow === 'production' && ref.section === 'edit'));
  assert.ok(templateStart.references.some(ref => ref.workflow === 'production' && ref.section === 'fonts'));

  const adaptation = await getWorkflow('adaptation', 'template');
  assert.equal(adaptation.documentId, 'skills/openmotion-template-to-video/references/adaptation.md');
  assert.ok(adaptation.references.some(ref => ref.workflow === 'production' && ref.section === 'edit'));
  assert.ok(adaptation.references.some(ref => ref.workflow === 'production' && ref.section === 'materials'));
  assert.ok(adaptation.references.some(ref => ref.workflow === 'production' && ref.section === 'sound'));
  assert.ok(adaptation.content.includes('edit.md#大文件原地修改与保存前结构核对'));
  assert.ok(adaptation.content.includes('edit.md#让下一轮接着当前结果'));
  assert.ok(adaptation.content.includes('sound.md#配音与可编辑字幕协同'));
  assert.match(adaptation.content, /Hard cap[\s\S]*Approximate target|Approximate target[\s\S]*Hard cap/);
  assert.match(adaptation.content, /Narration\/TTS precedence/);
});
