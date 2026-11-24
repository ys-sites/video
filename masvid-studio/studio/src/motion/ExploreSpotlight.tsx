import { Button } from 'open-design-ui/button';
import { ExploreCoverImage } from './ExploreCoverImage';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { mediaEditorDestination, motionStudio, type StudioDestination, type StudioScene } from './creativeStudios';
import { sceneExamples } from './sceneShowcase';
import { findModelHub } from './modelHubs';
import { motionSkills, motionStudioCover } from './skillCatalog';
import { useSkillPreview } from './useSkillPreview';
import { destinationTarget, reportCreativeClick } from './exploreTracking';
import type { ScenarioId } from '../../../shared/scenarios';
import aiInfluencerMarketing from './scene-art/ai-influencer-marketing.webp';
import './scenarioNavigation.css';

const track = (element: Parameters<typeof reportCreativeClick>[2], target: Parameters<typeof reportCreativeClick>[3]) => reportCreativeClick('explore', 'explore_spotlight', element, target);

/** Scenes the Explore feed leaves out because they are featured here; unchanged from main so the feed stays as it was. */
export const featuredSceneIds: readonly StudioScene['id'][] = ['text-to-video', 'text-to-image'];
/** Spotlight scenes open with their Studio's scene tabs. */
const spotlightScenes = [mediaEditorDestination('text-to-image')];
const slideDuration = 6000;
const blackFridayPoster = motionSkills.find(skill => skill.id === 'openmotion-sale-carousel')?.cover?.poster ?? '';
interface FeaturedSlide {
  id: string; title: string; subtitle: string; hint: string; icon: string; poster: string; clip?: string; credit?: string;
  scene?: { target: StudioDestination; prompt: string };
  /** Opens a model hub page instead of a studio. */
  hub?: string;
  /** Launches the matching end-to-end scenario workflow. */
  scenario?: ScenarioId;
}
const geminiHub = findModelHub('gemini-4')!;
const slides: FeaturedSlide[] = [{
  id: motionStudio.id, title: motionStudio.title, subtitle: 'Motion design', icon: motionStudio.icon,
  hint: 'Animate type and shapes, then edit their timing on the timeline.', poster: motionStudioCover?.poster ?? '', clip: motionStudioCover?.video,
  scenario: 'motion-full-chain',
}, {
  id: 'black-friday', title: 'Black Friday collection', subtitle: 'Template library', icon: 'film-line',
  hint: 'Browse Black Friday video references and Skills for your sale.', poster: blackFridayPoster,
  scenario: 'black-friday',
}, {
  id: 'hub-' + geminiHub.id, title: geminiHub.latestModel, subtitle: geminiHub.eyebrow, icon: 'sparkling-line', poster: geminiHub.poster, hub: geminiHub.id,
  hint: geminiHub.summary, scenario: 'gemini-4-neon',
}, ...spotlightScenes.map(target => {
  const { scene } = target;
  const { id } = scene;
  const example = sceneExamples[id][0];
  return { ...example, id, icon: scene.icon, subtitle: target.studio.title, hint: scene.hint, scene: { target, prompt: example.prompt }, scenario: 'design-full-chain' as ScenarioId };
}), {
  id: 'ai-influencer',
  title: 'Virtual Creator Episode',
  subtitle: 'Roles',
  icon: 'user-3-line',
  hint: 'Script, consistent persona visuals, bio page, voiceover, and talking video',
  poster: aiInfluencerMarketing,
  scenario: 'ai-influencer',
}];

function FeaturedClip({ src, playing }: { src: string; playing: boolean }) {
  const player = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(playing);
  const videoSource = useSkillPreview(src, (started || playing) && !failed);
  useEffect(() => { if (playing) setStarted(true); }, [playing]);
  useEffect(() => {
    const video = player.current;
    if (!video) return;
    if (playing) void video.play().catch(() => { /* The poster remains available if autoplay is blocked. */ });
    else video.pause();
  }, [playing, videoSource]);
  return videoSource && !failed ? <video ref={player} src={videoSource} muted loop playsInline preload="none" aria-hidden="true"
    style={{ opacity: ready ? 1 : 0 }} onLoadedData={() => setReady(true)} onError={() => setFailed(true)} /> : null;
}

