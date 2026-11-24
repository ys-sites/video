import type { CreativeStudio } from '../../../shared/studio-catalog';
import { ComingSoonGuide } from './ComingSoonGuide';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import threeDimensionalScene from './scene-art/studio-glass-sculpture.jpg';

/** Shared placeholder for Studio interfaces whose integration is still pending. */
export function StudioComingSoon({ studio, onExploreSkills }: { studio: CreativeStudio; onExploreSkills?: () => void }) {
  const { t } = useI18n();
  const description = studio.id === '3d'
    ? '3D Studio is coming soon and does not support direct generation. Choose one of its six 3D creative Skills, fill in a brief and copy it to a connected Agent to create an editable scene in OpenMotion.'
    : 'briefHint' in studio ? studio.briefHint : undefined;
  return <section className="om-studio-coming-soon" data-coming-soon>
    {studio.id === '3d' && <img className="om-studio-coming-soon-art" src={threeDimensionalScene} alt="" />}
    <div className="om-studio-coming-soon-content">
      <span className="om-studio-heading-icon"><RemixIcon name={studio.icon} size={32} /></span>
      <h1 className="om-title">{t(studio.title)}</h1>
      <ComingSoonGuide description={description} action={onExploreSkills ? { label: studio.id === '3d' ? '3D Creative Skills' : 'Creative Skills', onClick: onExploreSkills } : undefined} />
    </div>
  </section>;
}
