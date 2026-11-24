import { IconButton } from 'open-design-ui/icon-button';
import { Button } from 'open-design-ui/button';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { MotionIcon } from './icons';
import { RemixIcon } from '../icons/RemixIcons';
import { assetMediaUrl, type AssetReference } from '../../../shared/asset-library';
import { uploadLibraryAsset } from './assetClient';
import { AssetUploadError } from './assetUploadError';
import { templateSearchBrief, validReferenceLink } from './templateSearch';
import * as tracking from './templateLibraryTracking';
import type { ListContext } from './templateLibraryTracking';
import styles from './TemplateLibraryDialog.module.css';

type Mode = 'reference' | 'describe';
type RequestCallbacks = {
  onActivity: () => ListContext;
  showToast: (message: string, kind: 'info' | 'error') => unknown;
};
type SearchRecovery = {
  home?: false;
  query: string; context: ListContext; reason: 'no_results' | 'unsuitable' | 'catalog_empty';
  searchAction?: ReactNode; visible: boolean; expanded: boolean; onExpand: () => void;
};
type HomeReference = { home: true; titleId: string; onClose: () => void };

/** The library prepares a request. Only the user can send it in their own chat. */
export function TemplateSearchRecovery(props: RequestCallbacks & (SearchRecovery | HomeReference)) {
  const { t } = useI18n(), recoveryId = useId();
  const { onActivity, showToast } = props;
  const query = props.home ? '' : props.query;
  const formTitleId = props.home ? props.titleId : `${recoveryId}-form`;
  const entry = props.home ? 'library_home' : undefined;
  const [mode, setMode] = useState<Mode | undefined>(props.home ? 'reference' : undefined);
  const [source, setSource] = useState<'link' | 'local'>('link');
  const [reference, setReference] = useState(''), [referenceNotes, setReferenceNotes] = useState('');
  const [description, setDescription] = useState('');
  const [manual, setManual] = useState<{ query: string; brief: string } | null>(null);
  const [copying, setCopying] = useState(false);
  const [importing, setImporting] = useState(false);
  const [localVideo, setLocalVideo] = useState<(AssetReference & { name: string }) | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const busy = useRef(false), shown = useRef<string | undefined>(undefined), section = useRef<HTMLElement>(null);
  const start = useRef<HTMLButtonElement>(null), focusStart = useRef(false);
  const formElement = useRef<HTMLFormElement>(null), focusField = useRef(false);
  const context = props.home ? undefined : props.context;
  const reason = props.home ? undefined : props.reason;
  const expanded = props.home || (props.visible && props.expanded);
  useEffect(() => {
    if (!reason || !context || !expanded || !section.current || typeof IntersectionObserver === 'undefined') return;
    const key = context.resultSetId;
    if (!key || shown.current === key) return;
    const observer = new IntersectionObserver(entries => {
      if (document.hidden || !entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0)) return;
      shown.current = key; tracking.reportRecoveryShown(reason, context); observer.disconnect();
    }, { threshold: 0.01 });
    observer.observe(section.current);
    return () => observer.disconnect();
  }, [expanded, context, reason]);
  useEffect(() => {
    if (focusStart.current && !mode) { focusStart.current = false; start.current?.focus(); }
  }, [mode]);
  useEffect(() => {
    if (!focusField.current) return;
    focusField.current = false;
    const selector = mode === 'reference' ? 'input[type=url]' : 'textarea';
    formElement.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [mode, source]);

  function choose(next: Mode) {
    tracking.reportRecoveryAction(next, onActivity(), entry);
    if (next === 'describe' && !description) setDescription(query);
    focusField.current = true; setMode(next); setManual(null);
  }
  function back() {
    if (props.home) { props.onClose(); return; }
    focusStart.current = true; setMode(undefined); setManual(null);
  }
  function selectSource(next: 'link' | 'local') {
    if (next === source) return;
    tracking.reportRecoveryAction('reference_source_select', onActivity(), entry, next);
    focusField.current = next === 'link';
    setSource(next);
    setManual(null);
  }
  async function importVideo(file: File) {
    const importContext = onActivity();
    setImporting(true);
    setManual(null);
    try {
      const asset = await uploadLibraryAsset(file, { modality: 'video' });
      setLocalVideo({ assetId: asset.id, versionId: asset.currentVersionId, name: file.name });
      tracking.reportReferenceImport('success', importContext, entry);
    } catch (error) {
      const rejection = error instanceof AssetUploadError && error.outcome === 'rejected' ? error : undefined;
      tracking.reportReferenceImport(rejection ? 'failure' : 'unknown', importContext, entry, rejection?.reason);
      const message = rejection?.reason === 'size' ? 'Choose a video up to 500 MB.'
        : rejection ? 'Choose a readable video file.'
          : 'Could not confirm the video import. Check Assets or choose the video again.';
      showToast(t(message), 'error');
    } finally {
      setImporting(false);
    }
  }
  const valid = mode === 'reference'
    ? source === 'local' ? Boolean(localVideo) && !importing : validReferenceLink(reference)
    : Boolean(description.trim());
  async function copy() {
    if (busy.current || !mode || !valid) return;
    const draft = { query, description: mode === 'reference' ? referenceNotes : description };
    let brief: string;
    if (mode === 'reference' && source === 'local') {
      if (!localVideo) return;
      const { assetId, versionId } = localVideo;
      const mediaUrl = new URL(assetMediaUrl(assetId, versionId), window.location.origin).href;
      brief = templateSearchBrief({ ...draft, mode, source, asset: { assetId, versionId }, mediaUrl }, t);
    } else {
      brief = templateSearchBrief(mode === 'describe' ? { ...draft, mode } : { ...draft, mode, source: 'link', reference }, t);
    }
    busy.current = true; setCopying(true);
    const attemptId = tracking.newTrackingId();
    const actionContext = onActivity();
    const sourceKind = mode === 'reference' ? source : 'description';
    tracking.reportRecoveryAction('copy_brief', actionContext, entry, sourceKind);
    try {
      await navigator.clipboard.writeText(brief); setManual(null);
      tracking.reportSearchHandoff(sourceKind, attemptId, 'clipboard_written', actionContext, entry);
      showToast(t('Request copied. Paste the request in your chat and send it.'), 'info');
    } catch {
      setManual({ query, brief });
      tracking.reportSearchHandoff(sourceKind, attemptId, 'manual_fallback', actionContext, entry);
      showToast(t('Copy failed. Select and copy the instruction below.'), 'error');
    } finally { busy.current = false; setCopying(false); }
  }
  const pickerLabel = t(importing ? 'Importing…' : localVideo ? 'Replace video' : 'Choose local video');
  const fileNameId = `${recoveryId}-filename`;
  const form = mode && <form ref={formElement} aria-labelledby={formTitleId} className={styles.recoveryForm} onSubmit={event => { event.preventDefault(); void copy(); }}>
    <div className={styles.recoveryHeading}>
      <div><h3 id={formTitleId} className="om-media-detail-title">{t(mode === 'reference' ? 'Add your reference' : 'Describe your video')}</h3>
        <p className={styles.description}>{t('Copy the request, then paste it into the chat where you use OpenMotion and send it to start.')}</p></div>
      {props.home ? <IconButton variant="plain" type="button" className={`${styles.iconButton} ${styles.recoveryDismiss}`} onClick={back} aria-label={t('Close')} icon={<MotionIcon name="close" size={20} />} />
        : <Button variant="ghost" type="button" className="om-button h-auto" onClick={back} disabled={copying}>{t('Back')}</Button>}
    </div>
    {mode === 'reference' && <>
      <div className={styles.recoveryActions} role="group" aria-label={t('Reference video')}>
        <Button variant="plain" className="om-button om-filter-pill" type="button" aria-pressed={source === 'link'} disabled={copying} onClick={() => selectSource('link')}>{t('Video link')}</Button>
        <Button variant="plain" className="om-button om-filter-pill" type="button" aria-pressed={source === 'local'} disabled={copying} onClick={() => selectSource('local')}>{t('Local video')}</Button>
      </div>
      {source === 'link' ? <label className="om-label">{t('Reference video')}<span className={`om-field ${styles.recoveryField}`}><input autoComplete="off" type="url" required maxLength={2000} value={reference} disabled={copying} onChange={event => { setReference(event.target.value); setManual(null); }} placeholder="https://…" /></span></label>
        : <div className={styles.referenceFile}>
          <input ref={filePicker} type="file" accept="video/*" hidden onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importVideo(file);
          }} />
          <Button variant="ghost" type="button" className="om-button h-auto" disabled={copying || importing}
            aria-label={pickerLabel} aria-describedby={localVideo ? fileNameId : undefined} onClick={() => {
              tracking.reportRecoveryAction('choose_local_video', onActivity(), entry, 'local');
              filePicker.current?.click();
            }}>
            <RemixIcon name="folder-open-line" size={16} />
            {localVideo ? <>
              <span id={fileNameId} className={styles.referenceFilename} role="status" title={localVideo.name}>{localVideo.name}</span>
              <span className={styles.referenceFileAction}>{pickerLabel}</span>
            </> : pickerLabel}
          </Button>
        </div>}
    </>}
    <label key={mode} className="om-label">{t(mode === 'describe' ? 'What video do you want to make?' : 'What would you like to keep or change? (optional)')}
      <span className={`om-field ${styles.recoveryField}`}>
        <textarea maxLength={1000} required={mode === 'describe'} rows={3}
          value={mode === 'describe' ? description : referenceNotes} disabled={copying} onChange={event => {
            const update = mode === 'describe' ? setDescription : setReferenceNotes;
            update(event.target.value); setManual(null);
          }} />
      </span>
    </label>
    {manual?.query === query && <label className="om-label">{t('Creation instruction')}<span className={`om-field ${styles.recoveryField}`}><textarea readOnly value={manual.brief} rows={5} onFocus={event => event.target.select()} /></span></label>}
    <div className={styles.recoveryFooter}>
      <div className={styles.recoveryPrimary}>
        <Button variant="ghost" type="submit" className="om-button h-auto" data-primary disabled={copying || !valid}>{t('Copy request')}<MotionIcon name="copy" size={16} /></Button>
      </div>
      <div className={styles.resourceLinks}>
        <Button variant="plain" type="button" className={`om-text-link ${styles.repositoryLink}`} data-quiet disabled={copying} onClick={() => choose(mode === 'reference' ? 'describe' : 'reference')}>
          {t(mode === 'reference' ? 'Describe your video' : 'Add your reference')}</Button>
        <a className={`om-text-link ${styles.repositoryLink}`} data-quiet href="/mcp-setup" target="_blank" rel="noopener noreferrer">{t('Connect an Agent')}<MotionIcon name="arrow-up-right" size={14} /></a>
      </div>
    </div>
  </form>;
  if (props.home) return form;
  if (!props.visible) return null;
  if (!props.expanded) return <div className={styles.recoveryTeaser}><Button variant="ghost" className="om-button h-auto" onClick={props.onExpand}>{t('Nothing suitable?')}</Button></div>;
  const title = t(reason === 'no_results' ? 'No templates match the current conditions.' : reason === 'catalog_empty' ? 'No templates available yet.' : 'Nothing suitable?');
  return <section ref={section} className={styles.searchRecovery} data-form={mode ? 'open' : undefined} aria-label={t('Find another starting point')}>
    <div className={styles.recoveryStatus}>
      <span className={styles.recoveryMark} aria-hidden="true"><MotionIcon name="search" size={20} /></span>
      <div className={styles.recoveryStatusCopy}>
        <h2 className="om-media-detail-title">{title}</h2>
        <p className="om-muted">{t(reason === 'catalog_empty' ? 'You can still make a video from a reference.' : 'Keep looking, or make the video you had in mind.')}</p>
      </div>
      {props.searchAction && <div className={styles.recoverySearchAction}>{props.searchAction}</div>}
    </div>
    <div className={styles.recoveryBody}>
      {form || <div className={styles.recoveryIntro}>
        <span aria-hidden="true" className="om-avatar"><MotionIcon name="film" size={18} /></span>
        <div>
          <h3 className="om-title">{t('Start with a reference')}</h3>
          <p className="om-muted">{t('Use a video link or local video to create an editable project.')}</p>
        </div>
        <div className={styles.recoveryPrimary}>
          <Button variant="ghost" ref={start} className="om-button h-auto" data-primary onClick={() => choose('reference')}>
            {t('Make a video from a reference')}<MotionIcon name="arrow-right" size={16} />
          </Button>
        </div>
      </div>}
    </div>
  </section>;
}

export function TemplateReferenceDialog({ trigger, onClose, ...callbacks }: RequestCallbacks & {
  trigger: HTMLButtonElement; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const popup = dialog.current;
    popup?.showModal();
    popup?.querySelector<HTMLInputElement>('input[type=url]')?.focus({ preventScroll: true });
    return () => {
      popup?.close();
      if (trigger.isConnected && trigger.closest('dialog')?.open) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);
  return <dialog ref={dialog} className={styles.referenceDialog} data-search-recovery="" aria-labelledby={titleId}
    onCancel={event => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault(); onClose();
    }}>
    <TemplateSearchRecovery home titleId={titleId} onClose={onClose} {...callbacks} />
  </dialog>;
}
