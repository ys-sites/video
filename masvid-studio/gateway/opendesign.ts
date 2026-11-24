import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Model } from '../shared/gateway.ts';
import { openDesignImageReferenceCap } from '../shared/opendesign-models.ts';
import { resolveGenerationParameters } from '../shared/generation-options.ts';
import { apiJson, publicProviderFetch, ProviderError, retryRead, type Fetcher } from './network.ts';
import type { ProviderAdapter, ProviderContext } from './providers.ts';

export async function cloudModels(baseUrl: string, key: string, fetcher: Fetcher = publicProviderFetch): Promise<Model[]> {
  const body = await apiJson(fetcher, baseUrl + '/api/v1/media/models', { headers: { Authorization: `Bearer ${key}` } });
  if (!Array.isArray(body.models)) throw new Error('OpenDesign Cloud catalogue format changed');
  return body.models.filter((row: any) => typeof row.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,179}$/.test(row.model)
    && ['image', 'video', 'audio', 'audio_speech', 'audio_music'].includes(row.kind)).map((row: any) => ({
    id: 'opendesign:' + row.model, provider: 'opendesign', modelId: row.model, label: row.model,
    modality: row.kind.startsWith('audio') ? 'audio' : row.kind,
    mode: row.kind === 'audio_music' ? 'text-to-audio' : row.kind.startsWith('audio') ? 'text-to-speech' : 'text-to-' + row.kind, source: 'live',
    ...inputImages(row),
  }));
}

/** Edit-capable image models accept references; video models with input images accept a first frame. */
function inputImages(row: any): Partial<Model> {
  const capabilities = row.capabilities && typeof row.capabilities === 'object' && !Array.isArray(row.capabilities) ? row.capabilities as Record<string, unknown> : undefined;
  if (!capabilities) return {};
  const max = Number.isInteger(capabilities.max_input_images) && (capabilities.max_input_images as number) > 0 ? capabilities.max_input_images as number : undefined;
  if (row.kind === 'image' && capabilities.edits === true) return { nativeOptions: capabilities, supportsImageReference: true, maxInputImages: max ?? openDesignImageReferenceCap(row.model) ?? 1 };
  // Only the first-frame role is implemented; the provider maximum stays visible in nativeOptions.
  if (row.kind === 'video' && max) return { nativeOptions: capabilities, maxInputImages: 1 };
  return { nativeOptions: capabilities, ...(row.kind === 'image' && capabilities.edits === false ? { supportsImageReference: false } : {}) };
}

/** Cloud image requests carry ratio and resolution together as one `output` object. */
export function cloudImageParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const hasRatio = parameters.aspect_ratio !== undefined, hasResolution = parameters.resolution !== undefined;
  if (!hasRatio && !hasResolution) return parameters;
  if (parameters.size !== undefined) throw new Error('Cannot combine size with aspect_ratio or resolution.');
  if (parameters.output !== undefined) throw new Error('Cannot combine output with aspect_ratio or resolution.');
  if (typeof parameters.aspect_ratio !== 'string' || !parameters.aspect_ratio.trim() || typeof parameters.resolution !== 'string' || !parameters.resolution.trim()) {
    throw new Error('OpenDesign Cloud image requests require both aspect_ratio and resolution together, or an explicit output object.');
  }
  const { aspect_ratio, resolution, ...rest } = parameters;
  return { ...rest, output: { aspect_ratio, resolution } };
}

/** Three-step Cloud upload: create, PUT the bytes without credentials, then commit. */
export async function uploadInputs(fetcher: Fetcher, api: string, headers: Record<string, string>, jobId: string, ctx: Pick<ProviderContext, 'references' | 'progress' | 'signal'>): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, input] of (ctx.references ?? []).entries()) {
    const bytes = await readFile(input.file);
    if (bytes.length !== input.bytes) throw new Error('Reference image changed after it was queued');
    await ctx.progress('uploading');
    const created = await apiJson(fetcher, api + '/uploads', { method: 'POST', headers: { ...headers, 'Idempotency-Key': `${jobId}-upload-${index}` },
      body: JSON.stringify({ size_bytes: bytes.length, mime_type: input.mimeType }), signal: ctx.signal });
    if (typeof created.asset_id !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(created.asset_id) || typeof created.upload_url !== 'string' || !created.upload_url.startsWith('https://')) throw new Error('OpenDesign Cloud did not return an upload target');
    const put = await fetcher(created.upload_url, { method: 'PUT', headers: { 'Content-Type': input.mimeType, 'Content-Length': String(bytes.length) }, body: bytes, redirect: 'error', signal: ctx.signal });
    // Storage, not the API key, rejected this presigned PUT; do not report it as a credential failure.
    if (!put.ok) throw new Error(`OpenDesign Cloud reference upload storage HTTP ${put.status}; the job was not submitted`);
    const committed = await apiJson(fetcher, api + `/uploads/${created.asset_id}/commit`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': `${jobId}-commit-${index}` }, body: '{}', signal: ctx.signal });
    if (committed.status !== 'ready') throw new Error('OpenDesign Cloud did not accept the reference image');
    ids.push(created.asset_id);
  }
  return ids;
}

