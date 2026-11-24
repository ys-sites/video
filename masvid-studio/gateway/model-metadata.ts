import { inputModalities, modelCapabilities, type ModelMetadata } from '../shared/provider-directory.ts';

/** Catalogue metadata is descriptive; generation options use the existing adapter's wire schema. */
export function modelMetadata(value: Record<string, unknown>): ModelMetadata {
  const result: ModelMetadata = {};
  if (value.group !== undefined) {
    if (typeof value.group !== 'string' || value.group.length > 80) throw new Error('Group name must be at most 80 characters');
    result.group = value.group.trim();
  }
  for (const [key, allowed] of [['capabilities', modelCapabilities], ['inputs', inputModalities]] as const) {
    const values = value[key];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.some(item => !(allowed as readonly unknown[]).includes(item))) throw new Error('Invalid model capability');
    (result as Record<string, unknown>)[key] = [...new Set(values)];
  }
  for (const key of ['contextWindow', 'maxInputTokens', 'maxOutputTokens'] as const) {
    if (value[key] === undefined) continue;
    if (value[key] === null || value[key] === '') { result[key] = null; continue; }
    if (typeof value[key] !== 'number' || !Number.isInteger(value[key]) || value[key] < 1 || value[key] > 100_000_000) throw new Error('Token limits must be positive integers up to 100,000,000');
    result[key] = value[key];
  }
  if (result.contextWindow && (result.maxInputTokens && result.maxInputTokens > result.contextWindow || result.maxOutputTokens && result.maxOutputTokens > result.contextWindow)) throw new Error('Token limits cannot exceed the context window');
  if (value.defaults !== undefined) {
    const defaults = value.defaults;
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults) || JSON.stringify(defaults).length > 64000) throw new Error('Default parameters must be a JSON object under 64 KB');
    const reserved = /^(?:model|prompt|input|api[_-]?key|authorization|headers|webhook_url|__proto__|constructor|prototype)$/i;
    if (Object.keys(defaults).some(key => reserved.test(key))) throw new Error('Default parameters contain a reserved field');
    result.defaults = defaults as Record<string, unknown>;
  }
  return result;
}
