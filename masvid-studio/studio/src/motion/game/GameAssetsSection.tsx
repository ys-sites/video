import { Button } from 'open-design-ui/button';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GameCard } from '../../../../shared/game-contract';
import { findTechniqueStudio } from '../../../../shared/studio-catalog';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { Skeleton } from '../../components/ui/Skeleton';
import { initializeWorkspaceHistory, workspaceHistoryIndex, writeWorkspaceHistory } from '../../utils/workspaceHistory';
import { workspacePageHref } from '../workspacePageRouting';
import { coverUrl, gameApi, genreCovers, genreLabels, settingLabels, styleLabels } from './gameCatalog';

/**
 * Games the user made in Game Studio, shown in Assets. They are read from the game catalogue and merged into the
 * Assets view only; they are not stored in the asset library.
 */
export type MyGames = { games: GameCard[] | null; error: boolean; retry: () => void };

// Drafts change state while the Agent builds them, so the list refreshes while Assets is visible.
const refreshMs = 5000;

export function useMyGames(active: boolean): MyGames {
  const [games, setGames] = useState<GameCard[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false, pending = false;
    const load = async () => {
      if (pending || document.hidden) return; pending = true;
      try {
        const { games: all } = await gameApi.catalog();
        if (cancelled) return;
        const mine = all.filter(game => game.source === 'mine').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setGames(current => JSON.stringify(current) === JSON.stringify(mine) ? current : mine);
        setError(false);
      } catch { if (!cancelled) setError(true); } finally { pending = false; }
    };
    void load();
    const timer = setInterval(() => void load(), refreshMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, attempt]);
  return { games, error, retry: useCallback(() => { setError(false); setAttempt(value => value + 1); }, []) };
}

// Titles follow Game Studio: the game's own translation, 做同款 drafts and option-only drafts are shown readably.
import { useGameTitle } from './GameStudio';

const statusLabels: Record<GameCard['status'], string> = { draft: 'Waiting for your Agent', building: 'Agent is running', ready: 'Ready to publish', failed: 'Not finished', published: 'Published' };

/** Game Studio opens the game's detail page from `/studios/game?game=<id>` (legacy `?page=game&game=<id>` redirects). */
export function openGameStudio(id?: string) {
  const studio = findTechniqueStudio('game');
  if (!studio) return;
  const target = new URL(workspacePageHref(location.href, { specialty: studio, skill: null, templates: false }), location.href);
  target.searchParams.delete('game');
  if (id) target.searchParams.set('game', id);
  initializeWorkspaceHistory();
  const index = workspaceHistoryIndex();
  // Back returns to Assets, like other pages opened from a page.
  writeWorkspaceHistory(target, false, { page: index === null ? null : { href: location.href, index }, settings: null });
}

function GameAssetTile({ game }: { game: GameCard }) {
  const { t } = useI18n();
  const title = useGameTitle()(game);
  const cover = coverUrl(game) ?? genreCovers[game.genre];
  return <div className="om-asset-tile om-card">
    <Button variant="plain" className="om-nav-item om-asset-open" aria-label={t('Open {title} in Game Studio', { title })} onClick={() => openGameStudio(game.id)}>
      <span className="om-asset-preview om-media-surface" data-kind="game">
        {cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : <RemixIcon name="gamepad-line" size={32} />}
        <span className="om-asset-game-status" data-tone={game.status}>{game.status === 'building' && <RemixIcon name="loader-4-line" size={13} />}{t(statusLabels[game.status])}</span>
      </span>
      <span className="om-asset-tile-caption"><strong title={title}>{title}</strong><span className="om-muted">{t(genreLabels[game.genre])}{game.multiplayer ? ` · ${t('Multiplayer')}` : ''}</span></span>
    </Button>
  </div>;
}

const matches = (title: string, query: string) => !query.trim() || title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

/** The Games category: every game the user made, or a way into Game Studio when there are none. */
export function GameAssetsGrid({ data, query }: { data: MyGames; query: string }) {
  const { t } = useI18n();
  const title = useGameTitle();
  if (data.error && !data.games) return <div className="om-empty"><RemixIcon name="error-warning-line" size={32} /><p>{t('Could not load games')}</p><Button variant="ghost" className="om-button h-auto" onClick={data.retry}>{t('Retry')}</Button></div>;
  if (!data.games) return <div className="om-asset-grid">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="om-asset-loading-card" />)}</div>;
  if (!data.games.length) return <div className="om-empty om-asset-empty"><RemixIcon name="gamepad-line" size={40} /><h2 className="om-subtitle">{t('No games yet')}</h2>
    <p className="om-muted">{t('Games you make in Game Studio appear here, including drafts your Agent is still building.')}</p>
    <Button variant="ghost" className="om-button h-auto" data-primary onClick={() => openGameStudio()}><RemixIcon name="gamepad-line" size={16} />{t('Go to Game Studio')}</Button></div>;
  const shown = data.games.filter(game => matches(title(game), query));
  if (!shown.length) return <div className="om-empty om-asset-empty"><RemixIcon name="search-line" size={40} /><h2 className="om-subtitle">{t('No matching games')}</h2></div>;
  return <div className="om-asset-grid">{shown.map(game => <GameAssetTile key={game.id} game={game} />)}</div>;
}

// Matches the gallery grid in assets.css: 200px minimum columns with a 20px gap.
const tileMin = 200, tileGap = 20;

/** The All category: one row of the newest games above the library, hidden when there are none. */
export function GameAssetsRow({ data, onViewAll }: { data: MyGames; onViewAll: () => void }) {
  const { t } = useI18n();
  const row = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const count = data.games?.length ?? 0;
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setColumns(Math.max(1, Math.floor((element.clientWidth + tileGap) / (tileMin + tileGap))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count > 0]);
  if (!data.games?.length) return null;
  return <section className="om-asset-games" aria-label={t('Games')}>
    <header className="om-asset-games-heading"><h2 className="om-subtitle">{t('Games')}</h2>
      <Button variant="plain" className="om-nav-item" data-compact onClick={onViewAll}>{t('View all')}<RemixIcon name="arrow-right-s-line" size={14} /></Button></header>
    <div ref={row} className="om-asset-grid">{data.games.slice(0, columns).map(game => <GameAssetTile key={game.id} game={game} />)}</div>
  </section>;
}
