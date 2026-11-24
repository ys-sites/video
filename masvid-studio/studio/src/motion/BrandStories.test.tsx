// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { BrandStoriesDialog } from './BrandStories';
import { groupBrandSeries } from './brandStoryData';
import { translate } from '../i18n/messages';
import type { GalleryTemplate } from '../../../shared/catalog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const entry = (id: string, sourceUrl?: string, uses = ['Product launch']): GalleryTemplate => ({ id, title: id, description: '', subtitle: '', brand: 'Figma', collection: 'example', author: 'Figma', tags: [], kind: 'reference', uses, previewUrl: '/' + id + '.mp4', sourceUrl, motionDocumentUrl: id === 'unknown' ? undefined : '/' + id + '.md', duration: 53, width: 1280, height: 720 });
const series = groupBrandSeries([
  entry('latest','https://x.com/figma/status/2069827742800253230'),
  entry('unknown'),
  entry('first','https://x.com/figma/status/1900000000000000000',['Product demo']),
])[0];
let root: Root, host: HTMLDivElement;
const props = { series, covered: false, onClose: vi.fn(), onTemplate: vi.fn(), onCompare: vi.fn(), onCopy: vi.fn().mockResolvedValue(null), onDownload: vi.fn().mockResolvedValue(undefined) };
beforeEach(() => {
  props.onCopy.mockReset().mockResolvedValue(null); props.onDownload.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(() => {});
  vi.spyOn(Element.prototype,'scrollIntoView').mockImplementation(() => {});
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (covered = false) => act(async () => root.render(<I18nProvider initialLocale="zh-CN"><BrandStoriesDialog {...props} covered={covered} /></I18nProvider>));
const button = (text: string) => [...host.querySelectorAll('button')].find(node => node.textContent?.includes(text))!;
const current = () => host.querySelector('section[aria-label="当前发布作品"] h2')?.textContent;
const ended = () => host.querySelector('video')!.dispatchEvent(new Event('ended'));
it('keeps chronological selection manual and removes the sequence and date commentary', async () => {
  await render();
  expect(current()).toBe('first');
  expect([...host.querySelectorAll('ol button strong')].map(node => node.textContent)).toEqual(['first','latest','unknown']);
  expect(host.textContent).not.toMatch(/连续播放|暂停连播|原帖时间|原帖推算|自动定位|日期待补/);
  expect(host.querySelector('ol button')?.textContent).toMatch(/2025/);
  expect(button('unknown').querySelector('time')).toBeNull();
  await act(async () => { ended(); });
  expect(current()).toBe('first');
  await act(async () => button('latest').click());
  expect(current()).toBe('latest');
  await act(async () => { ended(); });
  expect(current()).toBe('latest');
});
it('shows verified LinkedIn days and year-only case dates without January 1 placeholders', async () => {
  const dated=groupBrandSeries([
    entry('Airtable June','https://www.linkedin.com/posts/airtable_airtableai-nocodeai-activity-7343347865622036481-yJJC'),
    entry('Airtable August','https://www.linkedin.com/posts/airtable_today-were-rolling-out-ai-generated-interface-activity-7366161234095693824-buUw'),
    entry('case year','https://www.ordinaryfolk.co/project/lark-magic-share'),
  ])[0];
  await act(async () => root.render(<I18nProvider initialLocale="zh-CN"><BrandStoriesDialog {...props} series={dated}/></I18nProvider>));
  expect([...host.querySelectorAll('ol time')].map(node=>[node.getAttribute('datetime'),node.textContent])).toEqual([['2020','2020'],['2025-06-24','2025/06/24'],['2025-08-26','2025/08/26']]);
});
it('pauses the video under a detail and preserves the selected work', async () => {
  await render();
  await render(true);
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  await act(async () => { ended(); }); expect(current()).toBe('first');
});
it('filters the history and opens the exact selected work', async () => {
  await render();
  await act(async () => button('产品发布宣传片').click());
  expect(current()).toBe('latest');
  await act(async () => button('查看完整详情').click());
  expect(props.onTemplate).toHaveBeenLastCalledWith(expect.objectContaining({id:'latest'}),false);
});
it('copies and downloads the selected work without opening another detail', async () => {
  await render();
  const openCalls = props.onTemplate.mock.calls.length;
  await act(async () => button(translate('zh-CN', 'Recreate template')).click());
  expect(props.onCopy).toHaveBeenLastCalledWith(expect.objectContaining({id:'first'}), false);
  await act(async () => button('下载 motion.md').click());
  expect(props.onDownload).toHaveBeenLastCalledWith(expect.objectContaining({id:'first'}));
  expect(props.onTemplate.mock.calls.length).toBe(openCalls);
  await act(async () => button('unknown').click());
  expect([...host.querySelectorAll('button')].some(node => node.textContent?.includes('motion.md'))).toBe(false);
});
it('offers the exact instruction for manual copying when clipboard access fails', async () => {
  props.onCopy.mockResolvedValue('Copy template first with my materials');
  await render();
  await act(async () => button(translate('zh-CN', 'Recreate template')).click());
  expect(host.querySelector('textarea')?.value).toBe('Copy template first with my materials');
  await act(async () => button('latest').click());
  expect(host.querySelector('textarea')).toBeNull();
});
it('opens directly to history without a works tab or duplicate production details', async () => {
  await render();
  expect(current()).toBe('first');
  expect(host.querySelector('[aria-label="发布历程"]')).not.toBeNull();
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.textContent).not.toMatch(/这支视频适合我吗|准备什么素材|参考配色|全部视频信息/);
});
it('browses the reel with arrow keys without interrupting the selected video', async () => {
  await render();
  const first = button('first');
  first.focus();
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(document.activeElement).toBe(button('latest'));
  expect(current()).toBe('first');
  await act(async () => button('latest').click());
  expect(current()).toBe('latest');
  expect(host.querySelector('video')?.getAttribute('src')).toBe('/latest.mp4');
  const rail = host.querySelector('section[aria-label="品牌作品胶片时间轴"] ol')!;
  await act(async () => rail.dispatchEvent(new Event('scroll')));
  expect(current()).toBe('latest');
});
it('does not select a frame when a mouse drag ends over it', async () => {
  await render();
  const rail = host.querySelector<HTMLOListElement>('section[aria-label="品牌作品胶片时间轴"] ol')!;
  rail.setPointerCapture = vi.fn(); rail.hasPointerCapture = () => true; rail.releasePointerCapture = vi.fn();
  await act(async () => {
    rail.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 200, bubbles: true }));
    rail.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 100, bubbles: true }));
    rail.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 100, bubbles: true }));
    button('latest').dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
  });
  expect(rail.scrollLeft).toBe(100);
  expect(current()).toBe('first');
  await act(async () => {
    button('latest').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 0, bubbles: true }));
    button('latest').dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'mouse', bubbles: true }));
    button('latest').dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
  });
  expect(current()).toBe('latest');
});
it('preserves the selected film when its full detail covers and uncovers the history', async () => {
  await render();
  await act(async () => button('latest').click());
  await act(async () => button('查看完整详情').click());
  await render(true);
  await render(false);
  expect(current()).toBe('latest');
  expect(host.querySelector('[aria-current="true"]')?.getAttribute('aria-label')).toBe('选择作品 latest');
});
it('uses authored chapters to jump within the selected original video', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => '# Release\n\nA concrete visual observation.\n\n## 内容替换\nUse your own launch.\n\n```motion-board\n'+JSON.stringify({stages:[{start:0,end:7,label:'问题'},{start:7,end:20,label:'能力展开'},{start:20,end:53,label:'结果'}]})+'\n```' } as Response);
  await render();
  const video=host.querySelector('video')!;
  expect(host.textContent).toContain('片段看点');
  expect(button('能力展开').disabled).toBe(true);
  await act(async () => video.dispatchEvent(new Event('loadeddata')));
  await act(async () => button('能力展开').click());
  expect(video.currentTime).toBe(7);
  expect(video.getAttribute('src')).toBe('/first.mp4');
  expect(current()).toBe('first');
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  await act(async () => button('unknown').click());
  expect(host.querySelector('[aria-label="片段看点"]')).toBeNull();
});

