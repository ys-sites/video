// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SkillsPage, skillSubmissionUrl } from './SkillsPage';
import { SkillMedia } from './SkillMedia';
import { motionSkills, skillPreviewSnapshot, skillPrompt, skillShortcut, studioSkillDefaults } from './skillCatalog';
import { readWorkspacePage, workspacePageHref } from './workspacePageRouting';
import { findTechniqueStudio } from '../../../shared/studio-catalog';
import { isWorkspaceSettingsPage } from '../../../shared/workspace-url';

vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ locale: 'en', t: (text: string, values?: { count: number }) => text.replace('{count}', String(values?.count)) }) }));
// Keep integration discovery offline; the page uses its built-in guide fallback.
vi.mock('./useWorkspace', () => ({ motionApi: vi.fn().mockRejectedValue(new Error('Offline test')) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Host() {
  const [skill, setSkill] = useState<string | null>(null);
  return <SkillsPage skillId={skill} onSkillChange={setSkill} />;
}
const button = (label: string) => [...container.querySelectorAll('button')].find(node => node.textContent?.includes(label))!;

it('lists every curated skill with its upstream repository', () => {
  act(() => root.render(<Host />));
  expect(container.querySelectorAll('.om-skill-gallery-card')).toHaveLength(motionSkills.length);
  expect(motionSkills).toHaveLength(130);
  expect(motionSkills[0].id).toBe('motionmaxxing');
  expect(motionSkills[1].id).toBe('openmotion-growth-teardown');
  expect(motionSkills[2].id).toBe('openmotion-design-styles');
  expect(motionSkills.slice(3, 6).map(skill => skill.id)).toEqual(['openmotion-sale-promo', 'openmotion-sale-countdown', 'openmotion-sale-carousel']);
  for (const skill of motionSkills) if (skill.repository) expect(skill.repository).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/tree\/main\/[\w.-]+)?$/);
  // Skills without an upstream repository are OpenMotion Library Skills (library/skills/<id>).
  for (const skill of motionSkills) if (!skill.repository) expect(skill.id).toMatch(/^openmotion-[a-z0-9-]+$/);
  expect(motionSkills.filter(skill => !skill.repository)).toHaveLength(97);
  // The upstream Skills keep their place right after the first two; presenter-style cards are spread out, never side by side.
  expect(motionSkills.slice(2, 26).every(skill => skill.repository)).toBe(true);
  expect(motionSkills.some((skill, i) => i > 0 && skill.category === 'Talking-head & editing' && motionSkills[i - 1].category === 'Talking-head & editing')).toBe(false);
  expect(new Set(motionSkills.map(skill => skill.id)).size).toBe(motionSkills.length);
});

it('presents the growth teardown as an OpenMotion skill', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  act(() => root.render(<Host />));
  act(() => button('Growth reverse-engineering').click());
  expect(container.querySelector('.om-skill-source')!.textContent).toContain('OpenMotion skill');
  expect(container.querySelector('.om-skill-source a, a.om-skill-source')).toBeNull();
  await act(async () => button('Copy for Agent').click());
  const text = write.mock.calls[0][0] as string;
  expect(text).toContain('Make a video with the OpenMotion "Growth Teardown" skill.');
  expect(text).toContain('Source: OpenMotion skill');
  expect(text).toContain('growth-teardown Skill');
});

it('presents the design style library with its upstream repository', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  act(() => root.render(<Host />));
  act(() => button('Design style library').click());
  expect(container.querySelector<HTMLAnchorElement>('a.om-skill-source')!.href).toBe('https://github.com/guanmo-ai/design-style');
  await act(async () => button('Copy for Agent').click());
  const text = write.mock.calls[0][0] as string;
  expect(text).toContain('design-styles Skill');
  expect(text).toContain('github.com/guanmo-ai/design-style');
});

it('filters by category and search', () => {
  act(() => root.render(<Host />));
  act(() => button('Explainers').click());
  expect(container.querySelectorAll('.om-skill-gallery-card').length).toBe(motionSkills.filter(skill => skill.category === 'Explainers').length);
  act(() => button('All').click());
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'proton'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect([...container.querySelectorAll('.om-skill-gallery-card strong')].map(node => node.textContent)).toEqual(['Particle effects']);
});

