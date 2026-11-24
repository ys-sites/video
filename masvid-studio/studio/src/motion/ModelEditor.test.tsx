// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelEditor } from './ModelEditor';
import { ModelCatalog } from './ModelCatalog';
import { I18nProvider } from '../i18n/I18n';
import type { DirectoryModel, ProviderConnection } from '../../../shared/provider-directory';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });
async function mount(child: React.ReactNode, locale: 'en' | 'zh-CN' = 'en') { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<I18nProvider initialLocale={locale}>{child}</I18nProvider>)); }
function button(label: string) { const value = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label); expect(value).toBeTruthy(); return value!; }
async function fill(label: string, value: string) { await act(async () => { const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function pickSelect(label: string, optionText: string) {
  const trigger = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  expect(trigger).toBeTruthy();
  await act(async () => trigger.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.trim() === optionText);
  expect(option, `Option "${optionText}" in select "${label}"`).toBeTruthy();
  await act(async () => option!.click());
}
const provider = { id: 'test', label: 'Test', protocol: 'openai', kinds: ['text'] } as ProviderConnection;

it('saves grouping, directly accessible model type and defaults without non-executable capability or token fields', async () => {
  const save = vi.fn(async () => true), close = vi.fn();
  await mount(<ModelEditor provider={provider} save={save} onClose={close} />);
  await fill('Model ID', 'test-model'); await fill('Display name', 'My model'); await fill('Group name', 'Research');
  // Model type is directly visible without opening More settings.
  await act(async () => button('Image').click());
  // Non-executable LLM metadata controls are removed.
  expect(document.body.textContent).not.toContain('Model capabilities');
  expect(document.body.textContent).not.toContain('Input modalities');
  expect(document.body.textContent).not.toContain('Context window');
  expect(document.body.textContent).not.toContain('Max output tokens');
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(save).toHaveBeenCalledWith({ id: undefined, modelId: 'test-model', label: 'My model', kind: 'image', group: 'Research', defaults: {} });
  expect(close).toHaveBeenCalledOnce();
});

it('renders structured default parameter controls for schema-backed media models and keeps raw JSON collapsed until needed', async () => {
  const save = vi.fn(async () => true), close = vi.fn();
  const cloudProvider = { id: 'opendesign', label: 'OpenDesign Cloud', protocol: 'media', kinds: ['image', 'video', 'audio'] } as ProviderConnection;
  const model: DirectoryModel = {
    id: 'opendesign:custom-pro-image',
    provider: 'opendesign',
    modelId: 'custom-pro-image',
    label: 'Pro Image',
    kind: 'image',
    mode: 'text-to-image',
    enabled: true,
    source: 'live',
    defaults: { aspect_ratio: '16:9', resolution: '2K' },
    nativeOptions: {
      profiles: {
        generations: {
          profiles: [
            { aspect_ratio: '16:9', resolution: '2K' },
            { aspect_ratio: '1:1', resolution: '1K' },
          ],
        },
      },
      quality: ['standard', 'high'],
    },
  };
  await mount(<ModelEditor provider={cloudProvider} model={model} save={save} onClose={close} />);
  // Locked media protocol does not show a disabled Model type row when editing.
  expect(document.body.textContent).not.toContain('Model type');
  // Structured parameter controls are shown directly; raw JSON stays collapsed by default.
  expect(document.body.textContent).toContain('Default parameters');
  expect(document.querySelector('textarea')).toBeNull();

  // Changing aspect_ratio to 1:1 clears the incompatible 2K resolution automatically.
  await pickSelect('Aspect ratio', '1:1');
  await pickSelect('Quality', 'high');
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    id: 'opendesign:custom-pro-image',
    kind: 'image',
    defaults: { aspect_ratio: '1:1', quality: 'high' },
  }));
  expect(close).toHaveBeenCalledOnce();
});

