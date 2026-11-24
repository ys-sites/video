import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectoryModel } from '../../../shared/provider-directory';
import type { TranscriptDocument, TranscriptionJob } from '../../../shared/transcript';
import { Button } from 'open-design-ui/button';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import { useStudioShellContext } from '../contexts/StudioContext';
import { useFileManagerContext } from '../contexts/FileManagerContext';
import { usePlayerStore } from '../player/store/playerStore';
import { useOptionalWorkspaceChrome } from './WorkspaceChromeContext';
import { useNativeCaptionWrite } from './useNativeCaptionWrite';
import { transcriptRequest } from './transcriptClient';
import { useCaptionWorkspace } from './captionWorkspace';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { useCaptionSurfaceActive } from './useCaptionSurfaceActive';
import { projectMediaPath } from './timelineMediaSelection';

export function AutoCaptionsPanel({ visible = true }: { visible?: boolean }) {
  const surfaceActive = useCaptionSurfaceActive('captions');
  const active = surfaceActive && visible;
  const epoch = useCaptionWorkspace(s => s.epoch);
  const { t } = useI18n(), shell = useStudioShellContext(), files = useFileManagerContext(), chrome = useOptionalWorkspaceChrome();
  const { write, disabled: writeDisabled } = useNativeCaptionWrite();
  const [sources, setSources] = useState<{ path: string }[]>([]), [source, setSource] = useState('');
  const [models, setModels] = useState<DirectoryModel[]>([]), [model, setModel] = useState(''), [language, setLanguage] = useState('auto');
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  const [job, setJob] = useState<TranscriptionJob | null>(null), [ready, setReady] = useState<TranscriptDocument | null>(null);
  const alive = useRef(true), working = useRef(false), mediaInput = useRef<HTMLInputElement>(null), subtitleInput = useRef<HTMLInputElement>(null);
  const submission = useRef<{ signature: string; id: string } | null>(null);
  const placement = useRef<{ sourceStart: number; sourceEnd: number; timelineStart: number; playbackRate: number } | null>(null);
  const anchor = useRef<string | null>(null);
  const selectedId = usePlayerStore(state => state.selectedElementId), elements = usePlayerStore(state => state.elements);
  const selected = elements.find(element => (element.key || element.id) === selectedId);
  const selectedPath = selected?.src && ['audio', 'video'].includes(selected.tag) ? projectMediaPath(selected.src, selected.sourceFile) : null;
  const running = job && ['queued', 'running'].includes(job.state);
  const disabled = writeDisabled || busy || Boolean(running);
  const refresh = useCallback(async () => {
    try {
      const [media, catalog] = await Promise.all([
        transcriptRequest<{ sources: { path: string }[] }>({ command: 'sources', projectId: shell.projectId }),
        transcriptRequest<{ models: DirectoryModel[]; defaultModel: string | null }>({ command: 'models' }),
      ]);
      if (!alive.current) return;
      setSources(media.sources); setSource(old => media.sources.some(item => item.path === old) ? old : media.sources.find(item => item.path === selectedPath)?.path || media.sources[0]?.path || '');
      setModels(catalog.models); setModel(old => catalog.models.some(item => item.id === old) ? old : catalog.defaultModel || catalog.models[0]?.id || '');
      setFailed(false);
    } catch { if (alive.current) setFailed(true); }
    finally { if (alive.current) setLoading(false); }
  }, [shell.projectId, selectedPath]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (active) void refresh(); }, [active, refresh, epoch, files.fileTree]);
  useEffect(() => { if (selectedPath && !disabled && sources.some(item => item.path === selectedPath)) { setSource(selectedPath); setReady(null); } }, [selectedPath, sources.length]);
  const act = async (fn: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true);
    try { await fn(); } catch (error) { if (alive.current) shell.showToast(t(error instanceof Error ? error.message : 'Transcript operation failed'), 'error'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const addReady = async (doc: TranscriptDocument) => {
    let range = placement.current || { sourceStart: 0, sourceEnd: doc.source.duration, timelineStart: 0, playbackRate: 1 };
    if (anchor.current) {
      const clip = usePlayerStore.getState().elements.find(element => (element.key || element.id) === anchor.current);
      if (!clip?.src || projectMediaPath(clip.src, clip.sourceFile) !== doc.source.path) {
        shell.showToast(t('The source clip changed. Review the transcript before adding captions.'), 'error'); return;
      }
      const start = clip.playbackStart || 0, rate = clip.playbackRate || 1;
      range = { sourceStart: start, sourceEnd: start + clip.duration * rate, timelineStart: clip.start, playbackRate: rate };
    }
    const ok = await write({ command: 'captions', transcriptId: doc.id, expectedTranscriptRevision: doc.revision, ...range, sourceEnd: Math.min(range.sourceEnd, doc.source.duration) });
    if (ok && alive.current) { setReady(null); useCaptionWorkspace.getState().select(shell.projectId, doc.source.path, doc.id); }
  };
  const addReadyRef = useRef(addReady); addReadyRef.current = addReady;
  useEffect(() => {
    if (!active || !job || !running) return;
    let cancelled = false, polling = false;
    const poll = async () => {
      if (polling || document.visibilityState === 'hidden') return; polling = true;
      try {
        const result = await transcriptRequest<{ job: TranscriptionJob }>({ command: 'status', projectId: shell.projectId, jobId: job.id });
        if (cancelled || !alive.current) return;
        if (result.job.state === 'completed' && result.job.transcriptId) {
          const { document: doc } = await transcriptRequest<{ document: TranscriptDocument }>({ command: 'get', projectId: shell.projectId, transcriptId: result.job.transcriptId });
          if (cancelled || !alive.current) return;
          setReady(doc); setJob(result.job); await addReadyRef.current(doc);
        } else { setJob(result.job); if (result.job.state === 'failed') shell.showToast(result.job.error || t('Transcription failed'), 'error'); }
      } catch { if (!cancelled) { setJob(null); shell.showToast(t('Could not check transcription. Open Transcript to recover the existing job.'), 'error'); } }
      finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, job?.id, Boolean(running)]);
  const submit = () => act(async () => {
    if (!model) { chrome?.openModelSettings(); return; }
    const clip = selectedPath === source && selected && (!selected.sourceFile || selected.sourceFile === (shell.activeCompPath || 'index.html')) && !selected.parentCompositionStart && !selected.automation ? selected : null;
    const start = clip?.playbackStart || 0, rate = clip?.playbackRate || 1;
    anchor.current = clip ? clip.key || clip.id : null;
    placement.current = { sourceStart: start, sourceEnd: clip ? start + clip.duration * rate : 86400, timelineStart: clip?.start ?? 0, playbackRate: rate };
    const input = { command: 'submit', projectId: shell.projectId, sourcePath: source, model, language };
    const signature = JSON.stringify(input);
    if (submission.current?.signature !== signature) submission.current = { signature, id: crypto.randomUUID() };
    const result = await transcriptRequest<{ job: TranscriptionJob }>({ ...input, requestId: submission.current.id });
    submission.current = null;
    if (alive.current) {
      setReady(null); setJob(result.job);
      if (result.job.state === 'completed' && result.job.transcriptId) {
        const { document: doc } = await transcriptRequest<{ document: TranscriptDocument }>({ command: 'get', projectId: shell.projectId, transcriptId: result.job.transcriptId });
        if (alive.current) { setReady(doc); await addReady(doc); }
      } else shell.showToast(t('Transcription queued'), 'info');
    }
  });
  return <div className="flex min-h-0 flex-1 flex-col" onKeyDown={event => event.stopPropagation()}>
    <input ref={mediaInput} hidden type="file" accept="audio/*,video/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void act(async () => {
      const paths = await files.uploadProjectFiles([file], 'assets'); if (!paths.length) throw new Error('No media was imported. Check the file and try again.');
      await refresh(); if (alive.current) { setSource(paths[0]); setReady(null); }
    }); }} />
    <input ref={subtitleInput} hidden type="file" accept=".srt,.vtt" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void act(async () => {
      if (file.size > 2_000_000) throw new Error('Subtitle file exceeds 2 MB');
      const subtitles = await file.text(); if (alive.current) await write({ command: 'caption_add', subtitles, timelineStart: usePlayerStore.getState().currentTime });
    }); }} />
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      {loading ? <Skeleton className="h-24 w-full" /> : failed ? <div role="alert" className="flex flex-col gap-2"><p>{t('Could not load transcripts')}</p><Button onClick={() => void refresh()}>{t('Retry')}</Button></div> : <>
        <label className="flex min-w-0 flex-col gap-2 text-step-11 text-text-2">{t('Source media')}
          <Select label={t('Source media')} value={source} disabled={disabled || !sources.length} options={sources.length ? sources.map(item => ({ value: item.path, label: item.path.split('/').pop()! })) : [{ value: '', label: t('Import audio / video') }]} onCommit={value => { setSource(value); setReady(null); setJob(null); }} />
        </label>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => mediaInput.current?.click()}>{t('Import audio / video')}</Button>
        <label className="flex min-w-0 flex-col gap-2 text-step-11 text-text-2">{t('Spoken language')}
          <Select label={t('Spoken language')} value={language} disabled={disabled} onCommit={setLanguage} options={[['auto', 'Detect language'], ['zh', 'Chinese'], ['en', 'English'], ['ja', 'Japanese'], ['ko', 'Korean'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']].map(([value, label]) => ({ value, label: t(label) }))} />
        </label>
        <p className="text-step-11 leading-relaxed text-text-3">{t('Recognize speech in video, voiceovers or music with vocals. Captions are placed on the timeline.')}</p>
        <details><summary className="cursor-pointer text-step-11 text-text-3">{t('Recognition settings')}</summary><div className="mt-2 flex flex-col gap-2">
          {!!models.length && <Select label={t('Transcription model')} value={model} disabled={disabled} options={models.map(item => ({ value: item.id, label: item.label }))} onCommit={setModel} />}
          <Button size="sm" disabled={disabled} onClick={() => chrome?.openModelSettings()}>{t(model ? 'Model settings' : 'Connect speech model')}</Button>
          <p className="text-step-11 text-text-3">{t('Audio is sent to your selected provider. Provider charges may apply.')}</p>
        </div></details>
      </>}
      {running && <div role="status" className="flex flex-col gap-2"><p>{t('Recognizing speech…')}</p><div className="om-progress" role="progressbar" aria-label={t('Transcription progress')} aria-valuemin={0} aria-valuemax={Math.max(1, job.totalChunks)} aria-valuenow={job.completedChunks}><span style={{ transform: `scaleX(${job.completedChunks / Math.max(1, job.totalChunks)})` }} /></div><Button size="sm" disabled={busy} onClick={() => void act(async () => { const result = await transcriptRequest<{ job: TranscriptionJob }>({ command: 'cancel', projectId: shell.projectId, jobId: job.id }); if (alive.current) setJob(result.job); })}>{t('Cancel transcription')}</Button></div>}
      {ready && <Button size="sm" variant="ghost" onClick={() => { useCaptionWorkspace.getState().select(shell.projectId, ready.source.path, ready.id); useDockLayoutStore.getState().activatePanel('transcript'); }}>{t('Edit transcript')}</Button>}
    </div>
    <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
      <Button variant="primary" disabled={disabled || loading || failed || !source} onClick={() => ready ? void addReady(ready) : void submit()}>{t(busy ? 'Working…' : ready ? 'Add captions to video' : model ? 'Generate captions' : 'Connect speech model')}</Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => subtitleInput.current?.click()}>{t('Import SRT / VTT')}</Button>
    </div>
  </div>;
}
