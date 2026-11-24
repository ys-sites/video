export type TemplateGuideFacts = { palette: string[]; editableDemo: boolean };

/** Read authored guide metadata, never invent a palette from a catalogue color category. */
export function templateGuideFacts(source: string): TemplateGuideFacts {
  const document = new DOMParser().parseFromString(source, 'text/html');
  const palette = [...new Set([...document.querySelectorAll('.palette [data-color]')]
    .map(node => node.getAttribute('data-color') ?? '').filter(value => /^#[0-9a-f]{6}$/i.test(value)))].slice(0, 8);
  const editableDemo = [...document.querySelectorAll('[data-demo]')].some(node => {
    try {
      const demo = JSON.parse(node.getAttribute('data-demo') ?? '{}');
      return Array.isArray(demo.params) && demo.params.some((param: { type?: string }) => param.type === 'text' || param.type === 'color');
    } catch { return false; }
  });
  return { palette, editableDemo };
}
