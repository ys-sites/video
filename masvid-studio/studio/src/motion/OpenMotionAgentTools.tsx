import { useEffect } from 'react';
import { buildOpenMotionWebMcpTools } from '../../../shared/webmcp-tools';
import { studioApiFetch } from '../utils/studioApiFetch';
import { readStudioUiPreferences } from '../utils/studioUiPreferences';
import { makeStudioDebugLogger } from '../utils/studioDebug';
import { getModelContext } from '../webmcp/types';
import { loadModelContextPolyfill } from '../webmcp/polyfill';
import { registerStudioTools } from '../webmcp/registrar';

const log = makeStudioDebugLogger('webmcp');

export function OpenMotionAgentTools() {
  useEffect(() => {
    if (readStudioUiPreferences().agentToolsEnabled === false) return;
    const controller = new AbortController();
    void (async () => {
      const context = getModelContext() ?? await loadModelContextPolyfill();
      if (!context || controller.signal.aborted) return;
      const report = await registerStudioTools(context,
        buildOpenMotionWebMcpTools(studioApiFetch), controller.signal);
      log('openmotion_registered', { ...report });
    })().catch(error => log('openmotion_registration_failed', {
      message: error instanceof Error ? error.message : String(error),
    }));
    return () => controller.abort();
  }, []);
  return null;
}
