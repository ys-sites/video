// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useTemplateSearchContext } from './useTemplateSearchContext';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let context: ReturnType<typeof useTemplateSearchContext>;
const host = document.createElement('div');
let root = createRoot(host);
function Probe(props: { open: boolean; ready: boolean; condition: string; searching: boolean }) {
  context = useTemplateSearchContext(props.open, props.ready, props.condition, props.searching);
  return null;
}
const render = (condition: string, searching = true, open = true, ready = true) => act(() => root.render(<Probe {...{ condition, searching, open, ready }} />));
afterEach(() => { act(() => root.unmount()); root = createRoot(host); vi.useRealTimers(); });
it('changes result identity for each rendered condition while keeping one discovery, and resets on reopen', () => {
  render('all', false); const initial = context.read();
  expect(initial.discoveryId).toBeUndefined();
  render('A'); const a = context.read();
  render('B'); const b = context.read();
  render('A'); const again = context.read();
  expect(new Set([a.resultSetId, b.resultSetId, again.resultSetId]).size).toBe(3);
  expect(a.discoveryId).toBe(b.discoveryId);
  expect(a.discoveryId).toBe(again.discoveryId);
  render('A'); expect(context.read()).toEqual(again);
  render('A', true, false); render('all', false);
  expect(context.read().libraryViewId).not.toBe(initial.libraryViewId);
  expect(context.read().discoveryId).toBeUndefined();
});
it('ends discovery after thirty idle minutes and starts reference discovery without requiring a keyword', () => {
  vi.useFakeTimers();
  render('all', false); context.activity(); const before = context.read();
  expect(before.discoveryId).toMatch(/^[a-f0-9-]{36}$/);
  vi.advanceTimersByTime(29 * 60_000); context.activity();
  expect(context.read()).toEqual(before);
  vi.advanceTimersByTime(30 * 60_000); context.activity();
  expect(context.read().libraryViewId).toBe(before.libraryViewId);
  expect(context.read().discoveryId).not.toBe(before.discoveryId);
  expect(context.read().resultSetId).not.toBe(before.resultSetId);
});
