// Audio decoding, transcription and the in-browser MP4 export (Mediabunny, MPL-2.0, on WebCodecs).
import { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_MEDIUM } from 'mediabunny';
import { captionChunks, drawFrame } from './compositor';
import { aspectSize, outputDuration, outputWords, toSource, type Project, type Word } from './project';

export const WHISPER_MODEL = 'onnx-community/whisper-base_timestamped';

export async function decodeAudio(file: Blob): Promise<AudioBuffer | null> {
  try {
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    void ctx.close();
    return buf;
  } catch { return null; }
}

/** 16 kHz mono for Whisper. */
async function toMono16k(buf: AudioBuffer): Promise<Float32Array> {
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
  const node = off.createBufferSource();
  node.buffer = buf;
  node.connect(off.destination);
  node.start();
  const r = await off.startRendering();
  return r.getChannelData(0).slice();
}

export async function transcribe(buf: AudioBuffer, onStatus: (text: string) => void): Promise<Word[]> {
  const audio = await toMono16k(buf);
  const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const loads = new Map<string, number>();
    worker.onmessage = (e: MessageEvent<any>) => {
      const m = e.data;
      if (m.type === 'load') {
        loads.set(m.file, m.progress);
        const avg = [...loads.values()].reduce((a, b) => a + b, 0) / Math.max(1, loads.size);
        onStatus(`Downloading the speech model (once): ${Math.round(avg)}%`);
      } else if (m.type === 'ready') onStatus(`Listening to your video (${m.device === 'webgpu' ? 'GPU' : 'CPU'})...`);
      else if (m.type === 'done') { worker.terminate(); resolve(m.words); }
      else if (m.type === 'error') { worker.terminate(); reject(new Error(m.error)); }
    };
    worker.onerror = e => { worker.terminate(); reject(new Error(e.message || 'Transcription failed')); };
    worker.postMessage({ audio, model: WHISPER_MODEL }, [audio.buffer]);
  });
}

/** Edited soundtrack: kept ranges of the voice (short fades at cuts) plus an optional music bed ducked under speech. */
export async function renderAudio(p: Project, voice: AudioBuffer | null, music: AudioBuffer | null, sampleRate = 48000): Promise<AudioBuffer | null> {
  const total = outputDuration(p.keep);
  if (total <= 0 || (!voice && !music)) return null;
  const off = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
  if (voice) {
    let at = 0;
    for (const r of p.keep) {
      const len = r.e - r.s;
      const src = off.createBufferSource();
      src.buffer = voice;
      const g = off.createGain();
      const fade = Math.min(0.012, len / 4);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(p.voice, at + fade);
      g.gain.setValueAtTime(p.voice, at + len - fade);
      g.gain.linearRampToValueAtTime(0, at + len);
      src.connect(g).connect(off.destination);
      src.start(at, r.s, len);
      at += len;
    }
  }
  if (music && p.music) {
    const src = off.createBufferSource();
    src.buffer = music;
    src.loop = true;
    const g = off.createGain();
    const vol = p.music.volume;
    g.gain.setValueAtTime(vol, 0);
    if (p.music.duck) {
      for (const w of outputWords(p)) {
        g.gain.setTargetAtTime(vol * 0.3, Math.max(0, w.os - 0.08), 0.05);
        g.gain.setTargetAtTime(vol, w.oe + 0.25, 0.2);
      }
    }
    g.gain.setValueAtTime(g.gain.value, Math.max(0, total - 1.2));
    g.gain.linearRampToValueAtTime(0, total);
    src.connect(g).connect(off.destination);
    src.start(0);
  }
  return off.startRendering();
}

export type ExportProgress = (fraction: number, text: string) => void;

/** Render the edit to an MP4 on this device. Returns the file bytes. */
export async function exportMp4(p: Project, file: Blob, voice: AudioBuffer | null, music: AudioBuffer | null, opts: { fps: number; draft: boolean }, onProgress: ExportProgress, signal?: AbortSignal): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track found in this file.');
  const { w, h } = aspectSize(p.aspect, opts.draft ? 0.5 : 1);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const sink = new CanvasSink(track, { poolSize: 2 });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: opts.draft ? QUALITY_MEDIUM : QUALITY_HIGH });
  output.addVideoTrack(videoSource, { frameRate: opts.fps });
  onProgress(0, 'Mixing the sound...');
  const audio = await renderAudio(p, voice, music);
  const audioSource = audio ? new AudioBufferSource({ codec: 'aac', bitrate: QUALITY_HIGH }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  if (audioSource && audio) await audioSource.add(audio);

  const total = outputDuration(p.keep);
  const frames = Math.max(1, Math.floor(total * opts.fps));
  const chunks = captionChunks(outputWords(p));
  const times = Array.from({ length: frames }, (_, i) => toSource(p.keep, i / opts.fps));
  let i = 0;
  try {
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / opts.fps;
      const src = wrapped?.canvas ?? null;
      drawFrame(ctx, p, chunks, t, src as CanvasImageSource | null, src?.width ?? 0, src?.height ?? 0);
      await videoSource.add(t, 1 / opts.fps);
      i++;
      if (i % 10 === 0) onProgress(i / frames, `Rendering frame ${i} of ${frames}`);
      if (i >= frames) break;
    }
    videoSource.close();
    audioSource?.close();
    onProgress(1, 'Finishing the file...');
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    input.dispose?.();
  }
  const bytes = (output.target as BufferTarget).buffer;
  if (!bytes) throw new Error('The export produced no data.');
  return new Blob([bytes], { type: 'video/mp4' });
}
