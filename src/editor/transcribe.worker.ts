// Speech to text in the browser with Whisper (transformers.js, Apache-2.0). Audio never leaves the device;
// only the open model weights are downloaded once from the Hugging Face CDN and cached by the browser.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

type Req = { audio: Float32Array; model: string; language?: string };
let asr: any = null;
let loaded = '';

self.onmessage = async (event: MessageEvent<Req>) => {
  const { audio, model, language } = event.data;
  try {
    if (!asr || loaded !== model) {
      const webgpu = typeof (navigator as any).gpu !== 'undefined' && !!(await (navigator as any).gpu.requestAdapter?.().catch(() => null));
      asr = await pipeline('automatic-speech-recognition', model, {
        device: webgpu ? 'webgpu' : 'wasm',
        dtype: webgpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && typeof p.progress === 'number') self.postMessage({ type: 'load', file: p.file, progress: p.progress });
        },
      } as any);
      loaded = model;
      self.postMessage({ type: 'ready', device: webgpu ? 'webgpu' : 'wasm' });
    }
    const out = await asr(audio, {
      return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5,
      ...(language ? { language, task: 'transcribe' } : {}),
    });
    const words = (out?.chunks ?? [])
      .map((c: any) => ({ w: String(c.text ?? '').trim(), s: Number(c.timestamp?.[0]), e: Number(c.timestamp?.[1] ?? c.timestamp?.[0]) }))
      .filter((w: any) => w.w && isFinite(w.s));
    for (const w of words) if (!isFinite(w.e) || w.e < w.s) w.e = w.s + 0.3;
    self.postMessage({ type: 'done', words });
  } catch (error) {
    self.postMessage({ type: 'error', error: String((error as Error)?.message ?? error) });
  }
};