it('validates structured number parameters and supports boolean defaults on media models', async () => {
  const save = vi.fn(async () => true), close = vi.fn();
  const atlasProvider = { id: 'atlascloud', label: 'Atlas Cloud', protocol: 'media', kinds: ['image', 'video', 'audio'] } as ProviderConnection;
  const videoModel: DirectoryModel = {
    id: 'atlascloud:bytedance/seedance-2.0/text-to-video',
    provider: 'atlascloud',
    modelId: 'bytedance/seedance-2.0/text-to-video',
    label: 'Seedance 2.0',
    kind: 'video',
    mode: 'text-to-video',
    enabled: true,
    source: 'builtin',
  };
  await mount(<ModelEditor provider={atlasProvider} model={videoModel} save={save} onClose={close} />);
  await pickSelect('Generate audio', 'Disabled');
  await pickSelect('Resolution', '4K');
  await fill('Seed', 'not-a-number');
  await submitModel();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter a valid number.');
  expect(save).not.toHaveBeenCalled();

  await fill('Seed', '42');
  await submitModel();
  // Selecting 4k automatically satisfies its required 16:9 ratio constraint.
  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    defaults: { generate_audio: false, resolution: '4k', ratio: '16:9', seed: 42 },
  }));
  expect(close).toHaveBeenCalledOnce();
});

it('clears incompatible choice defaults when a required dependency changes', async () => {
  const save = vi.fn(async () => true), close = vi.fn();
  const atlasProvider = { id: 'atlascloud', label: 'Atlas Cloud', protocol: 'media', kinds: ['image', 'video', 'audio'] } as ProviderConnection;
  const videoModel: DirectoryModel = {
    id: 'atlascloud:bytedance/seedance-2.0/text-to-video',
    provider: 'atlascloud',
    modelId: 'bytedance/seedance-2.0/text-to-video',
    label: 'Seedance 2.0',
    kind: 'video',
    mode: 'text-to-video',
    enabled: true,
    source: 'builtin',
  };
  await mount(<ModelEditor provider={atlasProvider} model={videoModel} save={save} onClose={close} />);
  await pickSelect('Resolution', '4K');
  await pickSelect('Aspect ratio', '1:1');
  await submitModel();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaults: { ratio: '1:1' } }));
  expect(close).toHaveBeenCalledOnce();
});

it('keeps decimal number drafts while typing fractional defaults', async () => {
  const save = vi.fn(async () => true), close = vi.fn();
  const falProvider = { id: 'fal', label: 'fal.ai', protocol: 'media', kinds: ['image', 'video', 'audio'] } as ProviderConnection;
  const sfxModel: DirectoryModel = {
    id: 'fal:fal-ai/elevenlabs/sound-effects/v2',
    provider: 'fal',
    modelId: 'fal-ai/elevenlabs/sound-effects/v2',
    label: 'Sound Effects v2',
    kind: 'audio',
    mode: 'text-to-audio',
    enabled: true,
    source: 'builtin',
  };
  await mount(<ModelEditor provider={falProvider} model={sfxModel} save={save} onClose={close} />);
  const durationInput = document.querySelector<HTMLInputElement>('[aria-label="Duration (seconds)"]')!;
  await fill('Duration (seconds)', '1');
  expect(durationInput.value).toBe('1');
  await fill('Duration (seconds)', '1.');
  expect(durationInput.value).toBe('1.');
  await fill('Duration (seconds)', '1.5');
  expect(durationInput.value).toBe('1.5');
  await submitModel();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaults: { duration_seconds: 1.5 } }));
  expect(close).toHaveBeenCalledOnce();
});

