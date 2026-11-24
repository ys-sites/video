// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { trackedRoot, cleanupMounted } from '../components/ui/mountHost.testHelpers';
import { useTimelineSessionLocks } from './useTimelineSessionLocks';
import type { TimelineElement } from '../player/store/timelineElement';
import { usePlayerStore } from '../player/store/playerStore';
import { useCompositionStack } from '../components/nle/useCompositionStack';

const clip: TimelineElement = { id: 'cue', domId: 'cue', tag: 'div', start: 0, duration: 1, track: 0 };
afterEach(() => { cleanupMounted(); document.body.innerHTML = ''; vi.restoreAllMocks(); usePlayerStore.getState().setElements([]); });
function mountHost(element: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host);
  const root = trackedRoot(host); act(() => root.render(element)); return { root };
}
function setup() {
  const iframe = document.createElement('iframe'); document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML = '<div id="cue" data-timeline-locked>Keep captions</div>';
  vi.spyOn(iframe.contentDocument!, 'URL', 'get').mockReturnValue('http://localhost/api/projects/p1/preview');
  const state = { projectId: 'p1', activeCompPath: 'index.html', elements: [clip], iframe, ready: true,
    save: vi.fn(async () => ({ status: 'saved' as const })) };
  function Probe() {
    usePlayerStore.getState().setElements(state.elements);
    useTimelineSessionLocks(state); return null;
  }
  return { state, Probe };
}
it('releases saved caption locks once per page even when discovery starts unlocked', async () => {
  const { state, Probe } = setup();
  const host = mountHost(<Probe />); await act(async () => {});
  expect(state.save).toHaveBeenCalledExactlyOnceWith([{ element: clip, value: null }], 'data-timeline-locked', 'Release previous session track locks');
  state.elements = [{ ...clip, timelineLocked: true }];
  await act(async () => host.root.render(<Probe />));
  expect(state.save).toHaveBeenCalledTimes(1);
});
it('waits for an editable ready document and releases again only in a new page', async () => {
  const { state, Probe } = setup(); state.ready = false;
  const host = mountHost(<Probe />); await act(async () => {});
  expect(state.save).not.toHaveBeenCalled();
  state.ready = true; await act(async () => host.root.render(<Probe />));
  expect(state.save).toHaveBeenCalledTimes(1);
  cleanupMounted(); mountHost(<Probe />); await act(async () => {});
  expect(state.save).toHaveBeenCalledTimes(2);
});
it('keeps a fresh page without saved locks read-only until the user locks a track', async () => {
  const { state, Probe } = setup(); state.iframe.contentDocument!.getElementById('cue')!.removeAttribute('data-timeline-locked');
  const host = mountHost(<Probe />); await act(async () => {});
  state.elements = [{ ...clip, timelineLocked: true }];
  state.iframe.contentDocument!.getElementById('cue')!.setAttribute('data-timeline-locked', '');
  await act(async () => host.root.render(<Probe />));
  expect(state.save).not.toHaveBeenCalled();
});

it('does not consume initialization for a document from another project', async () => {
  const { state, Probe } = setup();
  const url = vi.spyOn(state.iframe.contentDocument!, 'URL', 'get');
  url.mockReturnValue('http://localhost/api/projects/previous/preview');
  const host = mountHost(<Probe />);
  expect(state.save).not.toHaveBeenCalled();
  url.mockReturnValue('http://localhost/api/projects/p1/preview');
  state.elements = [{ ...clip }];
  await act(async () => host.root.render(<Probe />));
  expect(state.save).toHaveBeenCalledTimes(1);
});

it.each([false, true])('waits for destination discovery during real navigation (old lock: %s)', async (locked) => {
  const { state } = setup();
  const oldClip = { ...clip, timelineLocked: locked };
  const destinationClip = { ...clip, timelineLocked: true };
  const url = vi.spyOn(state.iframe.contentDocument!, 'URL', 'get');
  const current = { path: 'index.html' };
  function Stack() {
    useCompositionStack({ projectId: state.projectId, activeCompositionPath: current.path });
    return null;
  }
  function Probe() {
    const elements = usePlayerStore(s => s.elements);
    useTimelineSessionLocks({ ...state, activeCompPath: current.path, elements });
    return <Stack />;
  }
  const host = mountHost(<Probe />);
  if (!locked) state.iframe.contentDocument!.getElementById('cue')!.removeAttribute('data-timeline-locked');
  await act(async () => usePlayerStore.getState().setElements([oldClip]));
  state.save.mockClear();
  current.path = 'scenes/second.html';
  await act(async () => host.root.render(<Probe />));
  expect(state.save).not.toHaveBeenCalled();

  // Destination data arriving while the old document is still visible is also unsafe.
  await act(async () => usePlayerStore.getState().setElements([destinationClip]));
  expect(state.save).not.toHaveBeenCalled();
  url.mockReturnValue('http://localhost/api/projects/p1/preview/comp/scenes/second.html?_t=2');
  state.iframe.contentDocument!.getElementById('cue')!.setAttribute('data-timeline-locked', '');
  await act(async () => usePlayerStore.getState().setElements([{ ...destinationClip }]));
  expect(state.save).toHaveBeenCalledExactlyOnceWith([{ element: destinationClip, value: null }], 'data-timeline-locked', 'Release previous session track locks');
  // A newly applied lock survives subsequent rediscovery in this page.
  await act(async () => usePlayerStore.getState().setElements([{ ...destinationClip }]));
  expect(state.save).toHaveBeenCalledTimes(1);
});
