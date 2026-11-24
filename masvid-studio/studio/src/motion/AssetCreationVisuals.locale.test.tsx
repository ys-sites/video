// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { AssetGenerationCard } from './AssetCreationVisuals';
import type { GenerationJob } from '../../../shared/gateway';

const job = (error: string) => ({ id: 'job', projectId: 'project', state: 'failed', modality: 'video', prompt: 'Steam over a mug', error, createdAt: 0, updatedAt: 0,
  model: { id: 'account:wan-2.7', provider: 'account', modelId: 'wan-2.7', label: 'wan-2.7', modality: 'video', source: 'live', mode: 'text-to-video' } }) as GenerationJob;

it('shows a known failure reason in the interface language and keeps other details unchanged', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const render = (error: string) => act(async () => root.render(<I18nProvider initialLocale="zh-CN"><AssetGenerationCard job={job(error)} onCancel={() => {}} onView={() => {}} /></I18nProvider>));
  const details = () => container.querySelector('.om-creation-job-error p')?.textContent;
  await render('OpenDesign rejected this request for the selected model. Choose another model or change the options, then try again.');
  expect(details()).toBe('OpenDesign 拒绝了当前模型的这次请求。请换一个模型或调整参数后重试。');
  await render('Provider HTTP 500');
  expect(details()).toBe('Provider HTTP 500');
  await act(async () => root.unmount()); container.remove();
});