it('fills the brief and copies an MCP instruction for the Agent', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  act(() => root.render(<Host />));
  act(() => button('Staggered entrance').click());
  act(() => button('9:16').click());
  act(() => button('30s').click());
  await act(async () => button('Copy for Agent').click());
  const text = write.mock.calls[0][0] as string;
  expect(text).toContain('https://github.com/juliangarnier/anime');
  expect(text).toContain('Duration: 30s; aspect ratio: 9:16');
  expect(text).toContain('openmotion_get_project');
  expect(text).toContain('openmotion_create_project');
  expect(text).toContain('openmotion_edit_project');
  expect(text).not.toMatch(/openmotion_(create_session|write_files|create_artifact)/);
});

it('routes generated media through OpenMotion only for media skills', () => {
  const library = skillPrompt(motionSkills.find(skill => skill.id === 'anime-js')!, { subject: '', duration: 15, aspect: '9:16', style: '' }, 'en', 'https://example.test/install.md');
  expect(library).not.toContain('openmotion_media_use');
  const photo = skillPrompt(motionSkills.find(skill => skill.id === 'higgsfield-product-photoshoot')!, { subject: '', duration: 10, aspect: '1:1', style: '' }, 'en', 'https://example.test/install.md');
  expect(photo).toContain('openmotion_media_use');
  expect(photo).toContain('https://github.com/higgsfield-ai/skills/tree/main/higgsfield-product-photoshoot');
});

it('reads library skills through MCP and runs a generator skill through its own scripts', () => {
  const brief = (id: string, locale = 'en', duration = 10, aspect: '16:9' | '9:16' | '1:1' = '1:1') =>
    skillPrompt(motionSkills.find(skill => skill.id === id)!, { subject: 'x', duration, aspect, style: '' }, locale, 'https://example.test/install.md');
  for (const locale of ['en', 'zh-CN', 'ja', 'ko', 'ru', 'de', 'fr', 'es', 'pt-BR', 'it', 'tr']) {
    const growth = brief('openmotion-growth-teardown', locale);
    expect(growth).toContain('openmotion_get_skill');
    expect(growth).toContain('openmotion-growth-teardown');
    expect(growth).not.toContain('install-library-skill');
    expect(growth).toContain('1:1');
    const recipe = brief('openmotion-whiteboard-doodle', locale);
    expect(recipe).toContain('openmotion_get_skill');
    expect(recipe).toContain('openmotion-whiteboard-doodle');
    expect(recipe).toContain('HTML/CSS/JS');
  }
  expect(brief('openmotion-growth-teardown')).toContain("Make the film with the skill's own generator");
  expect(brief('openmotion-growth-teardown')).toContain('cannot make the chosen duration or aspect ratio');
  expect(brief('openmotion-whiteboard-doodle')).not.toContain("own generator");
  const borrowed = brief('anime-js');
  expect(borrowed).toContain('Author a native HTML/CSS/JS composition');
  expect(borrowed).not.toContain('openmotion_get_skill');
});

it('routes the shortcut command through MCP for library skills and the generator for generator skills', () => {
  const short = (id: string, locale: string) => skillShortcut(motionSkills.find(skill => skill.id === id)!, { subject: 'x', duration: 10, aspect: '9:16', style: '' }, locale, 'https://example.test/install.md');
  for (const locale of ['en', 'zh-CN', 'ja', 'ko', 'ru', 'de', 'fr', 'es', 'pt-BR', 'it', 'tr']) {
    expect(short('openmotion-growth-teardown', locale)).toContain('openmotion_get_skill');
    expect(short('openmotion-growth-teardown', locale)).toContain('openmotion-growth-teardown');
    expect(short('openmotion-whiteboard-doodle', locale)).toContain('openmotion-whiteboard-doodle');
    expect(short('anime-js', locale)).not.toContain('openmotion_get_skill');
  }
  expect(short('openmotion-growth-teardown', 'en')).toContain('own generator');
  expect(short('openmotion-whiteboard-doodle', 'en')).not.toContain('own generator');
});

