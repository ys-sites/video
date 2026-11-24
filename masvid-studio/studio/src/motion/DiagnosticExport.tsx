import { Button } from 'open-design-ui/button';
import * as tracking from './pageTracking';
import { useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { browserDiagnostics, nextDiagnosticRequest, recordBrowserDiagnostic } from './diagnostics';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { RemixIcon } from '../icons/RemixIcons';

export function DiagnosticExport() {
  const { t } = useI18n();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function download() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    const request = nextDiagnosticRequest(), start = performance.now();
    recordBrowserDiagnostic('activity_diagnostic_export', `request=${request} outcome=started`);
    let status = 0;
    try {
      const response = await fetch('/motion-api/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors: browserDiagnostics() }) });
      status = response.status;
      if (response.status === 429) throw new Error('Please wait 30 seconds before exporting diagnostics again.');
      if (!response.ok) throw new Error('Could not export diagnostics. Use the command line if Studio cannot connect.');
      const blob = await response.blob();
      recordBrowserDiagnostic('activity_diagnostic_export', `request=${request} outcome=archive_received status=${status} bytes=${blob.size} durationMs=${Math.round(performance.now() - start)}`);
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = response.headers.get('Content-Disposition')?.match(/filename="([\w.-]+\.zip)"/)?.[1] || 'openmotion-diagnostics.zip';
      try {
        document.body.append(link); link.click();
        toast.showToast('Download started. Check your browser downloads.', 'info', 'feedback');
        recordBrowserDiagnostic('activity_diagnostic_export', `request=${request} outcome=download_triggered durationMs=${Math.round(performance.now() - start)}`);
        tracking.reportDiagnosticExport('success', performance.now() - start);
      }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) {
      recordBrowserDiagnostic('diagnostic_export_failed', `request=${request} status=${status} durationMs=${Math.round(performance.now() - start)}`);
      tracking.reportDiagnosticExport(status === 429 ? 'rate_limited' : 'failure', performance.now() - start);
      toast.showToast(error instanceof Error && error.message === 'Please wait 30 seconds before exporting diagnostics again.'
      ? error.message : 'Could not export diagnostics. Use the command line if Studio cannot connect.', 'error', 'feedback'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="om-card-stack">
    <Button variant="ghost" className="om-button h-auto" type="button" onClick={() => { tracking.reportSettingsClick('diagnostics', 'export_diagnostics'); void download(); }} disabled={busy}><RemixIcon name="download-2-line" size={15} />{t(busy ? 'Preparing diagnostics…' : 'Export diagnostic ZIP')}</Button>
    <p className="om-muted">{t('Saves logs on your device with sensitive values redacted. No upload. Review the ZIP before sharing.')}</p>
    <StudioToastViewport {...toast} />
  </div>;
}
