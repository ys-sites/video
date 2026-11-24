import { Button } from 'open-design-ui/button';
import { openDesignVideoModels } from '../../../shared/video-features';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { sceneDestination, studioScenes, supportsScene, type StudioDestination, type StudioScene } from './creativeStudios';
import { imageModelBadge, isOpenDesignProvider, menuFamilies, withOpenDesignModels } from './imageMenuModels';
import { MegaMenuColumn } from './ImageMegaMenu';
import { sceneExamples } from './sceneShowcase';
import { ModelAvatar } from './settingsPrimitives';
import type { useMediaCatalog } from './useMediaCatalog';
import speakerRoom from './scene-art/speaker-room.webp';
import speakerStudio from './scene-art/speaker-studio.webp';

function MenuBadge({ label }: { label: string }) {
  const { t } = useI18n();
  return <span className="om-image-menu-badge" data-tone={label === 'New' ? 'new' : label === 'Popular' ? 'top' : 'soon'}>{t(label)}</span>;
}

const findScene = (id: StudioScene['id']) => studioScenes.find(scene => scene.id === id)!;
const textVideoScene = findScene('text-to-video');
const imageVideoScene = findScene('image-to-video');
const cameraScene = findScene('video-camera-control');
const multiShotScene = findScene('video-multi-shot');

const topScenes = [
  [textVideoScene, 'text'],
  [imageVideoScene, 'first-frame'],
  [cameraScene, 'camera'],
] as const;

const upcomingVideoFeatures = [
  ['Omni reference', 'stack-line'],
  ['Edit video', 'edit-line'],
  ['Extend', 'time-line'],
  ['4K upscale', 'fullscreen-line'],
  ['Motion control', 'route-line'],
  ['Lip sync', 'voiceprint-line'],
] as const;

function VideoTileArt({ kind }: { kind: 'text' | 'first-frame' | 'camera' }) {
  const example = kind === 'text' ? sceneExamples['text-to-video'][0]
    : kind === 'first-frame' ? sceneExamples['image-to-video'][0]
    : sceneExamples['video-camera-control'][0];
  return <span className="om-scene-tile-art om-video-tile-art" aria-hidden="true">
    <img src={example.poster} alt="" style={{ objectPosition: example.posterPosition }} />
    {kind === 'text' && <span className="om-video-demo-play"><RemixIcon name="play-fill" size={14} /></span>}
    {kind === 'first-frame' && <span className="om-video-demo-pill"><RemixIcon name="image-line" size={12} /><span>1st</span></span>}
    {kind === 'camera' && <span className="om-video-demo-pill"><RemixIcon name="camera-line" size={12} /><span>360°</span></span>}
  </span>;
}

export function VideoMegaMenu({ catalog, destination, onNavigate }: {
  catalog?: ReturnType<typeof useMediaCatalog>['catalog'];
  destination: StudioDestination | null;
  onNavigate: (destination: StudioDestination) => void;
}) {
  const { t } = useI18n();
  const models = catalog?.models ?? [];
  const providers = catalog?.status.providers ?? [];
  const families = menuFamilies(
    withOpenDesignModels(models, providers).filter(model => supportsScene(model, textVideoScene)),
    providers,
  );
  const pinned = models.find(model => model.id === destination?.model);
  // Non-feature scenes keep a compatible pinned model; feature scenes open without a pin so OpenDesign defaults apply.
  const openScene = (scene: StudioScene) => onNavigate(sceneDestination(scene, destination, pinned && supportsScene(pinned, scene) ? pinned.id : null));
  const openFeature = (scene: StudioScene) => onNavigate(sceneDestination(scene, destination, null));

  const anyOpenDesignReady = providers.some(provider => isOpenDesignProvider(provider.id) && provider.available);
  const presentModelIds = new Set(families.flatMap(family => family.variants.map(variant => variant.modelId)));
  const pendingOpenDesign = openDesignVideoModels.filter(entry => !presentModelIds.has(entry.modelId));
  const modelItems = [
    ...families.map(family => {
      const pending = anyOpenDesignReady && !family.ready;
      const badge = pending ? 'Soon' : imageModelBadge(family.representative);
      return <Button key={family.key} variant="plain" className="om-nav-item om-media-mega-row"
        data-ready={family.ready || undefined} disabled={pending || undefined} aria-disabled={pending || undefined}
        onClick={() => onNavigate(sceneDestination(textVideoScene, destination, family.representative.id))}>
        <ModelAvatar name={family.label} modelId={family.representative.modelId} provider={{ id: family.representative.provider, custom: family.representative.source === 'custom' }} />
        <span className="om-media-mega-label">{family.label}</span>
        {badge && <MenuBadge label={badge} />}
      </Button>;
    }),
    ...pendingOpenDesign.map(entry => <Button key={'pending:' + entry.modelId} variant="plain" className="om-nav-item om-media-mega-row" disabled aria-disabled="true">
      <ModelAvatar name={entry.label} modelId={entry.modelId} provider={{ id: 'opendesign', custom: false }} />
      <span className="om-media-mega-label">{entry.label}</span>
      <MenuBadge label="Soon" />
    </Button>),
  ];

  return <div className="om-media-mega">
    <div className="om-media-menu-grid om-media-mega-entries">
      {topScenes.map(([scene, art]) => <Button variant="plain" key={scene.id} className="om-scene-tile"
        aria-current={destination?.scene.id === scene.id ? 'page' : undefined}
        onClick={() => scene.id === cameraScene.id ? openFeature(scene) : openScene(scene)}>
        <VideoTileArt kind={art} />
        <strong>{t(scene.label)}</strong>
      </Button>)}
      <Button variant="plain" className="om-scene-tile om-scene-tile-disabled" disabled aria-disabled="true">
        <span className="om-scene-tile-art om-video-keyframes-demo">
          <MenuBadge label="Soon" />
          <span className="om-video-keyframes-pair" aria-hidden="true">
            <img src={speakerStudio} alt="" />
            <RemixIcon name="arrow-right-s-fill" size={14} />
            <img src={speakerRoom} alt="" />
          </span>
          <span className="om-video-keyframes-caption" aria-hidden="true">{t('A → B transition')}</span>
        </span>
        <strong>{t('Start & end frames')}</strong>
      </Button>
    </div>

    <div className="om-media-mega-columns">
      <MegaMenuColumn title={t('Features')} items={[
        <Button key="multi-shot" variant="plain" className="om-nav-item om-media-mega-row"
          aria-current={destination?.scene.id === multiShotScene.id ? 'page' : undefined}
          onClick={() => openFeature(multiShotScene)}>
          <span className="om-image-menu-icon"><RemixIcon name="clapperboard-line" size={16} /></span>
          <span className="om-media-mega-label">{t(multiShotScene.label)}</span>
        </Button>,
        ...upcomingVideoFeatures.map(([title, icon]) => <Button key={title} variant="plain" className="om-nav-item om-media-mega-row" disabled aria-disabled="true">
          <span className="om-image-menu-icon"><RemixIcon name={icon} size={16} /></span>
          <span className="om-media-mega-label">{t(title)}</span>
          <MenuBadge label="Soon" />
        </Button>),
      ]} />

      <MegaMenuColumn title={t('Models')} items={modelItems.length > 0 ? modelItems : [
        <p key="empty" className="om-muted om-media-mega-empty">{t('No models yet. Add a provider to see its models.')}</p>,
      ]} />
    </div>
  </div>;
}
