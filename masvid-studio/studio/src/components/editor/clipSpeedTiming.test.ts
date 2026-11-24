// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { planClipSpeedTiming } from './clipSpeedTiming';
import type { TimelineElement } from '../../player/store/playerStore';
import { parseTimelineFromDOM } from '../../player/lib/timelineDOM';
import { readAttributeByTarget } from '../../utils/sourcePatcher';

const clip = (id: string, tag = 'video', start = 0, duration = 4, track = 0): TimelineElement =>
  ({ id, domId: id, tag, start, duration, track, sourceFile: 'index.html' });
const source = (els: TimelineElement[]) => `<div data-composition-id="main" data-duration="30">${els.map(el =>
  `<${el.tag} id="${el.id}" data-start="${el.start}" data-duration="${el.duration}" data-track-index="${el.track}"${el.timelineLocked ? ' data-timeline-locked' : ''}${el.playbackRate ? ` data-playback-rate="${el.playbackRate}"` : ''}></${el.tag}>`).join('')}</div>`;
const attr = (html: string, id: string, name: string) => Number(readAttributeByTarget(html, { id }, `data-${name}`));
const plan = (els: TimelineElement[], rate: number, ripple = false, linkage = false, keys = [els[0].id], html = source(els)) =>
  planClipSpeedTiming(html, els[0], els, new Set(keys), rate, ripple, linkage);

