import { Button } from 'open-design-ui/button';
import { HorizontalRail } from './HorizontalRail';
import { collectionFacet, industryCollection } from './templateCollections';
import { TemplateIndustryMenu } from './TemplateIndustryMenu';
import { SkillSubmissionLink } from './SkillSubmissionLink';
import { templateContributionUrl } from './templateContribution';
import { MotionIcon } from './icons';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { exploreCommunities, findMediaStudio, findTechniqueStudio, type CreativeStudio, type ExploreCommunity, type MediaStudio } from '../../../shared/studio-catalog';
import type { GalleryTemplate, TemplatePage } from '../../../shared/catalog';
import type { ExploreFilters, TemplateCollection } from './workspacePageRouting';
import { languages, useI18n, type Locale } from '../i18n/I18n';
import { Select } from '../components/ui/Select';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { ExploreCoverImage } from './ExploreCoverImage';
import { RemixIcon } from '../icons/RemixIcons';
import { discord, feishu } from './CommunityLink';
import { GITHUB_REPOSITORY } from './githubRepository';
import { clickOption, trackStudioClick } from './editorTracking';
import { creativeStudios, mediaEditorDestination, mediaLabels, motionStudio, scenesForStudio, studioScenes, type StudioDestination, type StudioScene } from './creativeStudios';
import { sceneExamples, type SceneExample } from './sceneShowcase';
import { AssetHoverVideo } from './AssetHoverVideo';
import { useTemplatePlayback } from './useTemplatePlayback';
import { editingPresets, motionSkills, skillCategories, type SkillCategory, type MotionSkill } from './skillCatalog';
import { useWorkspaceChrome } from './WorkspaceChromeContext';
import { ExploreActionLabel, ExploreTemplateCard, TemplatePromptAction, useExploreTemplates, useExploreTemplateShelf, type ExploreTemplateFilter } from './ExploreTemplates';
import { ClaudeStories, ExploreHighlights, ModelCollection } from './ExploreStories';
import { gptImageStory, seedanceStory } from './exploreModelStories';
import { ExploreSpotlight, featuredSceneIds } from './ExploreSpotlight';
import { SkillMedia } from './SkillMedia';
import { ExploreShelf } from './ExploreShelf';
import { TemplateGalleryCard, TemplatePoster, TopBrandsLabel } from './TemplateGalleryCard';
import { MediaModelChoices } from './MediaModelChoices';
import { useMediaCatalog } from './useMediaCatalog';
import { destinationTarget, reportCreativeClick, type CreativeTarget } from './exploreTracking';
import { skillCategoryId } from './pageTracking';
import { optionId, send, slugField } from './reporting';
import { ExploreDesignSection } from '../design/scenes/ExploreDesignSection';
import type { DesignTabId } from '../design/scenes/DesignSceneTabs';
import { scenarioDefinitions, type ScenarioId } from '../../../shared/scenarios';
import { ScenarioHighlights } from './ScenarioHighlights';
import './sceneDiscovery.css';

type ExploreArea = Parameters<typeof reportCreativeClick>[1];
const track = (area: ExploreArea, element: Parameters<typeof reportCreativeClick>[2], target: CreativeTarget = {}) => reportCreativeClick('explore', area, element, target);
/** Feed cards in the main feed report as explore_feed; cards inside a Studio section report that section as the collection. */
const cardArea = (section: string): { area: ExploreArea; collection?: string } => section === 'feed' ? { area: 'explore_feed' } : { area: 'explore_collection', collection: section };

function templateShelfTarget(value: ExploreTemplateFilter | null) {
  if (!value || value === 'all') return { collection_id: 'all' };
  const selectedFacet = collectionFacet(value);
  return {
    ...slugField('collection_id', value),
    ...(selectedFacet ? { filter_group: selectedFacet.key, ...optionId(selectedFacet.value) } : {}),
  };
}

const templateVideoDestination = mediaEditorDestination('text-to-video');
const discoveryStudios = [motionStudio, ...creativeStudios.filter(studio => studio.surface !== 'editor')];
const mediaCollections = {
  image: { title: 'Image creation', description: 'Create an image from a description or edit a reference image.' },
  video: { title: 'Cinematic shots', description: 'Create a video shot from text or bring a still frame to life.' },
  audio: { title: 'Music and voiceover', description: 'Set a mood with music or turn a script into voiceover.' },
} as const;

const templatePreviewLimit = 8;
const skillFilters = [['all', 'All'], ...skillCategories.map(category => [category, category] as const)] as const;
/** Round-robin covered Skills across categories so the four-column preview fills two complete rows. */
const coveredByCategory = skillCategories.map(category => motionSkills.filter(skill => skill.category === category && skill.cover?.poster));
const featuredSkills = Array.from({ length: Math.max(...coveredByCategory.map(list => list.length)) }, (_, round) =>
  coveredByCategory.flatMap(list => list[round] ?? [])).flat().slice(0, templatePreviewLimit);

