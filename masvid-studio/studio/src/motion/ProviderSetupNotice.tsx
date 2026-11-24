import type { ReactNode } from 'react';
import { RemixIcon } from '../icons/RemixIcons';

export function ProviderSetupNotice({ message, children }: {
  message: string; children: ReactNode;
}) {
  return <div className="om-creation-setup om-provider-setup" role="status">
    <RemixIcon name="information-line" size={18} />
    <p className="om-muted">{message}</p>
    <div className="om-control-row">{children}</div>
  </div>;
}