export function ExploreSpotlight({ active, onNavigate, onOpenMotionEditor, motionEditorDisabled, onOpenBlackFriday, onModelHub, onStartScenario }: {
  active: boolean; onNavigate: (target: StudioDestination, prompt: string) => void;
  onOpenMotionEditor: () => void; motionEditorDisabled: boolean;
  onOpenBlackFriday: (trigger: HTMLButtonElement) => void; onModelHub: (id: string) => void;
  onStartScenario?: (id: ScenarioId) => void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(false);
  const [readingSlide, setReadingSlide] = useState(false);
  const clock = useRef({ index: 0, remaining: slideDuration });
  const playing = active && visible && !paused && !readingSlide;

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setPaused(preference.matches);
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(entries => {
      inView = entries[entries.length - 1].isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);

  useEffect(() => {
    if (clock.current.index !== index) clock.current = { index, remaining: slideDuration };
    if (!playing) return;
    const started = performance.now();
    const timer = window.setTimeout(() => setIndex((index + 1) % slides.length), clock.current.remaining);
    return () => {
      window.clearTimeout(timer);
      clock.current.remaining = Math.max(0, clock.current.remaining - (performance.now() - started));
    };
  }, [index, playing]);


  return <section ref={root} className="om-discovery-hero om-feature-carousel" data-scene={slides[index].id} aria-label={t('Featured')}
    onFocus={() => setReadingSlide(true)} onBlur={event => setReadingSlide(event.currentTarget.contains(event.relatedTarget))}
    style={{ '--slide-duration': slideDuration + 'ms', '--slide-play-state': playing ? 'running' : 'paused' } as CSSProperties}>
    {slides.map((slide, i) => {
      const current = i === index;
      const scene = slide.scene;
      const blackFriday = slide.id === 'black-friday';
      const motionSlide = slide.id === motionStudio.id;
      const showWorkflowPrimary = Boolean(slide.scenario && onStartScenario);
      // A hub slide is clickable as a whole; its button stays the keyboard entry.
      return <div key={slide.id} className="om-feature-slide" data-scene={slide.id} data-clickable={slide.hub ? 'true' : undefined} aria-hidden={!current} inert={!current}
        onClick={slide.hub ? event => { if ((event.target as Element).closest('button')) return; track('slide_action', { slide: slide.id, position: i }); onModelHub(slide.hub!); } : undefined}>
        <div className="om-feature-art" aria-hidden="true"><div className="om-feature-camera">
          <ExploreCoverImage src={slide.poster} eager={current} />
          {current && active && visible && slide.clip && <FeaturedClip src={slide.clip} playing={playing} />}
        </div></div>
        {slide.credit && <small className="om-scene-credit">{slide.credit}</small>}
        <div className="om-discovery-hero-copy">
          <span><RemixIcon name={slide.icon} size={16} />{t(slide.subtitle)}</span>
          <h2>{t(slide.title)}</h2><p>{t(slide.hint)}</p>
          <div className="om-hero-actions">
            {showWorkflowPrimary && <Button variant="ghost" type="button" className="om-button h-auto" data-slide-action="workflow" data-primary="media" onClick={() => {
              track('slide_action', { slide: slide.id, position: i, navTarget: 'workflow' });
              onStartScenario!(slide.scenario!);
            }}>
              {t('Start workflow')}<RemixIcon name="arrow-right-line" size={16} />
            </Button>}
            {slide.hub ? <Button variant="ghost" type="button" className="om-button h-auto" data-slide-action="destination" data-primary={showWorkflowPrimary ? undefined : 'media'} onClick={() => { track('slide_action', { slide: slide.id, position: i }); onModelHub(slide.hub!); }}>
              {t('Try {model} now', { model: slide.title })}<RemixIcon name="arrow-right-line" size={16} />
            </Button> : blackFriday ? <Button variant="ghost" type="button" className="om-button h-auto" data-slide-action="destination" data-primary={showWorkflowPrimary ? undefined : 'media'} onClick={event => { track('slide_action', { slide: slide.id, position: i }); onOpenBlackFriday(event.currentTarget); }}>
              {t('View collection')}<RemixIcon name="arrow-right-line" size={16} />
            </Button> : scene ? <Button variant="ghost" type="button" className="om-button h-auto" data-slide-action="destination" data-primary={showWorkflowPrimary ? undefined : 'media'} onClick={() => {
              track('slide_action', { slide: slide.id, position: i, ...destinationTarget(scene.target) });
              onNavigate(scene.target, t(scene.prompt));
            }}>
              {t(scene.target.scene.label)}<RemixIcon name="arrow-right-line" size={16} />
            </Button> : motionSlide ? <Button variant="ghost" type="button" className="om-button h-auto" data-slide-action="destination" data-primary={showWorkflowPrimary ? undefined : 'media'} disabled={motionEditorDisabled} onClick={() => {
              track('slide_action', { slide: slide.id, position: i, studio: motionStudio.id });
              onOpenMotionEditor();
            }}>
              {t('Open in Motion Editor')}<RemixIcon name="arrow-right-line" size={16} />
            </Button> : null}
          </div>
        </div>
      </div>;
    })}
    <div className="om-feature-controls om-media-pagination om-media-segments" role="group" aria-label={t('Featured')}>
      {slides.map((slide, i) => <Button variant="plain" type="button" key={slide.id} aria-label={t('Featured') + ' · ' + t(slide.title)} aria-current={i === index ? 'true' : undefined} onClick={() => { track('slide_select', { slide: slide.id, position: i }); setIndex(i); }}>
        <span className="om-media-track" />
      </Button>)}
    </div>
  </section>;
}
