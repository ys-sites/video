import { Button } from 'open-design-ui/button';
import { Select } from '../components/ui/Select';
import { Menu, MenuItem } from '../components/ui/Menu';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';

export type TranscriptView = 'segments' | 'paragraph';

/** Reading controls stay in the same place before and after recognition. */
export function TranscriptToolbar({ view, onView, editing = false, onEdit, pauses = false, onPauses, onImport, onStyles, busy = false }: {
  view: TranscriptView;
  onView: (view: TranscriptView) => void;
  editing?: boolean;
  onEdit?: () => void;
  pauses?: boolean;
  onPauses?: () => void;
  onImport?: () => void;
  onStyles?: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  return <div className="@container shrink-0 border-b border-border" data-testid="transcript-toolbar">
    <div className="flex items-center gap-1 overflow-x-auto p-2" role="toolbar" aria-label={t('Transcript tools')}>
      <Button size="sm" className="hidden shrink-0 @min-[280px]:inline-flex" variant={pauses ? 'secondary' : 'ghost'} aria-label={t('Show pauses')} title={t('Show gaps between speech segments')} aria-pressed={pauses} disabled={!onPauses} onClick={onPauses}>
        <RemixIcon name="time-line" size={14} /><span className="hidden @min-[520px]:inline">{t('Pauses')}</span>
      </Button>
      <Select className="h-ctl-sm min-w-0 flex-1 @min-[280px]:w-28 @min-[280px]:flex-none" label={t('Transcript view')} value={view} options={[{ value: 'segments', label: t('Segment view') }, { value: 'paragraph', label: t('Paragraph view') }]} onCommit={value => onView(value as TranscriptView)} />
      <Button size="sm" className="hidden shrink-0 @min-[280px]:inline-flex" variant={editing ? 'secondary' : 'ghost'} aria-label={t(editing ? 'Done editing' : 'Edit text')} title={t(editing ? 'Done editing' : 'Edit text')} aria-pressed={editing} disabled={busy || !onEdit} onClick={onEdit}>
        <RemixIcon name="edit-line" size={14} /><span className="hidden @min-[520px]:inline">{t(editing ? 'Done editing' : 'Edit text')}</span>
      </Button>
      <Button size="sm" className="hidden shrink-0 @min-[280px]:inline-flex" variant="ghost" aria-label={t('Import SRT / VTT')} title={t('Import SRT / VTT')} disabled={busy || !onImport} onClick={onImport}>
        <RemixIcon name="upload-2-line" size={14} /><span className="hidden @min-[520px]:inline">{t('Import SRT / VTT')}</span>
      </Button>
      <Button size="sm" className="hidden shrink-0 @min-[280px]:inline-flex" variant="ghost" aria-label={t('Caption styles')} title={t('Caption styles')} disabled={!onStyles} onClick={onStyles}>
        <RemixIcon name="closed-captioning-line" size={14} /><span className="hidden @min-[520px]:inline">{t('Caption styles')}</span>
      </Button>
      <div className="shrink-0 @min-[280px]:hidden">
        <Menu aria-label={t('More transcript tools')} trigger={<Button size="sm" variant="ghost" aria-label={t('More transcript tools')} title={t('More transcript tools')}><RemixIcon name="more-line" size={16} /></Button>}>
          <MenuItem disabled={!onPauses} onClick={onPauses}>{t(pauses ? 'Hide pauses' : 'Show pauses')}</MenuItem>
          <MenuItem disabled={busy || !onEdit} onClick={onEdit}>{t(editing ? 'Done editing' : 'Edit text')}</MenuItem>
          <MenuItem disabled={busy || !onImport} onClick={onImport}>{t('Import SRT / VTT')}</MenuItem>
          <MenuItem disabled={!onStyles} onClick={onStyles}>{t('Caption styles')}</MenuItem>
        </Menu>
      </div>
    </div>
  </div>;
}
