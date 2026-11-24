/** Confirmed file writes and native history, scoped to each open project. No polling or source copies. */
export interface StudioSaveSnapshot {
  pending: number;
  savedAt: number | null;
  failed: boolean;
}
const EMPTY: StudioSaveSnapshot = { pending: 0, savedAt: null, failed: false };
const projects = new Map<string, { snapshot: StudioSaveSnapshot; failures: Set<string> }>();
const listeners = new Set<() => void>();
export const subscribeStudioSaves = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getStudioSaveSnapshot = (projectId: string | null) => projects.get(projectId ?? '')?.snapshot ?? EMPTY;
function update(projectId: string, change: (state: { snapshot: StudioSaveSnapshot; failures: Set<string> }) => void) {
  const state = projects.get(projectId) ?? { snapshot: EMPTY, failures: new Set<string>() };
  const before = state.snapshot;
  change(state);
  projects.set(projectId, state);
  if (before !== state.snapshot) for (const listener of listeners) listener();
}
export function observeStudioSavedAt(projectId: string, savedAt: number) {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return;
  update(projectId, state => {
    if (savedAt > (state.snapshot.savedAt ?? 0)) state.snapshot = { ...state.snapshot, savedAt };
  });
}
export function clearStudioSaveFailures(projectId: string) {
  update(projectId, state => {
    state.failures.clear();
    if (state.snapshot.failed) state.snapshot = { ...state.snapshot, failed: false };
  });
}
export async function trackStudioProjectSave<T>(projectId: string, path: string, save: () => Promise<T>): Promise<T> {
  update(projectId, state => { state.snapshot = { ...state.snapshot, pending: state.snapshot.pending + 1 }; });
  try {
    const result = await save();
    update(projectId, state => {
      state.failures.delete(path);
      state.snapshot = { pending: state.snapshot.pending - 1, savedAt: Date.now(), failed: state.failures.size > 0 };
    });
    return result;
  } catch (error) {
    update(projectId, state => {
      state.failures.add(path);
      state.snapshot = { ...state.snapshot, pending: state.snapshot.pending - 1, failed: true };
    });
    throw error;
  }
}
