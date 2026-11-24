// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { uploadLibraryAsset } from './assetClient';
import { MAX_ASSET_BYTES } from '../../../shared/asset-limits';

afterEach(() => vi.unstubAllGlobals());
const file = () => new File(['media'], 'network error ENOENT.png', { type: 'image/png' });
it('rejects empty and oversized files before sending a request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(new File([], 'empty.png'))).rejects.toMatchObject({ outcome: 'rejected', reason: 'unreadable' });
  const oversized = file(); Object.defineProperty(oversized, 'size', { value: MAX_ASSET_BYTES + 1 });
  await expect(uploadLibraryAsset(oversized)).rejects.toMatchObject({ outcome: 'rejected', reason: 'size' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects SVG by extension or MIME type before sending a request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const file of [new File(['<svg/>'], 'logo.SVG'), new File(['<svg/>'], 'logo', { type: 'image/svg+xml' })]) {
    await expect(uploadLibraryAsset(file)).rejects.toMatchObject({ outcome: 'rejected', reason: 'unsupported' });
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  [413, '', 'size'],
  [400, JSON.stringify({ error: 'This file is not readable image, video or audio media' }), 'unreadable'],
  [400, JSON.stringify({ error: 'The media file could not be decoded' }), 'unreadable'],
  [400, JSON.stringify({ error: 'Unsupported media type' }), 'unsupported'],
  [409, JSON.stringify({ error: 'Internal runtime detail', applied: false }), undefined],
])('recognizes explicit refusals without exposing diagnostics (%s / %s)', async (status, body, reason) => {
  const fetcher = vi.fn(async () => new Response(body, { status })); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file())).rejects.toMatchObject({ outcome: 'rejected', reason, message: 'File was not uploaded.' });
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each([
  [200, ''], [200, '{}'], [200, '{"asset":{"id":"a"}}'], [200, '{"asset":{"id":"a","currentVersionId":"v","versions":[]}}'],
  [502, '<html>proxy error</html>'], [400, '{"error":"Failed cleanup after saving /private/path"}'],
])('keeps an unconfirmed response uncertain (%s / %s)', async (status, body) => {
  const fetcher = vi.fn(async () => new Response(body, { status })); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file())).rejects.toMatchObject({ outcome: 'unknown', reason: undefined });
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each([new TypeError('Failed to fetch'), new DOMException('Timed out', 'AbortError')])('does not retry a transport error', async error => {
  const fetcher = vi.fn().mockRejectedValue(error); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file())).rejects.toMatchObject({ outcome: 'unknown' });
  expect(fetcher).toHaveBeenCalledOnce();
});
it('returns confirmed assets and preserves the version destination and request identity', async () => {
  const asset = { id: 'asset', currentVersionId: 'version', versions: [{ id: 'version' }] };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ asset })); vi.stubGlobal('fetch', fetcher);
  await expect(uploadLibraryAsset(file(), { assetId: 'asset', parentVersionId: 'parent' })).resolves.toEqual(asset);
  const url = new URL(String(fetcher.mock.calls[0][0]), 'http://localhost');
  expect(url.searchParams.get('assetId')).toBe('asset');
  expect(url.searchParams.get('parentVersionId')).toBe('parent');
  expect(url.searchParams.get('requestId')).toMatch(/^[\w-]+$/);
  expect(fetcher).toHaveBeenCalledOnce();
});
