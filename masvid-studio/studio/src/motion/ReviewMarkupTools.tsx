import { IconButton, Tooltip } from '../components/ui';
import { Menu, MenuItem, MenuSeparator } from '../components/ui/Menu';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useReviewMarkupStore, type ReviewMarkupDraft } from './reviewMarkupStore';
import { useReviewPresentationStore } from './reviewPresentationStore';

/** Optional mark editing lives inside the small composer, never in a new player row. */
export function ReviewMarkupTools({ draft }: { draft: ReviewMarkupDraft }) {
  const { t } = useI18n();
  const store = useReviewMarkupStore.getState();
  const choose = (tool: ReviewMarkupDraft['tool']) => {
    store.patch({ tool });
    useReviewPresentationStore.setState({ mode: 'annotate', composerOpen: tool === 'text' });
  };
  return <div className="flex min-w-0 items-center gap-1" role="toolbar" aria-label={t('Annotation tools')}>
    <Tooltip label={t('Continue drawing')}><IconButton size="sm" aria-label={t('Continue drawing')} disabled={draft.locked} icon={<RemixIcon name="edit-line" size={14} />} onClick={() => choose('pen')} /></Tooltip>
    <Tooltip label={t('Undo annotation')}><IconButton size="sm" aria-label={t('Undo annotation')} icon={<RemixIcon name="arrow-go-back-line" size={14} />} disabled={draft.locked || draft.inProgress || !draft.annotation.marks.length} onClick={store.undo} /></Tooltip>
    <Menu modal={false} side="top" aria-label={t('More annotation tools')} trigger={<IconButton size="sm" aria-label={t('More annotation tools')} disabled={draft.locked || draft.inProgress} icon={<RemixIcon name="more-line" size={14} />} />}>
      {(['pen', 'rectangle', 'arrow', 'ellipse', 'text'] as const).map((tool, index) => <MenuItem key={tool} onClick={() => choose(tool)}>{t(['Freehand pen', 'Rectangle', 'Arrow', 'Ellipse', 'Text label'][index])}</MenuItem>)}
      <MenuSeparator />
      <MenuItem disabled={!draft.redo.length} onClick={store.redo}>{t('Redo annotation')}</MenuItem>
      <MenuItem disabled={!draft.annotation.marks.length} onClick={store.clear}>{t('Clear annotations')}</MenuItem>
    </Menu>

  </div>;
}

export function ReviewAnnotationLabel({ draft }: { draft: ReviewMarkupDraft }) {
  const { t } = useI18n();
  const store = useReviewMarkupStore.getState();
  return <div className="motion-review-label-input flex items-center gap-1 p-2">
      <input autoFocus className="om-field w-full min-w-0" aria-label={t('Annotation label')} placeholder={t('Enter a label, then click the frame to place it.')} value={draft.label} maxLength={160} disabled={draft.locked}
        onChange={event => store.patch({ label: event.target.value })} onKeyDown={event => { if (event.key === 'Enter' && draft.label.trim()) { event.preventDefault(); useReviewPresentationStore.setState({ composerOpen: false }); } }} />
      <Tooltip label={t('Place label')}><IconButton size="sm" aria-label={t('Place label')} disabled={!draft.label.trim()} icon={<RemixIcon name="check-line" size={14} />} onClick={() => useReviewPresentationStore.setState({ composerOpen: false })} /></Tooltip>
    </div>;
}
