import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reviewCommentsPrompt, type ReviewAnchor, type ReviewComment } from '../../../shared/review-comments';
import { useStudioShellContext } from '../contexts/StudioContext';
import { useDomEditContext } from '../contexts/DomEditContext';
import { usePlayerStore } from '../player/store/playerStore';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { Button } from 'open-design-ui/button';
import { IconButton, Tooltip } from '../components/ui';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { Skeleton } from '../components/ui/Skeleton';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { elementHandleMatchesProject, parseElementHandle, resolveElementHandle } from '../webmcp/handles';
import { captureReviewAnchor, reviewTime } from './reviewCommentsClient';
import { useReviewComments } from './useReviewComments';
import { useIntegrationInfo } from './useIntegrationInfo';
import { readPreviewCompositionSize } from '../utils/previewCompositionSize';
import { reviewFrameMatches, useReviewMarkupStore } from './reviewMarkupStore';
import { ReviewMarkupTools, ReviewAnnotationLabel } from './ReviewMarkupTools';
import { ReviewCommentCard } from './ReviewCommentCard';
import { useReviewPresentationStore } from './reviewPresentationStore';

const scopeLabels = { project: 'Whole video', frame: 'Current frame', element: 'Selected element' } as const;
type Draft = { anchor: ReviewAnchor; sourceRevision: string; requestId: string; annotated: boolean };

export function ReviewCommentsPanel() {
  const shell = useStudioShellContext();
  return <ProjectReviewComments key={shell.projectId} />;
}

