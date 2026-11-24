// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acquireAudioPreviewAnalyser, AUDIO_PREVIEW_BARS, spectrumLevels } from "./audioPreviewAnalyser";

let contexts: FakeContext[];
class FakeContext {
  state = "running";
  sampleRate = 48000;
  destination = {};
  analyser = { frequencyBinCount: 1024, fftSize: 0, smoothingTimeConstant: 0,
    minDecibels: 0, maxDecibels: 0, connect: vi.fn(), disconnect: vi.fn(),
    getByteFrequencyData: vi.fn((data: Uint8Array) => data.fill(128)),
    getFloatTimeDomainData: vi.fn((data: Float32Array) => data.fill(0.25)) };
  source = { connect: vi.fn(), disconnect: vi.fn() };
  createAnalyser = vi.fn(() => this.analyser);
  createMediaElementSource = vi.fn(() => this.source);
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  constructor() { contexts.push(this); }
}
function audio() {
  const element = document.createElement("audio");
  element.src = "/audio.mp4";
  vi.spyOn(element, "pause").mockImplementation(() => {});
  return element;
}
beforeEach(() => {
  contexts = [];
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeContext);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reads measured amplitudes and preserves a single audible output", async () => {
  const media = audio();
  const lease = acquireAudioPreviewAnalyser(media, vi.fn());
  await lease.resume();
  const context = contexts[0];
  expect(context.source.connect).toHaveBeenCalledWith(context.analyser);
  expect(context.analyser.connect).toHaveBeenCalledWith(context.destination);
  expect(context.analyser.connect.mock.invocationCallOrder[0]).toBeLessThan(context.createMediaElementSource.mock.invocationCallOrder[0]);
  expect(lease.read()![20]).toBeGreaterThan(0.9);
  expect(lease.read()![20]).toBeLessThanOrEqual(1);
  context.analyser.getFloatTimeDomainData.mockImplementation(data => data.fill(0));
  expect(Array.from(lease.read()!)).toEqual(Array(AUDIO_PREVIEW_BARS).fill(0));
  lease.release();
  vi.runOnlyPendingTimers();
  expect(context.close).toHaveBeenCalledOnce();
  expect(media.pause).toHaveBeenCalledOnce();
});

it("waits for a running context before touching native playback", async () => {
  const lease = acquireAudioPreviewAnalyser(audio(), vi.fn());
  const context = contexts[0];
  context.state = "suspended";
  let wake!: () => void;
  context.resume.mockImplementation(() => new Promise<void>(resolve => { wake = resolve; }));
  const ready = lease.resume();
  expect(context.createMediaElementSource).not.toHaveBeenCalled();
  expect(lease.read()).toBeNull();
  context.state = "running";
  wake();
  await ready;
  expect(context.createMediaElementSource).toHaveBeenCalledOnce();
  lease.release();
});

it("never captures media after a pending resume is released", async () => {
  const lease = acquireAudioPreviewAnalyser(audio(), vi.fn());
  const context = contexts[0];
  context.state = "suspended";
  let wake!: () => void;
  context.resume.mockImplementation(() => new Promise<void>(resolve => { wake = resolve; }));
  const ready = lease.resume();
  lease.release();
  vi.runOnlyPendingTimers();
  wake();
  await ready;
  expect(context.createMediaElementSource).not.toHaveBeenCalled();
});

it("reuses the original graph across StrictMode effect replay", async () => {
  const media = audio();
  const first = acquireAudioPreviewAnalyser(media, vi.fn());
  await first.resume();
  first.release();
  const next = acquireAudioPreviewAnalyser(media, vi.fn());
  vi.runOnlyPendingTimers();
  await next.resume();
  expect(contexts).toHaveLength(1);
  expect(contexts[0].close).not.toHaveBeenCalled();
  expect(contexts[0].createMediaElementSource).toHaveBeenCalledOnce();
  next.release();
});

it("leaves unsafe cross-origin audio on native playback", () => {
  const media = audio();
  media.src = "https://unrelated.example/audio.mp3";
  expect(() => acquireAudioPreviewAnalyser(media, vi.fn())).toThrow();
  expect(contexts).toHaveLength(0);
  expect(media.pause).not.toHaveBeenCalled();
});

it("bypasses a failed analyser connection while preserving sound", async () => {
  const notify = vi.fn();
  const lease = acquireAudioPreviewAnalyser(audio(), notify);
  contexts[0].source.connect.mockImplementationOnce(() => { throw new Error("Cannot connect"); });
  await lease.resume();
  expect(contexts[0].source.connect).toHaveBeenLastCalledWith(contexts[0].destination);
  expect(notify).toHaveBeenCalledOnce();
  expect(lease.read()).toBeNull();
  lease.release();
});

it("mirrors measured spectral peaks while retaining loudness and silence", () => {
  const samples = new Float32Array(4096).fill(0.2);
  const frequencies = new Uint8Array(2048);
  frequencies[40] = 220;
  frequencies[110] = 160;
  const loud = new Float32Array(AUDIO_PREVIEW_BARS);
  const quiet = new Float32Array(AUDIO_PREVIEW_BARS);
  spectrumLevels(samples, frequencies, 48000, loud, { low: 0, high: 0 });
  spectrumLevels(samples.map(value => value * 0.1), frequencies, 48000, quiet, { low: 0, high: 0 });
  expect(Array.from(loud)).toEqual(Array.from(loud).reverse());
  expect(loud.every(value => value >= 0 && value <= 1)).toBe(true);
  expect(quiet.every((value, index) => value < loud[index])).toBe(true);
  expect(Math.max(...loud) - Math.min(...loud)).toBeGreaterThan(0.4);
  spectrumLevels(new Float32Array(4096), frequencies, 48000, quiet, { low: 0, high: 0 });
  expect(quiet.every(value => value === 0)).toBe(true);
});

it("fits a narrow-band source and moves the display when its frequency changes", () => {
  const samples = new Float32Array(4096).fill(0.2);
  const frequencies = new Uint8Array(2048);
  const levels = new Float32Array(AUDIO_PREVIEW_BARS);
  const range = { low: 0, high: 0 };
  frequencies[40] = 240;
  spectrumLevels(samples, frequencies, 48000, levels, range);
  expect(range.low).toBeLessThan(40);
  expect(range.high).toBeGreaterThan(40);
  expect(range.high - range.low).toBeLessThan(30);
  const before = Array.from(levels);
  frequencies[100] = 220;
  spectrumLevels(samples, frequencies, 48000, levels, range);
  expect(range.high).toBeGreaterThan(100);
  expect(Array.from(levels)).not.toEqual(before);
  frequencies.fill(0);
  spectrumLevels(samples, frequencies, 48000, levels, range);
  expect(levels.every(value => value === 0)).toBe(true);
});
