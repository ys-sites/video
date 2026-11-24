import { useFileManagerContextOptional } from '../../contexts/FileManagerContext';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { Select } from '../ui/Select';

/** Only show a scene picker when the project actually has other compositions. */
export function ExportCompositionSelect({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const files = useFileManagerContextOptional(), { t } = useI18n();
  const compositions = [...new Set([value, ...(files?.compositions || [])])];
  if (compositions.length < 2) return null;
  return <div className="flex flex-col gap-1 px-3 pb-3">
    <span className="text-step-11 text-text-3">{t('Export scene')}</span>
    <Select label={t('Export scene')} value={value} disabled={disabled} options={compositions.map(path => ({ value: path, label: path === 'index.html' ? t('Full video') : path.replace(/\.html$/, ''), icon: <RemixIcon name="film-line" size={14} /> }))} onCommit={onChange} />
  </div>;
}
