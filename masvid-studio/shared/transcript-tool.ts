const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string', minLength: 1, maxLength: 4096 };
const time = { type: 'number', minimum: 0, maximum: 86400 };
const revision = { type: 'integer', minimum: 1 };
const word = object({ text: string, start: time, end: time }, ['text', 'start', 'end']);
const segment = object({ id: { type: 'string', pattern: '^[\\w-]{1,100}$' }, text: { type: 'string', minLength: 1, maxLength: 20000 }, start: time, end: time, speaker: { type: 'string', maxLength: 100 }, words: { type: 'array', items: word, maxItems: 5000 } }, ['id', 'text']);
const captionSettings = object({ preset: { enum: ['bar', 'clean', 'outline', 'yellow', 'card', 'cinema'] }, position: { enum: ['bottom', 'center', 'top'] }, scale: { type: 'number', minimum: 0.5, maximum: 2 }, pacing: { enum: ['sentence', 'word'] }, visible: { type: 'boolean' } });
export const transcriptToolArguments = {
  ...object({
    command: { enum: ['models', 'sources', 'list', 'get', 'submit', 'status', 'cancel', 'import', 'update', 'export', 'captions', 'caption_tracks', 'caption_export', 'caption_update', 'caption_add', 'caption_toggle'] },
    projectId: string, sourcePath: string, transcriptId: string, jobId: string,
    requestId: { type: 'string', pattern: '^[\\w-]{1,100}$' },
    model: string, language: { type: 'string', maxLength: 35 }, parameters: { type: 'object', additionalProperties: true },
    expectedTranscriptRevision: revision, expectedRevision: string, expectedVersionId: string,
    segments: { type: 'array', items: segment, maxItems: 20000 },
    subtitles: { type: 'string', maxLength: 2000000 }, format: { enum: ['txt', 'srt', 'vtt', 'json'] },
    compositionPath: string, timelineStart: time, sourceStart: time, sourceEnd: time,
    playbackRate: { type: 'number', minimum: 0.1, maximum: 8 },
    visible: { type: 'boolean' }, captionSettings, remove: { type: 'boolean' }, textKind: { enum: ['text', 'caption'] },
  }, ['command']),
  oneOf: Object.entries({ models: [], sources: ['projectId'], list: ['projectId'], get: ['projectId', 'transcriptId'],
    submit: ['projectId', 'sourcePath', 'requestId'], status: ['projectId', 'jobId'], cancel: ['projectId', 'jobId'],
    import: ['projectId', 'sourcePath', 'requestId'], update: ['projectId', 'transcriptId', 'expectedTranscriptRevision', 'segments', 'requestId'],
    export: ['projectId', 'transcriptId', 'format'],
    captions: ['projectId', 'transcriptId', 'expectedTranscriptRevision', 'compositionPath', 'timelineStart', 'sourceStart', 'sourceEnd', 'playbackRate', 'expectedRevision', 'expectedVersionId', 'requestId'],
    caption_tracks: ['projectId', 'compositionPath'],
    caption_export: ['projectId', 'compositionPath', 'format'],
    caption_update: ['projectId', 'transcriptId', 'compositionPath', 'expectedRevision', 'expectedVersionId', 'requestId'],
    caption_toggle: ['projectId', 'compositionPath', 'visible', 'expectedRevision', 'expectedVersionId', 'requestId'],
    caption_add: ['projectId', 'compositionPath', 'expectedRevision', 'expectedVersionId', 'requestId'],
  }).map(([command, required]) => ({ type: 'object', properties: { command: { enum: [command] } }, required, additionalProperties: true })),
};

export const transcriptToolDescription = ' action=transcript takes a transcript command. models discovers configured OpenAI-compatible ASR models; sources lists project media; submit creates a persistent transcription job with explicit projectId/sourcePath and stable requestId. Poll status; never automatically resubmit a paid request. list/get expose source-relative segments, optional real word timestamps and speaker labels. cancel stops local work without promising remote billing cancellation. import accepts segments or SRT/VTT subtitles; update requires expectedTranscriptRevision and preserves the original. export returns TXT/SRT/VTT/JSON content; SRT/VTT optionally accept all four placement fields sourceStart/sourceEnd/timelineStart/playbackRate to match the edited output instead of the original source. captions atomically adds or replaces this transcript’s editable subtitle layer in compositionPath through project version history; requires explicit sourceStart/sourceEnd, timelineStart and playbackRate, expectedTranscriptRevision, expectedRevision and expectedVersionId. caption_add creates editable manual text (textKind=text) or caption clips (textKind=caption, default) without media or a model, from either explicitly timed segments or SRT/VTT subtitles. timelineStart offsets their timing; requires compositionPath, expectedRevision, expectedVersionId and stable requestId. Select clips to edit text, trim, split or move using native editing. caption_add and captions return trackId for follow-up selection and edits. caption_toggle atomically sets visible for all caption tracks (not text tracks); first enabling creates an empty native caption lane, later additions fill it, and disabling preserves content. Requires visible, compositionPath, expectedRevision, expectedVersionId and requestId; respects locks. caption_tracks lists managed text and caption tracks in compositionPath, including kind=text|caption, identity, settings, cue count and lock state. caption_export returns SRT or VTT content from saved visible native captions in compositionPath, including manual text edits, splits and trims; optional transcriptId selects one managed track (including legacy text). Without it, all visible caption tracks are combined. Hidden cues are omitted and no ASR model is needed. Nested independent scenes must be exported from their own composition. caption_update changes captionSettings (preset, position, scale, visible) or removes a managed track with remove=true; requires transcriptId as the track identity, expectedRevision, expectedVersionId and requestId. It preserves authored cue timing and text, respects locks and uses the same native history. captions also accepts captionSettings, including sentence or word pacing; word highlighting requires real ordered word timestamps that still match the text. Timed operations reject text-only results; timings are never fabricated. Re-transcribe changed media. Use corrected transcripts to plan edits; transcript text changes do not cut media. Agents can translate segments while preserving timing, import each language as a separate transcript, duplicate projects and export platform versions with the existing project/edit/export tools.';
