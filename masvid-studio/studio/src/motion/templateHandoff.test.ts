// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { GalleryTemplate } from '../../../shared/catalog';
import { motionApi } from './useWorkspace';
import { findPreparedTemplate, prepareTemplateProject, preparedTemplateProjects, pendingTemplateProjects, rememberTemplateRequest, forgetTemplateRequest, templateHandoffPrompt, templateHandoffEnabled } from './templateHandoff';

vi.mock('./useWorkspace', () => ({ motionApi: vi.fn() }));
const api = vi.mocked(motionApi);
const template = { id: 'product-promo', title: 'Product Promo', hasHtmlProject: true, tags: [], kind: 'prism' } as unknown as GalleryTemplate;
const catalog = (id = 'operation-one', source = template.id) => ({ projects: [{ id: 'original-A', title: 'Original' }, { id: 'new-P', title: 'Product Promo' }], sessions: [{ id, templateId: source, activeArtifactId: 'artifact-one', artifacts: [{ id: 'artifact-one', projectId: 'new-P' }] }] });
afterEach(() => { api.mockReset(); sessionStorage.clear(); });

it('refuses to create a project from reference-only guidance', async () => {
  await expect(prepareTemplateProject({ ...template, hasHtmlProject: false }, 'original-A', 'operation-one')).rejects.toThrow('只有参考说明');
  expect(api).not.toHaveBeenCalled();
});
it('reuses the exact completed operation instead of making a second project', async () => {
  api.mockResolvedValue(catalog());
  const result = await prepareTemplateProject(template, 'original-A', 'operation-one');
  expect(result).toMatchObject({ projectId: 'new-P', originalProjectId: 'original-A', requestId: 'operation-one', templateId: template.id });
  expect(api).toHaveBeenCalledTimes(1);
  expect(preparedTemplateProjects()).toEqual([result]);
});
it('keeps the explicit session identity and save guard when creating an independent project', async () => {
  api.mockResolvedValueOnce({ projects: [], sessions: [] })
    .mockResolvedValueOnce({ sessionId: 'operation-one' })
    .mockResolvedValueOnce({ revision: 'revision-A', projectId: 'original-A' })
    .mockResolvedValueOnce({ projectId: 'new-P', projectTitle: 'Product Promo' });
  const result = await prepareTemplateProject(template, 'original-A', 'operation-one');
  expect(JSON.parse(api.mock.calls[1][1]!.body as string)).toMatchObject({ id: 'operation-one', templateId: 'product-promo' });
  expect(api.mock.calls[3][0]).toBe('/sessions/operation-one/artifacts');
  expect(JSON.parse(api.mock.calls[3][1]!.body as string)).toEqual({ templateId: 'product-promo', expectedRevision: 'revision-A', expectedProjectId: 'original-A' });
  expect(result.projectId).not.toBe(result.originalProjectId);
});
it('does not guess a result from another operation or another selected source', async () => {
  api.mockResolvedValueOnce(catalog('a-newer-operation')).mockResolvedValueOnce(catalog('operation-one', 'nyt-graph'));
  expect(await findPreparedTemplate(template, 'original-A', 'operation-one')).toBeNull();
  expect(await findPreparedTemplate(template, 'original-A', 'operation-one')).toBeNull();
  expect(preparedTemplateProjects()).toEqual([]);
});
it('keeps the four sections and exact reference identity in the instruction', () => {
  const text = templateHandoffPrompt({ ...template, id: 'reference-id', hasHtmlProject: false }, 'zh-CN');
  for (const section of ['使用说明：', '指定模板：', '创作要求：', '我的要求：']) expect(text).toContain(section);
  expect(text).toContain('reference-id');
  expect(text).toContain('没有原片工程');
  expect(text).toContain('返回准确工程链接');
  expect(text).not.toContain('基于完整模板');
});

