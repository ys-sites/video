import { createRequire } from 'node:module';
import path from 'node:path';
import { loadCaptionSourceOperations } from './transcript-captions.ts';

type Span = { start: { offset: number }; end: { offset: number } };
type AttributeSelector = { loc: Span; name: { name: string; loc: Span } };

/** Resolve the CSS parser from the same installed native runtime as composition authoring. */
export async function loadCanvasSourceOperations(runtimeRoot: string) {
  const { parseHTML } = await loadCaptionSourceOperations(runtimeRoot);
  const require = createRequire(path.join(runtimeRoot, 'package.json'));
  const nativeRequire = createRequire(require.resolve('hyperframes/package.json'));
  const css = nativeRequire('css-tree') as {
    parse: (source: string, options: { positions: boolean }) => unknown;
    walk: (ast: unknown, visitor: { visit: string; enter: (node: AttributeSelector) => void }) => void;
    ident: { decode: (name: string) => string };
  };
  const rewriteStyles = (source: string, aliases: Map<string, string>) => {
    const edits: { start: number; end: number; text: string }[] = [];
    css.walk(css.parse(source, { positions: true }), { visit: 'AttributeSelector', enter(node) {
      const alias = aliases.get(css.ident.decode(node.name.name).toLowerCase());
      if (!alias) return;
      const start = node.loc.start.offset, end = node.loc.end.offset;
      const selector = source.slice(start, end);
      const authored = source.slice(start, node.name.loc.start.offset) + alias + source.slice(node.name.loc.end.offset, end);
      // Keep nested compositions matching the original selector, but exclude the output frame.
      // :where() keeps the original attribute specificity, including inside :not() and :is().
      edits.push({ start, end, text: `:is(${authored},${selector}:not(:where([data-canvas-fit])))` });
    } });
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return source;
  };
  return { parseHTML, rewriteStyles };
}
