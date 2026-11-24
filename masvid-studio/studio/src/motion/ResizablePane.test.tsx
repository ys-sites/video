// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResizablePane } from './ResizablePane';

let root: Root, container: HTMLDivElement, available: number, measured: number, notify: () => void;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  available = 1100; measured = 540; localStorage.clear(); localStorage.setItem('test-pane', '600');
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => available);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: measured } as DOMRect));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
async function render() { await act(async () => root.render(<div><div className="om-resizable-pane" style={{ minWidth: 164 }} /><ResizablePane className="test-pane" storageKey="test-pane" initial={360} min={280} max={600} edge="left" label="Resize details">Details</ResizablePane></div>)); }
it('reports measured geometry without feeding constrained widths back into layout or saved preferences', async () => {
  await render();
  const pane = container.querySelector<HTMLElement>('.test-pane')!, separator = pane.querySelector('[role=separator]')!;
  expect(separator.getAttribute('aria-valuenow')).toBe('540');
  expect(pane.style.width).toBe('600px');
  for (const width of [440, 556, 440, 500]) {
    available = 1000; measured = width; await act(async () => notify());
    expect(pane.style.width).toBe('600px');
    expect(separator.getAttribute('aria-valuenow')).toBe(String(width));
  }
  expect(localStorage.getItem('test-pane')).toBe('600');
  available = 0; measured = 0; await act(async () => notify());
  expect(separator.getAttribute('aria-valuenow')).toBe('500');
});
it('sizes keyboard edits from the visible width and persists only explicit user changes', async () => {
  await render();
  const pane = container.querySelector<HTMLElement>('.test-pane')!, separator = pane.querySelector('[role=separator]')!;
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(pane.style.width).toBe('524px'); expect(localStorage.getItem('test-pane')).toBe('524');
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(pane.style.width).toBe('280px');
  await act(async () => separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(pane.style.width).toBe('360px'); expect(localStorage.getItem('test-pane')).toBe('360');
});
it('reserves the visible width of fixed navigation when bounding explicit edits', async () => {
  await render();
  const navigation = container.querySelector<HTMLElement>('.om-resizable-pane')!;
  navigation.style.flexShrink = '0';
  vi.spyOn(navigation, 'getBoundingClientRect').mockReturnValue({ width: 280 } as DOMRect);
  available = 1000; measured = 440; await act(async () => notify());
  const pane = container.querySelector<HTMLElement>('.test-pane')!, separator = pane.querySelector('[role=separator]')!;
  expect(separator.getAttribute('aria-valuemax')).toBe('440');
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(pane.style.width).toBe('440px');
  expect(localStorage.getItem('test-pane')).toBe('440');
});