describe('constant clip speed timing', () => {
  it('allows unrelated implicit text without materializing its timing', () => {
    const html = '<div data-composition-id="main" data-duration="4"><video id="a" data-start="0" data-duration="4"></video><p id="title">Title</p></div>';
    const els = parseTimelineFromDOM(new DOMParser().parseFromString(html, 'text/html'), 4);
    expect(els.find(el => el.domId === 'title')?.implicitTextTiming).toBe(true);
    const self = els.find(el => el.domId === 'a')!;
    const next = planClipSpeedTiming(html, self, els, new Set([self.key ?? self.id]), 2, false, false).apply(html);
    expect(attr(next, 'a', 'duration')).toBe(2);
    expect(next).toContain('<p id="title">Title</p>');
  });
  it('skips an unrelated runtime-derived duration on another lane', () => {
    const els = [clip('a'), clip('overlay', 'img', 0, 4, 1)];
    const html = source(els).replace('id="overlay" data-start="0" data-duration="4"', 'id="overlay" data-start="0"');
    const next = plan(els, 2, false, false, ['a'], html).apply(html);
    expect(attr(next, 'a', 'duration')).toBe(2);
    expect(next).toContain('id="overlay" data-start="0" data-track-index="1"');
  });
  it.each(['member', 'neighbour'])('rejects unresolved timing on an affected %s', kind => {
    const els = [clip('a'), clip('next', 'video', 4)];
    const id = kind === 'member' ? 'a' : 'next';
    const html = source(els).replace(`id="${id}" data-start="${kind === 'member' ? 0 : 4}" data-duration="4"`, `id="${id}" data-start="${kind === 'member' ? 0 : 4}"`);
    expect(() => plan(els, 0.5, false, false, ['a'], html)).toThrow(/timing changed/);
  });
  it.each([[0.5, 8], [2, 2]])('updates a template composition root at %sx', (rate, duration) => {
    const els = [{ ...clip('a', 'audio'), sourceFile: 'compositions/scene.html' }];
    const html = '<template><section data-composition-id="scene" data-duration="4"><audio id="a" data-start="0" data-duration="4"></audio></section></template>';
    const next = plan(els, rate, false, false, ['a'], html).apply(html);
    expect(attr(next, 'a', 'duration')).toBe(duration);
    expect(next).toContain(`data-composition-id="scene" data-duration="${duration}"`);
    expect(next.startsWith('<template>')).toBe(true);
  });
  it.each(['video', 'audio'])('halves a %s clip and preserves its source in-point', tag => {
    const els = [clip('a', tag, 1.07, 15)];
    const html = source(els).replace('data-track-index="0"', 'data-track-index="0" data-media-start="2"');
    const next = plan(els, 2, false, false, ['a'], html).apply(html);
    expect(attr(next, 'a', 'duration')).toBe(7.5);
    expect(attr(next, 'a', 'start')).toBe(1.07);
    expect(attr(next, 'a', 'media-start')).toBe(2);
    expect(attr(next, 'a', 'playback-rate')).toBe(2);
  });
  it('uses the saved old rate and duration, so repeated and sequential edits preserve the range', () => {
    const els = [clip('a')];
    const first = plan(els, 2).apply(source(els));
    const second = plan(els, 2, false, false, ['a'], first).apply(first);
    expect(attr(second, 'a', 'duration')).toBe(2);
    expect(attr(plan(els, 0.5, false, false, ['a'], second).apply(second), 'a', 'duration')).toBe(8);
  });
  it('shifts following main clips by the duration difference, retaining gaps and linked overlays', () => {
    const els = [clip('a', 'video', 0, 4, 1), clip('b', 'video', 6, 4, 1), clip('title', 'div', 7, 1, 0)];
    const next = plan(els, 2, true, true).apply(source(els));
    expect(attr(next, 'b', 'start')).toBe(4);
    expect(attr(next, 'title', 'start')).toBe(5);
  });
  it('does not shift subsequent main clips when ripple is disabled', () => {
    const els = [clip('a'), clip('b', 'video', 4)];
    expect(attr(plan(els, 2).apply(source(els)), 'b', 'start')).toBe(4);
  });
  it('bounds an ordinary-track slowdown without pushing a neighbour', () => {
    const els = [clip('a', 'audio', 0, 3), clip('b', 'audio', 4, 2)];
    const p = plan(els, 0.5);
    expect(p.limited).toBe(true);
    const next = p.apply(source(els));
    expect(attr(next, 'a', 'duration')).toBe(4);
    expect(attr(next, 'b', 'start')).toBe(4);
  });
  it('retimes linked video and audio in one plan', () => {
    const els = [clip('a'), clip('audio', 'audio', 0, 4, 1)];
    const next = plan(els, 2, false, false, ['a', 'audio']).apply(source(els));
    expect(attr(next, 'a', 'duration')).toBe(2);
    expect(attr(next, 'audio', 'duration')).toBe(2);
  });
  it('keeps linked ranges aligned when one member has a shorter available gap', () => {
    const els = [clip('a', 'video', 0, 3), clip('audio', 'audio', 0, 3, 1), clip('next', 'audio', 4, 2, 1)];
    const next = plan(els, 0.5, false, false, ['a', 'audio']).apply(source(els));
    expect(attr(next, 'a', 'duration')).toBe(4);
    expect(attr(next, 'audio', 'duration')).toBe(4);
  });
  it('does not shorten the composition past authored content outside the current scope', () => {
    const els = [clip('a')], html = source(els).replace('</div>', '<div data-start="20" data-duration="5"></div></div>');
    expect(plan(els, 2, false, false, ['a'], html).apply(html)).toContain('data-duration="25"');
  });
  it.each(['partner', 'following'])('refuses the entire plan for a locked %s', kind => {
    const els = [clip('a'), { ...clip('b', kind === 'partner' ? 'audio' : 'video', kind === 'partner' ? 0 : 4), timelineLocked: true }];
    expect(() => plan(els, 2, true, false, kind === 'partner' ? ['a', 'b'] : ['a'])).toThrow(/locked|Unlock/);
  });
  it('checks fresh source locks before planning a write', () => {
    const els = [clip('a')], html = source(els).replace('data-start="0"', 'data-timeline-locked data-start="0"');
    expect(() => plan(els, 2, false, false, ['a'], html)).toThrow(/Unlock/);
  });
  it('keeps sub-composition writes in local time and leaves other source files alone', () => {
    const els = [{ ...clip('a', 'audio', 10), sourceFile: 'compositions/scene.html', parentCompositionStart: 10 },
      clip('elsewhere', 'video', 20)];
    const html = '<template><section data-composition-id="scene" data-duration="4"><audio id="a" data-start="0" data-duration="4"></audio></section></template>';
    const next = plan(els, 2, true, true, ['a'], html).apply(html);
    expect(attr(next, 'a', 'start')).toBe(0);
    expect(attr(next, 'a', 'duration')).toBe(2);
    expect(next).not.toContain('elsewhere');
  });
});