it('switches modalities, searches models and retains group expansion for grouped catalogues', async () => {
  const models = [{ id: 'a', modelId: 'a', label: 'Reasoning model', kind: 'text', group: 'Research', enabled: true, source: 'live' }, { id: 'b', modelId: 'b', label: 'Image model', kind: 'image', group: 'Creative', enabled: true, source: 'custom' }, { id: 'c', modelId: 'c', label: 'Disabled model', kind: 'text', group: 'Research', enabled: false, source: 'live' }] as DirectoryModel[];
  await mount(<ModelCatalog models={models} render={model => <p key={model.id} data-model={model.id}>{model.label}</p>} />);
  expect(document.querySelector('[aria-label="Filter models"]')).toBeNull();
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map(tab => tab.textContent)).toEqual(['All3', 'Text2', 'Image1']);
  await act(async () => tabs[1].click());
  expect([...document.querySelectorAll('[data-model]')].map(el => el.getAttribute('data-model'))).toEqual(['a', 'c']);
  await fill('Search models', 'Reasoning');
  expect([...document.querySelectorAll('[data-model]')].map(el => el.getAttribute('data-model'))).toEqual(['a']);
  expect(document.querySelector('.om-model-active-filters')).toBeNull();
  await fill('Search models', '');
  await act(async () => tabs[0].click());
  await act(async () => button('Collapse all groups').click()); expect(document.querySelectorAll('[data-model]')).toHaveLength(0);
  await act(async () => button('Expand all groups').click()); expect(document.querySelectorAll('[data-model]')).toHaveLength(3);
});

it('exposes modality tabs in Chinese as 文本, pins defaults, and hides redundant ungrouped controls', async () => {
  const models = [
    { id: 'b', modelId: 'b', label: 'Beta model', kind: 'text', enabled: true, source: 'live' },
    { id: 'a', modelId: 'a', label: 'Alpha model', kind: 'image', enabled: true, source: 'live' },
    { id: 'c', modelId: 'c', label: 'Gamma model', kind: 'text', enabled: true, source: 'live' },
  ] as DirectoryModel[];
  await mount(<ModelCatalog models={models} defaultIds={new Set(['c'])} render={model => <p key={model.id} data-model={model.id}>{model.label}</p>} />, 'zh-CN');

  expect(document.querySelector('.om-model-group')).toBeNull();
  expect(document.querySelector('[aria-label="模型分组"]')).toBeNull();
  expect(document.querySelector('[aria-label="筛选模型"]')).toBeNull();
  expect(document.querySelector('.om-model-active-filters')).toBeNull();
  // Active default model pins first in default order.
  expect([...document.querySelectorAll('[data-model]')].map(el => el.getAttribute('data-model'))).toEqual(['c', 'b', 'a']);

  // Modality tabs use 文本 instead of 语言 in Simplified Chinese.
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map(tab => tab.textContent)).toEqual(['全部3', '文本2', '图片1']);
  await act(async () => tabs[2].click());
  expect([...document.querySelectorAll('[data-model]')].map(el => el.getAttribute('data-model'))).toEqual(['a']);
  await act(async () => tabs[0].click());

  await fill('搜索模型', 'Alpha');
  expect(document.querySelector('.om-model-active-filters')).toBeNull();
  expect([...document.querySelectorAll('[data-model]')].map(el => el.getAttribute('data-model'))).toEqual(['a']);
});