it('starts a fresh brief when the selected skill changes from outside, such as history navigation', () => {
  const render = (skillId: string) => act(() => root.render(<SkillsPage skillId={skillId} onSkillChange={() => {}} />));
  render('anime-js');
  act(() => button('30s').click());
  expect(container.querySelector('.om-skill-prompt pre')!.textContent).toContain('Duration: 30s');
  render('manim');
  expect(container.querySelector('.om-skill-prompt pre')!.textContent).toContain('Duration: 10s');
});

it('localizes the instruction and keeps the user brief', () => {
  const text = skillPrompt(motionSkills[0], { subject: '新品发布', duration: 10, aspect: '1:1', style: '' }, 'zh-CN', 'https://example.test/install.md');
  expect(text).toContain('内容：新品发布');
  expect(text).toContain('交付：');
  expect(text.split('\n')[0]).toBe('使用说明：请使用 OpenMotion 插件。如未安装，请按 https://example.test/install.md 安装并接入后继续。');
  expect(text).not.toContain('风格');
});

it('routes the skills page and selected skill through semantic paths while keeping legacy queries compatible', () => {
  const href = workspacePageHref('http://local/?page=assets', { skills: true, skill: 'manim' });
  expect(href).toBe('/skills/manim');
  expect(readWorkspacePage('', '', href)).toMatchObject({ skills: true, skill: 'manim', assets: false, settings: null });
  expect(readWorkspacePage('?page=skills&skill=manim')).toMatchObject({ skills: true, skill: 'manim', assets: false, settings: null });
  const assetsHref = workspacePageHref('http://local' + href, { assets: true });
  expect(assetsHref).toBe('/assets');
  expect(readWorkspacePage('', '', assetsHref)).toMatchObject({ assets: true, skills: false, skill: null });
  expect(isWorkspaceSettingsPage('?page=skills')).toBe(true);
});

it.each(['instruction', 'command'] as const)('selects the failed %s in its own surface and supports retry', async surface => {
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard unavailable'));
  act(() => root.render(<Host />));
  act(() => button('Staggered entrance').click());
  const instruction = container.querySelector<HTMLPreElement>('.om-skill-prompt pre')!;
  const originalInstruction = instruction.textContent;
  if (surface === 'command') await act(async () => button('Connect Agent').click());
  // The real popover renders in a portal outside the component container.
  const command = document.querySelector<HTMLPreElement>('.om-skill-shortcut pre');
  const target = surface === 'command' ? command! : instruction;
  const expected = target.textContent;
  const copyButton = surface === 'command'
    ? [...document.querySelectorAll<HTMLButtonElement>('.om-skill-shortcut button')].find(node => node.textContent?.includes('Copy command'))!
    : button('Copy for Agent');
  expect(expected).toBeTruthy();
  if (surface === 'command') expect(expected).not.toBe(originalInstruction);
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => copyButton.click());
    expect(write).toHaveBeenLastCalledWith(expected);
    expect(target.textContent).toBe(expected);
    expect(target.dataset.manual).toBe('true');
    expect(document.activeElement).toBe(target);
    expect(window.getSelection()?.toString()).toBe(expected);
    expect(instruction.textContent).toBe(originalInstruction);
    if (surface === 'command') {
      expect(instruction.dataset.manual).toBe('false');
      expect(document.body.textContent).toContain('Copy failed. Select and copy the command below.');
    }
  }
  write.mockResolvedValue(undefined);
  await act(async () => copyButton.click());
  expect(write).toHaveBeenLastCalledWith(expected);
  expect(target.dataset.manual).toBe('false');
});

it('does not select a failed command after its popover has closed', async () => {
  let rejectCopy!: (error: Error) => void;
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectCopy = reject; }));
  act(() => root.render(<Host />));
  act(() => button('Staggered entrance').click());
  await act(async () => button('Connect Agent').click());
  const copyButton = [...document.querySelectorAll<HTMLButtonElement>('.om-skill-shortcut button')].find(node => node.textContent?.includes('Copy command'))!;
  await act(async () => copyButton.click());
  await act(async () => button('Connect Agent').click());
  const focus = document.activeElement;
  const select = vi.spyOn(window.getSelection()!, 'selectAllChildren');
  await act(async () => rejectCopy(new Error('Clipboard unavailable')));
  expect(select).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(focus);
  expect(container.querySelector('.om-skill-prompt pre')!.getAttribute('data-manual')).toBe('false');
});

