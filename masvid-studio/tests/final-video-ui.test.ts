import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountFinalVideo } from '../web/final-video-component.js';

const work = { id: 'round', projectId: 'project', versionId: 'v4', jobId: 'job', sha256: 'a'.repeat(64),
  title: 'Final film', state: 'completed', playable: true };
const reply = (changes = {}) => ({ structuredContent: { projectId: work.projectId, inlineWork: { ...work, ...changes } },
  _meta: { inlineVideo: { video: 'data:video/mp4;base64,YQ==' } } });
const presentation = () => ({ structuredContent: { ...reply().structuredContent, inlineVideoTransport: 'server-tool' } });

test('bounded presentation reads complete media directly once, then preserves duplicate playback', async () => {
  const window = new Window(), root = window.document.createElement('main');
  const calls: any[] = [];
  const bytes = Buffer.alloc(2 * 1024 * 1024, 97);
  const full = { ...reply(), _meta: { inlineVideo: { video: 'data:video/mp4;base64,' + bytes.toString('base64') } } };
  const ui = mountFinalVideo(root, { callServerTool: async (call: any) => { calls.push(call); return full; } });
  try {
    ui.setInput({ arguments: { projectId: work.projectId, workId: work.id } });
    const envelope = { content: [{ type: 'text', text: 'Script completed' }, { type: 'text', text: JSON.stringify(presentation()) }] };
    assert.ok(JSON.stringify(envelope).length < 8192);
    ui.update(envelope); ui.update(envelope);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ name: 'openmotion_get_project', arguments: { projectId: work.projectId, workId: work.id, includeVideo: true } }]);
    const video = root.querySelector('video')!, original = video.src;
    assert.match(original, /^blob:/);
    assert.deepEqual(Buffer.from(await (await fetch(original)).arrayBuffer()), bytes);
    video.currentTime = 4;
    ui.update(envelope);
    assert.equal(video.src, original); assert.equal(video.currentTime, 4); assert.equal(calls.length, 1);
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});

test('initial direct read failure exposes retry and never starts a render', async () => {
  const window = new Window(), root = window.document.createElement('main');
  const calls: any[] = [];
  const ui = mountFinalVideo(root, { callServerTool: async (call: any) => {
    calls.push(call); if (calls.length === 1) throw new Error('disconnected'); return reply();
  } });
  try {
    ui.update(presentation());
    await new Promise(resolve => setImmediate(resolve));
    assert.match(root.querySelector('.status')!.textContent!, /读取失败/);
    const retry = root.querySelector<HTMLButtonElement>('.retry')!;
    assert.equal(retry.hidden, false); assert.equal(retry.disabled, false);
    ui.update(presentation()); assert.equal(calls.length, 1, 'No automatic retry loop');
    retry.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[1].name, 'openmotion_get_project'); assert.match(root.querySelector('video')!.src, /^blob:/);
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});

test('direct reads reject another export and cannot recursively request missing media', async () => {
  for (const response of [reply({ jobId: 'other-export' }), presentation()]) {
    const window = new Window(), root = window.document.createElement('main');
    let calls = 0;
    const ui = mountFinalVideo(root, { callServerTool: async () => { calls++; return response; } });
    try {
      ui.update(presentation()); await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls, 1); assert.equal(root.querySelector('video')!.src, '');
      assert.equal(root.querySelector<HTMLButtonElement>('.retry')!.hidden, false);
      assert.match(root.querySelector('.status')!.textContent!, /不匹配|未收到/);
    } finally { ui.destroy(); await window.happyDOM.abort(); }
  }
});

