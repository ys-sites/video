import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { mountFeedbackLayer } from '../../../web/feedback-layer';

type ToastHost = { layer: HTMLElement; stack: HTMLElement; users: number; unmount: () => void };
const hosts = new WeakMap<Document, ToastHost>();

function acquireHost(doc: Document) {
  let host = hosts.get(doc);
  if (!host) {
    const layer = doc.createElement('div');
    layer.className = 'motion-feedback-layer';
    const stack = doc.createElement('div');
    stack.className = 'hf-toast-viewport';
    layer.append(stack);
    doc.body.append(layer);
    host = { layer, stack, users: 0, unmount: mountFeedbackLayer(layer) };
    hosts.set(doc, host);
  }
  host.users++;
  const owned = host;
  return {
    stack: owned.stack,
    release() {
      if (--owned.users) return;
      owned.unmount();
      owned.layer.remove();
      hosts.delete(doc);
    },
  };
}

/** One layout per document, with each portal retaining its owner's context,
 * timers and action identity. No messages are merged across unrelated owners. */
export function StudioToastLayer({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const host = acquireHost(document);
    setContainer(host.stack);
    return host.release;
  }, []);
  return container ? createPortal(children, container) : null;
}
