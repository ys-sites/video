import { useEffect, useRef, useState } from 'react';
import { useStudioShellContext } from '../../contexts/StudioContext';
import { useI18n } from '../../i18n/I18n';
import { useToast } from '../../hooks/useToast';
import { transcriptRequest, downloadTranscript } from '../../motion/transcriptClient';
import type { CaptionTrack } from '../../../../shared/transcript-captions';
import { useDockLayoutStore } from '../dock/dockLayoutStore';
import { RemixIcon } from '../../icons/RemixIcons';
import { Button } from 'open-design-ui/button';
import { Select } from '../ui/Select';
import { ChoiceTiles } from '../ui/ChoiceTiles';
import { Skeleton } from '../ui/Skeleton';
import { StudioToastViewport } from '../StudioToastViewport';
import { ExportCompositionSelect } from './ExportCompositionSelect';

export function CaptionExportPanel({ onClose }: { onClose: () => void }) {
  const shell = useStudioShellContext();
  return <CaptionExportContent key={`${shell.projectId}:${shell.activeCompPath}`} onClose={onClose} />;
}
function CaptionExportContent({ onClose }: { onClose: () => void }) {
  const shell = useStudioShellContext(), { t } = useI18n(), toast = useToast();
  const [composition, setComposition] = useState(shell.activeCompPath || 'index.html');
  const [tracks, setTracks] = useState<CaptionTrack[]>([]), [selected, select] = useState('all');
  const [format, setFormat] = useState<'srt' | 'vtt'>('srt');
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const alive = useRef(true), inFlight = useRef(false), latest = useRef(shell); latest.current = shell;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true); setFailed(false); setTracks([]); select('all');
    void (async () => {
      try {
        await shell.waitForPendingDomEditSaves();
        if (cancelled) return;
        const result = await transcriptRequest<{ tracks: CaptionTrack[] }>({ command: 'caption_tracks', projectId: shell.projectId, compositionPath: composition });
        if (!cancelled) setTracks(result.tracks.filter(track => track.settings.visible));
      } catch { if (!cancelled) setFailed(true); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [shell.projectId, composition, retry]);
  const captions = tracks.filter(track => track.kind === 'caption');
  const count = (selected === 'all' ? captions : tracks.filter(track => track.id === selected)).reduce((total, track) => total + track.cueCount, 0);
  async function download() {
    if (inFlight.current || !count || loading || failed || latest.current.writeBlockedReason) return;
    inFlight.current = true; setBusy(true);
    try {
      await shell.waitForPendingDomEditSaves();
      if (!alive.current || latest.current.projectId !== shell.projectId || latest.current.writeBlockedReason) return;
      const result = await transcriptRequest<{ content: string; mimeType: string; extension: string }>({ command: 'caption_export', projectId: shell.projectId, compositionPath: composition, format, ...(selected === 'all' ? {} : { transcriptId: selected }) });
      if (!alive.current || latest.current.projectId !== shell.projectId) return;
      downloadTranscript(result.content, `${composition.split('/').pop()!.replace(/\.html$/, '')}-captions.${result.extension}`, result.mimeType);
      toast.showToast(t('Subtitle download started'), 'info', 'feedback');
    } catch (error) { if (alive.current) toast.showToast(t(error instanceof Error ? error.message : 'Could not export captions'), 'error', 'feedback'); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  return <div data-testid="caption-export-panel" className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <ExportCompositionSelect value={composition} onChange={setComposition} disabled={busy} />
      <div className="flex flex-col gap-3 px-3 pb-3">
        {loading ? <Skeleton className="h-32 w-full" /> : failed ? <div className="flex items-center justify-between gap-2 text-step-12"><span>{t('Could not load captions')}</span><Button onClick={() => setRetry(n => n + 1)}>{t('Retry')}</Button></div> : tracks.length ? <>
          <div className="om-handoff-summary"><RemixIcon name="closed-captioning-line" size={20} /><span className="text-step-12">{t('{count} caption cues', { count })}</span></div>
          {(tracks.length > 1 || !captions.length) && <Select label={t('Caption track')} value={selected} disabled={busy} options={[{ value: 'all', label: t('All visible captions'), disabled: !captions.length }, ...tracks.map((track, index) => ({ value: track.id, label: `${track.kind === 'text' ? 'T' : 'C'}${index + 1} · ${t(track.label)}`, description: t('{count} caption cues', { count: track.cueCount }) }))]} onCommit={select} />}
          <ChoiceTiles label={t('Subtitle format')} value={format} disabled={busy} className="grid grid-cols-2 gap-2" onChange={setFormat} options={['srt', 'vtt'].map(value => ({ value: value as 'srt' | 'vtt', label: value.toUpperCase(), icon: <RemixIcon name="file-text-line" size={20} /> }))} />
          <p className="text-step-11 text-text-3">{t('Uses the text and timing on your timeline.')}</p>
        </> : <div className="flex flex-col items-center gap-3 py-6 text-center"><RemixIcon name="closed-captioning-line" size={24} className="text-text-4" /><span className="text-step-12">{t('No visible captions to export')}</span><Button onClick={() => { onClose(); useDockLayoutStore.getState().activatePanel('captions'); }}>{t('Add captions')}</Button></div>}
      </div>
    </div>
    <div className="shrink-0 border-t border-border p-3"><Button className="w-full" variant="primary" size="lg" icon={<RemixIcon name="download-2-line" size={16} />} disabled={loading || failed || !count || Boolean(shell.writeBlockedReason)} loading={busy} onClick={() => void download()}>{t('Download {format}', { format: format.toUpperCase() })}</Button></div>
    <StudioToastViewport {...toast} />
  </div>;
}
