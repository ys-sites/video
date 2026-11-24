import { Button } from "open-design-ui/button";
import { IconButton } from "open-design-ui/icon-button";
import { Tooltip } from "../components/ui/Tooltip";
import { useState, type ReactNode } from 'react';
import { modelKinds, type DirectoryModel } from '../../../shared/provider-directory';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { modelKindLabel } from './ModelEditor';
import { modelDisplayLabel } from './modelMediaCapabilities';

export function ModelCatalog({ models, defaultIds, render }: { models: DirectoryModel[]; defaultIds?: ReadonlySet<string>; render: (model: DirectoryModel) => ReactNode }) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState(''), [activeKind, setActiveKind] = useState('all'), [grouped, setGrouped] = useState(true), [collapsed, setCollapsed] = useState<string[]>([]);
  const kindCounts = modelKinds.map(kind => ({ kind, count: models.filter(model => model.kind === kind).length })).filter(item => item.count > 0);
  const showKindTabs = kindCounts.length > 1;
  const resolvedKind = activeKind === 'all' || kindCounts.some(item => item.kind === activeKind) ? activeKind : 'all';
  const scopedModels = resolvedKind === 'all' ? models : models.filter(model => model.kind === resolvedKind);
  const trimmedQuery = query.trim().toLowerCase();
  const filtered = scopedModels.filter(model => !trimmedQuery || `${modelDisplayLabel(model)} ${model.label} ${model.modelId} ${model.group ?? ''}`.toLowerCase().includes(trimmedQuery)).sort((a, b) => {
    if (defaultIds?.size) {
      const aDefault = defaultIds.has(a.id) ? 0 : 1;
      const bDefault = defaultIds.has(b.id) ? 0 : 1;
      if (aDefault !== bDefault) return aDefault - bDefault;
    }
    return 0;
  });
  const hasNamedGroups = models.some(model => Boolean(model.group?.trim()));
  const showGroups = grouped && hasNamedGroups;
  const groups = Map.groupBy(filtered, model => showGroups ? model.group?.trim() || 'Ungrouped' : '');
  const groupKeys = [...groups.keys()];
  const allCollapsed = groupKeys.length > 0 && groupKeys.every(group => collapsed.includes(group));
  const showToolbar = showKindTabs || models.length > 1 || hasNamedGroups;
  return <>
    {showToolbar && <>
      <div className="om-model-toolbar">
        {showKindTabs && <div className="om-model-kind-tabs" role="tablist" aria-label={t('Model type')}>
          <Button variant="plain" role="tab" aria-selected={resolvedKind === 'all'} className="om-model-kind-tab" onClick={() => setActiveKind('all')}>
            <span>{t('All')}</span><small>{models.length}</small>
          </Button>
          {kindCounts.map(({ kind, count }) => (
            <Button variant="plain" role="tab" key={kind} aria-selected={resolvedKind === kind} className="om-model-kind-tab" onClick={() => setActiveKind(kind)}>
              <span>{modelKindLabel(kind, t, locale)}</span><small>{count}</small>
            </Button>
          ))}
        </div>}
        <div className="om-model-search-row">
          <label className="om-field"><RemixIcon name="search-line" size={15} /><input type="search" aria-label={t('Search models')} placeholder={t('Search models…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
          {hasNamedGroups && <div className="om-model-filter-controls">
            <Tooltip label={t('Group models')} wrap><IconButton variant="ghost" className="om-button om-icon-button" aria-label={t('Group models')} aria-pressed={grouped} onClick={() => setGrouped(value => !value)} icon={<RemixIcon name={grouped ? 'folder-open-line' : 'folder-line'} size={15} />} /></Tooltip>
            {showGroups && <Tooltip label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} wrap><IconButton variant="ghost" className="om-button om-icon-button" aria-label={t(allCollapsed ? 'Expand all groups' : 'Collapse all groups')} onClick={() => setCollapsed(allCollapsed ? [] : groupKeys)} icon={<RemixIcon name={allCollapsed ? 'arrow-right-s-line' : 'arrow-down-s-line'} size={16} />} /></Tooltip>}
          </div>}
        </div>
      </div>
    </>}
    <div className="om-model-list">{[...groups].map(([group, values]) => <section key={group}>{showGroups && <Button variant="plain" className="om-nav-item om-model-group" aria-expanded={!collapsed.includes(group)} onClick={() => setCollapsed(current => current.includes(group) ? current.filter(value => value !== group) : [...current, group])}><RemixIcon name={collapsed.includes(group) ? 'arrow-right-s-line' : 'arrow-down-s-line'} size={14} /><span>{group === 'Ungrouped' ? t(group) : group}</span><small className="om-muted">{values.length}</small></Button>}{(!showGroups || !collapsed.includes(group)) && values.map(render)}</section>)}
      {!filtered.length && <div className="om-empty"><RemixIcon name="box-3-line" size={32} /><h3 className="om-subtitle">{t(models.length ? 'No matching models' : 'Choose your models')}</h3><p className="om-muted">{t(models.length ? 'Try another search or clear the filters.' : 'Sync the provider catalogue or add a model by its exact ID.')}</p></div>}
    </div>
  </>;
}
