// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TemplateMotionGuide } from './TemplateMotionGuide';
import { prepareMotionGuide, type GuideAppearance } from './templateMotionGuideDocument';
import * as guideActions from '../template-guide/actions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const appearance: GuideAppearance = { theme: 'light', background: '#f5f5f5', text: '#494949', muted: '#5c5c5c', surface: '#fafafa', border: '#dbdbdb' };
const source = '<html><head><link rel="stylesheet" href="guide.css"></head><body style="--paper:#96d93c"><h1>Guide</h1><iframe src="demo.html"></iframe><script src="runtime.js"></script></body></html>';
const url = 'https://example.com/guides/one.html';
let host: HTMLDivElement, root: Root;
let blobs: Blob[];
beforeEach(() => {
  window.happyDOM.settings.enableIframePageLoading = false;
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob); return 'blob:http://localhost/' + blobs.length; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  document.documentElement.dataset.theme = 'paper';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.removeAttribute('data-theme'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('preserves artwork, scripts and asset resolution inside the adapted guide', () => {
  const doc = new DOMParser().parseFromString(prepareMotionGuide(source, url, appearance), 'text/html');
  expect(doc.querySelector('base')?.href).toBe(url);
  expect(doc.querySelector('iframe')?.getAttribute('src')).toBe('demo.html');
  expect(doc.querySelector('script[src]')?.getAttribute('src')).toBe('runtime.js');
  expect(doc.body.style.getPropertyValue('--paper')).toBe('#96d93c');
  expect(doc.documentElement.style.getPropertyValue('--om-guide-background')).toBe('#f5f5f5');
  expect(doc.documentElement.dataset.openmotionGuide).toBe('light');
  expect(doc.querySelector('style')?.textContent).not.toMatch(/filter:|\.demo-stage.*background/);
});

it('syncs theme without re-fetching or replacing the guide document and keeps the sandbox', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source, { headers: { 'content-type': 'text/html' } })));
  await act(async () => root.render(<TemplateMotionGuide url={url} title="Guide" />));
  const frame = host.querySelector('iframe')!;
  const src = frame.src;
  const postMessage = vi.fn();
  Object.defineProperty(frame, 'contentWindow', { value: { postMessage }, configurable: true });
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(src).toBe('blob:http://localhost/1');
  expect(frame.hasAttribute('srcdoc')).toBe(false);
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  await act(async () => { document.documentElement.removeAttribute('data-theme'); });
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'openmotion:guide-appearance', appearance: expect.objectContaining({ theme: 'dark' }) }), '*');
  expect(frame.src).toBe(src);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('falls back to the untouched remote iframe when CORS or the fetch fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await act(async () => root.render(<TemplateMotionGuide url={url} title="Guide" />));
  const frame = host.querySelector('iframe')!;
  expect(frame.getAttribute('src')).toBe(url);
  expect(frame.hasAttribute('srcdoc')).toBe(false);
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
});

it('loads the expanded walkthrough eagerly without a blob-navigation dependency', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source, { headers: { 'content-type': 'text/html' } })));
  await act(async () => root.render(<TemplateMotionGuide expanded url={url} title="Walkthrough" />));
  const frame = host.querySelector('iframe')!;
  expect(frame.getAttribute('srcdoc')).toContain('runtime.js');
  expect(frame.getAttribute('srcdoc')).toContain(`<base href="${url}">`);
  expect(frame.getAttribute('loading')).toBe('eager');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('returns from the expanded guide only for Escape from its focused sandboxed frame', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source, { headers: { 'content-type': 'text/html' } })));
  const onEscape = vi.fn();
  await act(async () => root.render(<TemplateMotionGuide expanded url={url} title="Walkthrough" onEscape={onEscape} />));
  const frame = host.querySelector('iframe')!;
  const guideWindow = frame.contentWindow!;
  const escape = (sender: Window, origin: string) => window.dispatchEvent(new MessageEvent('message', {
    source: sender, origin, data: 'openmotion:guide-escape',
  }));
  expect(frame.srcdoc).toContain("parent.postMessage('openmotion:guide-escape', '*')");
  escape(guideWindow, 'null');
  frame.focus();
  escape(window, 'null');
  escape(guideWindow, 'http://localhost:3000');
  expect(onEscape).not.toHaveBeenCalled();
  escape(guideWindow, 'null');
  expect(onEscape).toHaveBeenCalledTimes(1);
});

it('aborts a stale guide and cannot overwrite a newer selection', async () => {
  let resolveFirst!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; })).mockResolvedValue(new Response(source.replace('Guide', 'Second'), { headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<TemplateMotionGuide url={url} title="Guide" />));
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  await act(async () => root.render(<TemplateMotionGuide url="https://example.com/second.html" title="Second" />));
  expect(signal.aborted).toBe(true);
  await act(async () => resolveFirst(new Response(source, { headers: { 'content-type': 'text/html' } })));
  expect(await blobs[0].text()).toContain('<h1>Second</h1>');
  expect(blobs).toHaveLength(1);
});

it.each(['./assets/', '../assets/', '', 'https://cdn.example.com/assets/'])('resolves an existing base %j against the final response URL', async base => {
  const finalUrl = 'https://example.com/redirected/guide.html';
  const response = new Response(`<base href="${base}"><img src="poster.png">`, { headers: { 'content-type': 'text/html' } });
  Object.defineProperty(response, 'url', { value: finalUrl });
  vi.stubGlobal('fetch', vi.fn(async () => response));
  await act(async () => root.render(<TemplateMotionGuide url={url} title="Guide" />));
  const doc = new DOMParser().parseFromString(await blobs[0].text(), 'text/html');
  expect(doc.querySelector('base')?.getAttribute('href')).toBe(new URL(base, finalUrl).href);
  expect(doc.querySelector('img')?.getAttribute('src')).toBe('poster.png');
});


it('revokes prepared guide documents on selection changes and unmount', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source, { headers: { 'content-type': 'text/html' } })));
  await act(async () => root.render(<TemplateMotionGuide url={url} title="Guide" />));
  await act(async () => root.render(<TemplateMotionGuide url="https://example.com/next.html" title="Next" />));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/1');
  await act(async () => root.render(null));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/2');
});

it('delegates only the current local guide frame and pins its template identity', async () => {
  const id = 'motion-be2a4af0-0183-4979-ab05-2a68413c0890';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(source, { headers: { 'content-type': 'text/html' } })));
  const action = vi.spyOn(guideActions, 'handleGuideAction').mockResolvedValue(null);
  await act(async () => root.render(<TemplateMotionGuide url={location.origin + '/api/template-source/' + id + '/preview.html'} title="Guide" />));
  const frame = host.querySelector('iframe')!;
  const rpc = { type: 'openmotion:guide-action', templateId: id, viewId: crypto.randomUUID(), requestId: 'load-1', action: 'load', locale: 'en' };
  await act(async () => window.dispatchEvent(new MessageEvent('message', { data: rpc, source: window })));
  expect(action).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new MessageEvent('message', { data: { ...rpc, templateId: 'motion-another-template' }, source: frame.contentWindow })));
  expect(action).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new MessageEvent('message', { data: rpc, source: frame.contentWindow })));
  expect(action).toHaveBeenCalledExactlyOnceWith(id, 'load', undefined, expect.any(String));
});
