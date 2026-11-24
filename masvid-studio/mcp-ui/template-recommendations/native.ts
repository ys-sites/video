import { App } from '@modelcontextprotocol/ext-apps/app-with-deps';
import { mountTemplateCards } from './app.ts';
export * from './app.ts';

// Keep MCP negotiation out of the standalone document's shared view bundle.
if (typeof window !== 'undefined' && window.__OPENMOTION_TEMPLATE_CARDS__) {
  const root = document.getElementById('openmotion-template-cards');
  if (root) {
    const app = new App({ name: 'OpenMotion template recommendations', version: '1.0.0' }, {});
    const ui = mountTemplateCards(root, window.__OPENMOTION_TEMPLATE_CARDS__, app);
    app.ontoolresult = result => ui.update(result.structuredContent);
    app.onhostcontextchanged = () => ui.setHostContext(app.getHostContext() ?? {});
    app.onteardown = async () => { ui.destroy(); return {}; };
    window.addEventListener('pagehide', () => ui.destroy(), { once: true });
    app.connect().then(() => { ui.setHostContext(app.getHostContext() ?? {}); ui.setConnected(true); }).catch(() => ui.setConnected(false));
  }
}
