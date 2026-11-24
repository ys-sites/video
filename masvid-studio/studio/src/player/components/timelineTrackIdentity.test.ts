import { expect, it } from 'vitest';
import { trackIdentities } from './timelineTrackIdentity';
import type { TimelineElement } from '../store/timelineElement';
it('numbers each media kind independently and keeps identifiers stable when rows are reordered', () => {
  const tracks = new Map([[3, [{ tag: 'audio' }]], [1, [{ tag: 'video' }]], [8, [{ tag: 'div', id: 'transcript-11111111-1111-4111-8111-111111111111-a' }]], [5, [{ tag: 'audio' }]], [7, [{ tag: 'p', text: 'title' }]]]) as Map<number, TimelineElement[]>;
  const ids = trackIdentities([8, 7, 5, 3, 1], tracks);
  expect([...ids.values()].map(value => value.code)).toEqual(['V1', 'A1', 'A2', 'T1', 'C1']);
  expect(trackIdentities([1, 3, 5, 7, 8], tracks)).toEqual(ids);
});

it('marks the actual main visual track independently of import order and video numbering', () => {
  const clip = (id: string, track: number, tag = 'video', timelineRole?: 'text' | 'caption'): TimelineElement =>
    ({ id, tag, track, start: 0, duration: 3, timelineRole });
  const tracks = new Map([
    [1, [clip('first-import', 1)]],
    [4, [clip('main', 4)]],
    [7, [clip('title', 7, 'div', 'text')]],
    [8, [clip('sound', 8, 'audio')]],
  ]);
  const ids = trackIdentities([8, 7, 4, 1], tracks);
  expect(ids.get(1)).toMatchObject({ code: 'V1', isMain: false });
  expect(ids.get(4)).toMatchObject({ code: 'V2', isMain: true });
  expect([...ids.values()].filter(id => id.isMain)).toHaveLength(1);
  tracks.delete(4);
  expect(trackIdentities([1, 7, 8], tracks).get(1)?.isMain).toBe(true);
});
