import type { TimelineElement } from "../player/store/playerStore";
import { parseSavedSource } from "./authoredSource";
import { isTextBearingTag } from "../components/editor/domEditingDom";

/** Allocate above saved and live lanes without renumbering existing (possibly locked)
 * clips. Authored negative track indices are valid and sort before the visual lanes. */
function placeTextOnTop(copy: Element, source: string, elements: readonly TimelineElement[] = []): void {
  let top = 0;
  const visit = (root: ParentNode) => {
    for (const node of root.querySelectorAll("[data-track-index]")) {
      const track = Number(node.getAttribute("data-track-index"));
      if (Number.isFinite(track)) top = Math.min(top, track);
    }
    for (const template of root.querySelectorAll("template")) visit(template.content);
  };
  visit(new DOMParser().parseFromString(source, "text/html"));
  for (const element of elements) {
    for (const track of [element.track, element.authoredTrack])
      if (track !== undefined && Number.isFinite(track)) top = Math.min(top, track);
  }
  copy.setAttribute("data-track-index", String(top - 1));
  let zIndex = 0;
  for (const match of source.matchAll(/z-index\s*:\s*(-?\d+)/gi)) zIndex = Math.max(zIndex, Number(match[1]));
  for (const element of elements) zIndex = Math.max(zIndex, element.zIndex ?? 0);
  (copy as HTMLElement).style.zIndex = String(zIndex + 1);
}

/** Materialize a pasted text layer as an authored runtime clip. Timing is local
 * to the containing composition; wrappers retain their original coordinate space. */
export function timedTextPaste(
  html: string,
  source: string,
  playhead: number,
  selector?: string,
  selectorIndex = 0,
): string {
  const node = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
  if (!node || !isTextBearingTag(node.localName) || !node.textContent?.trim()) return html;
  if (node.hasAttribute("data-start")) return html;
  const doc = parseSavedSource(source);
  const root = doc.querySelector("[data-composition-id]");
  let origin: Element | undefined;
  try { origin = selector ? doc.querySelectorAll(selector)[selectorIndex] : undefined; } catch { /* foreign clipboard */ }
  const host = origin?.parentElement?.closest("[data-composition-id]") ?? root;
  const duration = Number(host?.getAttribute("data-duration")) || 5;
  let hostStart = 0;
  for (let parent = origin?.parentElement; parent && parent !== root; parent = parent.parentElement)
    hostStart += Number(parent.getAttribute("data-start")) || 0;
  const start = Math.max(0, Math.min(playhead - hostStart, Math.max(0, duration - 1 / 30)));
  const remaining = Math.max(1 / 30, duration - start);
  node.classList.add("clip");
  node.setAttribute("data-start", String(Math.round(start * 1000) / 1000));
  node.setAttribute("data-duration", String(Math.round(remaining * 1000) / 1000));
  placeTextOnTop(node, source);
  node.setAttribute("data-timeline-label", node.textContent.trim().slice(0, 80));
  return node.outerHTML;
}

/** Both canvas paste and timeline duplicate open the same top text lane. */
export function openPastedTextTrack(source: string, html: string, elements: readonly TimelineElement[]): { source: string; html: string } {
  const copy = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
  if (!copy || !isTextBearingTag(copy.localName) || !copy.textContent?.trim() ||
    !Array.from(copy.children).every(child => child.localName === "br")) return { source, html };
  placeTextOnTop(copy, source, elements);
  return { source, html: copy.outerHTML };
}
