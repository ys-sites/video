import { useCallback, useEffect, useState } from 'react';
import type { ProviderDirectory } from '../../../shared/provider-directory';
import { gatewayRequest } from './gatewayClient';

export const notifyProvidersChanged = () => window.dispatchEvent(new Event('motion:gateway-changed'));
export function useProviderDirectory() {
  const [data, setData] = useState<ProviderDirectory | null>(null), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true; setError(false);
    void gatewayRequest<ProviderDirectory>('settings/providers').then(value => { if (!Array.isArray(value.providers) || !Array.isArray(value.models) || !value.defaults) throw new Error('Invalid provider directory'); if (active) setData(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => { window.addEventListener('motion:gateway-changed', refresh); return () => window.removeEventListener('motion:gateway-changed', refresh); }, [refresh]);
  return { data, error, refresh };
}
