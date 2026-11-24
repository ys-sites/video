import { IconButton } from 'open-design-ui/icon-button';
import { Button } from 'open-design-ui/button';
import { useRef, type ReactNode } from 'react';
import { Popover } from '../components/ui/Popover';
import { Tabs, TabsList, Tab, TabPanel } from '../components/ui/Tabs';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { MotionIcon } from './icons';

export type GalleryFilters = Partial<Record<string, string[]>>;
export type GalleryFacet = { key: string; label: string; values: string[] };
export const toggleGalleryFilter = (filters: GalleryFilters, key: string, value: string) => ({ ...filters, [key]: filters[key]?.includes(value) ? filters[key]!.filter(item => item !== value) : [...(filters[key] || []), value] });
export const matchesGalleryFilters = (filters: GalleryFilters, values: (key: string) => string[]) => Object.entries(filters).every(([key, selected]) => !selected?.length || selected.some(value => values(key).includes(value)));
export const matchesGallerySearch = (query: string, text: string) => query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(term => text.toLocaleLowerCase().includes(term));

export function GallerySearchField({ label, value, onChange, className = '' }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  return <div className={`om-field om-search-field ${className}`}>
    <MotionIcon name="search" size={16} />
    <input ref={input} type="search" aria-label={label} placeholder={label} value={value} maxLength={200} onChange={event => onChange(event.target.value)} />
    {value && <IconButton variant="plain" type="button" className="om-nav-item om-search-clear" aria-label={t('Clear search')} title={t('Clear search')} onClick={() => { onChange(''); input.current?.focus(); }} icon={<MotionIcon name="close" size={14} />} />}
  </div>;
}

/** Shared template/Brand Kit draft filters. Dismissal never applies unfinished choices. */
export function GalleryFilterPopover({ groups, open, onOpenChange, draft, onChange, tab, onTabChange, query, onQueryChange, active, countLabel, onApply, onClear, hasDraft, extra, renderValue }: {
  groups: GalleryFacet[]; open: boolean; onOpenChange: (open: boolean) => void;
  draft: GalleryFilters; onChange: (filters: GalleryFilters) => void; tab: string; onTabChange: (tab: string) => void;
  query: string; onQueryChange: (query: string) => void; active: boolean; countLabel: string;
  onApply: () => void; onClear: () => void; hasDraft: boolean;
  extra?: { label: string; checked: boolean; onChange: (value: boolean) => void };
  renderValue?: (key: string, value: string) => ReactNode;
}) {
  const { t } = useI18n();
  return <Popover tooltip={t('Filters')} modal={false} open={open} onOpenChange={onOpenChange} container={null} align="end" aria-label={t('Filters')} className="om-selection-panel om-gallery-filter"
    trigger={<IconButton variant="plain" className="om-button om-icon-button om-gallery-filter-trigger" aria-label={t('Filters')} icon={<><MotionIcon name="sliders" size={16} />{active && <span className="om-status-dot" aria-hidden="true" />}</>} />}>
    <header className="om-gallery-filter-header"><strong>{t('Filters')}</strong>{extra && <button role="checkbox" aria-checked={extra.checked} className="om-gallery-filter-extra" onClick={() => extra.onChange(!extra.checked)}>{t(extra.label)}<span className="om-gallery-choice-check" aria-hidden="true">{extra.checked && <MotionIcon name="check" size={12} />}</span></button>}<Tooltip label={t('Close filters')}><IconButton variant="ghost" className="om-button om-icon-button" onClick={() => onOpenChange(false)} aria-label={t('Close filters')} icon={<MotionIcon name="close" size={17} />} /></Tooltip></header>
    <Tabs value={tab} onValueChange={value => { onTabChange(String(value)); onQueryChange(''); }} orientation="vertical" className="om-gallery-filter-body">
      <TabsList className="om-gallery-filter-tabs" aria-label={t('Filter categories')}>
        {groups.map(group => <Tab key={group.key} value={group.key} className="om-gallery-filter-tab" aria-label={t(group.label)}><span>{t(group.label)}</span>{Boolean(draft[group.key]?.length) && <span>{draft[group.key]!.length}</span>}</Tab>)}
      </TabsList>
      {groups.map(group => <TabPanel key={group.key} value={group.key} className="om-gallery-filter-panel">
        <div className="om-gallery-facet-header"><strong>{t(group.label)}</strong><Button variant="plain" className="om-nav-item" disabled={!draft[group.key]?.length} onClick={() => onChange({ ...draft, [group.key]: [] })}>{t('Clear selection')}</Button></div>
        {group.values.length > 12 && <GallerySearchField label={t('Search options…')} value={query} onChange={onQueryChange} className="om-gallery-facet-search" />}
        <div className="om-gallery-facet-grid">{group.values.filter(value => t(value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(value => {
          const checked = draft[group.key]?.includes(value) ?? false;
          return <button key={value} role="checkbox" aria-checked={checked} aria-label={t(value)} className="om-gallery-facet-choice" onClick={() => onChange(toggleGalleryFilter(draft, group.key, value))}><span className="om-gallery-facet-option">{renderValue?.(group.key, value)}<span>{t(value)}</span></span><span className="om-gallery-choice-check" aria-hidden="true">{checked && <MotionIcon name="check" size={12} />}</span></button>;
        })}</div>
        {query.trim() && !group.values.some(value => t(value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && <p className="om-muted">{t('No matching options.')}</p>}
      </TabPanel>)}
    </Tabs>
    <footer className="om-gallery-filter-footer"><Button variant="plain" className="om-nav-item" disabled={!hasDraft} onClick={onClear}>{t('Clear filters')}</Button><span role="status" aria-live="polite" aria-atomic="true">{countLabel}</span><Button variant="ghost" className="om-button h-auto" data-primary onClick={onApply}>{t('Apply filters')}<MotionIcon name="arrow-right" size={14} /></Button></footer>
  </Popover>;
}
export function GallerySortMenu({ value, options, onChange }: { value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  const { t } = useI18n();
  return <Menu modal={false} container={null} align="end" aria-label={t('Sort')} className="om-selection-panel om-menu-panel" trigger={<Button variant="plain" className="om-button om-gallery-sort" aria-label={t('Sort')}><span>{t(options.find(([key]) => key === value)?.[1] || 'Sort')}</span><MotionIcon name="chevron-down" size={14} /></Button>}><MenuRadioGroup value={value} onValueChange={onChange}>{options.map(([key, label]) => <MenuRadioItem key={key} value={key}>{t(label)}</MenuRadioItem>)}</MenuRadioGroup></Menu>;
}
