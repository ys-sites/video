import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CAPTION_SETTINGS, type CaptionSettings } from '../../../shared/caption-style';
import type { TranscriptDocument } from '../../../shared/transcript';
import { Button } from 'open-design-ui/button';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { Checkbox } from '../components/ui/Checkbox';
import { AutoCaptionsPanel } from './AutoCaptionsPanel';
import { ManualTextPanel } from './ManualTextPanel';
import { CaptionAppearance } from './CaptionAppearance';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useStudioShellContext, useStudioPlaybackContext } from '../contexts/StudioContext';
import { useFileManagerContext } from '../contexts/FileManagerContext';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { usePlayerStore } from '../player/store/playerStore';
import { projectMediaPath } from './timelineMediaSelection';
import { belongsToCaptionTrack, captionTrackCode, captionTrackText, useCaptionWorkspace } from './captionWorkspace';
import { useCaptionTracks } from './useCaptionTracks';
import { useCaptionSurfaceActive } from './useCaptionSurfaceActive';
import { transcriptRequest, type TranscriptList } from './transcriptClient';
import { gatewayRequest } from './gatewayClient';

export function CaptionsPanel() {
  const { projectId, activeCompPath } = useStudioShellContext();
  return <CaptionControls key={`${projectId}:${activeCompPath}`} />;
}
function CaptionControls() {
  const { t } = useI18n(), shell = useStudioShellContext(), files = useFileManagerContext();
  const visible = useCaptionSurfaceActive('captions');
  const { timelineElements, refreshKey } = useStudioPlaybackContext();
  const { tracks, loading, failed, refresh, change, disabled } = useCaptionTracks(visible, refreshKey);
  const selection = useCaptionWorkspace(s => s.selections[shell.projectId]);
  const request = useCaptionWorkspace(s => s.requests[shell.projectId]);
  const appliedRequest = useRef(0), pendingTrack = useRef<string | undefined>(undefined), pendingClip = useRef<string | undefined>(undefined);
  const epoch = useCaptionWorkspace(s => s.epoch);
  const [mode, setMode] = useState<'auto' | 'manual' | 'style'>('auto');
  const initialMode = useRef(false);
  const chooseMode = (next: typeof mode) => {
    // A newer user action supersedes selection waiting for a created clip to load.
    pendingClip.current = undefined;
    initialMode.current = true;
    setMode(next);
  };
  const [documents, setDocuments] = useState<TranscriptList['documents']>([]), [source, setSource] = useState(''), [target, setTarget] = useState('');
  const [settings, setSettings] = useState<CaptionSettings>(DEFAULT_CAPTION_SETTINGS), [working, setWorking] = useState(false), [listFailed, setListFailed] = useState(false);
  const alive = useRef(true), active = useRef(false), latest = useRef(shell); latest.current = shell;
  const current = tracks.find(track => track.id === target), doc = documents.find(doc => doc.id === (current?.id || source));
  const [placement, setPlacement] = useState({ sourceStart: 0, sourceEnd: 0, timelineStart: 0, playbackRate: 1 });
  const selectedId = usePlayerStore(s => s.selectedElementId);
  const selected = timelineElements.find(el => (el.key || el.id) === selectedId);
  const blocked = disabled || working;
  const appearance = current?.settings || settings;
  const selectedTrackId = selected && (!selected.sourceFile || selected.sourceFile === (shell.activeCompPath || 'index.html'))
    ? tracks.find(track => belongsToCaptionTrack(selected, track.id))?.id : undefined;
  const updateAppearance = (patch: Partial<CaptionSettings>) => {
    if (blocked || current?.locked) return;
    if (current) void change(current.id, patch);
    else setSettings(value => ({ ...value, ...patch }));
  };
  const loadDocuments = async () => {
    try { const list = await transcriptRequest<TranscriptList>({ command: 'list', projectId: shell.projectId }); if (alive.current) { setDocuments(list.documents); setListFailed(false); setSource(value => list.documents.some(doc => doc.id === value) ? value : list.documents.find(doc => doc.id === selection?.transcriptId)?.id || list.documents[0]?.id || ''); } }
    catch { if (alive.current) setListFailed(true); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (visible) void loadDocuments(); }, [visible, epoch]);
  useEffect(() => {
    if (tracks.some(track => track.id === pendingTrack.current)) pendingTrack.current = undefined;
    if (!loading && !failed && !pendingTrack.current && target !== 'new' && !tracks.some(track => track.id === target)) setTarget(tracks[0]?.id || 'new');
  }, [loading, failed, tracks, target]);
  useEffect(() => { if (visible && selection?.transcriptId) { setMode('style'); setSource(selection.transcriptId); setTarget(tracks.some(track => track.id === selection.transcriptId) ? selection.transcriptId : 'new'); } }, [visible, selection?.nonce]);
  useEffect(() => { if (current) { setSettings(current.settings); setSource(current.id); } }, [target, current?.id]);
  useEffect(() => { if (visible && selectedTrackId && !pendingClip.current) { setMode('style'); setTarget(selectedTrackId); } }, [visible, selectedTrackId]);
  useEffect(() => {
    if (!visible || !request || request.compositionPath !== (shell.activeCompPath || 'index.html') || appliedRequest.current === request.nonce) return;
    appliedRequest.current = request.nonce; initialMode.current = true;
    pendingTrack.current = request.trackId;
    pendingClip.current = request.selectClip ? request.trackId : undefined;
    setMode(request.mode);
    if (request.trackId) setTarget(request.trackId);
  }, [visible, request, shell.activeCompPath]);
  useEffect(() => {
    if (!visible || !pendingClip.current) return;
    const clip = timelineElements.find(element => (!element.sourceFile || element.sourceFile === (shell.activeCompPath || 'index.html')) && belongsToCaptionTrack(element, pendingClip.current!));
    if (clip) { pendingClip.current = undefined; usePlayerStore.getState().setSelectedElementId(clip.key || clip.id); }
  }, [visible, request, timelineElements, shell.activeCompPath]);
  useEffect(() => {
    if (!doc) return;
    const clip = selected && ['audio', 'video'].includes(selected.tag) && selected.src && projectMediaPath(selected.src, selected.sourceFile) === doc.source.path && (!selected.sourceFile || selected.sourceFile === (shell.activeCompPath || 'index.html')) && !selected.parentCompositionStart && !selected.automation ? selected : null;
    const start = clip?.playbackStart || 0, rate = clip?.playbackRate || 1;
    setPlacement({ sourceStart: start, sourceEnd: Math.min(doc.source.duration, clip ? start + clip.duration * rate : doc.source.duration), timelineStart: clip?.start || 0, playbackRate: rate });
  }, [source, doc?.source.duration, selected?.id]);
  const goTranscript = () => { if (doc) useCaptionWorkspace.getState().select(shell.projectId, doc.source.path, doc.id); useDockLayoutStore.getState().activatePanel('transcript'); };
  const editableClip = current && (selectedTrackId === current.id ? selected : timelineElements.find(element => (!element.sourceFile || element.sourceFile === (shell.activeCompPath || 'index.html')) && belongsToCaptionTrack(element, current.id)));
  const editText = () => { if (editableClip) { usePlayerStore.getState().setSelectedElementId(editableClip.key || editableClip.id); useDockLayoutStore.getState().activatePanel('design'); } };
  async function apply() {
    if (active.current || blocked) return;
    if (current) return;
    if (!source) return;
    active.current = true; setWorking(true);
    const projectId = shell.projectId, compositionPath = shell.activeCompPath || 'index.html';
    const valid = () => alive.current && latest.current.projectId === projectId && (latest.current.activeCompPath || 'index.html') === compositionPath && !latest.current.writeBlockedReason && !latest.current.renderQueue.isRendering;
    try {
      await shell.waitForPendingDomEditSaves(); if (!valid()) return;
      const result = await transcriptRequest<{ document: TranscriptDocument }>({ command: 'get', projectId, transcriptId: source });
      const detail = await gatewayRequest<{ revision: string; currentVersionId: string }>('phase1/call', 'POST', { name: 'openmotion_get_project', arguments: { projectId } });
      if (!valid()) return;
      await transcriptRequest({ command: 'captions', projectId, transcriptId: source, expectedTranscriptRevision: result.document.revision, compositionPath, ...placement, captionSettings: settings, expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, requestId: crypto.randomUUID() });
      if (valid()) {
        // Keep the new caption selected while the preview replaces its old clip list.
        useCaptionWorkspace.getState().open(projectId, { compositionPath, mode: 'style', trackId: source, selectClip: true });
        await files.refreshFileTree(); await refresh(); setTarget(source); useCaptionWorkspace.getState().changed(); shell.showToast(t('Captions added to the video'), 'info');
      }
    } catch (error) { if (valid()) shell.showToast(t(error instanceof Error ? error.message : 'Caption update failed'), 'error'); }
    finally { active.current = false; if (alive.current) setWorking(false); }
  }
  useEffect(() => { if (!loading && !initialMode.current) { initialMode.current = true; if (tracks.length) setMode('style'); } }, [loading, tracks.length]);
  const replacing = !current && tracks.some(track => track.id === source);
  return <section aria-label={t('Captions')} className="@container flex h-full min-h-0 flex-col overflow-hidden text-step-12 text-text-1" onKeyDown={event => event.stopPropagation()}>
    <div className="flex shrink-0 flex-wrap gap-1 border-b border-border p-2" role="tablist" aria-label={t('Caption tools')}>
      {(['auto', 'manual', 'style'] as const).map((item, i) => <Button key={item} size="sm" role="tab" aria-selected={mode === item} variant={mode === item ? 'secondary' : 'ghost'} onClick={() => chooseMode(item)}>{t(['Auto captions', 'Add captions', 'Style'][i])}</Button>)}
    </div>
    <div className={mode === 'auto' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><AutoCaptionsPanel visible={mode === 'auto'} /></div>
    {mode === 'manual' ? <ManualTextPanel kind="caption" /> : mode === 'style' ? <>
    {(tracks.length > 0 || documents.length > 0 || loading || failed) && <div className="flex shrink-0 flex-col items-stretch gap-2 border-b border-border px-3 py-2 @min-[300px]:flex-row @min-[300px]:items-center" data-testid="caption-track-bar">
      <span className="text-step-11 font-medium text-text-2">{t('Caption track')}</span>
      <Select className="min-w-0 flex-1" label={t('Caption track')} value={current?.id || 'new'} disabled={blocked || loading || failed || (!tracks.length && !documents.length)} options={[...tracks.map(track => ({ value: track.id, label: `${captionTrackCode(track, tracks, timelineElements)} · ${captionTrackText(track, timelineElements) || t(track.label)}`, description: t('{count} caption cues', { count: track.cueCount }) })), ...(documents.length ? [{ value: 'new', label: t('Create from transcript') }] : [])]} onCommit={value => { pendingTrack.current = undefined; setTarget(value); if (value !== 'new') setSource(value); }} />
    </div>}
    {current && !failed && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2" data-testid="caption-visibility-bar">
      <label className="flex min-w-0 flex-1 basis-full cursor-pointer items-center gap-2 text-step-11 @min-[300px]:basis-auto">
        <Checkbox aria-label={t('Show captions in video')} checked={current.settings.visible} disabled={blocked || current.locked} onCheckedChange={value => updateAppearance({ visible: value })} />
        <span>{t(current.settings.visible ? 'Captions visible' : 'Captions hidden')}</span>
      </label>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={blocked || current.locked} onClick={() => updateAppearance({ visible: !current.settings.visible })}>{t(current.settings.visible ? 'Hide' : 'Show')}</Button>
        <Button size="sm" variant="ghost" aria-label={t('Remove caption track')} disabled={blocked || current.locked} onClick={() => void change(current.id, undefined, true).then(ok => { if (ok && alive.current) setTarget('new'); })}>{t('Remove')}</Button>
      </div>
    </div>}
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3" data-testid="caption-controls">
      {loading ? <div className="flex flex-col gap-3" role="status" aria-label={t('Loading caption tracks')}><Skeleton className="h-8 w-full" /><Skeleton className="h-32 w-full" /></div>
        : failed ? <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center" role="alert"><p>{t('Could not load caption tracks')}</p><Button onClick={() => void refresh()}>{t('Retry')}</Button></div>
        : !(current || doc) ? <div className="m-auto flex max-w-sm flex-col items-center gap-3 py-6 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-bg-2 text-text-3"><RemixIcon name="closed-captioning-line" size={24} /></span>
          <h2 className="text-step-13 font-semibold">{t(listFailed ? 'Could not load transcripts' : 'No caption tracks yet')}</h2>
          <p className="text-step-11 text-text-3">{t('Generate or add captions, then choose their style here.')}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={listFailed ? () => void loadDocuments() : () => chooseMode('auto')}>{t(listFailed ? 'Retry' : 'Auto captions')}</Button>
            <Button variant="secondary" onClick={() => chooseMode('manual')}>{t('Add captions')}</Button>
          </div>
        </div> : <div className="flex flex-col gap-4">
          {!current && <div className="flex flex-col gap-2 border-b border-border pb-3">
            <span className="text-step-11 font-medium text-text-2">{t('Transcript')}</span>
            <Select label={t('Caption transcript')} value={source} disabled={blocked} options={documents.map(doc => ({ value: doc.id, label: `${doc.language || t('Original')} · ${doc.source.path.split('/').pop()}`, description: t('{count} segments', { count: doc.segmentCount }) }))} onCommit={setSource} />
            {replacing && <p className="text-step-11 text-text-3">{t('Recreating captions replaces this transcript’s existing cues, including manual edits. Review the timing before continuing.')}</p>}
          </div>}
          {current?.locked && <p className="text-step-11 text-text-3">{t('Unlock the caption track before changing it')}</p>}
          <CaptionAppearance settings={appearance} disabled={blocked || Boolean(current?.locked)} existing={Boolean(current)} onChange={updateAppearance} onRecreate={current && doc ? pacing => { setSettings({ ...current.settings, pacing }); setSource(current.id); setTarget('new'); } : undefined} />
          {!current && <details className="border-t border-border pt-3"><summary className="cursor-pointer text-step-11 font-medium text-text-2">{t('Caption timing')}</summary><div className="mt-2 grid grid-cols-1 gap-2 @min-[300px]:grid-cols-2">{(['sourceStart', 'sourceEnd', 'timelineStart', 'playbackRate'] as const).map((key, i) => <label key={key} className="flex min-w-0 flex-col gap-1 text-step-11 text-text-3">{t(['Source in (seconds)', 'Source out (seconds)', 'Timeline start (seconds)', 'Playback rate'][i])}<span className="om-field"><input type="number" step="0.01" min={key === 'playbackRate' ? 0.1 : 0} disabled={blocked} aria-label={t(['Source in (seconds)', 'Source out (seconds)', 'Timeline start (seconds)', 'Playback rate'][i])} value={Number.isFinite(placement[key]) ? placement[key] : ''} onChange={event => setPlacement(value => ({ ...value, [key]: event.target.value === '' ? NaN : Number(event.target.value) }))} /></span></label>)}</div></details>}
        </div>}
    </div>
    {!loading && !failed && (current || doc) && <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
      {!current && <div className="flex flex-wrap gap-2">
        {replacing && <Button variant="ghost" disabled={blocked} onClick={() => setTarget(source)}>{t('Cancel')}</Button>}
        <Button className="min-w-0 flex-1" variant="primary" disabled={blocked || !doc || tracks.some(track => track.id === source && track.locked)} onClick={() => void apply()}>{t(working ? 'Adding captions…' : replacing ? 'Recreate captions' : 'Add captions to video')}</Button>
      </div>}
      {current && <Button size="sm" variant="ghost" disabled={!editableClip} onClick={editText}><RemixIcon name="text" size={14} />{t('Edit text')}</Button>}
      {doc && <Button size="sm" variant="ghost" onClick={goTranscript}><RemixIcon name="file-text-line" size={14} />{t('Edit transcript')}</Button>}
    </div>}
    </> : null}
  </section>;
}
