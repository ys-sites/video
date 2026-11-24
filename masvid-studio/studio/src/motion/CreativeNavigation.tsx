import { McpClientAvatar } from './McpClientAvatar';
import { Button } from 'open-design-ui/button';
import type { CreativeStudio, MediaStudio, TechniqueStudio } from '../../../shared/studio-catalog';
import { useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Model, Modality } from '../../../shared/gateway';
import { Popover } from '../components/ui/Popover';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { creativeStudios, studioIconTone, mediaLabels, modelDestination, sceneDestination, scenesForStudio, supportsScene, type StudioDestination } from './creativeStudios';
import { mcpClients, supportsLocalConnection, type McpClient } from './mcpClients';
import { useMediaCatalog } from './useMediaCatalog';
import speakerStudio from './scene-art/speaker-studio.webp';
import { imageScene, menuFamilies, withOpenDesignModels } from './imageMenuModels';
import { ImageMegaMenu, ModelMenuColumn } from './ImageMegaMenu';
import { VideoMegaMenu } from './VideoMegaMenu';
import { sceneExamples } from './sceneShowcase';
import { destinationTarget, reportCreativeClick, type CreativePage, type CreativeTarget } from './exploreTracking';
import { AudioNavMenu } from './AudioNavMenu';
import type { SoundTabId } from './soundTabs';
import type { ScenarioId } from '../../../shared/scenarios';
import { ScenarioMegaMenu } from './ScenarioMegaMenu';
import { preloadStudioRoute, preloadWorkspacePage } from '../router/lazyPages';

export type CreativeNavigationProps = {
  onChooseStudio: (studio: CreativeStudio, kind?: Modality) => void;
  specialty: TechniqueStudio | null;
  destination: StudioDestination | null;
  soundTab?: SoundTabId | null;
  motionActive: boolean;
  designActive?: boolean;
  cinemaActive?: boolean;
  scenarioActive?: ScenarioId | 'hub' | null;
  onOpenScenario?: (id: ScenarioId, runId?: string) => void;
  onOpenScenarioHub?: () => void;
  onNavigate: (destination: StudioDestination | null) => void;
  onNavigateSound?: (destination: StudioDestination, soundTab?: SoundTabId | null) => void;
  currentPage: 'explore' | 'mcp' | null;
  onOpenPage: (page: 'explore' | 'mcp', client?: McpClient) => void;
  /** The page this navigation is shown on, so its clicks segment by where the user was. */
  trackingPage: CreativePage;
};

function MediaChoices({ studio, destination, onNavigate, onSelectModel, catalog }: { destination: StudioDestination | null; onNavigate: (destination: StudioDestination) => void; onSelectModel: (target: StudioDestination) => void; catalog?: ReturnType<typeof useMediaCatalog>['catalog']; studio: MediaStudio }) {
  const { t } = useI18n();
  const kind = studio.primaryModality;
  const scenes = scenesForStudio(studio);
  const pinned = catalog?.models.find(model => model.id === destination?.model);
  const landingDestination = destination?.landing ? destination : null;
  const families = catalog ? menuFamilies(withOpenDesignModels(catalog.models, catalog.status.providers).filter(model => model.modality === kind && scenes.some(scene => supportsScene(model, scene))), catalog.status.providers) : [];
  return <div className="om-media-mega">
    <div className="om-media-menu-grid om-media-mega-entries">
      {scenes.map(scene => {
        const example = sceneExamples[scene.id][0];
        return <Button variant="plain" key={scene.id} className="om-scene-tile" aria-current={destination?.landing && destination.scene.id === scene.id ? 'page' : undefined}
          onClick={() => onNavigate(sceneDestination(scene, landingDestination, pinned && supportsScene(pinned, scene) ? pinned.id : null))}>
          {scene.id === 'text-to-image' ? (
            <span className="om-scene-tile-art om-media-demo om-image-demo" aria-hidden="true">
              <span className="om-media-demo-frame">
                <img src={example.poster} alt="" />
                <span className="om-image-demo-input">
                  <span className="om-image-demo-lines"><i /><i /><i /></span>
                  <span className="om-image-demo-send">↑</span>
                </span>
              </span>
            </span>
          ) : scene.id === 'image-edit' ? (
            <span className="om-scene-tile-art om-media-demo om-edit-demo" aria-hidden="true">
              <span className="om-media-demo-frame">
                <img src={speakerStudio} alt="" />
                <img className="om-edit-demo-result" src={example.poster} alt="" />
              </span>
            </span>
          ) : (
            <span className="om-scene-tile-art"><img src={example.poster} alt="" style={{ objectPosition: example.posterPosition }} /></span>
          )}
          <strong>{t(scene.label)}</strong>
        </Button>;
      })}
    </div>
    <div className="om-media-mega-columns" data-single>
      <ModelMenuColumn families={families}
        onOpen={model => onSelectModel(modelDestination(model, landingDestination))} />
    </div>
  </div>;
}

