import { uuid } from '../../../tracking/core.ts';
import type { EventFields } from '../../../tracking/core.ts';
import type { studioUsageEvents } from '../../../tracking/studio-events.ts';
import { trackEvent } from './client';

type StudioIoActionFields = EventFields<typeof studioUsageEvents.studio_io_action>;
export type StudioIoAction = StudioIoActionFields['action'];
export type StudioIoProperties = Omit<StudioIoActionFields, 'action' | 'attempt_id'>;
export type StudioIoResult = Omit<EventFields<typeof studioUsageEvents.studio_io_result>, 'action' | 'attempt_id'>;

/** Measure one manual I/O attempt; automatic reads and background updates do not call this helper. */
export function beginStudioIo(action: StudioIoAction, properties: StudioIoProperties = {}): (result: StudioIoResult) => void {
  let attemptId: string;
  try {
    attemptId = globalThis.crypto?.randomUUID?.();
    if (!attemptId || !uuid.test(attemptId)) return () => {};
  } catch {
    return () => {};
  }
  try {
    trackEvent('studio_io_action', { ...properties, action, attempt_id: attemptId });
  } catch { /* Measurement never changes the manual operation. */ }

  let finished = false;
  return result => {
    if (finished) return;
    finished = true;
    try {
      trackEvent('studio_io_result', { ...properties, ...result, action, attempt_id: attemptId });
    } catch { /* The business result remains available when measurement fails. */ }
  };
}
