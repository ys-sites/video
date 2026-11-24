import { useMountEffect } from '../hooks/useMountEffect';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from './StudioToastViewport';

/** Notify once per outage; the notice lifetime never controls reconnect polling. */
export function StudioConnectionToast({ reconnecting }: { reconnecting: boolean }) {
  return reconnecting ? <ConnectionNotice /> : null;
}

function ConnectionNotice() {
  const toast = useToast();
  useMountEffect(() => { toast.showToast('Connection lost. Reconnecting…', 'info'); });
  return <StudioToastViewport {...toast} />;
}
