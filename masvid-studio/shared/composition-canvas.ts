import type { parseHTML } from 'linkedom';

export const canvasPresets = [
  { ratio: '16:9', width: 1920, height: 1080 },
  { ratio: '9:16', width: 1080, height: 1920 },
  { ratio: '1:1', width: 1080, height: 1080 },
  { ratio: '4:3', width: 1440, height: 1080 },
  { ratio: '3:4', width: 1080, height: 1440 },
] as const;
export type CanvasRatio = typeof canvasPresets[number]['ratio'];
export type CanvasFit = 'contain' | 'cover';
export type CanvasSettings = { width: number; height: number; ratio: string; fit: CanvasFit };
export function canvasRatio(width: number, height: number): string {
  return canvasPresets.find(item => Math.abs(item.width / item.height - width / height) < 0.001)?.ratio || `${width}:${height}`;
}

/** Native source owns framing. Preview and export consume these same dimensions and transforms. */
export function compositionCanvasSource(html: string, parsers: { parseHTML: typeof parseHTML; rewriteStyles: (source: string, aliases: Map<string, string>) => string }, change?: { ratio: CanvasRatio; fit: CanvasFit }) {
  const { document } = parsers.parseHTML(html);
  let root = document.querySelector('[data-composition-id]');
  if (!root || root.tagName !== 'DIV') throw new Error('Choose a native composition with a div root');
  const width = Number(root.getAttribute('data-width')), height = Number(root.getAttribute('data-height'));
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Composition requires explicit canvas dimensions');
  if (!change) return { content: html, canvas: { width, height, ratio: canvasRatio(width, height), fit: root.getAttribute('data-canvas-fit') === 'cover' ? 'cover' : 'contain' } as CanvasSettings };
  const preset = canvasPresets.find(item => item.ratio === change.ratio);
  if (!preset || !['contain', 'cover'].includes(change.fit)) throw new Error('Choose a supported aspect ratio and content fit');
  let frame = [...root.children].find(node => node.hasAttribute('data-canvas-frame')) as HTMLElement | undefined;
  if (!frame) {
    // Keep the authored root and its children together: selectors and GSAP targets retain their IDs.
    const outer = document.createElement('div');
    const aliases = new Map<string, string>();
    for (const attr of [...root.attributes]) {
      if (/^data-(?:composition|start$|duration$|width$|height$|fps$|track-index$)/.test(attr.name)) {
        const alias = `data-canvas-authored-${attr.name.slice(5)}`;
        aliases.set(attr.name, alias); root.setAttribute(alias, attr.value);
        outer.setAttribute(attr.name, attr.value); root.removeAttribute(attr.name);
      }
    }
    outer.setAttribute('data-canvas-source-width', String(width));
    outer.setAttribute('data-canvas-source-height', String(height));
    frame = document.createElement('div'); frame.setAttribute('data-canvas-frame', '');
    root.setAttribute('data-canvas-content', '');
    (root as HTMLElement).style.width = `${width}px`; (root as HTMLElement).style.height = `${height}px`;
    root.replaceWith(outer); outer.append(frame); frame.append(root); root = outer;
    for (const style of document.querySelectorAll('style')) style.textContent = parsers.rewriteStyles(style.textContent || '', aliases);
  }
  const sourceWidth = Number(root.getAttribute('data-canvas-source-width')), sourceHeight = Number(root.getAttribute('data-canvas-source-height'));
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('Canvas framing metadata changed; restore the composition before reframing');
  const scale = Math[change.fit === 'cover' ? 'max' : 'min'](preset.width / sourceWidth, preset.height / sourceHeight);
  const x = (preset.width - sourceWidth * scale) / 2, y = (preset.height - sourceHeight * scale) / 2;
  frame.setAttribute('style', `position:absolute;left:0;top:0;width:${sourceWidth}px;height:${sourceHeight}px;transform-origin:0 0;transform:translate(${x}px,${y}px) scale(${scale})`);
  root.setAttribute('data-width', String(preset.width)); root.setAttribute('data-height', String(preset.height)); root.setAttribute('data-canvas-fit', change.fit);
  root.setAttribute('style', `position:relative;width:${preset.width}px;height:${preset.height}px;overflow:hidden;background:#000`);
  return { content: document.toString(), canvas: { width: preset.width, height: preset.height, ratio: preset.ratio, fit: change.fit } };
}
