// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReviewComment, ReviewCommentsInput } from '../../../shared/review-comments';
import type { DomEditSelection } from '../components/editor/domEditingTypes';
import { makeSelection } from '../hooks/domSelectionTestHarness';
import { I18nProvider } from '../i18n/I18n';
import { usePlayerStore } from '../player/store/playerStore';
import { ReviewCommentsPanel } from './ReviewCommentsPanel';
import { useReviewMarkupStore } from './reviewMarkupStore';
import { useReviewPresentationStore } from './reviewPresentationStore';
import { ReviewPlayerControls, ReviewCommentsListSlot } from './ReviewPlayerControls';

const state = vi.hoisted(() => ({ projectId: 'project', composition: 'index.html', revision: 'a'.repeat(64),
  selection: { current: null as DomEditSelection | null }, comments: [] as ReviewComment[],
  save: vi.fn<() => Promise<void>>(), toast: vi.fn(), request: vi.fn(), createError: '', updateError: '',
  iframe: { current: null as HTMLIFrameElement | null },
  setComposition: vi.fn(),
  listMounted: true, visible: true,
}));
vi.mock('../contexts/StudioContext', () => ({ useStudioShellContext: () => ({
  projectId: state.projectId, activeCompPath: state.composition, setActiveCompPath: state.setComposition,
  waitForPendingDomEditSaves: state.save, showToast: state.toast, previewIframeRef: state.iframe,
}) }));
vi.mock('../contexts/DomEditContext', () => ({ useDomEditContext: () => ({
  domEditSelection: state.selection.current, domEditSelectionRef: state.selection,
  buildDomSelectionFromTarget: vi.fn(), applyDomSelection: vi.fn(),
}) }));
vi.mock('../components/dock/dockLayoutStore', () => ({ useDockLayoutStore: (selector: (value: unknown) => unknown) => selector({ visiblePanels: new Set(state.visible ? ['comments'] : []) }) }));
vi.mock('./useIntegrationInfo', () => ({ useIntegrationInfo: () => ({ info: { dataDirectory: '/fixture/workspace' } }) }));
vi.mock('./reviewCommentsClient', async original => ({ ...await original<typeof import('./reviewCommentsClient')>(), requestComments: (...args: unknown[]) => state.request(...args) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name)!;
const click = (name: string) => act(async () => button(name).click());
const render = () => act(async () => root.render(<I18nProvider initialLocale="en"><ReviewPlayerControls projectId={state.projectId} disabled={false} /><div data-review-overlay ref={useReviewPresentationStore.getState().setPlayerHost} /><ReviewCommentsPanel />{state.listMounted && <ReviewCommentsListSlot />}</I18nProvider>));
async function type(text: string) {
  if (!useReviewPresentationStore.getState().composerOpen) await act(async () => {
    const store = useReviewPresentationStore.getState();
    if (store.mode === 'comment') store.place({ x: 0.4, y: 0.5 }, null);
    else store.compose({ x: 0.4, y: 0.5 });
  });
  await act(async () => {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(async () => {
  state.projectId = 'project'; state.composition = 'index.html'; state.revision = 'a'.repeat(64);
  useReviewPresentationStore.setState({ playerHost: null, listHost: null, intent: null, drafting: false, busy: false, count: 0, mode: null, composerOpen: false, placement: null, frame: null });
  state.iframe.current = null;
  state.listMounted = true; state.visible = true;
  state.selection.current = null; state.comments = []; state.createError = state.updateError = '';
  state.save.mockReset().mockResolvedValue(); state.toast.mockReset();
  state.setComposition.mockReset();
  state.request.mockReset().mockImplementation(async (input: ReviewCommentsInput) => {
    if (input.operation === 'create') {
      if (state.createError) throw new Error(state.createError);
      state.comments.push({ id: crypto.randomUUID(), projectId: input.projectId, revision: 1, status: 'open',
        text: input.text!, anchor: structuredClone(input.anchor!), sourceRevision: state.revision, createdAt: 1, updatedAt: 1 });
    }
    if (input.operation === 'update' && state.updateError) throw new Error(state.updateError);
    return structuredClone({ projectId: input.projectId, sourceRevision: state.revision, comments: state.comments });
  });
  usePlayerStore.setState({ currentTime: 1, isPlaying: false, requestedSeekTime: null, playbackRequest: null });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });

it('does not poll an idle player but refreshes on focus and while the review list is visible', async () => {
  expect(state.request).toHaveBeenCalledTimes(1);
  state.visible = false; await render();
  expect(useReviewPresentationStore.getState().playerHost).toBeTruthy();
  vi.useFakeTimers(); state.request.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(state.request).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(state.request).toHaveBeenCalledTimes(1);
  state.visible = true; await render();
  expect(state.request).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(state.request).toHaveBeenCalledTimes(3);
  state.visible = false; await render(); state.request.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(state.request).not.toHaveBeenCalled();
});

it('polls an active player draft with the sidebar closed and stops after cancellation', async () => {
  state.visible = false; await render(); vi.useFakeTimers(); state.request.mockClear();
  await click('Comment here');
  expect(useReviewPresentationStore.getState().drafting).toBe(true);
  state.request.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(state.request).toHaveBeenCalledTimes(1);
  await act(async () => useReviewPresentationStore.getState().request(state.projectId, 'cancel'));
  state.request.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(state.request).not.toHaveBeenCalled();
});

it('skips background scans and refreshes when the document becomes visible', async () => {
  state.visible = false; await render(); vi.useFakeTimers();
  state.visible = true; await render(); state.request.mockClear();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(15000); });
  expect(state.request).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(state.request).toHaveBeenCalledTimes(1);
});

it('creates a comment in the player while the sidebar is unmounted', async () => {
  state.listMounted = false; await render();
  await click('Comment here'); await type('Keep watching and note this moment');
  expect(document.querySelector('[data-review-overlay] textarea')?.getAttribute('aria-label')).toBe('Comment');
  expect(document.querySelector('section[aria-label="Comments"]')).toBeNull();
  await click('Save comment');
  expect(state.comments[0].anchor).toMatchObject({ scope: 'frame', time: 1 });
  state.listMounted = true; await render();
  expect(document.querySelector('section[aria-label="Comments"]')?.textContent).toContain('Keep watching and note this moment');
});

it('keeps the empty list simple and shows only recovery when loading fails', async () => {
  expect(button('Filter comments')).toBeUndefined();
  expect(document.querySelector('[data-review-footer]')).toBeNull();
  state.request.mockRejectedValue(new Error('Disconnected'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not load comments');
  expect(document.body.textContent).not.toContain('No comments here yet');
});

it('copies all pending comments without entering selection mode', async () => {
  await click('Comment here'); await type('First change'); await click('Save comment');
  await click('Comment here'); await type('Second change'); await click('Save comment');
  state.comments[0].status = 'resolved';
  await act(async () => window.dispatchEvent(new Event('focus')));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await click('Copy pending for Agent (1)');
  expect(copy.mock.calls[0][0]).toContain('Second change');
  expect(copy.mock.calls[0][0]).not.toContain('First change');
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
});

it.each(['index.html', 'compositions/scene.html'])('keeps playback and composition unchanged when opening a whole-video comment from %s', async composition => {
  await act(async () => useReviewPresentationStore.getState().request('project', 'project'));
  await type('Keep the overall pacing calm'); await click('Save comment');
  state.composition = composition; await render();
  await act(async () => usePlayerStore.setState({ currentTime: 4, isPlaying: true, requestedSeekTime: null, playbackRequest: null }));
  await click('Whole video');
  expect(state.setComposition).not.toHaveBeenCalled();
  expect(usePlayerStore.getState()).toMatchObject({ currentTime: 4, isPlaying: true, requestedSeekTime: null, playbackRequest: null });
  expect(document.body.textContent).toContain('Keep the overall pacing calm');
});

it.each([0, 2])('still pauses and seeks to a frame comment at %s seconds', async time => {
  await act(async () => usePlayerStore.setState({ currentTime: time }));
  await click('Comment here'); await type('Review this exact frame'); await click('Save comment');
  await act(async () => usePlayerStore.setState({ currentTime: 4, isPlaying: true, requestedSeekTime: null, playbackRequest: null }));
  await click(`00:0${time}.000`);
  expect(usePlayerStore.getState()).toMatchObject({ requestedSeekTime: time, playbackRequest: { playing: false } });
  expect(state.setComposition).not.toHaveBeenCalled();
});

it('waits for pending edits then freezes the current frame and live element context', async () => {
  const el = document.createElement('h1'); el.id = 'heading'; el.textContent = 'Before save'; document.body.append(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 30, width: 140, height: 60 } as DOMRect);
  state.selection.current = makeSelection('Heading', el); await render();
  let finish!: () => void;
  state.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await click('Comment here');
  expect(document.querySelector('textarea')).toBeNull();
  el.textContent = 'After save'; usePlayerStore.setState({ currentTime: 2 });
  await act(async () => finish());
  await type('Enlarge this heading');
  el.textContent = 'Later playback'; usePlayerStore.setState({ currentTime: 5 });
  await click('Save comment');
  expect(state.comments[0]).toMatchObject({ text: 'Enlarge this heading', anchor: { time: 2, scope: 'element', element: {
    domId: 'heading', text: 'After save', sourceFile: 'index.html', box: { x: 20, y: 30, width: 140, height: 60 },
  } } });
  expect(state.comments[0].anchor.element?.handle).toContain('v2:project:index.html:index.html:heading');
});

it('keeps draft text and explicitly recaptures after a source revision conflict', async () => {
  await click('Comment here'); await type('Retain this note');
  state.createError = 'VERSION_CONFLICT: changed';
  await click('Save comment');
  expect(state.comments).toHaveLength(0);
  expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('Recapture'), 'error');
  state.createError = ''; state.revision = 'b'.repeat(64); usePlayerStore.setState({ currentTime: 3 });
  await click('Recapture current frame');
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Retain this note');
  await click('Save comment');
  expect(state.comments[0]).toMatchObject({ text: 'Retain this note', sourceRevision: state.revision, anchor: { time: 3 } });
});

it('does not capture when a pending native edit fails', async () => {
  state.save.mockRejectedValue(new Error('Save failed'));
  await click('Comment here');
  expect(document.querySelector('textarea')).toBeNull();
  expect(state.toast).toHaveBeenCalledWith('Save failed', 'error');
  expect(state.request.mock.calls.filter(([input]) => input.operation === 'create')).toHaveLength(0);
});

function readyPreview() {
  const iframe = document.createElement('iframe'); document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML = '<div data-composition-id="main" data-width="640" data-height="360"></div>';
  state.iframe.current = iframe;
}

it('saves annotation geometry against its frozen time even after the playhead moves', async () => {
  readyPreview(); await click('Draw a comment');
  expect(document.querySelector('textarea')).toBeNull();
  await act(async () => useReviewMarkupStore.getState().add({ kind: 'rectangle', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 }] }));
  await type('Align inside this area');
  await act(async () => usePlayerStore.setState({ currentTime: 4 }));
  expect(button('Return to annotated frame')).toBeTruthy();
  await click('Save comment');
  expect(state.comments[0].anchor).toMatchObject({ scope: 'frame', time: 1, annotation: { version: 1, width: 640, height: 360, marks: [{ kind: 'rectangle' }] } });
});

it('recapturing a changed source clears old ink while preserving the written feedback', async () => {
  readyPreview(); await click('Draw a comment');
  await act(async () => useReviewMarkupStore.getState().add({ kind: 'arrow', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 }] }));
  await type('Keep this text'); state.createError = 'VERSION_CONFLICT: changed';
  await click('Save comment');
  state.createError = ''; state.revision = 'c'.repeat(64);
  await click('Recapture current frame');
  expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Keep this text');
  expect(useReviewMarkupStore.getState().draft!.annotation.marks).toHaveLength(0);
  expect(button('Save comment').disabled).toBe(true);
});

