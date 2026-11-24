import { Button } from 'open-design-ui/button';
import { useRef } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { MotionTemplateShelf } from './MotionTemplateShelf';
import { reportCreativeClick } from './exploreTracking';
import { BackToExploreButton } from './BackToExploreButton';
import { motionStudioCover } from './skillCatalog';

export function MotionStudioPage({ active, editorDisabled, onOpenEditor, onBackToExplore, onStartScenario }: {
  active: boolean; editorDisabled: boolean; onOpenEditor: () => void; onBackToExplore?: () => void; onStartScenario?: () => void;
}) {
  const { t, locale } = useI18n();
  const root = useRef<HTMLElement>(null);
  return <main ref={root} className="om-explore" aria-label={t('Motion templates')}>
    <div className="om-discovery-page">
    {onBackToExplore && <div><BackToExploreButton onClick={() => {
      reportCreativeClick('creative_studio', 'studio_bar', 'back_to_explore', { studio: 'motion' });
      onBackToExplore();
    }} /></div>}
    <header className="om-discovery-hero om-studio-landing-hero">
      {motionStudioCover?.poster && <img src={motionStudioCover.poster} alt="" />}
      <div className="om-discovery-hero-copy">
        <h1>{t('Motion Studio')}</h1>
        <p>{t('Animate type and shapes, then edit their timing on the timeline.')}</p>
        <div className="om-hero-actions">
          <Button variant="ghost" type="button" className="om-button h-auto" data-primary="media" disabled={editorDisabled} onClick={() => {
            reportCreativeClick('creative_studio', 'studio_bar', 'open_editor', { studio: 'motion' });
            onOpenEditor();
          }}>
            {t('Open Motion Editor')}<RemixIcon name="arrow-right-line" size={16} />
          </Button>
          {onStartScenario && <Button variant="ghost" type="button" className="om-button h-auto" onClick={() => {
            reportCreativeClick('creative_studio', 'studio_bar', 'select_scene', { studio: 'motion', navTarget: 'workflows' });
            onStartScenario();
          }}>
            {t('Start workflow')}<RemixIcon name="arrow-right-line" size={16} />
          </Button>}
        </div>
      </div>
    </header>
    <MotionTemplateShelf key={locale} root={root} active={active} />
  </div></main>;
}
