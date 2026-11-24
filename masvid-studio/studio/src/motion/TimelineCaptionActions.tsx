import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { Popover } from '../components/ui/Popover';
import { IconButton } from 'open-design-ui/icon-button';
import { Tooltip } from '../components/ui/Tooltip';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useStudioShellContext } from '../contexts/StudioContext';
import { useFileManagerContext } from '../contexts/FileManagerContext';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { usePlayerStore } from '../player/store/playerStore';
import { useTranscriptRecorder } from './useTranscriptRecorder';
import { downloadTranscript, transcriptRequest } from './transcriptClient';
import { useCaptionWorkspace } from './captionWorkspace';
import { useOptionalWorkspaceChrome } from './WorkspaceChromeContext';
import type { DirectoryModel } from '../../../shared/provider-directory';

export function TimelineCaptionActions({ onAddToTimeline }: { onAddToTimeline: (path: string) => Promise<boolean> }) {
  const { projectId } = useStudioShellContext();
  return <RecordingActions key={projectId} onAddToTimeline={onAddToTimeline} />;
}
function RecordingActions({ onAddToTimeline }: { onAddToTimeline: (path: string) => Promise<boolean> }) {
  const { t } = useI18n(), shell = useStudioShellContext(), files = useFileManagerContext(), chrome = useOptionalWorkspaceChrome();
  const error = useCallback((message: string) => shell.showToast(t(message), 'error'), [shell.showToast, t]);
  const recorder = useTranscriptRecorder(error, shell.projectId);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [url, setUrl] = useState(''), [playing, setPlaying] = useState(false);
  const musicInput = useRef<HTMLInputElement>(null);
  const media = useRef<HTMLAudioElement>(null), alive = useRef(true), locked = useRef(false);
  const imported = useRef<{ file: File; path: string } | null>(null);
  const adopted = useRef<File | null>(null), submission = useRef<{ file: File; id: string } | null>(null);
  const [model, setModel] = useState(''), [modelLabel, setModelLabel] = useState('');
  const current = useRef(shell); current.current = shell;
  const disabled = Boolean(shell.writeBlockedReason) || shell.renderQueue.isRendering;
  const capturing = recorder.state !== 'idle';
  useEffect(() => { alive.current = true; return () => { alive.current = false; media.current?.pause(); }; }, []);
  useEffect(() => {
    if (!recorder.file) { setUrl(''); return; }
    const next = URL.createObjectURL(recorder.file); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [recorder.file]);
  useEffect(() => { if (!open) media.current?.pause(); }, [open]);
  useEffect(() => { if (!open) return; let cancelled = false; void transcriptRequest<{ models: DirectoryModel[]; defaultModel: string | null }>({ command: 'models' }).then(result => { if (cancelled) return; const selected = result.models.find(m => m.id === result.defaultModel) || result.models[0]; setModel(selected?.id || ''); setModelLabel(selected?.label || ''); }).catch(() => { if (!cancelled) setModel(''); }); return () => { cancelled = true; }; }, [open]);
  async function add(transcribe = false) {
    if (!recorder.file || locked.current || disabled) return;
    if (transcribe && !model) { chrome?.openModelSettings(); return; }
    const file = recorder.file, composition = shell.activeCompPath;
    locked.current = true; setBusy(true); media.current?.pause();
    const valid = () => alive.current && current.current.activeCompPath === composition && !current.current.writeBlockedReason && !current.current.renderQueue.isRendering;
    try {
      await shell.waitForPendingDomEditSaves(); if (!valid()) return;
      if (imported.current?.file !== file) {
        const paths = await files.uploadProjectFiles([file], 'assets');
        if (!paths.length) throw new Error('No media was imported. Check the file and try again.');
        imported.current = { file, path: paths[0] };
      }
      if (!valid()) throw new Error('The composition changed. Add the recording again when ready.');
      if (adopted.current !== file) {
        if (!await onAddToTimeline(imported.current.path)) return;
        adopted.current = file;
      }
      if (!valid()) return;
      if (transcribe) {
        if (submission.current?.file !== file) submission.current = { file, id: crypto.randomUUID() };
        await transcriptRequest({ command: 'submit', projectId: shell.projectId, sourcePath: imported.current.path, model, language: 'auto', requestId: submission.current.id });
        if (!valid()) return;
        useCaptionWorkspace.getState().select(shell.projectId, imported.current.path);
        useDockLayoutStore.getState().activatePanel('transcript');
      }
      if (alive.current) {
        recorder.clear(); imported.current = null; setOpen(false);
        adopted.current = null; submission.current = null;
        shell.showToast(t(transcribe ? 'Recording added. Transcription started.' : 'Recording added to the timeline'), 'info');
      }
    } catch (e) { if (alive.current) error(e instanceof Error ? e.message : 'Recording failed'); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="motion-timeline-caption-actions flex shrink-0 items-center gap-1 border-l border-transparent pl-2 ml-1">
    <input ref={musicInput} type="file" accept="audio/*" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file || locked.current || disabled) return;
      locked.current = true; setBusy(true); const composition = shell.activeCompPath;
      void (async () => { try {
        await shell.waitForPendingDomEditSaves(); if (!alive.current || current.current.activeCompPath !== composition) return;
        const paths = await files.uploadProjectFiles([file], 'assets');
        if (!paths.length) throw new Error('No media was imported. Check the file and try again.');
        if (alive.current && current.current.activeCompPath === composition && !current.current.writeBlockedReason && !current.current.renderQueue.isRendering && await onAddToTimeline(paths[0])) shell.showToast(t('Music added to the timeline'), 'info');
      } catch (e) { if (alive.current) error(e instanceof Error ? e.message : 'Could not add music'); }
      finally { locked.current = false; if (alive.current) setBusy(false); } })();
    }} />
    <Tooltip label={t('Manual captions')}><IconButton size="md" variant="ghost" aria-label={t('Manual captions')} disabled={disabled} icon={<RemixIcon name="text" size={16} />} onClick={() => useCaptionWorkspace.getState().open(shell.projectId, { compositionPath: shell.activeCompPath || 'index.html', mode: 'manual' })} /></Tooltip>
    <Tooltip label={t('Add music')}><IconButton size="md" variant="ghost" aria-label={t('Add music')} disabled={disabled || busy || capturing} icon={<RemixIcon name="music-2-line" size={16} />} onClick={() => musicInput.current?.click()} /></Tooltip>
    <Popover side="top" align="start" open={open} onOpenChange={value => { if (!capturing && !busy) setOpen(value); }} tooltip={t(capturing ? 'Recording…' : 'Record voiceover')} aria-label={t('Record voiceover')} trigger={<IconButton size="md" variant={capturing ? 'primary' : 'ghost'} disabled={disabled && !capturing} aria-label={t('Record voiceover')} aria-pressed={capturing} icon={<RemixIcon name="mic-line" size={16} />} />}>
      <div className="flex w-64 max-w-[calc(100vw-3rem)] flex-col gap-3" onKeyDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2"><RemixIcon name="mic-line" size={18} /><h2 className="text-step-14 font-semibold">{t('Record voiceover')}</h2></div>
        <p className="text-step-11 text-text-3">{t('Record, listen back, then add it at the playhead. Your recording stays local.')}</p>
        {capturing ? <>
          <span className="text-step-18 font-mono text-center" role="status">{recorder.state === 'recording' ? `${Math.floor(recorder.seconds / 60).toString().padStart(2, '0')}:${(recorder.seconds % 60).toString().padStart(2, '0')}` : t(recorder.state === 'encoding' ? 'Preparing recording…' : 'Waiting for microphone…')}</span>
          <Button variant="primary" disabled={recorder.state === 'encoding'} onClick={recorder.stop}>{t(recorder.state === 'requesting' ? 'Cancel microphone request' : 'Stop recording')}</Button>
        </> : recorder.file ? <>
          <audio ref={media} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
          <Button size="sm" disabled={busy} onClick={() => { if (playing) media.current?.pause(); else void media.current?.play().catch(() => error('Could not play the source audio')); }}><RemixIcon name={playing ? 'pause-fill' : 'play-fill'} size={16} />{t(playing ? 'Pause recording' : 'Listen to recording')}</Button>
          <Button variant="primary" disabled={busy || disabled} onClick={() => void add(true)}>{t(busy ? 'Adding recording…' : model ? 'Add and transcribe' : 'Connect speech model')}</Button>
          {model && <p className="text-step-11 text-text-3">{modelLabel} · {t('Audio is sent to your selected provider. Provider charges may apply.')}</p>}
          <Button size="sm" disabled={busy || disabled} onClick={() => void add()}>{t('Add recording at playhead')}</Button>
          <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => { media.current?.pause(); recorder.clear(); }}>{t('Record again')}</Button><Button variant="ghost" size="sm" onClick={() => downloadTranscript(recorder.file!, recorder.file!.name, recorder.file!.type)}>{t('Download recording')}</Button></div>
        </> : <Button variant="primary" disabled={disabled} onClick={() => { usePlayerStore.getState().setIsPlaying(false); void recorder.start(); }}>{t('Start recording')}</Button>}
      </div>
    </Popover>
    <Tooltip label={t('Open transcript')}><IconButton aria-label={t('Open transcript')} onClick={() => useDockLayoutStore.getState().activatePanel('transcript')} icon={<RemixIcon name="file-text-line" size={16} />} /></Tooltip>
  </div>;
}
