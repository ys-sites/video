import { importValidationMessage } from '../i18n/importMessages';
import type { Translate } from '../i18n/I18n';

export type ManualImportStatus = 'pending' | 'imported' | 'failed' | 'unknown';
export interface ManualImportItem {
  id: string;
  name: string;
  status: ManualImportStatus;
  path?: string;
  reason?: string;
}
export interface ManualImportBatch {
  id: string;
  projectId: string;
  dir?: string;
  items: ManualImportItem[];
  paths: string[];
  busy: boolean;
  listing: 'ready' | 'loading' | 'failed';
  diagnostic?: string;
}
export interface ManualImportAttempt {
  batchId: string;
  itemIds: string[];
  action?: 'import_files' | 'replace_failed_import';
}
export interface UploadResponse {
  files?: string[];
  skipped?: string[];
  invalid?: { name: string; reason: string }[];
  unchecked?: { name: string; reason: string }[];
}
export const UNKNOWN_IMPORT_REASON = 'The upload result could not be confirmed. Check project assets before importing again.';

/** Only attribute a complete response to inputs when its per-file identities are unambiguous.
 * A fresh tree listing cannot identify a lost upload response, even by matching names. */
export function manualImportResults(files: File[], ids: string[], data: UploadResponse, t: Translate): ManualImportItem[] {
  const pending: ManualImportItem[] = files.map((file, index) => ({ id: ids[index], name: file.name, status: 'unknown', reason: t(UNKNOWN_IMPORT_REASON) }));
  const rejected = [...(data.invalid ?? []).map(entry => ({ ...entry, invalid: true })), ...(data.skipped ?? []).map(name => ({ name, reason: '', invalid: false }))];
  const paths = Array.isArray(data.files) ? data.files : [];
  if (rejected.length + paths.length !== files.length) return pending;
  const unmatched = new Set(files.map((_, index) => index));
  for (const entry of rejected) {
    const candidates = [...unmatched].filter(index => files[index].name === entry.name);
    // With one input, even a server-renamed rejection belongs to that input.
    const index = files.length === 1 ? 0 : candidates.length === 1 ? candidates[0] : undefined;
    if (index === undefined || / \(\d+\)(?:\.|$)/.test(entry.name) && files.length > 1) return pending;
    unmatched.delete(index);
    const reason = entry.invalid
      ? files[index].size === 0 ? t('This file is empty. Choose a file with content.') : importValidationMessage(entry.reason, t)
      : t('The server did not add this file. Check its size or choose another file.');
    pending[index] = { id: ids[index], name: files[index].name, status: 'failed', reason };
  }
  if (unmatched.size !== paths.length) return pending;
  [...unmatched].forEach((index, offset) => {
    const path = paths[offset];
    const name = path.split(/[\\/]/).pop();
    const unchecked = data.unchecked?.find(entry => entry.name === name);
    pending[index] = { id: ids[index], name: files[index].name, status: 'imported', path,
      reason: unchecked ? importValidationMessage(unchecked.reason, t) : undefined };
  });
  return pending;
}
