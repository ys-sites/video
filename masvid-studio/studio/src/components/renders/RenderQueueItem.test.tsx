// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderQueueItem } from "./RenderQueueItem";
import type { RenderJob } from "./useRenderQueue";

vi.mock('../../motion/diagnostics', () => ({ recordBrowserDiagnostic: vi.fn(), diagnosticsActive: () => false }));
const io = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn() }));
const usage = vi.hoisted(() => ({ click: vi.fn() }));
vi.mock('../../motion/editorTracking', () => ({ trackStudioClick: usage.click, clickMethod: (event: { detail: number }) => event.detail === 0 ? 'keyboard' : 'pointer' }));
vi.mock('../../telemetry/ioRecovery', () => ({ beginStudioIo: io.begin }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: Root;
const job: RenderJob = { id: "j1", nativeJobId: 'native-1', filename: "j1.gif", status: "complete", progress: 100, createdAt: 1_800_000_000_000 };
const button = (label: string) => [...host.querySelectorAll('button')].find(node => node.textContent === label)!;
const download = () => host.querySelector<HTMLButtonElement>('[aria-label="Download j1.gif"]')!;
const onDelete = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  onDelete.mockReset(); onCancel.mockReset(); usage.click.mockReset();
  io.finish.mockReset(); io.begin.mockReset().mockReturnValue(io.finish);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = (overrides: Partial<RenderJob> = {}, props: { onRecheck?: () => void; checking?: boolean } = {}) => act(() => root.render(
  <RenderQueueItem job={{ ...job, ...overrides }} projectId="demo" onDelete={onDelete} onCancel={onCancel} {...props} />,
));

describe('export task recovery', () => {
  it('keeps the GIF preview and confirmed deletion, and checks the original file before downloading', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/api/render/native-1/view?projectId=demo');
    expect(host.querySelector('video')).toBeNull();
    expect(host.querySelector('[aria-label="Open j1.gif in a new tab"]')).not.toBeNull();
    expect(download().disabled).toBe(false);
    await act(async () => download().click());
    expect(fetch).toHaveBeenCalledWith('/api/render/native-1/view?projectId=demo', expect.objectContaining({ method: 'HEAD', cache: 'no-store' }));
    expect(click.mock.instances[0].getAttribute('href')).toBe('/api/render/native-1/download?projectId=demo');
    expect(io.begin).toHaveBeenCalledExactlyOnceWith('download_render');
    expect(usage.click).toHaveBeenCalledExactlyOnceWith('export_panel', 'download_render', 'demo', 'keyboard');
    expect(io.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'unknown', file_status: 'available', delivery_status: 'browser_save_requested' });
    expect(document.querySelector('.motion-feedback-layer [role=status]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Delete j1.gif"]')!.click());
    expect(onDelete).not.toHaveBeenCalled();
    act(() => button('Delete?').click());
    expect(onDelete).toHaveBeenCalledOnce();
    expect(usage.click.mock.calls).toEqual([['export_panel', 'download_render', 'demo', 'keyboard'], ['export_panel', 'delete_render', 'demo', 'keyboard']]);
  });

  it('preserves one usage click when cancelling and keeps opening on its recovery event', async () => {
    render({ status: 'rendering' });
    act(() => button('Cancel').click());
    expect(onCancel).toHaveBeenCalledOnce();
    expect(usage.click).toHaveBeenCalledExactlyOnceWith('export_panel', 'cancel_render', 'demo', 'keyboard');
    usage.click.mockClear();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render({ status: 'complete' });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open j1.gif in a new tab"]')!.click());
    expect(fetch).toHaveBeenCalledOnce();
    expect(io.begin).toHaveBeenCalledExactlyOnceWith('open_render');
    expect(usage.click).not.toHaveBeenCalled();
    expect(tab.location.href).toBe('/api/render/native-1/view?projectId=demo');
  });

  it('retains filename access only for legacy history without a native attempt identity', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render({ nativeJobId: undefined });
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/api/projects/demo/renders/file/j1.gif');
    await act(async () => download().click());
    expect(fetch).toHaveBeenCalledWith('/api/projects/demo/renders/file/j1.gif', expect.objectContaining({ method: 'HEAD' }));
    expect(click.mock.instances[0].getAttribute('href')).toBe('/api/projects/demo/renders/file/j1.gif?download=1');
  });

  it('keeps an unknown result, last confirmed information and an action that only rechecks the original task', () => {
    const recheck = vi.fn();
    render({ status: 'unknown', progress: 46, stage: 'Encoding frame 46/100', lastCheckedAt: job.createdAt + 1000, error: 'Progress connection interrupted' }, { onRecheck: recheck });
    expect(host.textContent).toContain('Result needs checking');
    expect(host.textContent).toContain('Last confirmed stage: Encoding frame 46/100');
    expect(host.textContent).toContain('Last checked:');
    expect(host.textContent).not.toContain('Export failed');
    expect(host.querySelector('[role=progressbar]')).toBeNull();
    expect(host.querySelector('[aria-label="Download j1.gif"]')).toBeNull();
    expect(host.querySelector('[aria-label="Delete j1.gif"]')).toBeNull();
    expect(button('Cancel')).toBeUndefined();
    act(() => button('Recheck').click());
    expect(recheck).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
    render({ status: 'unknown' }, { onRecheck: recheck, checking: true });
    expect(button('Checking…').disabled).toBe(true);
    act(() => button('Checking…').click());
    expect(recheck).toHaveBeenCalledOnce();
  });

  it('keeps a confirmed inactive worker result unknown with no download or deletion', () => {
    const recheck = vi.fn();
    render({ status: 'unknown', workerActive: false }, { onRecheck: recheck });
    expect(host.textContent).toContain('No active worker is attached. A new export keeps this unknown record.');
    expect(host.textContent).toContain('Result needs checking');
    expect(button('Copy diagnostics')).not.toBeUndefined();
    expect(button('Recheck')).not.toBeUndefined();
    expect(button('Reload editor')).toBeUndefined();
    expect(host.querySelector('[aria-label="Download j1.gif"]')).toBeNull();
    expect(host.querySelector('[aria-label="Delete j1.gif"]')).toBeNull();
    expect(recheck).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('reloads only on user request when an unconfirmed request has no matching native task', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    render({ status: 'unknown', nativeJobId: undefined, requestNotFound: true });
    expect(host.textContent).toContain('No matching task was found. Copy diagnostics, then reload the editor before exporting again.');
    expect(reload).not.toHaveBeenCalled();
    expect(io.begin).not.toHaveBeenCalled();
    expect(button('Copy diagnostics')).not.toBeUndefined();
    act(() => button('Reload editor').click());
    expect(reload).toHaveBeenCalledOnce();
    expect(io.begin).toHaveBeenCalledExactlyOnceWith('reload_editor');
    expect(io.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'unknown' });
    render({ status: 'unknown', nativeJobId: 'native-1', requestNotFound: true });
    expect(button('Reload editor')).toBeUndefined();
  });

  it('does not expose a targetless recheck or terminal actions while cancellation is unconfirmed', () => {
    render({ status: 'cancelling', stage: 'Encoding frame 46/100', progress: 46 });
    expect(host.textContent).toContain('Cancelling…');
    expect(host.textContent).not.toContain('Cancelled');
    expect(host.querySelector('[aria-label="Delete j1.gif"]')).toBeNull();
    expect(host.querySelector('[aria-label="Download j1.gif"]')).toBeNull();
    expect(button('Cancel')).toBeUndefined();
    expect(button('Recheck')).toBeUndefined();
    render({ status: 'cancelled' });
    expect(host.textContent).toContain('Cancelled');
    expect(host.querySelector('[aria-label="Delete j1.gif"]')).not.toBeNull();
    expect(download().disabled).toBe(true);
  });

  it('copies only allowlisted, redacted diagnostics for the original task without inventing an export failure', async () => {
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render({ status: 'unknown', stage: 'Encoding frame 46/100', error: 'Worker disconnected; Authorization: Bearer private-credential\nFile /tmp/redaction-fixture/private/result.mp4', settings: {
      format: 'mp4', fps: 24, quality: 'high', resolution: 'landscape', composition: 'intro.html',
      variables: { source: '<html>full project source</html>' }, chat: 'private conversation', apiKey: 'private-key-value',
    } });
    await act(async () => button('Copy diagnostics').click());
    const diagnostic = copy.mock.calls[0][0];
    expect(diagnostic).toContain('demo');
    expect(diagnostic).toContain('native-1');
    expect(diagnostic).toContain('Encoding frame 46/100');
    expect(diagnostic).toContain('intro.html');
    expect(diagnostic).toContain('Worker disconnected');
    expect(diagnostic).not.toContain('private-credential');
    expect(diagnostic).not.toContain('/tmp/redaction-fixture');
    expect(diagnostic).not.toContain('private conversation');
    expect(diagnostic).not.toContain('private-key-value');
    expect(diagnostic).not.toContain('full project source');
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(document.querySelector('.motion-feedback-layer [role=status]')?.textContent).toBe('Copied!');
  });

  it('exposes selectable diagnostics when copying is denied', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('permission denied'));
    render({ status: 'unknown' });
    await act(async () => button('Copy diagnostics').click());
    expect(host.querySelector('pre')?.textContent).toContain('native-1');
    expect(host.querySelector('pre')?.tabIndex).toBe(0);
    expect(document.querySelector('.motion-feedback-layer [role=alert]')?.textContent).toContain('Select the details');
  });

  it('retains completion after a confirmed missing file and rechecks without starting another export', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValue(new Response(null, { status: 200 }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render();
    await act(async () => download().click());
    expect(click).not.toHaveBeenCalled();
    expect(io.finish).toHaveBeenLastCalledWith({ outcome: 'failure', file_status: 'unavailable' });
    expect(host.textContent).toContain('Export completed');
    expect(host.textContent).toContain('original file is currently unavailable');
    expect(host.querySelector('img')).toBeNull();
    expect(download().disabled).toBe(true);
    expect(host.querySelector('[aria-label="Delete j1.gif"]')).not.toBeNull();
    await act(async () => button('Recheck file').click());
    expect(io.begin).toHaveBeenLastCalledWith('recheck_file');
    expect(io.finish).toHaveBeenLastCalledWith({ outcome: 'success', file_status: 'available' });
    expect(download().disabled).toBe(false);
    await act(async () => download().click());
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0].getAttribute('href')).toBe('/api/render/native-1/download?projectId=demo');
    expect(fetch.mock.calls).toHaveLength(3);
    expect(fetch.mock.calls.every(([path, init]) => path === '/api/render/native-1/view?projectId=demo' && init?.method === 'HEAD')).toBe(true);
  });

  it('does not turn an access-check connection error into a deleted-file claim', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render();
    await act(async () => download().click());
    expect(host.textContent).toContain('Export completed. File access could not be confirmed.');
    expect(host.textContent).not.toMatch(/deleted|original file is currently unavailable/);
    expect(download().disabled).toBe(true);
    expect(button('Recheck file')).toBeDefined();
    expect(click).not.toHaveBeenCalled();
    expect(io.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'unknown', file_status: 'unknown' });
  });

  it('starts with an unavailable file disabled and restores the same result after recheck', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    render({ fileAvailable: false });
    expect(download().disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Open j1.gif in a new tab"]')?.disabled).toBe(true);
    await act(async () => button('Recheck file').click());
    expect(download().disabled).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('checks the same file for opening and closes the reserved tab on failed access', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 410 }));
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    render();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open j1.gif in a new tab"]')!.click());
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('/api/render/native-1/view?projectId=demo');
    expect(io.begin).toHaveBeenCalledExactlyOnceWith('open_render');
    expect(io.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'success', file_status: 'available', delivery_status: 'opened' });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open j1.gif in a new tab"]')!.click());
    expect(tab.close).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('original file is currently unavailable');
  });

  it('ignores a duplicate click during the same file check without creating duplicate IO events', async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render();
    act(() => { download().click(); download().click(); });
    expect(io.begin).toHaveBeenCalledExactlyOnceWith('download_render');
    expect(io.finish).not.toHaveBeenCalled();
    await act(async () => resolve(new Response(null, { status: 200 })));
    expect(io.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'unknown', file_status: 'available', delivery_status: 'browser_save_requested' });
  });

  it('records a blocked popup without claiming that the file opened', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    vi.spyOn(window, 'open').mockReturnValue(null);
    render();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open j1.gif in a new tab"]')!.click());
    expect(io.begin).toHaveBeenCalledExactlyOnceWith('open_render');
    expect(io.finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'failure', file_status: 'available', delivery_status: 'popup_blocked' });
    expect(document.querySelector('.motion-feedback-layer [role=alert]')?.textContent).toContain('Allow pop-ups');
  });

  it('adds existing task context to failed export details while preserving the actual service reason', async () => {
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render({ status: 'failed', stage: 'Inspecting source', error: 'Worker exited with code 7. token=private-token-value' });
    act(() => button('Error details').click());
    expect(host.querySelector('pre')?.textContent).toContain('Worker exited with code 7');
    await act(async () => button('Copy error information').click());
    expect(copy.mock.calls[0][0]).toContain('native-1');
    expect(copy.mock.calls[0][0]).not.toContain('private-token-value');
    expect(host.textContent).not.toContain('missing audio');
  });
});