test('only a completed decoded MP4 expands the final player and shows actual duration', async () => {
  const window = new Window(), root = window.document.createElement('main');
  window.document.body.append(root);
  const ui = mountFinalVideo(root, { callServerTool: async () => reply() });
  try {
    ui.update(reply({ state: 'authoring', playable: false }));
    assert.equal(root.querySelector<HTMLElement>('.screen')!.hidden, true);
    assert.equal(root.querySelector('video')!.src, '');
    ui.update({ content: [{ type: 'text', text: JSON.stringify(reply()) }] });
    const video = root.querySelector('video')!;
    assert.match(video.src, /^blob:/);
    assert.equal(root.querySelector<HTMLElement>('.screen')!.hidden, true, 'Wait for actual decoding');
    for (const [name, value] of Object.entries({ duration: 15, videoWidth: 1920, videoHeight: 1080 }))
      Object.defineProperty(video, name, { configurable: true, value });
    video.dispatchEvent(new window.Event('loadeddata'));
    assert.equal(root.querySelector<HTMLElement>('.screen')!.hidden, false);
    assert.equal(root.querySelector('.duration')!.textContent, '片长 0:15');
    assert.match(root.querySelector('.status')!.textContent!, /可播放/);
    ui.update(reply({ jobId: 'unrelated-job', title: 'Other film' }));
    assert.equal(root.querySelector('.title')!.textContent, 'Final film');
    assert.match(root.querySelector('.status')!.textContent!, /不匹配/);
    video.dispatchEvent(new window.Event('loadeddata'));
    assert.equal(root.querySelector<HTMLElement>('.screen')!.hidden, true, 'A late media event must not override a rejected result');
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});

test('bad or missing final media remains compact with recovery, never a fake ready player', async () => {
  const window = new Window(), root = window.document.createElement('main');
  const ui = mountFinalVideo(root, { callServerTool: async () => reply() });
  try {
    ui.update({ structuredContent: reply().structuredContent });
    assert.equal(root.querySelector<HTMLElement>('.screen')!.hidden, true);
    assert.equal(root.querySelector<HTMLButtonElement>('.retry')!.hidden, false);
    ui.update(reply());
    root.querySelector('video')!.dispatchEvent(new window.Event('error'));
    assert.match(root.querySelector('.status')!.textContent!, /播放失败/);
    assert.equal(root.querySelector<HTMLElement>('.screen')!.hidden, true);
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});

test('malformed first result can retry the tool-input work without exporting or changing version', async () => {
  const window = new Window(), root = window.document.createElement('main');
  const calls: any[] = [];
  const ui = mountFinalVideo(root, { callServerTool: async (call: any) => { calls.push(call); return reply(); } });
  try {
    ui.setInput({ arguments: { projectId: work.projectId, workId: work.id } });
    ui.update({ content: [{ type: 'text', text: '{bad' }] });
    const retry = root.querySelector<HTMLButtonElement>('.retry')!;
    assert.equal(retry.hidden, false);
    retry.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ name: 'openmotion_get_project', arguments: {
      projectId: work.projectId, workId: work.id, includeVideo: true,
    } }]);
    assert.match(root.querySelector('video')!.src, /^blob:/);
    ui.update(reply({ id: 'another-round' }));
    assert.match(root.querySelector('.status')!.textContent!, /不匹配/);
    retry.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls[1], calls[0]);
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});

test('retry failures remain recoverable and repeated clicks share one read', async () => {
  const window = new Window(), root = window.document.createElement('main');
  let rejectRead: (error: Error) => void = () => {};
  let calls = 0;
  const ui = mountFinalVideo(root, { callServerTool: () => {
    calls++;
    return new Promise((resolve, reject) => { rejectRead = reject; });
  } });
  try {
    ui.setInput({ arguments: { projectId: work.projectId, workId: work.id } });
    ui.update({ content: [] });
    const retry = root.querySelector<HTMLButtonElement>('.retry')!;
    retry.click(); retry.click();
    assert.equal(calls, 1);
    assert.equal(retry.disabled, true);
    rejectRead(new Error('disconnected'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(retry.disabled, false);
    assert.equal(retry.hidden, false);
    assert.match(root.querySelector('.status')!.textContent!, /读取失败/);
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});

test('the first result must match the presentation tool input', async () => {
  const window = new Window(), root = window.document.createElement('main');
  const ui = mountFinalVideo(root, { callServerTool: async () => reply() });
  try {
    ui.setInput({ arguments: { projectId: work.projectId, workId: work.id } });
    ui.update(reply({ id: 'unrelated-round' }));
    assert.equal(root.querySelector('video')!.src, '');
    assert.match(root.querySelector('.status')!.textContent!, /不匹配/);
    assert.equal(root.querySelector<HTMLButtonElement>('.retry')!.hidden, false);
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});

test('media loading timeout exposes retry and ignores late decoding until recovery', async () => {
  const window = new Window(), root = window.document.createElement('main');
  let expire: () => void = () => {};
  window.setTimeout = ((callback: () => void) => { expire = callback; return 1; }) as any;
  const ui = mountFinalVideo(root, { callServerTool: async () => reply() });
  try {
    ui.update(reply());
    expire();
    assert.match(root.querySelector('.status')!.textContent!, /加载超时/);
    assert.equal(root.querySelector<HTMLButtonElement>('.retry')!.hidden, false);
    const video = root.querySelector('video')!;
    for (const [name, value] of Object.entries({ duration: 15, videoWidth: 1920, videoHeight: 1080 }))
      Object.defineProperty(video, name, { configurable: true, value });
    video.dispatchEvent(new window.Event('loadeddata'));
    assert.equal(root.querySelector<HTMLElement>('.screen')!.hidden, true);
    root.querySelector<HTMLButtonElement>('.retry')!.click();
    await new Promise(resolve => setImmediate(resolve));
    video.dispatchEvent(new window.Event('loadeddata'));
    assert.equal(root.querySelector<HTMLElement>('.screen')!.hidden, false);
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});

test('status plus JSON loads once and duplicate delivery preserves playback position', async () => {
  const window = new Window(), root = window.document.createElement('main');
  const ui = mountFinalVideo(root, { callServerTool: async () => reply() });
  try {
    ui.setInput({ arguments: { projectId: work.projectId, workId: work.id } });
    const envelope = { content: [ { type: 'text', text: 'Script completed\nOutput:\n' },
      { type: 'text', text: JSON.stringify(reply()) } ] };
    ui.update(envelope);
    const video = root.querySelector('video')!;
    assert.match(video.src, /^blob:/);
    const original = video.src;
    video.currentTime = 4;
    ui.update(envelope);
    assert.equal(video.src, original);
    assert.equal(video.currentTime, 4);
    assert.equal(root.querySelectorAll('video').length, 1);
  } finally { ui.destroy(); await window.happyDOM.abort(); }
});
