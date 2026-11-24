import { StudioSaveHttpError } from './studioSaveDiagnostics';

/** Known pre-write refusals are distinct from writes whose result cannot be confirmed. */
export class TimelineMediaActionError extends Error {
  constructor(readonly outcome: 'failed' | 'project-changed' | 'unconfirmed', readonly alreadyToasted = false, message = `Timeline media action: ${outcome}`) {
    super(message);
  }
}

export function timelineMediaActionOutcome(error: unknown): TimelineMediaActionError['outcome'] {
  if (error instanceof TimelineMediaActionError) return error.outcome;
  // A rejected write is known not to have landed; transport errors and 5xx responses
  // may follow a committed write. Do not invite a second insertion in those cases.
  if (error instanceof StudioSaveHttpError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408) return 'failed';
  return 'unconfirmed';
}