export const opendesign: ProviderAdapter = {
  async generate(job, ctx) {
    if (!ctx.baseUrl) throw new Error('OpenDesign Cloud API origin required');
    const fetcher = ctx.fetcher === fetch ? publicProviderFetch : ctx.fetcher;
    const headers = { Authorization: `Bearer ${ctx.key}`, 'Content-Type': 'application/json' };
    const api = ctx.baseUrl + '/api/v1/media';
    const audio = job.modality === 'audio';
    const speech = audio && job.model.mode === 'text-to-speech';
    let remoteId = job.remoteId;
    if (!remoteId) {
      const parameters = resolveGenerationParameters(job.model, job.parameters, !!ctx.references?.length);
      const { voice, ...speechOptions } = parameters;
      if (speech && (typeof voice !== 'string' || !voice.trim())) throw new Error('Choose a provider voice ID in parameters.voice');
      const wireParameters = job.modality === 'image' ? cloudImageParameters(parameters) : parameters;
      const audioBody = speech ? { voice, parameters: { ...speechOptions, text: job.prompt } } : { parameters: { ...parameters, prompt: job.prompt } };
      const inputs = audio ? [] : await uploadInputs(fetcher, api, headers, job.id, ctx);
      const images = inputs.length ? { images: job.modality === 'video' ? [{ asset_id: inputs[0], role: 'first_frame' }] : inputs } : {};
      const payload = audio ? { model: job.model.modelId, ...audioBody }
        : { ...wireParameters, model: job.model.modelId, prompt: job.prompt, ...images };
      const endpoint = audio ? speech ? '/audio/speech' : '/audio/music' : job.modality === 'image' ? inputs.length || Array.isArray(parameters.images) && parameters.images.length ? '/images/edits' : '/images/generations' : '/videos/tasks';
      const submitted = await apiJson(fetcher, api + endpoint, { method: 'POST', headers: { ...headers, 'Idempotency-Key': job.id }, body: JSON.stringify(payload), signal: ctx.signal });
      if (typeof submitted.task_id !== 'string' || !/^[a-zA-Z0-9_-]{1,180}$/.test(submitted.task_id)) throw new Error('OpenDesign Cloud did not return a task ID');
      remoteId = submitted.task_id;
      await ctx.progress('submitted', remoteId);
    }
    if (!/^[a-zA-Z0-9_-]{1,180}$/.test(remoteId!)) throw new Error('Invalid Cloud task ID');
    const taskUrl = api + `/${audio ? 'audio' : job.modality === 'image' ? 'images' : 'videos'}/tasks/${remoteId}`;
    for (;;) {
      await delay(ctx.pollMs ?? 2000, undefined, { signal: ctx.signal });
      // The task is already paid for: a dropped poll connection must not discard its result.
      const result = await retryRead(() => apiJson(fetcher, taskUrl, { headers, signal: ctx.signal }), ctx.signal, 5, () => ctx.progress('reconnecting'), () => ctx.progress('generating'));
      ctx.signal.throwIfAborted();
      if (result.status === 'succeeded') {
        // Speech timestamps (character alignment or word timings) arrive beside the file.
        if (result.result && typeof result.result === 'object' && !Array.isArray(result.result) && JSON.stringify(result.result).length <= 2_000_000) await ctx.result?.(result.result);
        if (job.modality === 'video') {
          return [await retryRead(async () => {
            const response = await fetcher(taskUrl + '/content', { headers, redirect: 'error', signal: ctx.signal });
            if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) return new URL(response.headers.get('location')!, taskUrl).href;
            if (!response.ok) throw new ProviderError(`OpenDesign Cloud content HTTP ${response.status}`, response.status);
            return Buffer.from(await response.arrayBuffer());
          }, ctx.signal, 5, () => ctx.progress('reconnecting'), () => ctx.progress('generating'))];
        }
        const urls = result.assets?.map((asset: any) => asset.url).filter((url: unknown) => typeof url === 'string');
        if (!urls?.length) throw new Error('OpenDesign Cloud completed without media output');
        return urls;
      }
      if (['failed', 'cancelled'].includes(result.status)) {
        const code = typeof result.error?.code === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(result.error.code) ? result.error.code : undefined;
        await ctx.result?.({ error: { ...(code ? { code } : {}), ...(typeof result.error?.retryable === 'boolean' ? { retryable: result.error.retryable } : {}) } }, true);
        throw new Error(`OpenDesign Cloud task ${result.status}${code ? ` (${code})` : ''}; the remote task is terminal`);
      }
      if (!['queued', 'pending', 'running', 'processing', 'submitted'].includes(result.status)) throw new Error('OpenDesign Cloud returned an unknown task status');
      await ctx.progress('generating');
    }
  },
};
