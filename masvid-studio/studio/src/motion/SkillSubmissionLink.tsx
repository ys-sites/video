import { useI18n } from '../i18n/I18n';
import { MotionIcon } from './icons';
import { reportSkillSubmitClicked } from './pageTracking';
import { send } from './reporting';

/** The contribution guide section with the paste-ready Agent brief for a new library Skill. */
export const skillSubmissionUrl = 'https://github.com/nexu-io/openmotion/blob/main/CONTRIBUTING.md#submit-a-skill-with-your-agent';

export function SkillSubmissionLink({ explore = false }: { explore?: boolean }) {
  const { t } = useI18n();
  return <a className={explore ? 'om-button' : 'om-gallery-submit'} data-primary={explore || undefined} data-borderless
    href={skillSubmissionUrl} target="_blank" rel="noopener noreferrer"
    onClick={explore ? () => send('ui_click', { page_name: 'explore', area: 'explore_feed', element: 'submit_skill' }) : reportSkillSubmitClicked}>
    {t('Submit a skill')}<MotionIcon name="arrow-up-right" size={15} />
  </a>;
}
