import { useCallback, useEffect, useRef, useState } from 'react';
import { loadGateway } from './gatewayClient';

/** Both navigation and generation read the executable gateway catalog. */
export function useMediaCatalog(active: boolean) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadGateway>>>();
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const retry = useCallback(() => {
    sequence.current++;
    setCatalog(undefined);
    setFailed(false);
    setAttempt(value => value + 1);
  }, []);
  useEffect(() => {
    window.addEventListener('motion:gateway-changed', retry);
    return () => window.removeEventListener('motion:gateway-changed', retry);
  }, [retry]);
  useEffect(() => {
    setFailed(false);
    setCatalog(undefined);
    if (!active) return;
    const request = ++sequence.current;
    void loadGateway().then(value => { if (sequence.current === request) setCatalog(value); })
      .catch(() => { if (sequence.current === request) setFailed(true); });
    return () => { sequence.current++; };
  }, [active, attempt]);
  return { catalog, failed, retry };
}
