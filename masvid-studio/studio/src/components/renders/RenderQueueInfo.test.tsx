// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RenderQueueInfo } from './RenderQueueInfo';
import { I18nProvider } from '../../i18n/I18n';
import type { RenderJob } from './useRenderQueue';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const job: RenderJob = { id: 'attempt-1', status: 'unknown', filename: 'Opening (1).mp4', progress: 55, createdAt: 1_800_000_000_000, lastCheckedAt: 1_800_000_002_000 };

it('shows the original attempt start, last check and actual output settings without changing the saved settings', () => {
  const settings = Object.freeze({ render_format: 'mp4', render_quality: 'high', render_resolution: 'portrait-4k', render_fps: 24 });
  act(() => root.render(<RenderQueueInfo job={{ ...job, settings, stage: 'Encoding frame 55/100' }} />));
  expect(host.textContent).toContain('Result needs checking');
  expect(host.textContent).toContain('Last confirmed stage: Encoding frame 55/100');
  expect(host.textContent).toContain('Last checked:');
  expect(host.querySelector('time')?.dateTime).toBe(new Date(job.createdAt).toISOString());
  expect(host.textContent).toContain('MP4 · High Quality · 24 fps · 2160×3840');
  expect(host.querySelector('[role=progressbar]')).toBeNull();
  expect(settings.render_resolution).toBe('portrait-4k');
});

it('keeps an unrecognized real phase instead of replacing it with a rendering claim', () => {
  act(() => root.render(<I18nProvider initialLocale="ja"><RenderQueueInfo job={{ ...job, stage: 'Inspecting source checksum' }} /></I18nProvider>));
  expect(host.textContent).toContain('Inspecting source checksum');
});

it('localizes the unknown-result placeholder while preserving a real output filename', () => {
  act(() => root.render(<I18nProvider initialLocale="zh-CN"><RenderQueueInfo job={{ ...job, filename: 'Export result pending' }} /></I18nProvider>));
  expect(host.textContent).toContain('导出结果待核对');
  act(() => root.render(<I18nProvider initialLocale="zh-CN"><RenderQueueInfo job={{ ...job, filename: 'Export result pending', status: 'complete' }} /></I18nProvider>));
  expect(host.textContent).toContain('Export result pending');
});
