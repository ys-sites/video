// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountHost, cleanupMounted } from '../../components/ui/mountHost.testHelpers';
import { TimelineEditProvider } from '../../contexts/TimelineEditContext';
import { TimelineTrackControls } from './TimelineTrackControls';
import { TimelineReadOnlyContext } from './timelineReadOnly';
import type { TimelineElement } from '../store/timelineElement';

vi.mock('../lib/mediaProbe', () => ({ probeMediaUrl: async () => null }));
afterEach(cleanupMounted);
const clip: TimelineElement = { id: 'first', domId: 'first', tag: 'video', start: 0, duration: 3, track: 0.5, hasAudio: true };
function render(elements = [clip], readOnly = false) {
  const save = vi.fn(async () => ({ status: 'saved' as const }));
  const remove = vi.fn(async () => {});
  const hide = vi.fn();
  const host = mountHost(<TimelineReadOnlyContext.Provider value={readOnly ? () => {} : null}>
    <TimelineEditProvider value={{ onSetElementsAttributeQuiet: save, onDeleteTrack: remove }}>
      <TimelineTrackControls elements={elements} track={0.5} number={2} label="First" hidden={false} audioOnly={false} toggleHidden={hide}
        identity={{ kind: 'V', code: 'V1', label: 'Video track', isMain: true }} />
    </TimelineEditProvider>
  </TimelineReadOnlyContext.Provider>);
  const click = async (label: string) => act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
  return { host, save, remove, hide, click };
}
it('uses icons with accessible names and sends track actions to the real fractional key', async () => {
  const c = render();
  expect(c.host.textContent).not.toContain('First');
  const badge = c.host.querySelector('[data-main-track]');
  expect(badge?.textContent).toBe('V1');
  expect(badge?.getAttribute('aria-label')).toBe('V1 · Video track');
  await c.click('Hide track 2'); expect(c.hide).toHaveBeenCalledWith(0.5, true, 2);
  await c.click('Mute audio · Track 2'); expect(c.save).toHaveBeenCalledWith([{ element: clip, value: 'true' }], 'muted', 'Mute audio');
  await c.click('Lock track · Track 2'); expect(c.save).toHaveBeenCalledWith([{ element: clip, value: '' }], 'data-timeline-locked', 'Lock track');
  await c.click('Delete track · Track 2'); expect(c.remove).toHaveBeenCalledExactlyOnceWith(0.5);
});
it('allows unlocking but prevents deletion of a locked track', async () => {
  const locked = { ...clip, timelineLocked: true };
  const c = render([locked]);
  await c.click('Delete track · Track 2'); expect(c.remove).not.toHaveBeenCalled();
  await c.click('Unlock track · Track 2'); expect(c.save).toHaveBeenCalledWith([{ element: locked, value: null }], 'data-timeline-locked', 'Unlock track');
});
it('does not expose working edit controls in read-only timelines', async () => {
  const c = render([clip], true);
  await c.click('Delete track · Track 2'); await c.click('Lock track · Track 2'); await c.click('Hide track 2');
  expect(c.remove).not.toHaveBeenCalled(); expect(c.save).not.toHaveBeenCalled(); expect(c.hide).not.toHaveBeenCalled();
});
