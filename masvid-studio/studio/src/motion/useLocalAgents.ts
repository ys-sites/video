import { useCallback, useEffect, useState } from 'react';
import type { AgentDirectory } from '../../../shared/local-agents';
import { gatewayRequest } from './gatewayClient';

export const notifyAgentsChanged = () => window.dispatchEvent(new Event('motion:agents-changed'));
export const openAgentSettings = () => window.dispatchEvent(new Event('motion:agents-open'));
export function useLocalAgents() {
  const [data, setData] = useState<AgentDirectory | null>(null), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true; setError(false);
    void gatewayRequest<AgentDirectory>('settings/agents').then(value => { if (!Array.isArray(value.agents)) throw new Error('Invalid Agent directory'); if (active) setData(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => { window.addEventListener('motion:agents-changed', refresh); return () => window.removeEventListener('motion:agents-changed', refresh); }, [refresh]);
  return { data, error, refresh };
}