export function CreativeNavigation({ specialty, onChooseStudio, destination, soundTab, motionActive, designActive, cinemaActive, scenarioActive, onOpenScenario, onOpenScenarioHub, onNavigate, onNavigateSound, currentPage, onOpenPage, overflowActions, trackingPage }: CreativeNavigationProps & { overflowActions?: (close: () => void) => ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Modality | 'mcp' | 'workflows' | null>(null);
  const [popupHost, setPopupHost] = useState<HTMLElement>();
  const navId = useId();
  const rail = useRef<HTMLElement>(null);
  const catalog = useMediaCatalog(open !== null && open !== 'mcp' && open !== 'workflows');
  const trackPage = trackingPage;
  const track = (element: Parameters<typeof reportCreativeClick>[2], target: CreativeTarget) => reportCreativeClick(trackPage, 'creative_nav', element, target);

  const [visibleCount, setVisibleCount] = useState(Infinity);
  const [moreOpen, setMoreOpen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const hasWorkflows = Boolean(onOpenScenario && onOpenScenarioHub);

  const choose = (action: () => void) => {
    const navigation = rail.current;
    if (open && navigation && !navigation.contains(document.activeElement)) {
      // A disappearing menu item must not reclaim focus from an input on the destination page.
      navigation.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')?.focus({ preventScroll: true });
    }
    setOpen(null);
    setMoreOpen(false);
    action();
  };
  const menuDestinations = [
    ...(hasWorkflows ? [{
      id: 'workflows' as const,
      studio: null,
      label: t('Workflows'),
      current: scenarioActive ? 'page' as const : undefined,
      menuLabel: t('Workflows') + ' · ' + t('Topics, campaigns and roles'),
      onActivate: () => onOpenScenarioHub!(),
    }] : []),
    ...creativeStudios.filter((studio): studio is MediaStudio => studio.surface === 'media').map(studio => {
      const kind = studio.primaryModality;
      const label = t(mediaLabels[kind]);
      const studioSceneList = scenesForStudio(studio);
      const isCurrent = kind === 'audio'
        ? destination?.scene.modality === 'audio' && Boolean(destination.mediaTab || destination.landing)
        : Boolean(destination?.landing && destination.studio.id === studio.id);
      return { id: kind, studio, label, current: isCurrent ? 'location' as const : undefined,
        menuLabel: label + ' · ' + t('Scenes'), onActivate: () => {
          if (kind === 'audio') {
            onChooseStudio(studio, kind);
            return;
          }
          const sameModality = destination?.studio.id === studio.id && destination.scene.modality === kind;
          const scene = sameModality ? destination.scene : studioSceneList.find(item => item.modality === kind) ?? studioSceneList[0];
          const model = sameModality ? destination.model : null;
          onNavigate(sceneDestination(scene, null, model));
        } };
    }),
    { id: 'mcp' as const, studio: null, label: 'MCP', current: currentPage === 'mcp' ? 'page' as const : undefined,
      menuLabel: 'Generate with Open Design MCP', onActivate: () => onOpenPage('mcp') },
  ];
  const splitStart = 1;
  const studioStart = splitStart + menuDestinations.length;
  const count = studioStart + creativeStudios.length;
  const hasMore = visibleCount < count || Boolean(overflowActions);

  useLayoutEffect(() => {
    const viewport = rail.current!;
    const row = strip.current!;
    const trigger = more.current!;
    setPopupHost(viewport.closest<HTMLElement>('dialog, [data-feedback-modal]') ?? undefined);
    const items = Array.from(row.querySelectorAll<HTMLElement>(':scope > [data-nav-slot]'));
    const update = () => {
      const available = viewport.clientWidth;
      if (!available) return;
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const widths = items.map(item => item.getBoundingClientRect().width);
      // Keep only the first three studios (Design, Motion, Cinema) in the primary row; place the rest under More.
      const maxVisible = Math.min(widths.length, studioStart + 3);
      const total = widths.slice(0, maxVisible).reduce((sum, width) => sum + width, 0) + gap * Math.max(0, maxVisible - 1);
      let nextCount = maxVisible;
      if (maxVisible < widths.length || total > available) {
        const compact = getComputedStyle(row).getPropertyValue('--compact-nav').trim() === '1';
        const limit = compact ? Math.min(4, maxVisible) : maxVisible;
        let used = trigger.getBoundingClientRect().width;
        nextCount = 0;
        while (nextCount < limit && used + gap + widths[nextCount] <= available) {
          used += gap + widths[nextCount++];
        }
      }
      setVisibleCount(nextCount);
    };
    update();
    const observer = new ResizeObserver(update);
    [viewport, trigger, ...items].forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [studioStart]);

  useLayoutEffect(() => {
    setOpen(null);
    if (!hasMore) setMoreOpen(false);
  }, [visibleCount, hasMore]);

  function splitItem(index: number, inPanel: boolean) {
    const { id, studio, label, current, menuLabel, onActivate } = menuDestinations[index - splitStart];
    const expanded = open === id && (index >= visibleCount) === inPanel;
    const where = { navTarget: id, inOverflow: inPanel };
    const workflowsBadgeId = id === 'workflows' ? navId + '-workflows' + (inPanel ? '-more' : '') : undefined;
    const selectScene = (next: StudioDestination) => {
      track('select_scene', { ...where, ...destinationTarget(next) });
      choose(() => onNavigate(next));
    };
    return <div className="om-nav-row om-creative-split" data-active={Boolean(current)}>
          <Popover container={popupHost} modal={false} openOnHover={!inPanel} open={expanded}
            onOpenChange={value => {
              if (value) preloadStudioRoute(id);
              if (value && !inPanel) setMoreOpen(false);
              setOpen(previous => value ? id : previous === id ? null : previous);
            }}
            aria-label={menuLabel} align="start" className={id === 'mcp' ? 'om-selection-panel om-creative-client-menu' : `om-selection-panel om-creative-menu om-creative-mega om-creative-menu-${id}`}
            primaryAction={<Button variant="plain" className="om-nav-item om-nav-row-link" aria-label={id === 'workflows' ? label : undefined} aria-describedby={workflowsBadgeId} aria-current={current} onPointerEnter={() => preloadStudioRoute(id)} onFocus={() => preloadStudioRoute(id)} onClick={() => { track(id === 'mcp' ? 'nav_mcp' : id === 'workflows' ? 'nav_studio' : 'nav_media', where); choose(onActivate); }}>{label}{workflowsBadgeId && <span className="om-badge" data-nav-badge="New" id={workflowsBadgeId} lang="en">New</span>}</Button>}
            trigger={<Button variant="plain" className="om-nav-item om-nav-row-action" aria-label={menuLabel} aria-expanded={expanded}><RemixIcon name="arrow-down-s-line" size={12} /></Button>}>
            {id === 'mcp' ? <>
              <h2 lang="en">{menuLabel}</h2>
              <div className="om-mcp-client-grid">
                {mcpClients.filter(supportsLocalConnection).map(client => <Button variant="plain" className="om-nav-item" key={client.id} onClick={() => { track('select_client', { ...where, client: client.id }); choose(() => onOpenPage('mcp', client.id)); }}>
                  <McpClientAvatar client={client} /><span>{t(client.name)}</span>
                </Button>)}
              </div>
            </> : id === 'workflows' ? (onOpenScenario && onOpenScenarioHub && (
              <ScenarioMegaMenu
                activeScenarioId={scenarioActive ?? null}
                onSelect={(scenarioId, runId) => {
                  track('select_scene', { ...where, studio: scenarioId });
                  choose(() => onOpenScenario(scenarioId, runId));
                }}
                onOpenHub={() => {
                  track('nav_studio', where);
                  choose(() => onOpenScenarioHub());
                }}
              />
            )) : studio && (id === 'audio'
              ? <AudioNavMenu destination={destination} activeSoundTab={soundTab} catalog={catalog.catalog} failed={catalog.failed}
                  onSelect={(next, nextSoundTab, source) => {
                    track(source === 'model' ? 'select_model' : 'select_scene', { ...where, ...destinationTarget(next) });
                    choose(() => (onNavigateSound ? onNavigateSound(next, nextSoundTab) : onNavigate(next)));
                  }} />
              : id === 'image'
                ? <ImageMegaMenu catalog={catalog.catalog} destination={destination} onNavigate={selectScene} />
                : id === 'video'
                  ? <VideoMegaMenu catalog={catalog.catalog} destination={destination} onNavigate={selectScene} />
                  : <MediaChoices catalog={catalog.catalog} studio={studio} destination={destination} onNavigate={selectScene}
                    onSelectModel={next => { track('select_model', { ...where, ...destinationTarget(next) }); choose(() => onNavigate(next)); }} />)}
          </Popover>
        </div>;
  }

  function item(index: number, inPanel = false) {
    if (index === 0) return <Button variant="plain" className="om-nav-item om-explore-link" aria-label={t('Explore')} title={t('Explore')}
      aria-current={currentPage === 'explore' ? 'page' : undefined} onPointerEnter={() => preloadWorkspacePage('explore')} onFocus={() => preloadWorkspacePage('explore')} onClick={() => { track('nav_explore', { navTarget: 'explore', inOverflow: inPanel }); choose(() => onOpenPage('explore')); }}>
      <RemixIcon name="global-line" size={17} /><span>{t('Explore')}</span>
    </Button>;
    if (index < studioStart) return splitItem(index, inPanel);
    const studio = creativeStudios[index - studioStart];
    const isCurrent = studio.surface === 'editor' ? motionActive
      : (studio.id === 'design' && Boolean(designActive)) || (studio.id === 'cinema' && Boolean(cinemaActive))
        || (studio.id === destination?.studio.id && !destination?.landing && !destination?.mediaTab) || studio.id === specialty?.id;
    const badge = 'navBadge' in studio ? studio.navBadge : undefined;
    const badgeId = badge && studio.id !== '3d' ? navId + '-' + studio.id + (inPanel ? '-more' : '') : undefined;
    const preloadTarget = studio.surface === 'techniques' ? 'skills' : studio.id;
    return <Button variant="plain" className="om-nav-item" data-coming-soon={badge === 'Coming soon' || undefined} aria-current={isCurrent ? 'page' : undefined}
      aria-label={t(studio.title)} aria-describedby={badgeId} onPointerEnter={() => preloadStudioRoute(preloadTarget)} onFocus={() => preloadStudioRoute(preloadTarget)} onClick={() => { track('nav_studio', { navTarget: studio.id, studio: studio.id, inOverflow: inPanel }); choose(() => onChooseStudio(studio)); }}>
      {inPanel && <span className="om-studio-heading-icon" data-tone={studioIconTone(studio)}><RemixIcon name={studio.icon} size={17} /></span>}
      {t(studio.title)}{badgeId && <span className="om-badge" data-nav-badge={badge} id={badgeId} lang="en">{badge}</span>}
    </Button>;
  }

  const indices = Array.from({ length: count }, (_, index) => index);
  const hidden = indices.slice(visibleCount);
  return <nav ref={rail} className="om-creative-navigation" data-compact-actions={overflowActions ? true : undefined} aria-label={t('Creative studio')}>
    <div className="om-creative-strip" ref={strip}>
      {indices.map(index => <div key={index} data-nav-slot="" data-studio-start={index === studioStart || undefined}
        data-stowed={index >= visibleCount || undefined} inert={index >= visibleCount}>{item(index)}</div>)}
      <div ref={more} data-stowed={!hasMore || undefined} inert={!hasMore}>
        <Popover container={popupHost} modal={false} align="end" openOnHover open={moreOpen && hasMore}
          onOpenChange={next => {
            if (next) {
              setOpen(null);
            } else {
              setOpen(previous => {
                if (!previous) return null;
                const index = splitStart + menuDestinations.findIndex(entry => entry.id === previous);
                return index >= visibleCount ? null : previous;
              });
            }
            setMoreOpen(next);
          }} aria-label={t('More Studio')} className="om-selection-panel om-nav-more-panel"
          trigger={<Button variant="plain" type="button" className="om-nav-item">{t('More Studio')}</Button>}>
          {moreOpen && (overflowActions || hidden.some(index => index < studioStart)) && <div className="om-nav-more-tools">
            {overflowActions?.(() => setMoreOpen(false))}
            {hidden.filter(index => index < studioStart).map(index => <div key={index}>{item(index, true)}</div>)}
          </div>}
          {moreOpen && <section aria-label={t('Studios')}>
            <div className="om-nav-more-studios">{hidden.filter(index => index >= studioStart).map(index => <div key={index}>{item(index, true)}</div>)}</div>
          </section>}
        </Popover>
      </div>
    </div>
  </nav>;
}