it('hides a draft on source refresh and requires explicit recapture', async () => {
  readyPreview(); await click('Draw a comment'); await type('Keep my review');
  await act(async () => useReviewMarkupStore.getState().add({ kind: 'rectangle', points: [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.8 }] }));
  state.revision = 'd'.repeat(64);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(useReviewMarkupStore.getState().draft).toMatchObject({ stale: true, locked: true });
  expect(button('Recapture current frame')).toBeTruthy();
  expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Keep my review');
  expect(useReviewMarkupStore.getState().draft!.annotation.marks).toHaveLength(1);
});

it('refreshes source identity before displaying a saved annotation', async () => {
  readyPreview(); await click('Draw a comment'); await type('Old layout');
  await act(async () => useReviewMarkupStore.getState().add({ kind: 'arrow', points: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 }] }));
  await click('Save comment');
  state.revision = 'e'.repeat(64);
  await act(async () => document.querySelector<HTMLButtonElement>('article button.om-text-link')!.click());
  expect(useReviewMarkupStore.getState().displayed).toBeNull();
  expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('earlier project revision'), 'error');
});

it('copies selected IDs with the latest comment text and revision', async () => {
  await click('Comment here'); await type('Original review'); await click('Save comment'); await click('Choose comments'); await click('Select all shown');
  state.comments[0].text = 'Updated by Agent'; state.comments[0].revision = 2;
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await click('Copy for Agent (1)');
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('Updated by Agent'));
  expect(copy.mock.calls[0][0]).toContain(state.comments[0].id);
  expect(copy.mock.calls[0][0]).toContain('/fixture/workspace');
});

