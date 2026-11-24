import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gameGenres, gameSettings, gameStyles, type GameCard, type GameCreated, type GameGenre, type GameSetting, type GameStyle } from '../../../../shared/game-contract';
import { preservePresentation } from '../../../../shared/workspace-url';
import { StudioToastViewport } from '../../components/StudioToastViewport';
import { useToast } from '../../hooks/useToast';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { WorkspaceBack } from '../WorkspaceBack';
import { MotionIcon } from '../icons';
import { projectHref } from '../workspaceRouting';
import { Tooltip } from '../../components/ui/Tooltip';
import { bundledGames, communityGames, communityRemixPrompt, composeBrief, coverUrl, formatPlays, gameApi, gameSource, storedInstruction, genreCovers, genreLabels, settingCovers, styleCovers, genrePlaceholders, isLocalOnly, playableUrl, rememberInstruction, settingLabels, styleLabels } from './gameCatalog';
import './gameStudio.css';

type Menu = 'genre' | 'style' | 'setting';
type Sort = 'relevance' | 'plays' | 'newest';
const pending = (game: GameCard) => game.source === 'mine' && (game.status === 'draft' || game.status === 'building');

/**
 * Game Studio. The page is the game market; the composer is docked at the bottom. Picking a genre, style and
 * setting (and optionally one line of text) creates a local game draft and an instruction for the user's Agent,
 * which builds, validates and publishes the game through the OpenMotion MCP game tools. Drafts refresh until the
 * Agent finishes, so their state changes here without reloading.
 */