type ExploreProps = {
  initialTemplateCollection?: TemplateCollection | null;
  onSkill: (id: string) => void;
  onChooseStudio: (studio: CreativeStudio) => void;
  onOpenMotionEditor: () => void;
  motionEditorDisabled: boolean;
  onNavigate: (target: StudioDestination, prompt?: string) => void;
  onModel: (id: string) => void;
  onModelHub: (id: string) => void;
  onCreators: (trigger: HTMLElement) => void;
  onOpenBlackFriday: (trigger: HTMLButtonElement) => void;
  onBrandKit: () => void;
  onMcp: (client?: 'claude', example?: string) => void;
  onSelectDesignScene?: (scene: DesignTabId) => void;
  onOpenDesignProject?: (projectId: string) => void;
  onStartScenario?: (id: ScenarioId) => void;
  onOpenScenarioHub?: () => void;
  active: boolean;
  filters: ExploreFilters;
};

function FeedCard({ title, action, badge, studioLabel, description, poster, posterPosition, credit, onClick, sceneId, children, playbackId, onPriority }: {
  title: string; action?: 'Use this prompt' | 'Use Skill'; badge?: string; studioLabel?: string; description: string; poster?: string; posterPosition?: string; credit?: string; onClick: () => void; sceneId?: string;
  children?: ReactNode; playbackId?: string; onPriority?: (id: string | null) => void;
}) {
  const summary = <span className="om-feed-card-description">{description}</span>;
  return <Button variant="plain" className="om-scene-tile" data-scene={sceneId} data-playback-id={playbackId} onClick={onClick}
    onMouseEnter={playbackId ? () => onPriority?.(playbackId) : undefined} onMouseLeave={playbackId ? () => onPriority?.(null) : undefined}
    onFocus={playbackId ? () => onPriority?.(playbackId) : undefined} onBlur={playbackId ? () => onPriority?.(null) : undefined}>
    <span className="om-scene-tile-art">
      {sceneId && <ExploreCoverImage src={poster} position={posterPosition} />}{children}
      {credit && <small className="om-scene-credit">{credit}</small>}
    </span>
    <span className="om-feed-template-copy">
      <span className="om-feed-card-title">
        <strong>{title}</strong>
        {badge && <span className="om-feed-skill-badge">{badge}</span>}
      </span>
      {studioLabel ? <span className="om-feed-card-meta"><span className="om-feed-card-label">{studioLabel}</span>{summary}</span> : summary}
      {action && <span className="om-nav-item om-feed-prompt-action"><ExploreActionLabel label={action} /></span>}
    </span>
  </Button>;
}

type FeedPlayback = { playing: Set<string>; onPriority: (id: string | null) => void };
function SceneFeedCard({ target, example, section, onNavigate, playing, onPriority, community }: FeedPlayback & {
  target: StudioDestination; example: SceneExample; section: string; onNavigate: ExploreProps['onNavigate']; community?: string;
}) {
  const { t } = useI18n();
  const { scene, studio } = target;
  const id = example.clip ? [section, scene.id, example.title].join('/') : undefined;
  // Name the top tab the card opens, matching the navigation it highlights.
  const destinationLabel = target.landing || target.mediaTab ? t(mediaLabels[studio.surface === 'media' ? studio.primaryModality : scene.modality]) : t(studio.title);
  return <FeedCard sceneId={scene.id} action="Use this prompt" title={t(example.title)}
    studioLabel={['cinema', 'design', 'feed'].includes(section) ? undefined : destinationLabel + ' · ' + t(scene.label)}
    description={t(scene.hint)} poster={example.poster} posterPosition={example.posterPosition} credit={example.credit}
    playbackId={id} onPriority={onPriority} onClick={() => {
      const { area, collection } = cardArea(section);
      track(area, 'open_scene', { ...destinationTarget(target), collection, community });
      onNavigate(target, t(example.prompt));
    }}>
    {example.clip && id && playing.has(id) && <AssetHoverVideo src={example.clip} />}
  </FeedCard>;
}

const threeDCardDescriptions: Partial<Record<string, string>> = {
  'three-js': 'Rotate a globe or product and show it from different camera angles.',
  'babylon-js': 'Light a product turntable and move the camera smoothly.',
  lume: 'Float cards or objects in 3D with lighting and camera movement.',
  blender: 'Animate a character with anticipation and follow-through.',
  'openmotion-isometric-card-flight': 'Fly in tilted UI cards, then straighten and enlarge the main screen.',
  'openmotion-surreal-3d-poster': 'Reveal a product among drifting clay shapes with oversized type behind it.',
};

function SkillFeedCard({ skill, section, onSkill, playing, onPriority, community }: FeedPlayback & {
  skill: MotionSkill; section: string; onSkill: ExploreProps['onSkill']; community?: string;
}) {
  const { t } = useI18n();
  const id = section + '/' + skill.id;
  const onSkillsShelf = section === 'skills';
  const description = section === '3d' ? threeDCardDescriptions[skill.id] ?? skill.tagline : skill.tagline;
  return <FeedCard title={t(skill.title)} badge={onSkillsShelf ? undefined : 'Skill'} action={section === 'feed' ? 'Use Skill' : undefined} description={t(description)}
    playbackId={id} onPriority={onPriority} onClick={() => {
      const { area, collection } = cardArea(section);
      track(area, 'open_skill', { skill: skill.id, collection, community });
      onSkill(skill.id);
    }}>
    <SkillMedia skill={skill} playing={playing.has(id)} brandedFallback />
  </FeedCard>;
}