it('localizes every Skills string and instruction in all supported languages', async () => {
  const { default: skillsCore } = await import('../i18n/skills-ui.json');
  const { default: skillLibrary } = await import('../i18n/skill-library');
  const skillsUi = Object.fromEntries(Object.entries(skillsCore).map(([locale, messages]) => [locale, { ...messages, ...skillLibrary[locale] }])) as Record<string, Record<string, string>>;
  const { default: prompts } = await import('./skill-prompts.json');
  const { languages } = await import('../i18n/messages');
  const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  const sources = Object.keys(skillsUi['zh-CN']);
  // Skills authored in this repository show the "OpenMotion skill" source label instead of an upstream repository.
  if (motionSkills.some(skill => !skill.repository)) expect(sources).toContain('OpenMotion skill');
  for (const { locale } of languages.filter(language => language.locale !== 'en')) {
    const ui = (skillsUi as Record<string, Record<string, string>>)[locale];
    const instructions = (prompts as Record<string, Record<string, string>>)[locale];
    expect(Object.keys(ui).sort(), locale).toEqual([...sources].sort());
    for (const source of sources) expect(placeholders(ui[source]), `${locale}: ${source}`).toEqual(placeholders(source));
    for (const [key, english] of Object.entries(prompts.en)) expect(placeholders(instructions[key]), `${locale}: ${key}`).toEqual(placeholders(english));
  }
  expect(skillPrompt(motionSkills[0], { subject: 'x', duration: 10, aspect: '16:9', style: '' }, 'ja', 'https://example.test/install.md')).toContain('openmotion_create_project');
});

it('drops a stale failed-copy text once the brief changes', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard unavailable'));
  act(() => root.render(<Host />));
  act(() => button('Staggered entrance').click());
  await act(async () => button('Copy for Agent').click());
  act(() => button('30s').click());
  const instruction = container.querySelector<HTMLPreElement>('.om-skill-prompt pre')!;
  expect(instruction.textContent).toContain('Duration: 30s');
  expect(instruction.dataset.manual).toBe('false');
});

it('ignores a late copy failure after the brief has changed', async () => {
  let rejectCopy!: (error: Error) => void;
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectCopy = reject; }));
  act(() => root.render(<Host />));
  act(() => button('Staggered entrance').click());
  await act(async () => { button('Copy for Agent').click(); });
  act(() => button('30s').click());
  await act(async () => rejectCopy(new Error('Clipboard unavailable')));
  const instruction = container.querySelector<HTMLPreElement>('.om-skill-prompt pre')!;
  expect(instruction.textContent).toContain('Duration: 30s');
  expect(instruction.dataset.manual).toBe('false');
});

it('opens the contribution guide section for submitting a skill, like the template library', async () => {
  act(() => root.render(<Host />));
  const link = [...container.querySelectorAll<HTMLAnchorElement>('.om-skills-intro a')].find(node => node.textContent?.includes('Submit a skill'))!;
  expect(link.href).toBe(skillSubmissionUrl);
  expect(link.target).toBe('_blank');
  const { default: guide } = await import('../../../CONTRIBUTING.md?raw');
  const section = guide.slice(guide.indexOf('### Submit a skill with your Agent'));
  expect(skillSubmissionUrl.endsWith('#submit-a-skill-with-your-agent')).toBe(true);
  expect(section).toContain('library/skills/<name>/SKILL.md');
  expect(section).toContain('nexu-io/openmotion');
  expect(section).toContain('draft pull request');
});

