import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fixture } from './fixtures.ts';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { TranscriptionService, transcriptsFor, closeTranscripts } from '../gateway/transcription.ts';
import { transcriptionParameters } from '../gateway/transcription-provider.ts';
import { exportTranscript, normalizeTranscript, parseTranscriptSubtitles, type TranscriptDocument } from '../shared/transcript.ts';
import { createCaptionSourceOperations } from '../shared/transcript-captions.ts';
import { exportCaptionSource } from '../shared/caption-export.ts';
import { parseHTML } from 'linkedom';
import * as htmlParser from '@hyperframes/parsers/html-attribute-spans';
import { Phase1Service } from '../phase1.ts';
import { validateInput, phase1Tools } from '../shared/phase1-tools.ts';
import type { Fetcher } from '../gateway/network.ts';

const { transcriptCaptionSource, captionTracks, updateCaptionTrackSource, manualCaptionSource, toggleCaptionSource } = createCaptionSourceOperations(htmlParser);

const api = (store: any) => new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
async function source(store: any, duration = 3, video = false) {
  const file = path.join(store.projectDirectory, video ? 'source.mp4' : 'source.wav');
  const args = video ? ['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'] : ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000'];
  const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', ...args, '-t', String(duration), '-y', file], store.directory, 30000);
  assert.equal(result.code, 0, result.stderr); return path.basename(file);
}
async function configure(service: TranscriptionService) {
  await service.connections.configure('openai', { apiKey: 'fixture-private-key', enabled: true });
  await service.connections.saveModel('openai', { modelId: 'fixture-asr', label: 'Fixture speech', kind: 'transcription', defaults: { response_format: 'verbose_json' } });
  await service.connections.setDefault('transcription', 'openai:fixture-asr');
}
const result = { text: 'Hello world.', words: [{ word: 'Hello', start: 0.1, end: 0.5 }, { word: 'world.', start: 0.5, end: 1 }], segments: [{ text: 'Hello world.', start: 0, end: 1.5, speaker: 'Speaker A' }] };
const document = (segments = normalizeTranscript(result)): TranscriptDocument => ({ id: '11111111-1111-4111-8111-111111111111', revision: 1, createdAt: 1, updatedAt: 1, source: { projectId: 'project', path: 'source.wav', sha256: 'hash', bytes: 100, duration: 3 }, segments, original: segments });

test('real timestamps, text-only results, diarization and subtitle interchange remain distinct', () => {
  const segments = normalizeTranscript(result, 600, 10);
  assert.equal(segments[0].start, 600); assert.equal(segments[0].words![0].start, 600.1); assert.equal(segments[0].speaker, 'Speaker A');
  const plain = document(normalizeTranscript({ text: 'Text only' }));
  assert.equal(plain.segments[0].start, undefined);
  assert.throws(() => exportTranscript(plain, 'srt'), /without timestamps/);
  assert.equal(exportTranscript(plain, 'txt').content, 'Text only\n');
  for (const format of ['srt', 'vtt'] as const) {
    const parsed = parseTranscriptSubtitles(exportTranscript(document(), format).content);
    assert.equal(parsed[0].text, 'Hello world.'); assert.equal(parsed[0].end, 1.5);
    const markup = 'Q&A: <3 if a < b, "&lt;" stays';
    assert.equal(parseTranscriptSubtitles(exportTranscript(document([{ id: 'markup', text: markup, start: 0, end: 1 }]), format).content)[0].text, markup);
  }
  assert.throws(() => normalizeTranscript({ segments: [{ text: 'Broken', start: 4, end: 3 }] }), /invalid segment/);
  assert.throws(() => transcriptionParameters('custom', { file: '/private/path' }), /Unsupported/);
  assert.equal(transcriptionParameters('gpt-transcribe').response_format, 'json');
  assert.equal(transcriptionParameters('gpt-4o-transcribe-diarize').chunking_strategy, 'auto');
});

