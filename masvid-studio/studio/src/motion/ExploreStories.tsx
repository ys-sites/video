import { Button } from 'open-design-ui/button';
import { HorizontalRail } from './HorizontalRail';
import { findTechniqueStudio, type CreativeStudio } from '../../../shared/studio-catalog';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Skeleton } from '../components/ui/Skeleton';
import { ModelStoryGallery, StoryCard } from './ModelStoryGallery';
import { ProviderAvatar } from './settingsPrimitives';
import { useWorkspaceChrome } from './WorkspaceChromeContext';
import type { useMediaCatalog } from './useMediaCatalog';
import { floatingCity, seedanceStory, gptImageStory, storyModels, type ModelStory } from './exploreModelStories';
import { animeOpeningScenario, mcpCapabilities } from './mcpCapabilities';
import { supportsScene, type StudioDestination } from './creativeStudios';
import { archivedSkillPoster } from './skillCatalog';

const sale = archivedSkillPoster('sale-countdown');
const shorts = archivedSkillPoster('multi-clips-to-reels');
const paintedFilm = archivedSkillPoster('footage-to-handpainted');
const printCover = archivedSkillPoster('color-pop-poster');
const blueprint = archivedSkillPoster('chalk-blueprint');
const launch = archivedSkillPoster('premium-halo');

type StoryActions = {
  onNavigate: (target: StudioDestination, prompt: string) => void;
  onModel: (id: string) => void;
  onClaude: (example?: string) => void;
  onChooseStudio: (studio: CreativeStudio) => void;
  onOpenBlackFriday: (button: HTMLButtonElement) => void;
};

export function ExploreHighlights({ onChooseStudio, onOpenBlackFriday }: Pick<StoryActions, 'onChooseStudio' | 'onOpenBlackFriday'>) {
  const { t } = useI18n();
  const jump = (id: string) => {
    const heading = document.getElementById('explore-' + id);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  };
  return <section aria-labelledby="explore-highlights">
    <header className="om-discovery-heading"><h2 id="explore-highlights">{t('Explore highlights')}</h2></header>
    <HorizontalRail label="Explore highlights" className="om-highlights" viewportClassName="om-stories-rail">
      <StoryCard title={seedanceStory.title} poster={paintedFilm} label={t('Cinema Studio') + ' · ' + t('Video')} description={seedanceStory.description} onClick={() => jump('seedance')} />
      <StoryCard title="Black Friday collection" poster={sale} label={t('Template library')} description="Browse Black Friday video references and Skills for your sale." onClick={event => onOpenBlackFriday(event.currentTarget)} />
      <StoryCard title="Claude Fable 5.2" poster={blueprint} label="Claude Code · OpenMotion MCP" description="From a keyframe to an anime opening" onClick={() => jump('claude')} />
      <StoryCard title={gptImageStory.title} poster={printCover} label={t('Design Studio') + ' · ' + t('Image')} description={gptImageStory.description} onClick={() => jump('gpt-image')} />
      <StoryCard title="Shorts Studio" poster={shorts} label={t('Short-form video')} description="Cut a recording into vertical shorts or assemble several clips into one reel." onClick={() => onChooseStudio(findTechniqueStudio('shorts')!)} />
    </HorizontalRail>
  </section>;
}

export function ModelCollection({ story, gateway, onNavigate, onModel }: {
  story: ModelStory; gateway: ReturnType<typeof useMediaCatalog>;
} & Pick<StoryActions, 'onNavigate' | 'onModel'>) {
  const { t } = useI18n(), { openModelSettings } = useWorkspaceChrome();
  const models = storyModels(story, gateway.catalog);
  const loading = !gateway.catalog && !gateway.failed;
  const featured = models.find(model => supportsScene(model, story.cases[0].destination.scene))
    ?? models.find(model => story.cases.some(c => supportsScene(model, c.destination.scene)));
  const heading = 'explore-' + story.id;
  return <section aria-labelledby={heading}>
    <header className="om-discovery-heading"><div>
      <h2 id={heading} tabIndex={-1}>{story.title}</h2>
      <p className="om-muted">{t(story.description)}</p>
    </div>
      {loading ? <Skeleton className="om-story-action-skeleton" /> : gateway.failed ? <Button type="button" variant="secondary" className="om-button" onClick={gateway.retry}>{t('Retry loading models')}</Button> :
        <Button type="button" variant="secondary" className="om-button" onClick={featured ? () => onModel(featured.id) : openModelSettings}>{t(featured ? 'Model details' : 'Manage providers')}<RemixIcon name="arrow-right-line" size={16} /></Button>}
    </header>
    <ModelStoryGallery story={story} models={models} loading={loading} onNavigate={onNavigate} brandedFallback showLabels={false} />
  </section>;
}

export function ClaudeStories({ onClaude }: Pick<StoryActions, 'onClaude'>) {
  const { t } = useI18n();
  const film = mcpCapabilities.find(capability => capability.id === 'create')!;
  return <section className="om-card om-claude-stories" aria-labelledby="explore-claude">
    <div className="om-claude-intro">
      <span className="om-feed-card-label"><ProviderAvatar name="Claude" provider={{ id: 'claude-code', custom: false }} />OpenMotion MCP</span>
      <div className="om-discovery-heading"><h2 id="explore-claude" tabIndex={-1}>Claude Fable 5.2</h2></div>
      <p className="om-muted">{t('Choose Fable in Claude Code to plan shots, work with your media models and build an editable film through MCP.')}</p>
      <Button type="button" variant="primary" className="om-button" data-primary onClick={() => onClaude()}>{t('Connect Claude Code')}<RemixIcon name="plug-line" size={16} /></Button>
    </div>
    <StoryCard title={animeOpeningScenario.title} label="GPT Image 2.6 → Seedance 2.5" poster={floatingCity.poster} credit={floatingCity.credit} creditUrl={floatingCity.creditUrl} description={animeOpeningScenario.description} onClick={() => onClaude(animeOpeningScenario.id)} />
    <StoryCard title={film.title} label={'Claude Code · ' + t('Motion Studio')} poster={launch} description={film.description} onClick={() => onClaude(film.id)} />
  </section>;
}
