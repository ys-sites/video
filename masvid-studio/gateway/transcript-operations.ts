import type { WorkspaceStore } from '../workspace.ts';
import { exportTranscript, parseTranscriptSubtitles } from '../shared/transcript.ts';
import { transcriptsFor } from './transcription.ts';

export async function transcriptOperation(store: WorkspaceStore, input: any) {
  const service = transcriptsFor(store);
  switch (input.command) {
    case 'models': return service.models();
    case 'sources': return service.sources(input.projectId);
    case 'list': return service.list(input.projectId);
    case 'get': return { document: await service.document(input.projectId, input.transcriptId) };
    case 'submit': return { job: await service.submit({ projectId: input.projectId, sourcePath: input.sourcePath, requestId: input.requestId, model: input.model, language: input.language, parameters: input.parameters }) };
    case 'status': return { job: await service.job(input.projectId, input.jobId) };
    case 'cancel': return { job: await service.cancel(input.projectId, input.jobId) };
    case 'import': {
      if (Boolean(input.segments) === (typeof input.subtitles === 'string')) throw new Error('Supply either segments or SRT/VTT subtitles');
      return { document: await service.import({ projectId: input.projectId, sourcePath: input.sourcePath, requestId: input.requestId, language: input.language,
        segments: input.segments ?? parseTranscriptSubtitles(input.subtitles) }) };
    }
    case 'update': return { document: await service.update({ projectId: input.projectId, transcriptId: input.transcriptId, requestId: input.requestId, expectedRevision: input.expectedTranscriptRevision, segments: input.segments }) };
    case 'export': {
      const doc = await service.document(input.projectId, input.transcriptId);
      const mapped = ['sourceStart', 'sourceEnd', 'timelineStart', 'playbackRate'].some(key => input[key] !== undefined);
      if (mapped) await service.assertSource(doc.source);
      return exportTranscript(doc, input.format, mapped ? input : undefined);
    }
    default: throw new Error('Unknown transcript command');
  }
}