function CommunitySpotlight({ community, skill, onChooseStudio }: {
  community: ExploreCommunity; skill: MotionSkill | undefined; onChooseStudio: ExploreProps['onChooseStudio'];
}) {
  const { t } = useI18n();
  const lead = creativeStudios.find(studio => studio.id === community.studios[0])!;
  return <section className="om-discovery-hero" aria-label={t(community.label)}>
    <div className="om-community-hero-art"><ExploreCoverImage src={skill?.cover?.poster} eager /></div>
    <div className="om-discovery-hero-copy"><span>{t('Communities')}</span><h2>{t(community.label)}</h2>
      <p>{t(community.description)}</p><Button variant="ghost" className="om-button h-auto" data-primary="media" onClick={() => { track('explore_spotlight', 'open_studio', { studio: lead.id, community: community.id }); onChooseStudio(lead); }}>{t(lead.title)}<RemixIcon name="arrow-right-line" size={16} /></Button>
    </div>
  </section>;
}

function TemplateSpotlight({ item, onTry }: { item: GalleryTemplate; onTry: (prompt: string) => void }) {
  const { t } = useI18n(), { openLibrary } = useWorkspaceChrome();
  return <article className="om-featured-template"><Button variant="plain" className="om-featured-open" aria-label={t('Preview template {title}', { title: item.title })}
    onClick={event => { track('explore_featured', 'open_template', { template: item.id }); openLibrary(event.currentTarget, item); }}>
    <div className="om-featured-cover"><TemplatePoster key={item.id} template={item} eager brandedFallback /></div>
    <div className="om-featured-caption"><span className="om-feed-card-label">{t('Community template')}</span>
      <strong>{item.title}<RemixIcon name="arrow-right-up-line" size={22} /></strong>
      <small>{item.authorName || item.author || item.brand}</small>
    </div>
  </Button><TemplatePromptAction item={item} onTry={prompt => { track('explore_featured', 'try_prompt', { template: item.id }); onTry(prompt); }} /></article>;
}

function StudioCollection({ studio, medium, onChooseStudio, onSkill, onNavigate, onSelectDesignScene, onOpenDesignProject, ...playback }: FeedPlayback & {
  studio: CreativeStudio; medium: ExploreFilters['medium'];
} & Pick<ExploreProps, 'onChooseStudio' | 'onSkill' | 'onNavigate' | 'onSelectDesignScene' | 'onOpenDesignProject'>) {
  const { t } = useI18n();
  const community = exploreCommunities.find(item => item.studios[0] === studio.id);
  let description: string;
  let cards: ReactNode[];
  let title: string;
  if (studio.surface === 'media') {
    const collection = mediaCollections[studio.primaryModality];
    title = collection.title;
    description = collection.description;
    cards = scenesForStudio(studio).filter(scene => !medium || medium === scene.modality).flatMap(scene => {
      const target = mediaEditorDestination(scene);
      const examples = studio.id === 'design' ? sceneExamples[scene.id] : sceneExamples[scene.id].slice(0, 1);
      return examples.map(example => <SceneFeedCard key={scene.id + '/' + example.title} section={studio.id}
        target={target} example={example} onNavigate={onNavigate} {...playback} />);
    });
  } else {
    if (medium && medium !== 'video') return null;
    title = community?.label ?? studio.title;
    description = studio.surface === 'editor' ? 'Animate type and shapes, then edit their timing on the timeline.' : community?.description ?? studio.briefHint;
    const techniques = studio.surface === 'techniques' ? studio.techniques : community?.source === 'templates' ? community.skills : [];
    cards = techniques.slice(0, templatePreviewLimit).flatMap(id => {
      const skill = motionSkills.find(item => item.id === id);
      return skill ? [<SkillFeedCard key={id} section={studio.id} skill={skill} onSkill={onSkill} {...playback} />] : [];
    });
  }
  if (!cards.length) return null;
  // Image generation opens the unified Image editor; HTML design work keeps Design Studio as its own collection.
  const imageEditor = studio.id === 'design' ? mediaEditorDestination('text-to-image') : null;
  const openCollection = () => {
    if (imageEditor) {
      track('explore_collection', 'open_scene', { ...destinationTarget(imageEditor), collection: 'image' });
      onNavigate(imageEditor);
      return;
    }
    track('explore_collection', 'open_studio', { studio: studio.id, collection: studio.id });
    onChooseStudio(studio);
  };
  const collection = <section className="om-studio-collection" aria-label={t(title)} data-studio={imageEditor ? 'image' : studio.id}>
    <header className="om-discovery-heading"><div><h2>{t(title)}</h2><p className="om-muted">{t(description)}</p></div>
      <Button variant="ghost" className="om-button h-auto" onClick={openCollection}>{t(imageEditor ? mediaLabels.image : studio.title)}<RemixIcon name="arrow-right-line" size={16} /></Button>
    </header>
    <HorizontalRail label={title} viewportClassName="om-studio-collection-cards">{cards}</HorizontalRail>
  </section>;
  if (!imageEditor || !onSelectDesignScene || !onOpenDesignProject) return collection;
  return <>{collection}
    <section className="om-studio-collection" aria-label={t(studio.title)} data-studio={studio.id}>
      <header className="om-discovery-heading"><div><h2>{t(studio.title)}</h2></div>
        <Button variant="ghost" className="om-button h-auto" onClick={() => { track('explore_collection', 'open_studio', { studio: studio.id, collection: studio.id }); onChooseStudio(studio); }}>{t(studio.title)}<RemixIcon name="arrow-right-line" size={16} /></Button>
      </header>
      <ExploreDesignSection onSelectDesignScene={onSelectDesignScene} onOpenProject={onOpenDesignProject} />
    </section>
  </>;
}

