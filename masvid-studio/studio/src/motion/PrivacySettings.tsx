import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useRef, useState } from 'react';
import { trackStudioClick } from './editorTracking';
import { useI18n } from '../i18n/I18n';
import { motionApi } from './useWorkspace';
import { setMotionTrackingEnabled } from './tracking';
import { DiagnosticExport } from './DiagnosticExport';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { Toggle } from './settingsPrimitives';

type Status = { enabled: boolean; preference: boolean; locked: boolean; reason?: 'test_build' | 'environment' | null };
export function PrivacySettings({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const { t } = useI18n(), dialog = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!embedded) dialog.current?.showModal(); return () => dialog.current?.close(); }, [embedded]);
  useEffect(() => {
    const controller = new AbortController();
    void motionApi<Status>('/tracking/preferences', { signal: controller.signal }).then(setStatus)
      .catch(() => { if (!controller.signal.aborted) setError('Could not load privacy settings.'); });
    return () => controller.abort();
  }, []);
  async function change(enabled: boolean) {
    if (!enabled) setMotionTrackingEnabled(false);
    setBusy(true); setError('');
    try {
      const next = await motionApi<Status>('/tracking/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
      setStatus(next); setMotionTrackingEnabled(next.enabled);
      toast.showToast(t('Privacy settings saved'), 'info');
      // Reported after the saved preference applies, so turning sharing off sends nothing.
      trackStudioClick('project_drawer', 'usage_data_toggle', undefined, undefined, next.enabled ? 'on' : 'off');
    } catch { toast.showToast(t('Could not save privacy settings.'), 'error'); }
    finally { setBusy(false); }
  }
  const content = <><section className={embedded ? 'om-card om-card-stack' : undefined}><div className="om-settings-row"><label className="om-subtitle">{t('Share usage data')}</label><Toggle label={t('Share usage data')} checked={status?.enabled ?? false} disabled={!status || busy || status.locked} onChange={enabled => void change(enabled)} /></div>
      <p className="om-muted">{t('Send feature usage, error categories and approximate region to improve OpenMotion. Prompts and project contents are excluded.')}</p>
      <p className="om-muted">{t('This setting applies to MCP and Studio on this installation and is kept after restart.')}</p>
      {status?.locked && <p className="om-muted" role="status">{t(status.reason === 'test_build' ? 'Usage data collection is disabled in test builds.' : 'Disabled by your environment settings.')}</p>}
      {error && <p role="alert">{t(error)}</p>}
    </section><section className={embedded ? 'om-card om-card-stack' : undefined}><DiagnosticExport /></section><StudioToastViewport {...toast} /></>;
  if (embedded) return content;
  return <dialog ref={dialog} className="motion-model-dialog motion-media-surface motion-privacy-dialog" aria-labelledby="privacy-settings-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="privacy-settings-title">{t('Privacy settings')}</h2><IconButton variant="plain" className="motion-media-close" aria-label={t('Close')} onClick={onClose} icon="×" /></header>
    {content}
  </dialog>;
}
