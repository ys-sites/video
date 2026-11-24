import { describe, expect, it } from 'vitest';
import { deriveAssetUsages } from './assetUsage';
import type { ClipManifestClip } from '../../player/lib/playbackTypes';
const clip = (patch: Partial<ClipManifestClip>): ClipManifestClip => ({ id: 'host', label: 'Host', start: 0, duration: 43, track: 0, kind: 'composition', tagName: 'div', compositionId: 'scene', parentCompositionId: null, compositionSrc: 'compositions/scene.html', assetUrl: null, ...patch });
describe('asset usage on the active timeline', () => {
  it('recognizes audio hidden inside a composition while its only visible row is the host', () => {
    const clips = [clip({}), clip({ id: 'original-audio', kind: 'audio', tagName: 'audio', compositionId: null, parentCompositionId: 'scene', compositionSrc: null, assetUrl: '/api/projects/p/preview/assets/lfs/original-audio.m4a' })];
    expect(deriveAssetUsages([], clips, 'p').get('assets/lfs/original-audio.m4a')).toEqual([expect.objectContaining({ start: 0, end: 43, clipId: 'original-audio', compositionPath: 'compositions/scene.html', localStart: 0 })]);
  });
  it('keeps separate uses, their clipped timeline intervals and local source positions', () => {
    const clips = [clip({ id: 'one', compositionId: 'one', start: 8, duration: 8, playbackStart: 3 }), clip({ id: 'two', compositionId: 'two', start: 25, duration: 5 }),
      clip({ id: 'voice1', parentCompositionId: 'one', compositionId: null, kind: 'audio', assetUrl: '/api/projects/p/preview/assets/voice.wav', start: 8, duration: 8 }),
      clip({ id: 'voice2', parentCompositionId: 'two', compositionId: null, kind: 'audio', assetUrl: '/api/projects/p/preview/assets/voice.wav', start: 26, duration: 3 })];
    expect(deriveAssetUsages([], clips, 'p').get('assets/voice.wav')).toMatchObject([{ start: 8, end: 16, localStart: 3 }, { start: 26, end: 29, localStart: 1 }]);
  });
  it('resolves file-relative media and uses live edited intervals without duplicating manifest rows', () => {
    const element = { id: 'audio', key: 'parts/scene.html#audio', tag: 'audio', track: 1, src: '../assets/voice.wav', sourceFile: 'parts/scene.html', start: 4, duration: 2 };
    const clips = [clip({ id: 'audio', kind: 'audio', compositionId: null, compositionSrc: null, assetUrl: '/api/projects/p/preview/assets/voice.wav', start: 0, duration: 7 })];
    expect(deriveAssetUsages([element], clips, 'p', 'parts/scene.html').get('assets/voice.wav')).toMatchObject([{ start: 4, end: 6, targetId: 'parts/scene.html#audio' }]);
  });
  it.each([
    { sourceFile: 'index.html', nestedAsset: 'nested.wav' },
    { sourceFile: undefined, nestedAsset: 'nested.wav' },
    { sourceFile: 'index.html', nestedAsset: 'root.wav' },
    { sourceFile: undefined, nestedAsset: 'root.wav' },
  ])('keeps repeated media ids in their own composition ($sourceFile, $nestedAsset)', ({ sourceFile, nestedAsset }) => {
    const root = { id: 'audio', key: 'index.html#audio', tag: 'audio', track: 1, src: 'assets/root.wav', sourceFile, start: 2, duration: 4 };
    const host = { id: 'host', key: 'index.html#host', tag: 'div', track: 0, kind: 'composition' as const, compositionSrc: 'compositions/scene.html', sourceFile: 'index.html', start: 10, duration: 10 };
    const clips = [
      clip({ start: 10, duration: 10, playbackStart: 5, playbackRate: 2 }),
      clip({ id: 'audio', kind: 'audio', compositionId: null, compositionSrc: null, assetUrl: '/api/projects/p/preview/assets/root.wav', start: 0, duration: 7 }),
      clip({ id: 'audio', kind: 'audio', compositionId: null, compositionSrc: null, parentCompositionId: 'scene', assetUrl: `/api/projects/p/preview/assets/${nestedAsset}`, start: 12, duration: 3 }),
    ];
    const usages = deriveAssetUsages([root, host], clips, 'p');
    const rootUsage = { start: 2, end: 6, compositionPath: 'index.html', localStart: 2, targetId: 'index.html#audio' };
    const nestedUsage = { start: 12, end: 15, compositionPath: 'compositions/scene.html', localStart: 9, targetId: 'index.html#host' };
    if (nestedAsset === 'root.wav') {
      expect(usages.get('assets/root.wav')).toMatchObject([rootUsage, nestedUsage]);
    } else {
      expect(usages.get('assets/root.wav')).toMatchObject([rootUsage]);
      expect(usages.get('assets/nested.wav')).toMatchObject([nestedUsage]);
    }
  });
  it('does not match other projects or external URLs with the same basename', () => {
    const clips = [clip({ kind: 'audio', assetUrl: '/api/projects/other/preview/assets/voice.wav' }), clip({ id: 'external', kind: 'audio', assetUrl: 'https://example.com/assets/voice.wav' })];
    expect(deriveAssetUsages([], clips, 'p').has('assets/voice.wav')).toBe(false);
  });
});

it('uses the hydrated source path when the runtime manifest omits compositionSrc', () => {
  const host = { id: 'host', key: 'index.html#root', tag: 'div', kind: 'composition' as const, compositionSrc: 'compositions/scene.html', start: 0, duration: 43, track: 0, sourceFile: 'index.html' };
  const clips = [clip({ compositionSrc: null }), clip({ id: 'voice', kind: 'audio', compositionId: null, compositionSrc: null, parentCompositionId: 'scene', assetUrl: '/api/projects/p/preview/assets/voice.wav' })];
  expect(deriveAssetUsages([host], clips, 'p').get('assets/voice.wav')?.[0]).toMatchObject({ compositionPath: 'compositions/scene.html', targetId: 'index.html#root' });
});

it('converts a used interval into the trimmed and sped-up source clock without using file duration', () => {
  const clips = [clip({ start: 10, duration: 10, playbackRate: 2, playbackStart: 5 }), clip({ id: 'voice', kind: 'audio', compositionId: null, parentCompositionId: 'scene', compositionSrc: null, assetUrl: '/api/projects/p/preview/assets/voice.wav', start: 12, duration: 3 })];
  expect(deriveAssetUsages([], clips, 'p').get('assets/voice.wav')?.[0]).toMatchObject({ start: 12, end: 15, localStart: 9 });
});
