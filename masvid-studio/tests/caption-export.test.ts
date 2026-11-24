import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { exportCaptionSource } from '../shared/caption-export.ts';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';

const root = (cues: string) => `<html><body><div data-composition-id="main" data-duration="6">${cues}</div></body></html>`;
const cue = (text: string, start: number, duration: number, attrs = '') => `<div data-caption-track="a" data-timeline-role="caption" data-start="${start}" data-duration="${duration}" ${attrs}>${text}</div>`;
test('exports saved caption text, timing, multiline entities, trim and hidden state', () => {
  const source = root(cue('Later', 4, 8) + cue('Edited &amp; <span>styled</span><br>line', 1, 2) + cue('Hidden', 0, 1, 'data-hidden') + cue('Title', 0, 1, 'data-timeline-role="text"').replace('data-timeline-role="caption"', ''));
  const result = exportCaptionSource(source, 'srt', parseHTML);
  assert.equal(result.cueCount, 2);
  assert.equal(result.content, '1\n00:00:01,000 --> 00:00:03,000\nEdited & styled\nline\n\n2\n00:00:04,000 --> 00:00:06,000\nLater\n');
  assert.match(exportCaptionSource(source, 'vtt', parseHTML).content, /^WEBVTT\n\n1\n00:00:01.000/);
});
test('WebVTT export escapes cue text that would otherwise read as markup; SRT stays plain', () => {
  const source = root(cue('Tom &amp; Jerry &lt;3 Q&amp;A', 0, 1) + cue('Use the &lt;video&gt; tag if a &lt; b --&gt; c', 1, 1));
  assert.equal(exportCaptionSource(source, 'vtt', parseHTML).content, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nTom &amp; Jerry &lt;3 Q&amp;A\n\n2\n00:00:01.000 --> 00:00:02.000\nUse the &lt;video&gt; tag if a &lt; b --&gt; c\n');
  assert.equal(exportCaptionSource(source, 'srt', parseHTML).content, '1\n00:00:00,000 --> 00:00:01,000\nTom & Jerry <3 Q&A\n\n2\n00:00:01,000 --> 00:00:02,000\nUse the <video> tag if a < b --> c\n');
});
test('coalesces highlighted sentence fragments but preserves gaps and overlapping tracks', () => {
  const result = exportCaptionSource(root(cue('<span>Word</span> one', 0, 1) + cue('Word <span>one</span>', 1, 1) + cue('Word one', 3, 1) + cue('Other', 0, 2).replace('track="a"', 'track="b"')), 'srt', parseHTML);
  assert.equal(result.cueCount, 3); // An overlapping track keeps its own cue.
  assert.equal(exportCaptionSource(root(cue('<span>Word</span> one', 0, 1) + cue('Word <span>one</span>', 1, 1)), 'srt', parseHTML).cueCount, 1);
});
test('rejects missing, empty and malformed cues and supports explicit legacy text selection', () => {
  assert.throws(() => exportCaptionSource(root(cue('Hidden', 0, 1, 'data-hidden')), 'srt', parseHTML), /No visible captions/);
  assert.throws(() => exportCaptionSource(root(cue('Broken', 0, 1).replace('data-start="0"', 'data-start="=other.end"')), 'srt', parseHTML), /timing is invalid/);
  assert.throws(() => exportCaptionSource(root(cue('Cue', 0, 1)), 'srt', parseHTML, 'missing'), /no longer exists/);
  const legacy = root(cue('Title', 0, 1).replace('role="caption"', 'role="text"'));
  assert.throws(() => exportCaptionSource(legacy, 'srt', parseHTML), /No visible captions/);
  assert.match(exportCaptionSource(legacy, 'srt', parseHTML, 'a').content, /Title/);
  const id = '11111111-1111-4111-8111-111111111111';
  assert.match(exportCaptionSource(legacy.replace('data-caption-track="a"', `id="text-${id}-cue"`), 'srt', parseHTML, id).content, /Title/);
});
test('public MCP exports manual captions without a transcript or a model and respects composition scope', () => fixture(async store => {
  const service = new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  const call = (transcript: object) => service.call('openmotion_assets_use', { action: 'transcript', transcript });
  const detail = await service.call('openmotion_get_project', { projectId: store.projectId });
  const added = await call({ command: 'caption_add', projectId: store.projectId, compositionPath: 'index.html', requestId: 'manual-export', expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, timelineStart: 2, segments: [{ id: 'first', text: 'Manual caption', start: 0, end: 2 }] });
  const input = { command: 'caption_export', projectId: store.projectId, compositionPath: 'index.html', format: 'srt' };
  const all = await call(input), one = await call({ ...input, transcriptId: added.trackId });
  assert.equal(all.content, one.content); assert.match(all.content, /00:00:02,000 --> 00:00:04,000\nManual caption/);
  assert.equal(all.projectId, store.projectId); assert.equal(all.compositionPath, 'index.html');
  await assert.rejects(call({ ...input, format: 'txt' }), /Choose SRT or VTT/);
  await assert.rejects(call({ ...input, compositionPath: '../outside.html' }));
}));
