import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ScenarioBriefField } from '../../../shared/scenarios';
import type { BriefSaveRef, ScenarioRunApi } from './stepContract';

const AUTOSAVE_DELAY_MS = 800;
type BriefValues = Record<string, string | string[]>;

export function cleanBriefForSave(fields: readonly ScenarioBriefField[], values: BriefValues): BriefValues {
  const cleaned: BriefValues = {};
  for (const field of fields) {
    const value = values[field.id];
    if (field.kind === 'list' || field.kind === 'multi') {
      cleaned[field.id] = Array.isArray(value) ? value.map(item => item.trim()).filter(Boolean) : [];
    } else {
      cleaned[field.id] = typeof value === 'string' ? value : '';
    }
  }
  return cleaned;
}

export function useBriefAutosave(
  fields: readonly ScenarioBriefField[],
  mutate: ScenarioRunApi['mutate'],
  dirtyFields: RefObject<Set<string>>,
  latestValues: RefObject<BriefValues>,
  briefSaveRef?: BriefSaveRef,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Promise<string | undefined> | null>(null);
  const flushBrief = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current) return pending.current;
    if (!dirtyFields.current.size) return Promise.resolve(undefined);

    const save = async () => {
      let savedRunId: string | undefined;
      while (dirtyFields.current.size) {
        const dirty = fields.filter(field => dirtyFields.current.has(field.id));
        if (!dirty.length) break;
        const patch = cleanBriefForSave(dirty, latestValues.current);
        const result = await mutate('brief-autosave', 'update_brief', { brief: patch });
        savedRunId = result?.run?.id ?? savedRunId;
        const current = cleanBriefForSave(dirty, latestValues.current);
        for (const { id } of dirty) {
          if (JSON.stringify(current[id]) === JSON.stringify(patch[id])) dirtyFields.current.delete(id);
        }
      }
      return savedRunId;
    };
    pending.current = save().finally(() => { pending.current = null; });
    return pending.current;
  }, [dirtyFields, fields, latestValues, mutate]);

  const flushInBackground = useCallback(() => {
    void flushBrief().catch(() => {
      // Keep failed edits dirty so the next save can retry them.
    });
  }, [flushBrief]);

  const scheduleAutosave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flushInBackground, AUTOSAVE_DELAY_MS);
  }, [flushInBackground]);

  useEffect(() => {
    if (!briefSaveRef) return;
    briefSaveRef.current = () => pending.current || (dirtyFields.current.size ? flushBrief() : undefined);
    return () => { briefSaveRef.current = null; };
  }, [briefSaveRef, dirtyFields, flushBrief]);

  const flushInBackgroundRef = useRef(flushInBackground);
  flushInBackgroundRef.current = flushInBackground;
  useEffect(() => () => flushInBackgroundRef.current(), []);

  return { flushBrief, flushInBackground, scheduleAutosave };
}
