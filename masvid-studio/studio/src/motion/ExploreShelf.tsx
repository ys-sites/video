import type { ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import { CategoryStrip } from './CategoryStrip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';

export function ExploreShelf<T extends string>({ title, categoriesLabel, categories, selected, onCategory, action, onOpen, renderCategory, filters, extraAction, plainCategoryArrows, children }: {
  title: string; categoriesLabel: string; categories: readonly (readonly [T, string])[]; selected: T;
  renderCategory?: (id: T) => ReactNode; onCategory: (id: T) => void; action: string; onOpen: (trigger: HTMLButtonElement) => void;
  filters?: ReactNode; extraAction?: ReactNode; plainCategoryArrows?: boolean; children: ReactNode;
}) {
  const { t } = useI18n();
  return <section className="om-explore-shelf" aria-label={t(title)}>
    <header className="om-discovery-heading">
      <h2>{t(title)}</h2>
      <div className="om-control-row">
        <Button type="button" variant="secondary" className="om-button" onClick={event => onOpen(event.currentTarget)}>{t(action)}<RemixIcon name="arrow-right-line" size={16} /></Button>
        {extraAction}
      </div>
    </header>
    <div className="om-shelf-toolbar">
      <CategoryStrip label={categoriesLabel} selection={selected} plainArrows={plainCategoryArrows}>
        {categories.map(([value, name]) => <Button key={value} type="button" variant="secondary" className="om-button om-filter-pill" aria-label={t(name)} aria-pressed={selected === value}
          onClick={() => onCategory(value)}>{renderCategory?.(value) ?? t(name)}</Button>)}
      </CategoryStrip>
      {filters}
    </div>
    {children}
  </section>;
}
