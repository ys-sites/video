import { Button } from 'open-design-ui/button';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { useI18n } from '../i18n/I18n';
import { MotionIcon } from './icons';
import styles from './TemplateLibraryDialog.module.css';

export function TemplateIndustryMenu({ industries, selected = [], onSelect }: {
  industries: string[]; selected?: string[]; onSelect: (value?: string) => void;
}) {
  const { t } = useI18n();
  if (!industries.length) return null;
  return <Menu modal={false} container={null} align="end" aria-label={t('By industry')} className={styles.discoveryMenu}
    trigger={<Button type="button" variant="secondary" className="om-button om-gallery-dropdown"><span>{selected.length === 1 ? t(selected[0]) : t('By industry')}</span>{selected.length > 1 && <span className={styles.filterCount}>{selected.length}</span>}<MotionIcon name="chevron-down" size={16} /></Button>}>
    <MenuRadioGroup value={selected.length === 1 ? selected[0] : selected.length ? '' : 'all'} onValueChange={value => onSelect(value === 'all' ? undefined : value)}>
      <MenuRadioItem value="all" closeOnClick>{t('All industries')}</MenuRadioItem>
      {industries.map(value => <MenuRadioItem key={value} value={value} closeOnClick>{t(value)}</MenuRadioItem>)}
    </MenuRadioGroup>
  </Menu>;
}