it('exposes the selected repository and keeps contribution distinct from recreation', async () => {
  await render();
  const action=host.querySelector('[aria-label="作品创作操作"]')!;
  expect(action.querySelector('a')?.getAttribute('href')).toBe('https://github.com/nexu-io/openmotion/tree/main/library/templates');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="复刻并投稿"]')!.click());
  expect(props.onCopy).toHaveBeenLastCalledWith(expect.objectContaining({id:'first'}), true);
  expect(current()).toBe('first');
});
it('introduces the brand with an evidence-based video insight and removes redundant presentation copy', async () => {
  await render();
  expect(host.textContent).toContain('让设计工具的卖点由可见的前后变化证明');
  expect(host.textContent).not.toMatch(/合集不代表整套可编辑工程|从收录样本里找共性|借鉴真实界面、卖点展开和发布节奏/);
});

it('accepts a cached playable frame and prevents old work readiness from leaking into a new selection', async () => {
  await render();
  const video=host.querySelector('video')!;
  await act(async () => video.dispatchEvent(new Event('canplay')));
  expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  expect(video.style.opacity).toBe('1');
  await act(async () => button('latest').click());
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(host.querySelector('video')?.style.opacity).toBe('0');
  await act(async () => host.querySelector('video')!.dispatchEvent(new Event('playing')));
  expect(host.querySelector('[aria-busy="true"]')).toBeNull();
});
it('releases the covered video source while details play and restores only the selected film', async () => {
  await render();
  expect(host.querySelector('video')?.getAttribute('src')).toBe('/first.mp4');
  await render(true);
  expect(host.querySelector('video')?.getAttribute('src')).toBeNull();
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  await render(false);
  expect(host.querySelector('video')?.getAttribute('src')).toBe('/first.mp4');
  expect(host.querySelectorAll('video[src]')).toHaveLength(1);
});
