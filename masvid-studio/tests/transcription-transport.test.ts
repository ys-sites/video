import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publicProviderFetch } from '../gateway/network.ts';
import { transcribeAudio } from '../gateway/transcription-provider.ts';

test('ASR accepts a silent 65-second response through the DNS-pinned transport without retries', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-asr-transport-'));
  t.after(async () => { t.mock.restoreAll(); syncBuiltinESMExports(); await rm(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'audio.wav'); await writeFile(file, 'fixture audio');
  const addresses = [{ address: '93.184.216.34', family: 4 }];
  t.mock.method(dns, 'lookup', async () => addresses); syncBuiltinESMExports();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let delay = 0, status = 200, calls = 0, entered = () => {};
  const timeouts: number[] = [];
  t.mock.method(https, 'request', (_url: URL, options: any, respond: Function) => {
    calls++;
    options.lookup('api.example.com', { all: true }, (error: unknown, resolved: unknown) => { assert.equal(error, null); assert.deepEqual(resolved, addresses); });
    const request = new EventEmitter() as any;
    let idle: ReturnType<typeof setTimeout>, response: ReturnType<typeof setTimeout>;
    const abort = () => request.destroy(options.signal.reason);
    const clean = () => { clearTimeout(idle); clearTimeout(response); options.signal?.removeEventListener('abort', abort); };
    request.setTimeout = (ms: number, timeout: () => void) => { timeouts.push(ms); idle = setTimeout(timeout, ms); };
    request.write = () => {};
    request.destroy = (error: Error) => { clean(); request.emit('error', error); };
    request.end = () => {
      response = setTimeout(() => {
        clean();
        const body = Object.assign(new PassThrough(), { statusCode: status, headers: status === 302 ? { location: 'https://redirect.example.com' } : {} });
        respond(body); body.end(JSON.stringify({ segments: [{ text: 'Long audio', start: 0, end: 1 }] }));
      }, delay);
      entered();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    return request;
  });
  const ordinaryReady = new Promise<void>(resolve => { entered = resolve; });
  const ordinary = publicProviderFetch('https://api.example.com/v1/models');
  await ordinaryReady; t.mock.timers.tick(0); assert.equal((await ordinary).status, 200);
  assert.equal(timeouts[0], 60_000, 'ordinary provider requests retain their existing idle limit');

  const controller = new AbortController();
  const input = { file, modelId: 'whisper-1', baseUrl: 'https://api.example.com', key: 'fixture-key', parameters: {}, offset: 0, duration: 600, signal: controller.signal };
  delay = 65_000;
  const longReady = new Promise<void>(resolve => { entered = resolve; });
  const transcription = transcribeAudio(input);
  await longReady; t.mock.timers.tick(65_000);
  assert.equal((await transcription)[0].text, 'Long audio');
  assert.equal(timeouts[1], 600_000); assert.equal(calls, 2);

  const cancelReady = new Promise<void>(resolve => { entered = resolve; });
  const cancelled = transcribeAudio(input);
  await cancelReady; controller.abort(new Error('Cancelled fixture'));
  await assert.rejects(cancelled, /Cancelled fixture/); assert.equal(calls, 3);

  status = 302; delay = 0;
  const redirectReady = new Promise<void>(resolve => { entered = resolve; });
  const redirected = transcribeAudio({ ...input, signal: new AbortController().signal });
  await redirectReady; t.mock.timers.tick(0);
  await assert.rejects(redirected, /Transcription provider HTTP 302/);
  assert.equal(calls, 4, 'redirects and failed paid submissions never trigger another request');

  addresses[0].address = '127.0.0.1';
  await assert.rejects(publicProviderFetch('https://api.example.com/v1/models'), /non-public address/);
  assert.equal(calls, 4);
});
