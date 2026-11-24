/** Authored video styles. These values never theme the editor interface. */
export const CAPTION_STYLES = [
  { id: 'bar', label: 'Subtitle bar', description: 'A dark backing for clear, readable speech.', color: '#ffffff', background: 'rgba(0,0,0,0.72)', weight: 600, shadow: 'none', highlight: '#ffe066' },
  { id: 'clean', label: 'Clean white', description: 'Simple white text with a soft shadow.', color: '#ffffff', background: 'transparent', weight: 600, shadow: '0 2px 5px rgba(0,0,0,0.9)', highlight: '#ffe066' },
  { id: 'outline', label: 'Bold outline', description: 'Heavy text with a dark edge.', color: '#ffffff', background: 'transparent', weight: 800, shadow: '-2px -2px 0 #111111,2px -2px 0 #111111,-2px 2px 0 #111111,2px 2px 0 #111111', highlight: '#ffe066' },
  { id: 'yellow', label: 'Warm yellow', description: 'High contrast yellow for emphasis.', color: '#ffe066', background: 'transparent', weight: 700, shadow: '0 2px 5px #111111', highlight: '#ffffff' },
  { id: 'card', label: 'Paper card', description: 'Dark text on a light backing.', color: '#151515', background: 'rgba(255,255,255,0.94)', weight: 600, shadow: 'none', highlight: '#7540c9' },
  { id: 'cinema', label: 'Cinema', description: 'Quiet serif captions for longer stories.', color: '#ffffff', background: 'transparent', weight: 400, shadow: '0 2px 5px #111111', highlight: '#ffe066' },
] as const;
export type CaptionSettings = { preset: typeof CAPTION_STYLES[number]['id']; position: 'bottom' | 'center' | 'top'; scale: number; pacing: 'sentence' | 'word'; visible: boolean };
export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = { preset: 'bar', position: 'bottom', scale: 1, pacing: 'sentence', visible: true };
export function captionSettings(input: Partial<CaptionSettings> = {}): CaptionSettings {
  const value = { ...DEFAULT_CAPTION_SETTINGS, ...input };
  if (!CAPTION_STYLES.some(style => style.id === value.preset) || !['bottom', 'center', 'top'].includes(value.position) || !['sentence', 'word'].includes(value.pacing) || !Number.isFinite(value.scale) || value.scale < 0.5 || value.scale > 2 || typeof value.visible !== 'boolean') throw new Error('Invalid caption settings');
  return value;
}
export function captionArtwork(settings: CaptionSettings, fontSize: number): Record<string, string> {
  const preset = CAPTION_STYLES.find(style => style.id === settings.preset)!;
  return {
    left: '8%', width: '84%', 'text-align': 'center', 'white-space': 'pre-wrap',
    top: settings.position === 'top' ? '8%' : settings.position === 'center' ? '45%' : 'auto',
    bottom: settings.position === 'bottom' ? '8%' : 'auto',
    'font-family': settings.preset === 'cinema' ? 'Georgia,serif' : 'Arial,sans-serif',
    'font-size': `${Math.round(fontSize * settings.scale)}px`, 'font-weight': String(preset.weight), 'line-height': '1.3',
    color: preset.color, background: preset.background, 'text-shadow': preset.shadow,
    padding: '0.3em 0.5em', 'border-radius': '0.2em', '--caption-highlight': preset.highlight,
  };
}