it('cancels an unfinished clipboard handoff when the project changes', async () => {
  await click('Comment here'); await type('Old project'); await click('Save comment'); await click('Choose comments'); await click('Select all shown');
  let finish!: () => void;
  state.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await click('Copy for Agent (1)');
  state.projectId = 'another-project'; state.comments = []; await render();
  await act(async () => finish());
  expect(copy).not.toHaveBeenCalled();
});

it('refreshes concurrent comment changes without overwriting them', async () => {
  await click('Comment here'); await type('Initial'); await click('Save comment');
  state.comments[0].text = 'Concurrent change'; state.comments[0].revision = 2;
  state.updateError = 'COMMENT_CONFLICT: changed';
  await click('Mark complete');
  expect(document.body.textContent).toContain('Concurrent change');
  expect(state.comments[0].status).toBe('open');
  expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('changed elsewhere'), 'error');
});

it('activates tools without opening a composer until the canvas gesture finishes', async () => {
  readyPreview();
  await click('Comment here');
  expect(document.querySelector('textarea')).toBeNull();
  expect(useReviewPresentationStore.getState().mode).toBe('comment');
  await act(async () => useReviewPresentationStore.getState().place({ x: 0.2, y: 0.3 }, null));
  expect(document.querySelector('textarea[aria-label="Comment"]')).not.toBeNull();
  await click('Cancel');
  await click('Draw a comment');
  expect(document.querySelector('textarea')).toBeNull();
  expect(useReviewMarkupStore.getState().draft?.tool).toBe('pen');
  await act(async () => {
    useReviewMarkupStore.getState().add({ kind: 'pen', points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] });
    useReviewPresentationStore.getState().compose({ x: 0.3, y: 0.4 });
  });
  await type('Keep this while drawing more');
  await click('Continue drawing');
  expect(document.querySelector('textarea')).toBeNull();
  await act(async () => useReviewPresentationStore.getState().compose({ x: 0.5, y: 0.6 }));
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep this while drawing more');
});

it('keeps written feedback when switching a whole-video draft to the drawing tool', async () => {
  readyPreview();
  await act(async () => useReviewPresentationStore.getState().request('project', 'project'));
  await type('Keep this overall feedback');
  await click('Draw a comment');
  expect(useReviewMarkupStore.getState().draft?.anchor).toMatchObject({ scope: 'frame', time: 1 });
  expect(document.querySelector('textarea')).toBeNull();
  await act(async () => useReviewPresentationStore.getState().compose({ x: 0.5, y: 0.5 }));
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep this overall feedback');
});