export function GameStudio({ onExplore, onOpenMcp }: { onExplore: () => void; onOpenMcp: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [genre, setGenre] = useState<GameGenre | null>('shooter');
  const [style, setStyle] = useState<GameStyle | null>(null);
  const [setting, setSetting] = useState<GameSetting | null>(null);
  const [multiplayer, setMultiplayer] = useState(false);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  // Portrait games default to a playable ad; it is single-player, so it and Multiplayer switch each other off.
  const [playableAd, setPlayableAd] = useState(true);
  const adBuild = orientation === 'portrait' && playableAd;
  const [prompt, setPrompt] = useState('');
  const [menu, setMenu] = useState<Menu>('genre');
  const [submitting, setSubmitting] = useState(false);
  const [games, setGames] = useState<GameCard[]>(bundledGames);
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GameGenre | 'all' | 'portrait'>('all');
  const [sort, setSort] = useState<Sort>('relevance');
  // The open project is tracked by id so polling updates reach it.
  // ?game=<id> opens that game's detail page directly (used by links from Assets).
  const [openId, setOpenIdState] = useState<string | null>(() => new URLSearchParams(location.search).get('game'));
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set('game', id); else url.searchParams.delete('game');
    history.replaceState(history.state, '', url);
  };
  // The full composer sits at the top of the page. Once it scrolls away, a docked copy floats over the bottom edge: one line
  // while scrolling down, full size while scrolling up. It overlays the page, so its size never moves the content.
  const [scrolledUp, setScrolledUp] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  const hero = useRef<HTMLElement>(null);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [focused, setFocused] = useState(false);
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const expanded = toggled ?? (scrolledUp || focused);
  const notify = (message: string, tone: 'info' | 'error') => toast.showToast(message, tone);

  const statuses = useRef(new Map<string, GameCard['status']>());
  const loaded = useRef(false), openRef = useRef(openId);
  openRef.current = openId;
  const load = () => gameApi.catalog().then(catalog => {
    // A draft that appears without this page creating it was started by an Agent from its own chat (openmotion_game_create).
    // Jump to it when nothing else is open; otherwise point to the side list without interrupting the game being played.
    if (loaded.current) {
      const fresh = catalog.games.find(game => game.source === 'mine' && pending(game) && !statuses.current.has(game.id));
      if (fresh) {
        if (!openRef.current) setOpenId(fresh.id);
        else notify(t('Your Agent started {title}. Find it in My games.', { title: fresh.title }), 'info');
      }
    }
    loaded.current = true;
    // Announce drafts that the Agent finished or abandoned since the last refresh.
    for (const game of catalog.games) {
      const before = statuses.current.get(game.id);
      if (before && before !== game.status && game.source === 'mine') {
        if (game.status === 'published' || game.status === 'ready') notify(t('{title} is ready to play.', { title: game.title }), 'info');
        if (game.status === 'failed') notify(t('{title} could not be finished. Hand it to your Agent again.', { title: game.title }), 'error');
      }
      statuses.current.set(game.id, game.status);
    }
    setGames(catalog.games); setOffline(false);
  }).catch(() => { setGames(current => current.some(game => game.source === 'mine') ? current : bundledGames); setOffline(true); });
  useEffect(() => { void load(); }, []);
  // Poll every 4 s while the page is visible, so drafts an Agent starts from its chat show up and open on their own.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = setInterval(tick, 4000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  useEffect(() => {
    const scroller = root.current;
    if (!scroller) return;
    let last = scroller.scrollTop, settledAt = 0;
    const onScroll = () => {
      const top = scroller.scrollTop;
      // Ignore small movements and anything within 250 ms of the previous change so the dock never oscillates.
      if (performance.now() - settledAt < 250) { last = top; return; }
      if (top < last - 24) { setScrolledUp(true); settledAt = performance.now(); }
      else if (top > last + 24) { setScrolledUp(false); settledAt = performance.now(); }
      else return;
      if (Math.abs(top - last) > 6) setToggled(null);
      last = top;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new IntersectionObserver(([entry]) => { setHeroVisible(entry.isIntersecting); if (entry.isIntersecting) { setScrolledUp(false); setToggled(null); } }, { root: scroller, threshold: 0.15 });
    if (hero.current) observer.observe(hero.current);
    return () => { scroller.removeEventListener('scroll', onScroll); observer.disconnect(); };
  }, []);
  const update = (card: GameCard) => setGames(list => list.map(game => game.id === card.id ? card : game));

  const brief = composeBrief({ prompt, genre, style, setting, multiplayer });
  const failure = (error: unknown) => error instanceof TypeError || offline
    ? t('The local game service is not available. Update OpenMotion and try again.')
    : t('The game could not be created: {reason}', { reason: (error as Error).message });
  const started = (created: GameCreated) => {
    rememberInstruction(created.game.id, created.agentInstruction);
    statuses.current.set(created.game.id, created.game.status);
    setGames(list => [created.game, ...list.filter(game => game.id !== created.game.id)]);
    setOpenId(created.game.id);
  };
  const submit = async () => {
    if (!brief || submitting) return;
    setSubmitting(true);
    // Choosing options without typing is enough to start: the composed brief becomes the prompt.
    try { started(await gameApi.create({ prompt: prompt.trim() || brief, genre, style, setting, multiplayer, orientation, playableAd: adBuild })); setPrompt(''); }
    catch (error) { notify(failure(error), 'error'); }
    finally { setSubmitting(false); }
  };
  const remix = async (game: GameCard) => {
    // Community games are not copied: a new original game is briefed from their genre, style and description.
    try { started(game.external
      ? await gameApi.create({ prompt: communityRemixPrompt(game), genre: game.genre, style: game.style, setting: game.setting, multiplayer: game.multiplayer, orientation: game.orientation ?? 'landscape' })
      : await gameApi.remix(game.id)); }
    catch (error) { notify(failure(error), 'error'); }
  };
  const open = (game: GameCard) => {
    // Sites that refuse to be embedded open in a new window; everything else plays in the project view.
    setOpenId(game.id);
  };

  // Popular games from social media lead the market, followed by the built-in templates and the user's games.
  const all = useMemo(() => [...communityGames, ...games], [games]);
  const opened = openId ? all.find(game => game.id === openId) ?? null : null;
  const fanned = all.filter(game => game.source !== 'mine' && game.status === 'published' && coverUrl(game)).slice(0, 5);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    // Explore lists templates and community games only; games made here live in Assets → Games.
    const list = all.filter(game => game.source !== 'mine' && game.status === 'published'
      && (category === 'all' || (category === 'portrait' ? game.orientation === 'portrait' : game.genre === category))
      // Search the shown (localized) title and description as well as the originals, e.g. 小王子 and Little Prince.
      && (!needle || [game.title, game.description, game.i18n?.[locale]?.title, game.i18n?.[locale]?.description, t(genreLabels[game.genre])].some(text => text?.toLocaleLowerCase().includes(needle))));
    return sort === 'plays' ? [...list].sort((a, b) => b.plays - a.plays) : sort === 'newest' ? [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : interleavePortrait(list);
  }, [all, category, query, sort, t, locale]);
  // The user's own games, newest first, live in the side list like projects in the Motion editor.
  const mine = useMemo(() => games.filter(game => game.source === 'mine').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [games]);
  const browsing = category === 'all' && !query.trim();
  const rows = [
    ...(browsing ? [
      { id: 'featured', title: t('Templates'), icon: 'gamepad-line', games: visible },
    ] : [{ id: 'all', title: category === 'all' ? t('All games') : category === 'portrait' ? t('Portrait games') : t('{genre} games', { genre: t(genreLabels[category]) }), icon: 'gamepad-line', games: visible }]),
  ];

  const options: { id: string; label: string; cover?: string | null; selected: boolean; pick: () => void }[] = menu === 'genre'
    ? gameGenres.map(id => ({ id, label: t(genreLabels[id]), cover: genreCovers[id], selected: genre === id, pick: () => setGenre(genre === id ? null : id) }))
    : menu === 'style' ? gameStyles.map(id => ({ id, label: t(styleLabels[id]), cover: styleCovers[id], selected: style === id, pick: () => { setStyle(style === id ? null : id); setMenu('genre'); } }))
    : gameSettings.map(id => ({ id, label: t(settingLabels[id]), cover: settingCovers[id], selected: setting === id, pick: () => { setSetting(setting === id ? null : id); setMenu('genre'); } }));

  // The same composer renders inline at the top of the page and, once that scrolls away, docked at the bottom.
  const renderComposer = (mode: 'hero' | 'dock') =>
    <div className="om-game-composer" data-mode={mode} onFocus={() => mode === 'dock' && setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
        {mode === 'dock' && <IconButton variant="ghost" className="motion-icon-button om-game-dock-toggle" aria-expanded={expanded} aria-label={expanded ? t('Collapse') : t('Expand')}
          onClick={() => { setToggled(!expanded); if (expanded) { setFocused(false); setMenu('genre'); input.current?.blur(); } }} icon={<RemixIcon name={expanded ? 'arrow-down-s-line' : 'arrow-up-s-line'} size={18} />} />}
        <div className="om-game-options" role="group" aria-label={menu === 'genre' ? t('Genre') : menu === 'style' ? t('Style') : t('Setting')} data-menu={menu} data-collapsed={mode === 'dock' && !expanded}>
          {options.map(option => <Button key={option.id} variant="plain" className="om-game-option" aria-pressed={option.selected} onClick={option.pick}>
            {option.cover !== undefined && <span className="om-game-option-art">{option.cover && <img src={option.cover} alt="" />}</span>}
            <span>{option.label}</span>
          </Button>)}
        </div>
        <div className="om-game-input">
          <textarea ref={mode === 'hero' ? input : undefined} rows={3} maxLength={600} value={prompt} placeholder={t(genrePlaceholders[genre ?? 'none'])} aria-label={t('Describe your game')}
            onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
          <div className="om-game-input-bar">
            {genre && <span className="om-game-chip" data-active="true"><span className="om-game-chip-art">{genreCovers[genre] && <img src={genreCovers[genre]!} alt="" />}</span>{t(genreLabels[genre])}
              <IconButton variant="plain" className="om-game-chip-clear" aria-label={t('Remove genre')} onClick={() => setGenre(null)} icon={<RemixIcon name="close-line" size={14} />} /></span>}
            <Button variant="plain" className="om-game-chip" aria-expanded={menu === 'style'} data-active={Boolean(style)} onClick={() => { setToggled(null); setMenu(menu === 'style' ? 'genre' : 'style'); }}>
              <RemixIcon name="brush-line" size={15} />{style ? t(styleLabels[style]) : t('Style')}</Button>
            <Button variant="plain" className="om-game-chip" aria-expanded={menu === 'setting'} data-active={Boolean(setting)} onClick={() => { setToggled(null); setMenu(menu === 'setting' ? 'genre' : 'setting'); }}>
              <RemixIcon name="landscape-line" size={15} />{setting ? t(settingLabels[setting]) : t('Setting')}</Button>
            <span className="om-game-ratio" role="radiogroup" aria-label={t('Aspect ratio')}>
              {(['landscape', 'portrait'] as const).map(id => <Button key={id} variant="plain" role="radio" className="om-game-ratio-option" aria-checked={orientation === id} onClick={() => { if (id === 'portrait' && orientation !== 'portrait') { setPlayableAd(true); setMultiplayer(false); } setOrientation(id); }}>
                <RemixIcon name={id === 'portrait' ? 'smartphone-line' : 'computer-line'} size={15} />{t(id === 'portrait' ? 'Portrait' : 'Landscape')}</Button>)}
            </span>
            {orientation === 'portrait' && <label className="om-game-switch"><input type="checkbox" role="switch" checked={playableAd} onChange={event => { setPlayableAd(event.target.checked); if (event.target.checked) setMultiplayer(false); }} /><span aria-hidden="true" />{t('Playable ad')}</label>}
            <label className="om-game-switch"><input type="checkbox" role="switch" checked={multiplayer && !adBuild} onChange={event => { setMultiplayer(event.target.checked); if (event.target.checked) setPlayableAd(false); }} /><span aria-hidden="true" />{t('Multiplayer')}</label>
            <IconButton variant="ghost" className="om-game-send" aria-label={t('Start building')} disabled={!brief || submitting} onClick={() => void submit()}
              icon={<RemixIcon name={submitting ? 'loader-4-line' : 'arrow-up-line'} size={18} />} />
          </div>
        </div>
      </div>;

  return <div className="om-game-studio">
    <GameSidebar games={mine} openId={openId} onOpen={open} />
    <div className="om-game-main">
    <div ref={root} className="om-game-scroll">
    <div className="om-game-page">
      <WorkspaceBack fallback={onExplore} />
      <section className="om-game-showcase" aria-label={t('Game Studio')}>
        {/* The five most popular games fan out above the headline; each opens its detail page. */}
        <div className="om-game-fan">{fanned.map((game, index) => <Button key={game.id} variant="plain" className="om-game-fan-card" data-slot={index} aria-label={t('Play {title}', { title: game.title })} onClick={() => open(game)}>
          {coverUrl(game) && <img src={coverUrl(game)!} alt="" />}<span className="om-game-fan-label">{t(genreLabels[game.genre])}</span>
        </Button>)}</div>
        <h1 className="om-game-headline">{t('Create your own game in minutes')}</h1>
      </section>
      <section ref={hero} className="om-game-hero" aria-label={t('Describe your game')}>{renderComposer('hero')}</section>
      <section className="om-game-market" aria-label={t('Game market')}>
        <h2 className="om-title om-game-explore-title">{t('Explore templates')}</h2>
        <div className="om-game-filters">
          <div className="om-game-genres" role="tablist" aria-label={t('Category')}>
            {(['all', ...gameGenres] as const).map(id => <Button key={id} variant="plain" role="tab" className="om-game-genre-chip" aria-selected={category === id} onClick={() => setCategory(id)}>
              {id === 'all' ? <RemixIcon name="layout-grid-line" size={15} /> : genreCovers[id] && <img src={genreCovers[id]!} alt="" />}{id === 'all' ? t('All') : t(genreLabels[id])}</Button>)}
            <Button variant="plain" role="tab" className="om-game-genre-chip" aria-selected={category === 'portrait'} onClick={() => setCategory('portrait')}><RemixIcon name="smartphone-line" size={15} />{t('Portrait')}</Button>
          </div>
          <span className="om-game-selects">
            <span className="om-field om-game-search"><RemixIcon name="search-line" size={15} /><input value={query} placeholder={t('Search')} aria-label={t('Search games')} onChange={event => setQuery(event.target.value)} /></span>
            <label className="om-field"><RemixIcon name="sort-desc" size={15} /><select value={sort} aria-label={t('Sort')} onChange={event => setSort(event.target.value as Sort)}>
              <option value="relevance">{t('Relevance')}</option><option value="plays">{t('Most played')}</option><option value="newest">{t('Newest')}</option></select></label>
          </span>
        </div>
        {offline && <p className="om-muted om-game-note">{t('Showing the built-in games. Your games appear once the local game service is running.')}</p>}
        {rows.filter(row => row.games.length || row.id === 'all').map(row => <section key={row.id} className="om-game-row" aria-label={row.title}>
          {row.id !== 'featured' && <header><h2 className="om-subtitle"><RemixIcon name={row.icon} size={16} />{row.title}</h2></header>}
          {row.games.length ? <GameMasonry games={row.games} render={game => <GameTile key={game.id} game={game} locale={locale} onOpen={() => open(game)} />} />
            : <div className="om-discovery-empty"><span>{t('No games match these filters.')}</span></div>}
        </section>)}
      </section>
    </div>

    </div>
    {/* Kept mounted so it can slide in and out; inert while the inline composer is on screen. */}
    <div className="om-game-dock" data-visible={!heroVisible} data-expanded={expanded} inert={heroVisible || undefined} aria-hidden={heroVisible || undefined}>{renderComposer('dock')}</div>
    </div>

    {/* The detail page covers the whole window, so it renders outside the workspace frame that clips fixed layers. */}
    {opened && createPortal(<GameProject key={opened.id} game={opened} offline={offline} onClose={() => setOpenId(null)} onRemix={() => void remix(opened)} onChange={update} onOpenMcp={onOpenMcp} notify={notify} />, document.body)}
    <StudioToastViewport toasts={toast.toasts} dismissToast={toast.dismissToast} />
  </div>;
}

