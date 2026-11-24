import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectoryModel } from '../../../shared/provider-directory';
import type { TranscriptDocument, TranscriptionJob } from '../../../shared/transcript';
import { useStudioShellContext } from '../contexts/StudioContext';
import { useFileManagerContext } from '../contexts/FileManagerContext';
import { useI18n } from '../i18n/I18n';
import { Button } from 'open-design-ui/button';
import { Select } from '../components/ui/Select';
import { Popover } from '../components/ui/Popover';
import { Menu, MenuItem } from '../components/ui/Menu';
import { TranscriptToolbar, type TranscriptView } from './TranscriptToolbar';
import { Skeleton } from '../components/ui/Skeleton';
import { useOptionalWorkspaceChrome } from './WorkspaceChromeContext';
import { transcriptRequest, type TranscriptList } from './transcriptClient';
import { RemixIcon } from '../icons/RemixIcons';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { usePlayerStore } from '../player/store/playerStore';
import { projectMediaPath } from './timelineMediaSelection';
import { TranscriptEditor } from './TranscriptEditor';
import { TranscriptWorkflowBrief } from './TranscriptWorkflowBrief';
import { useCaptionWorkspace } from './captionWorkspace';
import { useCaptionSurfaceActive } from './useCaptionSurfaceActive';

type Source = { path: string; sha256: string; bytes: number };
export function TranscriptPanel({ onAddToTimeline }: { onAddToTimeline?: (path: string) => unknown }) {
  const { projectId } = useStudioShellContext();
  return <TranscriptContent key={projectId} projectId={projectId} onAddToTimeline={onAddToTimeline} />;
}

