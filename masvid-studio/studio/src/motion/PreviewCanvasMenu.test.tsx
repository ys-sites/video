// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { PreviewCanvasMenu } from './PreviewCanvasMenu';

const state = vi.hoisted(() => ({ composition: 'index.html', blocked: false, error: '', calls: [] as any[], wait: vi.fn(), toast: vi.fn() }));
vi.mock('../contexts/StudioContext', () => ({ useStudioShellContext: () => ({ projectId: 'project', activeCompPath: state.composition, compositionDimensions: { width: 1920, height: 1080 }, writeBlockedReason: state.blocked ? 'Blocked' : null, renderQueue: { isRendering: false }, waitForPendingDomEditSaves: state.wait, showToast: state.toast }) }));
vi.mock('../player/store/previewIframeStore', () => ({ useLivePreviewIframe: () => ({ contentDocument: document }) }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: vi.fn(async (_path, _method, input) => {
  state.calls.push(input);
  if (input.name === 'openmotion_get_project') return { revision: 'snapshot', currentVersionId: 'version' };
  if (state.error) throw new Error(state.error);
  return {};
}) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const render = () => act(async () => root.render(<I18nProvider initialLocale="en"><PreviewCanvasMenu /></I18nProvider>));
const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="Aspect ratio"]')!;
const choosePortrait = () => act(async () => [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(el => el.textContent === '9:16')!.click());
beforeEach(() => {
  state.composition = 'index.html'; state.blocked = false; state.error = ''; state.calls = [];
  state.wait.mockReset().mockResolvedValue(undefined); state.toast.mockReset();
  document.body.innerHTML = '<div data-composition-id="main" data-canvas-fit="cover"></div><main></main>';
  root = createRoot(document.querySelector('main')!);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });

it('uses the saved fit and guarded public operation after flushing native edits', async () => {
  await render(); await act(async () => trigger().click()); await choosePortrait();
  expect(state.wait).toHaveBeenCalledOnce();
  expect(state.calls[1]).toMatchObject({ name: 'openmotion_edit_project', arguments: { projectId: 'project', expectedRevision: 'snapshot', expectedVersionId: 'version', canvas: { compositionPath: 'index.html', ratio: '9:16', fit: 'cover' } } });
  expect(state.calls[1].arguments.requestId).toBeTruthy(); expect(state.toast).toHaveBeenCalledWith('Canvas updated', 'info');
});
it('retries an interrupted response with the same request and does not display unsaved dimensions', async () => {
  state.error = 'Disconnected'; await render(); await act(async () => trigger().click()); await choosePortrait();
  expect(trigger().textContent).toBe('16:9'); expect(state.toast).toHaveBeenCalledWith('Disconnected', 'error');
  state.error = ''; await choosePortrait();
  expect(state.calls.filter(call => call.name === 'openmotion_get_project')).toHaveLength(1);
  const writes = state.calls.filter(call => call.name === 'openmotion_edit_project'); expect(writes[0].arguments).toEqual(writes[1].arguments);
});
it('reads fresh revision guards after a conflict', async () => {
  state.error = 'VERSION_CONFLICT'; await render(); await act(async () => trigger().click()); await choosePortrait();
  state.error = ''; await choosePortrait();
  expect(state.calls.filter(call => call.name === 'openmotion_get_project')).toHaveLength(2);
  const writes = state.calls.filter(call => call.name === 'openmotion_edit_project'); expect(writes[0].arguments.requestId).not.toBe(writes[1].arguments.requestId);
});
it('does not write after switching compositions or when native save authority blocks edits', async () => {
  let finish!: () => void; state.wait.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await render(); await act(async () => trigger().click()); await choosePortrait();
  state.composition = 'other.html'; await render(); await act(async () => finish());
  expect(state.calls).toHaveLength(0);
  state.blocked = true; await render(); expect(trigger().disabled).toBe(true);
});
