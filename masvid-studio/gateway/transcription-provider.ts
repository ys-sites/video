import { readFile, stat } from 'node:fs/promises';
import { normalizeTranscript } from '../shared/transcript.ts';
import { connectionBaseUrl } from './connections.ts';
import { ProviderError, publicProviderFetch, type Fetcher } from './network.ts';

export const TRANSCRIPTION_CHUNK_SECONDS = 600;
const TRANSCRIPTION_TIMEOUT_MS = 10 * 60_000;
// Non-streaming ASR can be silent for longer than the ordinary provider idle limit.
const transcriptionFetch: Fetcher = (url, init) => publicProviderFetch(url, init, TRANSCRIPTION_TIMEOUT_MS);
const formats = ['json', 'verbose_json', 'diarized_json'];
/** Explicit, bounded options; neither credentials nor arbitrary destinations enter a job. */
export function transcriptionParameters(modelId: string, defaults: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const input = { ...defaults, ...overrides };
  const allowed = ['response_format', 'timestamp_granularities', 'prompt', 'temperature', 'chunking_strategy', 'keywords', 'languages'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Unsupported transcription parameter');
  const format = input.response_format ?? (modelId === 'gpt-transcribe' || /^gpt-4o-(?:mini-)?transcribe(?:-\d)/.test(modelId) || ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe'].includes(modelId) ? 'json' : modelId === 'gpt-4o-transcribe-diarize' ? 'diarized_json' : 'verbose_json');
  if (!formats.includes(String(format))) throw new Error('Choose json, verbose_json or diarized_json');
  const result: Record<string, unknown> = { ...input, response_format: format };
  if (input.prompt !== undefined && (typeof input.prompt !== 'string' || input.prompt.length > 2000)) throw new Error('Transcription context must be at most 2000 characters');
  if (input.temperature !== undefined && (typeof input.temperature !== 'number' || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 1)) throw new Error('Temperature must be between 0 and 1');
  for (const key of ['keywords', 'languages']) if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 100 || input[key].some(value => typeof value !== 'string' || !value || value.length > 100 || /[<>\r\n]/.test(value)))) throw new Error(`Invalid ${key}`);
  if (input.chunking_strategy !== undefined && input.chunking_strategy !== 'auto') throw new Error('Only automatic provider chunking is supported');
  if (format === 'diarized_json') { result.chunking_strategy = 'auto'; if (input.prompt || input.timestamp_granularities) throw new Error('Diarized transcription does not accept prompt or word timestamp options'); }
  if (format === 'verbose_json') {
    const granularity = input.timestamp_granularities ?? ['word', 'segment'];
    if (!Array.isArray(granularity) || !granularity.length || granularity.some(value => !['word', 'segment'].includes(String(value)))) throw new Error('Invalid timestamp granularity');
    result.timestamp_granularities = granularity;
  } else if (input.timestamp_granularities) throw new Error('Word timestamps require verbose_json');
  return result;
}

/** One POST per chunk; transport uncertainty never causes a paid retry. */
export async function transcribeAudio(input: { file: string; modelId: string; baseUrl: string; key: string; parameters: Record<string, unknown>; language?: string; offset: number; duration: number; signal: AbortSignal }, fetcher: Fetcher = transcriptionFetch) {
  const size = (await stat(input.file)).size;
  if (!size || size > 25_000_000) throw new Error('Transcription audio must be between 1 byte and 25 MB');
  const form = new FormData();
  form.set('file', new Blob([await readFile(input.file)], { type: 'audio/wav' }), 'recording.wav');
  form.set('model', input.modelId);
  const parameters = { ...input.parameters };
  if (input.language && input.language !== 'auto') {
    if (input.modelId === 'gpt-transcribe') parameters.languages = [input.language];
    else parameters.language = input.language;
  }
  for (const [name, value] of Object.entries(parameters)) {
    if (Array.isArray(value)) for (const item of value) form.append(name + '[]', String(item));
    else form.set(name, String(value));
  }
  // The shared DNS-pinned HTTPS transport accepts bytes, not FormData streams.
  const encoded = new Response(form);
  const response = await fetcher(connectionBaseUrl(input.baseUrl) + '/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${input.key}`, 'Content-Type': encoded.headers.get('content-type')! },
    body: new Uint8Array(await encoded.arrayBuffer()), redirect: 'error', signal: AbortSignal.any([input.signal, AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new ProviderError(`Transcription provider HTTP ${response.status}${[401, 403].includes(response.status) ? ': check credentials and model access in Settings' : ''}`, response.status);
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('Transcription response exceeds 4 MB');
  let body; try { body = JSON.parse(text); } catch { throw new Error('Transcription provider returned invalid JSON'); }
  return normalizeTranscript(body, input.offset, input.duration);
}
