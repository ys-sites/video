import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assetMediaUrl } from '../../../shared/asset-library';
import type { DesignViewportId } from '../../../shared/design-project';
import type { PoolItem, ScenarioRun } from '../../../shared/scenario-runs';
import type {
  ScenarioDefinition,
  ScenarioId,
  ScenarioStepDefinition,
  ScenarioStepType,
} from '../../../shared/scenarios';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { AssetAudioPreview } from '../motion/AssetAudioPreview';
import ambientPiano from '../motion/scene-art/ambient-piano.webp';
import { designPreviewUrlForPoolItem, resolvePoolTextContent } from './PoolItemPreview';
import { scenarioCover } from './scenarioCovers';
import bfBriefArt from './stage-art/bf-brief.webp';
import bfDetailPageArt from './stage-art/bf-detail-page.webp';
import bfProductImagesArt from './stage-art/bf-product-images.webp';
import bfSalesFilmArt from './stage-art/bf-sales-film.webp';
import bfSocialArt from './stage-art/bf-social.webp';
import designBriefArt from './stage-art/design-brief.webp';
import designEmbedImagesArt from './stage-art/design-embed-images.webp';
import designLandingPageArt from './stage-art/design-landing-page.webp';
import designPageImagesArt from './stage-art/design-page-images.webp';
import designPromoVideoArt from './stage-art/design-promo-video.webp';
import designSocialArt from './stage-art/design-social.webp';
import geminiBriefArt from './stage-art/gemini-brief.webp';
import geminiCodeAnimationArt from './stage-art/gemini-code-animation.webp';
import geminiFilmArt from './stage-art/gemini-film.webp';
import geminiSocialArt from './stage-art/gemini-social.webp';
import geminiStillsArt from './stage-art/gemini-stills.webp';
import infBriefArt from './stage-art/inf-brief.webp';
import infHomePageArt from './stage-art/inf-home-page.webp';
import infPersonaArt from './stage-art/inf-persona.webp';
import infSocialArt from './stage-art/inf-social.webp';
import infTalkingVideoArt from './stage-art/inf-talking-video.webp';
import infVoiceArt from './stage-art/inf-voice.webp';
import motionBriefArt from './stage-art/motion-brief.webp';
import motionFilmArt from './stage-art/motion-film.webp';
import motionSocialArt from './stage-art/motion-social.webp';
import motionSoundtrackArt from './stage-art/motion-soundtrack.webp';
import motionStoryboardArt from './stage-art/motion-storyboard.webp';
import { poolKindIcon } from './steps/stepUtils';

export type ScenarioStageProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  activeStep: ScenarioStepDefinition;
  active: boolean;
  poolItems: PoolItem[];
  onSelectStep(stepId: string): void;
  onOpenAssets(): void;
  onUseInStep(item: PoolItem): Promise<void>;
  onOpenDesignProject(id: string): void;
  onOpenMotionProject(id: string): Promise<boolean>;
};

export type ShowcaseSlide = {
  id: string;
  kind: 'showcase';
  stepId: string;
  stepType: ScenarioStepType;
  icon: string;
  title: string;
  poster: string;
  video?: string;
  aspect: 'portrait' | 'landscape' | 'square';
};

type AssetSlide = {
  id: string;
  kind: 'asset';
  item: PoolItem;
  stepId: string | null;
  stepType: ScenarioStepType;
};

type StageSlide = ShowcaseSlide | AssetSlide;

type StageExampleMedia = {
  poster: string;
  video?: string;
  aspect?: 'portrait' | 'landscape' | 'square';
};

