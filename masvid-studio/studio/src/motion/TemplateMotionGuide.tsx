import { useEffect, useRef, useState } from 'react';
import { useShownStudioTheme } from '../utils/studioTheme';
import { prepareMotionGuide, type GuideAppearance } from './templateMotionGuideDocument';
import { handleGuideAction, validGuideRpc } from '../template-guide/actions';
import { useI18n } from '../i18n/I18n';
import { isTemplateGuideEvent } from '../../../shared/template-guide';
import { send } from './reporting';

export function TemplateMotionGuide({ url, title, expanded = false, onEscape }: { url: string; title: string; expanded?: boolean; onEscape?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = useShownStudioTheme();
  const { locale } = useI18n();
  const latestTheme = useRef(theme);
  latestTheme.current = theme;
  const [document, setDocument] = useState<{ url: string; src: string; html?: string }>({ url: '', src: 'about:blank' });
  function appearance(): GuideAppearance {
    const style = getComputedStyle(frame.current!);
    return {
      theme: latestTheme.current,
      background: style.backgroundColor,
      text: style.getPropertyValue('--motion-text').trim(),
      muted: style.getPropertyValue('--motion-muted').trim(),
      surface: style.getPropertyValue('--motion-panel').trim(),
      border: style.getPropertyValue('--motion-border').trim(),
    };
  }
  function syncAppearance() {
    // The iframe deliberately has an opaque origin, so targetOrigin must be '*'.
    frame.current?.contentWindow?.postMessage({ type: 'openmotion:guide-appearance', appearance: appearance() }, '*');
  }
  useEffect(() => { syncAppearance(); }, [theme]);
  useEffect(() => {
    const path = new URL(url, location.href);
    const id = path.origin === location.origin && path.pathname.match(/^\/api\/template-source\/([a-z][a-z0-9-]+)\/preview\.html$/)?.[1];
    if (!id) return;
    let active = true;
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'openmotion:guide-event' && event.data.templateId === id && isTemplateGuideEvent(event.data.event)) {
        send('template_guide_interaction', { page_name: 'studio', template_id: id, ...event.data.event }); return;
      }
      if (!validGuideRpc(event.data) || event.data.templateId !== id) return;
      const message = event.data;
      try {
        const result = await handleGuideAction(id, message.action, message.value, locale);
        if (!active) return;
        frame.current?.contentWindow?.postMessage({ type: 'openmotion:guide-action-result', requestId: message.requestId, result }, '*');
        if (message.action === 'library' && result && typeof result === 'object' && 'url' in result) location.assign(String(result.url));
        if (message.action === 'open' && result && typeof result === 'object' && 'url' in result && 'projectId' in result) {
          send('template_guide_interaction', { page_name: 'studio', template_id: id, view_id: message.viewId, action: 'open_editor', outcome: 'success', project_id: String(result.projectId) });
          location.assign(String(result.url));
        }
      } catch (error) { if (active) {
        if (message.action === 'open') send('template_guide_interaction', { page_name: 'studio', template_id: id, view_id: message.viewId, action: 'open_editor', outcome: 'failure' });
        frame.current?.contentWindow?.postMessage({ type: 'openmotion:guide-action-result', requestId: message.requestId, error: (error as Error).message }, '*');
      } }
    };
    window.addEventListener('message', receive);
    return () => { active = false; window.removeEventListener('message', receive); };
  }, [url, locale]);
  useEffect(() => {
    if (!expanded || !onEscape) return;
    function receiveEscape(event: MessageEvent) {
      const guide = frame.current;
      if (guide?.hasAttribute('srcdoc') && guide.ownerDocument.activeElement === guide &&
          event.source === guide.contentWindow && event.origin === 'null' && event.data === 'openmotion:guide-escape') onEscape?.();
    }
    window.addEventListener('message', receiveEscape);
    return () => window.removeEventListener('message', receiveEscape);
  }, [expanded, onEscape]);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Guide unavailable');
        const source = await response.text();
        if (!controller.signal.aborted) {
          // A blob retains the parent's URL origin for authored postMessage calls.
          // The sandbox still gives its script an opaque security origin.
          const html = prepareMotionGuide(source, response.url || url, appearance(), locale, expanded);
          if (expanded) setDocument({ url, src: 'about:blank', html });
          else {
            objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            setDocument({ url, src: objectUrl });
          }
        }
      } catch {
        // Keep guides usable when a remote host does not permit CORS reads.
        if (!controller.signal.aborted) setDocument({ url, src: url });
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, expanded]);
  const current = document.url === url ? document : undefined;
  return <iframe ref={frame} src={current?.html ? undefined : current?.src ?? 'about:blank'} srcDoc={current?.html} title={title} onLoad={syncAppearance}
    sandbox="allow-scripts" loading={expanded ? 'eager' : 'lazy'} referrerPolicy="no-referrer" />;
}
