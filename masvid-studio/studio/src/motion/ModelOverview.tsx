import { WorkspaceBack } from './WorkspaceBack';
import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { Skeleton } from '../components/ui/Skeleton';

import { ModelAvatar } from './settingsPrimitives';
import { useMediaCatalog } from './useMediaCatalog';
import { mediaEditorDestination, mediaLabels, studioScenes, supportsScene, type StudioDestination } from './creativeStudios';
import { isSfxModel, type SoundTabId } from './soundTabs';
import { ModelStoryGallery } from './ModelStoryGallery';
import { matchesStory, modelStories } from './exploreModelStories';
import { sceneExamples } from './sceneShowcase';
import { destinationTarget, reportCreativeClick } from './exploreTracking';
import type { WorkspaceSource } from '../utils/workspaceHistory';
import { WorkspaceBreadcrumb } from './WorkspaceBreadcrumb';

export function ModelOverview({ id, source, onExplore, onProvider, onScene }: {
  id: string; source: WorkspaceSource | null; onExplore?: () => void; onProvider: (provider?: string) => void; onScene: (scene: StudioDestination, prompt?: string, soundTab?: SoundTabId) => void;
}) {
  const { t } = useI18n();
  const { catalog, failed, retry } = useMediaCatalog(true);
  const model = catalog?.models.find(item => item.id === id);
  const story = model && modelStories.find(item => matchesStory(item, model) && item.cases.some(c => supportsScene(model, c.destination.scene)));
  const provider = model && catalog?.status.providers.find(item => item.id === model.provider);
  return <main className="om-explore"><div className="om-discovery-page">
    {source ? <WorkspaceBreadcrumb source={source} destination={model?.label ?? t('Model details')} />
      : onExplore && <WorkspaceBack onBack={() => reportCreativeClick('model_overview', 'model_overview', 'back_to_explore', { model: id })} fallback={onExplore} />}
    {failed ? <Button variant="plain" className="om-button" onClick={retry}>{t('Retry loading models')}</Button>
      : !catalog ? <Skeleton className="om-featured-template-skeleton" />
      : !model ? <section><h1 className="om-title">{t('Model unavailable')}</h1><p className="om-muted">{id}</p><Button variant="ghost" className="om-button h-auto" onClick={() => { reportCreativeClick('model_overview', 'model_overview', 'open_providers', { model: id }); onProvider(); }}>{t('Manage providers')}</Button></section>
      : <>
        <header className="om-discovery-heading"><div>
          <ModelAvatar name={model.label} modelId={model.modelId} provider={{ id: model.provider, custom: model.source === 'custom' }} />
          <h1 className="om-title">{model.label}</h1>
          <p>{provider?.label || model.provider} · {t(mediaLabels[model.modality])} · {model.modelId}</p>
          {model.description && <p className="om-muted">{model.description}</p>}
        </div><Button variant="ghost" className="om-button h-auto" onClick={() => { reportCreativeClick('model_overview', 'model_overview', 'open_providers', { model: id }); onProvider(model.provider); }}>{t(provider?.available ? 'Model providers' : 'Setup required')}</Button></header>
        {story && <section><header className="om-discovery-heading"><h2>{t('Try an idea')}</h2></header>
          <ModelStoryGallery story={story} models={[model]} exact onNavigate={onScene} />
        </section>}
        <section><h2 className="om-subtitle">{t('Scenes')}</h2><div className="om-studio-collection-cards">{studioScenes.filter(scene => supportsScene(model, scene)).map(scene => {
          const example = sceneExamples[scene.id][0];
          return <Button variant="plain" key={scene.id} className="om-scene-tile" onClick={() => {
            const target = mediaEditorDestination(scene, model.id);
            reportCreativeClick('model_overview', 'model_overview', 'select_scene', destinationTarget(target));
            // Sound-effect models live on the Audio SFX tab, which is backed by the music scene.
            onScene(target, undefined, scene.id === 'music' && isSfxModel(model) ? 'sfx' : undefined);
          }}>
            <span className="om-scene-tile-art"><img alt="" src={example.poster} />{example.credit && <small className="om-scene-credit">{example.credit}</small>}</span>
            <strong>{t(scene.label)}</strong><span className="om-feed-card-description">{t(scene.hint)}</span>
          </Button>;
        })}</div></section>
      </>}
  </div></main>;
}
