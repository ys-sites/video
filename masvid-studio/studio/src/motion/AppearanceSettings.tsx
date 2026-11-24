import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { setStudioTheme, studioUsesHostTheme, useStudioThemePreference } from '../utils/studioTheme';
import { clickMethod, clickOption, trackStudioClick } from './editorTracking';

/** The samples consume the actual light/dark tokens, including future theme edits. */
function ThemeSample({ theme }: { theme: 'light' | 'dark' }) {
  return <span data-motion-ui data-theme={theme} className="om-theme-sample">
    <span className="om-theme-sample-bar"><i /><i /><i /></span>
    <span className="om-theme-sample-rail"><i /><i /><i /></span>
    <span className="om-theme-sample-workspace"><i /><i /><i /><span /></span>
  </span>;
}

export function AppearanceSettings() {
  const { t } = useI18n(), preference = useStudioThemePreference(), embedded = studioUsesHostTheme();
  return <div className="om-settings-page"><h1 className="om-title">{t('Appearance')}</h1><p className="om-muted">{t('Make this workspace feel like yours.')}</p>
    <section className="om-card om-card-stack"><h2 className="om-subtitle">{t('Theme')}</h2>
      <>
        <div className="om-theme-options" role="group" aria-label={t('Theme')}>
          {(['light', 'dark', 'system'] as const).map(value => <Button variant="plain" className="om-theme-choice" key={value} aria-pressed={preference === value} onClick={event => { if (preference !== value) trackStudioClick('settings', 'theme_toggle', undefined, clickMethod(event), clickOption(value)); setStudioTheme(value); }}>
            <span className="om-theme-thumbnail" aria-hidden="true">
              {value === 'system' ? <span className="om-theme-split"><ThemeSample theme="light" /><ThemeSample theme="dark" /></span> : <ThemeSample theme={value} />}
            </span>
            <span className="om-theme-label"><RemixIcon name={value === 'light' ? 'sun-line' : value === 'dark' ? 'moon-line' : 'computer-line'} size={15} /><span>{t(value === 'light' ? 'Light' : value === 'dark' ? 'Dark' : 'System')}</span><span className="om-theme-selection" aria-hidden="true">{preference === value && <RemixIcon name="check-line" size={14} />}</span></span>
          </Button>)}
        </div>
        <p className="om-muted">{t(embedded ? 'System follows the app hosting this editor.' : 'System follows your device’s appearance automatically.')}</p>
      </>
    </section>
    <section className="om-card om-card-stack"><h2 className="om-subtitle">{t('Accessibility')}</h2><p className="om-muted">{t('Motion follows your system’s reduced motion preference. Keyboard focus stays visible throughout the workspace.')}</p></section>
  </div>;
}