/** A game's own translation of a text field, falling back to the English original. */
const localized = (game: GameCard, field: 'description' | 'controls', locale: string) => game.i18n?.[locale]?.[field] ?? game[field];

/** Drafts started from options alone carry the composed English brief as their title; show the picked options instead. */
export function useGameTitle() {
  const { t, locale } = useI18n();
  return (game: GameCard) => game.i18n?.[locale]?.title ? game.i18n[locale]!.title!
    : game.source === 'mine' && /^Make an original game in the spirit of "([^"]+)"/.test(game.title) ? t('Make one like this') + ' · ' + /"([^"]+)"/.exec(game.title)![1]
    : game.source === 'mine' && /\b(style|setting)\b|with multiplayer/.test(game.title)
    ? [game.setting && t(settingLabels[game.setting]), game.style && t(styleLabels[game.style]), t(genreLabels[game.genre]), game.multiplayer && t('Multiplayer')].filter(Boolean).join(' · ')
    : game.title;
}

/** Canonical editor URL for opening a game's rendered trailer project in Motion. */
export function trailerProjectHref(projectId: string, currentSearch = ''): string {
  return preservePresentation(projectHref(projectId), currentSearch);
}

// One-click trailers are hidden this release; the service and MCP tool stay available.
const trailersEnabled = false;

const trailerSteps: Record<'recording' | 'composing' | 'rendering' | 'ready' | 'failed', string> = {
  recording: 'Recording gameplay…', composing: 'Cutting the trailer…', rendering: 'Rendering video…', ready: 'Watch the trailer', failed: 'Make a trailer' };

// A draft waits for the user's Agent until the Agent itself sets building (openmotion_game_set_status).
const statusLabels: Partial<Record<GameCard['status'], string>> = { draft: 'Waiting for your Agent', building: 'Agent is running', ready: 'Ready to publish', failed: 'Not finished' };

function GameTile({ game, locale, onOpen }: { game: GameCard; locale: string; onOpen: () => void }) {
  const { t } = useI18n();
  const title = useGameTitle()(game);
  // A draft has no cover until the Agent makes one; the genre artwork stands in.
  const cover = coverUrl(game) ?? (game.source === 'mine' ? genreCovers[game.genre] : null);
  const status = game.source === 'mine' ? statusLabels[game.status] : undefined;
  const label = pending(game) || game.status === 'failed' ? t('Show the Agent instruction for {title}', { title }) : t('Play {title}', { title });
  return <article className="om-game-tile" data-status={game.status} data-orientation={game.orientation === 'portrait' ? 'portrait' : undefined}>
    <Button variant="plain" className="om-game-tile-cover" onClick={onOpen} aria-label={label}>
      {/* Portrait games share the 16:9 card: the cover sits whole in the middle over a blurred copy of itself. */}
      {cover && game.orientation === 'portrait' && <img className="om-game-tile-backdrop" src={cover} alt="" loading="lazy" decoding="async" />}
      {cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : <span className="om-game-tile-placeholder">{title}</span>}
      {game.orientation === 'portrait' && !game.multiplayer && <span className="om-game-badge"><RemixIcon name="smartphone-line" size={13} />{t('Portrait')}</span>}
      {status && <span className="om-game-status" data-tone={game.status}>{game.status === 'building' && <RemixIcon name="loader-4-line" size={13} />}{t(status)}</span>}
      {game.external && !game.external.embeddable && <span className="om-game-status"><RemixIcon name="external-link-line" size={13} />{t('External link')}</span>}
      {game.multiplayer && <span className="om-game-badge"><RemixIcon name="group-line" size={13} />{t('{count} players', { count: game.maxPlayers })}</span>}
    </Button>
    <div className="om-game-tile-meta">
      <span className="om-game-tile-icon">{cover && <img src={cover} alt="" />}</span>
      <strong>{title}</strong>
      {game.external ? <a className="om-muted" href={game.external.postUrl} target="_blank" rel="noopener noreferrer">{game.external.author}</a>
        : game.plays > 0 && <span className="om-muted"><RemixIcon name="play-circle-line" size={14} />{formatPlays(game.plays, locale)}</span>}
    </div>
  </article>;
}

/**
 * Project view: details, Agent hand-off and actions on the left; the playable game on the right.
 * Drafts show the Agent's progress and load the game as soon as it is ready.
 */
function GameProject({ game, offline, onClose, onRemix, onChange, onOpenMcp, notify }: {
  game: GameCard; offline: boolean; onClose: () => void; onRemix: () => void; onChange: (game: GameCard) => void; onOpenMcp: () => void; notify: (message: string, tone: 'info' | 'error') => void;
}) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<'preview' | 'code' | 'trailer'>('preview');
  const [url, setUrl] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null), close = useRef<HTMLButtonElement>(null), stage = useRef<HTMLDivElement>(null);
  const gameTitle = useGameTitle();
  const mine = game.source === 'mine';
  const playable = !pending(game) && game.status !== 'failed';
  const hasCode = playable && !game.external;
  // Trailer: record gameplay headlessly, compose an OpenMotion video and render it (runs in the local service).
  const trailer = game.trailer;
  const trailerBusy = trailer && ['recording', 'composing', 'rendering'].includes(trailer.status);
  const trailerReady = trailersEnabled && trailer?.status === 'ready' && Boolean(trailer.videoUrl);
  const canTrailer = trailersEnabled && playable && !game.external && !offline;
  const status = mine ? statusLabels[game.status] : undefined;
  useEffect(() => {
    if (!playable) { setUrl(null); return; }
    let revoked: string | null = null, cancelled = false;
    // Multiplayer games join a room straight away: the preview supplies one, so nobody types a room code.
    const withRoom = (value: string) => {
      if (!game.multiplayer || value.startsWith('blob:') || game.external) return value;
      const target = new URL(value, location.href); if (!target.searchParams.has('room')) target.searchParams.set('room', 'play-' + Math.random().toString(36).slice(2, 8));
      return target.pathname + target.search;
    };
    void playableUrl(game).then(withRoom).then(next => { if (cancelled) { if (next.startsWith('blob:')) URL.revokeObjectURL(next); return; } if (next.startsWith('blob:')) revoked = next; setUrl(next); }).catch(() => notify(t('This game could not be loaded.'), 'error'));
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
    // playUrl changes from the built-in copy to the served game once the catalogue loads; follow it so ./assets resolve.
  }, [game.id, game.playUrl, playable, reload]);
  useEffect(() => { if (playable && !offline && !game.external) gameApi.play(game.id).then(onChange).catch(() => {}); }, [game.id, playable]);
  // Re-read the source on every reload too, so the Code tab never stays on "Loading game…" after Reload.
  useEffect(() => {
    if (view !== 'code' || !playable || source !== null) return;
    let live = true;
    void gameSource(game).then(text => { if (live) setSource(text); }).catch(() => { if (live) setSource(''); });
    return () => { live = false; };
  }, [view, playable, source, reload]);
  useEffect(() => {
    if (!trailerBusy) return;
    const timer = setInterval(() => { void gameApi.trailer(game.id).then(next => onChange({ ...game, trailer: next })).catch(() => {}); }, 3000);
    return () => clearInterval(timer);
  }, [game.id, trailerBusy]);
  const startTrailer = async () => {
    try { onChange({ ...game, trailer: await gameApi.startTrailer(game.id) }); notify(t('Making the trailer. It takes a few minutes; you can keep playing.'), 'info'); }
    catch (error) { notify(t('The trailer could not be started: {reason}', { reason: (error as Error).message }), 'error'); }
  };
  const openTrailerProject = () => { if (trailer?.projectId) window.location.assign(trailerProjectHref(trailer.projectId, location.search)); };
  useEffect(() => { close.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && document.activeElement !== frame.current) onClose(); }; addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, []);
  const act = (request: () => Promise<GameCard>) => offline ? notify(t('Start the local game service to save reactions.'), 'info') : void request().then(onChange).catch(() => notify(t('Could not save. Try again.'), 'error'));
  // Games are published to this computer only. The link is copied for local use and labelled as such.
  const share = async () => {
    if (!url || url.startsWith('blob:')) { notify(t('This game has no shareable link yet. Publishing to the web is not available.'), 'info'); return; }
    const link = new URL(url, location.href).href;
    try { await navigator.clipboard.writeText(link); notify(isLocalOnly(link) ? t('Link copied. It only opens on this computer; publishing to the web is not available yet.') : t('Game link copied.'), 'info'); }
    catch { notify(t('Could not copy the link.'), 'error'); }
  };
  const popout = () => { if (url) window.open(url.startsWith('blob:') ? url : new URL(url, location.href).href, '_blank', 'noopener'); };
  return <div className="om-game-project" role="dialog" aria-modal="true" aria-label={game.title}>
    <header className="om-game-project-top">
      <IconButton ref={close} variant="ghost" className="motion-icon-button" aria-label={t('Back to the game market')} onClick={onClose} icon={<RemixIcon name="arrow-left-line" size={18} />} />
      <h1 className="om-subtitle">{gameTitle(game)}</h1>
    </header>
    <aside className="om-game-project-side">
      <div className="om-game-project-body">
        {status && <p className="om-game-status-line" data-tone={game.status}>{game.status === 'building' && <RemixIcon name="loader-4-line" size={14} />}{t(status)}</p>}
        {(gameTitle(game) === game.title || game.i18n?.[locale]?.title) && <p>{localized(game, 'description', locale)}</p>}
        <dl className="om-game-facts">
          <div><dt>{t('Genre')}</dt><dd>{t(genreLabels[game.genre])}</dd></div>
          {game.style && <div><dt>{t('Style')}</dt><dd>{t(styleLabels[game.style])}</dd></div>}
          {game.setting && <div><dt>{t('Setting')}</dt><dd>{t(settingLabels[game.setting])}</dd></div>}
          <div><dt>{t('Players')}</dt><dd>{game.multiplayer ? t('{count} players', { count: game.maxPlayers }) : t('Single player')}</dd></div>
          {game.controls && <div><dt>{t('Controls')}</dt><dd>{localized(game, 'controls', locale)}</dd></div>}
        </dl>
        {/* While the Agent works, the panel shows only status and facts; the instruction stays out of the way. */}
      </div>
      {game.external && <footer className="om-game-actions">
        <Button variant="ghost" className="om-button h-auto" data-primary onClick={onRemix}><RemixIcon name="add-line" size={16} />{t('Make one like this')}</Button>
        <a className="om-button h-auto" href={game.external.postUrl} target="_blank" rel="noopener noreferrer"><RemixIcon name="external-link-line" size={15} />{t('Made by {author} · {model}', { author: game.external.author, model: game.external.model })}</a></footer>}
      {canTrailer && <div className="om-game-trailer">
        {trailerBusy ? <Button variant="ghost" className="om-button h-auto om-game-trailer-cta" disabled><RemixIcon name="loader-4-line" size={16} />{t(trailerSteps[trailer!.status])}{typeof trailer!.progress === 'number' ? ` · ${Math.round(trailer!.progress * 100)}%` : ''}</Button>
          : trailerReady ? <>
            <Button variant="ghost" className="om-button h-auto om-game-trailer-cta" onClick={() => setView('trailer')}><RemixIcon name="film-line" size={16} />{t('Watch the trailer')}</Button>
            <span className="om-game-actions">
              {trailer!.projectId && <Button variant="ghost" className="om-button h-auto" onClick={openTrailerProject}><RemixIcon name="edit-line" size={15} />{t('Edit in Motion')}</Button>}
              <Button variant="ghost" className="om-button h-auto" onClick={() => void startTrailer()}><RemixIcon name="refresh-line" size={15} />{t('Make again')}</Button>
            </span></>
          : <Button variant="ghost" className="om-button h-auto om-game-trailer-cta" onClick={() => void startTrailer()}><RemixIcon name="film-line" size={16} />{t('Make a trailer')}</Button>}
        {trailer?.status === 'failed' && <p className="om-game-trailer-error">{t('The trailer could not be made: {reason}', { reason: trailer.error ?? '' })}</p>}
      </div>}
      {playable && !game.external && !mine && <footer className="om-game-actions" role="toolbar" aria-label={t('Game actions')}>
        <Button variant="ghost" className="om-button h-auto" data-primary onClick={onRemix}><RemixIcon name="add-line" size={16} />{t('Make one like this')}</Button>
        <IconButton variant="ghost" className="motion-icon-button" aria-pressed={game.favorite} aria-label={game.favorite ? t('Remove from favorites') : t('Add to favorites')} onClick={() => act(() => gameApi.favorite(game.id, !game.favorite))} icon={<RemixIcon name={game.favorite ? 'bookmark-fill' : 'bookmark-line'} size={17} />} />
        <IconButton variant="ghost" className="motion-icon-button" aria-pressed={game.reaction === 1} aria-label={t('Like')} onClick={() => act(() => gameApi.react(game.id, game.reaction === 1 ? 0 : 1))} icon={<RemixIcon name={game.reaction === 1 ? 'thumb-up-fill' : 'thumb-up-line'} size={17} />} />
        <IconButton variant="ghost" className="motion-icon-button" aria-pressed={game.reaction === -1} aria-label={t('Dislike')} onClick={() => act(() => gameApi.react(game.id, game.reaction === -1 ? 0 : -1))} icon={<RemixIcon name={game.reaction === -1 ? 'thumb-down-fill' : 'thumb-down-line'} size={17} />} />
        <IconButton variant="ghost" className="motion-icon-button" aria-label={t('Copy link')} onClick={() => void share()} icon={<RemixIcon name="share-forward-line" size={17} />} />
      </footer>}
    </aside>
    <section className="om-game-preview" aria-label={t('Preview')}>
      <header>
        {/* The code tab only exists for games whose source is ours to show. */}
        {hasCode || trailerReady ? <div className="om-segmented" role="tablist">
          <Button variant="plain" role="tab" className="om-nav-item" aria-selected={view === 'preview'} onClick={() => setView('preview')}><RemixIcon name="play-fill" size={15} />{t('Preview')}</Button>
          {hasCode && <Button variant="plain" role="tab" className="om-nav-item" aria-selected={view === 'code'} onClick={() => setView('code')}><RemixIcon name="code-s-slash-line" size={15} />{t('Code')}</Button>}
          {trailerReady && <Button variant="plain" role="tab" className="om-nav-item" aria-selected={view === 'trailer'} onClick={() => setView('trailer')}><RemixIcon name="film-line" size={15} />{t('Trailer')}</Button>}
        </div> : <span />}
        <span className="om-game-preview-tools">
          <IconButton variant="ghost" className="motion-icon-button" aria-label={t('Reload game')} disabled={!playable} onClick={() => { setSource(null); setReload(value => value + 1); }} icon={<RemixIcon name="refresh-line" size={17} />} />
          <IconButton variant="ghost" className="motion-icon-button" aria-label={t('Full screen')} disabled={!url} onClick={() => void (view === 'preview' ? frame.current : stage.current)?.requestFullscreen?.()} icon={<RemixIcon name="fullscreen-line" size={17} />} />
          <Button variant="ghost" className="om-button h-auto" disabled={!url} onClick={popout}><RemixIcon name="external-link-line" size={15} />{t('Open in new window')}</Button>
        </span>
      </header>
      <div ref={stage} className="om-game-stage" data-orientation={game.orientation === 'portrait' && playable && view === 'preview' ? 'portrait' : undefined}>
        {!playable && game.status !== 'building' ? <GameHandoff game={game} notify={notify} />
          : !playable ? <div className="om-game-waiting"><RemixIcon name="loader-4-line" size={28} />
            <strong>{t('Agent is running…')}</strong>
            <span className="om-muted">{t('The game will load here when it is ready.')}</span></div>
          : view === 'code' ? <pre className="om-game-code" tabIndex={0}>{source ?? t('Loading game…')}</pre>
          : view === 'trailer' && trailerReady ? <video className="om-game-trailer-video" src={trailer!.videoUrl!.replace(/^\/api\//, '/motion-api/')} controls autoPlay playsInline />
          // A creator's own site keeps its own origin; local games stay script-only.
          : game.external && !game.external.embeddable ? <div className="om-game-external">
              {coverUrl(game) && <img src={coverUrl(game)!} alt="" />}
              <div><strong>{t('This game only runs on the creator’s site.')}</strong>
                <Button variant="ghost" className="om-button h-auto" data-primary onClick={popout}><RemixIcon name="external-link-line" size={15} />{t('Play on the creator’s page')}</Button></div>
            </div>
          : url ? <iframe key={reload} ref={frame} src={url} title={game.title} sandbox={game.external ? 'allow-scripts allow-same-origin allow-pointer-lock allow-popups' : 'allow-scripts allow-pointer-lock'} allow="fullscreen; gamepad; autoplay; clipboard-write" />
          : <span className="om-muted">{t('Loading game…')}</span>}
      </div>
    </section>
  </div>;
}

/** Spreads portrait games through the list (one after every two landscape games) so the waterfall mixes both shapes. */
function interleavePortrait(list: GameCard[]) {
  const portrait = list.filter(game => game.orientation === 'portrait'), others = list.filter(game => game.orientation !== 'portrait');
  if (!portrait.length || !others.length) return list;
  const mixed: GameCard[] = [];
  others.forEach((game, index) => { mixed.push(game); if (index % 2 === 1 && portrait.length) mixed.push(portrait.shift()!); });
  return [...mixed, ...portrait];
}

// Titles sit on the cover, so a card's height is just its cover.
const masonryGap = 12, masonryMinColumn = 280, tileMetaHeight = 0;

/** Waterfall layout: landscape (16:9) and portrait (9:16) cards keep their shapes; each card goes to the shortest column, in list order. */
function GameMasonry({ games, render }: { games: GameCard[]; render: (game: GameCard) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = box.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const count = Math.max(1, Math.floor((width + masonryGap) / (masonryMinColumn + masonryGap)));
  const columns = useMemo(() => {
    const column = width ? (width - masonryGap * (count - 1)) / count : masonryMinColumn;
    const lists: GameCard[][] = Array.from({ length: count }, () => []), heights = Array(count).fill(0) as number[];
    for (const game of games) {
      const shortest = heights.indexOf(Math.min(...heights));
      lists[shortest].push(game);
      heights[shortest] += column * 9 / 16 + tileMetaHeight + masonryGap;
    }
    return lists;
  }, [games, count, width]);
  return <div ref={box} className="om-game-masonry">{columns.map((list, index) => <div key={index} className="om-game-masonry-column">{list.map(render)}</div>)}</div>;
}

/** The user's games, like the project list in the Motion editor: what the Agent is still making, then finished games. */
function GameSidebar({ games, openId, onOpen }: { games: GameCard[]; openId: string | null; onOpen: (game: GameCard) => void }) {
  const { t } = useI18n();
  const title = useGameTitle();
  const [query, setQuery] = useState('');
  // Collapsing works like the Motion editor's project list; the choice is remembered on this device.
  const [collapsed, setCollapsedState] = useState(() => { try { return localStorage.getItem('om-game-sidebar') === 'collapsed'; } catch { return false; } });
  const setCollapsed = (value: boolean) => { setCollapsedState(value); try { localStorage.setItem('om-game-sidebar', value ? 'collapsed' : 'open'); } catch { /* storage unavailable */ } };
  const toggleLabel = t(collapsed ? 'Show my games' : 'Hide my games');
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? games.filter(game => title(game).toLocaleLowerCase().includes(needle)) : games;
  return <aside className="om-game-sidebar" data-collapsed={collapsed} aria-label={t('My games')}>
    <div className="om-game-sidebar-head">
      {!collapsed && <h2 className="om-game-sidebar-title">{t('My games')}</h2>}
      <Tooltip label={toggleLabel} wrap><IconButton variant="ghost" type="button" className="motion-icon-button" aria-expanded={!collapsed} aria-label={toggleLabel} onClick={() => setCollapsed(!collapsed)} icon={<MotionIcon name="sidebar" size={16} />} /></Tooltip>
    </div>
    {!collapsed && games.length > 0 && <span className="om-field om-game-sidebar-search"><RemixIcon name="search-line" size={15} /><input value={query} placeholder={t('Search my games')} aria-label={t('Search my games')} onChange={event => setQuery(event.target.value)} /></span>}
    <nav className="om-game-sidebar-list">
      {shown.map(game => {
        const cover = coverUrl(game) ?? genreCovers[game.genre];
        const status = game.status === 'draft' ? t('Waiting for your Agent') : game.status === 'building' ? t('Agent is running') : game.status === 'failed' ? t('Not finished') : game.status === 'ready' ? t('Ready to publish') : t('Finished');
        return <Button key={game.id} variant="plain" className="om-game-sidebar-row" aria-label={collapsed ? `${title(game)} · ${status}` : undefined} aria-current={openId === game.id ? 'page' : undefined} onClick={() => onOpen(game)}>
          <span className="om-game-sidebar-thumb">{cover && <img src={cover} alt="" />}{collapsed && pending(game) && <RemixIcon name="loader-4-line" size={12} />}</span>
          {!collapsed && <span className="om-game-sidebar-text"><strong>{title(game)}</strong>
            <span className="om-muted" data-tone={game.status}>{game.status === 'building' && <RemixIcon name="loader-4-line" size={12} />}{status}</span></span>}
        </Button>;
      })}
      {!games.length && !collapsed && <p className="om-muted om-game-sidebar-empty">{t('Games you make appear here.')}</p>}
    </nav>
  </aside>;
}

/**
 * Handoff for a draft (or a game the Agent stopped on): OpenMotion does not run its own game Agent, so the user's
 * MCP Agent receives the complete instruction — game id, brief and execution steps — by opening Codex with it
 * prefilled or by copying it into any other Agent. The page switches to "Agent is running" once the Agent sets building.
 */
function GameHandoff({ game, notify }: { game: GameCard; notify: (message: string, tone: 'info' | 'error') => void }) {
  const { t } = useI18n();
  const [instruction, setInstruction] = useState<string | null>(() => storedInstruction(game.id));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void gameApi.handoff(game.id).then(handoff => { if (!live) return; setInstruction(handoff.agentInstruction); rememberInstruction(game.id, handoff.agentInstruction); }).catch(() => { /* keep the stored copy, if any */ });
    return () => { live = false; };
  }, [game.id]);
  const copy = async () => {
    if (!instruction) return;
    try { await navigator.clipboard.writeText(instruction); setCopied(true); notify(t('Instruction copied'), 'info'); }
    catch { notify(t('Could not copy. Select the instruction and copy it.'), 'error'); }
  };
  const stopped = game.status === 'failed';
  return <div className="om-game-handoff" data-tone={game.status}>
    <RemixIcon name={stopped ? 'error-warning-line' : 'robot-line'} size={26} />
    <strong>{stopped ? t('The Agent stopped before finishing this game.') : t('Hand this game to your Agent')}</strong>
    <ol className="om-game-handoff-steps">
      <li>{t('Open Codex, Claude Code or another Agent connected to OpenMotion MCP.')}</li>
      <li>{t('Send the instruction below. It names this game, the brief and the steps.')}</li>
      <li>{t('This page shows “Agent is running” once the Agent starts, and the game when it is ready.')}</li>
    </ol>
    <div className="om-game-handoff-actions">
      {/* Copy works with every Agent; the Codex link needs the Codex desktop app and only prefills a new chat (it does not send). */}
      <Button variant="ghost" className="om-button h-auto" data-primary disabled={!instruction} onClick={() => void copy()}><RemixIcon name={copied ? 'check-line' : 'file-copy-line'} size={15} />{copied ? t('Instruction copied') : t('Copy instruction')}</Button>
      <a className="om-button om-game-handoff-link" title={t('Needs the Codex desktop app. Opens a new chat with the instruction filled in; press send yourself.')} aria-disabled={!instruction || undefined} href={instruction ? `codex://new?prompt=${encodeURIComponent(instruction)}` : undefined}><RemixIcon name="external-link-line" size={15} />{t('Open in Codex')}</a>
    </div>
    <pre className="om-game-handoff-text" tabIndex={0} aria-label={t('Agent instruction')}>{instruction ?? t('Loading instruction…')}</pre>
  </div>;
}
