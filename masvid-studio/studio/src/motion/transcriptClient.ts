import type { TranscriptDocument, TranscriptionJob } from '../../../shared/transcript';
import { assetRequest } from './assetClient';
export type TranscriptSummary = Omit<TranscriptDocument, 'segments' | 'original'> & { segmentCount: number };
export type TranscriptList = { documents: TranscriptSummary[]; jobs: TranscriptionJob[] };
export const transcriptRequest = <T,>(input: Record<string, unknown>) => assetRequest<T>({ action: 'transcript', transcript: input });
export function downloadTranscript(content: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
