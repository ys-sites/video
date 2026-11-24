import { useEffect, useState } from 'react';
import { resampleWaveform } from './soundPresets';

const TARGET_BARS = 128;
const MAX_CONCURRENCY = 2;

const waveformCache = new Map<string, number[]>();
const inFlight = new Map<string, Promise<number[] | null>>();
let activeCount = 0;
const queue: Array<() => void> = [];

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeCount++;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeCount--;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (activeCount < MAX_CONCURRENCY) run();
    else queue.push(run);
  });
}

function getAudioContextCtor(): (typeof AudioContext) | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function computePeaksFromBuffer(audioBuffer: AudioBuffer, barCount = TARGET_BARS): number[] {
  const channelCount = Math.min(2, audioBuffer.numberOfChannels);
  if (channelCount === 0 || audioBuffer.length === 0) return [];
  const channels = Array.from({ length: channelCount }, (_, i) => audioBuffer.getChannelData(i));
  const length = audioBuffer.length;
  const raw: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const start = Math.floor((i * length) / barCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * length) / barCount));
    const step = Math.max(1, Math.floor((end - start) / 256));
    let sumSq = 0;
    let peak = 0;
    let samples = 0;
    for (let j = start; j < end && j < length; j += step) {
      let val = 0;
      for (let c = 0; c < channelCount; c++) val += Math.abs(channels[c][j]);
      val /= channelCount;
      sumSq += val * val;
      if (val > peak) peak = val;
      samples++;
    }
    const rms = samples > 0 ? Math.sqrt(sumSq / samples) : 0;
    raw.push(rms * 0.7 + peak * 0.3);
  }
  const maxVal = Math.max(...raw, 0.001);
  const normalized = raw.map(v => {
    const ratio = v / maxVal;
    return ratio < 0.045 ? 0 : Math.pow((ratio - 0.045) / 0.955, 0.88);
  });
  return normalized.map((v, i) => {
    const prev = i > 0 ? normalized[i - 1] : v;
    const next = i < normalized.length - 1 ? normalized[i + 1] : v;
    const smooth = prev * 0.16 + v * 0.68 + next * 0.16;
    return Math.max(6, Math.min(96, Math.round(6 + smooth * 90)));
  });
}

async function decodeWaveform(src: string): Promise<number[] | null> {
  if (waveformCache.has(src)) return waveformCache.get(src)!;
  const existing = inFlight.get(src);
  if (existing) return existing;
  const Ctor = getAudioContextCtor();
  if (!Ctor || typeof fetch !== 'function') return null;

  const promise = schedule(async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    let ctx: AudioContext | undefined;
    try {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) return null;
      ctx = new Ctor();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      const bars = computePeaksFromBuffer(decoded, TARGET_BARS);
      if (bars.length > 0) {
        waveformCache.set(src, bars);
        return bars;
      }
      return null;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
      if (ctx) void ctx.close().catch(() => {});
      inFlight.delete(src);
    }
  });
  inFlight.set(src, promise);
  return promise;
}

/**
 * Lazily decode real amplitude waveforms for legacy audio assets that were saved
 * before server-side probe waveforms existed, while using stored waveforms directly.
 */
export function useAudioWaveforms(
  items: readonly { id: string; src: string; stored?: readonly number[] }[],
  barCount = TARGET_BARS,
): ReadonlyMap<string, readonly number[]> {
  const [decoded, setDecoded] = useState<Map<string, number[]>>(() => {
    const initial = new Map<string, number[]>();
    for (const item of items) {
      if (item.stored?.length) initial.set(item.id, resampleWaveform(item.stored, barCount));
      else if (waveformCache.has(item.src)) initial.set(item.id, resampleWaveform(waveformCache.get(item.src)!, barCount));
    }
    return initial;
  });

  const signature = items.map(i => `${i.id}:${i.src}:${i.stored?.length ?? 0}`).join('|');

  useEffect(() => {
    let cancelled = false;
    const immediate = new Map<string, number[]>();
    const pending: { id: string; src: string }[] = [];

    for (const item of items) {
      if (item.stored?.length) {
        immediate.set(item.id, resampleWaveform(item.stored, barCount));
      } else if (waveformCache.has(item.src)) {
        immediate.set(item.id, resampleWaveform(waveformCache.get(item.src)!, barCount));
      } else {
        pending.push({ id: item.id, src: item.src });
      }
    }

    if (immediate.size > 0) {
      setDecoded(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, bars] of immediate) {
          if (!next.has(id)) { next.set(id, bars); changed = true; }
        }
        return changed ? next : prev;
      });
    }

    for (const item of pending) {
      void decodeWaveform(item.src).then(bars => {
        if (cancelled || !bars) return;
        const resampled = resampleWaveform(bars, barCount);
        setDecoded(prev => {
          const next = new Map(prev);
          next.set(item.id, resampled);
          return next;
        });
      });
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, barCount]);

  return decoded;
}