const stageExampleMedia: Record<ScenarioId, Record<string, StageExampleMedia>> = {
  'motion-full-chain': {
    brief: { poster: motionBriefArt, aspect: 'landscape' },
    storyboard: { poster: motionStoryboardArt, aspect: 'landscape' },
    'motion-film': { poster: motionFilmArt, aspect: 'landscape' },
    soundtrack: { poster: motionSoundtrackArt, aspect: 'square' },
    social: { poster: motionSocialArt, aspect: 'landscape' },
  },
  'gemini-4-neon': {
    brief: { poster: geminiBriefArt, aspect: 'landscape' },
    'code-animation': { poster: geminiCodeAnimationArt, aspect: 'landscape' },
    stills: { poster: geminiStillsArt, aspect: 'landscape' },
    film: { poster: geminiFilmArt, aspect: 'landscape' },
    social: { poster: geminiSocialArt, aspect: 'landscape' },
  },
  'design-full-chain': {
    brief: { poster: designBriefArt, aspect: 'landscape' },
    'landing-page': { poster: designLandingPageArt, aspect: 'landscape' },
    'page-images': { poster: designPageImagesArt, aspect: 'landscape' },
    'embed-images': { poster: designEmbedImagesArt, aspect: 'landscape' },
    'promo-video': { poster: designPromoVideoArt, aspect: 'landscape' },
    social: { poster: designSocialArt, aspect: 'landscape' },
  },
  'black-friday': {
    brief: { poster: bfBriefArt, aspect: 'landscape' },
    'product-images': { poster: bfProductImagesArt, aspect: 'landscape' },
    'detail-page': { poster: bfDetailPageArt, aspect: 'landscape' },
    'sales-film': { poster: bfSalesFilmArt, aspect: 'landscape' },
    social: { poster: bfSocialArt, aspect: 'landscape' },
  },
  'ai-influencer': {
    brief: { poster: infBriefArt, aspect: 'landscape' },
    persona: { poster: infPersonaArt, aspect: 'landscape' },
    'home-page': { poster: infHomePageArt, aspect: 'landscape' },
    voice: { poster: infVoiceArt, aspect: 'square' },
    'talking-video': { poster: infTalkingVideoArt, aspect: 'portrait' },
    social: { poster: infSocialArt, aspect: 'landscape' },
  },
};

export function buildShowcaseSlides(scenario: ScenarioDefinition): ShowcaseSlide[] {
  const defaultPoster = scenarioCover(scenario.id);
  const byStep = stageExampleMedia[scenario.id] ?? {};

  return scenario.steps.map(step => {
    const media = byStep[step.id] ?? { poster: defaultPoster };
    return {
      id: `showcase:${scenario.id}:${step.id}`,
      kind: 'showcase',
      stepId: step.id,
      stepType: step.type,
      icon: step.icon,
      title: step.title,
      poster: media.poster || defaultPoster,
      video: media.video,
      aspect: media.aspect ?? 'landscape',
    };
  });
}

function StageVideoPlayer({
  src,
  poster,
  active,
  title,
  onFallback,
}: {
  src: string;
  poster?: string;
  active: boolean;
  title: string;
  onFallback?: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!active) {
      el.pause();
      return;
    }
    if (!prefersReducedMotion) {
      el.play().catch(() => {});
    }
  }, [active, src, prefersReducedMotion]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const handleVisibility = () => {
      if (document.hidden) el.pause();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        entries => {
          if (!entries.some(entry => entry.isIntersecting)) {
            el.pause();
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(el);
    }
    return () => {
      el.pause();
      document.removeEventListener('visibilitychange', handleVisibility);
      observer?.disconnect();
    };
  }, [src]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  const toggleMute = () => {
    const el = videoRef.current;
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (el) {
      el.muted = nextMuted;
    }
  };

  return (
    <div className="om-scenario-stage-video-wrap">
      <video
        ref={videoRef}
        className="om-scenario-stage-media"
        src={src}
        poster={poster}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        aria-label={title}
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => onFallback?.()}
      />
      <div className="om-scenario-stage-media-controls">
        <IconButton
          variant="plain"
          size="sm"
          type="button"
          className="om-scenario-stage-media-btn"
          aria-label={playing ? t('Pause preview') : t('Play preview')}
          title={playing ? t('Pause preview') : t('Play preview')}
          icon={<RemixIcon name={playing ? 'pause-fill' : 'play-fill'} size={15} />}
          onClick={togglePlay}
        />
        <IconButton
          variant="plain"
          size="sm"
          type="button"
          className="om-scenario-stage-media-btn"
          aria-label={muted ? t('Unmute preview') : t('Mute preview')}
          title={muted ? t('Unmute preview') : t('Mute preview')}
          icon={<RemixIcon name={muted ? 'volume-mute-line' : 'volume-up-line'} size={15} />}
          onClick={toggleMute}
        />
      </div>
    </div>
  );
}

function StagePosterImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <CoverPlaceholder fill />;
  }

  return (
    <>
      {!loaded && <Skeleton className="om-scenario-stage-skeleton" />}
      <img
        className="om-scenario-stage-media"
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </>
  );
}

