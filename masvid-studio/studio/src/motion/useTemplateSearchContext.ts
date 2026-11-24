import { useRef } from 'react';

const IDLE_MS = 30 * 60 * 1000;
type State = { open: boolean; key: string; libraryViewId?: string; discoveryId?: string; resultSetId?: string; lastActivity: number };

/** IDs describe rendered discovery contexts, not user tasks, accounts or adoption. */
export function useTemplateSearchContext(open: boolean, ready: boolean, key: string, searching: boolean) {
  const state = useRef<State>({ open: false, key: '', lastActivity: 0 });
  if (!open) state.current.open = false;
  if (open && !state.current.open) state.current = { open: true, key: '', libraryViewId: crypto.randomUUID(), lastActivity: Date.now() };
  if (open && ready && key !== state.current.key) {
    const now = Date.now();
    if (now - state.current.lastActivity >= IDLE_MS) state.current.discoveryId = undefined;
    if (searching && !state.current.discoveryId) state.current.discoveryId = crypto.randomUUID();
    Object.assign(state.current, { key, resultSetId: crypto.randomUUID(), lastActivity: now });
  }
  return {
    activity: () => {
      const now = Date.now();
      const idle = now - state.current.lastActivity >= IDLE_MS;
      if (!state.current.discoveryId || idle) state.current.discoveryId = crypto.randomUUID();
      if (idle) state.current.resultSetId = crypto.randomUUID();
      state.current.lastActivity = now;
    },
    read: () => ({ libraryViewId: state.current.libraryViewId, discoveryId: state.current.discoveryId, resultSetId: state.current.resultSetId }),
  };
}