function ProjectReviewComments() {
  const { t } = useI18n();
  const { projectId, activeCompPath, setActiveCompPath, waitForPendingDomEditSaves, writeBlockedReason, previewIframeRef, showToast } = useStudioShellContext();
  const { domEditSelectionRef, buildDomSelectionFromTarget, applyDomSelection } = useDomEditContext();
  const visible = useDockLayoutStore(state => state.visiblePanels.has('comments') && !state.collapsedZones?.includes('right'));
  const playerHost = useReviewPresentationStore(state => state.playerHost);
  const listHost = useReviewPresentationStore(state => state.listHost);
  const intent = useReviewPresentationStore(state => state.intent);
  const composerOpen = useReviewPresentationStore(state => state.composerOpen);
  const placement = useReviewPresentationStore(state => state.placement);
  const time = usePlayerStore(state => state.currentTime), playing = usePlayerStore(state => state.isPlaying);
  const { info, failed: integrationFailed, retry: retryIntegration } = useIntegrationInfo();
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null), [text, setText] = useState('');
  const review = useReviewComments(projectId, visible || Boolean(playerHost && (draft || composerOpen)));
  const [needsRecapture, setNeedsRecapture] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualCopy, setManualCopy] = useState('');
  const [locating, setLocating] = useState<ReviewComment | null>(null);
  const markup = useReviewMarkupStore(state => state.draft?.projectId === projectId ? state.draft : null);
  const currentComposition = useRef(activeCompPath); currentComposition.current = activeCompPath;
  const alive = useRef(true), editor = useRef<HTMLTextAreaElement>(null), copyFallback = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { alive.current = true; useReviewMarkupStore.getState().reset(); return () => { alive.current = false; useReviewMarkupStore.getState().reset(); useReviewPresentationStore.setState({ drafting: false, busy: false, count: 0, intent: null, mode: null, composerOpen: false, placement: null, frame: null }); }; }, []);
  useEffect(() => { useReviewMarkupStore.getState().patch({ locked: review.busy || needsRecapture, stale: needsRecapture }); }, [review.busy, needsRecapture]);
  useEffect(() => {
    if (draft?.annotated && review.data && draft.sourceRevision !== review.data.sourceRevision) { setNeedsRecapture(true); useReviewPresentationStore.setState({ composerOpen: true }); }
  }, [draft, review.data]);
  useEffect(() => {
    const displayed = useReviewMarkupStore.getState().displayed;
    if (displayed && review.data && (displayed.sourceRevision !== review.data.sourceRevision || !review.data.comments.some(comment => comment.id === displayed.id && comment.status === 'open'))) useReviewMarkupStore.getState().show(null);
  }, [review.data]);
  useEffect(() => { if (draft && composerOpen && !review.busy) editor.current?.focus(); }, [Boolean(draft), composerOpen, review.busy]);
  useEffect(() => { if (manualCopy) copyFallback.current?.scrollIntoView({ block: 'nearest' }); }, [manualCopy]);
  const comments = review.data?.comments ?? [];
  const shown = comments.filter(comment => filter === 'all' || comment.status === filter);
  const checked = comments.filter(comment => selecting ? selected.has(comment.id) : comment.status === 'open');
  useEffect(() => { useReviewPresentationStore.setState({ drafting: Boolean(draft), frame: draft?.anchor ?? null, busy: review.busy, count: comments.filter(comment => comment.status === 'open').length }); }, [draft, review.busy, review.data]);
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!intent || intent.projectId !== projectId || intent.id === handled.current) return;
    handled.current = intent.id;
    if (intent.kind === 'cancel') { cancel(); return; }
    if (draft) {
      if (draft.anchor.scope === 'project' && intent.kind !== 'project') { begin(true, intent.kind === 'annotate', 'frame', false); return; }
      if (intent.kind === 'annotate' && !draft.annotated) {
        const dimensions = readPreviewCompositionSize(previewIframeRef.current);
        if (!dimensions || draft.anchor.scope === 'project') { editor.current?.focus(); return; }
        useReviewMarkupStore.getState().start({ projectId, anchor: draft.anchor, sourceRevision: draft.sourceRevision,
          annotation: { version: 1, coordinateSpace: 'normalized', ...dimensions, marks: [] } });
        setDraft({ ...draft, annotated: true });
      }
      useReviewPresentationStore.setState({ mode: intent.kind === 'annotate' ? 'annotate' : 'comment', composerOpen: intent.kind === 'project' || (intent.kind === 'comment' && draft.annotated) });
      return;
    }
    begin(false, intent.kind === 'annotate', intent.kind === 'project' ? 'project' : undefined);
  }, [intent, projectId]);
  const placed = useRef<string | null>(null);
  useEffect(() => {
    if (!placement || !draft || placement.id === placed.current) return;
    placed.current = placement.id;
    run(async () => {
      const target = placement.target;
      const selection = target?.isConnected && !target.hasAttribute('data-composition-id') && !['BODY', 'HTML'].includes(target.tagName)
        ? await buildDomSelectionFromTarget(target as HTMLElement) : null;
      if (!alive.current || useReviewPresentationStore.getState().placement?.id !== placement.id) return;
      const anchor = selection ? captureReviewAnchor('element', projectId, draft.anchor.compositionPath, draft.anchor.time ?? 0, selection) : target ? captureReviewAnchor('frame', projectId, draft.anchor.compositionPath, draft.anchor.time ?? 0, null) : draft.anchor;
      setDraft({ ...draft, anchor });
      useReviewPresentationStore.setState({ composerOpen: true });
    });
  }, [placement]);
  function cancel() {
    setDraft(null); setText(''); setNeedsRecapture(false); useReviewMarkupStore.getState().reset();
    useReviewPresentationStore.setState({ mode: null, composerOpen: false, placement: null });
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-review-player] button[aria-pressed]')?.focus());
  }
  function returnToFrame() {
    if (!draft) return;
    usePlayerStore.getState().requestPlayback(false);
    if (draft.anchor.compositionPath !== (activeCompPath ?? 'index.html')) setActiveCompPath(draft.anchor.compositionPath);
    usePlayerStore.getState().requestSeek(draft.anchor.time ?? 0);
  }
  const report = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : 'Comment action failed';
    const code = message.split(':')[0];
    const recovery: Record<string, string> = {
      VERSION_CONFLICT: 'The project changed. Recapture the current frame to keep your comment text.',
      COMMENT_CONFLICT: 'This comment changed elsewhere. Refresh the list before trying again.',
      COMMENT_NOT_FOUND: 'This comment was deleted elsewhere. Refresh the list.',
    };
    if (alive.current) showToast(t(recovery[code] ?? message), 'error');
  };
  const run = (task: () => Promise<unknown>) => { void review.run(task).catch(report); };

  function begin(preserveText = false, annotated = false, requestedScope?: ReviewAnchor['scope'], composeImmediately = preserveText) {
    run(async () => {
      if (writeBlockedReason) throw new Error(writeBlockedReason);
      usePlayerStore.getState().requestPlayback(false);
      await waitForPendingDomEditSaves();
      if (!alive.current) return;
      const current = await review.refresh();
      if (!alive.current) return;
      if (currentComposition.current !== activeCompPath) throw new Error('The preview changed. Capture the comment again.');
      const scope = requestedScope ?? (domEditSelectionRef.current?.element.isConnected ? 'element' : 'frame');
      const anchor = captureReviewAnchor(annotated && scope === 'project' ? 'frame' : scope, projectId, activeCompPath ?? 'index.html', usePlayerStore.getState().currentTime, domEditSelectionRef.current);
      const dimensions = annotated ? readPreviewCompositionSize(previewIframeRef.current) : null;
      if (annotated && !dimensions) throw new Error('The preview is not ready for annotation. Try again after it loads.');
      if (alive.current) {
        useReviewMarkupStore.getState().reset();
        if (annotated && dimensions) useReviewMarkupStore.getState().start({ projectId, anchor, sourceRevision: current.sourceRevision,
          annotation: { version: 1, coordinateSpace: 'normalized', ...dimensions, marks: [] } });
        useReviewPresentationStore.setState({ mode: annotated ? 'annotate' : 'comment', composerOpen: requestedScope === 'project' || composeImmediately, placement: null, point: { x: 0.5, y: 0.5 } });
        setDraft({ anchor, sourceRevision: current.sourceRevision, requestId: crypto.randomUUID(), annotated }); setNeedsRecapture(false);
        if (!preserveText) setText('');
      }
    });
  }
  function save() {
    if (!draft || needsRecapture || !text.trim()) return;
    const drawing = useReviewMarkupStore.getState().draft;
    if (draft.annotated && (!drawing || drawing.projectId !== projectId || !drawing.annotation.marks.length || drawing.inProgress)) return;
    const anchor = drawing && draft.annotated ? { ...draft.anchor, annotation: structuredClone(drawing.annotation) } : draft.anchor;
    const requestId = drawing && draft.annotated ? drawing.requestId : draft.requestId;
    run(async () => {
      try {
        useReviewMarkupStore.getState().patch({ locked: true });
        const result = await review.mutate({ operation: 'create', anchor, requestId, expectedRevision: draft.sourceRevision, text: text.trim() });
        if (alive.current) { useReviewMarkupStore.getState().reset(); if (result.comment?.anchor.annotation) useReviewMarkupStore.getState().show(result.comment); }
      } catch (cause) {
        if (alive.current && cause instanceof Error && cause.message.startsWith('VERSION_CONFLICT:')) setNeedsRecapture(true);
        throw cause;
      }
      if (alive.current) { setDraft(null); setText(''); useReviewPresentationStore.setState({ mode: null, composerOpen: false, placement: null }); setFilter('open'); showToast(t('Comment saved')); }
    });
  }
  function copy() {
    if (!checked.length || !info) return;
    run(async () => {
      await waitForPendingDomEditSaves();
      if (!alive.current) return;
      const current = await review.refresh();
      if (!alive.current) return;
      const chosen = current.comments.filter(comment => selecting ? selected.has(comment.id) : comment.status === 'open');
      if (!chosen.length) throw new Error('The selected comments are no longer available.');
      const prompt = reviewCommentsPrompt({ projectId, dataDirectory: info?.dataDirectory, previewUrl: info?.previewUrl, sourceRevision: current.sourceRevision, comments: chosen });
      try { await navigator.clipboard.writeText(prompt); if (alive.current) { setManualCopy(''); showToast(t('Copied. Paste into your Agent.')); } }
      catch { if (alive.current) { setManualCopy(prompt); showToast(t('Could not copy. Select and copy the text manually.'), 'error'); } }
    });
  }
  function locate(comment: ReviewComment) {
    run(async () => {
      await waitForPendingDomEditSaves();
      if (!alive.current) return;
      const current = await review.refresh();
      if (!alive.current) return;
      const latest = current.comments.find(record => record.id === comment.id);
      if (!latest) throw new Error('COMMENT_NOT_FOUND: This comment was deleted elsewhere.');
      comment = latest;
      if (comment.anchor.time === undefined) {
        setLocating(null);
        useReviewMarkupStore.getState().show(null);
        return;
      }
      usePlayerStore.getState().requestPlayback(false);
      if (comment.anchor.annotation && comment.sourceRevision !== current.sourceRevision) throw new Error('This annotated frame is from an earlier project revision. Review its saved context.');
      if (comment.anchor.element) {
        const target = parseElementHandle(comment.anchor.element.handle);
        if (!target || !elementHandleMatchesProject(comment.anchor.element.handle, projectId)
          || target.sourceFile !== comment.anchor.element.sourceFile || target.activeCompositionPath !== comment.anchor.compositionPath
          || (target.scheme === 'sel' && comment.sourceRevision !== current.sourceRevision)) {
          throw new Error('This target has changed or is unavailable. Review its saved context.');
        }
      }
      setLocating(comment);
      useReviewMarkupStore.getState().show(comment.anchor.annotation ? comment : null);
      if (comment.anchor.compositionPath !== (activeCompPath ?? 'index.html')) setActiveCompPath(comment.anchor.compositionPath);
    });
  }
  useEffect(() => {
    if (!locating) return;
    const timer = window.setTimeout(() => { showToast(t('This target has changed or is unavailable. Review its saved context.'), 'error'); setLocating(null); }, 6500);
    return () => clearTimeout(timer);
  }, [locating, showToast, t]);
  useEffect(() => {
    if (!locating || locating.anchor.compositionPath !== (activeCompPath ?? 'index.html')) return;
    let cancelled = false, running = false;
    const deadline = Date.now() + 5000;
    const anchor = locating.anchor;
    const targetTime = anchor.time;
    if (targetTime === undefined) return;
    usePlayerStore.getState().requestSeek(targetTime);
    const attempt = async () => {
      if (cancelled || running) return;
      running = true;
      try {
        const player = usePlayerStore.getState();
        if (Math.abs(player.currentTime - targetTime) > 0.08) return;
        if (!anchor.element) { setLocating(null); return; }
        const doc = previewIframeRef.current?.contentDocument;
        const element = doc && resolveElementHandle(doc, anchor.element.handle);
        if (!element) return;
        const selection = await buildDomSelectionFromTarget(element);
        if (cancelled || !selection || !element.isConnected) return;
        applyDomSelection(selection, { revealPanel: false }); setLocating(null);
      } catch (cause) { if (!cancelled) { report(cause); setLocating(null); } }
      finally {
        running = false;
        if (!cancelled && Date.now() >= deadline) { showToast(t('This target has changed or is unavailable. Review its saved context.'), 'error'); setLocating(null); }
      }
    };
    const timer = window.setInterval(() => void attempt(), 100); void attempt();
    return () => { cancelled = true; clearInterval(timer); };
  }, [locating, activeCompPath, previewIframeRef, buildDomSelectionFromTarget, applyDomSelection, showToast, t]);

  const composer = draft && composerOpen && <section role="dialog" aria-modal="false" aria-label={t('Write a comment')} data-studio-keyboard-owner className="motion-review-composer hf-floating-motion flex flex-col gap-2 p-3 text-step-12" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !review.busy) { event.preventDefault(); cancel(); } }}>
    <div className="flex items-center gap-2">
      <RemixIcon name={draft.annotated ? 'edit-line' : 'chat-1-line'} size={14} />
      <span className="min-w-0 flex-1 truncate text-text-2" title={draft.anchor.element?.label}>{t(scopeLabels[draft.anchor.scope])}{draft.anchor.time !== undefined && ` · ${reviewTime(draft.anchor.time)}`}{draft.anchor.element && ` · ${draft.anchor.element.label}`}</span>
      <Tooltip label={t('Cancel')}><IconButton size="sm" disabled={review.busy} aria-label={t('Cancel')} icon={<RemixIcon name="close-line" size={14} />} onClick={cancel} /></Tooltip>
    </div>
    {markup?.tool === 'text' && <ReviewAnnotationLabel draft={markup} />}
    <textarea ref={editor} rows={2} className="om-field w-full resize-none" aria-label={t('Comment')} placeholder={t('What should change here?')} value={text} maxLength={8000}
      disabled={review.busy} onChange={event => { setText(event.target.value); setDraft({ ...draft, requestId: crypto.randomUUID() }); useReviewMarkupStore.getState().touch(); }}
      onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save(); } }} />
    <div className="flex items-center justify-between gap-2">
      {draft.annotated && markup ? <ReviewMarkupTools draft={markup} /> : <span className="text-step-11 text-text-3">{t('⌘ / Ctrl + Enter')}</span>}
      {needsRecapture ? <Button size="sm" variant="primary" disabled={review.busy} onClick={() => begin(true, draft.annotated, draft.anchor.scope)}>{t('Recapture current frame')}</Button>
        : <Button size="sm" variant="primary" disabled={review.busy || !text.trim() || (draft.annotated && (!markup?.annotation.marks.length || markup.inProgress))} onClick={save}>{t('Save comment')}</Button>}
    </div>
    {draft.anchor.time !== undefined && !reviewFrameMatches(draft.anchor, activeCompPath ?? 'index.html', time, playing) && <Button size="sm" variant="ghost" disabled={review.busy} onClick={returnToFrame}>{t('Return to annotated frame')}</Button>}
    {needsRecapture && <p className="text-text-3">{t(draft.annotated ? 'Recapturing clears the marks and keeps your comment.' : 'The project changed. Recapture the current frame to keep your comment text.')}</p>}
  </section>;
  const list = <section aria-label={t('Comments')} data-studio-keyboard-owner className="flex h-full min-h-0 min-w-0 flex-col text-step-12" onKeyDown={event => event.stopPropagation()}>
    {comments.length > 0 && <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-3">
      <span className="text-text-2">{t('Review list')} · {shown.length}</span>
      <Menu modal={false} align="end" aria-label={t('Filter comments')} trigger={<Button size="sm" variant="ghost" aria-label={t('Filter comments')} icon={<RemixIcon name="arrow-down-s-line" size={14} />}>{t(filter === 'open' ? 'Unresolved' : filter === 'resolved' ? 'Completed' : 'All')}</Button>}>
        <MenuRadioGroup value={filter} onValueChange={value => setFilter(value as typeof filter)}>{(['open', 'resolved', 'all'] as const).map(value => <MenuRadioItem key={value} value={value} closeOnClick>{t(value === 'open' ? 'Unresolved' : value === 'resolved' ? 'Completed' : 'All')}</MenuRadioItem>)}</MenuRadioGroup>
      </Menu>
    </div>}
    <div className="min-h-0 flex-1 overflow-y-auto p-3" data-review-scroll>
      {review.error && <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-border p-4 text-text-2">
        <p>{t('Could not load comments')}</p><p className="text-text-3">{t('Check the connection and try again.')}</p><Button size="sm" disabled={review.busy} onClick={() => run(review.refresh)}>{t('Retry')}</Button>
      </div>}
      {!review.data ? (review.error ? null : <div role="status" aria-label={t('Loading comments…')}><Skeleton className="mb-2 h-24 w-full" /><Skeleton className="h-24 w-full" /></div>)
        : !shown.length ? (!review.error && <div className="flex flex-col items-center gap-3 px-3 py-8 text-center text-text-3">
          <RemixIcon name="chat-1-line" size={24} /><p className="text-text-1">{t('No comments here yet')}</p><p>{t('See something to change? Click Comment here below the player.')}</p>
        </div>) : <div className="flex flex-col gap-3">{shown.map(comment => <ReviewCommentCard key={comment.id} comment={comment} stale={comment.sourceRevision !== review.data!.sourceRevision} busy={review.busy} locatingDisabled={Boolean(draft)}
          selecting={selecting} checked={selected.has(comment.id)} onCheck={value => setSelected(previous => { const next = new Set(previous); if (value) next.add(comment.id); else next.delete(comment.id); return next; })}
          onLocate={() => locate(comment)} onComplete={() => run(async () => { await review.change(comment, 'update', comment.status === 'open' ? 'resolved' : 'open'); showToast(t('Comment updated')); })}
          onDelete={() => run(async () => { await review.change(comment, 'delete'); showToast(t('Comment deleted')); })} />)}</div>}
      {manualCopy && <textarea ref={copyFallback} className="om-field mt-3 min-h-32 w-full" aria-label={t('Review instruction')} readOnly value={manualCopy} onFocus={event => event.currentTarget.select()} />}
    </div>
    {comments.length > 0 && <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3" data-review-footer>
      {selecting && <div className="flex flex-wrap items-center gap-1"><Button size="sm" variant="ghost" disabled={!shown.length} onClick={() => setSelected(new Set(shown.map(comment => comment.id)))}>{t('Select all shown')}</Button>
        <Button size="sm" variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Set())}>{t('Clear comment selection')}</Button></div>}
      {integrationFailed && <div role="alert"><p>{t('Check the connection and try again.')}</p><Button size="sm" variant="ghost" onClick={retryIntegration}>{t('Retry')}</Button></div>}
      <Button size="sm" variant="primary" className="h-auto min-h-ctl whitespace-normal py-2" disabled={!checked.length || review.busy || !info} onClick={copy}>{t(selecting ? 'Copy for Agent' : 'Copy pending for Agent')} ({checked.length})</Button>
      <Button size="sm" variant="ghost" onClick={() => { setSelecting(value => !value); setSelected(new Set()); }}>{t(selecting ? 'Done selecting' : 'Choose comments')}</Button>
    </div>}
  </section>;
  return <>{playerHost && createPortal(composer, playerHost)}{listHost && createPortal(list, listHost)}</>;
}
