import { StudioToastLayer } from './StudioToastLayer';
import { StudioToast } from './StudioToast';
import type { useToast } from '../hooks/useToast';

/** Out-of-flow feedback that remains above native dialogs without stealing focus. */
export function StudioToastViewport({ toasts, dismissToast }: Pick<ReturnType<typeof useToast>, 'toasts' | 'dismissToast'>) {
  if (!toasts.length) return null;
  return <StudioToastLayer>
    {toasts.map(toast => <StudioToast key={toast.id} {...toast} onDismiss={() => dismissToast(toast.id)} />)}
  </StudioToastLayer>;
}