test('audio/video transcription uses real WAV extraction, one paid request, persistence and deduplication', () => fixture(async store => {
  let calls = 0;
  const fetcher: Fetcher = async (url, init) => {
    calls++; assert.equal(String(url), 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-private-key');
    const form = await new Request(url, init).formData();
    assert.equal(form.get('model'), 'fixture-asr'); assert.deepEqual(form.getAll('timestamp_granularities[]'), ['word', 'segment']);
    const wav = form.get('file') as File; assert.equal(wav.type, 'audio/wav'); assert.equal(Buffer.from(await wav.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
    return Response.json(result);
  };
  const service = new TranscriptionService(store, { fetcher }); await configure(service);
  for (const video of [false, true]) {
    const sourcePath = await source(store, 3, video), input = { projectId: store.projectId, sourcePath, requestId: `transcribe-${video}` };
    const [a, b] = await Promise.all([service.submit(input), service.submit(input)]); assert.equal(a.id, b.id);
    await service.tick(); const job = await service.job(store.projectId, a.id); assert.equal(job.state, 'completed', job.error);
    const doc = await service.document(store.projectId, job.transcriptId!); assert.equal(doc.source.path, sourcePath); assert.equal(doc.segments[0].text, 'Hello world.');
    assert.equal((await new TranscriptionService(store).document(store.projectId, doc.id)).revision, 1);
    assert.equal((await service.submit(input)).id, a.id);
    await assert.rejects(service.submit({ ...input, language: 'en' }), /REQUEST_ID_CONFLICT/);
    assert.doesNotMatch(JSON.stringify(await service.list(store.projectId)), /fixture-private-key/);
    // Simulate the process losing the receipt after the job was persisted.
    await rm(path.join(service.root, 'requests'), { recursive: true });
    assert.equal((await service.submit(input)).id, a.id);
  }
  assert.equal(calls, 2); await service.close();
}));

test('chunk boundaries retain source-relative timing and do not replay completed requests', () => fixture(async store => {
  let calls = 0; const service = new TranscriptionService(store, { fetcher: async () => { calls++; return Response.json({ segments: [{ text: `Chunk ${calls}`, start: 0, end: 0.5 }] }); } });
  await configure(service); const sourcePath = await source(store, 601);
  const job = await service.submit({ projectId: store.projectId, sourcePath, requestId: 'long' });
  await service.tick(); const done = await service.job(store.projectId, job.id); assert.equal(done.state, 'completed', done.error); assert.equal(calls, 2);
  const doc = await service.document(store.projectId, done.transcriptId!); assert.equal(doc.segments[1].start, 600); assert.equal(doc.segments[1].end, 600.5);
  await service.tick(); assert.equal(calls, 2); await service.close();
}));

test('failures, queued cancellation, source changes and provider changes do not retry or leak secrets', () => fixture(async store => {
  let calls = 0; const service = new TranscriptionService(store, { fetcher: async () => { calls++; return new Response('fixture-private-key upstream details', { status: 401 }); } });
  await configure(service); const sourcePath = await source(store);
  const input = { projectId: store.projectId, sourcePath };
  const failed = await service.submit({ ...input, requestId: 'fail' }); await service.tick();
  assert.equal((await service.job(store.projectId, failed.id)).state, 'failed'); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(await service.list(store.projectId)), /fixture-private-key/);
  const cancelled = await service.submit({ ...input, requestId: 'cancel' }); await service.cancel(store.projectId, cancelled.id); await service.tick(); assert.equal(calls, 1);
  const stale = await service.submit({ ...input, requestId: 'stale' }); await writeFile(path.join(store.projectDirectory, sourcePath), 'replaced'); await service.tick(); assert.equal(calls, 1); assert.match((await service.job(store.projectId, stale.id)).error!, /SOURCE_CHANGED/);
  await source(store); const changed = await service.submit({ ...input, requestId: 'provider-changed' }); await service.connections.configure('openai', { apiKey: 'different-private-key' }); await service.tick(); assert.equal(calls, 1); assert.match((await service.job(store.projectId, changed.id)).error!, /Provider settings changed/);
  await service.close();
}));

test('public MCP imports, corrects and exports transcripts; applies captions atomically with native version history', () => fixture(async store => {
  const service = api(store), projectId = store.projectId, sourcePath = await source(store);
  const call = (transcript: any) => service.call('openmotion_assets_use', { action: 'transcript', transcript });
  const schema = phase1Tools.find(tool => tool.name === 'openmotion_assets_use')!.inputSchema;
  assert.throws(() => validateInput(schema, { action: 'transcript', transcript: { command: 'captions', projectId } }), /required/);
  const { document: doc } = await call({ command: 'import', projectId, sourcePath, requestId: 'import', subtitles: '1\n00:00:00,100 --> 00:00:01,500\nHello world.\n' });
  const update = { command: 'update', projectId, transcriptId: doc.id, requestId: 'correct', expectedTranscriptRevision: 1, segments: [{ ...doc.segments[0], text: '<script>Edited</script>' }] };
  const corrected = (await call(update)).document; assert.equal(corrected.revision, 2); assert.equal((await call(update)).document.revision, 2); assert.equal(corrected.original[0].text, 'Hello world.');
  await assert.rejects(call({ ...update, requestId: 'conflict' }), /TRANSCRIPT_CONFLICT/);
  const exported = await call({ command: 'export', projectId, transcriptId: doc.id, format: 'vtt' }); assert.match(exported.content, /WEBVTT/);
  let detail = await service.call('openmotion_get_project', { projectId });
  const command = { command: 'captions', projectId, transcriptId: doc.id, expectedTranscriptRevision: 2, compositionPath: 'index.html', timelineStart: 1, sourceStart: 0, sourceEnd: 3, playbackRate: 1, expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, requestId: 'captions' };
  const applied = await call(command); assert.equal(applied.captionCount, 1); assert.equal((await call(command)).replayed, true);
  const html = await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'); assert.match(html, /&lt;script&gt;Edited&lt;\/script&gt;/); assert.match(html, /data-start="1.1"/);
  await assert.rejects(call({ ...command, requestId: 'outdated' }), /VERSION_CONFLICT/);
  detail = await service.call('openmotion_get_project', { projectId });
  await call({ ...command, requestId: 'replace', expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId });
  assert.equal((await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8')).split(`openmotion-transcript:${doc.id}:start`).length, 2);
  const restored = await service.call('openmotion_restore_version', { projectId, requestId: 'restore', versionId: command.expectedVersionId, expectedRevision: (await service.call('openmotion_get_project', { projectId })).revision, expectedVersionId: (await service.call('openmotion_get_project', { projectId })).currentVersionId });
  assert.ok(restored.version); assert.doesNotMatch(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), /openmotion-transcript:/);
  await writeFile(path.join(store.projectDirectory, sourcePath), 'changed');
  detail = await service.call('openmotion_get_project', { projectId });
  await assert.rejects(call({ ...command, requestId: 'stale-source', expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId }), /SOURCE_CHANGED/);
  await closeTranscripts(store);
}));

test('caption placement clips to source ranges, scales playback timing and rejects untimed speech', () => {
  const html = '<html><body><div data-composition-id="main" data-duration="1" data-width="1920" data-height="1080"></div></body></html>';
  const changed = transcriptCaptionSource(html, document(), { sourceStart: 0.5, sourceEnd: 2, timelineStart: 4, playbackRate: 2 });
  assert.match(changed.content, /data-start="4" data-duration="0.5"/); assert.match(changed.content, /data-duration="4.5"/);
  assert.throws(() => transcriptCaptionSource(html, document([{ id: 'a', text: 'No times' }]), { sourceStart: 0, sourceEnd: 3, timelineStart: 0, playbackRate: 1 }), /real timestamps/);
});

test('active cancellation aborts the original request and restart never replays an interrupted paid job', () => fixture(async store => {
  let calls = 0, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const service = new TranscriptionService(store, { fetcher: async (_url, init) => {
    calls++; entered(); return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
  } });
  await configure(service); const sourcePath = await source(store), projectId = store.projectId;
  const job = await service.submit({ projectId, sourcePath, requestId: 'active-cancel' }); const work = service.tick(); await started;
  await service.cancel(projectId, job.id); await work; assert.equal((await service.job(projectId, job.id)).state, 'cancelled'); assert.equal(calls, 1);
  const interrupted = await service.submit({ projectId, sourcePath, requestId: 'interrupted' });
  const folder = path.join(service.root, 'jobs', interrupted.id);
  await writeFile(path.join(folder, 'audio.wav'), 'interrupted extracted audio');
  await writeFile(path.join(folder, 'chunk-0.json'), JSON.stringify(result));
  await writeFile(path.join(folder, 'job.json'), JSON.stringify({ ...interrupted, state: 'running', workerPid: 99999999 }));
  await service.tick(); assert.equal((await service.job(projectId, interrupted.id)).state, 'failed'); assert.equal(calls, 1);
  for (const file of ['source', 'audio.wav']) await assert.rejects(readFile(path.join(folder, file)), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'chunk-0.json'), 'utf8')), result);
  await service.tick(); assert.equal(calls, 1);
  await service.close();
}));

