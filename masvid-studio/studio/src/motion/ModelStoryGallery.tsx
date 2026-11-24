import type { MouseEventHandler } from 'react';
import { Button } from 'open-design-ui/button';
import type { Model } from '../../../shared/gateway';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { TemplatePoster } from './TemplateGalleryCard';
import type { ModelStory } from './exploreModelStories';
import { supportsScene, type StudioDestination } from './creativeStudios';

export function StoryCard({ title, label, description, poster, position, credit, creditUrl, onClick, disabled, brandedFallback = true }: {
  title: string; label?: string; description?: string; poster: string; position?: string; credit?: string; creditUrl?: string;
  onClick: MouseEventHandler<HTMLButtonElement>; disabled?: boolean; brandedFallback?: boolean;
}) {
  const { t } = useI18n();
  return <article className="om-story-item"><Button type="button" variant="ghost" className="om-scene-tile om-story-card h-auto whitespace-normal font-normal items-stretch justify-normal enabled:hover:bg-transparent enabled:active:scale-100" onClick={onClick} disabled={disabled}>
    <span className="om-scene-tile-art" style={{ objectPosition: position }}>
      <TemplatePoster key={poster} template={{ title: t(title), posterUrl: poster }} brandedFallback={brandedFallback} />
    </span>
    {label && <span className="om-feed-card-label">{label}</span>}
    <strong>{t(title)}<RemixIcon name="arrow-right-up-line" size={16} /></strong>
    {description && <span className="om-feed-card-description">{t(description)}</span>}
  </Button>
    {credit && <small className="om-story-credit">{creditUrl ? <a className="om-text-link" data-quiet href={creditUrl} target="_blank" rel="noreferrer">{credit}</a> : credit}</small>}
  </article>;
}

export function ModelStoryGallery({ story, models, loading, exact, onNavigate, brandedFallback = false, showLabels = true }: {
  story: ModelStory; models: Model[]; loading?: boolean; exact?: boolean; brandedFallback?: boolean; showLabels?: boolean;
  onNavigate: (target: StudioDestination, prompt: string) => void;
}) {
  const { t } = useI18n();
  return <div className="om-story-gallery" aria-busy={Boolean(loading)}>{story.cases.map(({ destination, example }) => {
    const model = models.find(item => supportsScene(item, destination.scene));
    if (exact && !model) return null;
    const action = !loading && !model ? 'Choose a model' : destination.scene.label;
    return <StoryCard key={example.title} {...example} label={showLabels ? t(destination.studio.title) + ' · ' + t(action) : undefined}
      position={example.posterPosition} description={example.prompt} disabled={loading} brandedFallback={brandedFallback}
      onClick={() => onNavigate({ ...destination, model: model?.id ?? null }, t(example.prompt))} />;
  })}</div>;
}