function FilmstripThumb({
  slide,
  selected,
  label,
  onSelect,
}: {
  slide: StageSlide;
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  const [failed, setFailed] = useState(false);

  const imageSrc = useMemo(() => {
    if (slide.kind === 'showcase') return slide.poster;
    if (slide.item.ref.type === 'asset' && slide.item.kind === 'image') {
      return assetMediaUrl(slide.item.ref.assetId, slide.item.ref.versionId);
    }
    return '';
  }, [slide]);

  useEffect(() => {
    setFailed(false);
  }, [imageSrc]);

  const mediaKind = useMemo(() => {
    if (slide.kind === 'asset') return slide.item.kind;
    if (slide.stepType === 'web-page') return 'page';
    if (slide.stepType === 'video' || slide.video) return 'video';
    if (slide.stepType === 'audio') return 'audio';
    if (slide.stepType === 'image') return 'image';
    return 'text';
  }, [slide]);

  const kindIcon = useMemo(() => {
    if (slide.kind === 'asset') {
      if (slide.item.kind === 'page') return 'global-line';
      return poolKindIcon(slide.item.kind);
    }
    switch (slide.stepType) {
      case 'image':
        return 'image-line';
      case 'video':
        return 'movie-line';
      case 'web-page':
        return slide.icon === 'code-s-slash-line' ? 'code-s-slash-line' : 'global-line';
      case 'audio':
        return 'music-2-line';
      case 'social-pack':
        return 'chat-1-line';
      default:
        return slide.video ? 'movie-line' : slide.icon || 'file-text-line';
    }
  }, [slide]);

  const hasImage = Boolean(imageSrc && !failed);

  return (
    <Button
      variant="plain"
      type="button"
      className="om-scenario-filmstrip-item"
      data-selected={selected ? 'true' : undefined}
      data-step-type={slide.stepType}
      data-media-kind={mediaKind}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
    >
      {hasImage ? (
        <img
          src={imageSrc}
          alt=""
          className="om-scenario-filmstrip-img"
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="om-scenario-filmstrip-fallback" aria-hidden="true">
          <RemixIcon name={kindIcon} size={18} />
        </span>
      )}
      {hasImage && (
        <span
          className="om-scenario-filmstrip-badge"
          data-media-kind={mediaKind}
          aria-hidden="true"
        >
          <RemixIcon name={kindIcon} size={11} />
        </span>
      )}
    </Button>
  );
}

export function ScenarioStage({
  scenario,
  run,
  activeStep,
  active,
  poolItems,
  onSelectStep,
  onOpenAssets,
  onUseInStep,
  onOpenDesignProject,
  onOpenMotionProject,
}: ScenarioStageProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [videoFailedId, setVideoFailedId] = useState<string | null>(null);
  const [audioFailedId, setAudioFailedId] = useState<string | null>(null);
  const [designViewport, setDesignViewport] = useState<DesignViewportId>('desktop');

  const stepTypeById = useMemo(
    () => new Map(scenario.steps.map(step => [step.id, step.type])),
    [scenario.steps],
  );
  const stepTitleById = useMemo(
    () => new Map(scenario.steps.map(step => [step.id, step.title])),
    [scenario.steps],
  );

  const showcaseSlides = useMemo(() => buildShowcaseSlides(scenario), [scenario]);

  const slides = useMemo<StageSlide[]>(() => {
    if (poolItems.length === 0) {
      return showcaseSlides;
    }
    const sorted = [...poolItems].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aInStep = a.stepId === activeStep.id ? 1 : 0;
      const bInStep = b.stepId === activeStep.id ? 1 : 0;
      if (aInStep !== bInStep) return bInStep - aInStep;
      return b.addedAt - a.addedAt;
    });
    return sorted.map(item => ({
      id: item.id,
      kind: 'asset' as const,
      item,
      stepId: item.stepId,
      stepType: (item.stepId && stepTypeById.get(item.stepId)) || activeStep.type,
    }));
  }, [activeStep.id, activeStep.type, poolItems, showcaseSlides, stepTypeById]);

  const prevPoolIdsRef = useRef<Set<string>>(new Set(poolItems.map(item => item.id)));
  const prevStepIdRef = useRef<string>(activeStep.id);

  // Auto-focus newly added/generated workflow assets immediately on arrival.
  useEffect(() => {
    const prevIds = prevPoolIdsRef.current;
    const newlyAdded = poolItems
      .filter(item => !prevIds.has(item.id))
      .sort((a, b) => b.addedAt - a.addedAt);
    prevPoolIdsRef.current = new Set(poolItems.map(item => item.id));

    if (newlyAdded.length > 0) {
      setSelectedId(newlyAdded[0].id);
      setVideoFailedId(null);
    }
  }, [poolItems]);

  // Follow step transitions gracefully when switching workflow steps.
  useEffect(() => {
    if (prevStepIdRef.current === activeStep.id) return;
    prevStepIdRef.current = activeStep.id;
    setVideoFailedId(null);

    if (poolItems.length === 0) {
      const match = showcaseSlides.find(slide => slide.stepId === activeStep.id);
      if (match) setSelectedId(match.id);
      return;
    }

    const stepMatch = slides.find(slide => slide.stepId === activeStep.id);
    if (stepMatch) {
      setSelectedId(stepMatch.id);
    }
  }, [activeStep.id, poolItems.length, showcaseSlides, slides]);

  const currentIndex = useMemo(() => {
    if (slides.length === 0) return -1;
    if (selectedId) {
      const idx = slides.findIndex(slide => slide.id === selectedId);
      if (idx >= 0) return idx;
    }
    const stepIdx = slides.findIndex(slide => slide.stepId === activeStep.id);
    return stepIdx >= 0 ? stepIdx : 0;
  }, [activeStep.id, selectedId, slides]);

  const currentSlide = currentIndex >= 0 ? slides[currentIndex] : null;
  const canNavigate = slides.length > 1;

  const handlePrev = () => {
    if (!canNavigate) return;
    const prevIdx = (currentIndex - 1 + slides.length) % slides.length;
    setSelectedId(slides[prevIdx].id);
    setVideoFailedId(null);
  };

  const handleNext = () => {
    if (!canNavigate) return;
    const nextIdx = (currentIndex + 1) % slides.length;
    setSelectedId(slides[nextIdx].id);
    setVideoFailedId(null);
  };

  const activeTone: ScenarioStepType = currentSlide?.stepType ?? activeStep.type;

  const heroAspect = useMemo<'portrait' | 'landscape' | 'square' | 'wide'>(() => {
    if (!currentSlide) return 'landscape';
    if (currentSlide.kind === 'showcase') return currentSlide.aspect;
    const kind = currentSlide.item.kind;
    if (kind === 'page' || kind === 'text') return 'wide';
    if (kind === 'audio') return 'square';
    return 'landscape';
  }, [currentSlide]);

  const activeStepGenerating = useMemo(() => {
    const stepState = run?.steps[activeStep.id];
    if (!stepState) return false;
    return stepState.iterations.some(
      iter => iter.job && (iter.job.state === 'queued' || iter.job.state === 'running'),
    );
  }, [activeStep.id, run?.steps]);

  const renderHeroContent = () => {
    if (!currentSlide) {
      return <CoverPlaceholder fill />;
    }

    if (currentSlide.kind === 'showcase') {
      const showVideo = Boolean(currentSlide.video) && videoFailedId !== currentSlide.id;
      return showVideo && currentSlide.video ? (
        <StageVideoPlayer
          src={currentSlide.video}
          poster={currentSlide.poster}
          active={active}
          title={t(currentSlide.title)}
          onFallback={() => setVideoFailedId(currentSlide.id)}
        />
      ) : (
        <StagePosterImage src={currentSlide.poster} alt={t(currentSlide.title)} />
      );
    }

    const { item } = currentSlide;
    const stepLabel = item.stepId ? stepTitleById.get(item.stepId) : null;
    const canUseInStep = activeStep.accepts.includes(item.kind);

    const topBar = (
      <div className="om-scenario-stage-caption-row">
        <span className="om-scenario-stage-pill" data-pool-kind={item.kind}>
          <RemixIcon name={poolKindIcon(item.kind)} size={13} />
          <span className="om-scenario-stage-pill-title">{item.label}</span>
          {stepLabel && (
            <>
              <span className="om-scenario-stage-pill-sep" aria-hidden="true">·</span>
              <span className="om-scenario-stage-pill-muted">{t(stepLabel)}</span>
            </>
          )}
        </span>
        <div className="om-scenario-stage-quick-actions">
          {canUseInStep && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              className="om-scenario-stage-action-pill"
              icon={<RemixIcon name="add-line" size={13} />}
              onClick={() => void onUseInStep(item)}
            >
              {t('Use in current step')}
            </Button>
          )}
          {item.ref.type === 'design' && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              className="om-scenario-stage-action-pill"
              icon={<RemixIcon name="external-link-line" size={13} />}
              onClick={() => {
                if (item.ref.type === 'design') onOpenDesignProject(item.ref.projectId);
              }}
            >
              {t('Open in Design')}
            </Button>
          )}
          {item.ref.type === 'motion' && (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              className="om-scenario-stage-action-pill"
              icon={<RemixIcon name="external-link-line" size={13} />}
              onClick={() => {
                if (item.ref.type === 'motion') void onOpenMotionProject(item.ref.projectId);
              }}
            >
              {t('Open in Motion')}
            </Button>
          )}
        </div>
      </div>
    );

    if (item.ref.type === 'asset' && (item.kind === 'image' || item.kind === 'video')) {
      const src = assetMediaUrl(item.ref.assetId, item.ref.versionId);
      return (
        <div className="om-scenario-stage-asset-card">
          {topBar}
          <div className="om-scenario-stage-asset-frame">
            {item.kind === 'image' ? (
              <StagePosterImage src={src} alt={item.label} />
            ) : videoFailedId === currentSlide.id ? (
              <CoverPlaceholder fill />
            ) : (
              <StageVideoPlayer
                src={src}
                active={active}
                title={item.label}
                onFallback={() => setVideoFailedId(currentSlide.id)}
              />
            )}
          </div>
        </div>
      );
    }

    if (item.kind === 'audio' && item.ref.type === 'asset') {
      const src = assetMediaUrl(item.ref.assetId, item.ref.versionId);
      const audioFailed = audioFailedId === currentSlide.id;
      return (
        <div className="om-scenario-stage-audio-card">
          {topBar}
          <div className="om-scenario-stage-audio-art">
            <img src={ambientPiano} alt="" draggable={false} />
            <span className="om-scenario-stage-audio-badge" aria-hidden="true">
              <RemixIcon name="music-2-line" size={24} />
            </span>
          </div>
          <div className="om-scenario-stage-audio-player">
            <strong className="om-scenario-stage-audio-title">{item.label}</strong>
            {audioFailed ? (
              <div className="om-scenario-preview-error">
                <span>{t('Audio preview unavailable.')}</span>
                <Button variant="ghost" size="sm" type="button" onClick={() => setAudioFailedId(null)}>
                  {t('Retry')}
                </Button>
              </div>
            ) : (
              <AssetAudioPreview src={src} onError={() => setAudioFailedId(currentSlide.id)} />
            )}
          </div>
        </div>
      );
    }

    if (item.kind === 'page' && item.ref.type === 'design') {
      const previewUrl = designPreviewUrlForPoolItem(item);
      return (
        <div className="om-scenario-stage-page-card">
          <div className="om-scenario-stage-page-bar">
            <span className="om-scenario-stage-pill" data-pool-kind="page">
              <RemixIcon name="layout-line" size={13} />
              <span className="om-scenario-stage-pill-title">{item.label}</span>
            </span>
            <div className="om-scenario-stage-page-tools">
              <div className="om-scenario-stage-viewports" role="group" aria-label={t('Page viewport')}>
                {(
                  [
                    { id: 'desktop', icon: 'computer-line', label: 'Desktop' },
                    { id: 'tablet', icon: 'tablet-line', label: 'Tablet' },
                    { id: 'mobile', icon: 'smartphone-line', label: 'Mobile' },
                  ] as const
                ).map(vp => (
                  <IconButton
                    key={vp.id}
                    variant={designViewport === vp.id ? 'secondary' : 'ghost'}
                    size="sm"
                    type="button"
                    aria-pressed={designViewport === vp.id}
                    aria-label={t(vp.label)}
                    title={t(vp.label)}
                    icon={<RemixIcon name={vp.icon} size={14} />}
                    onClick={() => setDesignViewport(vp.id)}
                  />
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                icon={<RemixIcon name="external-link-line" size={13} />}
                onClick={() => {
                  if (item.ref.type === 'design') onOpenDesignProject(item.ref.projectId);
                }}
              >
                {t('Open in Design')}
              </Button>
            </div>
          </div>
          <div className="om-scenario-stage-iframe-wrap" data-viewport={designViewport}>
            {previewUrl ? (
              <iframe
                title={item.label}
                src={previewUrl}
                className="om-scenario-stage-iframe"
                sandbox="allow-scripts allow-same-origin"
              />
            ) : (
              <CoverPlaceholder fill />
            )}
          </div>
        </div>
      );
    }

    if (item.kind === 'motion' && item.ref.type === 'motion') {
      const projectId = item.ref.projectId;
      return (
        <div className="om-scenario-stage-motion-card">
          <StagePosterImage src={scenarioCover(scenario.id)} alt={item.label} />
          {topBar}
          <div className="om-scenario-stage-motion-footer">
            <div className="om-scenario-stage-motion-meta">
              <RemixIcon name="film-line" size={18} />
              <strong>{item.label}</strong>
            </div>
            <Button
              variant="primary"
              size="sm"
              type="button"
              icon={<RemixIcon name="external-link-line" size={14} />}
              onClick={() => void onOpenMotionProject(projectId)}
            >
              {t('Open in Motion')}
            </Button>
          </div>
        </div>
      );
    }

    const textBody = resolvePoolTextContent(item, run);
    return (
      <div className="om-scenario-stage-text-card">
        {topBar}
        <pre className="om-scenario-stage-text-body">{textBody}</pre>
      </div>
    );
  };

  return (
    <section
      className="om-scenario-stage"
      data-step-type={activeTone}
      aria-label={t('Workflow preview stage')}
    >
      <div className="om-scenario-stage-viewport">
        {currentSlide?.kind === 'showcase' && (
          <div className="om-scenario-stage-showcase-bar">
            <span className="om-scenario-stage-pill" data-step-type={currentSlide.stepType}>
              <RemixIcon name={currentSlide.icon} size={13} />
              <span>{t(currentSlide.title)}</span>
              <span className="om-scenario-stage-pill-sep" aria-hidden="true">·</span>
              <span className="om-scenario-stage-pill-muted">{t('Example preview')}</span>
            </span>
            {activeStepGenerating && (
              <span className="om-scenario-stage-pill om-scenario-stage-pill--live" role="status">
                <RemixIcon name="loader-4-line" size={13} className="om-scenario-spin" />
                <span>{t('Generating…')}</span>
              </span>
            )}
          </div>
        )}

        <div
          className="om-scenario-stage-hero"
          data-aspect={heroAspect}
          data-slide-kind={currentSlide?.kind ?? 'showcase'}
        >
          {canNavigate && (
            <IconButton
              variant="plain"
              size="sm"
              type="button"
              className="om-scenario-stage-nav om-scenario-stage-nav--prev"
              aria-label={t('Previous preview')}
              title={t('Previous preview')}
              icon={<RemixIcon name="arrow-left-s-line" size={18} />}
              onClick={handlePrev}
            />
          )}

          <div key={currentSlide?.id ?? 'empty'} className="om-scenario-stage-slide">
            {renderHeroContent()}
          </div>

          {canNavigate && (
            <IconButton
              variant="plain"
              size="sm"
              type="button"
              className="om-scenario-stage-nav om-scenario-stage-nav--next"
              aria-label={t('Next preview')}
              title={t('Next preview')}
              icon={<RemixIcon name="arrow-right-s-line" size={18} />}
              onClick={handleNext}
            />
          )}
        </div>
      </div>

      <div
        className="om-scenario-stage-filmstrip"
        role="toolbar"
        aria-label={t('Preview thumbnails')}
      >
        <div className="om-scenario-filmstrip-track">
          {slides.map((slide, index) => {
            const label =
              slide.kind === 'showcase' ? t(slide.title) : slide.item.label;
            return (
              <FilmstripThumb
                key={slide.id}
                slide={slide}
                selected={index === currentIndex}
                label={label}
                onSelect={() => {
                  setSelectedId(slide.id);
                  setVideoFailedId(null);
                  if (slide.kind === 'showcase' && slide.stepId !== activeStep.id) {
                    onSelectStep(slide.stepId);
                  }
                }}
              />
            );
          })}
          <IconButton
            variant="plain"
            size="md"
            type="button"
            className="om-scenario-filmstrip-add"
            aria-label={t('Open assets')}
            title={t('Assets ({count})', { count: poolItems.length })}
            icon={<RemixIcon name="add-line" size={18} />}
            onClick={onOpenAssets}
          />
        </div>
      </div>
    </section>
  );
}
