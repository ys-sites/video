import { useI18n } from '../i18n/I18n';

/** Matches the initial HTML shell without delaying a ready workspace. */
export function MotionLoading({ overlay = false }: { overlay?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="motion-loading" role="status" data-overlay={overlay || undefined}>
      <span className="motion-loading-mark" aria-hidden="true" />
      <span className="motion-loading-label">{t('Opening project…')}</span>
    </div>
  );
}
