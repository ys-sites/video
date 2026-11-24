import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { TranscriptToolbar, type TranscriptView } from './TranscriptToolbar';
import { timedSegment, transcriptText, transcriptTimestamp, type TranscriptDocument, type TranscriptSegment, type TranscriptFormat } from '../../../shared/transcript';
import { useStudioShellContext, useStudioPlaybackContext } from '../contexts/StudioContext';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { projectMediaPath } from './timelineMediaSelection';
import { useFileManagerContext } from '../contexts/FileManagerContext';
import { usePlayerStore } from '../player/store/playerStore';
import { useI18n } from '../i18n/I18n';
import { Button } from 'open-design-ui/button';
import { Checkbox } from '../components/ui/Checkbox';
import { Select } from '../components/ui/Select';
import { Menu, MenuItem } from '../components/ui/Menu';
import { RemixIcon } from '../icons/RemixIcons';
import { buildProjectApiPath } from '../utils/projectRouting';
import { encodeUrlPath } from '@hyperframes/parsers';
import { transcriptRequest, downloadTranscript } from './transcriptClient';
import { gatewayRequest } from './gatewayClient';
import { useCaptionWorkspace } from './captionWorkspace';

const speechTextClass = 'inline-block h-auto max-w-full select-auto whitespace-normal rounded-sm text-left font-normal';

// Session-only drafts survive switching projects without becoming saved text.
const drafts = new Map<string, { revision: number; segments: TranscriptSegment[] }>();