it('ships static WebP posters and waits to fetch archived video until playback starts', async () => {
  const archived = motionSkills.filter(skill => (skill.cover?.video ?? skill.cover?.gif)?.startsWith(skillPreviewSnapshot));
  expect(archived.length).toBeGreaterThan(100);
  for (const skill of archived) expect(skill.cover?.poster, skill.id).toMatch(/\.webp(?:\?|$)/);
  const skill = motionSkills.find(skill => skill.id === 'motionmaxxing')!;
  const videoUrl = skill.cover!.video!;
  const fetcher = vi.mocked(fetch).mockImplementation(async input => String(input) === videoUrl
    ? new Response('sample', { headers: { 'Content-Type': 'application/octet-stream' } })
    : new Response(null, { status: 404 }));
  const videoRequests = () => fetcher.mock.calls.map(([input]) => String(input))
    .filter(url => url.startsWith(skillPreviewSnapshot) && url.endsWith('.mp4'));
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:skill-preview');
  act(() => root.render(<SkillMedia skill={skill} />));
  expect(container.querySelectorAll('img')).toHaveLength(2);
  expect(videoRequests()).toEqual([]);
  await act(async () => root.render(<SkillMedia skill={skill} playing />));
  expect(create).toHaveBeenCalled();
  expect(videoRequests()).toEqual([videoUrl]);
  act(() => root.render(<SkillMedia skill={skill} playing={false} />));
  expect(container.querySelectorAll('video')).toHaveLength(0);
  expect(container.querySelectorAll('img')).toHaveLength(2);
});

it('merges same-repository cover credits while retaining external sources and attribution', () => {
  for (const id of ['openmotion-design-styles', 'motionmaxxing']) {
    act(() => root.render(<SkillsPage skillId={id} onSkillChange={() => {}} />));
    expect(container.querySelector('a.om-skill-source')!.getAttribute('href')).toBe(motionSkills.find(skill => skill.id === id)!.repository);
    expect(container.querySelector('.om-skill-credit')).toBeNull();
  }
  for (const id of ['lume', 'three-js', 'openmotion-growth-teardown']) {
    act(() => root.render(<SkillsPage skillId={id} onSkillChange={() => {}} />));
    expect(container.querySelector('.om-skill-credit')!.textContent).toContain(motionSkills.find(skill => skill.id === id)!.cover!.source!.replace(/^https?:\/\//, ''));
  }
});

it('carries the exact reference version into both 3D Agent handoffs', () => {
  const skill = motionSkills.find(entry => entry.id === 'three-js')!;
  const brief = { subject: 'Orbit a vase', aspect: '16:9', duration: 10, style: '', reference: { assetId: 'asset-a', versionId: 'version-b', label: 'Vase · V2' } } as const;
  for (const build of [skillPrompt, skillShortcut]) {
    const instruction = build(skill, brief, 'en', 'https://example.com/install');
    expect(instruction).toContain('Orbit a vase');
    const call = instruction.split('\n').at(-1)!;
    expect(call).toBe('openmotion_assets_use {"action":"read","assetId":"asset-a","versionId":"version-b"}');
  }
});

it.each(['image', 'video', 'audio'] as const)('carries the brief and respects a pinned %s reference when starting a shot', modality => {
  const studio = findTechniqueStudio('shorts')!;
  const skill = studio.techniques[0], create = vi.fn();
  const reference = { assetId: 'source', versionId: 'pinned', label: 'Source · V2', modality };
  const brief = { ...studioSkillDefaults(studio.id), subject: 'A ceramic vase', style: 'Warm sidelight', reference };
  act(() => root.render(<SkillsPage studio={studio} briefs={new Map([[skill, brief]])} skillId={skill} onSkillChange={vi.fn()} onCreate={create} />));
  expect(button('Copy for Agent')).toBeTruthy();
  const action = button('Create a shot from this brief');
  if (modality !== 'image') {
    expect(action).toBeUndefined();
    expect(container.textContent).toContain('Use the Agent brief to work with this recording');
    return;
  }
  act(() => action.click());
  const [destination, draft] = create.mock.calls[0];
  expect(destination.scene.id).toBe('image-to-video');
  expect(draft.references).toEqual([{ reference: { assetId: 'source', versionId: 'pinned' }, name: 'Source · V2' }]);
  expect(draft.shotPreferences).toEqual({ aspect: '9:16', duration: brief.duration });
  expect(draft.prompt).toContain('A ceramic vase');
  expect(draft.prompt).toContain('Warm sidelight');
  expect(draft.prompt).not.toContain('openmotion_assets_use');
});