async function fillDefaults(value: string) {
  await act(async () => {
    const input = document.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submitModel() {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
it.each(['{', '[]', 'null', '42', '"text"', 'true', ''])('keeps invalid JSON %j beside its field without saving', async value => {
  const save = vi.fn(async () => true), close = vi.fn();
  await mount(<ModelEditor provider={provider} save={save} onClose={close} />);
  await fill('Model ID', 'test-model');
  await act(async () => button('More settings').click());
  await fillDefaults(value);
  await submitModel();
  const input = document.querySelector('textarea')!;
  const error = document.querySelector('[role="alert"]')!;
  expect(error.textContent).toBe('Enter a valid JSON object.');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
  expect(input.value).toBe(value);
  expect(document.activeElement).toBe(input);
  expect(save).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
it.each([false, true])('expands and focuses hidden invalid JSON on every submit (editing: %s)', async editing => {
  const save = vi.fn(async () => true), close = vi.fn();
  const model = editing ? { id: 'test:model', modelId: 'model', defaults: {} } as DirectoryModel : undefined;
  await mount(<ModelEditor provider={provider} model={model} save={save} onClose={close} />);
  if (!editing) {
    await fill('Model ID', 'model');
    await act(async () => button('More settings').click());
  }
  await fillDefaults('{"temperature":');
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => button('More settings').click());
    expect(document.querySelector('textarea')).toBeNull();
    await submitModel();
    expect(button('More settings').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(document.querySelector('textarea'));
    expect(document.querySelector('textarea')!.value).toBe('{"temperature":');
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  }
  await fillDefaults('[]');
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await fillDefaults('{"temperature":0.7}');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('textarea')!.hasAttribute('aria-invalid')).toBe(false);
  await submitModel();
  expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ defaults: { temperature: 0.7 } }));
  expect(close).toHaveBeenCalledOnce();
});
it('localizes the inline error in Chinese and retains valid input when saving fails', async () => {
  const save = vi.fn(async () => false), close = vi.fn();
  await mount(<ModelEditor provider={provider} model={{ id: 'test:model', modelId: 'model' } as DirectoryModel} save={save} onClose={close} />, 'zh-CN');
  await fillDefaults('null');
  await submitModel();
  expect(document.querySelector('[role="alert"]')!.textContent).toBe('请输入有效的 JSON 对象。');
  await fillDefaults('{"temperature":0.5}');
  await submitModel();
  expect(save).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('textarea')!.value).toBe('{"temperature":0.5}');
});

it('shows all basic field errors, focuses the first and preserves drafts until corrected', async () => {
  const save = vi.fn(async () => true);
  await mount(<ModelEditor provider={provider} save={save} onClose={() => {}} />);
  await fill('Model ID', 'bad id'); await fill('Display name', 'x'.repeat(181)); await fill('Group name', 'x'.repeat(81));
  await submitModel();
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Model ID');
  expect(document.querySelector<HTMLInputElement>('[aria-label="Group name"]')!.value).toHaveLength(81);
  expect(save).not.toHaveBeenCalled();
  await fill('Model ID', 'vendor/model:v1'); await fill('Display name', 'x'.repeat(180)); await fill('Group name', 'x'.repeat(80));
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  await submitModel(); expect(save).toHaveBeenCalledOnce();
});
it('explains empty and overlong model IDs at the field', async () => {
  const save = vi.fn(async () => true);
  await mount(<ModelEditor provider={provider} save={save} onClose={() => {}} />);
  expect(button('Add model').disabled).toBe(false);
  await submitModel(); expect(document.body.textContent).toContain('Enter a model ID.');
  await fill('Model ID', 'x'.repeat(181));
  expect(document.body.textContent).toContain('Model ID cannot exceed 180 characters.');
  await fill('Model ID', 'x'.repeat(180)); await submitModel(); expect(save).toHaveBeenCalledOnce();
});
it.each([false, true])('validates reserved fields and serialized JSON size, including hidden settings (editing: %s)', async editing => {
  const save = vi.fn(async () => true);
  await mount(<ModelEditor provider={provider} model={editing ? { id: 'test:model', modelId: 'model', defaults: {} } as DirectoryModel : undefined} save={save} onClose={() => {}} />, 'zh-CN');
  if (!editing) { await fill('模型 ID', 'model'); await act(async () => button('更多设置').click()); }
  await fillDefaults('{"MODEL":"example"}');
  await act(async () => button('更多设置').click()); await submitModel();
  expect(document.body.textContent).toContain('默认参数不能包含保留字段“MODEL”，请移除该字段。');
  expect(document.activeElement).toBe(document.querySelector('textarea'));
  const long = JSON.stringify({ x: 'a'.repeat(63993) }); // 64,001 serialized characters
  await fillDefaults(long);
  expect(document.body.textContent).toContain('64,000');
  expect(document.querySelector('textarea')!.value).toBe(long);
  expect(save).not.toHaveBeenCalled();
  await fillDefaults(JSON.stringify({ x: 'a'.repeat(63992) }, null, 2));
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await submitModel(); expect(save).toHaveBeenCalledOnce();
});
