import { Button } from "open-design-ui/button";
import { IconButton } from "open-design-ui/icon-button";
import { Tooltip } from "../components/ui/Tooltip";
import { useMemo, useState, type RefObject } from 'react';
import { isEditableTemplate, type GalleryTemplate } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { Tabs, TabsList, Tab, TabPanel } from '../components/ui/Tabs';
import { Skeleton } from '../components/ui/Skeleton';
import { RemixIcon } from '../icons/RemixIcons';
import { TemplateGalleryCard } from './TemplateGalleryCard';
import { purposeOrder, discoveryPurposes } from './templateDiscoveryTaxonomy';
import { useTemplatePlayback } from './useTemplatePlayback';
import { useCoveredTemplates } from './useCoveredTemplates';

export function McpTemplateShowcase({ scroller, enabled, canCopy, onCopy, openLibrary, onCategory }: {
  scroller: RefObject<HTMLElement | null>; enabled: boolean; canCopy: boolean;
  onCategory?: (category: string) => void;
  onCopy: (template: GalleryTemplate) => void;
  openLibrary: (trigger?: HTMLElement, template?: GalleryTemplate) => void;
}) {
  const { t, locale } = useI18n();
  const { catalog, failed, retry } = useCoveredTemplates(locale);
  const [category, setCategory] = useState('all');
  const [priority, setPriority] = useState<string | null>(null);
  const categories = useMemo(() => ['all', ...purposeOrder.filter(purpose => catalog?.some(item => discoveryPurposes(item).includes(purpose)))], [catalog]);
  const selected = categories.includes(category) ? category : 'all';
  const visible = useMemo(() => (catalog ?? []).filter(item => selected === 'all' || discoveryPurposes(item).includes(selected)).slice(0, 6), [catalog, selected]);
  const active = useTemplatePlayback(scroller, `${selected}:${visible.map(item => item.id).join(',')}`, enabled, true, priority);
  return <section className="om-mcp-section" aria-labelledby="mcp-templates" id="mcp-template-section">
    <div className="om-mcp-section-heading"><div><p className="om-mcp-eyebrow">{t('Start with something you can build on')}</p><h2 id="mcp-templates">{t('Bring a template into your Agent')}</h2><p className="om-muted">{t('Use an editable template or ask your Agent to recreate a reference. Preview here, copy the instruction, or open the full library.')}</p></div><Button variant="ghost" className="om-button h-auto" onClick={event => openLibrary(event.currentTarget)}>{t('View all templates')}<RemixIcon name="arrow-right-line" size={16} /></Button></div>
    <Tabs value={selected} onValueChange={value => { setCategory(String(value)); setPriority(null); onCategory?.(String(value)); }}>
      <div className="om-mcp-template-toolbar"><TabsList className="om-mcp-category-tabs" aria-label={t('Template categories')}>{categories.map(value => <Tab key={value} value={value}>{t(value === 'all' ? 'Featured' : value)}</Tab>)}</TabsList></div>
      <TabPanel value={selected}>
        {failed ? <div className="om-card om-mcp-unavailable"><p>{t('Templates could not be loaded.')}</p><Button variant="ghost" className="om-button h-auto" onClick={retry}>{t('Retry')}</Button></div> : <div className="om-mcp-template-grid">{catalog === null ? [1, 2, 3, 4, 5, 6].map(key => <Skeleton key={key} className="om-mcp-template-skeleton" />) : visible.map(template => <TemplateGalleryCard key={template.id} template={template} active={active.has(template.id)} onPriority={setPriority} onSelect={(item, trigger) => openLibrary(trigger, item)} footer={<div className="om-mcp-template-caption"><div><h3>{template.title}</h3><span>{t(isEditableTemplate(template) ? 'Ready to edit' : 'Reference · Agent recreation')}</span></div><Tooltip label={t('Copy template prompt')} wrap><IconButton variant="plain" className="om-button" disabled={!canCopy} aria-label={t('Copy template prompt')} onClick={() => onCopy(template)} icon={<RemixIcon name="file-copy-line" size={16} />} /></Tooltip></div>} />)}</div>}
        {catalog?.length === 0 && <div className="om-mcp-unavailable"><p className="om-muted">{t('No templates available. Open the library or try again later.')}</p><Button variant="ghost" className="om-button h-auto" onClick={event => openLibrary(event.currentTarget)}>{t('Explore templates')}</Button></div>}
      </TabPanel>
    </Tabs>
  </section>;
}
