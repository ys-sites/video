import { IconButton } from 'open-design-ui/icon-button';
import { Button } from 'open-design-ui/button';
import { useEffect, useId, useState } from 'react';
import { recordBrowserDiagnostic } from '../../motion/diagnostics';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { errorNoticeMessage, type ErrorContext } from './errorNoticeMessage';
import './errorNotice.css';
import { useToast } from '../../hooks/useToast';
import { StudioToastViewport } from '../StudioToastViewport';
import { redactDiagnostic } from '../../../../scripts/diagnostic-redaction.mjs';

export function ErrorNotice({ message, context = 'operation', compact = false, action, onDismiss, diagnostic }: {
  message: string;
  diagnostic?: string;
  context?: ErrorContext;
  compact?: boolean;
  action?: { label: string; run: () => void; busy?: boolean };
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { recordBrowserDiagnostic('operation_error', message); }, [message]);
  const toast = useToast();
  const summary = errorNoticeMessage(message, context);
  const details = diagnostic === undefined ? message : redactDiagnostic(diagnostic);
  const copy = async () => {
    try { await navigator.clipboard.writeText(details); toast.showToast('Copied!', 'info', 'feedback'); }
    catch { toast.showToast('Copy failed. Select the details to copy them.', 'error', 'feedback'); }
  };
  return <div className={`motion-error-notice${compact ? ' motion-error-notice-compact' : ''}`}>
    <div className="motion-error-notice-row">
      <p className="motion-error-notice-summary" role="alert">{t(summary)}</p>
      {onDismiss && <IconButton variant="plain" type="button" className="motion-error-notice-close" aria-label={t('Dismiss error')} onClick={onDismiss} icon={<RemixIcon name="close-line" size={14} />} />}
    </div>
    <div className="motion-error-notice-actions">
      {action && <Button variant="plain" type="button" className="motion-error-notice-action" onClick={action.run} disabled={action.busy}>{t(action.busy ? 'Checking…' : action.label)}</Button>}
      <Button variant="plain" type="button" aria-label={t(expanded ? 'Hide error details' : 'Error details')} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'Hide error details' : 'Error details')}</Button>
    </div>
    {expanded && <div id={id} className="motion-error-notice-details">
      <pre tabIndex={0} aria-label={t('Error details')}>{details}</pre>
      <Button variant="plain" type="button" onClick={() => void copy()}>{t('Copy error information')}</Button>
    </div>}
    <StudioToastViewport {...toast} />
  </div>;
}
