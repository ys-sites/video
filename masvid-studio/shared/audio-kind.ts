export type AudioKind = 'music' | 'sfx' | 'speech' | 'upload';

export const AUDIO_KINDS: readonly AudioKind[] = ['music', 'sfx', 'speech', 'upload'];

export function isAudioKind(value: unknown): value is AudioKind {
  return typeof value === 'string' && (AUDIO_KINDS as readonly string[]).includes(value);
}

/** Identify dedicated sound-effects / foley endpoints without misclassifying music generators. */
export function isSfxModelText(text: string): boolean {
  return /sound[-_ ]?effects?|\bsfx\b|foley|audio[-_ ]?effects?/i.test(text);
}

/** Shared audio domain classifier used by both server-side persistence/filtering and Sound Studio UI. */
export function classifyAudioKind(modelId?: string, mode?: string, source?: string, label?: string): AudioKind {
  if (source === 'upload' || !modelId) return 'upload';
  if (mode === 'text-to-speech') return 'speech';
  const combined = label ? `${modelId} ${label}` : modelId;
  if (isSfxModelText(combined)) return 'sfx';
  if (/tts|speech|kokoro|voice|elevenlabs-v3/i.test(modelId)) return 'speech';
  return 'music';
}

/** Derive a compact readable display title from long narration scripts or prompts. */
export function audioAssetTitle(prompt: string, maxChars = 32): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Audio';
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, maxChars);
  // Prefer ending on a sentence boundary when one occurs in the second half.
  const sentenceBreak = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (sentenceBreak >= Math.floor(maxChars * 0.45)) {
    return slice.slice(0, sentenceBreak + 1).trim();
  }
  // Avoid cutting an English word in half when spaces are present.
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxChars * 0.6)) {
    return slice.slice(0, lastSpace).trim();
  }
  return slice.replace(/[，,、；;：:\-]+$/, '').trim() || slice.trim();
}
