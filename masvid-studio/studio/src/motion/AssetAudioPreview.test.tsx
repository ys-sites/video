// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetPreview } from './AssetBrowser';
import { acquireAudioPreviewAnalyser } from '../components/nle/audioPreviewAnalyser';
import { usePlayerStore } from '../player/store/playerStore';
import type { LibraryAsset } from '../../../shared/asset-library';

vi.mock('../components/nle/audioPreviewAnalyser', () => ({ acquireAudioPreviewAnalyser: vi.fn(), AUDIO_PREVIEW_BARS: 81 }));
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
let host: HTMLDivElement, root: Root;
const read = vi.fn(), release = vi.fn(), resume = vi.fn(async () => {});
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const asset: LibraryAsset = { id: 'audio-asset', name: 'Audio', modality: 'audio', createdAt: 1, updatedAt: 1, currentVersionId: 'v1', versions: [
  { id: 'v1', createdAt: 1, source: 'upload', filename: 'audio.mp4', mimeType: 'audio/mp4', bytes: 1024, duration: 10, sha256: 'one', references: [] },
] };
beforeEach(() => {
  vi.clearAllMocks(); frames.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  read.mockReturnValue(new Float32Array(81).fill(0.5));
  vi.mocked(acquireAudioPreviewAnalyser).mockReturnValue({ read, release, resume });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  usePlayerStore.setState({ currentTime: 4, isPlaying: false });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); usePlayerStore.getState().reset(); });
async function render(modality = asset.modality, controls = true, versionId = 'v1', autoPlay = false) {
  await act(async () => root.render(<AssetPreview asset={{ ...asset, modality }} version={{ ...asset.versions[0], id: versionId }} controls={controls} autoPlay={autoPlay} />));
}
function frame() { act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16)); }); }

it('uses the selected audio element for the waveform and stops animation on pause or buffering', async () => {
  await render();
  const audio = host.querySelector('audio')!;
  expect(audio.controls).toBe(true);
  expect(audio.getAttribute('src')).toContain('/versions/v1/file');
  expect(acquireAudioPreviewAnalyser).toHaveBeenCalledWith(audio, expect.any(Function));
  expect(host.querySelectorAll('svg[role=img] rect')).toHaveLength(81);
  expect(frames.size).toBe(0);
  await act(async () => audio.dispatchEvent(new Event('playing')));
  frame();
  const bar = host.querySelector('svg[role=img] rect')!;
  expect(Number(bar.getAttribute('height'))).toBeGreaterThan(2);
  const height = bar.getAttribute('height');
  await act(async () => audio.dispatchEvent(new Event('pause')));
  expect(frames.size).toBe(0); expect(bar.getAttribute('height')).toBe(height);
  await act(async () => audio.dispatchEvent(new Event('playing')));
  await act(async () => audio.dispatchEvent(new Event('waiting')));
  expect(frames.size).toBe(0);
  expect(usePlayerStore.getState().currentTime).toBe(4);
  expect(usePlayerStore.getState().isPlaying).toBe(false);
  await render('audio', true, 'v2');
  expect(release).toHaveBeenCalledOnce();
  expect(host.querySelector('audio')?.getAttribute('src')).toContain('/versions/v2/file');
  await render('image');
  expect(release).toHaveBeenCalledTimes(2);
});

it('keeps native playback available if waveform analysis is unavailable', async () => {
  vi.mocked(acquireAudioPreviewAnalyser).mockImplementation(() => { throw new Error('Unavailable'); });
  await render();
  expect(host.querySelector('[role=status]')?.textContent).toContain('waveform unavailable');
  expect(host.querySelector('audio')?.controls).toBe(true);
});

it('does not analyse audio cards, video previews or image previews', async () => {
  await render('audio', false);
  expect(host.querySelector('audio')).toBeNull();
  expect(host.textContent).toContain('00:10');
  await render('video'); expect(host.querySelector('video')?.controls).toBe(true);
  await render('image'); expect(host.querySelector('img')).not.toBeNull();
  expect(acquireAudioPreviewAnalyser).not.toHaveBeenCalled();
});

it('opts into detail autoplay and pauses the previous player when changing versions or assets', async () => {
  await render('audio');
  expect(host.querySelector('audio')?.autoplay).toBe(false);
  await render('audio', true, 'v1', true);
  const audio = host.querySelector('audio')!;
  expect(audio.autoplay).toBe(true);
  const stopAudio = vi.spyOn(audio, 'pause');
  await render('audio', true, 'v2', true);
  expect(stopAudio).toHaveBeenCalledOnce();
  await render('video', true, 'v3', true);
  const video = host.querySelector('video')!;
  expect(video.autoplay).toBe(true);
  expect(video.hasAttribute('playsinline')).toBe(true);
  expect(video.controls).toBe(true);
  const stopVideo = vi.spyOn(video, 'pause');
  await render('image', true, 'v4');
  expect(stopVideo).toHaveBeenCalledOnce();
  expect(host.querySelector('audio, video')).toBeNull();
});
