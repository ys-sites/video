// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { GenerationParameters, durationTicks, emptyParameters, parameterInputImageRatio, requestParameters, shotParameters } from './GenerationParameters';
import { generationOptions } from '../../../shared/generation-options';
import type { Model } from '../../../shared/gateway';
import { toastErrorMessage } from '../components/ui/toastErrorMessage';
import { languages, translate } from '../i18n/messages';
import { ResizablePane, readPaneWidth } from './ResizablePane';
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
it('merges advanced JSON and explicit typed controls, preserving native booleans and numbers', () => {
  expect(requestParameters({ advanced: '{"duration":8,"generate_audio":false,"seed":42}', values: { duration: 5 } })).toEqual({ duration: 5, generate_audio: false, seed: 42 });
  expect(() => requestParameters({ advanced: '[]', values: {} })).toThrow();
  expect(() => requestParameters({ advanced: '{', values: {} })).toThrow();
});
const firstFrameModel: Model = { id: 'opendesign:wan-2.7', provider: 'opendesign', modelId: 'wan-2.7', label: 'Wan', modality: 'video', mode: 'text-to-video', source: 'live', maxInputImages: 1, defaults: { ratio: '16:9' } };
it('preserves inactive quick values but rejects explicit JSON ratio even if a quick override would hide it', () => {
  const draft = { advanced: '{"seed":7}', values: { ratio: '9:16' } };
  expect(requestParameters(draft, firstFrameModel, true)).toEqual({ seed: 7 });
  expect(draft.values.ratio).toBe('9:16');
  expect(requestParameters(draft, firstFrameModel, false)).toEqual({ seed: 7, ratio: '9:16' });
  expect(() => requestParameters({ advanced: '{"ratio":"16:9"}', values: { ratio: 'adaptive' } }, firstFrameModel, true)).toThrow('First-frame video follows the input image ratio.');
  expect(requestParameters({ advanced: '{"ratio":"adaptive"}', values: { ratio: '9:16' } }, firstFrameModel, true)).toEqual({ ratio: 'adaptive' });
  expect(requestParameters(draft, { ...firstFrameModel, modality: 'image' }, true)).toEqual({ seed: 7, ratio: '9:16' });
  expect(requestParameters(draft, { ...firstFrameModel, provider: 'atlascloud' }, true)).toEqual({ seed: 7, ratio: '9:16' });
});
it('keeps first-frame guidance visible for provider-native inputs and while editing invalid JSON', () => {
  expect(parameterInputImageRatio(firstFrameModel, { advanced: '{"images":[{"role":"first_frame","url":"https://example.test/a.png"}]}', values: {} }, false)).toBe(true);
  expect(parameterInputImageRatio(firstFrameModel, { advanced: '{', values: {} }, true)).toBe(true);
  expect(parameterInputImageRatio(firstFrameModel, { advanced: '{}', values: {} }, false)).toBe(false);
});
it('keeps the first-frame conflict actionable through Toast sanitization and localization', () => {
  const message = 'First-frame video follows the input image ratio. Remove parameters.ratio or set it to "adaptive".';
  expect(toastErrorMessage(message)).toBe(message);
  for (const { locale } of languages) {
    const localized = translate(locale, message);
    expect(localized).toContain('ratio');
    expect(localized).toContain('adaptive');
    if (locale !== 'en') expect(localized).not.toBe(message);
  }
});
it('resizes with keyboard, bounds the pane, remembers width and resets on double click', async () => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const container = document.createElement('div'); document.body.append(container);
  Object.defineProperty(container, 'clientWidth', { value: 1400 });
  const root = createRoot(container);
  const render = () => root.render(<ResizablePane className="test-pane" storageKey="test-width" initial={460} min={340} max={800} edge="left" label="Resize creator"><div>Content</div></ResizablePane>);
  try {
    await act(async () => render());
    const separator = container.querySelector('[role="separator"]')!;
    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(container.querySelector<HTMLElement>('.test-pane')!.style.width).toBe('476px');
    expect(localStorage.getItem('test-width')).toBe('476');
    await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(container.querySelector<HTMLElement>('.test-pane')!.style.width).toBe('800px');
    await act(async () => separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(localStorage.getItem('test-width')).toBe('460');
    localStorage.setItem('test-width', 'Infinity'); expect(readPaneWidth('test-width', 460, 340, 800)).toBe(460);
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});

it('builds clean duration ticks and applies shotPreferences to bounded number duration fields', () => {
  expect(durationTicks(4, 30)).toEqual([4, 10, 15, 20, 30]);
  expect(durationTicks(2, 15)).toEqual([2, 5, 10, 15]);
  const base: Model = {
    id: 'account:doubao-seedance-2-5-260628', provider: 'account', modelId: 'doubao-seedance-2-5-260628',
    label: 'doubao-seedance-2-5-260628', modality: 'video', mode: 'text-to-video', source: 'live',
    nativeOptions: {
      durations: { values: [5, 4, ...Array.from({ length: 25 }, (_, i) => i + 6)], default: 5 },
      ratios: { values: ['16:9', '9:16'], default: '16:9' },
    },
  };
  const seedance: Model = { ...base, generationOptions: generationOptions(base) };
  expect(shotParameters(seedance, { aspect: '9:16', duration: 15 })).toEqual({
    values: { ratio: '9:16', duration: 15 },
    advanced: '{}',
  });
  expect(shotParameters(seedance, { aspect: '9:16', duration: 99 })).toEqual({
    values: { ratio: '9:16' },
    advanced: '{}',
  });
});

it('prefixes non-numeric parameter summary choices with their field label while keeping ratios and resolutions compact', async () => {
  const gptImageBase: Model = {
    id: 'opendesign:gpt-image-2.6-flare',
    provider: 'opendesign',
    modelId: 'gpt-image-2.6-flare',
    label: 'GPT Image 2.6 Flare',
    modality: 'image',
    mode: 'text-to-image',
    source: 'live',
    nativeOptions: { quality: { values: ['low', 'medium', 'high'], default: 'low' } },
  };
  const gptImage: Model = { ...gptImageBase, generationOptions: generationOptions(gptImageBase) };
  const nanoBase: Model = {
    id: 'opendesign:nano-banana-2',
    provider: 'opendesign',
    modelId: 'nano-banana-2',
    label: 'Nano Banana 2',
    modality: 'image',
    mode: 'text-to-image',
    source: 'live',
    nativeOptions: {
      profiles: {
        generations: {
          profiles: [{ aspect_ratio: '1:1', resolution: '1K' }, { aspect_ratio: '16:9', resolution: '2K' }],
          default: { aspect_ratio: '1:1', resolution: '1K' },
        },
      },
    },
  };
  const nano: Model = { ...nanoBase, generationOptions: generationOptions(nanoBase) };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <GenerationParameters model={gptImage} draft={emptyParameters} appearance="boxed" onChange={vi.fn()} />,
    ));
    expect(container.querySelector('.om-generation-summary')?.textContent).toBe('Quality low');
    expect(gptImage.generationOptions?.fields.find(f => f.key === 'quality')?.choices?.map(c => c.value)).toEqual(['low', 'medium', 'high']);

    // Fields with a concrete default omit the dead "Model default" option; fields without a default keep it.
    await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());
    const optionsFor = async (fieldLabel: string) => {
      const trigger = document.querySelector<HTMLButtonElement>(`.om-generation-popover [aria-label="${fieldLabel}"]`)!;
      await act(async () => trigger.click());
      const listbox = document.getElementById(trigger.getAttribute('aria-controls')!)!;
      return [...listbox.querySelectorAll('[role="option"]')].map(option => option.textContent);
    };
    expect(await optionsFor('Quality')).toEqual(['low', 'medium', 'high']);
    expect(await optionsFor('Background')).toEqual(['Model default', 'Transparent']);
    await act(async () => container.querySelector<HTMLButtonElement>('.om-generation-summary')!.click());

    await act(async () => root.render(
      <GenerationParameters model={gptImage} draft={{ values: { quality: 'high', background: 'transparent' }, advanced: '{}' }} appearance="boxed" onChange={vi.fn()} />,
    ));
    expect(container.querySelector('.om-generation-summary')?.textContent).toBe('Quality high · Background Transparent');

    await act(async () => root.render(
      <GenerationParameters model={nano} draft={{ values: { aspect_ratio: '16:9', resolution: '2K' }, advanced: '{}' }} appearance="boxed" onChange={vi.fn()} />,
    ));
    expect(container.querySelector('.om-generation-summary')?.textContent).toBe('16:9 · 2K');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
