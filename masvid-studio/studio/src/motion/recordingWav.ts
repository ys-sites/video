/** Normalize audio-only browser containers for the existing native media importer. */
export async function recordingWav(blob: Blob): Promise<Blob> {
  const context = new OfflineAudioContext(1, 1, 16000);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  if (!decoded.length || decoded.duration > 720) throw new Error('Recording is empty or exceeds the recording limit');
  const data = new ArrayBuffer(44 + decoded.length * 2), view = new DataView(data);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, decoded.sampleRate, true); view.setUint32(28, decoded.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, decoded.length * 2, true);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  for (let i = 0; i < decoded.length; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([data], { type: 'audio/wav' });
}