test('ASR model discovery, defaults and custom protocols use the existing provider settings authority', () => fixture(async store => {
  const service = new TranscriptionService(store, { fetcher: async () => Response.json({ data: [{ id: 'gpt-transcribe' }, { id: 'whisper-1' }, { id: 'tts-1' }, { id: 'unknown-asr' }] }) });
  await configure(service); await service.connections.sync('openai');
  const models = await service.connections.models(); assert.equal(models.find(m => m.modelId === 'gpt-transcribe')?.kind, 'transcription');
  assert.equal(models.find(m => m.modelId === 'unknown-asr')?.kind, 'text');
  assert(!models.filter(m => m.kind === 'transcription').some(m => m.modelId === 'tts-1'));
  await assert.rejects(service.connections.saveModel('anthropic', { modelId: 'asr', label: 'Invalid', kind: 'transcription' }), /OpenAI-compatible/);
  await service.connections.configure('openai', { enabled: false }); assert.equal((await service.models()).models.length, 0);
  await service.close();
}));

test('subtitle parser accepts WebVTT short timestamps but rejects malformed cues instead of dropping them', () => {
  assert.equal(parseTranscriptSubtitles('WEBVTT\n\n00:01.000 --> 00:02.500\nHello')[0].end, 2.5);
  // Voice, style and karaoke tags from other tools' WebVTT are not spoken text; an escaped "<" still is.
  assert.equal(parseTranscriptSubtitles('WEBVTT\n\n00:01.000 --> 00:02.500\n<v Alice> Hello <i>there</i>, <00:01.800><c.loud>a &lt; b</c></v>')[0].text, 'Hello there, a < b');
  assert.equal(parseTranscriptSubtitles('1\n00:00:01,000 --> 00:00:02,500\n<i>Hello</i>')[0].text, '<i>Hello</i>');
  // A "<" that opens no WebVTT tag is text, and a cue of tags alone is left out without failing the file.
  assert.equal(parseTranscriptSubtitles('WEBVTT\n\n00:01.000 --> 00:02.500\nprice < 10 and size > 5, <b>ok</b>')[0].text, 'price < 10 and size > 5, ok');
  assert.deepEqual(parseTranscriptSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n\n00:02.000 --> 00:03.000\n<v Bob></v>\n\n00:03.000 --> 00:04.000\nWorld').map(cue => cue.text), ['Hello', 'World']);
  // A "<b " that never closes stays text up to the next tag, and a cue full of them is read once, not once per "<b ".
  assert.equal(parseTranscriptSubtitles('WEBVTT\n\n00:01.000 --> 00:02.500\na <b and <i>so</i> on')[0].text, 'a <b and so on');
  const started = Date.now();
  assert.throws(() => parseTranscriptSubtitles(`WEBVTT\n\n00:01.000 --> 00:02.500\n${'<b '.repeat(600_000)}`), /Invalid transcript text/);
  assert.ok(Date.now() - started < 5000, 'unclosed cue tags must not be rescanned from each one');
  assert.throws(() => parseTranscriptSubtitles('1\n00:99:00,000 --> 01:00:00,000\nBroken'), /Invalid subtitle timestamp/);
  assert.throws(() => parseTranscriptSubtitles('1\n00:00:01,000 --> 00:00:02,000\nGood\n\n2\nbad --> time\nBroken'), /Invalid subtitle cue/);
});

test('edited-video sidecars reuse the caption clock for trim, placement and speed', () => {
  const doc = document([{ id: 'cue', text: 'Mapped speech', start: 0, end: 2 }]);
  const placement = { sourceStart: 1, sourceEnd: 2, timelineStart: 5, playbackRate: 2 };
  const cues = parseTranscriptSubtitles(exportTranscript(doc, 'srt', placement).content);
  assert.equal(cues[0].start, 5); assert.equal(cues[0].end, 5.5);
  const native = transcriptCaptionSource('<div data-composition-id="main" data-duration="6"></div>', doc, placement).content;
  assert.match(native, /data-start="5" data-duration="0.5"/);
  assert.throws(() => exportTranscript(doc, 'json', placement), /SRT or VTT/);
  assert.throws(() => exportTranscript(doc, 'srt', { ...placement, sourceEnd: undefined as any }), /Invalid caption placement/);
});

test('caption styles and visibility preserve edited timing, content and track identity', async () => {
  const base = '<div data-composition-id="main" data-duration="9" data-width="640" data-height="360"><audio data-track-index="2"></audio></div>';
  const doc = document(); doc.language = 'English & Chinese';
  let html = transcriptCaptionSource(base, doc, { sourceStart: 0, sourceEnd: 3, timelineStart: 4, playbackRate: 1 }).content;
  html = html.replace('data-start="4"', 'data-start="5"').replace('Hello world.</div>', 'Native edit &amp; correction</div>');
  const track = captionTracks(html)[0]; assert.equal(track.label, 'English & Chinese'); assert.equal(track.track, 0);
  const styled = updateCaptionTrackSource(html, doc.id, { preset: 'card', position: 'top', scale: 1.25, visible: false }).content;
  assert.match(styled, /data-start="5"/); assert.match(styled, /Native edit &amp; correction/); assert.match(styled, /data-hidden/); assert.match(styled, /top:8%/);
  assert.deepEqual(captionTracks(styled)[0].settings, { preset: 'card', position: 'top', scale: 1.25, visible: false, pacing: 'sentence' });
  const visible = updateCaptionTrackSource(styled, doc.id, { visible: true }).content;
  assert.doesNotMatch(visible, /data-hidden/); assert.doesNotMatch(visible, /&amp;amp;/); assert.equal(captionTracks(visible)[0].track, 0);
  assert.throws(() => updateCaptionTrackSource(styled.replace('class="clip"', 'class="clip" data-timeline-locked'), doc.id, { visible: true }), /Unlock/);
  assert.throws(() => updateCaptionTrackSource(styled, doc.id, { scale: 0 }), /Invalid caption/);
  const removed = updateCaptionTrackSource(styled, doc.id, {}, true).content;
  assert.deepEqual(captionTracks(removed), []); assert.match(removed, /<audio data-track-index="3">/);
});

test('word highlight uses supplied word clocks, keeps punctuation and refuses missing alignment', () => {
  const html = '<div data-composition-id="main" data-duration="6"></div>';
  const placement = { sourceStart: 0, sourceEnd: 3, timelineStart: 4, playbackRate: 2 };
  const result = transcriptCaptionSource(html, document(), placement, { pacing: 'word' });
  assert.equal(result.count, 2); assert.match(result.content, /data-start="4" data-duration="0.25"/);
  assert.match(result.content, /data-start="4.25" data-duration="0.5"/);
  assert.match(result.content, /<span style="color:var\(--caption-highlight\)">Hello<\/span> world\./);
  assert.match(result.content, /Hello <span style="color:var\(--caption-highlight\)">world\.<\/span>/);
  const missing = document([{ id: 'missing', text: 'A sentence.', start: 0, end: 1 }]);
  assert.throws(() => transcriptCaptionSource(html, missing, placement, { pacing: 'word' }), /real word timestamps/);
  const mismatch = document(); mismatch.segments[0].text = 'Changed words';
  assert.throws(() => transcriptCaptionSource(html, mismatch, placement, { pacing: 'word' }), /do not match/);
});

test('word highlight cues still meet after a playback rate moves them off whole milliseconds', () => {
  const html = '<div data-composition-id="main" data-duration="6"></div>';
  const starts = [0, 0.32, 0.64, 1.02, 1.5, 2];
  const words = ['The', 'quick', 'brown', 'fox', 'jumps'].map((text, i) => ({ text, start: starts[i], end: starts[i + 1] }));
  const spoken = document([{ id: 'segment-1', text: 'The quick brown fox jumps', start: 0, end: 2, words }]);
  const result = transcriptCaptionSource(html, spoken, { sourceStart: 0, sourceEnd: 3, timelineStart: 0, playbackRate: 1.5 }, { pacing: 'word' });
  const cues = [...result.content.matchAll(/data-start="([\d.]+)" data-duration="([\d.]+)"/g)].map(match => ({ start: Number(match[1]), length: Number(match[2]) }));
  assert.equal(cues.length, 5);
  // 0.64 / 1.5 = 0.42667: the second cue has to end on 0.427 where the third begins, not on 0.213 + 0.213.
  for (let i = 1; i < cues.length; i++) assert.equal(Math.round((cues[i - 1].start + cues[i - 1].length) * 1000), Math.round(cues[i].start * 1000));
  const srt = exportCaptionSource(result.content, 'srt', parseHTML);
  assert.equal(srt.content, '1\n00:00:00,000 --> 00:00:01,333\nThe quick brown fox jumps\n');
});

test('public caption track controls share revision guards, request replay and reversible native history', () => fixture(async store => {
  const service = api(store), projectId = store.projectId, sourcePath = await source(store);
  const call = (transcript: any) => service.call('openmotion_assets_use', { action: 'transcript', transcript });
  const { document: doc } = await call({ command: 'import', projectId, sourcePath, requestId: 'caption-doc', segments: document().segments });
  let current = await service.call('openmotion_get_project', { projectId });
  await call({ command: 'captions', projectId, transcriptId: doc.id, expectedTranscriptRevision: doc.revision, compositionPath: 'index.html', timelineStart: 0, sourceStart: 0, sourceEnd: 3, playbackRate: 1, expectedRevision: current.revision, expectedVersionId: current.currentVersionId, requestId: 'styled-caption', captionSettings: { preset: 'outline', pacing: 'word' } });
  let list = await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' }); assert.equal(list.tracks[0].settings.preset, 'outline'); assert.equal(list.tracks[0].cueCount, 2);
  current = await service.call('openmotion_get_project', { projectId });
  const input = { command: 'caption_update', projectId, compositionPath: 'index.html', transcriptId: doc.id, expectedRevision: current.revision, expectedVersionId: current.currentVersionId, requestId: 'hide-caption', captionSettings: { visible: false } };
  await call(input); assert.equal((await call(input)).replayed, true);
  await assert.rejects(call({ ...input, requestId: 'stale-visibility', captionSettings: { visible: true } }), /VERSION_CONFLICT/);
  list = await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' }); assert.equal(list.tracks[0].settings.visible, false);
  current = await service.call('openmotion_get_project', { projectId });
  await call({ ...input, requestId: 'remove-caption', expectedRevision: current.revision, expectedVersionId: current.currentVersionId, remove: true });
  assert.deepEqual((await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' })).tracks, []);
  const after = await service.call('openmotion_get_project', { projectId });
  await service.call('openmotion_restore_version', { projectId, requestId: 'restore-caption', versionId: current.currentVersionId, expectedRevision: after.revision, expectedVersionId: after.currentVersionId });
  assert.equal((await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' })).tracks.length, 1);
  await closeTranscripts(store);
}));

test('manual text and subtitle import need no media or model and retain native history guards', () => fixture(async store => {
  const service = api(store), projectId = store.projectId;
  const call = (transcript: any) => service.call('openmotion_assets_use', { action: 'transcript', transcript });
  let detail = await service.call('openmotion_get_project', { projectId });
  const input = { command: 'caption_add', textKind: 'text', projectId, compositionPath: 'index.html', timelineStart: 2,
    segments: [{ id: 'manual', text: '<b>My title</b>', start: 0, end: 3 }], expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, requestId: 'manual-text' };
  const added = await call(input); assert.equal(added.captionCount, 1); assert.equal((await call(input)).replayed, true);
  let html = await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8');
  assert.match(html, /data-timeline-role="text"/); assert.match(html, /data-start="2"/); assert.match(html, /&lt;b&gt;My title&lt;\/b&gt;/);
  assert.equal((await call(input)).trackId, added.trackId);
  assert.match(added.trackId, /^[a-f0-9-]{36}$/);
  assert.equal((await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' })).tracks[0].kind, 'text');
  await assert.rejects(call({ ...input, requestId: 'stale-text' }), /CONFLICT/);
  detail = await service.call('openmotion_get_project', { projectId });
  const imported = await call({ command: 'caption_add', projectId, compositionPath: 'index.html', timelineStart: 1, subtitles: '1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond\n', expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, requestId: 'standalone-srt' });
  assert.equal(imported.captionCount, 2);
  const tracks = (await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' })).tracks;
  assert.equal(tracks.length, 2); assert.equal(tracks[0].cueCount, 2); assert.equal(tracks[0].id, imported.trackId); assert.equal(tracks[1].id, added.trackId);
  html = await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'); assert.match(html, /data-start="1"/);
  detail = await service.call('openmotion_get_project', { projectId });
  await assert.rejects(call({ ...input, expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, requestId: 'invalid-time', segments: [{ id: 'bad', text: 'Bad', start: 2, end: 1 }] }), /valid/);
  assert.equal(await readFile(path.join(store.projectDirectory, 'index.html'), 'utf8'), html);
}));

test('legacy managed text participates in caption controls without changing its native role or cues', async () => {
  const id = '18d41022-bca4-4cd1-9417-5440ff0a6473';
  const original = '<div data-composition-id="main" data-duration="10" data-width="1920" data-height="1080"><p id="user-title">Keep custom artwork</p></div>';
  const generated = manualCaptionSource(original, id, { textKind: 'text', timelineStart: 2, segments: [{ id: 'one', text: 'Keep my title', start: 0, end: 3 }] }).content;
  const legacy = generated.replace(/ data-caption-[\w-]+="[^"]*"/g, '');
  const [track] = captionTracks(legacy);
  assert.equal(captionTracks(legacy).length, 1);
  assert.equal(track.id, id); assert.equal(track.kind, 'text');
  assert.equal(track.settings.preset, 'clean'); assert.equal(track.settings.position, 'center');
  const hidden = updateCaptionTrackSource(legacy, id, { visible: false }).content;
  assert.equal(captionTracks(hidden)[0].settings.visible, false);
  const styled = updateCaptionTrackSource(hidden, id, { preset: 'card' }).content;
  assert.match(styled, /data-timeline-role="text"/); assert.match(styled, /data-start="2" data-duration="3"/);
  assert.match(styled, /Keep my title/); assert.match(styled, /<p id="user-title">Keep custom artwork<\/p>/);
  assert.throws(() => updateCaptionTrackSource(styled.replace('class="clip"', 'class="clip" data-timeline-locked'), id, { visible: true }), /Unlock/);
  const removed = updateCaptionTrackSource(styled, id, {}, true).content;
  assert.equal(captionTracks(removed).length, 0); assert.match(removed, /Keep custom artwork/);
});


test('caption on/off reserves one empty native lane, fills it, and preserves text and locks', () => {
  const base = '<div id="main" data-composition-id="main" data-duration="8" data-width="640" data-height="360"><video class="clip" data-start="0" data-duration="8" data-track-index="0"></video></div>';
  const first = toggleCaptionSource(base, '11111111-1111-4111-8111-111111111111', true);
  assert.equal(captionTracks(first.content).length, 1); assert.equal(captionTracks(first.content)[0].cueCount, 0);
  assert.match(first.content, /data-timeline-role="caption-empty"/); assert.match(first.content, /data-track-index="1"/);
  const off = toggleCaptionSource(first.content, 'unused', false);
  assert.equal(captionTracks(off.content)[0].settings.visible, false);
  const on = toggleCaptionSource(off.content, 'unused', true);
  assert.equal(captionTracks(on.content).length, 1); assert.equal(captionTracks(on.content)[0].id, first.trackId);
  const styled = updateCaptionTrackSource(on.content, first.trackId!, { preset: 'card', position: 'top' });
  const filled = manualCaptionSource(styled.content + `<script>const note = '${first.trackId}';</script>`, '22222222-2222-4222-8222-222222222222', { segments: [{ id: 'one', text: 'Confirmed caption', start: 1, end: 3 }] });
  assert.equal(captionTracks(filled.content).length, 1); assert.equal(captionTracks(filled.content)[0].track, 0);
  assert.doesNotMatch(filled.content, /caption-empty/); assert.match(filled.content, /data-track-index="1"/);
  assert.ok(filled.content.includes(`const note = '${first.trackId}'`));
  assert.equal(captionTracks(filled.content)[0].settings.preset, 'card'); assert.equal(captionTracks(filled.content)[0].settings.position, 'top');
  const title = manualCaptionSource(filled.content, '33333333-3333-4333-8333-333333333333', { textKind: 'text', segments: [{ id: 'title', text: 'Keep title', start: 0, end: 4 }] });
  const hidden = toggleCaptionSource(title.content, 'unused', false);
  assert.equal(captionTracks(hidden.content).find(track => track.kind === 'text')!.settings.visible, true);
  assert.equal(captionTracks(hidden.content).find(track => track.kind === 'caption')!.settings.visible, false);
  const locked = first.content.replace('data-timeline-role="caption-empty"', 'data-timeline-role="caption-empty" data-timeline-locked');
  assert.throws(() => toggleCaptionSource(locked, 'unused', false), /Unlock/);
});

test('public caption toggle is replay-safe, revision guarded and reversible', () => fixture(async store => {
  const service = api(store), projectId = store.projectId;
  const call = (transcript: any) => service.call('openmotion_assets_use', { action: 'transcript', transcript });
  const before = await service.call('openmotion_get_project', { projectId });
  const input = { command: 'caption_toggle', projectId, compositionPath: 'index.html', visible: true, requestId: 'enable-captions', expectedRevision: before.revision, expectedVersionId: before.currentVersionId };
  const enabled = await call(input); assert.equal(enabled.captionCount, 0); assert.equal((await call(input)).replayed, true);
  assert.equal((await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' })).tracks.length, 1);
  await assert.rejects(call({ ...input, visible: false, requestId: 'stale-toggle' }), /VERSION_CONFLICT/);
  const current = await service.call('openmotion_get_project', { projectId });
  await service.call('openmotion_restore_version', { projectId, requestId: 'restore-no-captions', versionId: before.currentVersionId, expectedRevision: current.revision, expectedVersionId: current.currentVersionId });
  assert.equal((await call({ command: 'caption_tracks', projectId, compositionPath: 'index.html' })).tracks.length, 0);
}));
