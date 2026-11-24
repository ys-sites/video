// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useAssetUsageNavigation } from './useAssetUsageNavigation';
import { usePlayerStore } from '../../player/store/playerStore';
import { timelineClipFocusId } from '../../player/components/timelineNavigationIdentity';
import type { AssetUsage } from './assetUsage';
const shell = vi.hoisted(() => ({ current: null as null | { activeCompPath: string | null; setActiveCompPath: (path: string) => void } }));
vi.mock('../../contexts/StudioContext', () => ({ useStudioShellContextOptional: () => shell.current }));
let root: Root, host: HTMLDivElement;
const usage: AssetUsage = { asset: 'assets/voice.wav', clipId: 'voice', start: 8, end: 16, localStart: 3, compositionPath: 'parts/scene.html' };
function Test({ projectId = 'p' }: { projectId?: string }) { const { reveal } = useAssetUsageNavigation(projectId); return <button onClick={() => reveal(usage)}>Locate</button>; }
afterEach(() => { act(() => root.unmount()); host.remove(); shell.current = null; usePlayerStore.getState().reset(); vi.unstubAllGlobals(); });
it('waits for nested composition rows, then selects the audio and seeks in the destination clock', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const navigate = vi.fn(); shell.current = { activeCompPath: null, setActiveCompPath: navigate };
  await act(async () => root.render(<Test />));
  await act(async () => host.querySelector('button')!.click());
  expect(navigate).toHaveBeenCalledWith('parts/scene.html');
  expect(usePlayerStore.getState().requestedSeekTime).toBeNull();
  shell.current = { activeCompPath: 'parts/scene.html', setActiveCompPath: navigate };
  await act(async () => {
    usePlayerStore.getState().setElements([{ id: 'voice', key: 'parts/scene.html#voice', tag: 'audio', start: 0, duration: 20, track: 1, sourceFile: 'parts/scene.html', src: '../assets/voice.wav' }]);
    root.render(<Test />);
  });
  expect(usePlayerStore.getState().selectedElementId).toBe('parts/scene.html#voice');
  expect(usePlayerStore.getState().requestedSeekTime).toBe(3);
  expect(usePlayerStore.getState().timelineFocus?.id).toBe(timelineClipFocusId('parts/scene.html#voice'));
});
it('drops pending navigation on project change', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  shell.current = { activeCompPath: null, setActiveCompPath: vi.fn() };
  await act(async () => root.render(<Test />));
  await act(async () => host.querySelector('button')!.click());
  shell.current = { activeCompPath: 'parts/scene.html', setActiveCompPath: vi.fn() };
  await act(async () => { usePlayerStore.getState().setElements([{ id: 'voice', tag: 'audio', src: '../assets/voice.wav', sourceFile: 'parts/scene.html', start: 0, duration: 20, track: 1 }]); root.render(<Test projectId="q" />); });
  expect(usePlayerStore.getState().selectedElementId).toBeNull();
  expect(usePlayerStore.getState().requestedSeekTime).toBeNull();
});
