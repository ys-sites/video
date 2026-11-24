import { useCallback, useSyncExternalStore } from 'react';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { Tooltip } from '../components/ui/Tooltip';
import { getStudioSaveSnapshot, subscribeStudioSaves } from '../utils/studioSaveState';
import { useWorkspaceChrome } from './WorkspaceFrame';

export function WorkspaceSaveStatus() {
  const { t, locale } = useI18n();
  const { workspace, saveState } = useWorkspaceChrome();
  const projectId = workspace.status?.projectId ?? null;
  const read = useCallback(() => getStudioSaveSnapshot(projectId), [projectId]);
  const snapshot = useSyncExternalStore(subscribeStudioSaves, read, read);
  const disconnected = Boolean(workspace.error && workspace.errorSource === 'connection');
  const failed = snapshot.failed || saveState === t('Needs attention');
  const saving = snapshot.pending > 0 || saveState === t('Saving…');
  const time = snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleTimeString(locale, { hour12: false }) : '';
  const label = failed ? t('Not saved') : disconnected ? t('Connection lost.') : saving ? t('Saving…') : saveState || (time ? t('Auto saved: {time}', { time }) : t('Auto save on'));
  const detail = failed ? t('Changes could not be saved. Resolve the error before continuing.')
    : disconnected ? t('Reconnecting…') : t('Changes save automatically. Pending edits are checked every 15 seconds.');
  return <Tooltip label={`${label}. ${detail}`} side="bottom">
    <span className="motion-autosave-status" role="status" aria-label={label} aria-live="polite" aria-atomic="true" data-state={failed || disconnected ? 'error' : saving ? 'saving' : 'saved'}>
      <RemixIcon name={failed || disconnected ? 'error-warning-line' : saving ? 'loader-4-line' : 'checkbox-circle-line'} size={14} />
      <span>{label}</span>
    </span>
  </Tooltip>;
}
