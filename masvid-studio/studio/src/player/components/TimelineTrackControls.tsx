import { IconButton } from "open-design-ui/icon-button";
import { Tooltip } from "../../components/ui/Tooltip";
import { useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { useTimelineEditContextOptional } from '../../contexts/TimelineEditContext';
import { useStudioShellContextOptional } from '../../contexts/StudioContext';
import { useTimelineReadOnlyPress } from './timelineReadOnly';
import { VisibilityButton } from './TimelineTrackPlainHeader';
import { TimelineTrackAudioControls } from './TimelineTrackAudioControls';
import type { TimelineEditCallbacks } from './timelineCallbacks';
import type { TimelineElement } from '../store/timelineElement';
import { trackKind, type TrackIdentity } from './timelineTrackIdentity';

export function TimelineTrackControls({ elements, track, number, label, hidden, audioOnly, toggleHidden, children, identity }: {
  elements: readonly TimelineElement[]; track: number; number: number | null; label: string;
  hidden: boolean; audioOnly: boolean; toggleHidden: TimelineEditCallbacks['onToggleTrackHidden'];
  children?: ReactNode;
  identity?: TrackIdentity;
}) {
  const { t } = useI18n();
  const edits = useTimelineEditContextOptional();
  const shell = useStudioShellContextOptional();
  const readOnly = useTimelineReadOnlyPress();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const locked = elements.some(el => el.timelineLocked);
  const disabled = busy || !!readOnly || !!shell?.writeBlockedReason || !!shell?.renderQueue?.isRendering;
  const run = async (action: () => Promise<unknown> | unknown) => {
    if (disabled || running.current) return;
    running.current = true; setBusy(true);
    try { await action(); }
    catch (error) { shell?.showToast(error instanceof Error ? error.message : 'Changes could not be saved.', 'error'); }
    finally { running.current = false; setBusy(false); }
  };
  const kind = identity?.kind || trackKind(elements), code = identity?.code || `${kind}${number || 1}`;
  const name = t('Track {number}' , { number: number ?? '' });
  const badgeDescription = t(identity?.label || 'Track');
  const lockLabel = t(locked ? 'Unlock track' : 'Lock track');
  return <div className="motion-track-controls" aria-label={name}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <Tooltip label={`${code} · ${badgeDescription} · ${label}`} wrap><span className="motion-track-kind motion-track-badge" data-track-kind={kind} data-main-track={identity?.isMain || undefined} aria-label={`${code} · ${badgeDescription}`}>
      {code}
    </span></Tooltip>
    <Tooltip label={lockLabel} wrap><IconButton variant="plain" type="button" aria-label={`${lockLabel} · ${name}`}
      aria-pressed={locked} disabled={disabled || !edits.onSetElementsAttributeQuiet}
      onClick={() => void run(() => edits.onSetElementsAttributeQuiet?.(elements.map(element => ({ element, value: locked ? null : '' })), 'data-timeline-locked', locked ? 'Unlock track' : 'Lock track'))} icon={<RemixIcon name={locked ? 'lock-line' : 'lock-unlock-line'} size={16} />} /></Tooltip>
    {!audioOnly && <VisibilityButton hidden={hidden} trackNumber={track} trackDisplayNumber={number} asMute={false} onToggle={toggleHidden} disabled={disabled || !toggleHidden} />}
    <TimelineTrackAudioControls elements={elements} trackLabel={name} isAudioOnly={audioOnly} hidden={hidden}
      onUnhide={() => { void toggleHidden?.(track, false, number); }} />
    {children}
    <Tooltip label={t('Delete track')} wrap><IconButton variant="plain" type="button" aria-label={`${t('Delete track')} · ${name}`}
      disabled={disabled || locked || !edits.onDeleteTrack} onClick={() => void run(() => edits.onDeleteTrack?.(track))} icon={<RemixIcon name="delete-bin-line" size={16} />} /></Tooltip>
  </div>;
}