function TranscriptContent({ projectId, onAddToTimeline }: { projectId: string; onAddToTimeline?: (path: string) => unknown }) {
  const { t } = useI18n(), shell = useStudioShellContext(), files = useFileManagerContext(), chrome = useOptionalWorkspaceChrome();
  const [sources, setSources] = useState<Source[]>([]), [source, setSource] = useState('');
  const [models, setModels] = useState<DirectoryModel[]>([]), [model, setModel] = useState(''), [language, setLanguage] = useState('auto');
  const [listing, setListing] = useState<TranscriptList>({ documents: [], jobs: [] }), [doc, setDoc] = useState<TranscriptDocument | null>(null);
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [brief, setBrief] = useState(false), [briefVisited, setBriefVisited] = useState(false), [view, setView] = useState<TranscriptView>('segments');
  const [settings, setSettings] = useState(false), [editorBusy, setEditorBusy] = useState(false);
  const selection = useCaptionWorkspace(s => s.selections[projectId]);
  const visible = useCaptionSurfaceActive('transcript');
  const epoch = useCaptionWorkspace(s => s.epoch);
  const selectedId = usePlayerStore(s => s.selectedElementId);
  const elements = usePlayerStore(s => s.elements);
  const selected = elements.find(e => (e.key ?? e.id) === selectedId);
  const selectedPath = selected?.src && ['audio', 'video'].includes(selected.tag) ? projectMediaPath(selected.src, selected.sourceFile) : null;
  const openedJob = useRef<string | null>(null);
  const alive = useRef(true), active = useRef(false), fileInput = useRef<HTMLInputElement>(null), subtitles = useRef<HTMLInputElement>(null);
  const error = useCallback((message: string) => shell.showToast(t(message), 'error'), [shell.showToast, t]);
  const submission = useRef<{ signature: string; requestId: string } | null>(null);
  const disabled = busy || editorBusy || Boolean(shell.writeBlockedReason) || shell.renderQueue.isRendering;
  const refresh = useCallback(async () => {
    const [media, catalog, list] = await Promise.all([
      transcriptRequest<{ sources: Source[] }>({ command: 'sources', projectId }),
      transcriptRequest<{ models: DirectoryModel[]; defaultModel: string | null }>({ command: 'models' }),
      transcriptRequest<TranscriptList>({ command: 'list', projectId }),
    ]);
    if (!alive.current) return;
    setSources(media.sources); setSource(old => media.sources.some(s => s.path === old) ? old : media.sources[0]?.path ?? '');
    setModels(catalog.models); setModel(old => catalog.models.some(m => m.id === old) ? old : catalog.defaultModel || catalog.models[0]?.id || '');
    setListing(list); setFailed(false); setLoading(false);
  }, [projectId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (visible) void refresh().catch(() => { if (alive.current) { setFailed(true); setLoading(false); } });
  }, [visible, refresh, epoch, files.fileTree, selection?.nonce]);
  useEffect(() => {
    const jobs = listing.jobs.filter(job => ['queued', 'running'].includes(job.state));
    if (!visible || !jobs.length) return;
    let cancelled = false, polling = false;
    const poll = async () => {
      if (polling || document.visibilityState === 'hidden') return;
      polling = true;
      try {
        const results = await Promise.all(jobs.map(job => transcriptRequest<{ job: TranscriptionJob }>({ command: 'status', projectId, jobId: job.id })));
        if (cancelled || !alive.current) return;
        const updates = new Map(results.map(result => [result.job.id, result.job]));
        setListing(previous => ({ ...previous, jobs: previous.jobs.map(job => updates.get(job.id) || job) }));
        if (results.some(result => !['queued', 'running'].includes(result.job.state))) useCaptionWorkspace.getState().changed();
      } catch { if (!cancelled && alive.current) setFailed(true); }
      finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [visible, listing.jobs, projectId]);
  async function act(fn: () => Promise<void>) {
    if (active.current) return; active.current = true; setBusy(true);
    try { await fn(); } catch (e) { if (alive.current) error(e instanceof Error ? e.message : 'Transcript operation failed'); }
    finally { active.current = false; if (alive.current) setBusy(false); }
  }
  async function open(id: string) {
    const result = await transcriptRequest<{ document: TranscriptDocument }>({ command: 'get', projectId, transcriptId: id });
    if (alive.current) { setDoc(result.document); setSource(result.document.source.path); setDirty(false); }
  }
  useEffect(() => {
    if (!visible || !selection || dirty) return;
    setSource(selection.sourcePath);
    if (selection.transcriptId && selection.transcriptId !== doc?.id) void act(() => open(selection.transcriptId!));
    else if (!selection.transcriptId) setDoc(null);
  }, [visible, selection?.nonce]);
  async function upload(selected: File[]) {
    await shell.waitForPendingDomEditSaves(); if (!alive.current) return;
    const added = await files.uploadProjectFiles(selected, 'assets');
    if (!alive.current) return;
    if (!added.length) throw new Error('No media was imported. Check the file and try again.');
    await refresh(); setSource(added[0]); setDoc(null); shell.showToast(t('Media ready to transcribe'), 'info');
  }
  useEffect(() => {
    if (visible && selectedPath && !dirty && !doc && sources.some(s => s.path === selectedPath)) setSource(selectedPath);
  }, [visible, selectedPath]);
  useEffect(() => {
    const finished = listing.jobs.find(j => j.source.path === source && j.transcriptId && j.state === 'completed');
    if (!finished || !visible || dirty || doc || openedJob.current === finished.id) return;
    openedJob.current = finished.id;
    void act(() => open(finished.transcriptId!));
  }, [listing, source, visible, dirty, doc]);
  const running = listing.jobs.find(j => j.source.path === source && ['queued', 'running'].includes(j.state));
  const latest = listing.jobs.find(j => j.source.path === source);
  const configured = models.some(m => m.id === model);
  const field = (label: string, control: React.ReactNode) => <div className="flex min-w-0 flex-col gap-1.5"><span className="text-step-11 font-medium text-text-2">{t(label)}</span>{control}</div>;
  async function submit() {
    if (!configured) { chrome?.openModelSettings(); return; }
    await act(async () => {
      const input = { command: 'submit', projectId, sourcePath: source, model, language };
      const signature = JSON.stringify(input); if (submission.current?.signature !== signature) submission.current = { signature, requestId: crypto.randomUUID() };
      await transcriptRequest({ ...input, requestId: submission.current.requestId }); submission.current = null; setSettings(false); await refresh();
      if (alive.current) shell.showToast(t('Transcription queued'), 'info');
    });
  }
  const openStyles = () => {
    if (source && doc) useCaptionWorkspace.getState().select(projectId, source, doc.id);
    useDockLayoutStore.getState().activatePanel('captions');
  };
  const importSubtitles = source && !disabled && !dirty ? () => subtitles.current?.click() : undefined;
  const sourceBar = <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5" aria-label={t('Transcript source')}>
    {source ? <Select className="h-ctl-sm min-w-0 flex-1 border-transparent bg-transparent" label={t('Source media')} value={source} disabled={disabled || dirty || Boolean(running)} options={sources.map(s => ({ value: s.path, label: s.path.split('/').pop()!, description: s.path }))} onCommit={value => { setSource(value); setDoc(null); }} />
      : <span className="min-w-0 flex-1 px-1 text-step-11 text-text-3">{t('No audio or video selected')}</span>}
    <Menu aria-label={t('Media actions')} trigger={<Button size="sm" variant="ghost" aria-label={t('Media actions')} title={t('Media actions')}><RemixIcon name="more-line" size={16} /></Button>}>
      <MenuItem disabled={disabled || dirty} onClick={() => fileInput.current?.click()}>{t('Import media')}</MenuItem>
      {onAddToTimeline && <MenuItem disabled={disabled || !source} onClick={() => void act(async () => { await shell.waitForPendingDomEditSaves(); if (alive.current) await onAddToTimeline(source); })}>{t('Add to timeline')}</MenuItem>}
      {doc && <MenuItem disabled={disabled || dirty} onClick={() => setDoc(null)}>{t('New transcript')}</MenuItem>}
      {listing.documents.filter(d => d.source.path === source).map(d => <MenuItem key={d.id} disabled={disabled || dirty || d.id === doc?.id} onClick={() => void act(() => open(d.id))}>{t('Open saved transcript')} · {d.language ?? t('Original')} · {new Date(d.createdAt).toLocaleString()}</MenuItem>)}
    </Menu>
  </div>;
  const recognitionSettings = <Popover open={settings} onOpenChange={setSettings} align="center" aria-label={t('Recognition settings')} className="w-72 max-w-[calc(100vw-2rem)]" trigger={<Button size="sm" variant="ghost" disabled={disabled || Boolean(running)}><RemixIcon name="equalizer-line" size={14} />{t('Recognition settings')}</Button>}>
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold text-text-1">{t('Recognition settings')}</h3>
      {field('Audio language', <Select label={t('Spoken language')} value={language} disabled={disabled} options={[['auto', 'Detect language'], ['zh', 'Chinese'], ['en', 'English'], ['ja', 'Japanese'], ['ko', 'Korean'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']].map(([value, label]) => ({ value, label: t(label) }))} onCommit={setLanguage} />)}
      {configured && field('Transcription model', <Select label={t('Transcription model')} value={model} disabled={disabled} options={models.map(m => ({ value: m.id, label: m.label, description: m.id }))} onCommit={setModel} />)}
      <Button size="sm" onClick={() => { setSettings(false); chrome?.openModelSettings(); }}>{t(configured ? 'Model settings' : 'Connect speech model')}</Button>
      <p className="text-step-11 leading-relaxed text-text-3">{t('Audio is sent to your selected provider. Provider charges may apply.')}</p>
    </div>
  </Popover>;
  return <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-step-12 text-text-1" aria-label={t('Transcript')} onKeyDown={event => event.stopPropagation()}>
    <input ref={fileInput} type="file" accept="audio/*,video/*" multiple hidden onChange={event => { const selected = Array.from(event.target.files ?? []); event.target.value = ''; if (selected.length && !dirty) void act(() => upload(selected)); }} />
    <input ref={subtitles} type="file" accept=".srt,.vtt" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file && !dirty && source) void act(async () => {
      if (file.size > 2_000_000) throw new Error('Subtitle file exceeds 2 MB');
      const result = await transcriptRequest<{ document: TranscriptDocument }>({ command: 'import', projectId, sourcePath: source, requestId: crypto.randomUUID(), subtitles: await file.text() });
      if (alive.current) { setDoc(result.document); await refresh(); }
    }); }} />
    {doc ? <TranscriptEditor key={doc.id} document={doc} busy={disabled} setDocument={setDoc} onDirty={setDirty} onWorking={setEditorBusy} refresh={refresh} sourceBar={sourceBar} view={view} onView={setView} onImport={importSubtitles} /> : <>
      <TranscriptToolbar view={view} onView={setView} onImport={importSubtitles} onStyles={openStyles} busy={disabled || loading} />
      {sourceBar}
      <div className="flex min-h-0 flex-1 overflow-y-auto" data-testid="transcript-reading-area">
        {loading ? <div className="flex w-full flex-col gap-4 p-4" aria-label={t('Loading transcript')}><Skeleton style={{ width: '65%', height: 16 }} /><Skeleton style={{ width: '100%', height: 64 }} /><Skeleton style={{ width: '85%', height: 64 }} /></div> : <div className="m-auto flex w-full max-w-80 flex-col items-center gap-3 px-5 py-8 text-center">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-hover text-text-3"><RemixIcon name={failed || latest?.state === 'failed' ? 'error-warning-line' : 'mic-line'} size={22} /></span>
          {failed ? <><h2 className="text-step-13 font-semibold">{t('Could not load transcripts')}</h2><Button size="sm" onClick={() => void act(refresh)}>{t('Retry')}</Button></> : running ? <>
            <h2 className="text-step-13 font-semibold" role="status">{t('Recognizing speech…')}</h2>
            <p className="text-step-12 leading-relaxed text-text-3">{t('You can keep editing while speech is transcribed.')}</p>
            <div className="om-progress w-full" role="progressbar" aria-label={t('Transcription progress')} aria-valuemin={0} aria-valuemax={Math.max(1, running.totalChunks)} aria-valuenow={running.completedChunks}><span style={{ transform: `scaleX(${running.completedChunks / Math.max(1, running.totalChunks)})` }} /></div>
            <Button size="sm" disabled={busy} onClick={() => void act(async () => { await transcriptRequest({ command: 'cancel', projectId, jobId: running.id }); await refresh(); })}>{t('Cancel transcription')}</Button>
          </> : !source ? <>
            <h2 className="text-step-13 font-semibold">{t('No speech to transcribe yet')}</h2>
            <p className="text-step-12 leading-relaxed text-text-3">{t('Import a video or audio file, or record a voiceover from the timeline.')}</p>
            <Button size="sm" disabled={disabled} onClick={() => fileInput.current?.click()}><RemixIcon name="add-line" size={14} />{t('Import audio / video')}</Button>
          </> : <>
            <h2 className="text-step-13 font-semibold">{t(latest?.state === 'failed' ? 'Transcription failed' : 'Ready to transcribe')}</h2>
            <p className="text-step-12 leading-relaxed text-text-3">{latest?.state === 'failed' ? latest.error : t('Turn speech into editable text, then style it as captions.')}</p>
            {configured ? <Button size="sm" variant="primary" disabled={disabled} onClick={() => void submit()}><RemixIcon name="sparkling-line" size={14} />{t('Transcribe')}</Button> : <Button size="sm" variant="primary" onClick={() => chrome?.openModelSettings()}>{t('Connect speech model')}</Button>}
            {!configured && <p className="text-step-11 leading-relaxed text-text-3">{t('Connect a speech model once, or import existing SRT / VTT subtitles above.')}</p>}
            {configured && recognitionSettings}
          </>}
        </div>}
      </div>
    </>}
    <div className="flex shrink-0 items-center border-t border-border px-2 py-1.5">
      <Popover open={brief} onOpenChange={open => { setBrief(open); if (open) setBriefVisited(true); }} side="top" align="start" aria-label={t('Translate or create versions')} keepMounted={briefVisited} className="flex max-h-[min(740px,85dvh)] w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0" trigger={<Button variant="ghost" size="sm" className="min-w-0 max-w-full" disabled={disabled || dirty}><RemixIcon name="global-line" size={14} /><span className="truncate">{t('Translate or create versions')}</span><RemixIcon name="arrow-right-s-line" size={14} /></Button>}>
        <TranscriptWorkflowBrief key={projectId} projectId={projectId} transcript={doc} sourcePaths={sources.map(s => s.path)} />
      </Popover>
    </div>
  </section>;
}
