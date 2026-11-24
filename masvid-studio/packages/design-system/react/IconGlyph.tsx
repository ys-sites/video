import sprite from '../icons.svg?raw';

// Trusted package-owned vectors, bundled with the UI rather than fetched by <use>.
// This keeps native-dialog controls visible during reconnects and offline operation.
const glyphs = new Map(Array.from(sprite.matchAll(/<symbol\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g),
  ([, id, markup]) => [id, { __html: markup }]));

export function IconGlyph({ id }: { id: string }) {
  return <g dangerouslySetInnerHTML={glyphs.get(id) ?? glyphs.get('ri-question-line')} />;
}