export function TranscriptEditor({ document: doc, busy, setDocument, onDirty, onWorking, refresh, sourceBar, view: selectedView, onView, onImport }: {
  document: TranscriptDocument; busy: boolean; setDocument: (doc: TranscriptDocument) => void; onDirty: (dirty: boolean) => void; refresh: () => Promise<void>;
  onWorking?: (working: boolean) => void; sourceBar?: ReactNode; view?: TranscriptView; onView?: (view: TranscriptView) => void; onImport?: () => void;
}) {
  const { t } = useI18n(), shell = useStudioShellContext(), files = useFileManagerContext();
  const { timelineElements } = useStudioPlaybackContext();
  const selectedId = usePlayerStore(s => s.selectedElementId);
  const visible = useDockLayoutStore(s => s.visiblePanels.has('transcript'));
  const clip = timelineElements.find(element => (element.key ?? element.id) === selectedId || element.id === selectedId);
  const matchingClip = clip && ['audio', 'video'].includes(clip.tag) && clip.src && projectMediaPath(clip.src, clip.sourceFile) === doc.source.path
    && (!clip.sourceFile || clip.sourceFile === (shell.activeCompPath || 'index.html')) && !clip.parentCompositionStart && !clip.compositionSrc && !clip.automation ? clip : null;
  const [segments, setSegments] = useState(drafts.get(doc.id)?.segments ?? doc.segments), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const baseRevision = useRef(drafts.get(doc.id)?.revision ?? doc.revision);
  const observed = useRef(doc);
  const [working, setWorking] = useState(false), [format, setFormat] = useState<TranscriptFormat>('srt'), [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [mediaFailed, setMediaFailed] = useState(false);
  const [sourceStart, setSourceStart] = useState(0), [sourceEnd, setSourceEnd] = useState(doc.source.duration), [timelineStart, setTimelineStart] = useState(0), [rate, setRate] = useState(1);
  useEffect(() => {
    if (!matchingClip) return;
    const speed = matchingClip.playbackRate ?? 1, start = matchingClip.playbackStart ?? 0;
    setSourceStart(start); setSourceEnd(Math.min(doc.source.duration, start + matchingClip.duration * speed)); setTimelineStart(matchingClip.start); setRate(speed);
  }, [matchingClip?.id, matchingClip?.start, matchingClip?.duration, matchingClip?.playbackStart, matchingClip?.playbackRate]);
  const [manualCopy, setManualCopy] = useState(''), [exportPlacement, setExportPlacement] = useState(false);
  const [localView, setLocalView] = useState<TranscriptView>('segments'), [editing, setEditing] = useState(false), [pauses, setPauses] = useState(false);
  const view = selectedView ?? localView, setView = onView ?? setLocalView;
  const media = useRef<HTMLAudioElement>(null), alive = useRef(true), active = useRef(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const dirty = JSON.stringify(segments) !== JSON.stringify(doc.segments), disabled = busy || working;
  const state = useRef({ composition: shell.activeCompPath || 'index.html', blocked: Boolean(shell.writeBlockedReason) || shell.renderQueue.isRendering });
  state.current = { composition: shell.activeCompPath || 'index.html', blocked: Boolean(shell.writeBlockedReason) || shell.renderQueue.isRendering };
  useEffect(() => { alive.current = true; return () => { alive.current = false; media.current?.pause(); }; }, []);
  useEffect(() => { if (!visible) media.current?.pause(); }, [visible]);
  useEffect(() => { const pause = () => { if (document.hidden) media.current?.pause(); }; document.addEventListener('visibilitychange', pause); return () => document.removeEventListener('visibilitychange', pause); }, []);
  useEffect(() => { if (observed.current !== doc) { observed.current = doc; baseRevision.current = doc.revision; setSegments(doc.segments); } }, [doc]);
  useEffect(() => { if (dirty) drafts.set(doc.id, { revision: baseRevision.current, segments }); else drafts.delete(doc.id); }, [doc.id, dirty, segments]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onWorking?.(working); }, [working, onWorking]);
  useEffect(() => setPage(0), [query]);
  const matches = segments.filter(s => `${s.speaker ?? ''} ${s.text}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const shown = matches.slice(page * 40, (page + 1) * 40);
  const replace = (id: string, patch: Partial<TranscriptSegment>) => setSegments(rows => rows.map(s => s.id === id ? { ...s, ...patch, words: undefined } : s));
  const seek = (seconds: number) => { if (media.current && !mediaFailed) media.current.currentTime = seconds; setTime(seconds); };
  async function act(fn: () => Promise<void>) {
    if (active.current) return; active.current = true; setWorking(true);
    try { await fn(); } catch (error) { if (alive.current) shell.showToast(error instanceof Error ? t(error.message) : t('Transcript operation failed'), 'error'); }
    finally { active.current = false; if (alive.current) setWorking(false); }
  }
  function stableRequest(input: unknown) { const signature = JSON.stringify(input); if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() }; return request.current.id; }
  async function save() {
    const input = { command: 'update', projectId: doc.source.projectId, transcriptId: doc.id, expectedTranscriptRevision: baseRevision.current, segments };
    const result = await transcriptRequest<{ document: TranscriptDocument }>({ ...input, requestId: stableRequest(input) });
    if (alive.current) { setDocument(result.document); shell.showToast(t('Transcript saved'), 'info'); await refresh(); }
  }
  async function applyCaptions() {
    const compositionPath = shell.activeCompPath || 'index.html';
    if (!compositionPath || state.current.blocked) throw new Error('The timeline is currently unavailable for editing');
    await shell.waitForPendingDomEditSaves();
    if (!alive.current || state.current.composition !== compositionPath || state.current.blocked) throw new Error('The composition changed. Review caption placement again.');
    const detail = await gatewayRequest<{ revision: string; currentVersionId: string }>('phase1/call', 'POST', { name: 'openmotion_get_project', arguments: { projectId: doc.source.projectId } });
    if (!alive.current || state.current.composition !== compositionPath || state.current.blocked) throw new Error('The composition changed. Review caption placement again.');
    const input = { command: 'captions', projectId: doc.source.projectId, transcriptId: doc.id, expectedTranscriptRevision: doc.revision, compositionPath,
      timelineStart, sourceStart, sourceEnd, playbackRate: rate, expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId };
    await transcriptRequest({ ...input, requestId: stableRequest(input) });
    if (alive.current && state.current.composition === compositionPath && !state.current.blocked) { await files.refreshFileTree(); useCaptionWorkspace.getState().changed(); useCaptionWorkspace.getState().open(doc.source.projectId, { compositionPath, mode: 'style', trackId: doc.id, selectClip: true }); shell.showToast(t('Editable captions added. Review the composition preview.'), 'info'); }
  }
  function openStyles() { useCaptionWorkspace.getState().select(doc.source.projectId, doc.source.path, doc.id); useDockLayoutStore.getState().activatePanel('captions'); }
  function locate(seconds: number) { seek(seconds); usePlayerStore.getState().requestSeek(Math.max(0, timelineStart + (seconds - sourceStart) / rate)); }
  const numeric = (label: string, value: number, set: (v: number) => void, min = 0, max = 86400) => <label className="flex min-w-0 flex-col gap-1 text-step-11 text-text-3">{t(label)}<span className="om-field"><input aria-label={t(label)} type="number" min={min} max={max} step="0.01" value={Number.isFinite(value) ? value : ''} disabled={disabled} onChange={event => set(event.target.value === '' ? NaN : Number(event.target.value))} /></span></label>;
  const gaps = new Map<string, { start: number; duration: number }>();
  segments.forEach((segment, index) => {
    const previous = segments[index - 1];
    if (previous && timedSegment(previous) && timedSegment(segment) && segment.start - previous.end >= 0.5) gaps.set(segment.id, { start: previous.end, duration: segment.start - previous.end });
  });
  const pauseMarker = (id: string) => {
    const gap = pauses && gaps.get(id);
    return gap ? <Button size="sm" variant="ghost" className="my-1 text-text-3" aria-label={t('Pause: {seconds}s', { seconds: gap.duration.toFixed(1) })} onClick={() => locate(gap.start)}><RemixIcon name="time-line" size={12} />{t('{seconds}s pause', { seconds: gap.duration.toFixed(1) })}</Button> : null;
  };
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="transcript-editor">
    <TranscriptToolbar view={view} onView={setView} editing={editing} onEdit={() => setEditing(value => !value)} pauses={pauses} onPauses={gaps.size ? () => setPauses(value => !value) : undefined} onImport={disabled || dirty ? undefined : onImport} onStyles={dirty ? undefined : openStyles} busy={disabled} />
    {sourceBar}
    <audio ref={media} src={buildProjectApiPath(doc.source.projectId, `/preview/${encodeUrlPath(doc.source.path)}`)} preload="metadata" onTimeUpdate={() => setTime(media.current?.currentTime ?? 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setMediaFailed(true)} />
    <div className="@container shrink-0 border-b border-border">
      <div className="flex min-w-0 items-center gap-1 p-2">
        <Button variant="ghost" size="sm" disabled={mediaFailed} aria-label={t(playing ? 'Pause source' : 'Play source')} title={t(mediaFailed ? 'Source playback is unavailable. Check the imported media.' : playing ? 'Pause source' : 'Play source')} onClick={() => { if (!media.current) return; if (playing) media.current.pause(); else void media.current.play().catch(() => shell.showToast(t('Could not play the source audio'), 'error')); }}><RemixIcon name={playing ? 'pause-fill' : 'play-fill'} size={14} /></Button>
        <label className="om-field min-w-0 flex-1"><RemixIcon name="search-line" size={14} /><input aria-label={t('Search transcript')} placeholder={t('Search transcript')} value={query} onChange={e => setQuery(e.target.value)} /></label>
        <Button size="sm" variant={dirty ? 'primary' : 'ghost'} aria-label={t('Save transcript')} title={t(dirty ? 'Save transcript' : 'All changes saved')} disabled={disabled || !dirty} onClick={() => void act(save)}><RemixIcon name="check-line" size={14} /><span className="hidden @min-[520px]:inline">{t('Save transcript')}</span></Button>
        <Menu aria-label={t('Transcript actions')} trigger={<Button size="sm" variant="ghost" aria-label={t('More transcript actions')}><RemixIcon name="more-line" size={16} /></Button>}>
          <MenuItem disabled={disabled || !dirty} onClick={() => { baseRevision.current = doc.revision; setSegments(doc.segments); }}>{t('Discard changes')}</MenuItem>
          <MenuItem disabled={disabled} onClick={() => setSegments(doc.original)}>{t('Restore original text')}</MenuItem>
          <MenuItem disabled={disabled || dirty} onClick={() => void act(async () => { const result = await transcriptRequest<{ document: TranscriptDocument }>({ command: 'get', projectId: doc.source.projectId, transcriptId: doc.id }); if (alive.current) setDocument(result.document); })}>{t('Reload transcript')}</MenuItem>
        </Menu>
      </div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="transcript-reading-area" role="region" aria-label={t('Transcript text')} tabIndex={0}>
    <div className="flex flex-wrap items-center justify-between gap-1 text-step-11 text-text-3"><span>{t('{count} segments', { count: matches.length })}</span><span>{dirty ? t('Unsaved changes') : transcriptTimestamp(time, '.')}</span></div>
    {editing && <p className="text-step-11 leading-relaxed text-text-3">{t('Edit words and timing here. Source footage stays unchanged.')}</p>}
    {mediaFailed && <p role="alert" className="text-step-11 text-text-3">{t('Source playback is unavailable. Check the imported media.')}</p>}
    {!matches.length && <p className="m-auto py-8 text-center text-text-3">{t(segments.length ? 'No matching speech' : 'No speech detected')}</p>}
    {view === 'paragraph' && !editing ? <div className="leading-relaxed">{matches.map(segment => <Fragment key={segment.id}>{pauseMarker(segment.id)}<Button type="button" variant="ghost" className={`${speechTextClass} mr-1 px-0 align-baseline text-[length:inherit] leading-[inherit] text-text-1`} disabled={!timedSegment(segment)} onClick={() => locate(segment.start!)} aria-label={`${t('Go to speech')} ${timedSegment(segment) ? transcriptTimestamp(segment.start, '.') : ''}`}>{segment.text}</Button></Fragment>)}</div> : shown.map(segment => <Fragment key={segment.id}>{pauseMarker(segment.id)}<article className="flex flex-col gap-2 border-b border-border pb-3" aria-label={segment.id}>
      <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" size="sm" disabled={!timedSegment(segment)} aria-current={timedSegment(segment) && time >= segment.start && time < segment.end ? 'true' : undefined} onClick={() => locate(segment.start!)}>{timedSegment(segment) ? transcriptTimestamp(segment.start, '.') : t('No timing')}</Button><span className="text-step-11 text-text-3">{segment.speaker || (segment.words?.length ? t('{count} timed words', { count: segment.words.length }) : '')}</span></div>
      {editing ? <textarea className="om-field w-full resize-y text-step-12" rows={2} aria-label={t('Segment text')} disabled={disabled} value={segment.text} onChange={e => replace(segment.id, { text: e.target.value })} /> : <Button type="button" variant="ghost" className={`${speechTextClass} px-2 py-1 text-step-12 leading-relaxed text-inherit`} disabled={!timedSegment(segment)} onClick={() => locate(segment.start!)}>{segment.text}</Button>}
      {editing && <details><summary className="cursor-pointer text-step-11 text-text-3">{t('Timing and speaker')}</summary><div className="mt-2 flex flex-col gap-2"><label className="om-field"><input aria-label={t('Speaker')} placeholder={t('Speaker (optional)')} disabled={disabled} maxLength={100} value={segment.speaker ?? ''} onChange={e => replace(segment.id, { speaker: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-2">{numeric('Start (seconds)', segment.start ?? NaN, start => replace(segment.id, { start }), 0, doc.source.duration)}{numeric('End (seconds)', segment.end ?? NaN, end => replace(segment.id, { end }), 0, doc.source.duration)}</div>
      <Button size="sm" disabled={disabled} onClick={() => setSegments(rows => rows.filter(s => s.id !== segment.id))}>{t('Remove caption segment')}</Button></div></details>}
    </article></Fragment>)}
    {matches.length > 40 && (view !== 'paragraph' || editing) && <div className="flex gap-2"><Button size="sm" disabled={!page} onClick={() => setPage(value => value - 1)}>{t('Previous')}</Button><span>{page + 1}/{Math.ceil(matches.length / 40)}</span><Button size="sm" disabled={(page + 1) * 40 >= matches.length} onClick={() => setPage(value => value + 1)}>{t('Next')}</Button></div>}
    <details><summary className="cursor-pointer text-step-12">{t('Export captions or script')}</summary><div className="mt-3 flex flex-col gap-3"><div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled} onClick={() => void act(async () => { const text = transcriptText(segments); try { await navigator.clipboard.writeText(text); shell.showToast(t('Transcript copied'), 'info'); } catch { setManualCopy(text); shell.showToast(t('Could not copy. Select and copy the text manually.'), 'error'); } })}>{t('Copy text')}</Button><Select label={t('Transcript export format')} value={format} onCommit={v => setFormat(v as TranscriptFormat)} options={['txt', 'srt', 'vtt', 'json'].map(value => ({ value, label: value.toUpperCase() }))} /><Button size="sm" disabled={disabled || dirty} onClick={() => void act(async () => { const result = await transcriptRequest<{ content: string; mimeType: string; extension: string }>({ command: 'export', projectId: doc.source.projectId, transcriptId: doc.id, format, ...(exportPlacement && ['srt', 'vtt'].includes(format) ? { sourceStart, sourceEnd, timelineStart, playbackRate: rate } : {}) }); if (alive.current) { downloadTranscript(result.content, `${doc.source.path.split('/').pop()}-${doc.language ?? 'transcript'}.${result.extension}`, result.mimeType); shell.showToast(t('Transcript downloaded'), 'info'); } })}>{t('Download captions')}</Button></div>
    <div className="flex items-center gap-2 text-step-11 text-text-3"><Checkbox aria-label={t('Use caption placement for SRT/VTT')} checked={exportPlacement} onCheckedChange={setExportPlacement} disabled={disabled || !['srt', 'vtt'].includes(format)} /><span>{t('Use caption placement for SRT/VTT')}</span></div>
    {manualCopy && <textarea className="om-field w-full" readOnly aria-label={t('Transcript to copy')} value={manualCopy} onFocus={event => event.currentTarget.select()} />}
    </div></details>
    <details><summary className="cursor-pointer text-step-12">{t('Caption timing')}</summary><div className="mt-3 flex flex-col gap-3">
      <p className="text-step-11 text-text-3">{t('Align captions with a selected clip, or adjust the offset and speed below.')}</p>
      <Button size="sm" disabled={disabled || !matchingClip} onClick={() => { if (!matchingClip) return; const speed = matchingClip.playbackRate ?? 1, start = matchingClip.playbackStart ?? 0; setSourceStart(start); setSourceEnd(Math.min(doc.source.duration, start + matchingClip.duration * speed)); setTimelineStart(matchingClip.start); setRate(speed); }}>{t('Use selected media clip')}</Button>
      <div className="grid grid-cols-2 gap-2">{numeric('Source in (seconds)', sourceStart, setSourceStart, 0, doc.source.duration)}{numeric('Source out (seconds)', sourceEnd, setSourceEnd, 0, doc.source.duration)}{numeric('Timeline start (seconds)', timelineStart, setTimelineStart)}{numeric('Playback rate', rate, setRate, 0.1, 8)}</div>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled} onClick={() => setTimelineStart(usePlayerStore.getState().currentTime)}>{t('Use playhead')}</Button><Button size="sm" disabled={disabled || !Number.isFinite(sourceStart) || !Number.isFinite(rate) || rate <= 0} onClick={() => usePlayerStore.getState().requestSeek(Math.max(0, timelineStart + (time - sourceStart) / rate))}>{t('Locate in timeline')}</Button></div>

    </div></details>
    </div>
    <div className="flex shrink-0 flex-col gap-2 border-t border-border p-2">
      {segments.some(s => !timedSegment(s)) && <p className="px-1 text-step-11 text-text-3">{t('This model returned text without timestamps. Import timed subtitles or use a model with timestamp support.')}</p>}
      <Button variant="primary" size="sm" className="max-w-full" disabled={disabled || dirty || !segments.length || segments.some(s => !timedSegment(s))} title={dirty ? t('Save your edits before adding captions to the video.') : undefined} onClick={() => void act(applyCaptions)}><RemixIcon name="closed-captioning-line" size={16} /><span className="truncate">{t('Add captions to video')}</span></Button>
    </div>
  </div>;
}