it.each([
  ['ja', '使用方法：', '編集可能なプロジェクト', '参照動画', ['必須素材', '無音', '同じプロジェクト']],
  ['ko', '사용 안내:', '편집 가능한 프로젝트', '참고 영상', ['필수 자료', '무음', '같은 프로젝트']],
  ['de', 'Anleitung:', 'Editierbares Projekt', 'Videoreferenz', ['fehlendem Material', 'Stille', 'selben Projekt']],
  ['fr', 'Instructions :', 'Projet modifiable', 'Vidéo de référence', ['éléments indispensables', 'muet', 'même projet']],
  ['es', 'Instrucciones:', 'Proyecto editable', 'Vídeo de referencia', ['materiales imprescindibles', 'silencio', 'mismo proyecto']],
  ['it', 'Istruzioni:', 'Progetto modificabile', 'Video di riferimento', ['materiali essenziali', 'silenzio', 'stesso progetto']],
  ['ru', 'Инструкции:', 'Редактируемый проект', 'Видео для примера', ['обязательные материалы', 'тишину', 'этом же проекте']],
  ['tr', 'Talimatlar:', 'Düzenlenebilir proje', 'referans video', ['zorunlu malzemeleri', 'sessiz', 'aynı projede']],
  ['pt-BR', 'Instruções:', 'Projeto editável', 'Vídeo de referência', ['materiais essenciais', 'silêncio', 'mesmo projeto']],
] as const)('keeps %s project and reference instructions and acceptance requirements in the UI language', (locale, intro, editableLabel, referenceLabel, requirements) => {
  const editable = templateHandoffPrompt(template, locale);
  const reference = templateHandoffPrompt({ ...template, id: 'reference-id', hasHtmlProject: false }, locale);
  expect(editable.startsWith(intro)).toBe(true);
  expect(editable).toContain(template.id);
  expect(editable).toContain(editableLabel);
  expect(reference.startsWith(intro)).toBe(true);
  expect(reference).toContain('reference-id');
  expect(reference).toContain(referenceLabel);
  expect(reference).not.toContain(editableLabel);
  for (const requirement of requirements) {
    expect(editable).toContain(requirement);
    expect(reference).toContain(requirement);
  }
});

it('enables the accepted detail flow from the ordinary entry without a preview flag', () => {
  sessionStorage.clear();
  expect(templateHandoffEnabled()).toBe(true);
  sessionStorage.setItem('motion.template-handoff.preview', '0');
  expect(templateHandoffEnabled()).toBe(false);
});

it('ignores malformed stored handoff results without blocking the library', () => {
  sessionStorage.setItem('motion.template-handoff.results', '{"unexpected":true}');
  expect(preparedTemplateProjects()).toEqual([]);
  sessionStorage.setItem('motion.template-handoff.results', '[null,{"projectId":42}]');
  expect(preparedTemplateProjects()).toEqual([]);
});

it('retains only the exact pending request through a remount and clears it after reconciliation', async () => {
  const request = { templateId: template.id, originalProjectId: 'original-A', requestId: 'operation-one' };
  rememberTemplateRequest(request);
  expect(pendingTemplateProjects()).toEqual([request]);
  rememberTemplateRequest(request);
  expect(pendingTemplateProjects()).toHaveLength(1);
  api.mockResolvedValue(catalog());
  expect(await findPreparedTemplate(template, 'original-A', 'operation-one')).toMatchObject({ projectId: 'new-P' });
  expect(pendingTemplateProjects()).toEqual([]);
  rememberTemplateRequest(request);
  forgetTemplateRequest(request.requestId);
  expect(pendingTemplateProjects()).toEqual([]);
});

it('does not interpret an incomplete project lookup as authoritative not-found', async () => {
  api.mockResolvedValue({ projects: [] });
  await expect(findPreparedTemplate(template, 'original-A', 'operation-one')).rejects.toThrow('complete catalog');
});

it('resumes an acknowledged empty session without resubmitting a changed display title', async () => {
  api.mockResolvedValueOnce({ projects: [], sessions: [{ id: 'operation-one', templateId: template.id, title: 'Earlier title', artifacts: [] }] })
    .mockResolvedValueOnce({ revision: 'revision-A', projectId: 'original-A' })
    .mockResolvedValueOnce({ projectId: 'new-P', projectTitle: 'Product Promo' });
  await prepareTemplateProject({ ...template, title: '不同语言的标题' }, 'original-A', 'operation-one');
  expect(api.mock.calls.map(([url]) => url)).toEqual(['/projects', '/project/status', '/sessions/operation-one/artifacts']);
  expect(pendingTemplateProjects()).toEqual([]);
});
