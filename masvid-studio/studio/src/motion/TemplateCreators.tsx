import { Button } from 'open-design-ui/button';
import { useMemo, type ReactNode } from 'react';
import type { GalleryTemplate } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { Skeleton } from '../components/ui/Skeleton';
import { TemplateGalleryCard, TemplatePoster } from './TemplateGalleryCard';
import { templateCreators } from './templateCredits';
import styles from './TemplateLibraryDialog.module.css';

type Props = {
  catalog: GalleryTemplate[];
  creator: string | null;
  query: string;
  searchActions: ReactNode;
  works: GalleryTemplate[];
  loading: boolean;
  error: string;
  retry: () => void;
  choose: (id: string | null) => void;
  open: (work: GalleryTemplate) => void;
  active: ReadonlySet<string>;
  onPriority: (id: string | null) => void;
};

export function TemplateCreators({ catalog, creator, query, searchActions, works, loading, error, retry, choose, open, active, onPriority }: Props) {
  const { t, locale } = useI18n();
  const credits = useMemo(() => templateCreators(catalog, locale), [catalog, locale]);
  const current = credits.find(entry => entry.id === creator);
  const matches = credits.filter(entry => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <main className={styles.results} aria-busy={loading}>
    {creator && <Button variant="plain" className="om-nav-item" onClick={() => choose(null)}>← {t('Creators')}</Button>}
    <header className={`om-gallery-intro om-gallery-page-intro ${styles.creatorIntro}`}>
      <h1>{current?.name ?? t('Creators')}</h1>
      <p>{current ? t(current.source) + ' · ' + t('{count} templates', { count: current.count }) : t('Browse catalogue credits and the accounts that published the original work.')}</p>
      {searchActions}
    </header>
    {error ? <div className={styles.empty} role="alert">{error}<Button variant="ghost" className="om-button h-auto" onClick={retry}>{t('Retry')}</Button></div>
      : loading && !catalog.length ? <div className={styles.creatorGrid} aria-label={t('Loading templates…')} role="status">{[0, 1, 2].map(i => <Skeleton key={i} className={styles.creatorPoster} />)}</div>
      : creator ? <>{!works.length && <p className="om-muted">{t(current ? 'No matching templates. Try another name, creator or style.' : 'This creator has no credited work in this catalogue.')}</p>}
        <div className={`${styles.grid} ${styles.creatorWorks}`}>{works.map(work => <TemplateGalleryCard key={work.id} template={work} onSelect={open} active={active.has(work.id)} onPriority={onPriority} />)}</div></>
      : <div className={styles.creatorGrid}>{!matches.length && <p className="om-muted">{t('No matches')}</p>}
        {matches.map(entry => <Button variant="plain" key={entry.id} className="om-scene-tile" onClick={() => choose(entry.id)}>
          <span className={styles.creatorPoster}><TemplatePoster template={entry.work} /></span>
          <strong>{entry.name}</strong><small className="om-muted">{t(entry.source)} · {t('{count} templates', { count: entry.count })}</small>
        </Button>)}</div>}
  </main>;
}
