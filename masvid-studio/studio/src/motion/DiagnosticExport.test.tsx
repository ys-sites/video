// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider, useI18n, translate } from '../i18n/I18n';
import { DiagnosticExport } from './DiagnosticExport';
import { recordBrowserDiagnostic } from './diagnostics';

vi.mock('./diagnostics', () => ({ browserDiagnostics: () => [], nextDiagnosticRequest: () => 'fixture-request', recordBrowserDiagnostic: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() {
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<I18nProvider initialLocale="zh-CN"><DiagnosticExport /></I18nProvider>));
  return container.querySelector('button')!;
}

it('downloads one local ZIP, disables duplicate clicks and releases the browser URL', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn((url: RequestInfo | URL) => url === '/motion-api/diagnostics'
    ? new Promise<Response>(resolve => { finish = resolve; })
    : Promise.resolve(Response.json({ enabled: false })));
  vi.stubGlobal('fetch', fetcher);
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagnostic-fixture');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('openmotion-diagnostics-fixture.zip');
  });
  const button = await render(); expect(button.textContent).toBe('导出诊断 ZIP');
  await act(async () => { button.click(); button.click(); });
  // A late usage-config read must not capture the ZIP request's resolver.
  void fetch('/motion-api/tracking');
  // Usage reporting may read its own configuration; only diagnostic requests count here.
  const diagnosticCalls = () => fetcher.mock.calls.filter(([url]) => url === '/motion-api/diagnostics');
  expect(button.disabled).toBe(true); expect(diagnosticCalls()).toHaveLength(1);
  expect(document.querySelector('[role=status]')).toBeNull();
  const response = new Response('ZIP', { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="openmotion-diagnostics-fixture.zip"' } });
  let finishBody!: (value: Blob) => void;
  vi.spyOn(response, 'blob').mockReturnValue(new Promise<Blob>(resolve => { finishBody = resolve; }));
  await act(async () => finish(response));
  expect(button.disabled).toBe(true); expect(click).not.toHaveBeenCalled();
  expect(recordBrowserDiagnostic).not.toHaveBeenCalledWith('activity_diagnostic_export', expect.stringContaining('outcome=download_triggered'));
  await act(async () => finishBody(new Blob(['ZIP'], { type: 'application/zip' })));
  await vi.waitFor(() => {
    expect(recordBrowserDiagnostic).toHaveBeenCalledWith('activity_diagnostic_export', expect.stringContaining('outcome=download_triggered'));
    expect(button.disabled).toBe(false); expect(create).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role=status]')?.textContent).toBe('已发起下载，请查看浏览器下载列表。');
  });
  await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:diagnostic-fixture'), { timeout: 1500 });
  await act(async () => button.click());
  expect(document.querySelector('.om-card-stack [role=status]')).toBeNull();
  await act(async () => finish(new Response('', { status: 429 })));
  expect(document.querySelector('.om-card-stack [role=alert]')).toBeNull();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('30 秒');
});

it('shows a localized rate-limit error and never starts a failed download', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => url === '/motion-api/diagnostics' ? new Response('', { status: 429 }) : Response.json({ enabled: false })));
  const create = vi.spyOn(URL, 'createObjectURL');
  const button = await render(); await act(async () => button.click());
  expect(document.querySelector('[role=alert]')?.textContent).toContain('30 秒'); expect(create).not.toHaveBeenCalled();
  expect(recordBrowserDiagnostic).toHaveBeenCalledWith('diagnostic_export_failed', expect.stringContaining('status=429'));
  expect(recordBrowserDiagnostic).not.toHaveBeenCalledWith('activity_diagnostic_export', expect.stringContaining('outcome=download_triggered'));
});

it('updates a visible download failure when the language changes without retrying', async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL) => url === '/motion-api/diagnostics' ? new Response('', { status: 429 }) : Response.json({ enabled: false }));
  vi.stubGlobal('fetch', fetcher);
  function App() {
    const { setLocale } = useI18n();
    return <><button onClick={() => setLocale('de')}>German</button><DiagnosticExport /></>;
  }
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<I18nProvider initialLocale="en"><App /></I18nProvider>));
  await act(async () => container.querySelectorAll('button')[1].click());
  await act(async () => container.querySelector('button')!.click());
  expect(document.querySelector('[role=alert]')?.textContent).toBe(translate('de', 'Please wait 30 seconds before exporting diagnostics again.'));
  expect(fetcher.mock.calls.filter(([url]) => url === '/motion-api/diagnostics')).toHaveLength(1);
});
