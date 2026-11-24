import { classifyWebAudioMediaRoute } from "@hyperframes/core/runtime/web-audio-route";

export const AUDIO_PREVIEW_BARS = 81;

type FrequencyWindow = { low: number; high: number };

/** A mirrored, audio-reactive display, not a calibrated frequency plot. */
export function spectrumLevels(samples: Float32Array, frequencies: Uint8Array, sampleRate: number,
  output: Float32Array, window: FrequencyWindow): void {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  if (rms < 0.0001) { output.fill(0); return; }
  const binHz = sampleRate / (frequencies.length * 2);
  const first = Math.max(1, Math.floor(40 / binHz));
  const last = Math.min(frequencies.length - 1, Math.ceil(16000 / binHz));
  let peak = 0;
  for (let bin = first; bin <= last; bin++) peak = Math.max(peak, frequencies[bin]);
  if (!peak) { output.fill(0); return; }
  let low = first, high = last;
  while (low < high && frequencies[low] < peak * 0.35) low++;
  while (high > low && frequencies[high] < peak * 0.35) high--;
  // Fit the occupied range so a tonal source is not squeezed into two pixels.
  // Expansion is immediate; contraction is slow enough to avoid a twitchy zoom.
  low = Math.max(first, low / 1.18);
  high = Math.min(last, Math.max(low + 4, high * 1.18));
  window.low = window.low ? Math.min(low, window.low * 0.985 + low * 0.015) : low;
  window.high = window.high ? Math.max(high, window.high * 0.985 + high * 0.015) : high;
  const half = Math.ceil(output.length / 2);
  const measuredLoudness = Math.min(1, (rms * 3) ** 0.7);
  // Lift quieter passages without hard-clipping the stronger peaks.
  const loudness = 1 - (1 - measuredLoudness) ** 1.8;
  for (let index = 0; index < half; index++) {
    const start = window.low * (window.high / window.low) ** (index / half);
    const end = window.low * (window.high / window.low) ** ((index + 1) / half);
    let value = 0;
    for (let bin = Math.floor(start); bin <= Math.ceil(end); bin++) value = Math.max(value, frequencies[bin] ?? 0);
    output[output.length - 1 - index] = value / peak;
  }
  // A small spatial shoulder connects each peak to its neighbours without
  // random oscillators. RMS gates the entire shape, including its baseline.
  for (let index = 0; index < half; index++) {
    const source = output.length - 1 - index;
    let value = output[source];
    for (let offset = -2; offset <= 2; offset++) {
      if (!offset || index + offset < 0 || index + offset >= half) continue;
      const weight = Math.abs(offset) === 1 ? 0.55 : 0.18;
      value = Math.max(value, output[source - offset] * weight);
    }
    output[index] = value;
  }
  for (let index = 0; index < half; index++) {
    const level = loudness * (0.04 + 0.96 * output[index] ** 0.9);
    output[index] = level;
    output[output.length - 1 - index] = level;
  }
}

type Graph = {
  context: AudioContext;
  analyser: AnalyserNode;
  source?: MediaElementAudioSourceNode;
  data: Float32Array<ArrayBuffer>;
  levels: Float32Array;
  frequencies: Uint8Array<ArrayBuffer>;
  window: FrequencyWindow;
  users: Set<() => void>;
  cleanup?: ReturnType<typeof setTimeout>;
  disposed: boolean;
  failed: boolean;
};
const graphs = new WeakMap<HTMLMediaElement, Graph>();

/** The same media element can only be connected to Web Audio once. */
export function acquireAudioPreviewAnalyser(media: HTMLMediaElement, onUnavailable: () => void) {
  // Never capture an unsafe remote source: Web Audio would silence its native playback.
  if (classifyWebAudioMediaRoute(media).kind !== "web-audio") throw new Error("Audio analysis unavailable for this source");
  let graph = graphs.get(media);
  if (!graph) {
    const context = new AudioContext();
    try {
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.55;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -15;
      // Prepare a working output BEFORE capturing the media's native output.
      analyser.connect(context.destination);
      graph = { context, analyser, data: new Float32Array(analyser.fftSize),
        levels: new Float32Array(AUDIO_PREVIEW_BARS), frequencies: new Uint8Array(analyser.frequencyBinCount),
        window: { low: 0, high: 0 }, users: new Set(), disposed: false, failed: false };
      graphs.set(media, graph);
    } catch (error) {
      void context.close().catch(() => {});
      throw error;
    }
  }
  const owned = graph;
  clearTimeout(owned.cleanup);
  owned.users.add(onUnavailable);
  if (owned.failed) onUnavailable();
  let released = false;
  const resume = async () => {
    if (released || owned.disposed || owned.failed) return;
    try {
      if (owned.context.state !== "running") await owned.context.resume();
      // While autoplay activation is withheld, native playback stays untouched.
      if (released || owned.disposed || owned.source || owned.context.state !== "running") return;
      owned.source = owned.context.createMediaElementSource(media);
      owned.source.connect(owned.analyser);
    } catch {
      if (released || owned.disposed) return;
      // Preserve sound if attaching the analyser failed after capture.
      if (owned.source) {
        owned.source.disconnect();
        owned.source.connect(owned.context.destination);
      }
      owned.failed = true;
      owned.users.forEach(notify => notify());
    }
  };
  return {
    resume,
    read: () => {
      if (released || !owned.source || owned.failed || owned.context.state !== "running") return null;
      owned.analyser.getFloatTimeDomainData(owned.data);
      owned.analyser.getByteFrequencyData(owned.frequencies);
      spectrumLevels(owned.data, owned.frequencies, owned.context.sampleRate, owned.levels, owned.window);
      return owned.levels;
    },
    release: () => {
      if (released) return;
      released = true;
      owned.users.delete(onUnavailable);
      if (owned.users.size) return;
      // React StrictMode re-acquires synchronously; do not close its still-owned source.
      owned.cleanup = setTimeout(() => {
        if (owned.users.size) return;
        owned.disposed = true;
        if (owned.source) media.pause();
        owned.source?.disconnect();
        owned.analyser.disconnect();
        void owned.context.close().catch(() => {});
        graphs.delete(media);
      }, 0);
    },
  };
}
