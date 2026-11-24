import { onPreviewContentReplaced } from "./sceneSwap";

const pending = new WeakMap<HTMLIFrameElement, { document: Document; release: () => void }>();

/** The restored source is already on the timeline; the old preview's manifests
 * must not put deleted clips back while its replacement is loading. */
export function holdHistoryTimelineUntilPreviewReplaced(iframe: HTMLIFrameElement | null): void {
  const doc = iframe?.contentDocument;
  if (!iframe || !doc) return;
  pending.get(iframe)?.release();
  const release = () => { stop(); pending.delete(iframe); };
  const stop = onPreviewContentReplaced(iframe, release);
  pending.set(iframe, { document: doc, release });
}

export function hasPendingHistoryTimeline(iframe: HTMLIFrameElement | null): boolean {
  const held = iframe && pending.get(iframe);
  if (!held) return false;
  if (held.document === iframe!.contentDocument) return true;
  held.release();
  return false;
}