const OPEN_DESIGN_SITE = 'https://open-design.ai';
const footerSocialLinks = [
  { label: 'X / Twitter', href: 'https://x.com/OpenDesignHQ' },
  { label: 'YouTube', href: 'https://www.youtube.com/@Open-Design-ai' },
  { label: 'GitHub', href: GITHUB_REPOSITORY },
  { label: discord.platform, href: discord.href },
] as const;
const footerLegalLinks = [
  { label: 'About', href: `${OPEN_DESIGN_SITE}/about` },
  { label: 'Documentation', href: `${GITHUB_REPOSITORY}/tree/main/docs` },
  { label: 'Privacy Policy', href: `${OPEN_DESIGN_SITE}/privacy` },
  { label: 'Terms of Service', href: `${OPEN_DESIGN_SITE}/terms` },
  { label: 'Refund Policy', href: `${OPEN_DESIGN_SITE}/refund` },
  { label: 'Report an issue', href: `${GITHUB_REPOSITORY}/issues/new/choose` },
] as const;

function CapabilityIndex({ active, onModel, onNavigate, onChooseStudio, onBrandKit, onMcp, onSkill, onStartScenario, onOpenScenarioHub }: Pick<ExploreProps, 'active' | 'onModel' | 'onNavigate' | 'onChooseStudio' | 'onBrandKit' | 'onMcp' | 'onSkill' | 'onStartScenario' | 'onOpenScenarioHub'>) {
  const { t, locale, setLocale } = useI18n(), { openAssets, openModelSettings, openLibrary, openSkills } = useWorkspaceChrome();
  const [skillCategory, setSkillCategory] = useState<SkillCategory | null>(null);
  const [modelsFor, setModelsFor] = useState<StudioScene['modality'] | null>(null);
  const gateway = useMediaCatalog(active && modelsFor !== null);
  const mediaStudios = creativeStudios.filter((studio): studio is MediaStudio => studio.surface === 'media');
  const primaryMediaStudios = mediaStudios.filter(studio => studio.primaryModality !== 'audio');
  const audioStudio = mediaStudios.find(studio => studio.primaryModality === 'audio');
  const renderMediaColumn = (studio: MediaStudio) => {
    const kind = studio.primaryModality;
    return <div key={kind}><h3>{t(mediaLabels[kind])}</h3>
      {scenesForStudio(studio).map(scene => <Button variant="plain" className="om-nav-item" key={scene.id} onClick={() => {
        const target = mediaEditorDestination(scene);
        track('capability_index', 'select_scene', destinationTarget(target));
        onNavigate(target);
      }}>{t(scene.label)}</Button>)}
      <Button variant="plain" className="om-nav-item" aria-expanded={modelsFor === kind} aria-controls={modelsFor === kind ? 'om-explore-models' : undefined}
        aria-label={t(mediaLabels[kind]) + ' · ' + t('Models')} onClick={() => { track('capability_index', 'models_toggle', { medium: kind, expanded: modelsFor !== kind }); setModelsFor(modelsFor === kind ? null : kind); }}>
        {t('Models')}<RemixIcon name="arrow-down-s-line" size={14} />
      </Button>
      {modelsFor === kind && <div className="om-index-models" id="om-explore-models">
        <MediaModelChoices {...gateway} kind={kind} onModel={model => { track('capability_index', 'select_model', { medium: kind, model }); onModel(model); }}
          onNavigate={target => { track('capability_index', 'select_model', { medium: kind, ...destinationTarget(target) }); onNavigate(target); }}
          openProviders={() => { track('capability_index', 'open_providers', { medium: kind }); openModelSettings(); }} />
      </div>}
    </div>;
  };
  return <footer className="om-capability-index" aria-label={t('Capability index')}><div className="om-capability-inner">
    <div className="om-capability-brand">
      <h2 lang="en">Open Design</h2>
      <p className="om-capability-definition" lang="en">The open source AI-NATIVE creative SUITE</p>
    </div>
    <div className="om-capability-body">
    <div className="om-capability-columns">
      {onStartScenario && <div>
        <h3>{t('Workflows')}</h3>
        {scenarioDefinitions.map(scenario => <Button variant="plain" className="om-nav-item" key={scenario.id} onClick={() => {
          track('capability_index', 'select_scene', { navTarget: 'workflows', studio: scenario.id });
          onStartScenario(scenario.id);
        }}>{t(scenario.title)}</Button>)}
        {onOpenScenarioHub && <Button variant="plain" className="om-nav-item" onClick={() => {
          track('capability_index', 'open_studio', { navTarget: 'workflows' });
          onOpenScenarioHub();
        }}>{t('All workflows')}</Button>}
      </div>}
      {primaryMediaStudios.map(renderMediaColumn)}
      <div><h3>{t('Studios')}</h3>{creativeStudios.map(studio => <Button variant="plain" className="om-nav-item" key={studio.id} onClick={() => { track('capability_index', 'open_studio', { studio: studio.id }); onChooseStudio(studio); }}>{t(studio.title)}</Button>)}</div>
      <div className="om-capability-column-stack">
        {audioStudio && renderMediaColumn(audioStudio)}
        <div><h3>{t('Workspace')}</h3>
          <Button variant="plain" className="om-nav-item" onClick={event => { track('capability_index', 'template_library'); openLibrary(event.currentTarget); }}>{t('Template library')}</Button>
          <Button variant="plain" className="om-nav-item" onClick={() => { track('capability_index', 'open_brand_kit'); onBrandKit(); }}>{t('Brand Kit')}</Button>
          <Button variant="plain" className="om-nav-item" onClick={() => { track('capability_index', 'open_assets'); openAssets(); }}>{t('Workspace assets')}</Button>
          <Button variant="plain" className="om-nav-item" onClick={() => { track('capability_index', 'open_providers'); openModelSettings(); }}>{t('Model providers')}</Button>
          <Button variant="plain" className="om-nav-item" onClick={() => { track('capability_index', 'open_mcp'); onMcp(); }}>{t('MCP · Connect Agent')}</Button>
        </div>
      </div>
    </div>
    <div className="om-index-skills">
      <h3 className="om-subtitle"><Button variant="plain" className="om-nav-item" onClick={event => {
        track('capability_index', 'open_skills');
        openSkills(null, event.currentTarget);
      }}>{t('Skills')}<RemixIcon name="arrow-right-line" size={16} /></Button></h3>
      <div className="om-index-skill-categories" role="group" aria-label={t('Skill category')}>{skillCategories.map(category =>
        <Button variant="plain" className="om-nav-item" key={category} aria-expanded={skillCategory === category} onClick={() => {
          send('ui_click', { page_name: 'explore', area: 'capability_index', element: 'skill_category', skill_category: skillCategoryId(category), expanded: category !== skillCategory });
          setSkillCategory(category === skillCategory ? null : category);
        }}>
          {t(category)}<RemixIcon name="arrow-down-s-line" size={14} />
        </Button>)}</div>
      {skillCategory && <div className="om-index-skill-links" aria-label={t(skillCategory)}>{motionSkills.filter(skill => skill.category === skillCategory).map(skill =>
        <Button variant="plain" className="om-nav-item om-creative-option" key={skill.id} onClick={() => { track('capability_index', 'select_skill', { skill: skill.id }); onSkill(skill.id); }}>
          <span><strong>{t(skill.title)}</strong><small className="om-muted">{t(skill.tagline)}</small></span>
        </Button>)}</div>}
    </div>
    </div>
  </div>
  <div className="om-capability-meta">
    <p className="om-capability-meta-copy" lang="en">
      <a href={OPEN_DESIGN_SITE} target="_blank" rel="noopener noreferrer">open-design.ai</a>
      <span aria-hidden="true"> · </span>
      <span>OpenDesign &amp; OpenMotion</span>
    </p>
    <nav className="om-capability-social" aria-label={t('Social channels')}>
      {footerSocialLinks.map(link => (
        <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" lang="en">{link.label}</a>
      ))}
      {locale === 'zh-CN' && (
        <a href={feishu.href} target="_blank" rel="noopener noreferrer">{t('Feishu group')}</a>
      )}
    </nav>
  </div>
  <div className="om-capability-legal">
    <div className="om-capability-legal-inner">
      <p className="om-capability-copyright" lang="en">
        <span>© 2026 Powerformer, Inc.</span>
        <span aria-hidden="true"> · </span>
        <a href={`${GITHUB_REPOSITORY}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">Apache-2.0</a>
      </p>
      <div className="om-capability-legal-actions">
        <div className="om-capability-locale">
          <Select
            label={t('Language')}
            value={locale}
            className="om-capability-locale-trigger"
            onCommit={value => {
              if (value !== locale) trackStudioClick('settings', 'language_change', undefined, undefined, clickOption(value));
              setLocale(value as Locale);
            }}
            options={languages.map(item => ({
              value: item.locale,
              label: item.label,
              icon: <RemixIcon name="global-line" size={14} />,
            }))}
          />
        </div>
        <nav className="om-capability-legal-links" aria-label={t('Legal and policy links')}>
          {footerLegalLinks.map(link => (
            <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">{t(link.label)}</a>
          ))}
        </nav>
      </div>
    </div>
  </div>
  </footer>;
}

function ExploreCollection({ community, root, firstPages, ...props }: ExploreProps & { firstPages: Map<string, TemplatePage>; community?: ExploreCommunity; root: RefObject<HTMLElement | null> }) {
  const { t, locale } = useI18n();
  const { active, onNavigate, onChooseStudio, onSkill, filters } = props;
  const { openLibrary, openSkills } = useWorkspaceChrome();
  const [priority, setPriority] = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState<ExploreTemplateFilter>(props.initialTemplateCollection ?? 'all');
  const [skillFilter, setSkillFilter] = useState<SkillCategory | 'all'>('all');
  const shelfSkills = (skillFilter === 'all' ? featuredSkills : motionSkills.filter(skill => skill.category === skillFilter)).slice(0, templatePreviewLimit);
  const specialty = community?.source === 'techniques' ? findTechniqueStudio(community.studio) : undefined;
  const skillIds = specialty?.techniques ?? (community?.source === 'templates' ? community.skills : undefined);
  const skills = skillIds ? skillIds.flatMap(id => motionSkills.filter(skill => skill.id === id)) : editingPresets;
  const medium = community ? null : filters.medium;
  const home = !community && !medium;
  const showModelStories = !community && medium !== 'audio';
  const gateway = useMediaCatalog(active && showModelStories);
  const scenes = studioScenes.filter(scene => (!medium || scene.modality === medium) && (!community ||
    (community.source === 'templates' && community.scenes.some(id => id === scene.id))));
  const showMotion = !medium || medium === 'video';
  const showTemplates = showMotion && !specialty;
  const templates = useExploreTemplates(community?.source === 'techniques' ? undefined : community?.category ?? 'all', locale, '', community ? templatePreviewLimit : templatePreviewLimit + 2, firstPages);
  const showShelves = !community && showMotion;
  const shelf = useExploreTemplateShelf(templateFilter, locale, showShelves, active, templates, templatePreviewLimit);
  const shelfItems = shelf.items;
  const facet = collectionFacet(shelf.collection);
  const firstTemplatePage = templates.pages[0];
  const firstPage = firstTemplatePage?.items ?? [];
  const featuredTemplate = medium ? undefined : firstPage[0];
  const communityPicks = home ? firstPage.slice(1, 5) : [];
  const initialTemplateError = templates.error && !firstTemplatePage;
  const catalogKey = [medium, skillFilter, templateFilter, ...shelfItems.map(item => item.id), firstPage.map(item => item.id).join(',')].join('|');
  const playing = useTemplatePlayback(root, catalogKey, active && showMotion, true, priority);
  const sceneCards = scenes.filter(scene => community || medium || !featuredSceneIds.includes(scene.id)).map(scene => {
    return <SceneFeedCard key={scene.id} section="feed" target={mediaEditorDestination(scene)} example={sceneExamples[scene.id][0]}
      onNavigate={onNavigate} playing={playing} onPriority={setPriority} community={community?.id} />;
  });
  const skillCards = showMotion ? (community ? skills : skills.slice(0, 3)).map(skill => <SkillFeedCard key={skill.id} section="feed" skill={skill}
    onSkill={onSkill} playing={playing} onPriority={setPriority} community={community?.id} />) : [];
  const tryVideoPrompt = (prompt: string) => onNavigate(templateVideoDestination, prompt);
  const templateCard = (item: GalleryTemplate) => <ExploreTemplateCard key={item.id} item={item} active={playing.has('community/' + item.id)} onPriority={setPriority}
    onOpen={() => track('explore_feed', 'open_template', { template: item.id, community: community?.id })}
    onTry={prompt => { track('explore_feed', 'try_prompt', { template: item.id, community: community?.id }); tryVideoPrompt(prompt); }} />;
  const feedStart = medium ? 0 : communityPicks.length + 1;
  const firstTemplates = showTemplates ? firstPage.slice(feedStart).map(templateCard) : [];

  // Reserve the template slots so the scene and Skill beside each one stay in place on first load.
  if (showTemplates && templates.loading && !firstTemplatePage) {
    for (let i = 0; i < Math.max(sceneCards.length, skillCards.length, 1); i++) {
      firstTemplates.push(<div key={'pending-' + i} className="om-gallery-card" aria-hidden="true"><CoverPlaceholder className="om-feed-template-placeholder" /></div>);
    }
  }
  const firstGroup: ReactNode[] = [];
  for (let i = 0; i < Math.max(sceneCards.length, firstTemplates.length, skillCards.length); i++) {
    firstGroup.push(firstTemplates[i], sceneCards[i], skillCards[i]);
  }
  const studioSection = (studio: CreativeStudio) => <StudioCollection key={studio.id} studio={studio} medium={medium}
    onSelectDesignScene={props.onSelectDesignScene} onOpenDesignProject={props.onOpenDesignProject}
    onNavigate={onNavigate} onChooseStudio={onChooseStudio} onSkill={onSkill} playing={playing} onPriority={setPriority} />;
  const initialLoading = templates.loading && !firstTemplatePage;
  const showCommunityPicks = home && (initialLoading || communityPicks.length > 0);
  const feedLoading = templates.loading && (medium || firstTemplatePage);
  const feedError = templates.error && (medium || !initialTemplateError);
  const feedEmpty = !templates.error && !templates.loading && !firstPage.length;
  const templateError = <div className="om-discovery-empty"><span>{t('Templates could not be loaded.')}</span><Button variant="ghost" className="om-button h-auto" onClick={templates.retry}>{t('Retry')}</Button></div>;
  return <>
    {!medium && <div className="om-explore-features" data-split={Boolean(featuredTemplate || initialTemplateError || initialLoading)}>
      {community ? <CommunitySpotlight community={community} skill={skills[0]} onChooseStudio={onChooseStudio} /> :
        <ExploreSpotlight active={active} onOpenBlackFriday={props.onOpenBlackFriday} onNavigate={onNavigate}
          onOpenMotionEditor={props.onOpenMotionEditor} motionEditorDisabled={props.motionEditorDisabled} onModelHub={props.onModelHub} onStartScenario={props.onStartScenario} />}
      {featuredTemplate && <TemplateSpotlight item={featuredTemplate} onTry={tryVideoPrompt} />}
      {initialTemplateError && templateError}
      {initialLoading && <CoverPlaceholder className="om-featured-template-skeleton" />}
    </div>}
    {home && <>
      {props.onStartScenario && props.onOpenScenarioHub && (
        <ScenarioHighlights onStartScenario={props.onStartScenario} onOpenHub={props.onOpenScenarioHub} />
      )}
      <ExploreHighlights onChooseStudio={onChooseStudio} onOpenBlackFriday={props.onOpenBlackFriday} />
      <ClaudeStories onClaude={example => props.onMcp('claude', example)} />
    </>}
    {showCommunityPicks && <section aria-labelledby="explore-community">
      <header className="om-discovery-heading"><h2 id="explore-community">{t('Community showcase')}</h2>
        <Button type="button" variant="secondary" className="om-button" onClick={event => { track('explore_feed', 'creators'); props.onCreators(event.currentTarget); }}>{t('Creators')}<RemixIcon name="arrow-right-line" size={16} /></Button>
      </header>
      {initialLoading && <div className="om-community-picks" role="status" aria-label={t('Loading templates…')}>{[0, 1, 2, 3].map(n => <CoverPlaceholder key={n} />)}</div>}
      {communityPicks.length > 0 && <div className="om-community-picks">{communityPicks.map(templateCard)}</div>}
    </section>}
    {showModelStories && medium !== 'image' && <ModelCollection story={seedanceStory} gateway={gateway} onNavigate={onNavigate} onModel={props.onModel} />}
    {home && studioSection(findMediaStudio('design')!)}
    {showModelStories && medium !== 'video' && <ModelCollection story={gptImageStory} gateway={gateway} onNavigate={onNavigate} onModel={props.onModel} />}
    <section className="om-explore-feed" aria-labelledby="om-feed-heading">
      <header className="om-discovery-heading">
        <div><h2 id="om-feed-heading">{t(community?.id === '3d-motion' ? '3D techniques' : 'Communities')}</h2>
          {specialty && <p className="om-muted">{t(specialty.briefHint)}</p>}
        </div>
        {showTemplates && <div className="om-control-row">
          <Button type="button" variant="secondary" className="om-button" onClick={event => { track('explore_feed', 'view_all_templates', { community: community?.id }); openLibrary(event.currentTarget); }}>{t('View all templates')}<RemixIcon name="arrow-right-line" size={16} /></Button>
          {!showCommunityPicks && <Button type="button" variant="secondary" className="om-button" onClick={event => { track('explore_feed', 'creators', { community: community?.id }); props.onCreators(event.currentTarget); }}>{t('Creators')}<RemixIcon name="arrow-right-line" size={16} /></Button>}
        </div>}
      </header>
      <div className="om-feed-group">{firstGroup}</div>
      {showTemplates && (feedLoading || feedError || feedEmpty) && <div className="om-feed-status">
        {feedLoading && <div className="om-feed-loading" aria-label={t('Loading templates…')} role="status">{[0, 1, 2].map(n => <CoverPlaceholder key={n} />)}</div>}
        {feedError && templateError}
        {feedEmpty && <span className="om-muted">{t('No templates available. Open the library or try again later.')}</span>}
      </div>}
    </section>
    {showShelves && <>
      <ExploreShelf title="Templates" categoriesLabel="Template categories" categories={shelf.categories} selected={templateFilter} plainCategoryArrows
        filters={<TemplateIndustryMenu industries={shelf.industries} selected={facet?.key === 'industries' ? [facet.value] : undefined}
          onSelect={value => {
            const next = value ? industryCollection(value) : 'all';
            send('ui_click', { page_name: 'explore', area: 'explore_feed', element: 'category_select', filter_group: 'industries', ...(value ? optionId(value) : { filter_value: 'all' }), ...slugField('collection_id', next) });
            setTemplateFilter(next);
          }} />}
        renderCategory={id => id === 'top-100-brands' ? <TopBrandsLabel /> : undefined}
        onCategory={next => {
          send('ui_click', { page_name: 'explore', area: 'explore_feed', element: 'category_select', ...templateShelfTarget(next) });
          setTemplateFilter(next);
        }}
        action={shelf.collection ? 'View collection' : 'View all templates'}
        onOpen={trigger => {
          send('ui_click', { page_name: 'explore', area: 'explore_feed', element: 'view_all_templates', ...templateShelfTarget(shelf.collection) });
          openLibrary(trigger, undefined, shelf.collection ?? undefined);
        }}
        extraAction={<a className="om-button" data-primary data-borderless href={templateContributionUrl} target="_blank" rel="noopener noreferrer"
          onClick={() => track('explore_feed', 'submit_video')}>{t('Submit template')}<MotionIcon name="arrow-up-right" size={15} /></a>}>
        {shelf.error ? <div className="om-discovery-empty" role="alert"><span>{t('Templates could not be loaded.')}</span><Button type="button" variant="secondary" className="om-button" onClick={shelf.retry}>{t('Retry')}</Button></div>
          : !shelf.loading && !shelfItems.length ? <p className="om-muted">{t('No templates available. Open the library or try again later.')}</p>
          : <div className="om-studio-template-grid om-explore-preview-grid" aria-busy={shelf.loading} aria-label={shelf.loading ? t('Loading templates…') : undefined}>
            {shelf.loading ? Array.from({ length: templatePreviewLimit }, (_, n) => <CoverPlaceholder key={n} />) : shelfItems.map(item =>
              <TemplateGalleryCard key={item.id} template={item} active={playing.has(item.id)} onPriority={setPriority} brandedFallback
                brandCredit={shelf.collection === 'top-100-brands' || facet?.key === 'industries'}
                onSelect={(template, trigger) => {
                  send('ui_click', { page_name: 'explore', area: 'explore_feed', element: 'open_template', ...slugField('template_id', template.id), ...(shelf.collection ? templateShelfTarget(shelf.collection) : {}) });
                  openLibrary(trigger, template);
                }} />)}
          </div>}
      </ExploreShelf>
      <ExploreShelf title="Skills" categoriesLabel="Skill category" categories={skillFilters} selected={skillFilter}
        onCategory={next => {
          send('ui_click', { page_name: 'explore', area: 'explore_feed', element: 'skill_category', ...(next === 'all' ? {} : { skill_category: skillCategoryId(next) }) });
          setSkillFilter(next);
        }}
        action="View all"
        onOpen={trigger => {
          send('ui_click', { page_name: 'explore', area: 'explore_feed', element: 'open_skills', ...(skillFilter === 'all' ? {} : { skill_category: skillCategoryId(skillFilter) }) });
          openSkills(skillFilter === 'all' ? null : skillFilter, trigger);
        }}
        extraAction={<SkillSubmissionLink explore />}>
        <div className="om-explore-preview-grid">{shelfSkills.map(skill => <SkillFeedCard key={skill.id} skill={skill} section="skills"
          onSkill={onSkill} playing={playing} onPriority={setPriority} />)}</div>
      </ExploreShelf>
    </>}
    {!community && discoveryStudios.filter(studio => !home || studio.id !== 'design').map(studioSection)}
  </>;
}

export function ExploreStudios(props: ExploreProps) {
  const { t, locale } = useI18n();
  const { openLibrary, openSkills } = useWorkspaceChrome();
  const root = useRef<HTMLElement>(null);
  const [firstPages] = useState(() => new Map<string, TemplatePage>());
  const community = exploreCommunities.find(item => item.id === props.filters.community);
  return <main ref={root} className="om-explore">
    <div className="om-discovery-page">
      <header className="om-discovery-heading">
        <h1 className="om-explore-title">{t(!community && props.filters.medium ? mediaLabels[props.filters.medium] : 'Explore')}</h1>
        {!community && !props.filters.medium && <nav className="om-explore-nav om-choice-tabs" aria-label={t('Explore')}>
          <Button type="button" variant="ghost" className="om-nav-item" icon={<RemixIcon name="apps-2-line" size={16} />} onClick={event => {
            track('explore_tabs', 'template_library');
            openLibrary(event.currentTarget);
          }}>{t('Templates')}</Button>
          <Button type="button" variant="ghost" className="om-nav-item" icon={<RemixIcon name="puzzle-line" size={16} />} onClick={event => {
            track('explore_tabs', 'open_skills');
            openSkills(null, event.currentTarget);
          }}>{t('Skills')}</Button>
        </nav>}
      </header>
      <div className="om-explore-sections" data-explore-home={!community && !props.filters.medium}>
        <ExploreCollection key={locale + '/' + (community?.id ?? '')} firstPages={firstPages} community={community} root={root} {...props} />
      </div>
    </div>
    <CapabilityIndex {...props} />
  </main>;
}
