import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { recordingWav } from './recordingWav';

const drafts = new Map<string, File>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const retain = (projectId: string, file?: File) => { if (file) drafts.set(projectId, file); else drafts.delete(projectId); listeners.forEach(listener => listener()); };

/** Capture locally. Recording is uploaded only by an explicit import action. */
export function useTranscriptRecorder(onError: (message: string) => void, projectId = 'project') {
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'encoding'>('idle');
  const file = useSyncExternalStore(subscribe, () => drafts.get(projectId) ?? null);
  const [seconds, setSeconds] = useState(0);
  const ref = useRef<{ alive: boolean; busy: boolean; request: number; recorder?: MediaRecorder; stream?: MediaStream; timer?: ReturnType<typeof setInterval> }>({ alive: true, busy: false, request: 0 });
  useEffect(() => { const current = ref.current; current.alive = true; return () => { current.alive = false; clearInterval(current.timer); if (current.recorder?.state === 'recording') current.recorder.stop(); current.stream?.getTracks().forEach(track => track.stop()); }; }, []);
  const stop = () => { if (!ref.current.recorder || ref.current.recorder.state === 'inactive') { ref.current.request++; ref.current.busy = false; setState('idle'); } if (ref.current.recorder?.state === 'recording') ref.current.recorder.stop(); ref.current.stream?.getTracks().forEach(track => track.stop()); };
  async function start() {
    const current = ref.current; if (current.busy) return;
    const request = ++current.request; current.busy = true; setState('requesting'); setSeconds(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable in this browser. Import an audio file instead.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current.alive || request !== current.request) { stream.getTracks().forEach(track => track.stop()); return; }
      current.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); current.recorder = recorder;
      const chunks: Blob[] = []; let bytes = 0; const started = Date.now();
      recorder.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes > 100_000_000) stop(); } };
      recorder.onerror = () => { if (current.alive) onError('Recording failed. Check microphone access and try again.'); stop(); };
      recorder.onstop = async () => {
        clearInterval(current.timer); stream.getTracks().forEach(track => track.stop());
        if (current.alive) setState('encoding');
        const type = recorder.mimeType || mimeType || 'audio/webm', ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const name = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        try {
          if (!chunks.length) throw new Error('No audio was recorded. Try recording again.');
          const wav = await recordingWav(new Blob(chunks, { type }));
          retain(projectId, new File([wav], `${name}.wav`, { type: wav.type }));
        } catch {
          if (chunks.length) retain(projectId, new File(chunks, `${name}.${ext}`, { type }));
          if (current.alive) onError('Could not prepare the recording for import. Download it to preserve the audio.');
        } finally { current.busy = false; if (current.alive) setState('idle'); }
      };
      recorder.start(1000); setState('recording');
      current.timer = setInterval(() => { if (current.alive) setSeconds(Math.floor((Date.now() - started) / 1000)); if (Date.now() - started >= 600_000) stop(); }, 250);
    } catch (error) {
      if (request !== current.request) return;
      current.stream?.getTracks().forEach(track => track.stop()); current.busy = false;
      if (current.alive) { setState('idle'); onError(error instanceof Error && error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow access or import an audio file.' : error instanceof Error ? error.message : 'Recording failed'); }
    }
  }
  return { state, file, seconds, start, stop, clear: () => retain(projectId) };
}
