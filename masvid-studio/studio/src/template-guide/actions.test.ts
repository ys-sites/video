// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { guideDraftKey, handleGuideAction, validGuideRpc } from './actions';
const lovable = 'motion-be2a4af0-0183-4979-ab05-2a68413c0890';
const stripe = 'motion-80dceb1d-5219-4e1f-9394-6baacf5d0166';
const draft = { title: 'My product', accent: '#7050da' };
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const api = () => vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
  const { name } = JSON.parse(init.body as string);
  if (_url !== '/motion-api/phase1/call') return new Response(JSON.stringify({ error: 'Wrong service route' }), { status: 503 });
  return new Response(JSON.stringify(name === 'openmotion_get_template' ? { title: 'Lovable', hasHtmlProject: false } : name === 'openmotion_create_project'
    ? { projectId: '11111111-1111-4111-8111-111111111111', previewUrl: location.origin + '/?project=11111111-1111-4111-8111-111111111111' } : {}));
}));

it('keeps draft storage separate for every exact template and rejects corrupt values', async () => {
  await handleGuideAction(lovable, 'save', draft, 'en');
  expect(await handleGuideAction(lovable, 'load', undefined, 'en')).toEqual(draft);
  expect(await handleGuideAction(stripe, 'load', undefined, 'en')).toBeNull();
  localStorage.setItem(guideDraftKey(stripe), JSON.stringify({ ...draft, path: '/private' }));
  expect(await handleGuideAction(stripe, 'load', undefined, 'en')).toBeNull();
});
it('copies the selected template and current values without creating or sending a project', async () => {
  api(); const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  expect(await handleGuideAction(lovable, 'copy', draft, 'en')).toEqual({ copied: true });
  const text = write.mock.calls[0][0]; expect(text).toContain(lovable); expect(text).toContain('My product'); expect(text).not.toContain(stripe);
  expect(fetch).toHaveBeenCalledTimes(1);
  write.mockRejectedValue(new Error('Clipboard denied'));
  expect(await handleGuideAction(lovable, 'copy', draft, 'en')).toEqual({ copied: false, text });
});
it('reuses one creation request for the same draft and opens the returned project', async () => {
  api();
  await handleGuideAction(lovable, 'open', draft, 'en'); await handleGuideAction(lovable, 'open', draft, 'en');
  const calls = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
  const creates = calls.filter(call => call.name === 'openmotion_create_project');
  expect(creates[0].arguments.requestId).toBe(creates[1].arguments.requestId);
  expect(creates[0].arguments).toEqual(expect.objectContaining({ templateId: lovable, guideDraft: draft }));
  expect(calls.filter(call => call.name === 'openmotion_open_preview').map(call => call.arguments.projectId)).toEqual(['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111']);
});
it('replays the complete creation payload after language changes and module reloads', async () => {
  api(); const id = 'motion-language-retry';
  await handleGuideAction(id, 'open', draft, 'en');
  vi.resetModules();
  const reloaded = await import('./actions');
  await reloaded.handleGuideAction(id, 'open', draft, 'fr');
  const creates = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string)).filter(call => call.name === 'openmotion_create_project');
  expect(creates[1].arguments).toEqual(creates[0].arguments);
  expect(creates[1].arguments.namingLanguage).toBe('en');
});
it('allows a fresh attempt only after a confirmed unapplied failure, preserving uncertain retries', async () => {
  for (const applied of [false, 'unknown']) {
    const id = 'motion-failure-' + applied;
    const creates: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const call = JSON.parse(init.body as string);
      if (call.name === 'openmotion_get_template') return new Response(JSON.stringify({ title: 'Guide' }));
      if (call.name === 'openmotion_create_project') {
        creates.push(call.arguments);
        if (creates.length === 1) return new Response(JSON.stringify({ error: 'Temporary source failure', applied }), { status: 400 });
        return new Response(JSON.stringify({ projectId: '11111111-1111-4111-8111-111111111111', previewUrl: location.origin + '/?project=11111111-1111-4111-8111-111111111111' }));
      }
      return new Response('{}');
    }));
    await expect(handleGuideAction(id, 'open', draft, 'en')).rejects.toThrow('Temporary source failure');
    vi.resetModules(); const reloaded = await import('./actions');
    await reloaded.handleGuideAction(id, 'open', draft, 'fr');
    if (applied === false) expect(creates[1].requestId).not.toBe(creates[0].requestId);
    else expect(creates[1]).toEqual(creates[0]);
  }
});
it('accepts only bounded requests tied to a concrete template', () => {
  const rpc = { type: 'openmotion:guide-action', templateId: lovable, viewId: crypto.randomUUID(), requestId: 'copy-1', action: 'copy', locale: 'en', value: draft };
  expect(validGuideRpc(rpc)).toBe(true); expect(validGuideRpc({ ...rpc, action: 'fetch_private_file' })).toBe(false);
  expect(validGuideRpc({ ...rpc, templateId: '../private' })).toBe(false);
});

it('downloads only the current template document through the unsandboxed host', async () => {
  const bytes = '# Exact document\n';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:guide-document');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    expect(await handleGuideAction(lovable, 'download', undefined, 'en')).toBe(true);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/template-source/${lovable}/motion.md`);
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0].download).toBe('motion.md');
    await vi.runAllTimersAsync();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:guide-document');
  } finally { vi.useRealTimers(); }
});
it('opens only the catalog-owned original source and constructs a pinned library route', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sourceUrl: 'https://x.com/Lovable/status/2056389414381879461' }))));
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  await handleGuideAction(lovable, 'source', undefined, 'en');
  expect(open).toHaveBeenCalledExactlyOnceWith('https://x.com/Lovable/status/2056389414381879461', '_blank', 'noopener,noreferrer');
  expect(await handleGuideAction(lovable, 'library', undefined, 'en')).toEqual({ url: `${location.origin}/?templates=1&template=${lovable}` });
});
