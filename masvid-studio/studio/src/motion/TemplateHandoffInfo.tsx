import { Button } from 'open-design-ui/button';
import type { PreparedTemplateProject } from './templateHandoff';
import type { GalleryTemplate } from '../../../shared/catalog';
import { MotionIcon } from './icons';
import { useI18n } from '../i18n/I18n';
import styles from './TemplateLibraryDialog.module.css';

export type TemplateOpenProgress = {
  requestId: string; state: 'creating' | 'failed' | 'unknown' | 'ready' | 'opening' | 'open_failed';
  result?: PreparedTemplateProject; error?: string;
};

export function TemplateHandoffSteps({ template }: { template: GalleryTemplate }) {
  const { t } = useI18n();
  const headline = template.id === 'motion-be2a4af0-0183-4979-ab05-2a68413c0890';
  const materials = [template.id === 'nyt-graph' ? 'Your data and main takeaway.'
    : headline ? 'Your headline.' : 'Your copy; screenshots or recordings if needed.',
    'Optional: logo, colors and audio.'];
  return <section className={styles.handoffSteps} aria-label={t('After copying')}>
    <strong>{t('After copying')}</strong>
    <ol>
      <li><span>1</span>{t('Paste into your Agent')}</li>
      <li><span>2</span><div className={styles.handoffMaterials}><strong>{t('Add content and send')}</strong>{materials.map(material => <p key={material}>{t(material)}</p>)}</div></li>
      <li><span>3</span>{t('Open the project to edit')}</li>
    </ol>
  </section>;
}

export function TemplateOpenRecovery({ progress, onRetry, onCheck, onOpen }: {
  progress?: TemplateOpenProgress; onRetry: () => void; onCheck: () => void; onOpen: () => void;
}) {
  const { t } = useI18n();
  if (!progress) return null;
  const busy = progress.state === 'creating' || progress.state === 'opening';
  return <section className={styles.handoffRecovery} aria-label={t('This project status')} aria-busy={busy}>
    <strong>{t(progress.state === 'creating' ? 'Creating a separate project…' : progress.state === 'opening' ? 'Opening this project…' : progress.state === 'failed' ? 'Project not created' : progress.state === 'unknown' ? 'Creation result needs checking' : progress.state === 'open_failed' ? 'Project created, preview not opened' : 'This project is ready')}</strong>
    {progress.result && <p>{progress.result.title}<small>{t('Your original project is retained')}</small></p>}
    {progress.error && <p>{progress.error}</p>}
    {progress.state === 'failed' && <Button variant="ghost" className="om-button h-auto" onClick={onRetry}>{t('Retry creation')}</Button>}
    {progress.state === 'unknown' && <><p>{t('Check the original request before creating another project.')}</p><Button variant="ghost" className="om-button h-auto" onClick={onCheck}>{t('Check creation result')}</Button></>}
    {(progress.state === 'ready' || progress.state === 'open_failed') && <Button variant="ghost" className="om-button h-auto" data-primary onClick={onOpen}>{t(progress.state === 'open_failed' ? 'Retry opening this project' : 'Open this project')}<MotionIcon name="arrow-up-right" size={16} /></Button>}
  </section>;
}
