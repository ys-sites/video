import { Button } from 'open-design-ui/button';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { GalleryTemplate } from '../../../shared/catalog';
import { blackFridaySkillIds, blackFridayStages, type BlackFridayStageId } from '../../../shared/black-friday-collection';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { BackToExploreButton } from './BackToExploreButton';
import { BlackFridaySkillCarousel } from './BlackFridaySkillCarousel';
import { motionSkills } from './skillCatalog';
import { TemplateGalleryCard } from './TemplateGalleryCard';
import styles from './BlackFridayCollection.module.css';

export type BlackFridayFilter = BlackFridayStageId | null;
const featuredSkills = blackFridaySkillIds.flatMap(id => motionSkills.filter(skill => skill.id === id));

export function BlackFridayCollection({ templates, featuredPreviewsEnabled, selectedFilter, onFilterChange, searchField, emptyResults, active, onBack, onPreview, onPriority, onOpenSkill, onStartScenario }: {
  templates: readonly GalleryTemplate[];
  featuredPreviewsEnabled: boolean;
  selectedFilter: BlackFridayFilter;
  onFilterChange: (filter: BlackFridayFilter) => void;
  searchField: ReactNode;
  emptyResults: ReactNode;
  active: Set<string>;
  onBack: () => void;
  onPreview: (template: GalleryTemplate, trigger: HTMLButtonElement) => void;
  onPriority: (id: string | null) => void;
  onOpenSkill?: (id: string, trigger: HTMLButtonElement) => void;
  onStartScenario?: () => void;
}) {
  const { t } = useI18n();
  const prefix = useId();
  const collection = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [minimumHeight, setMinimumHeight] = useState<number>();
  const showFeaturedSkills = onOpenSkill !== undefined && featuredSkills.length > 0;
  useEffect(() => title.current?.focus({ preventScroll: true }), []);

  const chooseFilter = (filter: BlackFridayFilter) => {
    if (filter === selectedFilter) return;
    const content = collection.current;
    const scroller = content?.closest('dialog');
    if (content && scroller) {
      // Keep the visible area scrollable when the new results are shorter.
      const contentTop = content.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop;
      setMinimumHeight(Math.ceil(scroller.clientHeight - contentTop));
    }
    onFilterChange(filter);
  };

  return <main ref={collection} className={styles.collection} style={{ minBlockSize: minimumHeight }} aria-labelledby={prefix + 'title'} data-black-friday="">
    <header className={styles.banner} data-featured-skills={showFeaturedSkills ? '' : undefined}>
      <div className={styles.bannerBackdrop} aria-hidden="true">
        <div className={styles.bannerArtwork}>BLACK</div>
      </div>
      <div className={styles.bannerNav}>
        <BackToExploreButton onClick={onBack} />
      </div>
      <div className={styles.bannerCopy}>
        <h1 id={prefix + 'title'} ref={title} tabIndex={-1}>{t('Black Friday')}</h1>
        <p>{t('Find a reference from the first teaser to the last call.')}</p>
        {onStartScenario && (
          <Button variant="ghost" type="button" className="om-button h-auto" data-primary="media" onClick={onStartScenario}>
            {t('Start Black Friday workflow')}<RemixIcon name="arrow-right-line" size={16} />
          </Button>
        )}
      </div>
    </header>
    <div className={styles.collectionBody}>
      {showFeaturedSkills && <BlackFridaySkillCarousel skills={featuredSkills}
        previewsEnabled={featuredPreviewsEnabled} onOpenSkill={onOpenSkill} />}
      <div className={styles.toolbar}>
        <h2 className={styles.filterTitle}>{t('Black Friday templates')}</h2>
        <nav className={styles.filters} aria-label={t('Black Friday collection')}>
          <Button variant="plain" type="button" className="om-button om-filter-pill" aria-pressed={selectedFilter === null} onClick={() => chooseFilter(null)}>{t('All')}</Button>
          {blackFridayStages.map(stage => <Button variant="plain" key={stage.id} type="button" className="om-button om-filter-pill"
            aria-pressed={selectedFilter === stage.id} onClick={() => chooseFilter(stage.id)}>{t(stage.title)}</Button>)}
        </nav>
        <div className={`om-control-row om-gallery-header-actions ${styles.searchRow}`}>{searchField}</div>
      </div>
      {templates.length > 0 ? <div className="om-gallery-masonry">
        {templates.map(item => <TemplateGalleryCard key={item.id} template={item}
          onSelect={onPreview} active={active.has(item.id)} onPriority={onPriority} showAvatar={false} />)}
      </div> : emptyResults}
    </div>
  </main>;
}
